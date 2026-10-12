'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
  Autocomplete,
} from '@mui/material';
import Close from '@mui/icons-material/Close';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import { useAddComment, useItem, useMe, usePeople, useUpdateItem } from '@/lib/client/api';
import { ItemKey, Mono, PriorityMarker, TypeIcon, VisibilityChip, initials } from '@/components/ui/bits';
import { RichText } from '@/components/ui/RichText';
import { DEFAULT_STATUSES, ITEM_TYPES, PRIORITIES, STATUS_LABEL } from '@/lib/domain/workflow';
import { canComment, canEditItems, isClientRole } from '@/lib/domain/permissions';
import type { ItemPatch } from '@/lib/data/repo';
import type { ItemStatus, Visibility, WorkItem } from '@/lib/domain/types';
import { useProjectBundle } from '@/features/projects/ProjectFrame';
import { useHotkeys } from '@/components/shell/useHotkeys';
import { LinkedRaid } from '@/features/raid/LinkedRaid';
import { useRealtime } from '@/features/realtime/useRealtime';
import { PresenceAvatars } from '@/features/realtime/PresenceAvatars';
import { WatchButton } from '@/features/notifications/WatchButton';

export function ItemPanel({ projectId }: { projectId: string }) {
  const params = useSearchParams();
  const key = params.get('item');
  const router = useRouter();
  const pathname = usePathname();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  useRealtime(projectId);
  const close = () => {
    const sp = new URLSearchParams(params.toString());
    sp.delete('item');
    router.replace(`${pathname}${sp.size ? '?' + sp : ''}`, { scroll: false });
  };
  return (
    <Drawer
      anchor="right"
      open={Boolean(key)}
      onClose={close}
      slotProps={{ paper: { sx: { width: mobile ? '100%' : 600, p: 0 } } }}
    >
      {key && <ItemDetailView itemKey={key} projectId={projectId} onClose={close} />}
    </Drawer>
  );
}

