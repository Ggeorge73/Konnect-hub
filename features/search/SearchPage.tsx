'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Chip,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useSearch } from '@/lib/client/api';
import { DEFAULT_STATUSES, ITEM_TYPES } from '@/lib/domain/workflow';
import { EmptyState } from '@/components/ui/bits';

export function SearchPage() {
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [type, setType] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [visibility, setVisibility] = useState('');
  const f = `${type.length ? `&type=${type.join(',')}` : ''}${status.length ? `&status=${status.join(',')}` : ''}${visibility ? `&visibility=${visibility}` : ''}`;
  const { data = [], isFetching } = useSearch(q, f);
  const multi = (v: string[]) => (v.length ? `${v.length} selected` : 'Any');
  return (
    <Stack spacing={2}>
      <Typography variant="h1">Search</Typography>
      <Paper sx={{ p: 2, borderRadius: 4 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <TextField autoFocus fullWidth label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <TextField
            select
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as unknown as string[])}
            sx={{ minWidth: 160 }}
            slotProps={{ select: { multiple: true, renderValue: (v) => multi(v as string[]) } }}
          >
            {ITEM_TYPES.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as unknown as string[])}
            sx={{ minWidth: 160 }}
            slotProps={{ select: { multiple: true, renderValue: (v) => multi(v as string[]) } }}
          >
            {DEFAULT_STATUSES.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="">Any</MenuItem>
            <MenuItem value="internal">Internal</MenuItem>
            <MenuItem value="shared">Shared</MenuItem>
          </TextField>
        </Stack>
      </Paper>
      <Paper sx={{ borderRadius: 4 }}>
        {q.trim().length < 2 ? (
          <EmptyState
            title="Find anything"
            body="Search work items, projects and comments. Press / anywhere to open quick search."
          />
        ) : data.length === 0 && !isFetching ? (
          <EmptyState title="No results" body="Try fewer filters or a different word." />
        ) : (
          <List>
            {data.map((r) => (
              <ListItemButton key={r.kind + r.id} component={Link} href={r.href}>
                <Chip size="small" label={r.kind} sx={{ mr: 2, minWidth: 72 }} />
                <ListItemText primary={r.title} secondary={r.subtitle} />
              </ListItemButton>
            ))}
          </List>
        )}
      </Paper>
    </Stack>
  );
}
