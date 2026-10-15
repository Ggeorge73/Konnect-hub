import { handle } from '@/lib/api';
import { ForbiddenError } from '@/lib/data/errors';
import { syncHealth } from '@/lib/integration/service';

/** POST /api/admin/integrations/health — Admin only: send every handed-off project's health now. */
export const POST = () =>
  handle(async ({ session }) => {
    if (session.user.role !== 'admin') throw new ForbiddenError('Only Admins can send project health.');
    return syncHealth(new Date(), { force: true });
  });
