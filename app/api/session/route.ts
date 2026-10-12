import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DEMO_USER_COOKIE, getSession } from '@/lib/session';
import { db } from '@/lib/data/memory';
import { isSupabaseConfigured } from '@/lib/config';

export async function GET() {
  const s = await getSession();
  const { costRate: _c, ...user } = s.user;
  return NextResponse.json({ user, org: s.org });
}

/** Demo-mode only: switch the signed-in demo persona. */
export async function POST(req: Request) {
  if (isSupabaseConfigured()) return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const { userId } = z.object({ userId: z.string() }).parse(await req.json());
  if (!db().profiles.some((p) => p.id === userId))
    return NextResponse.json({ error: 'Unknown user' }, { status: 400 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(DEMO_USER_COOKIE, userId, { path: '/', httpOnly: true, sameSite: 'lax' });
  return res;
}
