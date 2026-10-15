import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { ForbiddenError } from '@/lib/data/errors';
import { runCron } from '@/lib/integration/service';
import { cronAuthorized } from '@/lib/security/cron';

export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/crm/cron — the CRM integration's scheduled job (every 15 minutes, header
 * `x-cron-secret: $CRON_SECRET`): retries due deliveries, sends project health that changed (and
 * every project at least daily) and "respond by" reminders. Admins may also run it by hand.
 */
export async function POST(req: Request) {
  if (cronAuthorized(req.headers)) return NextResponse.json(await runCron());
  return handle(async ({ session }) => {
    if (session.user.role !== 'admin') throw new ForbiddenError('Only Admins can run the CRM job.');
    return runCron();
  });
}
