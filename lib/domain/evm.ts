/**
 * Earned value management (EVM-01, CLAUDE.md 3.6). Pure functions only: no I/O, no clock reads.
 *
 * Money is integer cents at the inputs (BAC, actuals). Derived values (PV, EV, EAC, VAC) are kept
 * unrounded in cents and are rounded half-even only when displayed (`formatMoney`).
 */

/** A money amount in cents. Inputs are integers; derived values may carry fractional cents. */
export type Cents = number;

/** Label shown for a ratio or amount that cannot be computed (divide by zero). */
export const NA = 'n/a';
/** SPI below this shows a schedule warning. */
export const SPI_WARN = 0.85;
/** CPI below this shows a cost warning. */
export const CPI_WARN = 0.9;

const DAY_MS = 86_400_000;

/** Converts a dollar amount (as stored on the project, e.g. BAC 480000) to integer cents. */
export const dollarsToCents = (dollars: number): Cents => Math.round(dollars * 100);

/** n / d, or null when d is zero or either side is not a finite number. */
export function safeRatio(n: number, d: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

/**
 * Rounds to the nearest integer, ties to even (banker's rounding). Tolerates float noise so that
 * 0.5 computed as 0.49999999999 still counts as a tie.
 */
export function roundHalfEven(x: number): number {
  if (!Number.isFinite(x)) return x;
  const floor = Math.floor(x);
  const diff = x - floor;
  const EPS = 1e-7;
  if (Math.abs(diff - 0.5) < EPS) return floor % 2 === 0 ? floor : floor + 1;
  return diff < 0.5 ? floor : floor + 1;
}

/**
 * "$533,333.33" / "−$53,333.33". Rounds half-even to the cent. `ascii` uses a hyphen-minus for
 * outputs that cannot encode U+2212 (PDF standard fonts).
 */
export function formatMoney(cents: Cents | null | undefined, opts: { ascii?: boolean } = {}): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return NA;
  const c = roundHalfEven(cents);
  const neg = c < 0;
  const abs = Math.abs(c);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const rest = String(abs % 100).padStart(2, '0');
  return `${neg ? (opts.ascii ? '-' : '−') : ''}$${dollars}.${rest}`;
}

