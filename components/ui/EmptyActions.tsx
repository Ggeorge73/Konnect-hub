'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@mui/material';
import Add from '@mui/icons-material/Add';
import { QuickCreate } from '@/components/shell/QuickCreate';

/**
 * The "one clear next action" for EmptyState (KH-40 / ONB-01). Small wrappers so every empty view
 * offers a real button rather than only a keyboard hint.
 */
export function CreateItemAction({
  projectKey,
  label = 'Create a work item',
}: {
  projectKey?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="contained" startIcon={<Add />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <QuickCreate open={open} onClose={() => setOpen(false)} projectKey={projectKey} />
    </>
  );
}

export function LinkAction({ href, label }: { href: string; label: string }) {
  return (
    <Button variant="outlined" component={Link} href={href}>
      {label}
    </Button>
  );
}
