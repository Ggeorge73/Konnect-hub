'use client';
import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Announcements,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { KeyboardCoordinateGetter } from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  InputAdornment,
} from '@mui/material';
import Search from '@mui/icons-material/Search';
import ViewAgendaOutlined from '@mui/icons-material/ViewAgendaOutlined';
import ViewStreamOutlined from '@mui/icons-material/ViewStreamOutlined';
import Add from '@mui/icons-material/Add';
import { prefetchItem, useCreateItem, useItems, useMe, usePeople, useUpdateItem } from '@/lib/client/api';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import { DEFAULT_STATUSES, PRIORITIES, ITEM_TYPES } from '@/lib/domain/workflow';
import { statusLabels } from '@/lib/domain/admin';
import { useWorkflow } from '@/features/admin/api';
import { canEditItems, isClientRole } from '@/lib/domain/permissions';
import type { ItemStatus, ItemType, WorkItem } from '@/lib/domain/types';
import { BoardCard } from './BoardCard';
import { laneOf, positionAt, type Swimlane } from './ordering';
import { EmptyState } from '@/components/ui/bits';
import { useRealtime } from '@/features/realtime/useRealtime';
import { CreateItemAction } from '@/components/ui/EmptyActions';

const COLUMN_STEP = 292; // column width + gap

/** Left/Right jump a whole column; Up/Down reorder within a column. */
const boardKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  const { currentCoordinates } = args.context.collisionRect
    ? { currentCoordinates: args.currentCoordinates }
    : args;
  if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
    event.preventDefault();
    return {
      x: currentCoordinates.x + (event.code === 'ArrowRight' ? COLUMN_STEP : -COLUMN_STEP),
      y: currentCoordinates.y,
    };
  }
  return sortableKeyboardCoordinates(event, args);
};

const HIDDEN_BY_DEFAULT: ItemType[] = ['epic', 'feature'];

