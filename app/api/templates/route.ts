import { handle } from '@/lib/api';
import { templateStore } from '@/lib/data/templates-admin';

/** Project templates (built-in and custom) for Konnector staff; `?archived=1` adds archived ones for Admins. */
export const GET = (req: Request) =>
  handle(({ session }) =>
    templateStore().listTemplates(session, {
      includeArchived: new URL(req.url).searchParams.get('archived') === '1',
    }),
  );
