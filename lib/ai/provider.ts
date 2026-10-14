import 'server-only';
import { createAnthropicClient, DEFAULT_MODEL } from './anthropic';
import { fakeClient } from './fake';
import type { AiClient } from './types';

type Env = Record<string, string | undefined>;

export type AiAvailability =
  | { kind: 'anthropic'; model: string }
  | { kind: 'fake'; model: string; reason: string }
  | { kind: 'unavailable'; reason: string };

/**
 * Which provider serves AI requests:
 * - KH_AI_PROVIDER=off: unavailable;
 * - tests and CI (VITEST, CI, NODE_ENV=test) or KH_AI_PROVIDER=fake: the deterministic fake;
 * - ANTHROPIC_API_KEY set: Claude (ANTHROPIC_MODEL, default claude-opus-5-5);
 * - no key in demo mode (no Supabase): the fake, so the demo works offline;
 * - no key on a real deployment: unavailable, and the UI explains why.
 */
export function aiAvailability(env: Env = process.env): AiAvailability {
  const testing = Boolean(env.VITEST || env.CI || env.NODE_ENV === 'test');
  if (env.KH_AI_PROVIDER === 'off')
    return { kind: 'unavailable', reason: 'AI assist is switched off on this server (KH_AI_PROVIDER=off).' };
  if (env.KH_AI_PROVIDER === 'fake' || testing)
    return {
      kind: 'fake',
      model: 'konnect-fake-1',
      reason: 'Demo AI: deterministic drafts, no model is called.',
    };
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (key) return { kind: 'anthropic', model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL };
  const supabase = Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!supabase)
    return {
      kind: 'fake',
      model: 'konnect-fake-1',
      reason: 'Demo AI: no API key is set, so drafts are deterministic.',
    };
  return {
    kind: 'unavailable',
    reason: 'AI assist is not configured on this server: an Admin needs to set ANTHROPIC_API_KEY.',
  };
}

/** The client for the current environment, or null when AI is unavailable. */
export function getAiClient(env: Env = process.env): AiClient | null {
  const a = aiAvailability(env);
  if (a.kind === 'fake') return fakeClient;
  if (a.kind === 'anthropic') return createAnthropicClient(env.ANTHROPIC_API_KEY!.trim(), a.model);
  return null;
}
