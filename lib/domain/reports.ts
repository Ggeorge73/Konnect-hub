import type { Phase, Profile, Project, Rag, Sprint, Visibility, WorkItem } from './types';
import type { RaidEntry } from './raid';
import { riskScore, scoreBand, BAND_LABEL, ESCALATION_THRESHOLD } from './raid';
import type { GateReview } from './gates';
import type { Deliverable } from './deliverables';
import { canManageProject, isInternalRole } from './permissions';
import { addDays, isDone, isFlowItem, isoDay, statusAt, historyByItem, type StatusChange } from './metrics';
import { STATUS_LABEL } from './workflow';
import { GATE_NAMES } from './templates';

/**
 * Weekly status report (RPT-01, CLAUDE.md 3.6). Pure rules: draft generation, RAG suggestion,
 * and the client-safe copy made at publish. No I/O and no clock reads.
 */

export type ReportSectionId = 'scope' | 'schedule' | 'budget' | 'risks' | 'decisions' | 'next_steps';
export type ReportSections = Record<ReportSectionId, string>;
export type ReportStatus = 'draft' | 'published';

export const REPORT_SECTIONS: { id: ReportSectionId; label: string; internalOnly?: boolean }[] = [
  { id: 'scope', label: 'Scope' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'budget', label: 'Budget', internalOnly: true },
  { id: 'risks', label: 'Risks' },
  { id: 'decisions', label: 'Decisions needed' },
  { id: 'next_steps', label: 'Next steps' },
];

export interface RemovalEntry {
  kind: 'budget' | 'item' | 'raid';
  /** 'rag' = the RAG reason named an internal entry and was replaced. */
  section: ReportSectionId | 'rag';
  label: string;
}

export interface StatusReport {
  id: string;
  projectId: string;
  /** Monday of the reporting week (YYYY-MM-DD). */
  weekStart: string;
  /** Friday of the reporting week. */
  weekEnd: string;
  status: ReportStatus;
  rag: Rag;
  ragReason: string;
  /** Internal working copy (Tiptap HTML per section). Never served to client users. */
  sections: ReportSections;
  /** Lead's choice at publish: include the budget section in the client copy. */
  shareBudget: boolean;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  publishedBy: string | null;
  /** Client copy frozen at publish: the only content client users ever receive. */
  clientSections: Partial<ReportSections> | null;
  /** RAG reason as shown to the client (internal references replaced). */
  clientRagReason: string | null;
  /** What the publish step removed from the client copy (internal record). */
  removed: RemovalEntry[];
}

export const reportWeekEnd = (weekStart: string) => addDays(weekStart, 4);

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/** Every internal user on the project may generate and edit drafts. */
export const canDraftReports = (user: Profile) => isInternalRole(user.role);
/** Only the project's Delivery Lead or an Admin publishes to the client. */
export const canPublishReport = (user: Profile, project: Project) => canManageProject(user, project);

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ul = (rows: string[], empty: string) =>
  rows.length ? `<ul>${rows.map((r) => `<li><p>${r}</p></li>`).join('')}</ul>` : `<p>${empty}</p>`;
const heading = (s: string) => `<p><strong>${s}</strong></p>`;
const fmtDay = (day: string) =>
  new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const money = (n: number) => `$${n.toLocaleString('en-US')}`;

// ---------------------------------------------------------------------------
// RAG suggestion
// ---------------------------------------------------------------------------

type RagRaid = Pick<
  RaidEntry,
  'kind' | 'status' | 'title' | 'probability' | 'impact' | 'severity' | 'slaDue'
>;
const RAG_RANK: Record<Rag, number> = { green: 0, amber: 1, red: 2 };

/**
 * Suggested RAG: the project's own RAG, raised to Red by an open critical issue past its SLA and to
 * Amber by an open risk at or above the steering threshold. The Lead can override it in the draft.
 */
