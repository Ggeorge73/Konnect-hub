'use client';
import { Box, List, ListItem, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import AlternateEmail from '@mui/icons-material/AlternateEmail';
import AssignmentIndOutlined from '@mui/icons-material/AssignmentIndOutlined';
import SwapHorizOutlined from '@mui/icons-material/SwapHorizOutlined';
import GavelOutlined from '@mui/icons-material/GavelOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import TimerOffOutlined from '@mui/icons-material/TimerOffOutlined';
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import { KIND_LABEL, type Notification, type NotificationKind } from '@/lib/domain/notifications';

const ICON: Record<NotificationKind, typeof AlternateEmail> = {
  mention: AlternateEmail,
  assignment: AssignmentIndOutlined,
  status_change: SwapHorizOutlined,
  gate_requested: GavelOutlined,
  gate_decided: GavelOutlined,
  deliverable_awaiting: Inventory2Outlined,
  sla_breach: TimerOffOutlined,
  risk_escalated: ReportProblemOutlined,
  status_report_published: DescriptionOutlined,
};

/** Short relative time ("5 min ago"), falling back to the date for anything older than a week. */
export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Inbox rows: unread rows are bold with a dot and a tinted background, and say "Unread" to screen readers. */
export function NotificationList({
  items,
  onOpen,
  emptyText = "You're all caught up.",
}: {
  items: Notification[];
  onOpen: (n: Notification) => void;
  emptyText?: string;
}) {
  if (!items.length)
    return (
      <Typography color="text.secondary" sx={{ px: 2, py: 3, textAlign: 'center' }}>
        {emptyText}
      </Typography>
    );
  return (
    <List disablePadding aria-label="Notifications">
      {items.map((n) => {
        const Icon = ICON[n.kind] ?? AlternateEmail;
        const unread = !n.readAt;
        return (
          <ListItem key={n.id} disablePadding divider data-unread={unread || undefined}>
            <ListItemButton
              onClick={() => onOpen(n)}
              sx={{
                alignItems: 'flex-start',
                gap: 1.5,
                py: 1.25,
                bgcolor: unread ? 'action.selected' : 'transparent',
              }}
            >
              <Icon fontSize="small" color={unread ? 'primary' : 'action'} sx={{ mt: 0.25 }} aria-hidden />
              <ListItemText
                primary={
                  <>
                    {unread && (
                      <Box
                        component="span"
                        sx={{
                          position: 'absolute',
                          width: 1,
                          height: 1,
                          overflow: 'hidden',
                          clip: 'rect(0 0 0 0)',
                        }}
                      >
                        Unread:{' '}
                      </Box>
                    )}
                    {n.title}
                  </>
                }
                secondary={
                  <Stack component="span" direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    <span>{KIND_LABEL[n.kind]}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={n.createdAt}>{timeAgo(n.createdAt)}</time>
                  </Stack>
                }
                slotProps={{
                  primary: { fontWeight: unread ? 700 : 400, fontSize: 14, sx: { wordBreak: 'break-word' } },
                  secondary: { fontSize: 12, component: 'span' },
                }}
              />
              {unread && (
                <Box
                  aria-hidden
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    mt: 0.75,
                    flex: 'none',
                  }}
                />
              )}
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
}
