'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Alert,
  Box,
  Button,
  Divider,
  MenuItem,
  Paper,
  Skeleton,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMe } from '@/lib/client/api';
import {
  CHANNEL_LABEL,
  CHANNELS,
  KIND_LABEL,
  kindsFor,
  type Channel,
  type NotificationKind,
} from '@/lib/domain/notifications';
import { usePreferences, useSetPreference } from './api';

/** /settings/notifications: one channel per event kind (in-app, email, daily digest or off). */
export function NotificationSettings() {
  const { data: me } = useMe();
  const { data: prefs } = usePreferences();
  const set = useSetPreference();
  const [saved, setSaved] = useState(false);
  const kinds = me ? kindsFor(me.user) : [];
  const change = (kind: NotificationKind, channel: Channel) =>
    set.mutate({ [kind]: channel }, { onSuccess: () => setSaved(true) });
  return (
    <Stack spacing={2} sx={{ maxWidth: 880, mx: 'auto', width: '100%' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
        <Typography variant="h1" sx={{ flex: 1 }}>
          Notification settings
        </Typography>
        <Button component={Link} href="/notifications">
          Back to notifications
        </Button>
      </Stack>
      <Typography color="text.secondary">
        Choose how you hear about each kind of event. Email sends right away; the daily digest bundles the
        last 24 hours into one morning email. Everything except Off also appears in your notification center.
      </Typography>
      {set.error && <Alert severity="error">{set.error.message}</Alert>}
      <Paper sx={{ borderRadius: 4 }} component="section" aria-labelledby="ntf-prefs-title">
        <Typography id="ntf-prefs-title" variant="h3" sx={{ px: 2.5, pt: 2, pb: 1 }}>
          Event types
        </Typography>
        <Divider />
        {!prefs || !me ? (
          <Box sx={{ p: 2 }}>
            <Skeleton height={56} />
            <Skeleton height={56} />
          </Box>
        ) : (
          <Stack divider={<Divider />}>
            {kinds.map((kind) => (
              <Stack
                key={kind}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                sx={{ px: 2.5, py: 1.5 }}
              >
                <Typography id={`ntf-${kind}`} sx={{ flex: 1, fontWeight: 600 }}>
                  {KIND_LABEL[kind]}
                </Typography>
                <TextField
                  select
                  size="small"
                  value={prefs[kind] ?? 'in_app'}
                  onChange={(e) => change(kind, e.target.value as Channel)}
                  sx={{ minWidth: { sm: 220 } }}
                  slotProps={{
                    select: {
                      SelectDisplayProps: { 'aria-labelledby': `ntf-${kind}` } as object,
                    },
                  }}
                >
                  {CHANNELS.map((c) => (
                    <MenuItem key={c} value={c}>
                      {CHANNEL_LABEL[c]}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            ))}
          </Stack>
        )}
      </Paper>
      <Snackbar
        open={saved}
        autoHideDuration={2500}
        onClose={() => setSaved(false)}
        message="Notification settings saved"
      />
    </Stack>
  );
}
