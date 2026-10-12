import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/config';
import { outbox } from '@/lib/email/send';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dev/outbox[?to=email] — demo mode only: the emails that would have been sent
 * (when RESEND_API_KEY is not set), newest first. 404 whenever Supabase is configured.
 */
export async function GET(req: Request) {
  if (isSupabaseConfigured()) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const to = new URL(req.url).searchParams.get('to')?.toLowerCase();
  return NextResponse.json(
    outbox()
      .filter((m) => !to || m.to.toLowerCase() === to)
      .slice()
      .reverse(),
  );
}
