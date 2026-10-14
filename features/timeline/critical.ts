/**
 * Builds the CPM network for the timeline and maps the result back onto bars and arrows. Pure.
 *
 * Nodes:
 *  - every epic bar (its laid-out span, so a dragged bar is analysed where it is dropped);
 *  - every other work item with a date span: its sprint's dates, else a one-day span on its due date;
 *  - a zero-duration milestone at the end of each sprint, which every item in that sprint feeds.
 * Edges: `blocks` links, finish-to-start; each item → its sprint-end milestone.
 *
 * Scope `execute` keeps only nodes in the Execute phase (gate 3: the item's phase, else its sprint's
 * phase), as the spec places the critical-path view there; `all` analyses the whole project.
 */
import { computeCriticalPath, type CpmEdge, type CpmNode } from '@/lib/domain/critical-path';
import {
  fromDay,
  toDay,
  type CriticalPathFn,
  type CriticalPathResult,
  type CriticalScope,
  type TimelineInput,
  type TimelineModel,
} from './layout';

export const EXECUTE_GATE = 3;

export interface TimelineNetwork {
  nodes: CpmNode[];
  edges: CpmEdge[];
  /** Human-readable label per node id (item key, or "<sprint> ends"). */
  labels: Map<string, string>;
}

export function timelineNetwork(
  model: Pick<TimelineModel, 'bars'>,
  input: Pick<TimelineInput, 'phases' | 'sprints' | 'items' | 'links'>,
  scope: CriticalScope,
): TimelineNetwork {
  const gateOf = new Map(input.phases.map((p) => [p.id, p.gate]));
  const sprintById = new Map(input.sprints.map((s) => [s.id, s]));
  const barById = new Map(model.bars.map((b) => [b.id, b]));
  const sprintSpan = (id: string) => {
    const bar = barById.get(id);
    if (bar) return { start: bar.start, end: bar.end };
    const s = sprintById.get(id);
    return s ? { start: s.startDate, end: s.endDate } : null;
  };
  const inScope = (phaseId?: string | null, sprintId?: string | null) => {
    if (scope === 'all') return true;
    const ph = phaseId ?? (sprintId ? sprintById.get(sprintId)?.phaseId : undefined);
    return ph ? gateOf.get(ph) === EXECUTE_GATE : false;
  };

  const nodes: CpmNode[] = [];
  const edges: CpmEdge[] = [];
  const labels = new Map<string, string>();
  const usedSprints = new Set<string>();
  const add = (id: string, start: string, end: string, label: string) => {
    nodes.push({ id, start: toDay(start), duration: toDay(end) - toDay(start) + 1 });
    labels.set(id, label);
  };

  for (const item of input.items) {
    if (!inScope(item.phaseId, item.sprintId)) continue;
    if (item.type === 'epic') {
      const bar = barById.get(item.id);
      if (bar) add(item.id, bar.start, bar.end, item.key);
      continue;
    }
    const span = item.sprintId ? sprintSpan(item.sprintId) : null;
    if (span) {
      add(item.id, span.start, span.end, item.key);
      usedSprints.add(item.sprintId!);
      edges.push({ id: `ms:${item.id}`, from: item.id, to: `ms_${item.sprintId}` });
    } else if (item.dueDate) {
      const due = item.dueDate.slice(0, 10);
      add(item.id, due, due, item.key);
    }
  }
  for (const id of usedSprints) {
    const span = sprintSpan(id)!;
    nodes.push({ id: `ms_${id}`, start: toDay(span.end) + 1, duration: 0 });
    labels.set(`ms_${id}`, `${sprintById.get(id)?.name ?? 'Sprint'} ends`);
  }
  for (const l of input.links) if (l.type === 'blocks') edges.push({ id: l.id, from: l.fromId, to: l.toId });
  return { nodes, edges, labels };
}

/** The timeline's critical-path function (wired into `<TimelineView criticalPath={…} />`). */
export const timelineCriticalPath: CriticalPathFn = (model, input, { scope }): CriticalPathResult => {
  const net = timelineNetwork(model, input, scope);
  const r = computeCriticalPath(net.nodes, net.edges);
  const barIds = new Set(model.bars.map((b) => b.id));
  const arrowIds = new Set(model.arrows.map((a) => a.id));
  const bars = new Set(r.critical.filter((id) => barIds.has(id)));
  const float = new Map<string, number>();
  for (const id of barIds) {
    const n = r.nodes.get(id);
    if (n) float.set(id, n.float);
  }
  const chain = r.critical
    .filter((id) => barIds.has(id))
    .sort((a, b) => {
      const x = r.nodes.get(a)!;
      const y = r.nodes.get(b)!;
      return x.es - y.es || x.ef - y.ef;
    });
  return {
    bars,
    arrows: new Set([...r.criticalEdges].filter((id) => arrowIds.has(id))),
    float,
    cycles: r.cycles.map((c) => c.map((id) => net.labels.get(id) ?? id)),
    chain: chain.map((id) => net.labels.get(id) ?? id),
    finish: net.nodes.length ? fromDay(r.projectFinish - 1) : undefined,
  };
};
