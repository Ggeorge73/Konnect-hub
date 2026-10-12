'use client';
import {
  Alert,
  Box,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import CheckCircle from '@mui/icons-material/CheckCircle';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import LockOutlined from '@mui/icons-material/LockOutlined';
import type { GateReview } from '@/lib/domain/gates';
import type { Profile } from '@/lib/domain/types';
import { DELIVERABLE_STATUS_LABEL, type DeliverableStatus } from '@/lib/domain/deliverables';
import { Mono } from '@/components/ui/bits';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** The Gate Pack assembled when the Lead requested review. */
export function GatePackView({ review, people }: { review: GateReview; people: Profile[] }) {
  const name = (id?: string) => people.find((p) => p.id === id)?.name ?? '—';
  const { pack } = review;
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2">{pack.summary}</Typography>
      {review.overrideNote && (
        <Alert severity="warning" variant="outlined">
          <strong>Lead override:</strong> {review.overrideNote}
          {pack.overriddenCriteria.length > 0 && (
            <Box component="span"> (open: {pack.overriddenCriteria.map((c) => c.text).join('; ')})</Box>
          )}
        </Alert>
      )}
      <Box>
        <Typography variant="subtitle2">Exit criteria</Typography>
        <List dense disablePadding>
          {pack.completedCriteria.map((c) => (
            <ListItem key={c.id} disableGutters>
              <ListItemIcon sx={{ minWidth: 30 }}>
                <CheckCircle color="success" fontSize="small" aria-label="Done" />
              </ListItemIcon>
              <ListItemText
                primary={c.text}
                secondary={
                  c.doneAt ? `${name(c.doneBy)} · ${new Date(c.doneAt).toLocaleString()}` : undefined
                }
              />
            </ListItem>
          ))}
          {pack.overriddenCriteria.map((c) => (
            <ListItem key={c.id} disableGutters>
              <ListItemIcon sx={{ minWidth: 30 }}>
                <RadioButtonUnchecked color="warning" fontSize="small" aria-label="Open" />
              </ListItemIcon>
              <ListItemText primary={c.text} secondary="Open — overridden by the Lead" />
            </ListItem>
          ))}
        </List>
      </Box>
      <Box>
        <Typography variant="subtitle2">Linked deliverables</Typography>
        {pack.deliverables.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            None linked to this phase.
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mt: 0.5 }} useFlexGap>
            {pack.deliverables.map((d) => (
              <Chip
                key={d.id}
                size="small"
                variant="outlined"
                label={`${d.name} · ${DELIVERABLE_STATUS_LABEL[d.status as DeliverableStatus] ?? d.status}`}
              />
            ))}
          </Stack>
        )}
      </Box>
      <Box>
        <Typography variant="subtitle2">Open risks</Typography>
        {pack.openRisks.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No open risks recorded.
          </Typography>
        ) : (
          pack.openRisks.map((r) => (
            <Typography key={r.id} variant="body2">
              {r.title}
              {r.score !== undefined && (
                <>
                  {' '}
                  · score <Mono>{r.score}</Mono>
                </>
              )}
            </Typography>
          ))
        )}
      </Box>
      {pack.budget && (
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle2">Budget status</Typography>
            {!review.budgetShared && (
              <Chip
                size="small"
                icon={<LockOutlined sx={{ fontSize: 14 }} />}
                label="Internal"
                sx={{ height: 22, fontSize: 11, bgcolor: 'rgba(245,158,11,0.15)', color: 'warning.main' }}
              />
            )}
          </Stack>
          <Typography variant="body2">
            BAC <Mono>{usd(pack.budget.bac)}</Mono> · <Mono>{pack.budget.percentComplete}%</Mono> of work
            complete
          </Typography>
        </Box>
      )}
    </Stack>
  );
}
