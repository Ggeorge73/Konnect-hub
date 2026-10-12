import { handle } from '@/lib/api';
import { capacityStore } from '@/lib/data/capacity';
import { personPatchSchema } from '@/lib/capacity-schemas';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/people/:id: one directory entry with the visible project memberships. */
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => capacityStore().getPerson(session, (await params).id));

/** PATCH /api/people/:id: Admins edit every field; Delivery Leads skills and certifications. */
export const PATCH = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    capacityStore().updatePerson(session, (await params).id, personPatchSchema.parse(await req.json())),
  );
