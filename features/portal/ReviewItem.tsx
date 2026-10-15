'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import DoNotDisturbOnOutlined from '@mui/icons-material/DoNotDisturbOnOutlined';
import DrawOutlined from '@mui/icons-material/DrawOutlined';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import { api } from '@/lib/client/api';
import { Mono } from '@/components/ui/bits';
import { DecisionDialog } from '@/features/gates/DecisionDialog';
import {
  CLIENT_ITEM_STATUS_LABEL,
  CLIENT_ITEM_TYPE_LABEL,
  formatAmount,
  isOpenItem,
  isPastRespondBy,
  linesTotal,
  type ClientItem,
  type DecisionInput,
} from '@/lib/domain/crm';
import { ITEM_ICON, statusColor, statusVariant } from './ForYourReview';

const decide = (id: string, input: DecisionInput) =>
  api<ClientItem>(`/api/portal/review/${encodeURIComponent(id)}/decide`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

/**
 * One commercial item in the portal: what Konnector proposes (price lines, total, terms, PDF,
 * respond-by, version) and the decision. Accept records name, title, email, time and IP after a
 * fresh re-auth; signature items show "Sign" instead; surveys take a 0–10 score.
 */
export function ReviewItem({
  item: initial,
  blocker,
  projectName,
  userName,
}: {
  item: ClientItem;
  /** Why this user cannot act (role, decided, withdrawn…), or null. */
  blocker: string | null;
  projectName: string | null;
  userName: string;
}) {
  const router = useRouter();
  const [item, setItem] = useState(initial);
  const [dialog, setDialog] = useState<'accept' | 'changes' | 'decline' | null>(null);
  const [name, setName] = useState(userName);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const Icon = ITEM_ICON[item.type];
  const today = new Date().toISOString().slice(0, 10);
  const canAct = !blocker && isOpenItem(item);
  const withdrawn = item.status === 'withdrawn';
  const total = item.amount ?? (item.lines.length ? linesTotal(item.lines) : null);

  const done = (next: ClientItem) => {
    setItem(next);
    setDialog(null);
    setNote('');
    router.refresh();
  };

  const submitNoteDecision = async (decision: 'changes_requested' | 'declined') => {
    if (decision === 'changes_requested' && !note.trim())
      return setError('Tell Konnector what should change.');
    setBusy(true);
    setError(null);
    try {
      done(await decide(item.id, { decision, note: note.trim() || null }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submitSurvey = async () => {
    if (score === null) return setError('Pick a score from 0 to 10.');
    setBusy(true);
    setError(null);
    try {
      done(
        await api<ClientItem>(`/api/portal/review/${encodeURIComponent(item.id)}/survey`, {
          method: 'POST',
          body: JSON.stringify({ score, comment: note.trim() || null }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 880 }}>
      <Box>
        <Button component={Link} href="/portal#review" startIcon={<ArrowBack />} size="small">
          For your review
        </Button>
      </Box>

      {withdrawn && (
        <Alert severity="info" data-testid="withdrawn-banner">
          <strong>Withdrawn by Konnector.</strong>{' '}
          {item.withdrawnReason ?? 'This item is no longer open for decision.'}
        </Alert>
      )}
      {item.status === 'superseded' && (
        <Alert severity="info">
          A newer version replaces this one. Find it under <Link href="/portal#review">For your review</Link>.
        </Alert>
      )}

      <Paper sx={{ borderRadius: 4, p: { xs: 2, sm: 3 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
          <Icon color="primary" sx={{ fontSize: 36 }} aria-hidden />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary">
              {CLIENT_ITEM_TYPE_LABEL[item.type]}
              {projectName ? ` · ${projectName}` : ''}
            </Typography>
            <Typography variant="h1" sx={{ overflowWrap: 'anywhere' }}>
              {item.title}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
              <Chip
                size="small"
                label={CLIENT_ITEM_STATUS_LABEL[item.status]}
                color={statusColor(item.status)}
                variant={statusVariant(item.status)}
                data-testid="review-status"
              />
              <Chip
                size="small"
                variant="outlined"
                label={
                  item.version > 1
                    ? `Version ${item.version} · supersedes v${item.supersedesVersion ?? item.version - 1}`
                    : 'Version 1'
                }
              />
              {item.respondBy && isOpenItem(item) && (
                <Chip
                  size="small"
                  variant="outlined"
                  color={isPastRespondBy(item, today) ? 'warning' : 'default'}
                  label={`Respond by ${item.respondBy}`}
                />
              )}
            </Stack>
          </Box>
          {total !== null && !withdrawn && (
            <Box sx={{ textAlign: { sm: 'right' } }}>
              <Typography variant="body2" color="text.secondary">
                Total
              </Typography>
              <Typography variant="h2" component="p" data-testid="review-total">
                <Mono>{formatAmount(total, item.currency)}</Mono>
              </Typography>
            </Box>
          )}
        </Stack>

        {!withdrawn && (
          <Stack spacing={2} sx={{ mt: 2 }}>
            {item.summary && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{item.summary}</Typography>}
            {item.newEndDate && (
              <Typography>
                New end date: <Mono>{item.newEndDate}</Mono>
              </Typography>
            )}
            {item.lines.length > 0 && (
              <TableContainer
                tabIndex={0}
                role="region"
                aria-label="Price lines (scrolls sideways on small screens)"
                sx={{ border: 1, borderColor: 'divider', borderRadius: 3 }}
              >
                <Table size="small" aria-label="Price lines">
                  <TableHead>
                    <TableRow>
                      <TableCell>Item</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell align="right">Unit price</TableCell>
                      <TableCell align="right">Amount</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {item.lines.map((l, n) => (
                      <TableRow key={n}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>
                            {l.item}
                          </Typography>
                          {l.description && (
                            <Typography variant="body2" color="text.secondary">
                              {l.description}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          <Mono>{l.qty}</Mono>
                        </TableCell>
                        <TableCell align="right">
                          <Mono>{formatAmount(l.unit_price, item.currency)}</Mono>
                        </TableCell>
                        <TableCell align="right">
                          <Mono>{formatAmount(linesTotal([l]), item.currency)}</Mono>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3} align="right" sx={{ fontWeight: 700 }}>
                        Total
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>
                        <Mono>{formatAmount(total, item.currency)}</Mono>
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>
            )}
            {item.terms && (
              <Box>
                <Typography variant="h3" component="h2">
                  Terms
                </Typography>
                <Typography color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
                  {item.terms}
                </Typography>
              </Box>
            )}
            {item.document && (
              <Box>
                <Button
                  variant="outlined"
                  startIcon={<PictureAsPdfOutlined />}
                  href={item.document.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.document.name}
                </Button>
              </Box>
            )}
          </Stack>
        )}
      </Paper>

      {item.decidedAt && item.status !== 'withdrawn' && (
        <Alert
          severity={item.status === 'accepted' ? 'success' : item.status === 'declined' ? 'error' : 'warning'}
        >
          {item.type === 'survey' ? (
            <>
              Thank you. {item.decidedByName} answered <strong>{item.surveyScore}/10</strong>
              {item.surveyComment ? `: “${item.surveyComment}”` : '.'}
            </>
          ) : (
            <>
              {CLIENT_ITEM_STATUS_LABEL[item.status]} by {item.decidedByName}
              {item.decidedByTitle ? `, ${item.decidedByTitle}` : ''} on{' '}
              <Mono>{item.decidedAt.slice(0, 16).replace('T', ' ')}</Mono> UTC.
              {item.decisionNote ? ` Note: “${item.decisionNote}”` : ''}
            </>
          )}
        </Alert>
      )}

      {canAct && item.type === 'survey' && (
        <Paper
          sx={{ borderRadius: 4, p: { xs: 2, sm: 3 } }}
          component="section"
          aria-labelledby="survey-title"
        >
          <Typography variant="h3" component="h2" id="survey-title" gutterBottom>
            How likely are you to recommend Konnector to a colleague?
          </Typography>
          <ToggleButtonGroup
            exclusive
            value={score}
            onChange={(_, v) => setScore(v)}
            aria-label="Score from 0 (not at all likely) to 10 (extremely likely)"
            sx={{ flexWrap: 'wrap', mb: 1 }}
          >
            {Array.from({ length: 11 }, (_, n) => (
              <ToggleButton key={n} value={n} aria-label={`${n}`} sx={{ minWidth: 44, fontWeight: 700 }}>
                {n}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 2, maxWidth: 520 }}>
            <Typography variant="caption" color="text.secondary">
              0 · Not at all likely
            </Typography>
            <Typography variant="caption" color="text.secondary">
              10 · Extremely likely
            </Typography>
          </Stack>
          <TextField
            label="Anything to add? (optional)"
            multiline
            minRows={2}
            fullWidth
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
          <Button variant="contained" sx={{ mt: 2 }} onClick={submitSurvey} disabled={busy}>
            Send my answer
          </Button>
        </Paper>
      )}

      {canAct && item.type !== 'survey' && (
        <Paper
          sx={{ borderRadius: 4, p: { xs: 2, sm: 3 } }}
          component="section"
          aria-labelledby="decide-title"
        >
          <Typography variant="h3" component="h2" id="decide-title" gutterBottom>
            Your decision
          </Typography>
          {item.requiresSignature && (
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              This needs a signed contract. Sign the document with the e-signature provider; Konnector records
              your acceptance when the envelope is complete.
            </Typography>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            {item.requiresSignature ? (
              <Button
                variant="contained"
                color="success"
                startIcon={<DrawOutlined />}
                href={item.document?.url ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                disabled={!item.document}
              >
                Sign
              </Button>
            ) : (
              <Button
                variant="contained"
                color="success"
                startIcon={<CheckCircleOutline />}
                onClick={() => setDialog('accept')}
              >
                Accept
              </Button>
            )}
            <Button
              variant="outlined"
              startIcon={<EditNoteOutlined />}
              onClick={() => {
                setError(null);
                setDialog('changes');
              }}
            >
              Request changes
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DoNotDisturbOnOutlined />}
              onClick={() => {
                setError(null);
                setDialog('decline');
              }}
            >
              Decline
            </Button>
          </Stack>
        </Paper>
      )}

      {blocker && isOpenItem(item) && (
        <Alert severity="info" data-testid="review-blocker">
          {blocker}
        </Alert>
      )}

      <DecisionDialog
        open={dialog === 'accept'}
        onClose={() => setDialog(null)}
        title={`Accept ${CLIENT_ITEM_TYPE_LABEL[item.type].toLowerCase()} “${item.title}”`}
        description={
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Accepting is a record of agreement
              {total !== null ? ` to ${formatAmount(total, item.currency)}` : ''} on these terms. Konnector
              receives your name and title with your email, the time and your IP address.
            </Typography>
            <TextField
              label="Full name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />
            <TextField
              label="Job title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
            />
          </Stack>
        }
        confirmLabel="Accept"
        confirmColor="success"
        onConfirm={async () => {
          if (!name.trim() || !title.trim()) throw new Error('Enter your full name and job title.');
          done(await decide(item.id, { decision: 'accepted', name: name.trim(), title: title.trim() }));
        }}
      />

      <Dialog
        open={dialog === 'changes' || dialog === 'decline'}
        onClose={busy ? undefined : () => setDialog(null)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="note-decision-title"
      >
        <DialogTitle id="note-decision-title">
          {dialog === 'changes' ? 'Request changes' : `Decline “${item.title}”`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {dialog === 'changes'
                ? 'Tell Konnector what should change. They will send you a revised version.'
                : 'Konnector will be told you declined. A note helps them understand why.'}
            </Typography>
            <TextField
              label={dialog === 'changes' ? 'What should change?' : 'Note (optional)'}
              required={dialog === 'changes'}
              multiline
              minRows={3}
              fullWidth
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color={dialog === 'decline' ? 'error' : 'primary'}
            disabled={busy}
            onClick={() => submitNoteDecision(dialog === 'changes' ? 'changes_requested' : 'declined')}
          >
            {dialog === 'changes' ? 'Send request' : 'Decline'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
