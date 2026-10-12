'use client';
import { usePathname, useRouter } from 'next/navigation';
import { Alert, Box, Button, Chip, Paper, Stack, Typography } from '@mui/material';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import type { GatesOverview } from '@/lib/data/gates';
import type { DeliverableView } from '@/lib/data/deliverables';
import { DECISION_LABEL } from '@/lib/domain/gates';
import { usePeople } from '@/lib/client/api';
import { Mono } from '@/components/ui/bits';
import { DeliverableCard } from '@/features/deliverables/DeliverableCard';
import { GatePackView } from './GatePackView';
import { GateDecisionButtons } from './GateDecisionButtons';

/** Portal project page: pending gate review, gate history and deliverables awaiting acceptance. */
export function PortalGatesSection({
  projectKey,
  gates,
  deliverables,
  canDecideDeliverables,
  canDownloadRecord,
}: {
  projectKey: string;
  gates: GatesOverview;
  deliverables: DeliverableView[];
  canDecideDeliverables: boolean;
  canDownloadRecord: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const { data: people = [] } = usePeople();
  const name = (id?: string) => people.find((p) => p.id === id)?.name ?? '—';
  const pending = gates.reviews.filter((r) => r.status === 'pending');
  const decided = gates.reviews.filter((r) => r.status === 'decided');
  const phaseName = (id: string | null) => gates.phases.find((p) => p.id === id)?.name ?? '';
  return (
    <Stack spacing={2}>
      <Paper
        id="gates"
        component="section"
        aria-labelledby="portal-gates-title"
        sx={{ p: 2.5, borderRadius: 4 }}
      >
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          <Typography variant="h3" id="portal-gates-title" sx={{ flex: 1 }}>
            Gate reviews
          </Typography>
          {canDownloadRecord && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<PictureAsPdfOutlined />}
              href={`/api/projects/${projectKey}/acceptance-record`}
              download
            >
              Acceptance Record
            </Button>
          )}
        </Stack>
        {pending.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No gate review is pending.
          </Typography>
        )}
        {pending.map((r) => {
          const label = `Gate ${r.gate} · ${phaseName(r.phaseId)}`;
          return (
            <Stack key={r.id} spacing={1.5} sx={{ mb: 2 }}>
              <Typography fontWeight={700}>{label} — ready for your review</Typography>
              <GatePackView review={r} people={people} />
              {gates.canDecide ? (
                <GateDecisionButtons review={r} gateLabel={label} onDone={() => router.refresh()} />
              ) : (
                <Alert severity="info" variant="outlined">
                  Your Client Sponsor approves or rejects this gate.
                </Alert>
              )}
            </Stack>
          );
        })}
        {decided.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="subtitle2">History</Typography>
            {decided.map((r) => (
              <Stack
                key={r.id}
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ py: 0.5, flexWrap: 'wrap' }}
                useFlexGap
              >
                <Chip
                  size="small"
                  label={DECISION_LABEL[r.decision!]}
                  color={
                    r.decision === 'rejected' ? 'error' : r.decision === 'approved' ? 'success' : 'warning'
                  }
                />
                <Typography variant="body2">
                  Gate {r.gate} · {phaseName(r.phaseId)} — {name(r.decidedBy)},{' '}
                  <Mono>{new Date(r.decidedAt!).toLocaleString()}</Mono>
                  {r.reason ? ` — ${r.reason}` : ''}
                  {r.conditions?.length ? ` — conditions: ${r.conditions.join('; ')}` : ''}
                </Typography>
              </Stack>
            ))}
          </Box>
        )}
      </Paper>
      <Box id="deliverables" component="section" aria-labelledby="portal-dlv-title">
        <Typography variant="h3" id="portal-dlv-title" sx={{ mb: 1 }}>
          Deliverables
        </Typography>
        {deliverables.length === 0 ? (
          <Paper sx={{ p: 2.5, borderRadius: 4 }}>
            <Typography variant="body2" color="text.secondary">
              Your delivery team will share deliverables here for acceptance.
            </Typography>
          </Paper>
        ) : (
          <Stack spacing={2}>
            {deliverables.map((d) => (
              <DeliverableCard
                key={d.id}
                d={d}
                people={people}
                phaseName={phaseName(d.phaseId)}
                itemHref={(k) => `${path}?item=${k}`}
                canDecide={canDecideDeliverables}
                onChanged={() => router.refresh()}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
