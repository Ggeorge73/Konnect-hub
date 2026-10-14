import 'server-only';
import type { z } from 'zod';
import type { CreateItemInput, Repo } from '../data/repo';
import type { Session, WorkItem } from '../domain/types';
import { canEditItems, isClientRole } from '../domain/permissions';
import {
  AI_FEATURE_LABEL,
  canUseAiFeature,
  detectRiskSignals,
  MAX_SIGNALS_PER_RUN,
  SUMMARY_MIN_COMMENTS,
  undecidedSignals,
  type AiFeature,
} from '../domain/ai';
import { escapeHtml, sanitizeHtml, type ReportSections } from '../domain/reports';
import { isoDay } from '../domain/metrics';
import type { RiskCategory, RaidView } from '../domain/raid';
import { aiStore, checkDecision } from '../data/ai';
import { recordAudit } from '../data/audit';
import { getReport } from '../data/reports';
import { createRaid } from '../data/raid';
import { ForbiddenError, ValidationError } from '../data/errors';
import { aiAvailability, getAiClient } from './provider';
import { aiRateLimiter } from './rate-limit';
import { AiDisabledError, AiRateLimitedError, AiUnavailableError } from './errors';
import {
  buildMeetingNotesPrompt,
  buildRiskPrompt,
  buildStatusDraftPrompt,
  buildThreadSummaryPrompt,
  commentsFor,
  sectionIdsOf,
} from './prompts';
import {
  meetingNotesOutput,
  parseModelJson,
  riskSuggestionsOutput,
  statusDraftOutput,
  threadSummaryOutput,
} from './schemas';
import type { AiClient, AiRequest, AiResponse } from './types';
import type {
  AiMeta,
  AiStatus,
  MeetingNotesResult,
  ProposedItem,
  RiskSuggestion,
  RiskSuggestionsResult,
  StatusDraftResult,
  ThreadSummaryResult,
} from './views';

export type * from './views';

/**
 * AI assist use cases (KH-42..44). Each one: checks who may use it and that AI is on for the
 * project, takes a rate-limit token, builds the prompt from data the caller may see, calls the
 * provider, validates the JSON, and writes an `ai.call` audit entry (feature, model, tokens; never
 * the prompt). Nothing here writes project data: results are drafts. The accept endpoints are
 * separate, human actions that go through the normal stores (createRaid, createItem, reports).
 */

export async function getAiStatus(s: Session, projectKey: string): Promise<AiStatus> {
  const st = await aiStore().getSettings(s, projectKey);
  const a = aiAvailability();
  return {
    ...st,
    provider: a.kind,
    model: a.kind === 'unavailable' ? null : a.model,
    note: a.kind === 'anthropic' ? null : a.reason,
    canUse: {
      status_report: canUseAiFeature(s.user, 'status_report'),
      risk_suggestions: canUseAiFeature(s.user, 'risk_suggestions'),
      meeting_notes: canUseAiFeature(s.user, 'meeting_notes'),
      thread_summary: canUseAiFeature(s.user, 'thread_summary'),
    },
  };
}

export async function setAiEnabled(s: Session, projectKey: string, enabled: boolean): Promise<AiStatus> {
  await aiStore().setEnabled(s, projectKey, enabled);
  return getAiStatus(s, projectKey);
}

/** Permission, switch and provider checks (no rate token yet). */
async function check(s: Session, projectKeyOrId: string, feature: AiFeature) {
  const settings = await aiStore().getSettings(s, projectKeyOrId);
  if (!canUseAiFeature(s.user, feature))
    throw new ForbiddenError(`${AI_FEATURE_LABEL[feature]} is not available to your role.`);
  if (!settings.enabled) throw new AiDisabledError();
  const client = getAiClient();
  if (!client) {
    const a = aiAvailability();
    throw new AiUnavailableError(a.kind === 'unavailable' ? a.reason : 'AI assist is unavailable.');
  }
  return { settings, client };
}

function takeToken(s: Session) {
  const r = aiRateLimiter().take(s.user.id);
  if (!r.ok) throw new AiRateLimitedError(r.retryAfterSeconds);
}

