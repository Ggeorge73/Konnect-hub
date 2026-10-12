'use client';
import { Box, Typography, useTheme } from '@mui/material';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BurnPoint } from '@/lib/domain/evm';
import { formatMoney, formatMoneyShort } from '@/lib/domain/evm';
import { MONO } from '@/lib/theme';
import { ChartTable } from './ChartTable';

/**
 * Colour-blind-safe pair (validated with the dataviz palette checker against both surfaces):
 * planned = blue, actual = orange and dashed, so identity never rests on colour alone.
 */
export function chartColors(mode: 'light' | 'dark') {
  return mode === 'dark'
    ? { planned: '#3B82F6', actual: '#EA580C', grid: 'rgba(255,255,255,0.08)', axis: '#A0AEC0' }
    : { planned: '#2563EB', actual: '#EA580C', grid: '#E2E8F0', axis: '#475569' };
}

const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Planned vs. actual cumulative cost (Recharts), with a data-table alternative. */
export function BudgetBurnChart({ data, asOf }: { data: BurnPoint[]; asOf: string }) {
  const theme = useTheme();
  const c = chartColors(theme.palette.mode);
  return (
    <Box>
      <Box
        role="img"
        aria-label="Budget burn: cumulative planned value and actual cost over time. The data table below has the values."
        sx={{ height: 240 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              stroke={c.axis}
              tick={{ fontSize: 11, fill: c.axis }}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(v: number) => formatMoneyShort(v)}
              stroke={c.axis}
              tick={{ fontSize: 11, fill: c.axis, fontFamily: MONO }}
              width={56}
            />
            <Tooltip
              formatter={(v: number, name: string) => [formatMoney(v), name]}
              labelFormatter={(d: string) => shortDate(d)}
              contentStyle={{
                background: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 8,
                color: theme.palette.text.primary,
                fontSize: 12,
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: theme.palette.text.primary }} />
            <ReferenceLine
              x={asOf}
              stroke={c.axis}
              strokeDasharray="2 4"
              label={{ value: 'Today', fill: c.axis, fontSize: 11 }}
            />
            <Line
              type="monotone"
              dataKey="planned"
              name="Planned (PV)"
              stroke={c.planned}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="actual"
              name="Actual (AC)"
              stroke={c.actual}
              strokeWidth={2}
              strokeDasharray="6 3"
              dot={false}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>
      <Typography variant="caption" color="text.secondary">
        Solid blue: planned value. Dashed orange: actual cost to date.
      </Typography>
      <ChartTable
        caption="Budget burn: cumulative planned value and actual cost"
        columns={['Date', 'Planned (PV)', 'Actual (AC)']}
        rows={data.map((p) => [
          p.date,
          formatMoney(p.planned),
          p.actual === null ? '—' : formatMoney(p.actual),
        ])}
      />
    </Box>
  );
}
