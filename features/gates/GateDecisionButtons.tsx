'use client';
import { useState } from 'react';
import { Button, Stack } from '@mui/material';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import PlaylistAddCheck from '@mui/icons-material/PlaylistAddCheck';
import HighlightOff from '@mui/icons-material/HighlightOff';
import type { GateDecision, GateReview } from '@/lib/domain/gates';
import { decideGate } from './api';
import { DecisionDialog } from './DecisionDialog';

const COPY: Record<
  GateDecision,
  {
    verb: string;
    color: 'success' | 'warning' | 'error';
    field?: { label: string; required: boolean; helper: string };
  }
> = {
  approved: { verb: 'Approve', color: 'success' },
  approved_with_conditions: {
    verb: 'Approve with conditions',
    color: 'warning',
    field: {
      label: 'Conditions',
      required: true,
      helper: 'One condition per line. Each becomes a tracked work item for the team.',
    },
  },
  rejected: {
    verb: 'Reject',
    color: 'error',
    field: {
      label: 'Reason',
      required: true,
      helper: 'Tell the team what must change before the next review.',
    },
  },
};

/** Approve / Approve with conditions / Reject for the Client Sponsor. */
export function GateDecisionButtons({
  review,
  gateLabel,
  onDone,
  autoOpen,
}: {
  review: GateReview;
  gateLabel: string;
  onDone: () => void;
  /** Opens this decision's dialog on mount (email deep link `/portal?approve=<reviewId>`). */
  autoOpen?: GateDecision;
}) {
  const [open, setOpen] = useState<GateDecision | null>(autoOpen ?? null);
  const copy = open ? COPY[open] : null;
  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button
          variant="contained"
          color="success"
          startIcon={<CheckCircleOutline />}
          onClick={() => setOpen('approved')}
          aria-label={`Approve ${gateLabel}`}
        >
          Approve
        </Button>
        <Button
          variant="outlined"
          color="warning"
          startIcon={<PlaylistAddCheck />}
          onClick={() => setOpen('approved_with_conditions')}
        >
          Approve with conditions
        </Button>
        <Button
          variant="outlined"
          color="error"
          startIcon={<HighlightOff />}
          onClick={() => setOpen('rejected')}
        >
          Reject
        </Button>
      </Stack>
      <DecisionDialog
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={`${copy?.verb ?? ''} ${gateLabel}`}
        description={review.pack.summary}
        field={copy?.field ? { ...copy.field, multiline: true } : undefined}
        confirmLabel={copy?.verb ?? 'Confirm'}
        confirmColor={copy?.color}
        onConfirm={async (text) => {
          if (!open) return;
          await decideGate(review.id, {
            decision: open,
            conditions: open === 'approved_with_conditions' ? text.split('\n') : undefined,
            reason: open === 'rejected' ? text : undefined,
          });
          onDone();
        }}
      />
    </>
  );
}