/** Calls the model, validates its JSON, and audits the call whatever the outcome. */
async function callModel<T>(
  s: Session,
  projectId: string,
  client: AiClient,
  req: AiRequest,
  schema: z.ZodType<T>,
): Promise<{ out: T; meta: AiMeta }> {
  let res: AiResponse | undefined;
  let outcome = 'error';
  try {
    res = await client.complete(req);
    const out = parseModelJson(res.text, schema);
    outcome = 'ok';
    return { out, meta: { provider: client.provider, model: res.model } };
  } catch (e) {
    if (res) outcome = 'invalid_output';
    throw e;
  } finally {
    await recordAudit(s, {
      action: 'ai.call',
      entity: 'ai',
      entityId: req.feature,
      projectId,
      after: {
        feature: req.feature,
        provider: client.provider,
        model: res?.model ?? client.model,
        inputTokens: res?.inputTokens ?? 0,
        outputTokens: res?.outputTokens ?? 0,
        outcome,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// KH-42 Status report draft
// ---------------------------------------------------------------------------

export async function draftStatusReport(s: Session, reportId: string): Promise<StatusDraftResult> {
  const r = await getReport(s, reportId);
  if (!r.canEdit) throw new ForbiddenError('Only the delivery team can draft an unpublished report.');
  const { settings, client } = await check(s, r.projectKey, 'status_report');
  takeToken(s);
  // The report is internal (drafts never reach clients); publish redacts it for the client copy.
  const req = buildStatusDraftPrompt(
    {
      projectKey: r.projectKey,
      projectName: r.projectName,
      weekStart: r.weekStart,
      weekEnd: r.weekEnd,
      rag: r.rag,
      ragReason: r.ragReason,
      sections: r.sections,
    },
    { forClient: false },
  );
  const allowed = new Set(sectionIdsOf(req));
  const { out, meta } = await callModel(s, settings.projectId, client, req, statusDraftOutput);
  const sections: Partial<ReportSections> = {};
  for (const sec of out.sections) if (allowed.has(sec.id)) sections[sec.id] = sanitizeHtml(sec.html);
  return { reportId: r.id, sections, ...meta };
}

// ---------------------------------------------------------------------------
// KH-43 Risk suggestions
// ---------------------------------------------------------------------------

export async function suggestRisks(
  s: Session,
  projectKey: string,
  opts: { lookaheadDays?: number; now?: Date } = {},
): Promise<RiskSuggestionsResult> {
  const { settings, client } = await check(s, projectKey, 'risk_suggestions');
  const now = opts.now ?? new Date();
  const inputs = await aiStore().riskInputs(s, projectKey);
  const signals = undecidedSignals(
    detectRiskSignals({ ...inputs, now, lookaheadDays: opts.lookaheadDays }),
    inputs.decided,
  ).slice(0, MAX_SIGNALS_PER_RUN);
  if (!signals.length) return { signals, suggestions: [], meta: null };
  takeToken(s);
  const req = buildRiskPrompt(
    {
      projectKey: inputs.project.key,
      projectName: inputs.project.name,
      signals,
      items: inputs.items,
      today: isoDay(now),
    },
    { forClient: false },
  );
  const { out, meta } = await callModel(s, settings.projectId, client, req, riskSuggestionsOutput);
  const byKey = new Map(signals.map((x) => [x.key, x]));
  const claimed = new Set<string>();
  const suggestions: RiskSuggestion[] = [];
  for (const sug of out.suggestions) {
    const keys = [...new Set(sug.signalKeys)].filter((k) => byKey.has(k) && !claimed.has(k)).sort();
    if (!keys.length) continue;
    keys.forEach((k) => claimed.add(k));
    const itemKeys = new Set(keys.flatMap((k) => byKey.get(k)!.itemKeys));
    suggestions.push({
      id: keys.join('|'),
      title: sug.title,
      category: sug.category,
      probability: sug.probability,
      impact: sug.impact,
      mitigation: sug.mitigation,
      signalKeys: keys,
      linkedItemKeys: [...new Set(sug.linkedItemKeys.map((k) => k.toUpperCase()))].filter((k) =>
        itemKeys.has(k),
      ),
      because: keys.map((k) => byKey.get(k)!.detail),
    });
  }
  return { signals, suggestions, meta };
}

export interface AcceptRiskInput {
  title: string;
  category: RiskCategory;
  probability: number;
  impact: number;
  mitigation: string;
  signalKeys: string[];
  linkedItemKeys: string[];
}

/** A person accepts a suggestion: an internal risk is created (linked to the items) and recorded. */
export async function acceptRiskSuggestion(
  s: Session,
  projectKey: string,
  input: AcceptRiskInput,
): Promise<RaidView> {
  if (!canUseAiFeature(s.user, 'risk_suggestions'))
    throw new ForbiddenError('Risk suggestions are for the delivery team.');
  checkDecision({ signalKeys: input.signalKeys, decision: 'accepted' });
  const raid = await createRaid(s, {
    projectId: projectKey,
    kind: 'risk',
    title: input.title,
    description: 'Logged from an AI risk suggestion and reviewed before saving.',
    category: input.category,
    probability: input.probability,
    impact: input.impact,
    mitigation: input.mitigation,
    ownerId: s.user.id,
    status: 'open',
    roam: 'owned',
    visibility: 'internal',
    linkedItemIds: input.linkedItemKeys,
  });
  await aiStore().recordDecision(s, projectKey, {
    signalKeys: input.signalKeys,
    decision: 'accepted',
    raidId: raid.id,
  });
  return raid;
}

export async function dismissRiskSuggestion(s: Session, projectKey: string, signalKeys: string[]) {
  if (!canUseAiFeature(s.user, 'risk_suggestions'))
    throw new ForbiddenError('Risk suggestions are for the delivery team.');
  const recorded = await aiStore().recordDecision(s, projectKey, { signalKeys, decision: 'dismissed' });
  return { dismissed: recorded };
}

// ---------------------------------------------------------------------------
// KH-44 Meeting notes → items
// ---------------------------------------------------------------------------

/** People who can be assigned from notes: the project's lead and members (internal). */
async function assignable(s: Session, repo: Repo, projectKey: string) {
  const b = await repo.getProjectBundle(s, projectKey);
  const ids = new Set([
    b.project.leadId,
    ...b.members.filter((m) => m.projectId === b.project.id).map((m) => m.userId),
  ]);
  return {
    project: b.project,
    members: b.people
      .filter((p) => ids.has(p.id))
      .map((p) => ({ id: p.id, name: p.name }))
      .sort((a, c) => a.name.localeCompare(c.name)),
  };
}

export async function extractMeetingNotes(
  s: Session,
  repo: Repo,
  projectKey: string,
  notes: string,
  now: Date = new Date(),
): Promise<MeetingNotesResult> {
  const { settings, client } = await check(s, projectKey, 'meeting_notes');
  if (!notes.trim()) throw new ValidationError('Paste some meeting notes first.');
  const { project, members } = await assignable(s, repo, projectKey);
  takeToken(s);
  const req = buildMeetingNotesPrompt({
    projectKey: project.key,
    projectName: project.name,
    notes,
    members,
    today: isoDay(now),
  });
  const { out, meta } = await callModel(s, settings.projectId, client, req, meetingNotesOutput);
  const ok = new Set(members.map((m) => m.id));
  return {
    items: out.items.map((i) => ({
      ...i,
      assigneeId: i.assigneeId && ok.has(i.assigneeId) ? i.assigneeId : null,
    })),
    members,
    ...meta,
  };
}

/** The user ticked these rows: create them as internal backlog items, one createItem each. */
export async function createItemsFromNotes(
  s: Session,
  repo: Repo,
  projectKey: string,
  rows: ProposedItem[],
): Promise<WorkItem[]> {
  if (!canEditItems(s.user)) throw new ForbiddenError('You cannot create items in this project.');
  if (!rows.length) throw new ValidationError('Tick at least one item to create.');
  const { project, members } = await assignable(s, repo, projectKey);
  const ok = new Set(members.map((m) => m.id));
  for (const r of rows)
    if (r.assigneeId && !ok.has(r.assigneeId))
      throw new ValidationError('Assignees must be members of this project.');
  const created: WorkItem[] = [];
  for (const r of rows) {
    const input: CreateItemInput = {
      projectId: project.id,
      type: r.type,
      title: r.title,
      description: r.description.trim() ? `<p>${escapeHtml(r.description.trim())}</p>` : '',
      priority: r.priority,
      assigneeId: r.assigneeId,
      dueDate: r.dueDate,
      status: 'backlog',
      visibility: 'internal',
    };
    created.push(await repo.createItem(s, input));
  }
  return created;
}

// ---------------------------------------------------------------------------
// KH-44 Thread summary
// ---------------------------------------------------------------------------

export async function summarizeThread(s: Session, repo: Repo, itemKey: string): Promise<ThreadSummaryResult> {
  const detail = await repo.getItem(s, itemKey);
  const { settings, client } = await check(s, detail.item.projectId, 'thread_summary');
  const forClient = isClientRole(s.user.role);
  const people = await repo.listPeople(s);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? 'Someone';
  const thread = detail.comments.map((c) => ({
    author: nameOf(c.authorId),
    body: c.body,
    visibility: c.visibility,
    at: c.createdAt,
  }));
  const visible = commentsFor(thread, forClient);
  if (visible.length < SUMMARY_MIN_COMMENTS)
    throw new ValidationError(
      `Summaries are for threads with more than ${SUMMARY_MIN_COMMENTS - 1} comments.`,
    );
  takeToken(s);
  const req = buildThreadSummaryPrompt(
    { itemKey: detail.item.key, itemTitle: detail.item.title, comments: thread },
    { forClient },
  );
  const { out, meta } = await callModel(s, settings.projectId, client, req, threadSummaryOutput);
  return {
    itemKey: detail.item.key,
    summary: out.summary,
    keyPoints: out.keyPoints,
    commentCount: visible.length,
    scope: forClient ? 'shared' : 'all',
    ...meta,
  };
}
