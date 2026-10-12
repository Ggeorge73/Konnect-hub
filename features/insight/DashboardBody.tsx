'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  GlobalStyles,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import WarningAmber from '@mui/icons-material/WarningAmber';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import EventOutlined from '@mui/icons-material/EventOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import type { DashboardView } from '@/lib/data/insight';
import { CPI_WARN, formatMoney, formatRatio, SPI_WARN } from '@/lib/domain/evm';
import { RAG_RULES, RAG_TEXT } from '@/lib/domain/dashboard';
import { BAND_LABEL } from '@/lib/domain/raid';
import { GateTracker } from '@/components/ui/GateTracker';
import { EmptyState, Mono, RagChip } from '@/components/ui/bits';
import { RAG_COLORS } from '@/lib/theme';
import { BudgetBurnChart } from './BudgetBurnChart';
import { RagOverrideDialog } from './RagOverrideDialog';
import { usePatchDashboard } from './api';

/** Print: white background, no navigation, no interactive controls. */
const printStyles = (
  <GlobalStyles
    styles={{
      '@media print': {
        'body, #main': { background: '#fff !important', color: '#000 !important' },
        'nav, header, .MuiDrawer-root, .MuiAppBar-root, .MuiTabs-root, [role="tablist"], .kh-no-print, a[href="#main"]':
          {
            display: 'none !important',
          },
        '.MuiPaper-root': {
          background: '#fff !important',
          backdropFilter: 'none !important',
          boxShadow: 'none !important',
          border: '1px solid #CBD5E1 !important',
          breakInside: 'avoid',
        },
        '.MuiTypography-root, .MuiChip-label, .MuiListItemText-secondary, [aria-label^="Score"]': {
          color: '#0F172A !important',
        },
        '@page': { size: 'letter landscape', margin: '10mm' },
      },
    }}
  />
);

const Card = ({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <Paper component="section" aria-label={title} sx={{ p: 2.5, borderRadius: 4, height: '100%' }}>
    <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
      <Typography variant="h3" component="h2" sx={{ flex: 1 }}>
        {title}
      </Typography>
      {action}
    </Stack>
    {children}
  </Paper>
);

function Tile({
  label,
  value,
  warning,
  hint,
}: {
  label: string;
  value: string;
  warning?: string | false;
  hint?: string;
}) {
  return (
    <Paper
      sx={{
        p: 2,
        borderRadius: 4,
        height: '100%',
        borderColor: warning ? `${RAG_COLORS.amber} !important` : undefined,
      }}
      aria-label={`${label}: ${value}${warning ? `. Warning: ${warning}` : ''}`}
      role="group"
    >
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography
        sx={{ fontSize: { xs: 20, sm: 26 }, fontWeight: 700, lineHeight: 1.3, whiteSpace: 'nowrap' }}
      >
        <Mono>{value}</Mono>
      </Typography>
      {warning ? (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'warning.main' }}>
          <WarningAmber sx={{ fontSize: 16 }} aria-hidden />
          <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 600 }}>
            {warning}
          </Typography>
        </Stack>
      ) : (
        hint && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )
      )}
    </Paper>
  );
}

