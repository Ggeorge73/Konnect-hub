'use client';
import { Stack } from '@mui/material';

/** A right-aligned row for AI actions above a project view (board, list). */
export function AiToolbar({ children }: { children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mb: 1.5 }}>
      {children}
    </Stack>
  );
}
