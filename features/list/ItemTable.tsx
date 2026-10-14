'use client';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  IconButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import ViewColumnOutlined from '@mui/icons-material/ViewColumnOutlined';
import BookmarkAddOutlined from '@mui/icons-material/BookmarkAddOutlined';
import { prefetchItem, useBulkUpdate, useItems, useMe, usePeople, useUpdateItem } from '@/lib/client/api';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import { DEFAULT_STATUSES, PRIORITIES, STATUS_LABEL, ITEM_TYPES } from '@/lib/domain/workflow';
import { canEditItems, isClientRole } from '@/lib/domain/permissions';
import type { ItemStatus, Priority, WorkItem } from '@/lib/domain/types';
import { ItemKey, Mono, TypeIcon, VisibilityChip, EmptyState } from '@/components/ui/bits';
import { useHotkeys } from '@/components/shell/useHotkeys';
import { sortItems, groupItems, type SortKey, type GroupKey } from './tableModel';
import { CreateItemAction } from '@/components/ui/EmptyActions';
import { ExportMenu } from '@/features/exports/ExportMenu';

const COLUMNS: { id: string; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'key', label: 'Key' },
  { id: 'title', label: 'Title' },
  { id: 'status', label: 'Status' },
  { id: 'priority', label: 'Priority' },
  { id: 'assignee', label: 'Assignee' },
  { id: 'sprint', label: 'Sprint' },
  { id: 'estimate', label: 'Estimate' },
  { id: 'due', label: 'Due' },
  { id: 'labels', label: 'Labels' },
  { id: 'visibility', label: 'Visibility' },
];
interface View {
  name: string;
  sort: SortKey;
  dir: 'asc' | 'desc';
  group: GroupKey;
  cols: string[];
}
const DEFAULT_VIEW: View = {
  name: 'Default',
  sort: 'key',
  dir: 'asc',
  group: 'none',
  cols: COLUMNS.map((c) => c.id),
};
const storeKey = (p: string) => `kh_views_${p}`;

function loadViews(projectKey: string): View[] {
  try {
    return JSON.parse(localStorage.getItem(storeKey(projectKey)) ?? '[]');
  } catch {
    return [];
  }
}

