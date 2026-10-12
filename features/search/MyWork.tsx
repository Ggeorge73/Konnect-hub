'use client';
import Link from 'next/link';
import {
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography,
  Chip,
} from '@mui/material';
import type { WorkItem } from '@/lib/domain/types';
import { EmptyState, ItemKey, PriorityMarker, TypeIcon } from '@/components/ui/bits';
import { STATUS_LABEL } from '@/lib/domain/workflow';

export function MyWork({ items }: { items: (WorkItem & { projectKey: string })[] }) {
  return (
    <Stack spacing={2}>
      <Typography variant="h1">My Work</Typography>
      <Paper sx={{ borderRadius: 4 }}>
        {items.length === 0 ? (
          <EmptyState
            title="Nothing assigned to you"
            body="Items assigned to you across every project show up here."
          />
        ) : (
          <List>
            {items.map((i) => (
              <ListItemButton
                key={i.id}
                component={Link}
                href={`/projects/${i.projectKey}/board?item=${i.key}`}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <TypeIcon type={i.type} />
                </ListItemIcon>
                <ListItemText primary={i.title} secondary={<ItemKey k={i.key} />} />
                <PriorityMarker priority={i.priority} />
                <Chip size="small" label={STATUS_LABEL[i.status]} sx={{ ml: 1 }} />
              </ListItemButton>
            ))}
          </List>
        )}
      </Paper>
    </Stack>
  );
}