const MILESTONE_ICON = { sprint: EventOutlined, gate: FlagOutlined, deliverable: Inventory2Outlined };
const ACTION_LABEL = { item: 'Work item', deliverable: 'Deliverable', raid: 'RAID' };
const fmtDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** The executive one-pager. `portal` renders the client-safe variant without Lead controls. */
export function DashboardBody({ view, portal = false }: { view: DashboardView; portal?: boolean }) {
  const [overrideOpen, setOverrideOpen] = useState(false);
  const patch = usePatchDashboard(view.projectKey);
  const pdfHref = `/api/projects/${view.projectKey}/dashboard.pdf`;
  const evm = view.evm;
  return (
    <Stack spacing={2}>
      {printStyles}
      <Paper sx={{ p: 2.5, borderRadius: 4 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h2" component="h2">
              Executive dashboard
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {view.projectName} · {view.clientName} · Lead {view.leadName} · as of{' '}
              <Mono>{fmtDate(view.asOf)}</Mono>
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} className="kh-no-print" flexWrap="wrap" useFlexGap>
            {view.canOverride && !portal && (
              <Button startIcon={<EditOutlined />} variant="outlined" onClick={() => setOverrideOpen(true)}>
                Override RAG
              </Button>
            )}
            <Button startIcon={<PrintOutlined />} onClick={() => window.print()}>
              Print
            </Button>
            <Button
              startIcon={<PictureAsPdfOutlined />}
              variant="contained"
              component="a"
              href={pdfHref}
              download
            >
              Export PDF
            </Button>
          </Stack>
        </Stack>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ mt: 2 }}
          alignItems={{ sm: 'center' }}
        >
          <Stack direction="row" spacing={1} alignItems="center" data-testid="current-rag">
            <Typography variant="body2" color="text.secondary">
              Current:
            </Typography>
            <RagChip rag={view.rag} size="medium" />
          </Stack>
          {view.suggested && (
            <Tooltip
              title={
                view.suggested.reasons.length
                  ? view.suggested.reasons.join(' · ')
                  : 'No rule fired: schedule, cost, risks and issues are within limits.'
              }
            >
              <Chip
                data-testid="suggested-rag"
                variant="outlined"
                label={`Suggested: ${RAG_TEXT[view.suggested.rag]}`}
                icon={
                  <Box
                    component="span"
                    aria-hidden
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: RAG_COLORS[view.suggested.rag],
                      ml: 1,
                    }}
                  />
                }
              />
            </Tooltip>
          )}
          {view.ragReason && (
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
              <strong>Reason:</strong> {view.ragReason}
            </Typography>
          )}
        </Stack>
        {view.suggested && view.suggested.rag !== 'green' && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            {RAG_TEXT[view.suggested.rag]} rule: {RAG_RULES[view.suggested.rag]}. Fired:{' '}
            {view.suggested.reasons.join('; ')}.
          </Typography>
        )}
        {view.canOverride && !portal && (
          <FormControlLabel
            className="kh-no-print"
            sx={{ mt: 1 }}
            control={
              <Switch
                checked={view.shareBudget}
                disabled={patch.isPending}
                onChange={(e) => patch.mutate({ shareBudget: e.target.checked })}
              />
            }
            label="Share budget and earned value on the client portal"
          />
        )}
      </Paper>

      {evm ? (
        <Grid container spacing={2} component="section" aria-label="Earned value">
          <Grid size={{ xs: 6, md: 4, xl: evm.bac !== null ? 2 : 4 }}>
            <Tile
              label="SPI (schedule)"
              value={formatRatio(evm.spi)}
              warning={evm.spiWarning && `Below ${SPI_WARN} — behind schedule`}
              hint={evm.spi === null ? 'No planned value yet' : 'EV ÷ PV'}
            />
          </Grid>
          <Grid size={{ xs: 6, md: 4, xl: evm.bac !== null ? 2 : 4 }}>
            <Tile
              label="CPI (cost)"
              value={formatRatio(evm.cpi)}
              warning={evm.cpiWarning && `Below ${CPI_WARN} — over cost`}
              hint={evm.cpi === null ? 'No actual cost yet' : 'EV ÷ AC'}
            />
          </Grid>
          <Grid size={{ xs: 6, md: 4, xl: evm.bac !== null ? 2 : 4 }}>
            <Tile
              label="Complete (weighted)"
              value={`${evm.percentComplete.toFixed(1)}%`}
              hint="Milestones × weight"
            />
          </Grid>
          {evm.bac !== null && (
            <>
              <Grid size={{ xs: 6, md: 4, xl: 2 }}>
                <Tile label="BAC" value={formatMoney(evm.bac)} hint="Budget at completion" />
              </Grid>
              <Grid size={{ xs: 6, md: 4, xl: 2 }}>
                <Tile label="EAC" value={formatMoney(evm.eac)} hint="AC + (BAC − EV) ÷ CPI" />
              </Grid>
              <Grid size={{ xs: 6, md: 4, xl: 2 }}>
                <Tile
                  label="VAC"
                  value={formatMoney(evm.vac)}
                  warning={evm.vac !== null && evm.vac < 0 && 'Forecast over budget'}
                  hint="BAC − EAC"
                />
              </Grid>
            </>
          )}
        </Grid>
      ) : (
        <Alert severity="info" variant="outlined">
          Budget and earned value are not shared on this dashboard.
        </Alert>
      )}

      <Card title="Gate progress">
        <GateTracker phases={view.phases} />
      </Card>

      <Grid container spacing={2}>
        {view.burn && (
          <Grid size={{ xs: 12, lg: 7 }}>
            <Card
              title="Budget burn"
              action={!portal && <Chip size="small" label="Internal" color="warning" variant="outlined" />}
            >
              {evm?.ac !== null && evm && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  PV <Mono>{formatMoney(evm.pv)}</Mono> · EV <Mono>{formatMoney(evm.ev)}</Mono> · AC{' '}
                  <Mono>{formatMoney(evm.ac)}</Mono>
                </Typography>
              )}
              <BudgetBurnChart data={view.burn} asOf={view.asOf} />
            </Card>
          </Grid>
        )}
        <Grid size={{ xs: 12, lg: view.burn ? 5 : 6 }}>
          <Card title="Top 3 risks">
            {view.topRisks.length === 0 ? (
              <EmptyState title="No open risks" body="Open risks with a score appear here, highest first." />
            ) : (
              <List dense disablePadding data-testid="top-risks">
                {view.topRisks.map((r) => (
                  <ListItem key={r.id} disableGutters>
                    <Box
                      sx={{
                        minWidth: 44,
                        mr: 1.5,
                        textAlign: 'center',
                        border: '1px solid',
                        borderColor: RAG_COLORS[r.band ?? 'green'],
                        borderRadius: 2,
                        py: 0.25,
                      }}
                      aria-label={`Score ${r.score}, ${BAND_LABEL[r.band ?? 'green']}`}
                    >
                      <Mono>{r.score}</Mono>
                    </Box>
                    <ListItemText
                      primary={r.title}
                      secondary={`${BAND_LABEL[r.band ?? 'green']} · Owner ${r.ownerName}${r.escalate ? ' · Escalated to steering' : ''}`}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: view.burn ? 6 : 6 }}>
          <Card title="Key milestones">
            {view.milestones.length === 0 ? (
              <EmptyState
                title="No dated milestones"
                body="Sprint ends, gate targets and deliverable due dates appear here."
              />
            ) : (
              <List dense disablePadding>
                {view.milestones.map((m) => {
                  const Icon = MILESTONE_ICON[m.kind];
                  return (
                    <ListItem
                      key={`${m.kind}-${m.label}-${m.date}`}
                      disableGutters
                      sx={{ opacity: m.past ? 0.7 : 1 }}
                    >
                      <Icon sx={{ mr: 1.5, color: 'primary.main', fontSize: 20 }} aria-hidden />
                      <ListItemText
                        primary={m.label}
                        secondary={
                          <>
                            <Mono>{fmtDate(m.date)}</Mono>
                            {m.past ? ' · passed' : ''}
                          </>
                        }
                      />
                    </ListItem>
                  );
                })}
              </List>
            )}
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: view.burn ? 6 : 12 }}>
          <Card title="Next 30 days">
            {view.actions.length === 0 ? (
              <EmptyState
                title="Nothing due"
                body="Open items and deliverables due in the next 30 days appear here."
              />
            ) : (
              <List dense disablePadding data-testid="next-actions">
                {view.actions.map((a) => (
                  <ListItem key={`${a.kind}-${a.ref}`} disableGutters>
                    <ListItemText
                      primary={
                        <Link href={a.href} style={{ color: 'inherit' }}>
                          {a.title}
                        </Link>
                      }
                      secondary={
                        <>
                          {ACTION_LABEL[a.kind]}
                          {a.kind === 'item' && (
                            <>
                              {' '}
                              <Mono>{a.ref}</Mono>
                            </>
                          )}{' '}
                          · due <Mono>{fmtDate(a.due)}</Mono>
                        </>
                      }
                    />
                    {a.overdue && (
                      <Chip
                        size="small"
                        color="error"
                        variant="outlined"
                        icon={<WarningAmber />}
                        label="Overdue"
                        sx={{ ml: 1 }}
                      />
                    )}
                  </ListItem>
                ))}
              </List>
            )}
          </Card>
        </Grid>
      </Grid>
      {view.canOverride && !portal && (
        <RagOverrideDialog
          key={String(overrideOpen)}
          projectKey={view.projectKey}
          current={view.rag}
          suggested={view.suggested?.rag}
          open={overrideOpen}
          onClose={() => setOverrideOpen(false)}
        />
      )}
    </Stack>
  );
}
