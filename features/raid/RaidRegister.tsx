'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import Add from '@mui/icons-material/Add';
import EditOutlined from '@mui/icons-material/EditOutlined';
import FilterAltOffOutlined from '@mui/icons-material/FilterAltOffOutlined';
import { useItems, useMe } from '@/lib/client/api';
import { isInternalRole } from '@/lib/domain/permissions';
import {
  buildHeatMap,
  filterByCell,
  RAID_KINDS,
  RAID_STATUS_LABEL,
  RISK_CATEGORIES,
  ROAM,
  type RaidKind,
  type RaidView,
} from '@/lib/domain/raid';
import type { Profile, WorkItem } from '@/lib/domain/types';
import { EmptyState, Mono, VisibilityChip } from '@/components/ui/bits';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import { useRaid } from './api';
import { HeatMap, type Cell } from './HeatMap';
import { RaidDialog } from './RaidDialog';
import { EscalateChip, ScoreChip, SeverityChip, SlaBreachedChip, StaleChip } from './RaidChips';

const EMPTY: Record<RaidKind, string> = {
  risk: 'No risks logged yet. Projects that log risks early recover faster.',
  assumption: 'No assumptions logged yet. Write down what the plan takes for granted so it can be checked.',
  issue: 'No open issues. Log problems that are happening now so they get an owner and an SLA.',
  dependency: 'No dependencies logged yet. Track what you need from vendors, clients and other teams.',
  decision: 'No decisions recorded yet. Record who decided what, and why, so it is not re-litigated.',
};

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleDateString() : '—';
const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function RaidRegister() {
  const bundle = useProjectBundle();
  const { project, people } = bundle;
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: me } = useMe();
  const { data: entries, isLoading, error } = useRaid(project.key);
  const { data: items = [] } = useItems(project.id);
  const tabParam = params.get('tab') as RaidKind | null;
  const tab: RaidKind = RAID_KINDS.some((k) => k.id === tabParam) ? tabParam! : 'risk';
  const [cell, setCell] = useState<Cell | null>(null);
  const [dialog, setDialog] = useState<{ kind: RaidKind; entry?: RaidView } | null>(null);
  const canEdit = Boolean(me && isInternalRole(me.user.role));

  const setTab = (k: RaidKind) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('tab', k);
    sp.delete('item');
    router.replace(`${pathname}?${sp}`, { scroll: false });
  };
  const itemHref = (key: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('item', key);
    return `${pathname}?${sp}`;
  };

  const byKind = useMemo(() => {
    const m = Object.fromEntries(RAID_KINDS.map((k) => [k.id, [] as RaidView[]])) as Record<
      RaidKind,
      RaidView[]
    >;
    for (const e of entries ?? []) m[e.kind].push(e);
    return m;
  }, [entries]);
  const risks = byKind.risk;
  const heat = useMemo(() => buildHeatMap(risks), [risks]);

  if (error) return <Alert severity="error">{error.message}</Alert>;
  if (isLoading || !entries) return <Skeleton variant="rounded" height={320} />;

  const meta = RAID_KINDS.find((k) => k.id === tab)!;
  const list = tab === 'risk' ? filterByCell(risks, cell) : byKind[tab];
  const addButton = canEdit && (
    <Button variant="contained" startIcon={<Add />} onClick={() => setDialog({ kind: tab })}>
      Add {meta.label.toLowerCase()}
    </Button>
  );
  const ctx: RowCtx = {
    people,
    items,
    itemHref,
    canEdit,
    onEdit: (entry) => setDialog({ kind: entry.kind, entry }),
  };

  return (
    <Stack spacing={2}>
      <Paper sx={{ borderRadius: 4, px: 2, pt: 1 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ sm: 'center' }} spacing={1}>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable"
            aria-label="RAID register"
            sx={{ flex: 1 }}
          >
            {RAID_KINDS.map((k) => (
              <Tab key={k.id} value={k.id} label={`${k.plural} (${byKind[k.id].length})`} />
            ))}
          </Tabs>
          <Box sx={{ pb: 1 }}>{entries.length > 0 && addButton}</Box>
        </Stack>
      </Paper>

      {tab === 'risk' && risks.length > 0 ? (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, lg: 4 }}>
            <Paper sx={{ borderRadius: 4, p: 2.5 }}>
              <Typography variant="h3" component="h2" sx={{ mb: 1.5 }}>
                Risk heat map
              </Typography>
              <HeatMap heat={heat} selected={cell} onSelect={setCell} />
            </Paper>
          </Grid>
          <Grid size={{ xs: 12, lg: 8 }}>
            <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 2 }}>
                <Typography variant="h3" component="h2">
                  Risks
                </Typography>
                {cell && (
                  <>
                    <Chip size="small" label={`Filtered: P${cell.p} × I${cell.i} · ${list.length} shown`} />
                    <Button size="small" startIcon={<FilterAltOffOutlined />} onClick={() => setCell(null)}>
                      Clear filter
                    </Button>
                  </>
                )}
              </Stack>
              {list.length === 0 ? (
                <Typography color="text.secondary" sx={{ px: 2, pb: 2 }}>
                  No risks at this probability and impact.
                </Typography>
              ) : (
                <RiskTable rows={list} ctx={ctx} />
              )}
            </Paper>
          </Grid>
        </Grid>
      ) : list.length === 0 ? (
        <Paper sx={{ borderRadius: 4 }}>
          <EmptyState title={`No ${meta.plural.toLowerCase()}`} body={EMPTY[tab]} action={addButton} />
        </Paper>
      ) : (
        <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
          <Typography variant="h3" component="h2" sx={{ p: 2 }}>
            {meta.plural}
          </Typography>
          {tab === 'issue' ? (
            <IssueTable rows={list} ctx={ctx} />
          ) : (
            <SimpleTable kind={tab} rows={list} ctx={ctx} />
          )}
        </Paper>
      )}

      {dialog && (
        <RaidDialog
          open
          kind={dialog.kind}
          entry={dialog.entry}
          projectId={project.id}
          projectKey={project.key}
          people={people}
          items={items}
          onClose={() => setDialog(null)}
        />
      )}
    </Stack>
  );
}

