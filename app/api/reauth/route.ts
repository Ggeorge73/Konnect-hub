import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { getSession } from '@/lib/session';
import { isReauthFresh, REAUTH_WINDOW_MS } from '@/lib/domain/gates';
import { reauthSchema } from '@/lib/gate-schemas';
import { getReauthAt, REAUTH_COOKIE, REAUTH_MAX_AGE_S, signReauth } from '@/lib/reauth';

/** Is the signed-in user's re-auth still fresh? */
export const GET = () =>
  handle(async ({ session }) => {
    const at = await getReauthAt(session.user.id);
    const fresh = isReauthFresh(at, new Date());
    return { fresh, expiresAt: fresh ? new Date(Date.parse(at!) + REAUTH_WINDOW_MS).toISOString() : null };
  });

/**
 * Demo-mode "Confirm it's you": the user re-enters their email. Sets an httpOnly, HMAC-signed
 * `kh_reauth` cookie holding the re-auth time. Approval endpoints accept it for 15 minutes.
 */
export async function POST(req: Request) {
  const parsed = reauthSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'Enter your email address.' }, { status: 400 });
  const s = await getSession();
  if (parsed.data.email.toLowerCase() !== s.user.email.toLowerCase())
    return NextResponse.json({ error: 'That email does not match your account.' }, { status: 401 });
  const iso = new Date().toISOString();
  const res = NextResponse.json({
    ok: true,
    expiresAt: new Date(Date.parse(iso) + REAUTH_WINDOW_MS).toISOString(),
  });
  res.cookies.set(REAUTH_COOKIE, signReauth(s.user.id, iso), {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: new URL(req.url).protocol === 'https:',
    maxAge: REAUTH_MAX_AGE_S,
  });
  return res;
}
