'use client';
import {
  Alert,
  Box,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FlowDay, ProjectMetrics } from '@/lib/domain/metrics';
import { EmptyState, Mono } from '@/components/ui/bits';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import { useProjectMetrics } from './api';
import { useChartTheme } from './chartTheme';

/** Hidden from sight but read by screen readers: the data table behind each chart. */
const srOnly = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
} as const;

const fmtDay = (day: string) =>
  new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

interface DataTable {
  columns: string[];
  rows: (string | number)[][];
}

function ChartCard({
  id,
  title,
  subtitle,
  table,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  table: DataTable;
  children: React.ReactElement;
}) {
  return (
    <Paper
      component="figure"
      aria-labelledby={`${id}-title`}
      data-testid={id}
      sx={{ p: 2.5, borderRadius: 4, m: 0, height: '100%' }}
    >
      <Typography variant="h3" component="h2" id={`${id}-title`}>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {subtitle}
      </Typography>
      {/* The SVG is decorative for assistive tech; the table below carries the same data. */}
      <Box sx={{ height: 260 }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </Box>
      <Table size="small" sx={srOnly} aria-label={`${title} data`}>
        <TableHead>
          <TableRow>
            {table.columns.map((c) => (
              <TableCell key={c} component="th" scope="col">
                {c}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {table.rows.map((r, k) => (
            <TableRow key={k}>
              {r.map((v, j) => (
                <TableCell key={j} component={j === 0 ? 'th' : 'td'} scope={j === 0 ? 'row' : undefined}>
                  {v}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Paper sx={{ p: 2, borderRadius: 4, height: '100%' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h2" component="p">
        <Mono>{value}</Mono>
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {hint}
      </Typography>
    </Paper>
  );
}

/** Cumulative-flow bands, bottom (most finished) first. Review stages are combined to keep 5 bands. */
const FLOW_BANDS: { id: string; label: string; of: (d: FlowDay) => number }[] = [
  { id: 'done', label: 'Done / Accepted', of: (d) => d.done + d.accepted },
  { id: 'review', label: 'In review / Client review', of: (d) => d.in_review + d.client_review },
  { id: 'in_progress', label: 'In progress', of: (d) => d.in_progress },
  { id: 'ready', label: 'Ready', of: (d) => d.ready },
  { id: 'backlog', label: 'Backlog', of: (d) => d.backlog },
];

export function MetricsCharts({ m }: { m: ProjectMetrics }) {
  const c = useChartTheme();
  const legend = (
    <Legend
      wrapperStyle={{ fontSize: 13 }}
      formatter={(v: string) => <span style={{ color: c.text }}>{v}</span>}
    />
  );
  const grid = <CartesianGrid stroke={c.grid} vertical={false} />;
  const tooltip = <Tooltip {...c.tooltip} cursor={{ fill: c.grid, stroke: c.grid }} />;

  const velocity = m.velocity.map((v) => ({
    ...v,
    label: v.inProgress ? `${v.sprint} (in progress)` : v.sprint,
  }));
  const flow = m.cumulativeFlow.map((d) => ({
    day: fmtDay(d.day),
    ...Object.fromEntries(FLOW_BANDS.map((b) => [b.id, b.of(d)])),
  }));
  const cycle = m.cycleTime.points.map((p) => ({ ...p, x: new Date(p.doneAt).getTime() }));
  const thisWeek = m.throughput.at(-1)?.count ?? 0;

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, sm: 4 }}>
        <Stat
          label="Average velocity"
          value={`${m.averageVelocity} pts`}
          hint="Completed points per finished sprint"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 4 }}>
        <Stat
          label="Cycle time (50th / 85th)"
          value={`${m.cycleTime.p50} / ${m.cycleTime.p85} d`}
          hint="In progress to Done, calendar days"
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 4 }}>
        <Stat
          label="Done this week"
          value={String(thisWeek)}
          hint={`Week of ${fmtDay(m.throughput.at(-1)!.weekStart)}`}
        />
      </Grid>

      <Grid size={{ xs: 12, lg: 6 }}>
        <ChartCard
          id="velocity-chart"
          title="Velocity"
          subtitle={`Committed vs completed points, last ${velocity.length} sprints`}
          table={{
            columns: ['Sprint', 'Committed points', 'Completed points'],
            rows: velocity.map((v) => [v.label, v.committed, v.completed]),
          }}
        >
          <BarChart data={velocity} barGap={2} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            {grid}
            <XAxis
              dataKey="sprint"
              tick={c.axis}
              tickLine={false}
              axisLine={{ stroke: c.grid }}
              interval={0}
            />
            <YAxis tick={c.axis} tickLine={false} axisLine={false} allowDecimals={false} />
            {tooltip}
            {legend}
            <Bar
              dataKey="committed"
              name="Committed"
              fill={c.series[0]}
              radius={[4, 4, 0, 0]}
              maxBarSize={26}
            />
            <Bar
              dataKey="completed"
              name="Completed"
              fill={c.series[1]}
              radius={[4, 4, 0, 0]}
              maxBarSize={26}
            />
          </BarChart>
        </ChartCard>
      </Grid>

      <Grid size={{ xs: 12, lg: 6 }}>
        {m.burndown ? (
          <ChartCard
            id="burndown-chart"
            title="Sprint burndown"
            subtitle={`${m.burndown.sprint}: ${m.burndown.total} points of scope, remaining per working day`}
            table={{
              columns: ['Day', 'Ideal remaining', 'Actual remaining'],
              rows: m.burndown.points.map((p) => [fmtDay(p.day), p.ideal, p.actual ?? '—']),
            }}
          >
            <LineChart
              data={m.burndown.points.map((p) => ({ ...p, label: fmtDay(p.day) }))}
              margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
            >
              {grid}
              <XAxis dataKey="label" tick={c.axis} tickLine={false} axisLine={{ stroke: c.grid }} />
              <YAxis tick={c.axis} tickLine={false} axisLine={false} allowDecimals={false} />
              {tooltip}
              {legend}
              <Line
                dataKey="ideal"
                name="Ideal"
                stroke={c.series[0]}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                dataKey="actual"
                name="Actual"
                stroke={c.series[1]}
                strokeWidth={2}
                dot={{ r: 4, strokeWidth: 2, stroke: c.surface, fill: c.series[1] }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartCard>
        ) : (
          <Paper sx={{ borderRadius: 4, height: '100%' }} data-testid="burndown-chart">
            <EmptyState
              title="No active sprint"
              body="Start a sprint from the Backlog to see its burndown here."
            />
          </Paper>
        )}
      </Grid>

      <Grid size={{ xs: 12, lg: 6 }}>
        <ChartCard
          id="cfd-chart"
          title="Cumulative flow"
          subtitle="Items in each status at the end of each day, last 30 days"
          table={{
            columns: ['Day', ...FLOW_BANDS.map((b) => b.label)],
            rows: m.cumulativeFlow.map((d) => [fmtDay(d.day), ...FLOW_BANDS.map((b) => b.of(d))]),
          }}
        >
          <AreaChart data={flow} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            {grid}
            <XAxis
              dataKey="day"
              tick={c.axis}
              tickLine={false}
              axisLine={{ stroke: c.grid }}
              minTickGap={24}
            />
            <YAxis tick={c.axis} tickLine={false} axisLine={false} allowDecimals={false} />
            {tooltip}
            {legend}
            {FLOW_BANDS.map((b, k) => (
              <Area
                key={b.id}
                dataKey={b.id}
                name={b.label}
                stackId="flow"
                type="stepAfter"
                stroke={c.surface}
                strokeWidth={2}
                fill={c.series[k]}
                fillOpacity={0.9}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ChartCard>
      </Grid>

      <Grid size={{ xs: 12, lg: 6 }}>
        <ChartCard
          id="cycle-chart"
          title="Cycle time"
          subtitle={`In progress to Done per item · 50th percentile ${m.cycleTime.p50} d, 85th ${m.cycleTime.p85} d`}
          table={{
            columns: ['Item', 'Finished', 'Cycle time (days)'],
            rows: m.cycleTime.points.map((p) => [
              `${p.key} ${p.title}`,
              fmtDay(p.doneAt.slice(0, 10)),
              p.days,
            ]),
          }}
        >
          <ScatterChart margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
            {grid}
            <XAxis
              dataKey="x"
              type="number"
              domain={['dataMin', 'dataMax']}
              name="Finished"
              tick={c.axis}
              tickLine={false}
              axisLine={{ stroke: c.grid }}
              tickFormatter={(x: number) => fmtDay(new Date(x).toISOString().slice(0, 10))}
            />
            <YAxis dataKey="days" name="Days" unit=" d" tick={c.axis} tickLine={false} axisLine={false} />
            <Tooltip
              {...c.tooltip}
              cursor={{ stroke: c.grid }}
              formatter={(v: number, n: string) =>
                n === 'Finished' ? fmtDay(new Date(v).toISOString().slice(0, 10)) : `${v} d`
              }
            />
            <ReferenceLine
              y={m.cycleTime.p50}
              stroke={c.muted}
              strokeDasharray="4 4"
              label={{ value: '50th', position: 'insideTopLeft', fill: c.text, fontSize: 12 }}
            />
            <ReferenceLine
              y={m.cycleTime.p85}
              stroke={c.series[1]}
              strokeDasharray="4 4"
              label={{ value: '85th', position: 'insideTopLeft', fill: c.text, fontSize: 12 }}
            />
            <Scatter
              data={cycle}
              name="Items"
              fill={c.series[0]}
              stroke={c.surface}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </ScatterChart>
        </ChartCard>
      </Grid>

      <Grid size={12}>
        <ChartCard
          id="throughput-chart"
          title="Throughput"
          subtitle={`Items finished per week, last ${m.throughput.length} weeks`}
          table={{
            columns: ['Week of', 'Items done'],
            rows: m.throughput.map((w) => [fmtDay(w.weekStart), w.count]),
          }}
        >
          <BarChart
            data={m.throughput.map((w) => ({ ...w, label: fmtDay(w.weekStart) }))}
            margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
          >
            {grid}
            <XAxis dataKey="label" tick={c.axis} tickLine={false} axisLine={{ stroke: c.grid }} />
            <YAxis tick={c.axis} tickLine={false} axisLine={false} allowDecimals={false} />
            {tooltip}
            <Bar dataKey="count" name="Items done" fill={c.series[0]} radius={[4, 4, 0, 0]} maxBarSize={32} />
          </BarChart>
        </ChartCard>
      </Grid>
    </Grid>
  );
}

export function MetricsView() {
  const { project } = useProjectBundle();
  const { data, isLoading, error } = useProjectMetrics(project.key);
  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (isLoading || !data)
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={90} />
        <Skeleton variant="rounded" height={320} />
      </Stack>
    );
  return (
    <Box component="section" aria-label="Agile metrics">
      <MetricsCharts m={data} />
    </Box>
  );
}
