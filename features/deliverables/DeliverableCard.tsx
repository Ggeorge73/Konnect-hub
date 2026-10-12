'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import CheckCircle from '@mui/icons-material/CheckCircle';
import HighlightOff from '@mui/icons-material/HighlightOff';
import HourglassTop from '@mui/icons-material/HourglassTop';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import type { DeliverableView } from '@/lib/data/deliverables';
import { DELIVERABLE_STATUS_LABEL, type DeliverableStatus } from '@/lib/domain/deliverables';
import type { Profile } from '@/lib/domain/types';
import { STATUS_LABEL } from '@/lib/domain/workflow';
import { Mono, VisibilityChip } from '@/components/ui/bits';
import { DecisionDialog } from '@/features/gates/DecisionDialog';
import { decideCriterion } from '@/features/gates/api';

const STATUS_META: Record<
  DeliverableStatus,
  { icon: typeof CheckCircle; color: 'default' | 'info' | 'success' | 'error' }
> = {
  draft: { icon: EditNoteOutlined, color: 'default' },
  submitted: { icon: HourglassTop, color: 'info' },
  accepted: { icon: CheckCircle, color: 'success' },
  rejected: { icon: HighlightOff, color: 'error' },
};

export function DeliverableStatusChip({ status }: { status: DeliverableStatus }) {
  const { icon: Icon, color } = STATUS_META[status];
  return (
    <Chip
      size="small"
      variant="outlined"
      color={color}
      icon={<Icon sx={{ fontSize: 16 }} />}
      label={DELIVERABLE_STATUS_LABEL[status]}
      sx={{ fontWeight: 600 }}
    />
  );
}

/** One deliverable: linked items, acceptance criteria and (for client reviewers) accept/reject. */
export function DeliverableCard({
  d,
  people,
  phaseName,
  itemHref,
  canDecide,
  onChanged,
  actions,
}: {
  d: DeliverableView;
  people: Profile[];
  phaseName?: string;
  itemHref: (key: string) => string;
  canDecide: boolean;
  onChanged: () => void;
  actions?: React.ReactNode;
}) {
  const [decision, setDecision] = useState<{
    id: string;
    text: string;
    status: 'accepted' | 'rejected';
  } | null>(null);
  const name = (id?: string) => people.find((p) => p.id === id)?.name ?? '—';
  return (
    <Paper component="section" aria-labelledby={`${d.id}-title`} sx={{ p: 2.5, borderRadius: 4 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap' }} useFlexGap>
        <Typography variant="h3" id={`${d.id}-title`}>
          {d.name}
        </Typography>
        <DeliverableStatusChip status={d.status} />
        <VisibilityChip visibility={d.visibility} />
        <Box sx={{ flex: 1 }} />
        {actions}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Owner {name(d.ownerId)}
        {d.dueDate && (
          <>
            {' '}
            · due <Mono>{d.dueDate}</Mono>
          </>
        )}
        {phaseName && <> · {phaseName}</>}
      </Typography>
      {d.description && (
        <Typography variant="body2" sx={{ mt: 1 }}>
          {d.description}
        </Typography>
      )}

      <Typography variant="subtitle2" sx={{ mt: 2 }}>
        Linked work ({d.items.length})
      </Typography>
      {d.items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No work items linked yet.
        </Typography>
      ) : (
        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          {d.items.map((i) => (
            <Stack
              key={i.id}
              direction="row"
              spacing={1}
              alignItems="center"
              data-testid={`dlv-item-${i.key}`}
            >
              <Link href={itemHref(i.key)} scroll={false} style={{ color: 'inherit' }}>
                <Mono>{i.key}</Mono>
              </Link>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {i.title}
              </Typography>
              <Chip size="small" variant="outlined" label={STATUS_LABEL[i.status]} />
            </Stack>
          ))}
        </Stack>
      )}

      <Typography variant="subtitle2" sx={{ mt: 2 }}>
        Acceptance criteria
      </Typography>
      {d.criteria.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No criteria yet. Clear criteria make client acceptance quick.
        </Typography>
      )}
      {d.criteria.map((c) => (
        <Stack
          key={c.id}
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ sm: 'center' }}
          sx={{ py: 0.75, borderBottom: 1, borderColor: 'divider' }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2">{c.text}</Typography>
            {c.decidedAt && (
              <Typography variant="caption" color="text.secondary">
                {c.status === 'accepted' ? 'Accepted' : 'Rejected'} by {name(c.decidedBy)} ·{' '}
                <Mono>{new Date(c.decidedAt).toLocaleString()}</Mono>
                {c.note ? ` — “${c.note}”` : ''}
              </Typography>
            )}
          </Box>
          <Chip
            size="small"
            variant="outlined"
            label={c.status === 'pending' ? 'Pending' : c.status === 'accepted' ? 'Accepted' : 'Rejected'}
            color={c.status === 'accepted' ? 'success' : c.status === 'rejected' ? 'error' : 'default'}
            icon={
              c.status === 'accepted' ? (
                <CheckCircle sx={{ fontSize: 16 }} />
              ) : c.status === 'rejected' ? (
                <HighlightOff sx={{ fontSize: 16 }} />
              ) : (
                <HourglassTop sx={{ fontSize: 16 }} />
              )
            }
          />
          {canDecide && d.status === 'submitted' && (
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                color="success"
                aria-label={`Accept: ${c.text}`}
                onClick={() => setDecision({ id: c.id, text: c.text, status: 'accepted' })}
              >
                Accept
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                aria-label={`Reject: ${c.text}`}
                onClick={() => setDecision({ id: c.id, text: c.text, status: 'rejected' })}
              >
                Reject
              </Button>
            </Stack>
          )}
        </Stack>
      ))}
      <DecisionDialog
        open={Boolean(decision)}
        onClose={() => setDecision(null)}
        title={`${decision?.status === 'rejected' ? 'Reject' : 'Accept'} “${decision?.text ?? ''}”`}
        description={
          decision?.status === 'rejected' ? (
            <Typography variant="body2" color="text.secondary">
              Rejecting any criterion rejects “{d.name}” and sends its linked work back to In Progress.
            </Typography>
          ) : undefined
        }
        field={{ label: 'Note (optional)', multiline: true }}
        confirmLabel={decision?.status === 'rejected' ? 'Reject' : 'Accept'}
        confirmColor={decision?.status === 'rejected' ? 'error' : 'success'}
        onConfirm={async (note) => {
          if (!decision) return;
          await decideCriterion(d.id, decision.id, { status: decision.status, note: note || undefined });
          onChanged();
        }}
      />
    </Paper>
  );
}
