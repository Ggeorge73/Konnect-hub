import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { isSupabaseConfigured } from '@/lib/config';
import { isReauthFresh, REAUTH_WINDOW_MS } from '@/lib/domain/gates';
import { reauthSchema } from '@/lib/gate-schemas';
import { getReauthAt, REAUTH_COOKIE, REAUTH_MAX_AGE_S, signReauth } from '@/lib/reauth';
import { signedInRecently, verifyPassword } from '@/lib/auth/reauth-verify';

/** Is the signed-in user's re-auth still fresh? */
export const GET = () =>
  handle(async ({ session }) => {
    const at = await getReauthAt(session.user.id);
    const fresh = isReauthFresh(at, new Date());
    return { fresh, expiresAt: fresh ? new Date(Date.parse(at!) + REAUTH_WINDOW_MS).toISOString() : null };
  });

/**
 * "Confirm it's you". Sets an httpOnly, HMAC-signed `kh_reauth` cookie holding the re-auth time;
 * approval endpoints accept it for 15 minutes.
 * - Demo mode: the user re-enters their email (anyone can switch persona there anyway).
 * - Supabase Auth: the email must match and the password is verified with Supabase, unless the
 *   user signed in within the last 15 minutes (lib/auth/reauth-verify.ts).
 * Rate limited (10 per minute per client) in middleware.ts.
 */
export const POST = (req: Request) =>
  handle(async ({ session: s }) => {
    const parsed = reauthSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return deny('Enter your email address.', 400);
    if (parsed.data.email.toLowerCase() !== s.user.email.toLowerCase())
      return deny('That email does not match your account.', 401);
    if (isSupabaseConfigured()) {
      const ok = parsed.data.password
        ? await verifyPassword(s.user.id, s.user.email, parsed.data.password)
        : await signedInRecently();
      if (!ok)
        return deny(
          parsed.data.password
            ? 'That password is not right.'
            : 'Enter your password, or sign out and back in to confirm it’s you.',
          401,
        );
    }
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
  });

const deny = (error: string, status: number) => NextResponse.json({ error }, { status });
