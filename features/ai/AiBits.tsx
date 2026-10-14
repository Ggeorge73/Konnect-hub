'use client';
import { Alert, Chip } from '@mui/material';
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined';
import type { AiFeature } from '@/lib/domain/ai';
import type { AiStatus } from '@/lib/ai/views';

/** True when the caller can run `feature` on this project right now. */
export const aiReady = (st: AiStatus | undefined, feature: AiFeature) =>
  Boolean(st && st.enabled && st.provider !== 'unavailable' && st.canUse[feature]);

/** Why an AI action is disabled, in one sentence (null when it is available). */
export function aiOffReason(st: AiStatus | undefined, feature: AiFeature): string | null {
  if (!st) return null;
  if (st.provider === 'unavailable') return st.note ?? 'AI assist is not configured on this server.';
  if (!st.canUse[feature]) return 'This AI feature is not available to your role.';
  if (!st.enabled)
    return st.canToggle
      ? 'AI assist is off for this project. Turn it on from the Overview tab.'
      : 'AI assist is off for this project. The Delivery Lead or an Admin can turn it on from the Overview tab.';
  return null;
}

/** The explanation shown wherever an AI action is disabled. */
export function AiOffNotice({ status, feature }: { status: AiStatus | undefined; feature: AiFeature }) {
  const reason = aiOffReason(status, feature);
  if (!reason) return null;
  return (
    <Alert severity="info" icon={<AutoAwesomeOutlined fontSize="inherit" />} data-testid="ai-off-notice">
      {reason}
    </Alert>
  );
}

/** Marks AI-written drafts: always reviewed by a person before anything is saved. */
export function AiDraftChip({ label = 'AI draft · review before saving' }: { label?: string }) {
  return (
    <Chip
      size="small"
      variant="outlined"
      color="secondary"
      icon={<AutoAwesomeOutlined sx={{ fontSize: 16 }} />}
      label={label}
    />
  );
}

/** Small print about the provider (e.g. the deterministic demo AI). */
export function AiProviderNote({ status }: { status: AiStatus | undefined }) {
  if (!status || status.provider !== 'fake' || !status.note) return null;
  return (
    <Alert severity="info" variant="outlined" sx={{ py: 0 }}>
      {status.note}
    </Alert>
  );
}