export function ItemTable() {
  const b = useProjectBundle();
  const { data: items = [] } = useItems(b.project.id);
  const { data: people = [] } = usePeople();
  const { data: me } = useMe();
  const update = useUpdateItem(b.project.id);
  const bulk = useBulkUpdate(b.project.id);
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [saved, setSaved] = useState<View[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [colAnchor, setColAnchor] = useState<HTMLElement | null>(null);
  const [q, setQ] = useState('');
  const editable = me ? canEditItems(me.user) : false;

  useEffect(() => setSaved(loadViews(b.project.key)), [b.project.key]);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtered = t
      ? items.filter((i) => i.title.toLowerCase().includes(t) || i.key.toLowerCase().includes(t))
      : items;
    return sortItems(filtered, view.sort, view.dir, people);
  }, [items, view, people, q]);
  const groups = useMemo(
    () => groupItems(rows, view.group, people, b.sprints),
    [rows, view.group, people, b.sprints],
  );
  const flat = groups.flatMap((g) => g.items);

  const open = (key: string) => {
    const sp = new URLSearchParams(params.toString());
    sp.set('item', key);
    router.replace(`${pathname}?${sp}`, { scroll: false });
  };
  useHotkeys({
    j: () => setCursor((c) => Math.min(c + 1, flat.length - 1)),
    k: () => setCursor((c) => Math.max(c - 1, 0)),
    Enter: () => flat[cursor] && open(flat[cursor].key),
    x: () => flat[cursor] && toggle(flat[cursor].id),
  });

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const sortBy = (k: SortKey) =>
    setView((v) => ({ ...v, sort: k, dir: v.sort === k && v.dir === 'asc' ? 'desc' : 'asc' }));
  const saveView = () => {
    const name = window.prompt('Name this view');
    if (!name) return;
    const next = [...saved.filter((v) => v.name !== name), { ...view, name }];
    setSaved(next);
    try {
      localStorage.setItem(storeKey(b.project.key), JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  const show = (c: string) => view.cols.includes(c);
  const assignable = people.filter((p) => !isClientRole(p.role));
  const doBulk = (patch: Parameters<typeof bulk.mutate>[0]['patch']) =>
    bulk.mutate({ ids: [...selected], patch }, { onSuccess: () => setSelected(new Set()) });

  const sortable = (k: SortKey, label: string) => (
    <TableSortLabel
      active={view.sort === k}
      direction={view.sort === k ? view.dir : 'asc'}
      onClick={() => sortBy(k)}
    >
      {label}
    </TableSortLabel>
  );

  return (
    <Paper sx={{ borderRadius: 4 }}>
      <Toolbar sx={{ gap: 1, flexWrap: 'wrap', py: 1 }}>
        <TextField
          size="small"
          placeholder="Filter"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Filter rows' } }}
        />
        <TextField
          select
          size="small"
          label="Group by"
          value={view.group}
          onChange={(e) => setView((v) => ({ ...v, group: e.target.value as GroupKey }))}
          sx={{ minWidth: 140 }}
        >
          {['none', 'status', 'assignee', 'type', 'priority', 'sprint'].map((g) => (
            <MenuItem key={g} value={g} sx={{ textTransform: 'capitalize' }}>
              {g}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Saved view"
          value=""
          onChange={(e) => {
            const v = [DEFAULT_VIEW, ...saved].find((x) => x.name === e.target.value);
            if (v) setView(v);
          }}
          sx={{ minWidth: 150 }}
        >
          {[DEFAULT_VIEW, ...saved].map((v) => (
            <MenuItem key={v.name} value={v.name}>
              {v.name}
            </MenuItem>
          ))}
        </TextField>
        <Tooltip title="Save current view">
          <IconButton aria-label="Save view" onClick={saveView}>
            <BookmarkAddOutlined />
          </IconButton>
        </Tooltip>
        <Tooltip title="Choose columns">
          <IconButton aria-label="Choose columns" onClick={(e) => setColAnchor(e.currentTarget)}>
            <ViewColumnOutlined />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={colAnchor} open={Boolean(colAnchor)} onClose={() => setColAnchor(null)}>
          {COLUMNS.map((c) => (
            <MenuItem
              key={c.id}
              onClick={() =>
                setView((v) => ({
                  ...v,
                  cols: v.cols.includes(c.id) ? v.cols.filter((x) => x !== c.id) : [...v.cols, c.id],
                }))
              }
            >
              <Checkbox size="small" checked={show(c.id)} />
              <ListItemText primary={c.label} />
            </MenuItem>
          ))}
        </Menu>
        <ExportMenu
          entity="items"
          params={{
            project: b.project.key,
            sort: view.sort,
            dir: view.dir,
            q,
            cols: COLUMNS.filter((c) => show(c.id)).map((c) => c.id),
          }}
        />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          j/k to move, Enter to open, x to select
        </Typography>
      </Toolbar>
      {selected.size > 0 && editable && (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ px: 2, py: 1, bgcolor: 'rgba(20,184,166,0.1)', flexWrap: 'wrap' }}
          role="region"
          aria-label="Bulk edit"
        >
          <Typography variant="body2" fontWeight={600}>
            {selected.size} selected
          </Typography>
          <Select
            size="small"
            displayEmpty
            value=""
            onChange={(e) => doBulk({ status: e.target.value as ItemStatus })}
            renderValue={() => 'Set status'}
          >
            {DEFAULT_STATUSES.filter((s) => s.id !== 'accepted').map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.label}
              </MenuItem>
            ))}
          </Select>
          <Select
            size="small"
            displayEmpty
            value=""
            onChange={(e) => doBulk({ assigneeId: (e.target.value as string) || null })}
            renderValue={() => 'Set assignee'}
          >
            <MenuItem value="">Unassigned</MenuItem>
            {assignable.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
          <Select
            size="small"
            displayEmpty
            value=""
            onChange={(e) => doBulk({ sprintId: (e.target.value as string) || null })}
            renderValue={() => 'Move to sprint'}
          >
            <MenuItem value="">Backlog</MenuItem>
            {b.sprints.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </Select>
          <Button
            size="small"
            onClick={() => {
              const l = window.prompt('Add label');
              if (l)
                bulk.mutate(
                  { ids: [...selected], patch: {} },
                  {
                    onSuccess: () =>
                      Promise.all(
                        [...selected].map((id) =>
                          update.mutateAsync({
                            id,
                            patch: {
                              labels: [...new Set([...(items.find((i) => i.id === id)?.labels ?? []), l])],
                            },
                          }),
                        ),
                      ).then(() => setSelected(new Set())),
                  },
                );
            }}
          >
            Add label
          </Button>
          <Button size="small" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          {bulk.error && <Alert severity="error">{bulk.error.message}</Alert>}
        </Stack>
      )}
      {items.length === 0 ? (
        <EmptyState
          title="No work items yet"
          body="Create the first item with the Create button or press c."
          action={editable ? <CreateItemAction projectKey={b.project.key} /> : undefined}
        />
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" stickyHeader aria-label="Work items">
            <TableHead>
              <TableRow>
                {editable && (
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      inputProps={{ 'aria-label': 'Select all' }}
                      checked={selected.size === flat.length && flat.length > 0}
                      indeterminate={selected.size > 0 && selected.size < flat.length}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(flat.map((i) => i.id)) : new Set())
                      }
                    />
                  </TableCell>
                )}
                {show('type') && <TableCell>{sortable('type', 'Type')}</TableCell>}
                {show('key') && <TableCell>{sortable('key', 'Key')}</TableCell>}
                {show('title') && <TableCell>{sortable('title', 'Title')}</TableCell>}
                {show('status') && <TableCell>{sortable('status', 'Status')}</TableCell>}
                {show('priority') && <TableCell>{sortable('priority', 'Priority')}</TableCell>}
                {show('assignee') && <TableCell>{sortable('assignee', 'Assignee')}</TableCell>}
                {show('sprint') && <TableCell>Sprint</TableCell>}
                {show('estimate') && <TableCell align="right">{sortable('estimate', 'Est.')}</TableCell>}
                {show('due') && <TableCell>{sortable('due', 'Due')}</TableCell>}
                {show('labels') && <TableCell>Labels</TableCell>}
                {show('visibility') && <TableCell>Visibility</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.map((g) => [
                view.group !== 'none' && (
                  <TableRow key={'g' + g.id}>
                    <TableCell colSpan={13} sx={{ fontWeight: 700, bgcolor: 'action.hover' }}>
                      {g.label} ({g.items.length})
                    </TableCell>
                  </TableRow>
                ),
                ...g.items.map((i) => {
                  const idx = flat.indexOf(i);
                  return (
                    <TableRow
                      key={i.id}
                      hover
                      selected={idx === cursor || selected.has(i.id)}
                      onMouseEnter={() => prefetchItem(qc, i.key)}
                      sx={{ cursor: 'pointer' }}
                      data-testid={`row-${i.key}`}
                    >
                      {editable && (
                        <TableCell padding="checkbox">
                          <Checkbox
                            size="small"
                            checked={selected.has(i.id)}
                            onChange={() => toggle(i.id)}
                            inputProps={{ 'aria-label': `Select ${i.key}` }}
                          />
                        </TableCell>
                      )}
                      {show('type') && (
                        <TableCell>
                          <TypeIcon type={i.type} />
                        </TableCell>
                      )}
                      {show('key') && (
                        <TableCell onClick={() => open(i.key)}>
                          <ItemKey k={i.key} />
                        </TableCell>
                      )}
                      {show('title') && (
                        <TableCell onClick={() => open(i.key)} sx={{ minWidth: 240 }}>
                          {i.title}
                        </TableCell>
                      )}
                      {show('status') && (
                        <TableCell>
                          <InlineSelect
                            disabled={!editable}
                            value={i.status}
                            options={DEFAULT_STATUSES.map((s) => ({ id: s.id, label: s.label }))}
                            onChange={(v) =>
                              v !== 'accepted' &&
                              update.mutate({ id: i.id, patch: { status: v as ItemStatus } })
                            }
                          />
                        </TableCell>
                      )}
                      {show('priority') && (
                        <TableCell>
                          <InlineSelect
                            disabled={!editable}
                            value={i.priority}
                            options={PRIORITIES}
                            onChange={(v) => update.mutate({ id: i.id, patch: { priority: v as Priority } })}
                          />
                        </TableCell>
                      )}
                      {show('assignee') && (
                        <TableCell>
                          <InlineSelect
                            disabled={!editable}
                            value={i.assigneeId ?? ''}
                            options={[
                              { id: '', label: 'Unassigned' },
                              ...assignable.map((p) => ({ id: p.id, label: p.name })),
                            ]}
                            onChange={(v) => update.mutate({ id: i.id, patch: { assigneeId: v || null } })}
                          />
                        </TableCell>
                      )}
                      {show('sprint') && (
                        <TableCell>{b.sprints.find((s) => s.id === i.sprintId)?.name ?? '—'}</TableCell>
                      )}
                      {show('estimate') && (
                        <TableCell align="right">
                          <Mono>{i.estimate ?? '—'}</Mono>
                        </TableCell>
                      )}
                      {show('due') && (
                        <TableCell>
                          <Mono>{i.dueDate ?? '—'}</Mono>
                        </TableCell>
                      )}
                      {show('labels') && (
                        <TableCell>
                          {i.labels.map((l) => (
                            <Chip key={l} size="small" label={l} sx={{ mr: 0.5, height: 20 }} />
                          ))}
                        </TableCell>
                      )}
                      {show('visibility') && (
                        <TableCell>
                          <VisibilityChip visibility={i.visibility} showShared />
                        </TableCell>
                      )}
                    </TableRow>
                  );
                }),
              ])}
            </TableBody>
          </Table>
        </Box>
      )}
      {update.error && (
        <Alert severity="error" sx={{ m: 2 }}>
          {update.error.message}
        </Alert>
      )}
    </Paper>
  );
}

function InlineSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      variant="standard"
      disableUnderline
      size="small"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      sx={{ fontSize: 14 }}
      inputProps={{ 'aria-label': 'Edit value' }}
    >
      {options.map((o) => (
        <MenuItem key={o.id} value={o.id}>
          {o.label}
        </MenuItem>
      ))}
    </Select>
  );
}

export { STATUS_LABEL, ITEM_TYPES };
export type { WorkItem };
