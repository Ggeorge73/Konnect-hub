import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEMO_USER_COOKIE } from '@/lib/session';
import { handle } from '@/lib/api';
import { db } from '@/lib/data/memory';
import { isSupabaseConfigured } from '@/lib/config';
import { SEED_PROFILE_UUID, seedUserUuid } from '@/lib/data/seed-ids';
import { isPostgresEnabled } from '@/lib/data';
import { recordLogin } from '@/lib/data/audit';
import { requestIp } from '@/lib/export-http';

/**
 * The signed-in user and org, plus `auth`: 'supabase' when Supabase Auth is configured (real
 * sign-in, Sign out) or 'demo' (persona switcher). The client shell never guesses the mode.
 * `impersonation` is set while an Admin previews the portal as a client (read-only).
 * 401 without a session (Supabase mode).
 */
export const GET = () =>
  handle(async ({ session: s }) => {
    const { costRate: _c, ...user } = s.user;
    return {
      user,
      org: s.org,
      auth: isSupabaseConfigured() ? 'supabase' : 'demo',
      impersonation: s.impersonation ?? null,
    };
  });

const switchSchema = z.object({ userId: z.string().min(1).max(64) });

/** Demo-mode only: switch the signed-in demo persona. */
export async function POST(req: Request) {
  if (isSupabaseConfigured()) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const parsed = switchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  const { userId } = parsed.data;
  // Demo personas by seed id, or by their fixed uuid when the demo runs on Postgres (KH_DATA=postgres).
  const known =
    db().profiles.some((p) => p.id === userId) || Object.values(SEED_PROFILE_UUID).includes(userId);
  if (!known) return NextResponse.json({ error: 'Unknown user' }, { status: 400 });
  // AUD-01: a persona switch is the demo's sign-in, so it is audited as auth.login.
  await recordLogin(isPostgresEnabled() ? seedUserUuid(userId) : userId, 'demo_persona', requestIp(req));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEMO_USER_COOKIE, userId, { path: '/', httpOnly: true, sameSite: 'lax' });
  return res;
}