interface RowCtx {
  people: Profile[];
  items: WorkItem[];
  itemHref: (key: string) => string;
  canEdit: boolean;
  onEdit: (e: RaidView) => void;
}

const personName = (people: Profile[], id?: string | null) =>
  id ? (people.find((p) => p.id === id)?.name ?? 'Unknown') : 'Unassigned';

function Links({ e, ctx }: { e: RaidView; ctx: RowCtx }) {
  const linked = e.linkedItemIds
    .map((id) => ctx.items.find((i) => i.id === id))
    .filter((i): i is WorkItem => Boolean(i));
  if (!linked.length) return <>—</>;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {linked.map((i) => (
        <Chip
          key={i.id}
          size="small"
          component={Link}
          href={ctx.itemHref(i.key)}
          scroll={false}
          clickable
          label={<Mono>{i.key}</Mono>}
          aria-label={`Open ${i.key} ${i.title}`}
        />
      ))}
    </Stack>
  );
}

function TitleCell({ e, children }: { e: RaidView; children?: React.ReactNode }) {
  return (
    <TableCell sx={{ minWidth: 220 }}>
      <Typography fontWeight={600} fontSize={14}>
        {e.title}
      </Typography>
      {e.description && (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {e.description}
        </Typography>
      )}
      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
        {children}
        <VisibilityChip visibility={e.visibility} showShared />
      </Stack>
    </TableCell>
  );
}

function EditCell({ e, ctx }: { e: RaidView; ctx: RowCtx }) {
  if (!ctx.canEdit) return null;
  return (
    <TableCell padding="checkbox">
      <Tooltip title="Edit">
        <IconButton size="small" aria-label={`Edit ${e.title}`} onClick={() => ctx.onEdit(e)}>
          <EditOutlined fontSize="small" />
        </IconButton>
      </Tooltip>
    </TableCell>
  );
}

