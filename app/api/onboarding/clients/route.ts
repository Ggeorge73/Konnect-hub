import { handle } from '@/lib/api';
import { createClientOrg } from '@/lib/data/onboarding';
import { clientOrgSchema } from '@/lib/domain/onboarding';

export const POST = (req: Request) =>
  handle(async ({ session }) => createClientOrg(session, clientOrgSchema.parse(await req.json())));
