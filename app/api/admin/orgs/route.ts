import { handle } from '@/lib/api';
import { adminStore } from '@/lib/data/admin';
import { createClientOrg } from '@/lib/data/onboarding';
import { clientOrgSchema } from '@/lib/domain/onboarding';

/** ADM-01 client orgs: list with user and project counts; create (the wizard's audited path). */
export const GET = () => handle(({ session }) => adminStore().listClientOrgs(session));
export const POST = (req: Request) =>
  handle(async ({ session }) => createClientOrg(session, clientOrgSchema.parse(await req.json())));