function RiskTable({ rows, ctx }: { rows: RaidView[]; ctx: RowCtx }) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label="Risks">
        <TableHead>
          <TableRow>
            <TableCell>Score</TableCell>
            <TableCell>Risk</TableCell>
            <TableCell>Category</TableCell>
            <TableCell>Owner</TableCell>
            <TableCell>Mitigation</TableCell>
            <TableCell>Residual</TableCell>
            <TableCell>ROAM</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Links</TableCell>
            {ctx.canEdit && <TableCell padding="checkbox" aria-label="Actions" />}
          </TableRow>
        </TableHead>
        <TableBody>
          {[...rows]
            .sort(
              (a, b) =>
                Number(a.status === 'closed') - Number(b.status === 'closed') ||
                (b.score ?? 0) - (a.score ?? 0),
            )
            .map((e) => (
              <TableRow key={e.id} data-testid={`raid-${e.id}`}>
                <TableCell>
                  <ScoreChip score={e.score} />
                  <Typography variant="caption" display="block" color="text.secondary">
                    <Mono>
                      P{e.probability} × I{e.impact}
                    </Mono>
                  </Typography>
                </TableCell>
                <TitleCell e={e}>{e.escalate && e.status !== 'closed' && <EscalateChip />}</TitleCell>
                <TableCell>{RISK_CATEGORIES.find((c) => c.id === e.category)?.label ?? '—'}</TableCell>
                <TableCell>{personName(ctx.people, e.ownerId)}</TableCell>
                <TableCell sx={{ minWidth: 200, maxWidth: 280 }}>
                  <Typography variant="body2">{e.mitigation || '—'}</Typography>
                </TableCell>
                <TableCell>
                  <ScoreChip score={e.residualScore} />
                </TableCell>
                <TableCell>{ROAM.find((r) => r.id === e.roam)?.label ?? '—'}</TableCell>
                <TableCell>
                  {RAID_STATUS_LABEL[e.status]}
                  {e.status === 'closed' && e.closureNote && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      {e.closureNote}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Links e={e} ctx={ctx} />
                </TableCell>
                <EditCell e={e} ctx={ctx} />
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function IssueTable({ rows, ctx }: { rows: RaidView[]; ctx: RowCtx }) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label="Issues">
        <TableHead>
          <TableRow>
            <TableCell>Severity</TableCell>
            <TableCell>Issue</TableCell>
            <TableCell>Owner</TableCell>
            <TableCell>SLA due</TableCell>
            <TableCell>Aging</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Links</TableCell>
            {ctx.canEdit && <TableCell padding="checkbox" aria-label="Actions" />}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((e) => (
            <TableRow key={e.id} data-testid={`raid-${e.id}`}>
              <TableCell>
                <SeverityChip severity={e.severity} />
              </TableCell>
              <TitleCell e={e}>
                {e.slaBreached && <SlaBreachedChip />}
                {e.stale && <StaleChip />}
              </TitleCell>
              <TableCell>{personName(ctx.people, e.ownerId)}</TableCell>
              <TableCell>{fmtDateTime(e.slaDue)}</TableCell>
              <TableCell>
                <Mono>
                  {e.agingDays} {e.agingDays === 1 ? 'day' : 'days'}
                </Mono>
              </TableCell>
              <TableCell>{RAID_STATUS_LABEL[e.status]}</TableCell>
              <TableCell>
                <Links e={e} ctx={ctx} />
              </TableCell>
              <EditCell e={e} ctx={ctx} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

function SimpleTable({ kind, rows, ctx }: { kind: RaidKind; rows: RaidView[]; ctx: RowCtx }) {
  const dateLabel = kind === 'decision' ? 'Decided on' : kind === 'dependency' ? 'Needed by' : 'Validate by';
  const meta = RAID_KINDS.find((k) => k.id === kind)!;
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label={meta.plural}>
        <TableHead>
          <TableRow>
            <TableCell>{meta.label}</TableCell>
            <TableCell>Owner</TableCell>
            {kind === 'decision' && <TableCell>Decided by</TableCell>}
            {kind === 'decision' && <TableCell>Rationale</TableCell>}
            <TableCell>{dateLabel}</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Links</TableCell>
            {ctx.canEdit && <TableCell padding="checkbox" aria-label="Actions" />}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((e) => (
            <TableRow key={e.id} data-testid={`raid-${e.id}`}>
              <TitleCell e={e} />
              <TableCell>{personName(ctx.people, e.ownerId)}</TableCell>
              {kind === 'decision' && (
                <TableCell>{e.decidedBy ? personName(ctx.people, e.decidedBy) : '—'}</TableCell>
              )}
              {kind === 'decision' && (
                <TableCell sx={{ maxWidth: 280 }}>
                  <Typography variant="body2">{e.rationale || '—'}</Typography>
                </TableCell>
              )}
              <TableCell>{fmtDate(e.date)}</TableCell>
              <TableCell>{RAID_STATUS_LABEL[e.status]}</TableCell>
              <TableCell>
                <Links e={e} ctx={ctx} />
              </TableCell>
              <EditCell e={e} ctx={ctx} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
