import 'server-only';
import type { Session } from '../domain/types';
import { db } from '../data/memory';
import { isPostgresEnabled } from '../data';
import { getSql, loadSession } from '../data/postgres';
import { sessionFor } from '../session';

/**
 * Resolves a feed token's user to a session without cookies (calendar apps cannot sign in).
 * Postgres mode loads the profile as that user, so RLS applies; demo mode uses the seed profile.
 */
export async function sessionForUserId(userId: string): Promise<Session | null> {
  if (isPostgresEnabled()) return loadSession(getSql(), userId);
  return db().profiles.some((p) => p.id === userId) ? sessionFor(userId) : null;
}
