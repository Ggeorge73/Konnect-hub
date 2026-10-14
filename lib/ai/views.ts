import type { AiFeature, RiskSignal } from '../domain/ai';
import type { RiskCategory } from '../domain/raid';
import type { ReportSections } from '../domain/reports';

/** Response shapes of the /api/ai routes, shared by lib/ai/service.ts and the UI (types only). */

export interface AiMeta {
  provider: 'anthropic' | 'fake';
  model: string;
}

export interface AiStatus {
  projectId: string;
  projectKey: string;
  enabled: boolean;
  canToggle: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  provider: 'anthropic' | 'fake' | 'unavailable';
  model: string | null;
  /** Why AI is unavailable, or a note about the demo provider. */
  note: string | null;
  canUse: Record<AiFeature, boolean>;
}

export interface StatusDraftResult extends AiMeta {
  reportId: string;
  /** Proposed HTML per section (sanitized). Nothing is saved until the Lead accepts. */
  sections: Partial<ReportSections>;
}

export interface RiskSuggestion {
  /** Stable id: the sorted signal keys. */
  id: string;
  title: string;
  category: RiskCategory;
  probability: number;
  impact: number;
  mitigation: string;
  signalKeys: string[];
  linkedItemKeys: string[];
  /** The signals behind it, for the reviewer. */
  because: string[];
}

export interface RiskSuggestionsResult {
  signals: RiskSignal[];
  suggestions: RiskSuggestion[];
  meta: AiMeta | null;
}

export interface ProposedItem {
  type: 'feature' | 'story' | 'task' | 'bug' | 'change_request';
  title: string;
  description: string;
  assigneeId: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  dueDate: string | null;
}

export interface MeetingNotesResult extends AiMeta {
  items: ProposedItem[];
  members: { id: string; name: string }[];
}

export interface ThreadSummaryResult extends AiMeta {
  itemKey: string;
  summary: string;
  keyPoints: string[];
  commentCount: number;
  /** 'shared' = built from shared comments only (client viewers). */
  scope: 'all' | 'shared';
}
