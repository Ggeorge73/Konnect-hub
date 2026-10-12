'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import GavelOutlined from '@mui/icons-material/GavelOutlined';
import type { PendingGateReview } from '@/lib/data/gates';
import { GateDecisionButtons } from './GateDecisionButtons';

/** Portal home: gate reviews the Client Sponsor can approve in two clicks (Approve → Confirm). */
export function PortalGateCard({ pending }: { pending: PendingGateReview[] }) {
  const router = useRouter();
  const [done, setDone] = useState<string | null>(null);
  return (
    <Card component="section" aria-labelledby="gate-reviews-title">
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <GavelOutlined color="primary" />
          <Typography variant="h3" id="gate-reviews-title">
            Gate reviews awaiting your decision ({pending.length})
          </Typography>
        </Stack>
        {done && (
          <Alert severity="success" sx={{ mb: 1 }} onClose={() => setDone(null)}>
            {done}
          </Alert>
        )}
        {pending.length === 0 ? (
          <Typography color="text.secondary">No gate reviews are waiting on you.</Typography>
        ) : (
          <Stack divider={<Divider />} spacing={2}>
            {pending.map(({ review, projectKey, projectName, phaseName }) => {
              const label = `Gate ${review.gate} · ${phaseName}`;
              return (
                <Stack key={review.id} spacing={1} data-testid={`gate-review-${projectKey}`}>
                  <Typography fontWeight={600}>
                    <Link href={`/portal/${projectKey}#gates`} style={{ color: 'inherit' }}>
                      {projectName}
                    </Link>{' '}
                    — {label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {review.pack.summary}
                  </Typography>
                  {review.overrideNote && (
                    <Typography variant="body2" color="warning.main">
                      Lead override: {review.overrideNote}
                    </Typography>
                  )}
                  <GateDecisionButtons
                    review={review}
                    gateLabel={`${label} for ${projectName}`}
                    onDone={() => {
                      setDone(`Decision recorded for ${projectName} — ${label}.`);
                      router.refresh();
                    }}
                  />
                </Stack>
              );
            })}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
