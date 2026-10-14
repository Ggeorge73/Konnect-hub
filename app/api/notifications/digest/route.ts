import { NextResponse } from 'next/server';
import { sendDigests } from '@/lib/data/notify';
import { cronAuthorized } from '@/lib/security/cron';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/digest — the daily digest run. A scheduled cron (Vercel Cron or
 * Supabase pg_cron, once a day at 07:00 local) calls it with header `x-cron-secret: $CRON_SECRET`.
 * Without a matching secret (or with CRON_SECRET unset) it returns 401.
 */
export async function POST(req: Request) {
  if (!cronAuthorized(req.headers)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await sendDigests());
}