export function suggestRag(
  project: Pick<Project, 'rag' | 'ragReason'>,
  raid: RagRaid[],
  now: Date,
): { rag: Rag; reason: string } {
  const open = raid.filter((r) => r.status !== 'closed');
  const breached = open.find(
    (r) =>
      r.kind === 'issue' &&
      r.severity === 'critical' &&
      r.slaDue &&
      new Date(r.slaDue).getTime() < now.getTime(),
  );
  if (breached) return { rag: 'red', reason: `Critical issue past its SLA: ${breached.title}` };
  const escalated = open
    .filter((r) => r.kind === 'risk' && (riskScore(r.probability, r.impact) ?? 0) >= ESCALATION_THRESHOLD)
    .sort((a, b) => (riskScore(b.probability, b.impact) ?? 0) - (riskScore(a.probability, a.impact) ?? 0))[0];
  if (escalated && RAG_RANK[project.rag] < RAG_RANK.amber)
    return { rag: 'amber', reason: `Risk at steering level: ${escalated.title}` };
  return {
    rag: project.rag,
    reason: project.ragReason ?? (escalated ? `Risk at steering level: ${escalated.title}` : 'On plan.'),
  };
}

// ---------------------------------------------------------------------------
// Draft generation
// ---------------------------------------------------------------------------

export type DraftItem = Pick<
  WorkItem,
  | 'id'
  | 'key'
  | 'title'
  | 'type'
  | 'status'
  | 'estimate'
  | 'sprintId'
  | 'createdAt'
  | 'deletedAt'
  | 'dueDate'
  | 'visibility'
>;
export type DraftRaid = RagRaid &
  Pick<RaidEntry, 'id' | 'visibility' | 'createdAt' | 'updatedAt' | 'escalatedAt' | 'date' | 'description'>;

export interface DraftInput {
  project: Pick<Project, 'key' | 'name' | 'rag' | 'ragReason' | 'bac' | 'contractType' | 'targetDate'>;
  weekStart: string;
  items: DraftItem[];
  history: StatusChange[];
  sprints: Sprint[];
  phases: Phase[];
  raid: DraftRaid[];
  gateReviews: Pick<GateReview, 'gate' | 'status' | 'requestedAt'>[];
  deliverables: Pick<Deliverable, 'name' | 'status' | 'dueDate' | 'visibility'>[];
  now: Date;
}

const CONTRACT_LABEL: Record<Project['contractType'], string> = {
  fixed_fee: 'fixed fee',
  time_materials: 'time and materials',
  retainer: 'retainer',
};

const itemLine = (i: DraftItem) =>
  `${escapeHtml(i.key)} ${escapeHtml(i.title)}${i.estimate ? ` (${i.estimate} pts)` : ''}`;

/**
 * Builds the weekly draft from that week's activity. Internal items and RAID entries are included
 * (the draft is internal); `redactForClient` strips them when the report is published.
 */
