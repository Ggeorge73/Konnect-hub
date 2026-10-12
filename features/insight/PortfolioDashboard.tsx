'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Box,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip as MuiTooltip,
  Typography,
  useTheme,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import WarningAmber from '@mui/icons-material/WarningAmber';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Rag } from '@/lib/domain/types';
import {
  filterPortfolio,
  projectsByGate,
  ragDistribution,
  RAG_TEXT,
  type PortfolioFilter,
} from '@/lib/domain/dashboard';
import { formatMoney, formatRatio } from '@/lib/domain/evm';
import { GATE_NAMES } from '@/lib/domain/templates';
import { EmptyState, Mono, RagChip } from '@/components/ui/bits';
import { RAG_COLORS } from '@/lib/theme';
import { usePortfolio } from './api';
import { ChartTable } from './ChartTable';
import { chartColors } from './BudgetBurnChart';

function MiniBar({
  title,
  data,
  colorFor,
}: {
  title: string;
  data: { label: string; count: number; key: string }[];
  colorFor: (key: string) => string;
}) {
  const theme = useTheme();
  const c = chartColors(theme.palette.mode);
  return (
    <Paper component="section" aria-label={title} sx={{ p: 2.5, borderRadius: 4, height: '100%' }}>
      <Typography variant="h3" component="h2" sx={{ mb: 1 }}>
        {title}
      </Typography>
      <Box
        role="img"
        aria-label={`${title}: ${data.map((d) => `${d.label} ${d.count}`).join(', ')}`}
        sx={{ height: 180 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: -24 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="label" stroke={c.axis} tick={{ fontSize: 11, fill: c.axis }} interval={0} />
            <YAxis allowDecimals={false} stroke={c.axis} tick={{ fontSize: 11, fill: c.axis }} />
            <Tooltip
              cursor={{ fill: 'rgba(148,163,184,0.12)' }}
              formatter={(v: number) => [v, 'Projects']}
              contentStyle={{
                background: theme.palette.background.paper,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 8,
                color: theme.palette.text.primary,
                fontSize: 12,
              }}
            />
            <Bar
              dataKey="count"
              radius={[4, 4, 0, 0]}
              maxBarSize={36}
              isAnimationActive={false}
              label={{ position: 'top', fill: theme.palette.text.primary, fontSize: 11 }}
            >
              {data.map((d) => (
                <Cell key={d.key} fill={colorFor(d.key)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Box>
      <ChartTable
        caption={title}
        columns={['Category', 'Projects']}
        rows={data.map((d) => [d.label, d.count])}
      />
    </Paper>
  );
}

const Ratio = ({ v, warn }: { v: number | null; warn: boolean }) => (
  <Stack direction="row" spacing={0.5} alignItems="center" component="span">
    <Mono>{formatRatio(v)}</Mono>
    {warn && (
      <MuiTooltip title="Below the warning threshold">
        <WarningAmber aria-label="warning" sx={{ fontSize: 16, color: 'warning.main' }} />
      </MuiTooltip>
    )}
  </Stack>
);

/** DASH-02: internal portfolio dashboard. */
export function PortfolioDashboard() {
  const { data, error, isLoading } = usePortfolio();
  const theme = useTheme();
  const [f, setF] = useState<PortfolioFilter>({});
  const rows = useMemo(() => (data ? filterPortfolio(data.rows, f) : []), [data, f]);
  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (isLoading || !data) return <Skeleton variant="rounded" height={320} />;

  const rag = ragDistribution(rows).map((r) => ({ key: r.rag, label: RAG_TEXT[r.rag], count: r.count }));
  const gates = projectsByGate(rows, GATE_NAMES).map((g) => ({
    key: String(g.gate),
    label: `${g.gate} ${g.name}`,
    count: g.count,
  }));
  const select = (id: keyof PortfolioFilter, label: string, options: { id: string; name: string }[]) => (
    <FormControl size="small" sx={{ minWidth: 180 }}>
      <InputLabel id={`pf-${id}`}>{label}</InputLabel>
      <Select
        labelId={`pf-${id}`}
        label={label}
        value={f[id] ?? ''}
        onChange={(e) => setF((x) => ({ ...x, [id]: e.target.value || undefined }))}
      >
        <MenuItem value="">All</MenuItem>
        {options.map((o) => (
          <MenuItem key={o.id} value={o.id}>
            {o.name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h1">Portfolio dashboard</Typography>
        <Typography color="text.secondary">
          Every project you can see, with status, gate, earned value and critical risks. Internal only.
        </Typography>
      </Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} component="section" aria-label="Filters">
        {select('clientId', 'Client', data.clients)}
        {select('leadId', 'Lead', data.leads)}
        {select(
          'rag',
          'RAG',
          (['green', 'amber', 'red'] as Rag[]).map((r) => ({ id: r, name: RAG_TEXT[r] })),
        )}
      </Stack>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6 }}>
          <MiniBar title="RAG distribution" data={rag} colorFor={(k) => RAG_COLORS[k as Rag]} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <MiniBar title="Projects by gate" data={gates} colorFor={() => theme.palette.primary.main} />
        </Grid>
      </Grid>
      <Paper sx={{ borderRadius: 4 }}>
        {rows.length === 0 ? (
          <EmptyState title="No matching projects" body="Clear a filter to see more projects." />
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Projects">
              <TableHead>
                <TableRow>
                  <TableCell>Project</TableCell>
                  <TableCell>Client</TableCell>
                  <TableCell>Lead</TableCell>
                  <TableCell>RAG</TableCell>
                  <TableCell>Gate</TableCell>
                  {data.money && <TableCell align="right">Budget variance (VAC)</TableCell>}
                  <TableCell>SPI</TableCell>
                  <TableCell>CPI</TableCell>
                  <TableCell align="right">Critical risks</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell>
                      <Link href={`/projects/${r.key}/dashboard`} style={{ color: 'inherit' }}>
                        <Mono>{r.key}</Mono> {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>{r.clientName}</TableCell>
                    <TableCell>{r.leadName}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <RagChip rag={r.rag} reason={r.ragReason} />
                        {r.suggestedRag !== r.rag && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`Suggested ${RAG_TEXT[r.suggestedRag]}`}
                          />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Mono>{r.gate}</Mono> · {r.gateName}
                    </TableCell>
                    {data.money && (
                      <TableCell align="right" sx={{ color: (r.vac ?? 0) < 0 ? 'error.main' : undefined }}>
                        <Mono>{formatMoney(r.vac)}</Mono>
                      </TableCell>
                    )}
                    <TableCell>
                      <Ratio v={r.spi} warn={r.spiWarning} />
                    </TableCell>
                    <TableCell>
                      <Ratio v={r.cpi} warn={r.cpiWarning} />
                    </TableCell>
                    <TableCell align="right">
                      <Mono>{r.criticalRisks}</Mono>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </Stack>
  );
}