/** Compact money for chart axes: "$480k", "$1.2M". */
export function formatMoneyShort(cents: Cents): string {
  const d = roundHalfEven(cents) / 100;
  const abs = Math.abs(d);
  const sign = d < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

/** Three-decimal ratio, or "n/a". */
export const formatRatio = (r: number | null | undefined): string =>
  r === null || r === undefined || !Number.isFinite(r) ? NA : r.toFixed(3);

export interface EvmInputs {
  /** Budget at completion (cents). */
  bac: Cents;
  /** Planned value to date (cents). */
  pv: Cents;
  /** Earned value to date (cents). */
  ev: Cents;
  /** Actual cost to date (cents). */
  ac: Cents;
}

export interface EvmResult extends EvmInputs {
  /** Schedule performance index EV / PV, null when PV is 0. */
  spi: number | null;
  /** Cost performance index EV / AC, null when AC is 0. */
  cpi: number | null;
  /** Estimate at completion AC + (BAC − EV) / CPI, null when CPI is null or 0. */
  eac: Cents | null;
  /** Variance at completion BAC − EAC, null when EAC is null. */
  vac: Cents | null;
  /** Schedule variance EV − PV. */
  sv: Cents;
  /** Cost variance EV − AC. */
  cv: Cents;
  spiWarning: boolean;
  cpiWarning: boolean;
}

/** SPI, CPI, EAC and VAC with divide-by-zero returning null ("n/a"). */
export function computeEvm({ bac, pv, ev, ac }: EvmInputs): EvmResult {
  const spi = safeRatio(ev, pv);
  const cpi = safeRatio(ev, ac);
  // EAC = AC + (BAC − EV) / CPI = AC + (BAC − EV) × AC / EV: one division keeps it exact for cents.
  const eac = cpi === null || cpi === 0 ? null : ac + ((bac - ev) * ac) / ev;
  return {
    bac,
    pv,
    ev,
    ac,
    spi,
    cpi,
    eac,
    vac: eac === null ? null : bac - eac,
    sv: ev - pv,
    cv: ev - ac,
    spiWarning: spi !== null && spi < SPI_WARN,
    cpiWarning: cpi !== null && cpi < CPI_WARN,
  };
}

// ---------------------------------------------------------------------------
// Time-phased baseline: PV per date and EV from weighted milestones / deliverables.
// ---------------------------------------------------------------------------

/** A weighted milestone (or deliverable) in the EV baseline. Dates are YYYY-MM-DD. */
export interface EvBaselineEntry {
  id: string;
  name: string;
  /** Relative weight (> 0). Weights need not add up to 100. */
  weight: number;
  /** Planned value accrues linearly from startDate to dueDate. */
  startDate: string;
  dueDate: string;
  /** 0–100. */
  percentComplete: number;
}

const dayNum = (date: string) => Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY_MS;

export const addDays = (date: string, n: number): string =>
  new Date((dayNum(date) + n) * DAY_MS).toISOString().slice(0, 10);

export const daysBetween = (from: string, to: string) => dayNum(to) - dayNum(from);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Share of an entry planned to be done by `asOf` (inclusive): 0 before start, 1 from the due date. */
export function plannedFraction(e: Pick<EvBaselineEntry, 'startDate' | 'dueDate'>, asOf: string): number {
  const span = daysBetween(e.startDate, e.dueDate);
  if (span <= 0) return dayNum(asOf) >= dayNum(e.dueDate) ? 1 : 0;
  return clamp01(daysBetween(e.startDate, asOf) / span);
}

const validEntries = (entries: EvBaselineEntry[]) =>
  entries.filter((e) => Number.isFinite(e.weight) && e.weight > 0);

export const totalWeight = (entries: EvBaselineEntry[]) =>
  validEntries(entries).reduce((sum, e) => sum + e.weight, 0);

/** PV(asOf) = BAC × Σ(weight × planned fraction) / Σ weight. */
export function plannedValue(bac: Cents, entries: EvBaselineEntry[], asOf: string): Cents {
  const total = totalWeight(entries);
  if (total === 0) return 0;
  const planned = validEntries(entries).reduce((s, e) => s + e.weight * plannedFraction(e, asOf), 0);
  return (bac * planned) / total;
}

/** Weighted % complete (0–100) of the baseline. */
export function percentComplete(entries: EvBaselineEntry[]): number {
  const total = totalWeight(entries);
  if (total === 0) return 0;
  return (
    validEntries(entries).reduce((s, e) => s + e.weight * Math.min(100, Math.max(0, e.percentComplete)), 0) /
    total
  );
}

/** EV = BAC × weighted % complete. */
export const earnedValue = (bac: Cents, entries: EvBaselineEntry[]): Cents =>
  (bac * percentComplete(entries)) / 100;

/**
 * "Linear across phases" fallback when a project has no weighted milestones: one equally weighted
 * entry per phase, using the phase dates when set, otherwise an even split of the project window.
 */
export function phaseBaseline(
  phases: { id: string; name: string; startDate?: string; endDate?: string; passed: boolean }[],
  projectStart: string,
  projectEnd: string,
): EvBaselineEntry[] {
  const n = phases.length;
  if (n === 0) return [];
  const span = Math.max(1, daysBetween(projectStart, projectEnd));
  return phases.map((p, i) => {
    const start = p.startDate ?? addDays(projectStart, Math.round((span * i) / n));
    const due = p.endDate ?? addDays(projectStart, Math.round((span * (i + 1)) / n));
    return {
      id: p.id,
      name: p.name,
      weight: 1,
      startDate: start,
      dueDate: due,
      percentComplete: p.passed ? 100 : 0,
    };
  });
}

export interface ActualCost {
  /** YYYY-MM-DD. */
  date: string;
  /** Integer cents. */
  amountCents: Cents;
}

/** Cumulative actual cost up to and including `asOf`. */
export const actualToDate = (actuals: ActualCost[], asOf: string): Cents =>
  actuals.filter((a) => a.date <= asOf).reduce((s, a) => s + a.amountCents, 0);

export interface BurnPoint {
  date: string;
  /** Cumulative planned value (cents). */
  planned: Cents;
  /** Cumulative actual cost (cents); null after `asOf`. */
  actual: Cents | null;
}

/**
 * Planned vs. actual cumulative series from `start` to `end`, every `stepDays`, always including
 * `asOf` (when inside the window) and `end`.
 */
export function burnSeries(
  bac: Cents,
  entries: EvBaselineEntry[],
  actuals: ActualCost[],
  start: string,
  end: string,
  asOf: string,
  stepDays = 7,
): BurnPoint[] {
  const dates = new Set<string>();
  for (let d = start; d <= end; d = addDays(d, stepDays)) dates.add(d);
  dates.add(end);
  if (asOf >= start && asOf <= end) dates.add(asOf);
  return [...dates].sort().map((date) => ({
    date,
    planned: plannedValue(bac, entries, date),
    actual: date <= asOf ? actualToDate(actuals, date) : null,
  }));
}

/** A weighted EV milestone stored per project. Optionally tracks a gate deliverable. */
export interface EvMilestone extends EvBaselineEntry {
  projectId: string;
  /** When set, the milestone counts as 100% complete once the deliverable is accepted. */
  deliverableId?: string;
}

/** An actual-cost entry (internal only). Sprint 4 replaces these with approved time × cost rate. */
export interface ProjectActual extends ActualCost {
  id: string;
  projectId: string;
  note?: string;
}

/** % complete of a milestone: 100 when its deliverable is accepted, otherwise the reported figure. */
export const milestoneProgress = (m: EvMilestone, deliverableStatus?: string): number =>
  m.deliverableId && deliverableStatus === 'accepted' ? 100 : m.percentComplete;
