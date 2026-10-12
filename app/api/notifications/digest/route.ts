import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { sendDigests } from '@/lib/data/notify';

export const dynamic = 'force-dynamic';

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * POST /api/notifications/digest — the daily digest run. A scheduled cron (Vercel Cron or
 * Supabase pg_cron, once a day at 07:00 local) calls it with header `x-cron-secret: $CRON_SECRET`.
 * Without a matching secret (or with CRON_SECRET unset) it returns 401.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('x-cron-secret') ?? '';
  if (!secret || !same(given, secret)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await sendDigests());
}
