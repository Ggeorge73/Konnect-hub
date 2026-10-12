'use client';
import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Avatar, Box, Chip, Paper, Stack, Tooltip, Typography } from '@mui/material';
import type { Profile, WorkItem } from '@/lib/domain/types';
import { ItemKey, PriorityMarker, TypeIcon, VisibilityChip, initials, Mono } from '@/components/ui/bits';

interface Props {
  item: WorkItem;
  assignee?: Profile;
  compact: boolean;
  onOpen: (key: string) => void;
  onHover: (key: string) => void;
  disabled?: boolean;
}

export const BoardCard = memo(function BoardCard({
  item,
  assignee,
  compact,
  onOpen,
  onHover,
  disabled,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { item },
    disabled,
  });
  return (
    <Paper
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(item.key)}
      onMouseEnter={() => onHover(item.key)}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter' && !e.defaultPrevented) onOpen(item.key);
      }}
      aria-label={`${item.key} ${item.title}. Press space to move, enter to open.`}
      data-testid={`card-${item.key}`}
      sx={{
        p: compact ? 1 : 1.5,
        mb: 1,
        borderRadius: 3,
        cursor: disabled ? 'pointer' : 'grab',
        transform: CSS.Transform.toString(transform),
        transition: transition ?? 'box-shadow 180ms ease-out',
        opacity: isDragging ? 0.6 : 1,
        boxShadow: isDragging ? '0 12px 28px rgba(0,0,0,0.35)' : 'none',
        contentVisibility: 'auto',
        containIntrinsicSize: compact ? '0 44px' : '0 96px',
        '&:hover': { boxShadow: 'inset 0 0 18px rgba(20,184,166,0.15)' },
        touchAction: 'none',
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center">
        <TypeIcon type={item.type} fontSize={16} />
        <ItemKey k={item.key} />
        <Box sx={{ flex: 1 }} />
        <VisibilityChip visibility={item.visibility} />
      </Stack>
      <Typography
        variant="body2"
        sx={{
          mt: 0.5,
          fontWeight: 500,
          ...(compact ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
        }}
      >
        {item.title}
      </Typography>
      {!compact && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
          <PriorityMarker priority={item.priority} />
          {item.estimate != null && (
            <Chip
              size="small"
              label={<Mono>{item.estimate}</Mono>}
              sx={{ height: 20 }}
              aria-label={`Estimate ${item.estimate}`}
            />
          )}
          {item.labels.slice(0, 2).map((l) => (
            <Chip key={l} size="small" variant="outlined" label={l} sx={{ height: 20, fontSize: 11 }} />
          ))}
          <Box sx={{ flex: 1 }} />
          {assignee ? (
            <Tooltip title={assignee.name}>
              <Avatar sx={{ width: 24, height: 24, fontSize: 11 }}>{initials(assignee.name)}</Avatar>
            </Tooltip>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Unassigned
            </Typography>
          )}
        </Stack>
      )}
    </Paper>
  );
});
