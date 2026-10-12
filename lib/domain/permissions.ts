import type { Profile, Project, ProjectMember, Role, Visibility } from './types';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Konnector Admin',
  delivery_lead: 'Delivery Lead',
  team_member: 'Team Member',
  associate: 'Associate',
  client_sponsor: 'Client Sponsor',
  client_member: 'Client Member',
  client_viewer: 'Client Viewer',
};

export const isClientRole = (r: Role) =>
  r === 'client_sponsor' || r === 'client_member' || r === 'client_viewer';
export const isInternalRole = (r: Role) => !isClientRole(r);

/** Can this user see the project at all? Mirrors the RLS policy `can_see_project`. */
export function canSeeProject(user: Profile, project: Project, members: ProjectMember[]): boolean {
  if (project.deletedAt) return user.role === 'admin';
  if (user.role === 'admin') return true;
  if (isClientRole(user.role)) return project.clientOrgId === user.orgId;
  if (project.restricted && !user.usPerson) return false;
  if (user.role === 'delivery_lead' && project.leadId === user.id) return true;
  return members.some((m) => m.projectId === project.id && m.userId === user.id);
}

/** Internal content is never shown to client users. Mirrors RLS `visibility = 'shared'`. */
export const canSeeVisibility = (user: Profile, v: Visibility) => isInternalRole(user.role) || v === 'shared';

export const canSeeFinancials = (user: Profile) => user.role === 'admin' || user.role === 'delivery_lead';
export const canSeeCostRates = (user: Profile) => user.role === 'admin';
export const canSeeClientList = (user: Profile) =>
  user.role === 'admin' || user.role === 'delivery_lead' || user.role === 'team_member';

export const canEditItems = (user: Profile) => user.role !== 'client_viewer' && isInternalRole(user.role);
export const canComment = (user: Profile) => user.role !== 'client_viewer';
export const canManageProject = (user: Profile, project: Project) =>
  user.role === 'admin' || (user.role === 'delivery_lead' && project.leadId === user.id);
export const canApproveGates = (user: Profile) => user.role === 'client_sponsor';
export const canCreateProject = (user: Profile) => user.role === 'admin' || user.role === 'delivery_lead';

/** Strip internal-only fields before sending a profile to a non-admin. */
export function redactProfile(viewer: Profile, p: Profile): Profile {
  if (canSeeCostRates(viewer)) return p;
  const { costRate: _omit, ...rest } = p;
  return rest;
}

export function redactProject(viewer: Profile, p: Project): Project {
  if (canSeeFinancials(viewer)) return p;
  return { ...p, bac: 0 };
}
