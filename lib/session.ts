import 'server-only';
import { cookies } from 'next/headers';
import type { Session } from './domain/types';
import { db } from './data/memory';

export const DEMO_USER_COOKIE = 'kh_user';
export const DEFAULT_DEMO_USER = 'u_lead';

/**
 * Demo mode: the signed-in user is chosen with a cookie (role switcher in the top bar).
 * With Supabase configured, this is replaced by the Supabase Auth session (see lib/supabase).
 */
export async function getSession(): Promise<Session> {
  const jar = await cookies();
  const id = jar.get(DEMO_USER_COOKIE)?.value ?? DEFAULT_DEMO_USER;
  return sessionFor(id);
}

export function sessionFor(userId: string): Session {
  const d = db();
  const user = d.profiles.find((p) => p.id === userId) ?? d.profiles.find((p) => p.id === DEFAULT_DEMO_USER)!;
  const org = d.orgs.find((o) => o.id === user.orgId)!;
  return { user, org };
}
