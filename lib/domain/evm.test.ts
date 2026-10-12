import { describe, expect, it } from 'vitest';
import {
  actualToDate,
  addDays,
  burnSeries,
  computeEvm,
  CPI_WARN,
  dollarsToCents,
  earnedValue,
  formatMoney,
  formatMoneyShort,
  formatRatio,
  NA,
  percentComplete,
  phaseBaseline,
  plannedFraction,
  plannedValue,
  roundHalfEven,
  safeRatio,
  SPI_WARN,
  type EvBaselineEntry,
} from './evm';

describe('worked example (hand-calculated, must match to the cent)', () => {
  // BAC = $480,000.00 = 48,000,000 cents
  // PV  = $210,000.00 = 21,000,000 cents
  // EV  = $180,000.00 = 18,000,000 cents
  // AC  = $200,000.00 = 20,000,000 cents
  //
  // SPI = EV / PV = 180,000 / 210,000 = 0.857142…  → "0.857"
  // CPI = EV / AC = 180,000 / 200,000 = 0.9        → "0.900"
  // EAC = AC + (BAC − EV) / CPI
  //     = 200,000 + (480,000 − 180,000) / 0.9
  //     = 200,000 + 333,333.333…
  //     = 533,333.333…                              → "$533,333.33"
  // VAC = BAC − EAC = 480,000 − 533,333.333… = −53,333.333… → "−$53,333.33"
  // Warnings: SPI 0.857 ≥ 0.85 (no warning), CPI 0.900 ≥ 0.9 (no warning).
  const r = computeEvm({
    bac: dollarsToCents(480_000),
    pv: dollarsToCents(210_000),
    ev: dollarsToCents(180_000),
    ac: dollarsToCents(200_000),
  });

  it('computes SPI and CPI', () => {
    expect(formatRatio(r.spi)).toBe('0.857');
    expect(formatRatio(r.cpi)).toBe('0.900');
    expect(r.spi).toBeCloseTo(6 / 7, 12);
    expect(r.cpi).toBeCloseTo(0.9, 12);
  });
  it('computes EAC and VAC to the cent', () => {
    expect(formatMoney(r.eac)).toBe('$533,333.33');
    expect(formatMoney(r.vac)).toBe('−$53,333.33');
    expect(formatMoney(r.vac, { ascii: true })).toBe('-$53,333.33');
    expect(roundHalfEven(r.eac!)).toBe(53_333_333);
    expect(roundHalfEven(r.vac!)).toBe(-5_333_333);
  });
  it('computes SV and CV', () => {
    expect(formatMoney(r.sv)).toBe('−$30,000.00');
    expect(formatMoney(r.cv)).toBe('−$20,000.00');
  });
  it('raises no warnings exactly at the thresholds', () => {
    expect(r.spiWarning).toBe(false);
    expect(r.cpiWarning).toBe(false);
  });
});

describe('warnings', () => {
  it('warns when SPI < 0.85 and CPI < 0.9', () => {
    const r = computeEvm({ bac: 100_000, pv: 10_000, ev: 8_400, ac: 9_400 });
    expect(r.spi).toBeLessThan(SPI_WARN);
    expect(r.cpi).toBeLessThan(CPI_WARN);
    expect(r.spiWarning).toBe(true);
    expect(r.cpiWarning).toBe(true);
  });
  it('does not warn when performing well', () => {
    const r = computeEvm({ bac: 100_000, pv: 10_000, ev: 12_000, ac: 10_000 });
    expect(r.spiWarning).toBe(false);
    expect(r.cpiWarning).toBe(false);
    expect(r.vac).toBeGreaterThan(0);
  });
});

describe('divide by zero', () => {
  it('returns null ("n/a") for SPI when PV is 0', () => {
    const r = computeEvm({ bac: 100_000, pv: 0, ev: 0, ac: 0 });
    expect(r.spi).toBeNull();
    expect(r.cpi).toBeNull();
    expect(r.eac).toBeNull();
    expect(r.vac).toBeNull();
    expect(formatRatio(r.spi)).toBe(NA);
    expect(formatMoney(r.eac)).toBe('n/a');
    expect(r.spiWarning).toBe(false);
    expect(r.cpiWarning).toBe(false);
  });
  it('EAC is n/a when CPI is 0 (cost spent, nothing earned)', () => {
    const r = computeEvm({ bac: 100_000, pv: 5_000, ev: 0, ac: 4_000 });
    expect(r.cpi).toBe(0);
    expect(r.eac).toBeNull();
    expect(r.vac).toBeNull();
    expect(r.spi).toBe(0);
    expect(r.cpiWarning).toBe(true);
  });
  it('safeRatio guards non-finite input', () => {
    expect(safeRatio(1, 0)).toBeNull();
    expect(safeRatio(NaN, 1)).toBeNull();
    expect(safeRatio(1, Infinity)).toBeNull();
    expect(safeRatio(1, 4)).toBe(0.25);
  });
});

