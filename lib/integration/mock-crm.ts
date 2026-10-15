import { randomUUID } from 'node:crypto';
import { findForbiddenKeys, HubToCrmEvent, type CrmToHubEvent } from './contract';
import { sign, verify } from './signing';
import type { TransportResult } from './transport';
import { integrationSecret } from './transport';

/**
 * Mock Konnector CRM (dev and tests; MOCK_CRM). Receives Hub → CRM events exactly as the CRM's
 * inbound webhook does (signature, contract, idempotency) and records them, and builds signed
 * CRM → Hub events so the whole flow can be exercised locally: POST /api/dev/mock-crm.
 */
interface MockState {
  received: { event: string; payload: Record<string, unknown>; at: string }[];
  seen: Set<string>;
  failNext: number;
}

const g = globalThis as unknown as { __khMockCrm?: MockState };
const state = () => (g.__khMockCrm ??= { received: [], seen: new Set(), failNext: 0 });

export const mockCrm = {
  reset() {
    g.__khMockCrm = undefined;
  },
  /** Make the next N deliveries fail with 503 (to exercise retries). */
  failNext(n: number) {
    state().failNext = n;
  },
  received() {
    return state().received;
  },

  async receive(event: string, body: string, signature: string): Promise<TransportResult> {
    const s = state();
    const v = verify(body, signature, integrationSecret());
    if (!v.ok) return { ok: false, status: 401, body: { error: v.reason } };
    if (s.failNext > 0) {
      s.failNext -= 1;
      return { ok: false, status: 503, body: { error: 'CRM temporarily unavailable' } };
    }
    const raw = JSON.parse(body) as Record<string, unknown>;
    if (findForbiddenKeys(raw).length)
      return { ok: false, status: 422, body: { error: 'payload contains fields outside the contract' } };
    const p = HubToCrmEvent.safeParse(raw);
    if (!p.success)
      return { ok: false, status: 422, body: { error: p.error.issues[0]?.message ?? 'invalid event' } };
    const e = p.data;
    const key =
      e.event === 'project.health_updated'
        ? `${e.event}:${e.konnect_hub_project_id}:${e.updated_at}`
        : `${e.event}:${e.item_id}:v${e.version}`;
    if (s.seen.has(key)) return { ok: true, status: 200, body: { ok: true, idempotent_replay: true } };
    s.seen.add(key);
    s.received.push({ event, payload: raw, at: new Date().toISOString() });
    return { ok: true, status: 200, body: { ok: true } };
  },

  /** A CRM → Hub event signed as the CRM would send it. */
  signed(payload: CrmToHubEvent | Record<string, unknown>, t = Date.now()) {
    const body = JSON.stringify(payload);
    return { body, signature: sign(body, integrationSecret(), t) };
  },
};

/** Sample CRM → Hub payloads for the dev page and tests. */
export const samples = {
  handoff(
    over: {
      name?: string;
      account?: string;
      leadEmail?: string;
      contacts?: {
        name: string;
        email: string;
        role: 'client_admin' | 'client_approver' | 'client_member';
      }[];
    } = {},
  ): CrmToHubEvent {
    const account = over.account ?? 'Harbor Health Partners';
    return {
      version: '1',
      event: 'opportunity.won',
      idempotency_key: `handoff_${randomUUID()}`,
      account: {
        crm_id: `acc_${account.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
        name: account,
        type: 'healthcare',
        konnect_hub_client_id: null,
      },
      project: {
        name: over.name ?? 'Harbor Patient Portal Rollout',
        contract_no: 'HHP-2026-007',
        value: 250000,
        currency: 'USD',
        start_date: '2026-11-02',
        end_date: '2027-05-28',
        service_lines: ['Digital experience', 'Integration'],
        scope_summary: 'Roll out the patient portal to three hospitals and integrate scheduling.',
        acceptance_criteria: ['Portal live at all three hospitals', 'Scheduling integration passes UAT'],
      },
      delivery_lead_email: over.leadEmail ?? 'lara@konnectortech.com',
      client_contacts: over.contacts ?? [
        { name: 'Dana Reyes', email: 'dana.reyes@harborhealth.example', role: 'client_admin' },
        { name: 'Sam Ortiz', email: 'sam.ortiz@harborhealth.example', role: 'client_member' },
      ],
      documents: [{ name: 'Signed SOW.pdf', url: 'https://crm.konnectortech.com/files/harbor-sow.pdf' }],
    };
  },

  publish(
    clientId: string,
    projectId: string | null,
    over: Partial<{
      id: string;
      lineage: string;
      version: number;
      type: 'quote' | 'contract_amendment' | 'renewal_offer' | 'survey';
      title: string;
      requiresSignature: boolean;
      respondBy: string | null;
    }> = {},
  ): CrmToHubEvent {
    const version = over.version ?? 1;
    const type = over.type ?? 'quote';
    const id = over.id ?? `ci_${randomUUID()}`;
    const lines =
      type === 'survey'
        ? []
        : [
            {
              item: 'Change request CR-12: extra interface',
              description: 'Design, build and test',
              qty: 80,
              unit_price: 185,
            },
            { item: 'Project management', description: null, qty: 1, unit_price: 2400 },
          ];
    return {
      version: '1',
      event: 'client_item.published',
      idempotency_key: `${id}:v${version}:publish`,
      item: {
        item_id: id,
        lineage_id: over.lineage ?? `lin_${id}`,
        version,
        supersedes_version: version > 1 ? version - 1 : null,
        type,
        konnect_hub_client_id: clientId,
        konnect_hub_project_id: projectId,
        title:
          over.title ??
          (type === 'survey' ? 'Quarterly satisfaction survey' : 'Change request CR-12: lab interface'),
        summary:
          type === 'survey'
            ? 'How likely are you to recommend Konnector?'
            : 'Adds the lab results interface requested in September.',
        amount: type === 'survey' ? null : 17200,
        currency: 'USD',
        lines,
        terms: type === 'survey' ? null : 'Net 30. Prices valid for 30 days.',
        new_end_date: null,
        respond_by: over.respondBy === undefined ? '2026-11-30' : over.respondBy,
        document:
          type === 'survey'
            ? null
            : { name: 'CR-12 quote.pdf', url: 'https://crm.konnectortech.com/files/cr12.pdf' },
        requires_signature: over.requiresSignature ?? false,
      },
    };
  },

  withdraw(itemId: string, version = 1): CrmToHubEvent {
    return {
      version: '1',
      event: 'client_item.withdrawn',
      idempotency_key: `${itemId}:v${version}:withdraw`,
      item_id: itemId,
      version_no: version,
      reason: 'Superseded by a revised offer.',
    };
  },

  extend(projectId: string, newEndDate: string | null, additional: number | null): CrmToHubEvent {
    return {
      version: '1',
      event: 'project.extended',
      idempotency_key: `ext_${randomUUID()}`,
      konnect_hub_project_id: projectId,
      new_end_date: newEndDate,
      additional_value: additional,
      currency: 'USD',
      reason: 'Renewal offer accepted',
    };
  },
};
