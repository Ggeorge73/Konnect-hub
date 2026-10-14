'use client';
import Link from 'next/link';
import { Box, Button, Stack, Typography } from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';

/** Shared header for the Admin console screens: title, one-line purpose, back to /admin. */
export function AdminPage({
  title,
  intro,
  action,
  children,
}: {
  title: string;
  intro: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Stack spacing={2.5}>
      <Box>
        <Button component={Link} href="/admin" size="small" startIcon={<ArrowBack />} sx={{ mb: 1 }}>
          Admin
        </Button>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-end' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h1">{title}</Typography>
            <Typography color="text.secondary">{intro}</Typography>
          </Box>
          {action}
        </Stack>
      </Box>
      {children}
    </Stack>
  );
}

/** Polite status line for saved changes (screen readers announce it). */
export function SavedNote({ text }: { text: string | null }) {
  return (
    <Typography role="status" variant="body2" color="success.main" sx={{ minHeight: 20 }}>
      {text ?? ''}
    </Typography>
  );
}