function ItemDetailView({
  itemKey,
  projectId,
  onClose,
}: {
  itemKey: string;
  projectId: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useItem(itemKey);
  const { data: me } = useMe();
  const { data: people = [] } = usePeople();
  const bundle = useProjectBundle();
  const update = useUpdateItem(projectId);
  const [tab, setTab] = useState<'comments' | 'activity' | 'links'>('comments');
  const [acceptOpen, setAcceptOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useHotkeys(useMemo(() => ({ e: () => titleRef.current?.focus() }), []));

  if (error)
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {error.message}
      </Alert>
    );
  if (isLoading || !data || !me)
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton height={40} />
        <Skeleton height={200} />
      </Box>
    );
  const { item } = data;
  const editable = canEditItems(me.user);
  const client = isClientRole(me.user.role);
  const save = (patch: ItemPatch) => update.mutate({ id: item.id, patch });
  const setStatus = (s: ItemStatus) => {
    if (s === 'accepted' && !client) setAcceptOpen(true);
    else save({ status: s });
  };
  const assignable = people.filter((p) => !isClientRole(p.role));

  return (
    <Stack sx={{ height: '100%' }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2.5, py: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <TypeIcon type={item.type} />
        <ItemKey k={item.key} />
        <VisibilityChip visibility={item.visibility} />
        <Box sx={{ flex: 1 }} />
        <PresenceAvatars itemKey={item.key} />
        <WatchButton itemKey={item.key} />
        <IconButton aria-label="Close item panel" onClick={onClose}>
          <Close />
        </IconButton>
      </Stack>
      <Box sx={{ flex: 1, overflow: 'auto', px: 2.5, py: 2 }}>
        {update.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {update.error.message}
          </Alert>
        )}
        <TextField
          inputRef={titleRef}
          key={item.title}
          defaultValue={item.title}
          fullWidth
          variant="standard"
          disabled={!editable}
          slotProps={{ htmlInput: { 'aria-label': 'Title', style: { fontSize: 20, fontWeight: 700 } } }}
          onBlur={(e) =>
            e.target.value.trim() && e.target.value !== item.title && save({ title: e.target.value })
          }
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5, mt: 2 }}>
          <TextField
            select
            size="small"
            label="Status"
            value={item.status}
            onChange={(e) => setStatus(e.target.value as ItemStatus)}
            disabled={me.user.role === 'client_viewer'}
          >
            {DEFAULT_STATUSES.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Priority"
            value={item.priority}
            onChange={(e) => save({ priority: e.target.value as WorkItem['priority'] })}
            disabled={!editable}
          >
            {PRIORITIES.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <PriorityMarker priority={p.id} />
                  <span>{p.label}</span>
                </Stack>
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Assignee"
            value={item.assigneeId ?? ''}
            onChange={(e) => save({ assigneeId: e.target.value || null })}
            disabled={!editable}
          >
            <MenuItem value="">Unassigned</MenuItem>
            {assignable.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Type"
            value={item.type}
            onChange={(e) => save({ type: e.target.value as WorkItem['type'] })}
            disabled={!editable}
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
            label="Sprint"
            value={item.sprintId ?? ''}
            onChange={(e) => save({ sprintId: e.target.value || null })}
            disabled={!editable}
          >
            <MenuItem value="">Backlog (no sprint)</MenuItem>
            {bundle.sprints.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Phase"
            value={item.phaseId ?? ''}
            onChange={(e) => save({ phaseId: e.target.value || null })}
            disabled={!editable}
          >
            <MenuItem value="">None</MenuItem>
            {bundle.phases.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.gate} · {p.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="number"
            label={`Estimate (${bundle.project.estimateUnit})`}
            key={'est' + item.estimate}
            defaultValue={item.estimate ?? ''}
            disabled={!editable}
            onBlur={(e) => save({ estimate: e.target.value === '' ? null : Number(e.target.value) })}
          />
          <TextField
            size="small"
            type="date"
            label="Due date"
            value={item.dueDate ?? ''}
            slotProps={{ inputLabel: { shrink: true } }}
            disabled={!editable}
            onChange={(e) => save({ dueDate: e.target.value || null })}
          />
        </Box>
        {editable && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Visibility
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={item.visibility}
              onChange={(_, v: Visibility | null) => v && save({ visibility: v })}
              aria-label="Visibility"
            >
              <ToggleButton value="internal">
                <LockOutlined sx={{ fontSize: 16, mr: 0.5 }} />
                Internal
              </ToggleButton>
              <ToggleButton value="shared">
                <PublicOutlined sx={{ fontSize: 16, mr: 0.5 }} />
                Shared with client
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        )}
        <Autocomplete
          multiple
          freeSolo
          size="small"
          options={[] as string[]}
          value={item.labels}
          disabled={!editable}
          onChange={(_, v) => save({ labels: v as string[] })}
          renderInput={(p) => <TextField {...p} label="Labels" placeholder="Add label" />}
          sx={{ mt: 2 }}
        />
        <Typography variant="subtitle2" sx={{ mt: 2.5, mb: 1 }}>
          Description
        </Typography>
        <RichText
          label="Description"
          value={item.description}
          editable={editable}
          onSave={(html) => save({ description: html })}
        />

        <AcceptanceCriteria item={item} editable={editable} onSave={save} />

        {(data.parent || data.children.length > 0) && (
          <Box sx={{ mt: 2.5 }}>
            <Typography variant="subtitle2">Hierarchy</Typography>
            {data.parent && (
              <Typography variant="body2">
                Parent: <Mono>{data.parent.key}</Mono> {data.parent.title}
              </Typography>
            )}
            {data.children.map((c) => (
              <Typography key={c.id} variant="body2">
                Child: <Mono>{c.key}</Mono> {c.title} — {STATUS_LABEL[c.status]}
              </Typography>
            ))}
          </Box>
        )}

        <LinkedRaid itemKey={item.key} />

        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mt: 2.5 }}>
          <Tab value="comments" label={`Comments (${data.comments.length})`} />
          <Tab value="activity" label="Activity" />
          <Tab value="links" label={`Links (${data.links.length})`} />
        </Tabs>
        <Divider />
        {tab === 'comments' && (
          <Comments
            itemKey={item.key}
            comments={data.comments}
            people={people}
            canPost={canComment(me.user)}
            client={client}
          />
        )}
        {tab === 'activity' && (
          <List dense>
            {data.activity.length === 0 && (
              <Typography color="text.secondary" sx={{ p: 2 }}>
                No activity yet.
              </Typography>
            )}
            {data.activity.map((a) => (
              <ListItem key={a.id}>
                <ListItemText
                  primary={a.detail}
                  secondary={`${people.find((p) => p.id === a.actorId)?.name ?? 'Someone'} · ${new Date(a.at).toLocaleString()}`}
                />
              </ListItem>
            ))}
          </List>
        )}
        {tab === 'links' && (
          <List dense>
            {data.links.length === 0 && (
              <Typography color="text.secondary" sx={{ p: 2 }}>
                No linked items.
              </Typography>
            )}
            {data.links.map((l) => (
              <ListItem key={l.id}>
                <ListItemText
                  primary={
                    <>
                      <Chip
                        size="small"
                        label={
                          l.type === 'blocks' ? (l.fromId === item.id ? 'blocks' : 'blocked by') : l.type
                        }
                        sx={{ mr: 1 }}
                      />
                      <Mono>{l.other.key}</Mono> {l.other.title}
                    </>
                  }
                  secondary={STATUS_LABEL[l.other.status]}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
      <OfflineAcceptDialog
        open={acceptOpen}
        onClose={() => setAcceptOpen(false)}
        onConfirm={(note) => {
          save({ status: 'accepted', offlineAcceptanceNote: note });
          setAcceptOpen(false);
        }}
      />
    </Stack>
  );
}

function AcceptanceCriteria({
  item,
  editable,
  onSave,
}: {
  item: WorkItem;
  editable: boolean;
  onSave: (p: ItemPatch) => void;
}) {
  const [text, setText] = useState('');
  const ac = item.acceptanceCriteria;
  const add = () => {
    if (!text.trim()) return;
    onSave({ acceptanceCriteria: [...ac, { id: `ac_${Date.now()}`, text: text.trim(), status: 'pending' }] });
    setText('');
  };
  return (
    <Box sx={{ mt: 2.5 }}>
      <Typography variant="subtitle2">Acceptance criteria</Typography>
      {ac.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          None yet. Clear criteria make client acceptance quick.
        </Typography>
      )}
      {ac.map((c) => (
        <Stack key={c.id} direction="row" alignItems="center">
          <Checkbox
            size="small"
            checked={c.status === 'accepted'}
            disabled
            inputProps={{ 'aria-label': c.text }}
          />
          <Typography variant="body2" sx={{ flex: 1 }}>
            {c.text}
          </Typography>
          <Chip
            size="small"
            variant="outlined"
            label={c.status}
            color={c.status === 'accepted' ? 'success' : c.status === 'rejected' ? 'error' : 'default'}
          />
        </Stack>
      ))}
      {editable && (
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Add a criterion"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            slotProps={{ htmlInput: { 'aria-label': 'New acceptance criterion' } }}
          />
          <Button onClick={add}>Add</Button>
        </Stack>
      )}
    </Box>
  );
}

function Comments({
  itemKey,
  comments,
  people,
  canPost,
  client,
}: {
  itemKey: string;
  comments: import('@/lib/domain/types').Comment[];
  people: import('@/lib/domain/types').Profile[];
  canPost: boolean;
  client: boolean;
}) {
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<Visibility>(client ? 'shared' : 'internal');
  const add = useAddComment(itemKey);
  useEffect(() => setVisibility(client ? 'shared' : 'internal'), [client]);
  const post = async () => {
    await add.mutateAsync({ body, visibility });
    setBody('');
  };
  return (
    <Box sx={{ py: 1.5 }}>
      {comments.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 1 }}>
          No comments yet.
        </Typography>
      )}
      {comments.map((c) => {
        const author = people.find((p) => p.id === c.authorId);
        return (
          <Stack
            key={c.id}
            direction="row"
            spacing={1.5}
            sx={{
              mb: 2,
              p: 1.5,
              borderRadius: 3,
              bgcolor: c.visibility === 'internal' ? 'rgba(245,158,11,0.07)' : 'transparent',
              border: 1,
              borderColor: 'divider',
            }}
          >
            <Avatar sx={{ width: 28, height: 28, fontSize: 12 }}>{initials(author?.name ?? '?')}</Avatar>
            <Box sx={{ flex: 1 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography fontSize={13} fontWeight={600}>
                  {author?.name ?? 'Unknown'}
                </Typography>
                <Typography fontSize={11} color="text.secondary">
                  {new Date(c.createdAt).toLocaleString()}
                </Typography>
                <VisibilityChip visibility={c.visibility} />
              </Stack>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>
                {c.body}
              </Typography>
            </Box>
          </Stack>
        );
      })}
      {canPost && (
        <Box>
          {add.error && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {add.error.message}
            </Alert>
          )}
          <TextField
            multiline
            minRows={2}
            fullWidth
            placeholder="Add a comment. Use @Name to mention."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            slotProps={{ htmlInput: { 'aria-label': 'Comment' } }}
          />
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            {!client && (
              <ToggleButtonGroup
                size="small"
                exclusive
                value={visibility}
                onChange={(_, v) => v && setVisibility(v)}
                aria-label="Comment visibility"
              >
                <Tooltip title="Only Konnector staff can see this">
                  <ToggleButton value="internal">
                    <LockOutlined sx={{ fontSize: 16, mr: 0.5 }} />
                    Internal
                  </ToggleButton>
                </Tooltip>
                <Tooltip title="Visible in the client portal">
                  <ToggleButton value="shared">
                    <PublicOutlined sx={{ fontSize: 16, mr: 0.5 }} />
                    Shared
                  </ToggleButton>
                </Tooltip>
              </ToggleButtonGroup>
            )}
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" disabled={!body.trim() || add.isPending} onClick={post}>
              Comment
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

function OfflineAcceptDialog({
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
      <DialogTitle>Record offline acceptance</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Only the client marks work Accepted. If the client accepted outside the app (for example by email or
          in a meeting), record who accepted it and how. This is logged in the audit trail.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={2}
          label="Who accepted, when and how"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!note.trim()} onClick={() => onConfirm(note)}>
          Record acceptance
        </Button>
      </DialogActions>
    </Dialog>
  );
}
