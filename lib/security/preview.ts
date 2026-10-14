import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Impersonation, Organization, Profile, Role } from '../domain/types';
import { serverSecret } from './secrets';

/**
 * "View as client" preview (CLAUDE.md §2, KH-47). An Admin picks a client org and role; the app
 * then renders as a representative user of that org and role, read-only.
 *
 * The choice lives in an httpOnly, SameSite=Strict cookie `kh_preview`:
 * `<base64url(JSON payload)>.<HMAC-SHA256(adminId|payload)>`, keyed with REAUTH_SECRET under its own
 * "preview|" domain. It only takes effect when the verified signature matches the signed-in user
 * and that user is still an Admin, so it cannot be forged, replayed by another user or kept after a
 * demotion. Expires after PREVIEW_MAX_AGE_S.
 */
export const PREVIEW_ROLES = ['client_sponsor', 'client_member', 'client_viewer'] as const;
export type PreviewRole = (typeof PREVIEW_ROLES)[number];
export const PREVIEW_MAX_AGE_S = 60 * 60;

export const previewStartSchema = z.object({
  orgId: z.string().trim().min(1, 'Choose a client organization').max(64),
  role: z.enum(PREVIEW_ROLES),
});

export interface PreviewClaim {
  adminId: string;
  orgId: string;
  role: PreviewRole;
  startedAt: string;
}

const claimSchema = z.object({
  adminId: z.string().min(1),
  orgId: z.string().min(1),
  role: z.enum(PREVIEW_ROLES),
  startedAt: z.string().datetime(),
});

const mac = (payload: string, key: string) =>
  createHmac('sha256', key).update(`preview|${payload}`).digest('base64url');

export function signPreview(claim: PreviewClaim, key = serverSecret('REAUTH_SECRET')): string {
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
  return `${payload}.${mac(payload, key)}`;
}

/**
 * The claim, or null when the cookie is missing, malformed, tampered, expired or minted for another
 * admin. `userId` is the real signed-in user.
 */
export function verifyPreview(
  token: string | undefined,
  userId: string,
  now = new Date(),
  key = serverSecret('REAUTH_SECRET'),
): PreviewClaim | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(mac(payload, key));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
  const claim = claimSchema.safeParse(parsed);
  if (!claim.success || claim.data.adminId !== userId) return null;
  const age = now.getTime() - Date.parse(claim.data.startedAt);
  if (age < 0 || age > PREVIEW_MAX_AGE_S * 1000) return null;
  return claim.data;
}

/**
 * Picks who the admin sees the portal as: the first user (by name) of that client org holding that
 * role. Using a real profile means every visibility rule, and RLS in Postgres mode, applies exactly
 * as it does for that client. Null when the org has nobody in that role.
 */
export function pickPreviewSubject(
  profiles: Profile[],
  orgs: Organization[],
  orgId: string,
  role: Role,
): Profile | null {
  const org = orgs.find((o) => o.id === orgId);
  if (!org || org.type !== 'client') return null;
  return (
    profiles
      .filter((p) => p.orgId === orgId && p.role === role)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0] ?? null
  );
}

export function impersonationOf(
  admin: Profile,
  subject: Profile,
  org: Organization,
  startedAt: string,
): Impersonation {
  return {
    adminId: admin.id,
    adminName: admin.name,
    role: subject.role,
    orgId: org.id,
    orgName: org.name,
    asUserId: subject.id,
    asUserName: subject.name,
    startedAt,
    readOnly: true,
  };
}
