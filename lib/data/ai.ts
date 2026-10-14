import type { Project, Session } from '../domain/types';
import { canSeeProject, isInternalRole } from '../domain/permissions';
import { canToggleAi, settingsFor, type AiSettings, type SignalInput } from '../domain/ai';
import { db } from './memory';
import { newId } from './ids';
import { ForbiddenError, NotFoundError, ValidationError } from './errors';
import { isPostgresEnabled } from './index';
import { postgresAiStore } from './ai-postgres';

/**
 * AI assist data (KH-42..44): the per-project switch (off by default; only the Lead or an Admin
 * changes it, audited) and the accepted / dismissed risk-suggestion signals. `AiStore` has two
 * implementations, picked like getRepo(): the demo store below and the Postgres + RLS store in
 * ai-postgres.ts (supabase/migrations/0014_ai.sql). Shared behaviour: lib/data/contract-ai.ts.
 * No prompt or model output is ever stored.
 */

export interface AiSettingsView extends AiSettings {
  projectKey: string;
  canToggle: boolean;
  updatedByName: string | null;
}

export interface RiskInputs extends Omit<SignalInput, 'now' | 'lookaheadDays' | 'stalledDays'> {
  project: Project;
  /** Signal keys already accepted or dismissed on this project. */
  decided: string[];
}

export interface DecisionInput {
  signalKeys: string[];
  decision: 'accepted' | 'dismissed';
  raidId?: string | null;
}

export interface AiStore {
  /** Anyone who can see the project (clients too: thread summaries depend on it). */
  getSettings(s: Session, projectKey: string): Promise<AiSettingsView>;
  /** Lead of the project or Admin; audited as `ai.settings.update`. */
  setEnabled(s: Session, projectKey: string, enabled: boolean, now?: Date): Promise<AiSettingsView>;
  /** Internal users: what the risk signal detector reads. */
  riskInputs(s: Session, projectKey: string): Promise<RiskInputs>;
  /** Internal users: records signals so they are not suggested again. Returns the keys recorded. */
  recordDecision(s: Session, projectKey: string, input: DecisionInput, now?: Date): Promise<string[]>;
}

export const SIGNAL_KEY_RE = /^(stalled|overdue|sprint_miss|deliverable_late):[A-Za-z0-9_-]{1,80}$/;

/** Shared input checks for recordDecision. */
export function checkDecision(input: DecisionInput): string[] {
  const keys = [...new Set(input.signalKeys)];
  if (!keys.length || keys.length > 20) throw new ValidationError('Give between 1 and 20 signals.');
  if (keys.some((k) => !SIGNAL_KEY_RE.test(k))) throw new ValidationError('Unknown signal.');
  if (input.decision !== 'accepted' && input.decision !== 'dismissed')
    throw new ValidationError('Decision must be accepted or dismissed.');
  return keys;
}

const requireInternal = (s: Session) => {
  if (!isInternalRole(s.user.role)) throw new ForbiddenError('Risk suggestions are for the delivery team.');
};

function visibleProject(s: Session, keyOrId: string): Project {
  const d = db();
  const p = d.projects.find((x) => (x.id === keyOrId || x.key === keyOrId.toUpperCase()) && !x.deletedAt);
  if (!p || !canSeeProject(s.user, p, d.members)) throw new NotFoundError('Project not found');
  return p;
}

function view(s: Session, p: Project): AiSettingsView {
  const st = settingsFor(db().ai.settings, p.id);
  return {
    ...st,
    projectKey: p.key,
    canToggle: canToggleAi(s.user, p),
    updatedByName: st.updatedBy ? (db().profiles.find((x) => x.id === st.updatedBy)?.name ?? null) : null,
  };
}

export const memoryAiStore: AiStore = {
  async getSettings(s, projectKey) {
    return view(s, visibleProject(s, projectKey));
  },

  async setEnabled(s, projectKey, enabled, now = new Date()) {
    const p = visibleProject(s, projectKey);
    if (!canToggleAi(s.user, p))
      throw new ForbiddenError('Only the project’s Delivery Lead or an Admin can turn AI assist on or off.');
    const d = db();
    const before = settingsFor(d.ai.settings, p.id).enabled;
    const t = now.toISOString();
    const row: AiSettings = {
      projectId: p.id,
      enabled: Boolean(enabled),
      updatedBy: s.user.id,
      updatedAt: t,
    };
    d.ai.settings = [...d.ai.settings.filter((x) => x.projectId !== p.id), row];
    if (before === row.enabled) return view(s, p); // no change: nothing to audit
    d.audit.push({
      id: newId('au'),
      actorId: s.user.id,
      action: 'ai.settings.update',
      entity: 'project',
      entityId: p.id,
      before: { aiEnabled: before },
      after: { aiEnabled: row.enabled },
      at: t,
    });
    d.activity.push({
      id: newId('ac'),
      projectId: p.id,
      actorId: s.user.id,
      action: 'ai.settings',
      detail: `AI assist turned ${row.enabled ? 'on' : 'off'}`,
      at: t,
    });
    return view(s, p);
  },

  async riskInputs(s, projectKey) {
    requireInternal(s);
    const p = visibleProject(s, projectKey);
    const d = db();
    return {
      project: p,
      items: d.items.filter((i) => i.projectId === p.id && !i.deletedAt),
      history: d.statusHistory.filter((h) => h.projectId === p.id),
      sprints: d.sprints.filter((x) => x.projectId === p.id),
      deliverables: d.deliverables.filter((x) => x.projectId === p.id),
      decided: d.ai.decisions.filter((x) => x.projectId === p.id).map((x) => x.signalKey),
    };
  },

  async recordDecision(s, projectKey, input, now = new Date()) {
    requireInternal(s);
    const p = visibleProject(s, projectKey);
    const keys = checkDecision(input);
    const d = db();
    const raidId = input.raidId ?? null;
    if (raidId && !d.raid.some((r) => r.id === raidId && r.projectId === p.id))
      throw new ValidationError('RAID entry is not in this project.');
    const existing = new Set(d.ai.decisions.filter((x) => x.projectId === p.id).map((x) => x.signalKey));
    const fresh = keys.filter((k) => !existing.has(k));
    for (const signalKey of fresh)
      d.ai.decisions.push({
        id: newId('aid'),
        projectId: p.id,
        signalKey,
        decision: input.decision,
        raidId,
        decidedBy: s.user.id,
        decidedAt: now.toISOString(),
      });
    return fresh;
  },
};

/** The active AI store: Postgres + RLS when getRepo() would pick Postgres, else the demo store. */
export const aiStore = (): AiStore => (isPostgresEnabled() ? postgresAiStore() : memoryAiStore);
