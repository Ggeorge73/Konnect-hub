'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Dialog,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
  Box,
} from '@mui/material';
import Search from '@mui/icons-material/Search';
import FolderOutlined from '@mui/icons-material/FolderOutlined';
import ChatBubbleOutline from '@mui/icons-material/ChatBubbleOutline';
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined';
import { useSearch } from '@/lib/client/api';

const KIND_ICON = { project: FolderOutlined, item: TaskAltOutlined, comment: ChatBubbleOutline };

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const router = useRouter();
  const { data = [], isFetching } = useSearch(q, '');
  const go = (href: string) => {
    onClose();
    setQ('');
    router.push(href);
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-label="Search">
      <Box sx={{ p: 2 }}>
        <TextField
          autoFocus
          fullWidth
          placeholder="Search items, projects and comments"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, data.length - 1));
            if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            if (e.key === 'Enter') {
              if (data[active]) go(data[active].href);
              else if (q.trim()) go(`/search?q=${encodeURIComponent(q)}`);
            }
          }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search />
                </InputAdornment>
              ),
            },
            htmlInput: { 'aria-label': 'Search query' },
          }}
        />
        <List dense sx={{ maxHeight: 420, overflow: 'auto', mt: 1 }} aria-live="polite">
          {data.slice(0, 15).map((r, i) => {
            const Icon = KIND_ICON[r.kind];
            return (
              <ListItemButton key={r.kind + r.id} selected={i === active} onClick={() => go(r.href)}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary={r.title} secondary={r.subtitle} />
              </ListItemButton>
            );
          })}
          {q.trim().length > 1 && !isFetching && data.length === 0 && (
            <Typography color="text.secondary" sx={{ p: 2 }}>
              No matches. Press Enter for advanced search.
            </Typography>
          )}
        </List>
      </Box>
    </Dialog>
  );
}
