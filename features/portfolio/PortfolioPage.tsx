'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import GridViewOutlined from '@mui/icons-material/GridViewOutlined';
import TableRowsOutlined from '@mui/icons-material/TableRowsOutlined';
import Add from '@mui/icons-material/Add';
import { useMe, useProjects } from '@/lib/client/api';
import { EmptyState, Mono, RagChip } from '@/components/ui/bits';
import { CreateProjectDialog } from '@/features/projects/CreateProjectDialog';
import { canCreateProject, canSeeFinancials } from '@/lib/domain/permissions';
import { Globe } from './Globe';
import type { ProjectSummary } from '@/lib/data/repo';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function PortfolioPage({ title = 'Portfolio' }: { title?: string }) {
  const { data: projects, isLoading } = useProjects();
  const { data: me } = useMe();
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [creating, setCreating] = useState(false);
  const canCreate = me ? canCreateProject(me.user) : false;
  const showMoney = me ? canSeeFinancials(me.user) : false;
  const list = projects ?? [];
  const metrics = [
    { label: 'Active projects', value: list.length },
    { label: 'At risk or off track', value: list.filter((p) => p.rag !== 'green').length },
    { label: 'Open critical items', value: list.reduce((a, p) => a + p.openCritical, 0) },
    ...(showMoney ? [{ label: 'Total budget (BAC)', value: usd(list.reduce((a, p) => a + p.bac, 0)) }] : []),
  ];

  return (
    <Box>
      <Box sx={{ position: 'relative', overflow: 'hidden', mb: 3, pl: 0.5, pt: 0.5 }}>
        <Box
          sx={{
            position: 'absolute',
            right: -60,
            top: -80,
            pointerEvents: 'none',
            display: { xs: 'none', md: 'block' },
          }}
        >
          <Globe />
        </Box>
        <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2, position: 'relative' }}>
          <Typography variant="h1">{title}</Typography>
          <Box sx={{ flex: 1 }} />
          <ToggleButtonGroup
            size="small"
            value={view}
            exclusive
            onChange={(_, v) => v && setView(v)}
            aria-label="View"
          >
            <ToggleButton value="cards" aria-label="Card view">
              <GridViewOutlined fontSize="small" />
            </ToggleButton>
            <ToggleButton value="table" aria-label="Table view">
              <TableRowsOutlined fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
          {canCreate && (
            <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)}>
              New project
            </Button>
          )}
        </Stack>
        <Grid container spacing={2} sx={{ position: 'relative' }}>
          {metrics.map((m) => (
            <Grid key={m.label} size={{ xs: 6, md: 3 }}>
              <Paper sx={{ p: 2, borderRadius: 4 }}>
                <Typography variant="caption" color="text.secondary">
                  {m.label}
                </Typography>
                <Typography variant="h2">
                  <Mono>{m.value}</Mono>
                </Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>
      </Box>

      {isLoading ? (
        <Grid container spacing={2}>
          {[0, 1, 2].map((i) => (
            <Grid key={i} size={{ xs: 12, md: 4 }}>
              <Skeleton variant="rounded" height={180} />
            </Grid>
          ))}
        </Grid>
      ) : list.length === 0 ? (
        <Paper sx={{ borderRadius: 4 }}>
          <EmptyState
            title="No projects yet"
            body="Start from the Konnect Delivery Framework template: five gates, exit criteria and a board, ready in under two minutes."
            action={
              canCreate ? (
                <Button variant="contained" onClick={() => setCreating(true)}>
                  Create the first project
                </Button>
              ) : undefined
            }
          />
        </Paper>
      ) : view === 'cards' ? (
        <Grid container spacing={2}>
          {list.map((p) => (
            <Grid key={p.id} size={{ xs: 12, md: 6, lg: 4 }}>
              <ProjectCard p={p} showMoney={showMoney} />
            </Grid>
          ))}
        </Grid>
      ) : (
        <Paper sx={{ borderRadius: 4, overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Project</TableCell>
                <TableCell>Client</TableCell>
                <TableCell>Lead</TableCell>
                <TableCell>Gate</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">% complete</TableCell>
                <TableCell>Next milestone</TableCell>
                <TableCell align="right">Critical</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell>
                    <Link href={`/projects/${p.key}`} style={{ color: 'inherit' }}>
                      <Mono>{p.key}</Mono> {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>{p.clientName}</TableCell>
                  <TableCell>{p.leadName}</TableCell>
                  <TableCell>
                    {p.currentGate} · {p.currentGateName}
                  </TableCell>
                  <TableCell>
                    <RagChip rag={p.rag} reason={p.ragReason} />
                  </TableCell>
                  <TableCell align="right">
                    <Mono>{p.percentComplete}%</Mono>
                  </TableCell>
                  <TableCell>
                    {p.nextMilestone?.name} <Mono>{p.nextMilestone?.date}</Mono>
                  </TableCell>
                  <TableCell align="right">
                    <Mono>{p.openCritical}</Mono>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      {creating && <CreateProjectDialog open onClose={() => setCreating(false)} />}
    </Box>
  );
}

function ProjectCard({ p, showMoney }: { p: ProjectSummary; showMoney: boolean }) {
  return (
    <Card>
      <CardActionArea component={Link} href={`/projects/${p.key}`} sx={{ height: '100%' }}>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Chip size="small" label={<Mono>{p.key}</Mono>} />
            {p.restricted && <Chip size="small" color="warning" variant="outlined" label="Restricted" />}
            <Box sx={{ flex: 1 }} />
            <RagChip rag={p.rag} reason={p.ragReason} />
          </Stack>
          <Typography variant="h3" gutterBottom>
            {p.name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {p.clientName} · Lead: {p.leadName}
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Gate {p.currentGate}: <strong>{p.currentGateName}</strong>
          </Typography>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.5 }}>
            <LinearProgress
              variant="determinate"
              value={p.percentComplete}
              sx={{ flex: 1, height: 6, borderRadius: 3 }}
              aria-label="Percent complete"
            />
            <Typography variant="caption">
              <Mono>{p.percentComplete}%</Mono>
            </Typography>
          </Stack>
          <Stack direction="row" spacing={2} sx={{ mt: 1.5 }}>
            <Typography variant="caption" color="text.secondary">
              Next: {p.nextMilestone?.name} <Mono>{p.nextMilestone?.date}</Mono>
            </Typography>
            <Typography variant="caption" color={p.openCritical ? 'error.main' : 'text.secondary'}>
              {p.openCritical} critical open
            </Typography>
            {showMoney && (
              <Typography variant="caption" color="text.secondary">
                BAC <Mono>{usd(p.bac)}</Mono>
              </Typography>
            )}
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
