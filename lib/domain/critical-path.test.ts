import { describe, expect, it } from 'vitest';
import { computeCriticalPath, type CpmEdge, type CpmNode } from './critical-path';

const n = (id: string, duration: number, start = 0): CpmNode => ({ id, start, duration });
const e = (from: string, to: string, id?: string): CpmEdge => ({ from, to, ...(id ? { id } : {}) });
const pick = (r: ReturnType<typeof computeCriticalPath>, id: string) => {
  const x = r.nodes.get(id)!;
  return [x.es, x.ef, x.ls, x.lf, x.float];
};

describe('computeCriticalPath', () => {
  // Hand-worked network (days, exclusive finish):
  //   A(3) → B(2) → D(5) → F(2)
  //   A(3) → C(4) → E(1) → F
  // Forward:  A 0–3, B 3–5, C 3–7, D 5–10, E 7–8, F 10–12.  Finish = 12.
  // Backward: F 10–12, D 5–10, E 9–10, B 3–5, C 5–9, A 0–3.
  // Float:    A 0, B 0, C 2, D 0, E 2, F 0  →  critical path A → B → D → F.
  it('matches a hand-worked network', () => {
    const r = computeCriticalPath(
      [n('A', 3), n('B', 2), n('C', 4), n('D', 5), n('E', 1), n('F', 2)],
      [
        e('A', 'B', 'ab'),
        e('A', 'C', 'ac'),
        e('B', 'D', 'bd'),
        e('C', 'E', 'ce'),
        e('D', 'F', 'df'),
        e('E', 'F', 'ef'),
      ],
    );
    expect(pick(r, 'A')).toEqual([0, 3, 0, 3, 0]);
    expect(pick(r, 'B')).toEqual([3, 5, 3, 5, 0]);
    expect(pick(r, 'C')).toEqual([3, 7, 5, 9, 2]);
    expect(pick(r, 'D')).toEqual([5, 10, 5, 10, 0]);
    expect(pick(r, 'E')).toEqual([7, 8, 9, 10, 2]);
    expect(pick(r, 'F')).toEqual([10, 12, 10, 12, 0]);
    expect(r.critical).toEqual(['A', 'B', 'D', 'F']);
    expect([...r.criticalEdges].sort()).toEqual(['ab', 'bd', 'df']);
    expect(r.projectStart).toBe(0);
    expect(r.projectFinish).toBe(12);
    expect(r.cycles).toEqual([]);
  });

  it('takes the longer branch of a diamond', () => {
    const r = computeCriticalPath(
      [n('A', 2), n('B', 5), n('C', 3), n('D', 1)],
      [e('A', 'B'), e('A', 'C'), e('B', 'D'), e('C', 'D')],
    );
    expect(r.critical).toEqual(['A', 'B', 'D']);
    expect(r.nodes.get('C')!.float).toBe(2);
    expect(r.criticalEdges).toEqual(new Set(['A->B', 'B->D']));
    expect(r.projectFinish).toBe(8);
  });

  it('makes both branches of a balanced diamond critical', () => {
    const r = computeCriticalPath(
      [n('A', 1), n('B', 3), n('C', 3), n('D', 1)],
      [e('A', 'B'), e('A', 'C'), e('B', 'D'), e('C', 'D')],
    );
    expect(r.critical.sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('respects scheduled starts (start no earlier than) and gives the gap to the predecessor as float', () => {
    const r = computeCriticalPath([n('A', 5, 0), n('B', 3, 10)], [e('A', 'B')]);
    expect(pick(r, 'A')).toEqual([0, 5, 5, 10, 5]);
    expect(pick(r, 'B')).toEqual([10, 13, 10, 13, 0]);
    expect(r.critical).toEqual(['B']);
    expect(r.criticalEdges.size).toBe(0); // A does not drive B
  });

  it('pushes a successor later when its predecessor overruns', () => {
    const r = computeCriticalPath([n('A', 10, 0), n('B', 3, 4)], [e('A', 'B')]);
    expect(pick(r, 'B')).toEqual([10, 13, 10, 13, 0]);
    expect(r.critical).toEqual(['A', 'B']);
  });

  it('treats zero-duration milestones as points', () => {
    const r = computeCriticalPath([n('A', 4), n('M', 0, 0), n('B', 2)], [e('A', 'M'), e('M', 'B')]);
    expect(pick(r, 'M')).toEqual([4, 4, 4, 4, 0]);
    expect(r.critical).toEqual(['A', 'M', 'B']);
    expect(r.projectFinish).toBe(6);
  });

  it('analyses disconnected parts against the one project finish', () => {
    const r = computeCriticalPath([n('P', 5), n('Q', 5), n('R', 3), n('S', 2, 1)], [e('P', 'Q')]);
    expect(r.critical).toEqual(['P', 'Q']);
    expect(r.nodes.get('R')!.float).toBe(7);
    expect(r.nodes.get('S')!.float).toBe(7);
    expect(r.projectFinish).toBe(10);
  });

  it('reports cycles, ignores their edges and still analyses the rest', () => {
    const r = computeCriticalPath(
      [n('A', 2), n('B', 2), n('C', 2), n('D', 9), n('X', 1)],
      [e('A', 'B', 'ab'), e('B', 'C', 'bc'), e('C', 'A', 'ca'), e('C', 'D', 'cd'), e('X', 'X', 'xx')],
    );
    expect(r.cycles).toEqual([['A', 'B', 'C'], ['X']]);
    expect(r.ignoredEdges).toEqual(new Set(['ab', 'bc', 'ca', 'xx']));
    expect(r.nodes.size).toBe(5);
    // With the cycle edges gone, C → D is the longest chain.
    expect(r.critical).toEqual(['C', 'D']);
    expect(r.projectFinish).toBe(11);
  });

  it('ignores edges to unknown nodes and duplicate edges', () => {
    const r = computeCriticalPath([n('A', 1), n('B', 1)], [e('A', 'B'), e('A', 'B'), e('A', 'ghost', 'g')]);
    expect(r.ignoredEdges).toEqual(new Set(['g']));
    expect(r.critical).toEqual(['A', 'B']);
  });

  it('handles an empty network', () => {
    const r = computeCriticalPath([], []);
    expect(r).toMatchObject({ critical: [], projectStart: 0, projectFinish: 0, cycles: [] });
  });

  it('copes with a long chain without recursion limits', () => {
    const N = 20_000;
    const nodes = Array.from({ length: N }, (_, i) => n(`n${i}`, 1));
    const edges = Array.from({ length: N - 1 }, (_, i) => e(`n${i}`, `n${i + 1}`));
    const r = computeCriticalPath(nodes, edges);
    expect(r.critical.length).toBe(N);
    expect(r.projectFinish).toBe(N);
  });
});
