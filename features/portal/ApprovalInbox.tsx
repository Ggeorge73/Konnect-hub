'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import GavelOutlined from '@mui/icons-material/GavelOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import AssignmentTurnedInOutlined from '@mui/icons-material/AssignmentTurnedInOutlined';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import { api } from '@/lib/client/api';
import { EmptyState, Mono } from '@/components/ui/bits';
import { DecisionDialog } from '@/features/gates/DecisionDialog';
import { decideCriterion, decideGate } from '@/features/gates/api';
import { INBOX_KIND_LABEL, type InboxEntry, type InboxKind } from '@/lib/domain/portal';
import { useInbox, useInvalidateInbox } from './api';

const KIND_ICON: Record<InboxKind, typeof GavelOutlined> = {
  gate: GavelOutlined,
  deliverable: Inventory2Outlined,
  item: AssignmentTurnedInOutlined,
};

const VERB: Record<InboxKind, string> = { gate: 'Approve', deliverable: 'Accept', item: 'Accept' };

/** Runs the decision for one inbox entry after the re-auth dialog confirms it. */
async function decide(e: InboxEntry, note: string) {
  if (e.kind === 'gate') return decideGate(e.id, { decision: 'approved' });
  if (e.kind === 'deliverable') {
    for (const cid of e.criterionIds ?? [])
      await decideCriterion(e.id, cid, { status: 'accepted', note: note || undefined });
    return;
  }
  return api(`/api/items/${e.itemKey}`, { method: 'PATCH', body: JSON.stringify({ status: 'accepted' }) });
}

function dueLabel(due: string | null, today: string) {
  if (!due) return null;
  return due < today ? 'overdue' : due === today ? 'due today' : 'due';
}

/**
 * Portal home "Needs your approval": gate reviews awaiting the sponsor, deliverables awaiting
 * acceptance and work in Client Review, merged and sorted by due date. Approve / Accept reuse the
 * signed-decision dialog (re-auth when older than 15 minutes). `?approve=<reviewId>` (the email
 * deep link) opens that gate's approve dialog.
 */
export function ApprovalInbox({
  initial,
  canAct,
  emptyAction,
}: {
  initial: InboxEntry[];
  canAct: boolean;
  emptyAction?: React.ReactNode;
}) {
  const router = useRouter();
  const approveId = useSearchParams().get('approve');
  const { data: entries = initial } = useInbox(initial);
  const invalidate = useInvalidateInbox();
  const [open, setOpen] = useState<InboxEntry | null>(
    () => initial.find((e) => e.kind === 'gate' && e.id === approveId) ?? null,
  );
  const [done, setDone] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Paper
      id="inbox"
      component="section"
      aria-labelledby="inbox-title"
      sx={{ borderRadius: 4, p: { xs: 2, sm: 2.5 }, borderLeft: 4, borderLeftColor: 'primary.main' }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <CheckCircleOutline color="primary" aria-hidden />
        <Typography variant="h2" id="inbox-title" sx={{ flex: 1 }}>
          Needs your approval
        </Typography>
        <Chip
          label={`${entries.length} waiting`}
          color={entries.length ? 'primary' : 'default'}
          size="small"
          sx={{ fontWeight: 700 }}
          data-testid="inbox-count"
        />
      </Stack>
      {done && (
        <Alert severity="success" sx={{ mb: 1 }} onClose={() => setDone(null)}>
          {done}
        </Alert>
      )}
      {entries.length === 0 ? (
        <EmptyState
          title="You’re all caught up"
          body={
            canAct
              ? 'Nothing needs your approval right now. We will notify you when a gate review, deliverable or piece of work is ready for you.'
              : 'Approvals go to your Client Sponsor and Members. You can follow progress on each project below.'
          }
          action={emptyAction}
        />
      ) : (
        <Stack component="ul" divider={<Divider component="li" aria-hidden />} sx={{ m: 0, p: 0 }}>
          {entries.map((e) => {
            const Icon = KIND_ICON[e.kind];
            const due = dueLabel(e.dueDate, today);
            return (
              <Stack
                key={`${e.kind}-${e.id}`}
                component="li"
                direction={{ xs: 'column', sm: 'row' }}
                spacing={{ xs: 1, sm: 2 }}
                alignItems={{ sm: 'center' }}
                sx={{ py: 1.5, listStyle: 'none' }}
                data-testid={e.kind === 'gate' ? `gate-review-${e.projectKey}` : `inbox-${e.kind}-${e.id}`}
              >
                <Stack direction="row" spacing={1.5} sx={{ flex: 1, minWidth: 0 }}>
                  <Icon color="primary" sx={{ mt: 0.25 }} aria-hidden />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                      <Link href={e.href} scroll={false} style={{ color: 'inherit' }}>
                        {INBOX_KIND_LABEL[e.kind]} · {e.title}
                      </Link>
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      {e.projectName}
                      {due && (
                        <>
                          {' '}
                          · {due} <Mono>{e.dueDate}</Mono>
                        </>
                      )}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      {e.detail}
                    </Typography>
                  </Box>
                </Stack>
                {canAct && (
                  <Stack direction="row" spacing={1} sx={{ pl: { xs: 4.5, sm: 0 }, flexShrink: 0 }}>
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={<CheckCircleOutline />}
                      onClick={() => setOpen(e)}
                      aria-label={`${VERB[e.kind]} ${e.decisionLabel}`}
                    >
                      {VERB[e.kind]}
                    </Button>
                    <Button variant="outlined" component={Link} href={e.href} scroll={false}>
                      Review
                    </Button>
                  </Stack>
                )}
              </Stack>
            );
          })}
        </Stack>
      )}
      <DecisionDialog
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open ? `${VERB[open.kind]} ${open.decisionLabel}` : ''}
        description={
          open && (
            <Typography variant="body2" color="text.secondary">
              {open.kind === 'deliverable'
                ? `This accepts all ${open.criterionIds?.length ?? 0} pending acceptance criteria. To reject one, open Review.`
                : open.kind === 'gate'
                  ? `${open.detail} To approve with conditions or reject, open Review.`
                  : `${open.title} moves to Accepted. To send it back, open Review.`}
            </Typography>
          )
        }
        field={open?.kind === 'deliverable' ? { label: 'Note (optional)', multiline: true } : undefined}
        confirmLabel={open ? VERB[open.kind] : 'Confirm'}
        confirmColor="success"
        onConfirm={async (note) => {
          if (!open) return;
          await decide(open, note);
          setDone(
            open.kind === 'gate'
              ? `Decision recorded for ${open.projectName} — ${open.title}.`
              : `Accepted ${open.kind === 'item' ? open.itemKey : `“${open.title}”`} for ${open.projectName}.`,
          );
          await invalidate();
          router.refresh();
        }}
      />
    </Paper>
  );
}
