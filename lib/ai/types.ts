import type { AiFeature } from '../domain/ai';

/**
 * The provider seam for AI assist (CLAUDE.md 3.13). `anthropicClient` (server only) calls Claude;
 * `fakeClient` is deterministic and is used whenever no key is set, and in all tests and CI.
 */
export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  /** Which feature is asking: used by the fake client and the audit entry, never sent as data. */
  feature: AiFeature;
  system: string;
  messages: AiMessage[];
  maxTokens: number;
  /** Ask for JSON matching this JSON Schema (structured output). Parsed and re-checked with zod. */
  json?: { schema: Record<string, unknown> };
}

export interface AiResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type AiProviderKind = 'anthropic' | 'fake';

export interface AiClient {
  provider: AiProviderKind;
  model: string;
  complete(req: AiRequest): Promise<AiResponse>;
}
