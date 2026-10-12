import { handle } from '@/lib/api';
import { capacityStore } from '@/lib/data/capacity';
import { restrictedSchema } from '@/lib/capacity-schemas';

type Ctx = { params: Promise<{ key: string }> };

/** PATCH /api/projects/:key/restricted: mark or clear Restricted (refused while non-U.S. people are on it). */
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    capacityStore().setRestricted(
      session,
      (await params).key,
      restrictedSchema.parse(await req.json()).restricted,
    ),
  );
