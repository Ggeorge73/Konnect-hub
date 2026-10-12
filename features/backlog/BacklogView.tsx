'use client';
import { memo, useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import Add from '@mui/icons-material/Add';
import ExpandMore from '@mui/icons-material/ExpandMore';
import PlayArrow from '@mui/icons-material/PlayArrow';
import TaskAlt from '@mui/icons-material/TaskAlt';
import { prefetchItem, useItems, useMe, usePeople, useUpdateItem } from '@/lib/client/api';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import { positionAt } from '@/features/boards/ordering';
import { canStartSprint, isPlannable, plannedHours } from '@/lib/domain/sprints';
import { STATUS_LABEL } from '@/lib/domain/workflow';
import { canEditItems } from '@/lib/domain/permissions';
import type { Profile, Project, Sprint, WorkItem } from '@/lib/domain/types';
import { EmptyState, ItemKey, Mono, TypeIcon, VisibilityChip, initials } from '@/components/ui/bits';
import { CapacityBar } from './CapacityBar';
import { CompleteSprintDialog, CreateSprintDialog } from './SprintDialogs';
import { useCompleteSprint, useCreateSprint, useSetHoursPerPoint, useSprints, useStartSprint } from './api';
import { formatDate } from '@/features/timeline/layout';

const BACKLOG = 'backlog';
const panelId = (sprintId: string | null) => `panel::${sprintId ?? BACKLOG}`;
const isPanel = (id: unknown) => String(id).startsWith('panel::');
const PANEL_DROP_OFFSET = 56; // land just under the panel header

/**
 * Up/Down reorder within (and across) lists; Page Up/Page Down jump a whole panel, like the
 * board's Left/Right column jump but vertical, because panels have different heights.
 */
const panelKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== 'PageUp' && event.code !== 'PageDown') return sortableKeyboardCoordinates(event, args);
  event.preventDefault();
  const { droppableRects, droppableContainers, collisionRect } = args.context;
  if (!collisionRect) return args.currentCoordinates;
  const panels = droppableContainers
    .getEnabled()
    .filter((c) => isPanel(c.id))
    .map((c) => droppableRects.get(c.id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .sort((a, b) => a.top - b.top);
  const cy = collisionRect.top + collisionRect.height / 2;
  let idx = panels.findIndex((r) => cy >= r.top && cy <= r.bottom);
  if (idx === -1) idx = panels.filter((r) => r.top <= cy).length - 1;
  const target = panels[idx + (event.code === 'PageDown' ? 1 : -1)];
  if (!target) return args.currentCoordinates;
  return {
    x: args.currentCoordinates.x,
    y: target.top + Math.min(PANEL_DROP_OFFSET, Math.max(0, target.height - collisionRect.height)),
  };
};

/** Resolve to the panel under the dragged row's centre, then the closest row inside that panel. */
const panelCollision: CollisionDetection = (args) => {
  const { collisionRect, droppableRects, droppableContainers } = args;
  const cy = collisionRect.top + collisionRect.height / 2;
  const panel = droppableContainers.find((c) => {
    const r = isPanel(c.id) ? droppableRects.get(c.id) : undefined;
    return r && cy >= r.top && cy <= r.bottom;
  });
  if (!panel) return closestCorners(args);
  const rows = droppableContainers.filter((c) => c.data.current?.panel === panel.id);
  return closestCenter({ ...args, droppableContainers: rows.length ? rows : [panel] });
};

export function BacklogView() {
  const b = useProjectBundle();
  const projectKey = b.project.key;
  const { data: items, isLoading } = useItems(b.project.id);
  const { data: list, isLoading: loadingSprints } = useSprints(projectKey);
  const { data: people = [] } = usePeople();
  const { data: me } = useMe();
  const update = useUpdateItem(b.project.id);
  const createSprint = useCreateSprint(projectKey, b.project.id);
  const startSprint = useStartSprint(projectKey, b.project.id);
  const completeSprint = useCompleteSprint(projectKey, b.project.id);
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [completing, setCompleting] = useState<Sprint | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const sprints = useMemo(() => list?.sprints ?? [], [list]);
  const open = useMemo(
    () =>
      sprints
        .filter((s) => s.status !== 'completed')
        .sort(
          (a, c) =>
            Number(c.status === 'active') - Number(a.status === 'active') ||
            a.startDate.localeCompare(c.startDate),
        ),
    [sprints],
  );
  const canManage = Boolean(list?.canManage);
  const editable = me ? canEditItems(me.user) : false;

  const lists = useMemo(() => {
    const m = new Map<string, WorkItem[]>();
    for (const s of open) m.set(panelId(s.id), []);
    m.set(panelId(null), []);
    for (const i of items ?? []) {
      if (!isPlannable(i)) continue;
      const k = panelId(i.sprintId ?? null);
      m.get(k)?.push(i);
    }
    for (const arr of m.values()) arr.sort((a, c) => a.position - c.position);
    return m;
  }, [items, open]);

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  const panelOfItem = useCallback(
    (id: string) => {
      const it = byId.get(id);
      return it ? panelId(it.sprintId ?? null) : null;
    },
    [byId],
  );
  const panelName = useCallback(
    (pid: string) => {
      const sid = pid.slice('panel::'.length);
      return sid === BACKLOG ? 'Backlog' : (sprints.find((s) => s.id === sid)?.name ?? 'sprint');
    },
    [sprints],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: panelKeyboardCoordinates }),
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

  const targetPanel = (overId: string) => (isPanel(overId) ? overId : panelOfItem(overId));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over) return;
    const item = byId.get(String(e.active.id));
    const target = targetPanel(String(e.over.id));
    if (!item || !target) return;
    const column = lists.get(target) ?? [];
    const overIndex = column.findIndex((i) => i.id === e.over!.id);
    const position = positionAt(column, overIndex === -1 ? column.length : overIndex, item.id);
    const sid = target.slice('panel::'.length);
    const sprintId = sid === BACKLOG ? null : sid;
    if (sprintId === (item.sprintId ?? null) && position === item.position) return;
    const patch = sprintId === (item.sprintId ?? null) ? { position } : { position, sprintId };
    update.mutate({ id: item.id, patch }, { onError: (err) => setError(err.message) });
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${byId.get(String(active.id))?.key}. Up and Down arrows reorder, Page Up and Page Down jump between sprints and the backlog.`,
    onDragOver: ({ active, over }) => {
      const t = over ? targetPanel(String(over.id)) : null;
      return t ? `${byId.get(String(active.id))?.key} is over ${panelName(t)}.` : '';
    },
    onDragEnd: ({ active, over }) => {
      const t = over ? targetPanel(String(over.id)) : null;
      return t ? `${byId.get(String(active.id))?.key} dropped in ${panelName(t)}.` : 'Dropped.';
    },
    onDragCancel: ({ active }) => `Moving ${byId.get(String(active.id))?.key} cancelled.`,
  };

  const onStart = (s: Sprint) => {
    const rule = canStartSprint(s, sprints);
    if (!rule.ok) {
      setNotice(rule.reason);
      return;
    }
    setNotice(null);
    startSprint.mutate(s.id, { onError: (err) => setNotice(err.message) });
  };

  if (isLoading || loadingSprints || !list)
    return (
      <Stack spacing={2}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rounded" height={120} />
        ))}
      </Stack>
    );

  const active = activeId ? byId.get(activeId) : null;
  const unit = list.estimateUnit;

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="h2" component="h2">
          Backlog and sprints
        </Typography>
        <Box sx={{ flex: 1 }} />
        {unit === 'points' && (
          <HoursPerPoint
            key={list.hoursPerPoint}
            value={list.hoursPerPoint}
            editable={canManage}
            project={b.project}
            onError={setError}
          />
        )}
        {canManage && (
          <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)}>
            Create sprint
          </Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }} id="backlog-keyboard-help">
        Drag rows between sprints and the backlog. With a keyboard: focus a row, press Space to pick it up, Up
        or Down to reorder, Page Up or Page Down to jump between sprints and the backlog, then Space to drop.
      </Typography>
      {notice && (
        <Alert severity="warning" onClose={() => setNotice(null)} sx={{ mb: 2 }} role="alert">
          {notice}
        </Alert>
      )}
      {open.length === 0 && (
        <Paper sx={{ borderRadius: 4, mb: 2 }}>
          <EmptyState
            title="No sprints planned"
            body={
              canManage
                ? 'Plan a sprint inside a phase, then drag work into it from the backlog.'
                : 'Your Delivery Lead has not planned a sprint yet.'
            }
            action={
              canManage ? (
                <Button variant="outlined" startIcon={<Add />} onClick={() => setCreating(true)}>
                  Plan the first sprint
                </Button>
              ) : undefined
            }
          />
        </Paper>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={panelCollision}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
        accessibility={{ announcements }}
      >
        <Stack spacing={2}>
          {[...open, null].map((s) => {
            const pid = panelId(s?.id ?? null);
            const rows = lists.get(pid) ?? [];
            const planned = plannedHours(rows, unit, list.hoursPerPoint);
            return (
              <Panel
                key={pid}
                id={pid}
                sprint={s}
                title={s ? s.name : 'Backlog'}
                items={rows}
                people={people}
                unit={unit}
                collapsed={Boolean(collapsed[pid])}
                onToggle={() => setCollapsed((c) => ({ ...c, [pid]: !c[pid] }))}
                editable={editable}
                onOpen={openItem}
                onHover={hover}
                header={
                  s ? (
                    <>
                      <CapacityBar sprintName={s.name} planned={planned} available={s.capacityHours} />
                      {canManage && s.status === 'planned' && (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<PlayArrow />}
                          onClick={() => onStart(s)}
                          disabled={startSprint.isPending}
                        >
                          Start sprint
                        </Button>
                      )}
                      {canManage && s.status === 'active' && (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<TaskAlt />}
                          onClick={() => setCompleting(s)}
                        >
                          Complete sprint
                        </Button>
                      )}
                    </>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      <Mono>{planned}</Mono> h estimated
                    </Typography>
                  )
                }
              />
            );
          })}
        </Stack>
        <DragOverlay>
          {active ? (
            <Paper sx={{ p: 1.25, borderRadius: 3, boxShadow: '0 16px 32px rgba(0,0,0,0.4)' }}>
              <Typography variant="body2">
                {active.key} {active.title}
              </Typography>
            </Paper>
          ) : null}
        </DragOverlay>
      </DndContext>

      <CreateSprintDialog
        open={creating}
        onClose={() => {
          setCreating(false);
          createSprint.reset();
        }}
        phases={b.phases}
        sprints={sprints}
        projectKey={projectKey}
        busy={createSprint.isPending}
        error={createSprint.error?.message}
        onCreate={(input) =>
          createSprint.mutate(input, {
            onSuccess: () => {
              setCreating(false);
              createSprint.reset();
            },
          })
        }
      />
      <CompleteSprintDialog
        sprint={completing}
        sprints={sprints}
        items={completing ? (lists.get(panelId(completing.id)) ?? []) : []}
        busy={completeSprint.isPending}
        error={completeSprint.error?.message}
        onClose={() => {
          setCompleting(null);
          completeSprint.reset();
        }}
        onConfirm={(carryOver) =>
          completing &&
          completeSprint.mutate(
            { id: completing.id, carryOver },
            {
              onSuccess: (r) => {
                setCompleting(null);
                completeSprint.reset();
                setNotice(null);
                setError(null);
                setDone(
                  `${r.sprint.name} completed.${r.moved.length ? ` ${r.moved.length} unfinished item${r.moved.length === 1 ? '' : 's'} moved to ${r.targetSprintId ? (sprints.find((x) => x.id === r.targetSprintId)?.name ?? 'the next sprint') : 'the backlog'}.` : ''}`,
                );
              },
            },
          )
        }
      />
      <Snackbar open={Boolean(error)} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
      <Snackbar open={Boolean(done)} autoHideDuration={6000} onClose={() => setDone(null)}>
        <Alert severity="success" onClose={() => setDone(null)}>
          {done}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function HoursPerPoint({
  value,
  editable,
  project,
  onError,
}: {
  value: number;
  editable: boolean;
  project: Project;
  onError: (m: string) => void;
}) {
  const save = useSetHoursPerPoint(project.key, project.id);
  const [v, setV] = useState(String(value));
  if (!editable)
    return (
      <Typography variant="body2" color="text.secondary">
        Capacity uses <Mono>{value}</Mono> h per point
      </Typography>
    );
  const commit = () => {
    const n = Number(v);
    if (n === value) return;
    if (!(n > 0)) {
      setV(String(value));
      onError('Hours per point must be a positive number.');
      return;
    }
    save.mutate(n, { onError: (e) => onError(e.message) });
  };
  return (
    <TextField
      size="small"
      type="number"
      label="Hours per point"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      slotProps={{ htmlInput: { min: 0.5, step: 0.5 } }}
      sx={{ width: 140 }}
    />
  );
}

function Panel(props: {
  id: string;
  sprint: Sprint | null;
  title: string;
  items: WorkItem[];
  people: Profile[];
  unit: Project['estimateUnit'];
  collapsed: boolean;
  onToggle: () => void;
  editable: boolean;
  onOpen: (k: string) => void;
  onHover: (k: string) => void;
  header: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id });
  const s = props.sprint;
  const bodyId = `${props.id.replace('::', '-')}-body`;
  const count = props.items.length;
  return (
    <Paper
      ref={setNodeRef}
      component="section"
      aria-label={`${props.title}, ${count} item${count === 1 ? '' : 's'}`}
      data-testid={`panel-${props.title}`}
      sx={{ p: 1.5, borderRadius: 4, bgcolor: isOver ? 'rgba(20,184,166,0.08)' : undefined }}
    >
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          <IconButton
            size="small"
            onClick={props.onToggle}
            aria-expanded={!props.collapsed}
            aria-controls={bodyId}
            aria-label={`${props.collapsed ? 'Expand' : 'Collapse'} ${props.title}`}
          >
            <ExpandMore
              sx={{
                transform: props.collapsed ? 'rotate(-90deg)' : 'none',
                transition: 'transform 180ms ease-out',
              }}
            />
          </IconButton>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }} noWrap>
                {props.title}
              </Typography>
              {s && (
                <Chip
                  size="small"
                  label={s.status === 'active' ? 'Active' : 'Planned'}
                  color={s.status === 'active' ? 'primary' : 'default'}
                  variant={s.status === 'active' ? 'filled' : 'outlined'}
                  sx={{ height: 22 }}
                />
              )}
              <Chip size="small" label={`${count} item${count === 1 ? '' : 's'}`} sx={{ height: 22 }} />
            </Stack>
            {s && (
              <Typography variant="caption" color="text.secondary" component="p">
                {formatDate(s.startDate)} – {formatDate(s.endDate)}
                {s.goal ? ` · ${s.goal}` : ''}
              </Typography>
            )}
          </Box>
        </Stack>
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {props.header}
        </Stack>
      </Stack>
      <Collapse in={!props.collapsed} id={bodyId}>
        <SortableContext items={props.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <Box sx={{ mt: 1, minHeight: 48 }}>
            {count > 0 && (
              <Box role="list" aria-label={`${props.title} items`}>
                {props.items.map((i) => (
                  <BacklogRow
                    key={i.id}
                    item={i}
                    panel={props.id}
                    unit={props.unit}
                    assignee={props.people.find((p) => p.id === i.assigneeId)}
                    disabled={!props.editable}
                    onOpen={props.onOpen}
                    onHover={props.onHover}
                  />
                ))}
              </Box>
            )}
            {count === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1.5 }}>
                {s
                  ? 'Drag work items here from the backlog.'
                  : 'The backlog is empty. Press c to create an item.'}
              </Typography>
            )}
          </Box>
        </SortableContext>
      </Collapse>
    </Paper>
  );
}

const BacklogRow = memo(function BacklogRow({
  item,
  panel,
  unit,
  assignee,
  disabled,
  onOpen,
  onHover,
}: {
  item: WorkItem;
  panel: string;
  unit: Project['estimateUnit'];
  assignee?: Profile;
  disabled: boolean;
  onOpen: (k: string) => void;
  onHover: (k: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { panel },
    disabled,
  });
  return (
    <Box role="listitem" sx={{ mb: 0.75 }}>
      <Box
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        aria-describedby="backlog-keyboard-help"
        onClick={() => onOpen(item.key)}
        onMouseEnter={() => onHover(item.key)}
        onKeyDown={(e) => {
          listeners?.onKeyDown?.(e);
          if (e.key === 'Enter' && !e.defaultPrevented) onOpen(item.key);
        }}
        aria-label={`${item.key} ${item.title}, ${STATUS_LABEL[item.status]}. Press space to move, enter to open.`}
        data-testid={`backlog-row-${item.key}`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
          borderRadius: 3,
          border: 1,
          borderColor: 'divider',
          cursor: disabled ? 'pointer' : 'grab',
          transform: CSS.Transform.toString(transform),
          transition: transition ?? 'box-shadow 180ms ease-out',
          opacity: isDragging ? 0.5 : 1,
          touchAction: 'none',
          '&:hover': { boxShadow: 'inset 0 0 18px rgba(20,184,166,0.15)' },
        }}
      >
        <TypeIcon type={item.type} fontSize={16} />
        <ItemKey k={item.key} />
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {item.title}
        </Typography>
        <VisibilityChip visibility={item.visibility} />
        <Chip size="small" variant="outlined" label={STATUS_LABEL[item.status]} sx={{ height: 22 }} />
        <Typography variant="caption" sx={{ width: 48, textAlign: 'right' }} color="text.secondary">
          {item.estimate != null ? (
            <Mono>
              {item.estimate} {unit === 'points' ? 'pt' : 'h'}
            </Mono>
          ) : (
            '—'
          )}
        </Typography>
        {assignee ? (
          <Tooltip title={assignee.name}>
            <Avatar sx={{ width: 24, height: 24, fontSize: 11 }}>{initials(assignee.name)}</Avatar>
          </Tooltip>
        ) : (
          <Box sx={{ width: 24 }} />
        )}
      </Box>
    </Box>
  );
});
