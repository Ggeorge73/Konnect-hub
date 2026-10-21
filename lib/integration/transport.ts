import { isSupabaseConfigured } from '../config';
import { MIN_SECRET_LENGTH } from '../security/secrets';
import { EVENT_HEADER, sign } from './signing';

/**
 * Delivery of Hub → CRM events. `CRM_BASE_URL` set: a signed POST to
 * `{CRM_BASE_URL}/api/integrations/konnect-hub` (the CRM's inbound webhook). Otherwise, with
 * `MOCK_CRM=true` (or in demo mode), the in-process mock CRM (lib/integration/mock-crm.ts).
 */
export interface TransportResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export type Transport = (event: string, body: string) => Promise<TransportResult>;

/** The CRM's own default, so a local CRM and a local Hub talk to each other out of the box. */
export const DEV_INTEGRATION_SECRET = 'dev-only-shared-secret';

/**
 * KONNECTOR_INTEGRATION_SECRET, the same value on both sides. Demo mode falls back to the CRM's
 * development default; with real sign-in configured a missing or short secret refuses everything.
 */
export function integrationSecret(env: Record<string, string | undefined> = process.env): string {
  const v = env.KONNECTOR_INTEGRATION_SECRET;
  if (v && v.length >= MIN_SECRET_LENGTH) return v;
  if (!isSupabaseConfigured()) return v || DEV_INTEGRATION_SECRET;
  throw new Error(`KONNECTOR_INTEGRATION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
}

export const crmBaseUrl = () => (process.env.CRM_BASE_URL ?? '').replace(/\/$/, '');

/** Mock CRM: explicit MOCK_CRM=true, or demo mode with no CRM configured. */
export const isMockCrm = () =>
  !crmBaseUrl() &&
  (process.env.MOCK_CRM === 'true' || (process.env.MOCK_CRM !== 'false' && !isSupabaseConfigured()));

export const httpTransport: Transport = async (event, body) => {
  const base = crmBaseUrl();
  if (!base) return { ok: false, status: 503, body: { error: 'CRM_BASE_URL is not set' } };
  const res = await fetch(`${base}/api/integrations/konnect-hub`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Konnector-Signature': sign(body, integrationSecret()),
      [EVENT_HEADER]: event,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    // A non-JSON error body is fine: the status carries the outcome.
  }
  return { ok: res.ok, status: res.status, body: json };
};

export const mockTransport: Transport = async (event, body) => {
  const { mockCrm } = await import('./mock-crm');
  return mockCrm.receive(event, body, sign(body, integrationSecret()));
};

export const crmTransport = (): Transport => (isMockCrm() ? mockTransport : httpTransport);