export function buildStatusDraft(input: DraftInput): {
  rag: Rag;
  ragReason: string;
  sections: ReportSections;
} {
  const { project, weekStart, history, sprints, phases, raid, gateReviews, deliverables, now } = input;
  const from = weekStart + 'T00:00:00.000Z';
  const to = addDays(weekStart, 7) + 'T00:00:00.000Z';
  const nextFrom = addDays(weekStart, 7);
  const nextTo = addDays(weekStart, 13);
  const items = input.items.filter(isFlowItem);
  const byItem = historyByItem(history);

  // Scope: completed and added this week.
  const doneIds = new Set(
    history.filter((c) => c.at >= from && c.at < to && isDone(c.to) && !isDone(c.from)).map((c) => c.itemId),
  );
  const completed = items.filter((i) => doneIds.has(i.id));
  const added = items.filter((i) => i.createdAt >= from && i.createdAt < to);
  const pts = completed.reduce((t, i) => t + (i.estimate ?? 0), 0);
  const scope = [
    heading(`Completed this week: ${plural(completed.length, 'item')}, ${pts} points`),
    ul(completed.map(itemLine), 'No items were completed this week.'),
    heading(`Added this week: ${plural(added.length, 'item')}`),
    ul(
      added.map((i) => `${itemLine(i)} — ${STATUS_LABEL[i.status]}`),
      'No new items were added to scope this week.',
    ),
  ].join('');

  // Schedule: sprint progress and milestones.
  const endOfWeek = to;
  const active =
    sprints.find((s) => s.status === 'active') ??
    sprints.find((s) => s.startDate <= isoDay(to) && s.endDate >= weekStart);
  const schedule: string[] = [];
  if (active) {
    const scopeItems = items.filter((i) => i.sprintId === active.id);
    const total = scopeItems.reduce((t, i) => t + (i.estimate ?? 0), 0);
    const done = scopeItems
      .filter((i) => isDone(statusAt(i, byItem.get(i.id), endOfWeek)))
      .reduce((t, i) => t + (i.estimate ?? 0), 0);
    const pct = total ? Math.round((done / total) * 100) : 0;
    schedule.push(
      `<p>${escapeHtml(active.name)} (${fmtDay(active.startDate)} – ${fmtDay(active.endDate)}): ${done} of ${total} points done (${pct}%).${active.goal ? ` Sprint goal: ${escapeHtml(active.goal)}.` : ''}</p>`,
    );
  } else schedule.push('<p>No sprint is running this week.</p>');
  const ordered = [...phases].sort((a, b) => a.gate - b.gate);
  const current = ordered.find((p) => p.status !== 'approved' && p.status !== 'approved_with_conditions');
  const milestones: string[] = [];
  if (current)
    milestones.push(
      `Gate ${current.gate} · ${escapeHtml(current.name || GATE_NAMES[current.gate])} review${current.endDate ? ` planned for ${fmtDay(current.endDate)}` : ''}`,
    );
  const horizon = addDays(weekStart, 35);
  for (const d of deliverables)
    if (d.dueDate && d.dueDate >= weekStart && d.dueDate <= horizon && d.status !== 'accepted')
      milestones.push(`Deliverable: ${escapeHtml(d.name)} due ${fmtDay(d.dueDate)}`);
  milestones.push(`Project target date: ${fmtDay(project.targetDate)}`);
  schedule.push(heading('Milestones'), ul(milestones, 'No milestones in the next five weeks.'));

  // Budget: internal only unless the Lead shares it at publish.
  const work = items.length;
  const finished = items.filter((i) => isDone(i.status)).length;
  const budget = [
    `<p>Budget at completion: ${money(project.bac)} (${CONTRACT_LABEL[project.contractType]}).</p>`,
    `<p>Work complete: ${work ? Math.round((finished / work) * 100) : 0}% of ${plural(work, 'item')}.</p>`,
  ].join('');

  // Risks: top open risks, plus new or escalated this week.
  const openRisks = raid
    .filter((r) => r.kind === 'risk' && r.status !== 'closed')
    .map((r) => ({ r, score: riskScore(r.probability, r.impact) ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const riskLine = ({ r, score }: { r: DraftRaid; score: number }) =>
    `${escapeHtml(r.title)} — score ${score} (${BAND_LABEL[scoreBand(score)]})`;
  const inWeek = (iso?: string | null) => Boolean(iso && iso >= from && iso < to);
  const fresh = openRisks.filter(
    ({ r, score }) =>
      inWeek(r.createdAt) || inWeek(r.escalatedAt) || (score >= ESCALATION_THRESHOLD && inWeek(r.updatedAt)),
  );
  const openIssues = raid.filter((r) => r.kind === 'issue' && r.status !== 'closed' && inWeek(r.createdAt));
  const risks = [
    heading('Top open risks'),
    ul(openRisks.slice(0, 3).map(riskLine), 'No open risks.'),
    heading('New or escalated this week'),
    ul(
      [
        ...fresh.map(riskLine),
        ...openIssues.map((r) => `Issue: ${escapeHtml(r.title)}${r.severity ? ` (${r.severity})` : ''}`),
      ],
      'No new or escalated risks this week.',
    ),
  ].join('');

  // Decisions needed: open RAID decisions, pending gate reviews, deliverables awaiting acceptance.
  const decisionRows = [
    ...raid
      .filter((r) => r.kind === 'decision' && r.status !== 'closed')
      .map((r) => `Decision: ${escapeHtml(r.title)}${r.date ? ` (needed by ${fmtDay(r.date)})` : ''}`),
    ...gateReviews
      .filter((g) => g.status === 'pending')
      .map(
        (g) =>
          `Gate ${g.gate} · ${GATE_NAMES[g.gate as 1 | 2 | 3 | 4 | 5] ?? ''} review awaiting the sponsor’s decision (requested ${fmtDay(isoDay(g.requestedAt))})`,
      ),
    ...deliverables
      .filter((d) => d.status === 'submitted')
      .map((d) => `Deliverable awaiting acceptance: ${escapeHtml(d.name)}`),
  ];
  const decisions = ul(decisionRows, 'No decisions are needed this week.');

  // Next steps: items due next week, and the next sprint if it starts next week.
  const due = items.filter(
    (i) => i.dueDate && i.dueDate >= nextFrom && i.dueDate <= nextTo && !isDone(i.status),
  );
  const nextSprint = sprints.find(
    (s) => s.status === 'planned' && s.startDate >= nextFrom && s.startDate <= nextTo,
  );
  const nextRows = due.map((i) => `${itemLine(i)} — due ${fmtDay(i.dueDate!)}`);
  if (nextSprint) {
    const planned = items.filter((i) => i.sprintId === nextSprint.id && !isDone(i.status));
    nextRows.push(
      `Start ${escapeHtml(nextSprint.name)} on ${fmtDay(nextSprint.startDate)}${nextSprint.goal ? ` — ${escapeHtml(nextSprint.goal)}` : ''} (${plural(planned.length, 'item')} planned)`,
    );
    nextRows.push(...planned.slice(0, 5).map(itemLine));
  }
  const nextSteps = ul(nextRows, 'No items are due next week.');

  const rag = suggestRag(project, raid, now);
  return {
    rag: rag.rag,
    ragReason: rag.reason,
    sections: { scope, schedule: schedule.join(''), budget, risks, decisions, next_steps: nextSteps },
  };
}

// ---------------------------------------------------------------------------
// Client copy at publish
// ---------------------------------------------------------------------------

type Node = { tag: string; open: string; close: string; children: Node[] } | string;
const VOID = new Set(['br', 'hr', 'img']);
const BLOCKS = new Set(['li', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre']);
const LISTS = new Set(['ul', 'ol']);

function parse(html: string): Node[] {
  const root: Node[] = [];
  const stack: { tag: string; open: string; children: Node[] }[] = [];
  const push = (n: Node) => (stack.length ? stack[stack.length - 1].children : root).push(n);
  const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|[^<]+|</g;
  for (const m of html.matchAll(re)) {
    const tok = m[0];
    const tag = m[1]?.toLowerCase();
    if (!tag) push(tok);
    else if (tok.startsWith('</')) {
      const idx = stack.map((s) => s.tag).lastIndexOf(tag);
      if (idx === -1) continue;
      while (stack.length > idx) {
        const el = stack.pop()!;
        push({ tag: el.tag, open: el.open, close: `</${el.tag}>`, children: el.children });
      }
    } else if (VOID.has(tag) || tok.endsWith('/>')) push({ tag, open: tok, close: '', children: [] });
    else stack.push({ tag, open: tok, children: [] });
  }
  while (stack.length) {
    const el = stack.pop()!;
    push({ tag: el.tag, open: el.open, close: `</${el.tag}>`, children: el.children });
  }
  return root;
}

const serialize = (nodes: Node[]): string =>
  nodes.map((n) => (typeof n === 'string' ? n : n.open + serialize(n.children) + n.close)).join('');

/** Tags kept in the client copy (Tiptap StarterKit output). Attributes are always dropped. */
const ALLOWED = new Set([
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'code',
  'pre',
  'blockquote',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);
/** Tags dropped with everything inside them. Any other tag is unwrapped (its text kept). */
const DROPPED = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'template',
  'noscript',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'link',
  'meta',
  'base',
  'frame',
  'frameset',
]);

/**
 * Allow-list sanitizer for HTML that is rendered in the client portal: known formatting tags
 * only, no attributes (so no handlers, styles or URLs), stray `<` escaped.
 */
function sanitize(nodes: Node[]): Node[] {
  return nodes.flatMap((n): Node[] => {
    if (typeof n === 'string') return [n.replace(/</g, '&lt;').replace(/>/g, '&gt;')];
    if (DROPPED.has(n.tag)) return [];
    const children = sanitize(n.children);
    if (!ALLOWED.has(n.tag)) return children;
    const isVoid = VOID.has(n.tag);
    return [
      {
        tag: n.tag,
        open: `<${n.tag}>`,
        close: isVoid ? '' : `</${n.tag}>`,
        children: isVoid ? [] : children,
      },
    ];
  });
}

/** Sanitized HTML (see `sanitize`), for anything shown to client users. */
export const sanitizeHtml = (html: string) => serialize(sanitize(parse(html)));

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** Text of a node, without nested lists (so a parent bullet is judged on its own words). */
function ownText(n: Node): string {
  if (typeof n === 'string') return decode(n);
  if (LISTS.has(n.tag)) return '';
  return n.children.map(ownText).join('');
}

export interface InternalRefs {
  items: { key: string; title: string }[];
  raid: { kind: string; title: string }[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The internal item or RAID entry a block of text refers to, or null. */
function internalMatch(text: string, refs: InternalRefs): { kind: 'item' | 'raid'; label: string } | null {
  const lower = text.toLowerCase();
  for (const i of refs.items) {
    const keyRe = new RegExp(`(^|[^A-Za-z0-9-])${escapeRe(i.key)}(?![0-9])`, 'i');
    if (keyRe.test(text) || (i.title.trim().length >= 8 && lower.includes(i.title.trim().toLowerCase())))
      return { kind: 'item', label: `${i.key} ${i.title}` };
  }
  for (const r of refs.raid)
    if (r.title.trim().length >= 4 && lower.includes(r.title.trim().toLowerCase()))
      return { kind: 'raid', label: `${r.kind[0].toUpperCase()}${r.kind.slice(1)}: ${r.title}` };
  return null;
}

function strip(
  nodes: Node[],
  refs: InternalRefs,
  onRemove: (kind: 'item' | 'raid', label: string) => void,
): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (typeof n === 'string') {
      out.push(n);
      continue;
    }
    if (BLOCKS.has(n.tag)) {
      const hit = internalMatch(ownText(n), refs);
      if (hit) {
        onRemove(hit.kind, hit.label);
        continue;
      }
    }
    const children = strip(n.children, refs, onRemove);
    if (LISTS.has(n.tag) && !children.some((c) => typeof c !== 'string')) continue;
    out.push({ ...n, children });
  }
  return out;
}

/**
 * The client copy of a report: drops the budget section unless shared, and every paragraph or
 * bullet that names an internal work item (by key or title) or an internal RAID entry (by title).
 * Returns what was removed so the Lead sees it in the pre-publish checklist.
 */
/** Generic RAG reason used when the Lead's reason names internal content. */
export const CLIENT_RAG_FALLBACK = 'See the risks and schedule sections for detail.';

export function redactForClient(
  sections: ReportSections,
  refs: InternalRefs,
  shareBudget: boolean,
  ragReason = '',
): { sections: Partial<ReportSections>; ragReason: string; removed: RemovalEntry[] } {
  const removed: RemovalEntry[] = [];
  const ragHit = internalMatch(ragReason, refs);
  if (ragHit) removed.push({ kind: ragHit.kind, section: 'rag', label: `RAG reason: ${ragHit.label}` });
  const out: Partial<ReportSections> = {};
  for (const { id } of REPORT_SECTIONS) {
    if (id === 'budget' && !shareBudget) {
      removed.push({ kind: 'budget', section: 'budget', label: 'Budget section (internal only)' });
      continue;
    }
    const seen = new Set<string>();
    out[id] = serialize(
      sanitize(
        strip(parse(sections[id] ?? ''), refs, (kind, label) => {
          if (seen.has(label)) return;
          seen.add(label);
          removed.push({ kind, section: id, label });
        }),
      ),
    );
  }
  return { sections: out, ragReason: ragHit ? CLIENT_RAG_FALLBACK : ragReason, removed };
}

/** Internal items and RAID entries of a project, as references for `redactForClient`. */
export function internalRefs(
  items: { key: string; title: string; visibility: Visibility; deletedAt?: string | null }[],
  raid: { kind: string; title: string; visibility: Visibility }[],
): InternalRefs {
  return {
    items: items.filter((i) => i.visibility === 'internal').map(({ key, title }) => ({ key, title })),
    raid: raid.filter((r) => r.visibility === 'internal').map(({ kind, title }) => ({ kind, title })),
  };
}
