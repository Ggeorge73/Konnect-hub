import { handle } from '@/lib/api';
import { customFieldStore } from '@/lib/data/custom-fields';

/** The workspace's custom fields the caller may see (clients: shared ones). `?archived=1` for Admins. */
export const GET = (req: Request) =>
  handle(({ session }) =>
    customFieldStore().listFields(session, {
      includeArchived: new URL(req.url).searchParams.get('archived') === '1',
    }),
  );
