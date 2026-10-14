import type { AiSettings } from '../domain/ai';

/** An accepted or dismissed risk suggestion: its signals are not suggested again. */
export interface AiDecision {
  id: string;
  projectId: string;
  signalKey: string;
  decision: 'accepted' | 'dismissed';
  raidId: string | null;
  decidedBy: string;
  decidedAt: string;
}

/** AI assist (KH-42..44): per-project switch and risk-suggestion decisions. */
export interface AiState {
  settings: AiSettings[];
  decisions: AiDecision[];
}

/**
 * Demo data, mirrored in supabase/seed.sql: AI is on for the demo EHR project (so the demo shows
 * it) and explicitly off elsewhere; one Riverbend suggestion was dismissed.
 */
export function seedAi(): { ai: AiState } {
  return {
    ai: {
      settings: [
        { projectId: 'p_ehr', enabled: true, updatedBy: 'u_lead', updatedAt: '2026-10-05T09:00:00.000Z' },
        { projectId: 'p_rvb', enabled: false, updatedBy: 'u_lead', updatedAt: '2026-10-05T09:00:00.000Z' },
      ],
      decisions: [
        {
          id: 'aid_rvb_1',
          projectId: 'p_rvb',
          signalKey: 'stalled:wi_rvb_3',
          decision: 'dismissed',
          raidId: null,
          decidedBy: 'u_lead',
          decidedAt: '2026-10-09T15:00:00.000Z',
        },
      ],
    },
  };
}
