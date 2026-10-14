/**
 * Critical Path Method (CPM) over a finish-to-start dependency network. Pure: no React, no dates
 * library, no I/O. Time is measured in whole days on an integer axis with EXCLUSIVE finishes, so a
 * node that starts on day 10 with a duration of 3 occupies days 10, 11 and 12 and finishes at 13.
 * Milestones are nodes with a duration of 0.
 *
 * Each node carries the earliest day it may start (its scheduled start, a "start no earlier than"
 * constraint). The forward pass pushes a node later when a predecessor finishes after that day; the
 * backward pass runs from the project finish (the latest early finish). Total float is LS − ES, and
 * a node is critical when its float is zero.
 *
 * Cycles are reported (one entry per strongly connected component, plus self-loops) and every edge
 * inside a cycle is ignored, so the rest of the network is still analysed. Edges that name an
 * unknown node are ignored too.
 */

export interface CpmNode {
  id: string;
  /** Earliest allowed start (day number). */
  start: number;
  /** Whole days; 0 for a milestone. */
  duration: number;
}

export interface CpmEdge {
  /** Optional id, echoed back in `criticalEdges` / `ignoredEdges`. Defaults to `from->to`. */
  id?: string;
  from: string;
  to: string;
}

export interface CpmNodeResult {
  id: string;
  es: number;
  ef: number;
  ls: number;
  lf: number;
  /** Total float in days (LS − ES); never negative. */
  float: number;
  critical: boolean;
}

export interface CpmResult {
  nodes: Map<string, CpmNodeResult>;
  /** Ids of critical nodes, in topological order. */
  critical: string[];
  /** Ids of edges that drive the critical path (both ends critical and ES(to) = EF(from)). */
  criticalEdges: Set<string>;
  /** Earliest start and latest finish over the whole network (0 / 0 when it is empty). */
  projectStart: number;
  projectFinish: number;
  /** Each dependency cycle as a list of node ids in edge order. */
  cycles: string[][];
  /** Edge ids that were skipped (inside a cycle, or naming an unknown node). */
  ignoredEdges: Set<string>;
}

export const edgeId = (e: CpmEdge) => e.id ?? `${e.from}->${e.to}`;

/** Tarjan's strongly connected components (iterative, so deep chains can't blow the stack). */
function stronglyConnected(ids: string[], succ: Map<string, string[]>): string[][] {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  for (const root of ids) {
    if (idx.has(root)) continue;
    const work: { v: string; i: number }[] = [{ v: root, i: 0 }];
    idx.set(root, index);
    low.set(root, index++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const top = work[work.length - 1];
      const next = succ.get(top.v) ?? [];
      if (top.i < next.length) {
        const w = next[top.i++];
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index++);
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) low.set(top.v, Math.min(low.get(top.v)!, idx.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].v;
        low.set(parent, Math.min(low.get(parent)!, low.get(top.v)!));
      }
      if (low.get(top.v) === idx.get(top.v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== top.v);
        out.push(comp);
      }
    }
  }
  return out;
}

/** Order a cycle's members by following edges inside the component, starting at its first-listed id. */
function cycleOrder(comp: string[], succ: Map<string, string[]>, order: Map<string, number>): string[] {
  const members = new Set(comp);
  const start = [...comp].sort((a, b) => order.get(a)! - order.get(b)!)[0];
  const path = [start];
  const seen = new Set([start]);
  let cur = start;
  for (;;) {
    const next = (succ.get(cur) ?? []).find((n) => members.has(n) && !seen.has(n));
    if (!next) break;
    path.push(next);
    seen.add(next);
    cur = next;
  }
  // Append any members the simple walk missed (complex components), keeping input order.
  for (const id of [...comp].sort((a, b) => order.get(a)! - order.get(b)!)) if (!seen.has(id)) path.push(id);
  return path;
}