export function KanbanBoard() {
  const b = useProjectBundle();
  const { data: items, isLoading } = useItems(b.project.id);
  useRealtime(b.project.id);
  const { data: people = [] } = usePeople();
  const { data: me } = useMe();
  // ADM-01: the project's column labels and WIP limits (Admin console); default until loaded.
  const statuses = useWorkflow(b.project.key).data ?? DEFAULT_STATUSES;
  const STATUS_LABEL = statusLabels(statuses);
  const update = useUpdateItem(b.project.id);
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [lane, setLane] = useState<Swimlane>('none');
  const [compact, setCompact] = useState(false);
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(false);
  const [types, setTypes] = useState<ItemType[]>([]);
  const [assignee, setAssignee] = useState('');
  const [sprintOnly, setSprintOnly] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAccept, setPendingAccept] = useState<{ id: string; position: number } | null>(null);

  const editable = me ? canEditItems(me.user) : false;
  const activeSprint = b.sprints.find((s) => s.status === 'active');
  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const epicOf = useCallback(
    (i: WorkItem): string | null => {
      let cur: WorkItem | undefined = i;
      for (let n = 0; cur && n < 5; n++) {
        if (cur.type === 'epic') return cur.id;
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return null;
    },
    [byId],
  );

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (items ?? []).filter(
      (i) =>
        (types.length ? types.includes(i.type) : !HIDDEN_BY_DEFAULT.includes(i.type)) &&
        (!mine || i.assigneeId === me?.user.id) &&
        (!assignee || (i.assigneeId ?? 'unassigned') === assignee) &&
        (!sprintOnly || (activeSprint && i.sprintId === activeSprint.id)) &&
        (!t ||
          i.title.toLowerCase().includes(t) ||
          i.key.toLowerCase().includes(t) ||
          i.labels.some((l) => l.includes(t))),
    );
  }, [items, types, mine, assignee, sprintOnly, q, me, activeSprint]);

  const lanes = useMemo(() => {
    if (lane === 'none') return [{ id: 'all', label: '' }];
    if (lane === 'priority') return PRIORITIES.map((p) => ({ id: p.id, label: p.label }));
    if (lane === 'assignee') {
      const ids = [...new Set(visible.map((i) => i.assigneeId ?? 'unassigned'))];
      return ids.map((id) => ({
        id,
        label: id === 'unassigned' ? 'Unassigned' : (people.find((p) => p.id === id)?.name ?? id),
      }));
    }
    const ids = [...new Set(visible.map((i) => epicOf(i) ?? 'none'))];
    return ids.map((id) => ({ id, label: id === 'none' ? 'No epic' : (byId.get(id)?.title ?? id) }));
  }, [lane, visible, people, epicOf, byId]);

  const cells = useMemo(() => {
    const m = new Map<string, WorkItem[]>();
    for (const i of visible) {
      const k = `${laneOf(i, lane, epicOf)}::${i.status}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    for (const arr of m.values()) arr.sort((a, c) => a.position - c.position);
    return m;
  }, [visible, lane, epicOf]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  );

  const openItem = useCallback(
    (key: string) => {
      const sp = new URLSearchParams(params.toString());
      sp.set('item', key);
      router.replace(`${pathname}?${sp}`, { scroll: false });
    },
    [params, pathname, router],
  );
  const hover = useCallback((key: string) => prefetchItem(qc, key), [qc]);

  const resolveTarget = (overId: string): { laneId: string; status: ItemStatus } | null => {
    if (overId.includes('::')) {
      const [laneId, status] = overId.split('::');
      return { laneId, status: status as ItemStatus };
    }
    const it = byId.get(overId);
    return it ? { laneId: laneOf(it, lane, epicOf), status: it.status } : null;
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over) return;
    const item = byId.get(String(e.active.id));
    const target = resolveTarget(String(e.over.id));
    if (!item || !target) return;
    const column = cells.get(`${target.laneId}::${target.status}`) ?? [];
    const overIndex = column.findIndex((i) => i.id === e.over!.id);
    const position = positionAt(column, overIndex === -1 ? column.length : overIndex, item.id);
    const patch: Parameters<typeof update.mutate>[0]['patch'] = { position };
    if (target.status !== item.status) patch.status = target.status;
    const fromLane = laneOf(item, lane, epicOf);
    if (target.laneId !== fromLane) {
      if (lane === 'assignee') patch.assigneeId = target.laneId === 'unassigned' ? null : target.laneId;
      if (lane === 'priority') patch.priority = target.laneId as WorkItem['priority'];
      if (lane === 'epic') patch.parentId = target.laneId === 'none' ? null : target.laneId;
    }
    if (patch.status === 'accepted' && me && !isClientRole(me.user.role)) {
      setPendingAccept({ id: item.id, position });
      return;
    }
    update.mutate({ id: item.id, patch }, { onError: (err) => setError(err.message) });
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${byId.get(String(active.id))?.key}.`,
    onDragOver: ({ active, over }) => {
      const t = over ? resolveTarget(String(over.id)) : null;
      return t ? `${byId.get(String(active.id))?.key} is over ${STATUS_LABEL[t.status]}.` : '';
    },
    onDragEnd: ({ active, over }) => {
      const t = over ? resolveTarget(String(over.id)) : null;
      return t ? `${byId.get(String(active.id))?.key} dropped in ${STATUS_LABEL[t.status]}.` : 'Dropped.';
    },
    onDragCancel: ({ active }) => `Moving ${byId.get(String(active.id))?.key} cancelled.`,
  };

  if (isLoading)
    return (
      <Stack direction="row" spacing={2}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rounded" width={280} height={400} />
        ))}
      </Stack>
    );
  const active = activeId ? byId.get(activeId) : null;

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <TextField
          size="small"
          placeholder="Filter cards"
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
            htmlInput: { 'aria-label': 'Filter cards' },
          }}
          sx={{ width: 200 }}
        />
        <Chip
          label="My items"
          color={mine ? 'primary' : 'default'}
          onClick={() => setMine((v) => !v)}
          variant={mine ? 'filled' : 'outlined'}
        />
        {activeSprint && (
          <Chip
            label={`Active sprint: ${activeSprint.name}`}
            color={sprintOnly ? 'primary' : 'default'}
            variant={sprintOnly ? 'filled' : 'outlined'}
            onClick={() => setSprintOnly((v) => !v)}
          />
        )}
        <TextField
          select
          size="small"
          label="Type"
          value={types}
          sx={{ minWidth: 140 }}
          slotProps={{
            select: {
              multiple: true,
              renderValue: (v) =>
                (v as string[]).length ? `${(v as string[]).length} selected` : 'Work items',
            },
          }}
          onChange={(e) => setTypes(e.target.value as unknown as ItemType[])}
        >
          {ITEM_TYPES.map((t) => (
            <MenuItem key={t.id} value={t.id}>
              {t.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Assignee"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">Anyone</MenuItem>
          <MenuItem value="unassigned">Unassigned</MenuItem>
          {people
            .filter((p) => !isClientRole(p.role))
            .map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
        </TextField>
        <Box sx={{ flex: 1 }} />
        <TextField
          select
          size="small"
          label="Swimlanes"
          value={lane}
          onChange={(e) => setLane(e.target.value as Swimlane)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="none">None</MenuItem>
          <MenuItem value="assignee">Assignee</MenuItem>
          <MenuItem value="epic">Epic</MenuItem>
          <MenuItem value="priority">Priority</MenuItem>
        </TextField>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={compact ? 'compact' : 'comfortable'}
          onChange={(_, v) => v && setCompact(v === 'compact')}
          aria-label="Card density"
        >
          <ToggleButton value="comfortable" aria-label="Comfortable cards">
            <ViewAgendaOutlined fontSize="small" />
          </ToggleButton>
          <ToggleButton value="compact" aria-label="Compact cards">
            <ViewStreamOutlined fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {visible.length === 0 && (items?.length ?? 0) === 0 ? (
        <Paper sx={{ borderRadius: 4 }}>
          <EmptyState
            title="The board is empty"
            body="Add the first work item. Press c anywhere to create one."
            action={editable ? <CreateItemAction projectKey={b.project.key} /> : undefined}
          />
        </Paper>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
          accessibility={{ announcements }}
        >
          <Box sx={{ overflowX: 'auto', pb: 2 }}>
            {lanes.map((l) => (
              <Box key={l.id} sx={{ mb: lane === 'none' ? 0 : 3 }}>
                {lane !== 'none' && (
                  <Typography variant="subtitle2" sx={{ mb: 1, position: 'sticky', left: 0 }}>
                    {l.label}
                  </Typography>
                )}
                <Stack direction="row" spacing={1.5} sx={{ minWidth: 'min-content' }}>
                  {statuses.map((s) => (
                    <Column
                      key={s.id}
                      laneId={l.id}
                      status={s.id}
                      label={s.label}
                      wipLimit={s.wipLimit}
                      items={cells.get(`${l.id}::${s.id}`) ?? []}
                      people={people}
                      compact={compact}
                      onOpen={openItem}
                      onHover={hover}
                      editable={
                        editable ||
                        (me ? isClientRole(me.user.role) && me.user.role !== 'client_viewer' : false)
                      }
                      showAdd={editable && l.id === lanes[0].id && (s.id === 'backlog' || s.id === 'ready')}
                      projectId={b.project.id}
                      totalInStatus={visible.filter((i) => i.status === s.id).length}
                    />
                  ))}
                </Stack>
              </Box>
            ))}
          </Box>
          <DragOverlay>
            {active ? (
              <Paper sx={{ p: 1.5, borderRadius: 3, width: 260, boxShadow: '0 16px 32px rgba(0,0,0,0.4)' }}>
                <Typography variant="body2">
                  {active.key} {active.title}
                </Typography>
              </Paper>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
      <Snackbar open={Boolean(error)} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
      <AcceptDialog
        open={Boolean(pendingAccept)}
        onClose={() => setPendingAccept(null)}
        onConfirm={(note) => {
          if (pendingAccept)
            update.mutate(
              {
                id: pendingAccept.id,
                patch: { status: 'accepted', position: pendingAccept.position, offlineAcceptanceNote: note },
              },
              { onError: (err) => setError(err.message) },
            );
          setPendingAccept(null);
        }}
      />
    </Box>
  );
}

function Column(props: {
  laneId: string;
  status: ItemStatus;
  label: string;
  wipLimit?: number;
  items: WorkItem[];
  people: import('@/lib/domain/types').Profile[];
  compact: boolean;
  onOpen: (k: string) => void;
  onHover: (k: string) => void;
  editable: boolean;
  showAdd: boolean;
  projectId: string;
  totalInStatus: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${props.laneId}::${props.status}` });
  const over = props.wipLimit !== undefined && props.totalInStatus > props.wipLimit;
  return (
    <Paper
      ref={setNodeRef}
      component="section"
      aria-label={`${props.label} column, ${props.items.length} items${over ? ', over WIP limit' : ''}`}
      sx={{
        width: 280,
        flexShrink: 0,
        p: 1.25,
        borderRadius: 4,
        bgcolor: isOver ? 'rgba(20,184,166,0.08)' : undefined,
        borderColor: over ? 'warning.main' : undefined,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, px: 0.5 }}>
        <Typography variant="subtitle2" sx={{ color: over ? 'warning.main' : 'text.primary' }}>
          {props.label}
        </Typography>
        <Chip
          size="small"
          label={props.wipLimit ? `${props.totalInStatus}/${props.wipLimit}` : props.items.length}
          color={over ? 'warning' : 'default'}
          sx={{ height: 20 }}
          aria-label={over ? `Over WIP limit of ${props.wipLimit}` : undefined}
        />
        {over && (
          <Typography variant="caption" color="warning.main">
            WIP exceeded
          </Typography>
        )}
      </Stack>
      <SortableContext items={props.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <Box sx={{ minHeight: 60, maxHeight: '70vh', overflowY: 'auto', pr: 0.5 }}>
          {props.items.map((i) => (
            <BoardCard
              key={i.id}
              item={i}
              assignee={props.people.find((p) => p.id === i.assigneeId)}
              compact={props.compact}
              onOpen={props.onOpen}
              onHover={props.onHover}
              disabled={!props.editable}
            />
          ))}
        </Box>
      </SortableContext>
      {props.showAdd && <QuickAdd projectId={props.projectId} status={props.status} />}
    </Paper>
  );
}

function QuickAdd({ projectId, status }: { projectId: string; status: ItemStatus }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const create = useCreateItem(projectId);
  if (!open)
    return (
      <Button
        size="small"
        startIcon={<Add />}
        onClick={() => setOpen(true)}
        fullWidth
        sx={{ justifyContent: 'flex-start' }}
      >
        Quick add
      </Button>
    );
  const submit = async () => {
    if (!title.trim()) return;
    await create.mutateAsync({ projectId, type: 'story', title, status });
    setTitle('');
  };
  return (
    <TextField
      autoFocus
      size="small"
      fullWidth
      placeholder="Title, then Enter"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') setOpen(false);
      }}
      onBlur={() => !title && setOpen(false)}
      slotProps={{ htmlInput: { 'aria-label': 'Quick add title' } }}
    />
  );
}

function AcceptDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Only the client marks work Accepted</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          To record an acceptance given outside the app, note who accepted it, when and how. This is written
          to the audit log.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          label="Offline acceptance note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!note.trim()}
          onClick={() => {
            onConfirm(note);
            setNote('');
          }}
        >
          Record acceptance
        </Button>
      </DialogActions>
    </Dialog>
  );
}
