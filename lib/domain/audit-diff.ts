/**
 * Before/after diff for the audit viewer drawer (AUD-01). Pure: flattens both values to dotted
 * paths and reports what was added, removed or changed. Scalars (e.g. 'internal' → 'shared')
 * diff at the root path "(value)".
 */
export type DiffKind = 'added' | 'removed' | 'changed' | 'same';

export interface DiffRow {
  path: string;
  kind: DiffKind;
  before?: unknown;
  after?: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Flattens nested objects to dotted paths; arrays and scalars are leaf values. */
export function flatten(v: unknown, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (v === undefined) return out;
  if (!isObj(v)) {
    out.set(prefix || '(value)', v);
    return out;
  }
  const keys = Object.keys(v);
  if (!keys.length && prefix) out.set(prefix, {});
  for (const k of keys) for (const [p, x] of flatten(v[k], prefix ? `${prefix}.${k}` : k)) out.set(p, x);
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function jsonDiff(before: unknown, after: unknown): DiffRow[] {
  const b = flatten(before);
  const a = flatten(after);
  const paths = [...new Set([...b.keys(), ...a.keys()])].sort();
  return paths.map((path) => {
    const hasB = b.has(path);
    const hasA = a.has(path);
    if (!hasB) return { path, kind: 'added', after: a.get(path) };
    if (!hasA) return { path, kind: 'removed', before: b.get(path) };
    const kind: DiffKind = same(b.get(path), a.get(path)) ? 'same' : 'changed';
    return { path, kind, before: b.get(path), after: a.get(path) };
  });
}

/** Short display text of a diff value. */
export const showValue = (v: unknown) =>
  v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
