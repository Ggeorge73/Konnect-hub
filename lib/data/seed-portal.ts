import type { Invite, WorkspaceSettings } from '../domain/onboarding';

/** Team Portal tables in the demo store (`db().workspace`). */
export interface WorkspaceState {
  settings: WorkspaceSettings;
  invites: Invite[];
  /**
   * Seeded placeholder logos by client org id (line-art SVGs in /public/clients). An org's own
   * `logoUrl`, which Admin will edit, always wins over these.
   */
  clientLogos: Record<string, string>;
}

/**
 * Team Portal seed. The demo workspace is already onboarded, so Admins are not sent to the
 * first-run wizard and existing flows are undisturbed; "Re-run setup" on /admin still opens it.
 */
export function seedPortal(): { workspace: WorkspaceState } {
  return {
    workspace: {
      settings: {
        name: '',
        logoUrl: null,
        onboardedAt: '2026-08-03T09:00:00.000Z',
        updatedAt: '2026-08-03T09:00:00.000Z',
        updatedBy: 'u_admin',
      },
      invites: [],
      clientLogos: {
        org_peachtree: '/clients/peachtree.svg',
        org_riverbend: '/clients/riverbend.svg',
      },
    },
  };
}
