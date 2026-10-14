import type { Organization, Profile, Role, Session } from '../domain/types';
import { canAdminister, deactivateError, inviteRoleError, roleChangeError } from '../domain/admin';
import { ForbiddenError, ValidationError } from './errors';

/**
 * Throwing guards shared by the demo and Postgres admin stores, so both raise the same error
 * types and messages (Postgres would refuse anyway: RLS and the 0017 triggers).
 */
export function requireAdmin(s: Session, what = 'use the Admin console') {
  if (!canAdminister(s.user)) throw new ForbiddenError(`Only Admins can ${what}.`);
}

export function assertRoleChange(s: Session, target: Pick<Profile, 'id'>, org: Organization, role: Role) {
  const err = roleChangeError(s.user, target, org, role);
  if (!err) return;
  if (!canAdminister(s.user) || s.user.id === target.id) throw new ForbiddenError(err);
  throw new ValidationError(err);
}

export function assertDeactivate(s: Session, target: Pick<Profile, 'id'>) {
  const err = deactivateError(s.user, target);
  if (err) throw new ForbiddenError(err);
}

export function assertInviteRole(org: Organization | undefined, role: Role) {
  const err = inviteRoleError(org, role);
  if (err) throw new ValidationError(err);
}
