import { handle } from '@/lib/api';
import { ForbiddenError } from '@/lib/data/errors';
import { listEvents } from '@/lib/integration/service';
import { crmBaseUrl, isMockCrm } from '@/lib/integration/transport';

export const dynamic = 'force-dynamic';

/** GET /api/admin/integrations — Admin only: recent CRM events and how delivery is configured. */
export const GET = () =>
  handle(async ({ session }) => {
    if (session.user.role !== 'admin') throw new ForbiddenError('Only Admins can see integrations.');
    return {
      mode: isMockCrm() ? 'mock' : crmBaseUrl() ? 'live' : 'off',
      crmHost: crmBaseUrl() ? new URL(crmBaseUrl()).host : null,
      events: await listEvents(session, 200),
    };
  });
