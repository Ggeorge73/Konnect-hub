import { handle } from '@/lib/api';
import { getDemoProject, getWorkspace, listInvites } from '@/lib/data/onboarding';
import { requireAdmin } from '@/lib/data/onboarding-postgres';

/** Admin: everything the setup wizard and /admin need in one call. */
export const GET = () =>
  handle(async ({ session, repo }) => {
    requireAdmin(session);
    const [workspace, invites, orgs, demoProject] = await Promise.all([
      getWorkspace(session),
      listInvites(session),
      repo.listOrgs(session),
      getDemoProject(session),
    ]);
    return { workspace, invites, clients: orgs.filter((o) => o.type === 'client'), demoProject };
  });
