'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  InputAdornment,
  MenuItem,
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
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import Search from '@mui/icons-material/Search';
import ViewModuleOutlined from '@mui/icons-material/ViewModuleOutlined';
import TableRowsOutlined from '@mui/icons-material/TableRowsOutlined';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import { useMe } from '@/lib/client/api';
import { ROLE_LABEL } from '@/lib/domain/permissions';
import { canViewGrid, filterDirectory, loadLevel, type DirectoryEntry } from '@/lib/domain/capacity';
import { EmptyState, Mono } from '@/components/ui/bits';
import { useDirectory } from './api';
import { LoadChip } from './CapacityChips';
import { ProfileDrawer } from './ProfileDrawer';

const initials = (name: string) =>
  name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');

/** Directory / Allocation grid sub-navigation for /people. */
export function PeopleTabs() {
  const { data: me } = useMe();
  const path = usePathname();
  const showGrid = me ? canViewGrid(me.user) : false;
  return (
    <Stack spacing={1} sx={{ mb: 2 }}>
      <Typography variant="h1">People</Typography>
      <Tabs value={path.startsWith('/people/allocations') ? 'grid' : 'dir'} aria-label="People sections">
        <Tab value="dir" label="Directory" component={Link} href="/people" />
        {showGrid && <Tab value="grid" label="Allocation grid" component={Link} href="/people/allocations" />}
      </Tabs>
    </Stack>
  );
}

function UsFlag({ p }: { p: DirectoryEntry }) {
  if (p.usPerson === undefined) return null;
  return (
    <Chip
      size="small"
      icon={<FlagOutlined sx={{ fontSize: 14 }} />}
      label={p.usPerson ? 'U.S. person' : 'Non-U.S.'}
      variant="outlined"
      sx={{ height: 22, fontSize: 11 }}
    />
  );
}

function Tags({ tags, label }: { tags: string[]; label: string }) {
  if (!tags.length) return null;
  return (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" aria-label={label}>
      {tags.map((t) => (
        <Chip key={t} size="small" label={t} sx={{ height: 22, fontSize: 11 }} />
      ))}
    </Stack>
  );
}