export function computeCriticalPath(nodes: CpmNode[], edges: CpmEdge[]): CpmResult {
  const byId = new Map<string, CpmNode>();
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  const order = new Map([...byId.keys()].map((id, i) => [id, i]));
  const ignoredEdges = new Set<string>();

  // Valid edges, de-duplicated.
  const valid: CpmEdge[] = [];
  const seenEdge = new Set<string>();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) {
      ignoredEdges.add(edgeId(e));
      continue;
    }
    const k = `${e.from}\u0000${e.to}`;
    if (seenEdge.has(k)) continue;
    seenEdge.add(k);
    valid.push(e);
  }

  // Cycles: self-loops and strongly connected components with more than one node.
  const succAll = new Map<string, string[]>();
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => {
    const list = m.get(k);
    if (list) list.push(v);
    else m.set(k, [v]);
  };
  for (const e of valid) push(succAll, e.from, e.to);
  const comps = stronglyConnected([...byId.keys()], succAll);
  const compOf = new Map<string, number>();
  comps.forEach((c, i) => c.forEach((id) => compOf.set(id, i)));
  const cycles: string[][] = [];
  const cyclic = new Set<number>();
  comps.forEach((c, i) => {
    if (c.length > 1) {
      cyclic.add(i);
      cycles.push(cycleOrder(c, succAll, order));
    }
  });
  for (const e of valid)
    if (e.from === e.to && !cyclic.has(compOf.get(e.from)!)) {
      cyclic.add(compOf.get(e.from)!);
      cycles.push([e.from]);
    }
  cycles.sort((a, b) => order.get(a[0])! - order.get(b[0])!);

  // Drop edges inside a cycle; what is left is a DAG.
  const dag: CpmEdge[] = [];
  for (const e of valid) {
    if (compOf.get(e.from) === compOf.get(e.to) && cyclic.has(compOf.get(e.from)!))
      ignoredEdges.add(edgeId(e));
    else dag.push(e);
  }
  const preds = new Map<string, CpmEdge[]>();
  const succs = new Map<string, CpmEdge[]>();
  for (const e of dag) {
    push(preds, e.to, e);
    push(succs, e.from, e);
  }

  // Kahn's topological order (sources in input order, then breadth-first).
  const indeg = new Map([...byId.keys()].map((id) => [id, preds.get(id)?.length ?? 0]));
  const ready = [...byId.keys()].filter((id) => indeg.get(id) === 0);
  const topo: string[] = [];
  for (let qi = 0; qi < ready.length; qi++) {
    const id = ready[qi];
    topo.push(id);
    for (const e of succs.get(id) ?? []) {
      const d = indeg.get(e.to)! - 1;
      indeg.set(e.to, d);
      if (d === 0) ready.push(e.to);
    }
  }

  // Forward pass.
  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of topo) {
    const n = byId.get(id)!;
    let s = n.start;
    for (const e of preds.get(id) ?? []) s = Math.max(s, ef.get(e.from)!);
    es.set(id, s);
    ef.set(id, s + Math.max(0, n.duration));
  }
  let projectStart = topo.length ? Infinity : 0;
  let projectFinish = topo.length ? -Infinity : 0;
  for (const id of topo) {
    projectStart = Math.min(projectStart, es.get(id)!);
    projectFinish = Math.max(projectFinish, ef.get(id)!);
  }

  // Backward pass.
  const ls = new Map<string, number>();
  const lf = new Map<string, number>();
  for (let i = topo.length - 1; i >= 0; i--) {
    const id = topo[i];
    const n = byId.get(id)!;
    let f = projectFinish;
    for (const e of succs.get(id) ?? []) f = Math.min(f, ls.get(e.to)!);
    lf.set(id, f);
    ls.set(id, f - Math.max(0, n.duration));
  }

  const results = new Map<string, CpmNodeResult>();
  const critical: string[] = [];
  for (const id of topo) {
    const float = Math.max(0, ls.get(id)! - es.get(id)!);
    const isCritical = float === 0;
    if (isCritical) critical.push(id);
    results.set(id, {
      id,
      es: es.get(id)!,
      ef: ef.get(id)!,
      ls: ls.get(id)!,
      lf: lf.get(id)!,
      float,
      critical: isCritical,
    });
  }
  const criticalEdges = new Set<string>();
  for (const e of dag) {
    const a = results.get(e.from)!;
    const b = results.get(e.to)!;
    if (a.critical && b.critical && a.ef === b.es) criticalEdges.add(edgeId(e));
  }

  return { nodes: results, critical, criticalEdges, projectStart, projectFinish, cycles, ignoredEdges };
}