describe('money', () => {
  it('rounds half to even only at display', () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(-0.5)).toBe(0);
    expect(formatMoney(-0.5)).toBe('$0.00');
    expect(roundHalfEven(-1.5)).toBe(-2);
    expect(roundHalfEven(2.4999999999)).toBe(2);
    expect(roundHalfEven(2.51)).toBe(3);
    expect(formatMoney(12.5)).toBe('$0.12');
    expect(formatMoney(13.5)).toBe('$0.14');
    expect(formatMoney(-13.5)).toBe('−$0.14');
  });
  it('formats dollars with separators and n/a', () => {
    expect(formatMoney(dollarsToCents(1_234_567.89))).toBe('$1,234,567.89');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(null)).toBe('n/a');
    expect(formatMoneyShort(48_000_000)).toBe('$480k');
    expect(formatMoneyShort(150_000_000)).toBe('$1.5M');
  });
  it('converts dollars to integer cents', () => {
    expect(dollarsToCents(480_000)).toBe(48_000_000);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
  });
});

describe('time-phased baseline', () => {
  const entries: EvBaselineEntry[] = [
    { id: 'a', name: 'A', weight: 1, startDate: '2026-01-01', dueDate: '2026-01-11', percentComplete: 100 },
    { id: 'b', name: 'B', weight: 3, startDate: '2026-01-11', dueDate: '2026-01-21', percentComplete: 50 },
  ];
  it('accrues planned value linearly between start and due', () => {
    expect(plannedFraction(entries[0], '2025-12-31')).toBe(0);
    expect(plannedFraction(entries[0], '2026-01-06')).toBe(0.5);
    expect(plannedFraction(entries[0], '2026-01-11')).toBe(1);
    expect(plannedFraction(entries[0], '2026-03-01')).toBe(1);
  });
  it('treats a same-day milestone as a step', () => {
    const m = { startDate: '2026-02-01', dueDate: '2026-02-01' };
    expect(plannedFraction(m, '2026-01-31')).toBe(0);
    expect(plannedFraction(m, '2026-02-01')).toBe(1);
  });
  it('computes PV per date from weights', () => {
    // BAC $1,000 = 100,000 cents. On Jan 16: A fully planned (1), B half planned (1.5) → 2.5 / 4.
    expect(plannedValue(100_000, entries, '2026-01-16')).toBe(62_500);
    expect(plannedValue(100_000, entries, '2026-01-01')).toBe(0);
    expect(plannedValue(100_000, entries, '2026-02-01')).toBe(100_000);
  });
  it('computes EV from weighted % complete', () => {
    // (1×100 + 3×50) / 4 = 62.5% of $1,000 → $625.00
    expect(percentComplete(entries)).toBe(62.5);
    expect(earnedValue(100_000, entries)).toBe(62_500);
  });
  it('ignores zero or negative weights and returns 0 when no weight', () => {
    expect(plannedValue(100_000, [], '2026-01-01')).toBe(0);
    expect(earnedValue(100_000, [{ ...entries[0], weight: 0 }])).toBe(0);
  });
  it('builds an equal-weight phase baseline, splitting the window when phases have no dates', () => {
    const b = phaseBaseline(
      [
        { id: 'p1', name: 'One', passed: true },
        { id: 'p2', name: 'Two', passed: false },
      ],
      '2026-01-01',
      '2026-01-21',
    );
    expect(b.map((e) => [e.startDate, e.dueDate, e.percentComplete])).toEqual([
      ['2026-01-01', '2026-01-11', 100],
      ['2026-01-11', '2026-01-21', 0],
    ]);
    expect(earnedValue(100_000, b)).toBe(50_000);
    expect(phaseBaseline([], '2026-01-01', '2026-02-01')).toEqual([]);
  });
  it('sums actuals up to and including the as-of date', () => {
    const actuals = [
      { date: '2026-01-02', amountCents: 1_000 },
      { date: '2026-01-09', amountCents: 2_000 },
      { date: '2026-01-16', amountCents: 4_000 },
    ];
    expect(actualToDate(actuals, '2026-01-09')).toBe(3_000);
    expect(actualToDate(actuals, '2026-01-01')).toBe(0);
  });
  it('builds a weekly burn series with no actuals after as-of', () => {
    const s = burnSeries(
      100_000,
      entries,
      [{ date: '2026-01-05', amountCents: 500 }],
      '2026-01-01',
      '2026-01-21',
      '2026-01-10',
    );
    expect(s.map((p) => p.date)).toEqual([
      '2026-01-01',
      '2026-01-08',
      '2026-01-10',
      '2026-01-15',
      '2026-01-21',
    ]);
    expect(s[0]).toEqual({ date: '2026-01-01', planned: 0, actual: 0 });
    expect(s[2].actual).toBe(500);
    expect(s[3].actual).toBeNull();
    expect(s[4].planned).toBe(100_000);
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
