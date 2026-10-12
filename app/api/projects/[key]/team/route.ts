import { handle } from '@/lib/api';
import { capacityStore } from '@/lib/data/capacity';
import { assignSchema } from '@/lib/capacity-schemas';

type Ctx = { params: Promise<{ key: string }> };

/** GET /api/projects/:key/team: members, assignable people and whether the caller manages staffing. */
export const GET = (_: Request, { params }: Ctx) =>
  handle(async ({ session }) => capacityStore().getTeam(session, (await params).key));

/** POST /api/projects/:key/team: assign a person (role + allocation %); returns load warnings. */
export const POST = (req: Request, { params }: Ctx) =>
  handle(async ({ session }) =>
    capacityStore().assignMember(session, (await params).key, assignSchema.parse(await req.json())),
  );
