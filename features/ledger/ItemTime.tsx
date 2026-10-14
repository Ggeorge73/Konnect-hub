'use client';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AccessTimeOutlined from '@mui/icons-material/AccessTimeOutlined';
import { useMe } from '@/lib/client/api';
import { canLogTime, hoursError } from '@/lib/domain/ledger';
import { Mono } from '@/components/ui/bits';
import { formatHours, localToday, useItemTime, useLogTime } from './api';
import { TimeStatusChip } from './TimeStatusChip';

/**
 * "Log time" section of the item side panel (TIME-01). Internal users only: clients never see
 * time. Shows the item's total logged hours, a quick log form and the viewer's own entries.
 */
export function ItemTime({ itemKey }: { itemKey: string }) {
  const { data: me } = useMe();
  const internal = Boolean(me && canLogTime(me.user.role));
  const { data } = useItemTime(itemKey, internal);
  const log = useLogTime();
  const [hours, setHours] = useState('');
  const [date, setDate] = useState(localToday);
  const [billable, setBillable] = useState(true);
  const [note, setNote] = useState('');
  if (!internal) return null;

  const h = Number(hours);
  const err = hours === '' ? null : hoursError(h);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hours === '' || err) return;
    log.mutate(
      { itemId: itemKey, date, hours: h, billable, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setHours('');
          setNote('');
        },
      },
    );
  };

  return (
    <Box sx={{ mt: 2.5 }} component="section" aria-labelledby="item-time-heading">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <AccessTimeOutlined fontSize="small" aria-hidden />
        <Typography variant="subtitle2" id="item-time-heading">
          Log time
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" data-testid="item-time-total">
          Total logged: <Mono>{formatHours(data?.totalHours ?? 0)}</Mono>
          {data && data.myHours > 0 && (
            <Typography component="span" variant="caption" color="text.secondary">
              {' '}
              (you: {formatHours(data.myHours)})
            </Typography>
          )}
        </Typography>
      </Stack>
      <Stack component="form" onSubmit={submit} spacing={1} aria-label="Log time on this item">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <TextField
            size="small"
            label="Hours"
            type="number"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            error={Boolean(err)}
            helperText={err ?? '0.25 steps'}
            slotProps={{ htmlInput: { step: 0.25, min: 0.25, max: 24, inputMode: 'decimal' } }}
            sx={{ width: 120 }}
          />
          <TextField
            size="small"
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: 170 }}
          />
          <FormControlLabel
            control={<Switch checked={billable} onChange={(e) => setBillable(e.target.checked)} />}
            label="Billable"
          />
        </Stack>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            size="small"
            label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            fullWidth
          />
          <Button type="submit" variant="contained" disabled={hours === '' || Boolean(err) || log.isPending}>
            Log time
          </Button>
        </Stack>
        {log.error && <Alert severity="error">{log.error.message}</Alert>}
      </Stack>
      {data && data.mine.length > 0 && (
        <Stack
          component="ul"
          aria-label="Your time on this item"
          sx={{ listStyle: 'none', p: 0, m: 0, mt: 1 }}
        >
          {data.mine.slice(0, 5).map((e) => (
            <Stack
              component="li"
              key={e.id}
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ py: 0.25 }}
            >
              <Mono>{e.date}</Mono>
              <Mono>{formatHours(e.hours)}</Mono>
              {!e.billable && <Chip size="small" label="Non-billable" variant="outlined" />}
              <Typography variant="body2" sx={{ flex: 1 }} noWrap title={e.note}>
                {e.note}
              </Typography>
              <TimeStatusChip status={e.status} />
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
}
