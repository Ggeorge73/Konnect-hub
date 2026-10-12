'use client';
import { Box, Chip, Stack, Tooltip, Typography, type ChipProps } from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';
import PublicOutlined from '@mui/icons-material/PublicOutlined';
import CheckCircle from '@mui/icons-material/CheckCircle';
import WarningAmber from '@mui/icons-material/WarningAmber';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import BoltOutlined from '@mui/icons-material/BoltOutlined';
import AutoAwesomeMosaicOutlined from '@mui/icons-material/AutoAwesomeMosaicOutlined';
import BookmarkBorder from '@mui/icons-material/BookmarkBorder';
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined';
import BugReportOutlined from '@mui/icons-material/BugReportOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import ContactSupportOutlined from '@mui/icons-material/ContactSupportOutlined';
import KeyboardDoubleArrowUp from '@mui/icons-material/KeyboardDoubleArrowUp';
import KeyboardArrowUp from '@mui/icons-material/KeyboardArrowUp';
import DragHandle from '@mui/icons-material/DragHandle';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import type { ItemType, Priority, Rag, Visibility } from '@/lib/domain/types';
import { ITEM_TYPES, PRIORITIES } from '@/lib/domain/workflow';
import { MONO, RAG_COLORS } from '@/lib/theme';

const RAG_ICON = { green: CheckCircle, amber: WarningAmber, red: ErrorOutline };
const RAG_LABEL = { green: 'On track', amber: 'At risk', red: 'Off track' };

/** RAG is always colour + icon + text, never colour alone. */
export function RagChip({
  rag,
  reason,
  size = 'small',
}: {
  rag: Rag;
  reason?: string;
  size?: ChipProps['size'];
}) {
  const Icon = RAG_ICON[rag];
  const chip = (
    <Chip
      size={size}
      icon={<Icon sx={{ color: `${RAG_COLORS[rag]} !important` }} />}
      label={`${rag.toUpperCase()} · ${RAG_LABEL[rag]}`}
      variant="outlined"
      sx={{ borderColor: RAG_COLORS[rag], fontWeight: 600 }}
    />
  );
  return reason ? <Tooltip title={reason}>{chip}</Tooltip> : chip;
}

const TYPE_ICON: Record<ItemType, typeof BoltOutlined> = {
  epic: BoltOutlined,
  feature: AutoAwesomeMosaicOutlined,
  story: BookmarkBorder,
  task: TaskAltOutlined,
  bug: BugReportOutlined,
  change_request: SwapHorizOutlined,
  client_request: ContactSupportOutlined,
};

export function TypeIcon({ type, fontSize = 18 }: { type: ItemType; fontSize?: number }) {
  const meta = ITEM_TYPES.find((t) => t.id === type)!;
  const Icon = TYPE_ICON[type];
  return (
    <Tooltip title={meta.label}>
      <Icon aria-label={meta.label} sx={{ color: meta.color, fontSize }} />
    </Tooltip>
  );
}

const PRIORITY_ICON: Record<Priority, [typeof DragHandle, string]> = {
  critical: [KeyboardDoubleArrowUp, RAG_COLORS.red],
  high: [KeyboardArrowUp, RAG_COLORS.amber],
  medium: [DragHandle, '#3B82F6'],
  low: [KeyboardArrowDown, '#94A3B8'],
};

export function PriorityMarker({ priority }: { priority: Priority }) {
  const [Icon, color] = PRIORITY_ICON[priority];
  const label = PRIORITIES.find((p) => p.id === priority)!.label;
  return (
    <Tooltip title={`${label} priority`}>
      <Icon aria-label={`${label} priority`} sx={{ color, fontSize: 18 }} />
    </Tooltip>
  );
}

export function VisibilityChip({
  visibility,
  showShared = false,
}: {
  visibility: Visibility;
  showShared?: boolean;
}) {
  if (visibility === 'internal')
    return (
      <Chip
        size="small"
        icon={<LockOutlined sx={{ fontSize: 14 }} />}
        label="Internal"
        sx={{ height: 22, fontSize: 11, bgcolor: 'rgba(245,158,11,0.15)', color: 'warning.main' }}
      />
    );
  if (!showShared) return null;
  return (
    <Chip
      size="small"
      icon={<PublicOutlined sx={{ fontSize: 14 }} />}
      label="Shared"
      sx={{ height: 22, fontSize: 11 }}
    />
  );
}

export const ItemKey = ({ k }: { k: string }) => (
  <Typography component="span" sx={{ fontFamily: MONO, fontSize: 12, color: 'text.secondary' }}>
    {k}
  </Typography>
);

export const Mono = ({ children }: { children: React.ReactNode }) => (
  <Box component="span" sx={{ fontFamily: MONO }}>
    {children}
  </Box>
);

/** Line-illustration empty state with one clear next action. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <Stack alignItems="center" spacing={1.5} sx={{ py: 6, px: 2, textAlign: 'center' }}>
      <Box component="svg" viewBox="0 0 120 80" sx={{ width: 140, color: 'primary.main' }} aria-hidden>
        <rect x="10" y="14" width="30" height="52" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
        <rect
          x="45"
          y="14"
          width="30"
          height="40"
          rx="6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          opacity=".7"
        />
        <rect
          x="80"
          y="14"
          width="30"
          height="28"
          rx="6"
          fill="none"
          stroke="#3B82F6"
          strokeWidth="2"
          opacity=".7"
        />
        <line x1="16" y1="26" x2="34" y2="26" stroke="currentColor" strokeWidth="2" />
        <line x1="51" y1="26" x2="69" y2="26" stroke="currentColor" strokeWidth="2" opacity=".7" />
      </Box>
      <Typography variant="h3">{title}</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 420 }}>
        {body}
      </Typography>
      {action}
    </Stack>
  );
}

export function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
