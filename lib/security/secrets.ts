import { isSupabaseConfigured } from '../config';

export const DEV_SECRET = 'dev-secret';
export const MIN_SECRET_LENGTH = 32;

export class MissingSecretError extends Error {
  constructor(name: string) {
    super(`${name} must be set to a random value of at least ${MIN_SECRET_LENGTH} characters.`);
  }
}

/**
 * An HMAC key from the environment (REAUTH_SECRET, ICS_SECRET). In demo mode (no Supabase Auth,
 * where anyone can switch persona anyway) a missing value falls back to 'dev-secret'. With real
 * sign-in configured a missing or short key throws: a guessable key would let anyone forge a
 * re-auth cookie, a preview cookie or another user's calendar feed token (SEC-03 finding F-02).
 */
export function serverSecret(
  name: 'REAUTH_SECRET' | 'ICS_SECRET',
  env: Record<string, string | undefined> = process.env,
  demo = !isSupabaseConfigured(),
): string {
  const v = env[name];
  if (v && v.length >= MIN_SECRET_LENGTH) return v;
  if (demo) return v || DEV_SECRET;
  throw new MissingSecretError(name);
}
