import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { escalateStaleIssues } from '@/lib/data/raid';

/**
 * RAID-02 stale-issue escalation.
 *
 * In production a scheduled cron (e.g. Vercel Cron or Supabase pg_cron, hourly) calls
 * `POST /api/raid/escalate` with header `x-cron-secret: $CRON_SECRET` and scans every project.
 * Each stale issue (open, no update for more than 10 days) is notified to the project Lead and
 * all Admins at most once per 24 hours. Signed-in Admins and Delivery Leads may also run it by
 * hand; it then only scans the projects they can see.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('x-cron-secret') === secret) {
    const r = await escalateStaleIssues(null);
    return NextResponse.json({ escalated: r.escalated.length, notified: r.notifications.length });
  }
  return handle(async ({ session }) => {
    const r = await escalateStaleIssues(session);
    return { escalated: r.escalated.length, notified: r.notifications.length };
  });
}
