import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSql, markMfaEnabled } from '@/lib/data/postgres';
import { errorStatus } from '@/lib/data/errors';

/**
 * Called by the MFA page right after a successful TOTP verify. Reads the verified Supabase
 * claims (the session must now be at aal2) and sets the caller's own profiles.mfa_enabled
 * through mark_mfa_enabled() (0009), which refuses anything but aal2 and touches no other row.
 */
export async function POST() {
  if (!isSupabaseConfigured() || !process.env.DATABASE_URL)
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  const { data, error } = await (await createSupabaseServerClient()).auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  if (claims.aal !== 'aal2')
    return NextResponse.json({ error: 'Verify your authenticator code first.' }, { status: 403 });
  try {
    return NextResponse.json({ ok: await markMfaEnabled(getSql(), claims.sub, claims.aal) });
  } catch (e) {
    const status = errorStatus(e);
    if (status === 500) console.error(e);
    return NextResponse.json(
      { error: status === 500 ? 'Something went wrong.' : (e as Error).message },
      { status },
    );
  }
}