export function PeopleDirectory() {
  const { data, isLoading, error } = useDirectory();
  const [q, setQ] = useState('');
  const [skill, setSkill] = useState('');
  const [role, setRole] = useState('');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => data ?? [], [data]);
  const skills = useMemo(
    () => [...new Set(list.flatMap((p) => [...p.skills, ...(p.certifications ?? [])]))].sort(),
    [list],
  );
  const roles = useMemo(() => [...new Set(list.map((p) => p.role).filter(Boolean))] as string[], [list]);
  const shown = filterDirectory(list, { q, skill, role });
  const details = list.some((p) => p.role !== undefined);
  const showUs = list.some((p) => p.usPerson !== undefined);
  const showRate = list.some((p) => p.costRate !== undefined);

  return (
    <Box>
      <PeopleTabs />
      <Paper sx={{ p: 2, borderRadius: 4, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
          <TextField
            size="small"
            label="Search people"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ minWidth: 240 }}
          />
          <TextField
            select
            size="small"
            label="Skill"
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">Any skill</MenuItem>
            {skills.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </TextField>
          {details && (
            <TextField
              select
              size="small"
              label="Role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value="">Any role</MenuItem>
              {roles.map((r) => (
                <MenuItem key={r} value={r}>
                  {ROLE_LABEL[r as keyof typeof ROLE_LABEL]}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Box sx={{ flex: 1 }} />
          <ToggleButtonGroup
            size="small"
            exclusive
            value={view}
            onChange={(_, v) => v && setView(v)}
            aria-label="Directory view"
          >
            <ToggleButton value="cards" aria-label="Card view">
              <ViewModuleOutlined fontSize="small" />
            </ToggleButton>
            <ToggleButton value="table" aria-label="Table view">
              <TableRowsOutlined fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Paper>

      {error && <Alert severity="error">{error.message}</Alert>}
      {isLoading && <Skeleton variant="rounded" height={240} />}
      {data && !shown.length && (
        <Paper sx={{ borderRadius: 4 }}>
          <EmptyState
            title="No one matches"
            body="Try another name, skill or role."
            action={
              <Button
                onClick={() => {
                  setQ('');
                  setSkill('');
                  setRole('');
                }}
              >
                Clear filters
              </Button>
            }
          />
        </Paper>
      )}

      {data && shown.length > 0 && view === 'cards' && (
        <Grid container spacing={2} component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }} aria-label="People">
          {shown.map((p) => (
            <Grid key={p.id} size={{ xs: 12, sm: 6, lg: 4 }} component="li">
              <Paper
                component="button"
                type="button"
                onClick={() => setOpen(p.id)}
                aria-label={`Open profile: ${p.name}`}
                sx={{
                  p: 2,
                  borderRadius: 4,
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  border: 1,
                  borderColor: 'divider',
                  color: 'text.primary',
                  font: 'inherit',
                  height: '100%',
                }}
              >
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
                  <Avatar sx={{ bgcolor: 'primary.main', color: 'primary.contrastText' }}>
                    {initials(p.name)}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography fontWeight={600} noWrap>
                      {p.name}
                    </Typography>
                    {p.title && (
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {p.title}
                        {p.role ? ` · ${ROLE_LABEL[p.role]}` : ''}
                      </Typography>
                    )}
                  </Box>
                  {p.allocationPct !== undefined && (
                    <LoadChip pct={p.allocationPct} level={loadLevel(p.allocationPct)} />
                  )}
                </Stack>
                <Stack spacing={1}>
                  <Tags tags={p.skills} label={`Skills of ${p.name}`} />
                  {p.certifications && <Tags tags={p.certifications} label={`Certifications of ${p.name}`} />}
                  {(p.location || p.timezone || p.hoursPerWeek !== undefined) && (
                    <Typography variant="caption" color="text.secondary">
                      {[p.location, p.timezone].filter(Boolean).join(' · ')}
                      {p.hoursPerWeek !== undefined && (
                        <>
                          {' · '}
                          <Mono>{p.hoursPerWeek} h/wk</Mono>
                        </>
                      )}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1}>
                    <UsFlag p={p} />
                    {p.costRate !== undefined && (
                      <Chip size="small" label={`$${p.costRate}/h`} sx={{ height: 22, fontSize: 11 }} />
                    )}
                  </Stack>
                </Stack>
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}

      {data && shown.length > 0 && view === 'table' && (
        <Paper sx={{ borderRadius: 4, overflowX: 'auto' }}>
          <Table size="small" aria-label="People directory">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                {details && <TableCell>Role and title</TableCell>}
                <TableCell>Skills</TableCell>
                {details && <TableCell>Certifications</TableCell>}
                {details && <TableCell>Location / time zone</TableCell>}
                {details && <TableCell align="right">Hours / week</TableCell>}
                {details && <TableCell>Allocation</TableCell>}
                {showUs && <TableCell>U.S. person</TableCell>}
                {showRate && <TableCell align="right">Cost rate</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell>
                    <Button size="small" onClick={() => setOpen(p.id)} sx={{ fontWeight: 600 }}>
                      {p.name}
                    </Button>
                  </TableCell>
                  {details && (
                    <TableCell>
                      {p.role ? ROLE_LABEL[p.role] : '—'}
                      <Typography variant="body2" color="text.secondary">
                        {p.title}
                      </Typography>
                    </TableCell>
                  )}
                  <TableCell>
                    <Tags tags={p.skills} label={`Skills of ${p.name}`} />
                  </TableCell>
                  {details && (
                    <TableCell>
                      <Tags tags={p.certifications ?? []} label={`Certifications of ${p.name}`} />
                    </TableCell>
                  )}
                  {details && (
                    <TableCell>{[p.location, p.timezone].filter(Boolean).join(' · ') || '—'}</TableCell>
                  )}
                  {details && (
                    <TableCell align="right">
                      <Mono>{p.hoursPerWeek}</Mono>
                    </TableCell>
                  )}
                  {details && (
                    <TableCell>
                      {p.allocationPct !== undefined && (
                        <LoadChip pct={p.allocationPct} level={loadLevel(p.allocationPct)} />
                      )}
                    </TableCell>
                  )}
                  {showUs && <TableCell>{p.usPerson ? 'Yes' : 'No'}</TableCell>}
                  {showRate && (
                    <TableCell align="right">
                      <Mono>{p.costRate !== undefined ? `$${p.costRate}` : '—'}</Mono>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      <ProfileDrawer id={open} onClose={() => setOpen(null)} />
    </Box>
  );
}
