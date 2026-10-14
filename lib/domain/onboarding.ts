import { z } from 'zod';
import type { Profile, Role } from './types';
import { APP_NAME } from '../config';

/** First-run onboarding (ONB-01). Pure functions only. */

export interface WorkspaceSettings {
  /** Display name; empty means "use APP_NAME". */
  name: string;
  /** Data URI, site path (/…) or https URL. */
  logoUrl: string | null;
  /** Set when an Admin finishes the setup wizard. Null on a fresh workspace. */
  onboardedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Roles an Admin can invite from the wizard: the Konnector team only (clients are invited per project). */
export const INVITE_ROLES = ['delivery_lead', 'team_member', 'associate'] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export interface Invite {
  id: string;
  email: string;
  /** The wizard invites Konnector roles; the Admin console (ADM-01) any role with an org. */
  role: Role;
  /** 'sent' once delivered through the Admin console (ADM-01). */
  status: 'pending' | 'sent';
  invitedBy: string;
  createdAt: string;
  /** The org the person joins; absent means Konnector (wizard invites). */
  orgId?: string | null;
  lastSentAt?: string | null;
  sentCount?: number;
}

export const ONBOARDING_STEPS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'client', label: 'First client' },
  { id: 'project', label: 'First project' },
  { id: 'invite', label: 'Invite your team' },
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]['id'];

/** Cookie set once the Admin has been sent to the wizard, so `/` redirects only once. */
export const ONBOARDING_SEEN_COOKIE = 'kh_onboarding_seen';

export const workspaceDisplayName = (w: Pick<WorkspaceSettings, 'name'> | null | undefined) =>
  w?.name?.trim() || APP_NAME;

export const canManageWorkspace = (user: Pick<Profile, 'role'>) => user.role === 'admin';

/** Admins land on the wizard once from `/` until the workspace is onboarded. */
export function shouldRedirectToOnboarding(
  user: Pick<Profile, 'role'>,
  w: Pick<WorkspaceSettings, 'onboardedAt'>,
  seen: boolean,
) {
  return canManageWorkspace(user) && !w.onboardedAt && !seen;
}

const MAX_LOGO = 200_000; // ~150 KB image as a data URI

/** Logos are images only: an image data URI, a site path or an https URL. */
export const logoUrlSchema = z
  .string()
  .trim()
  .max(MAX_LOGO, 'Logo is too large (max ~150 KB)')
  .refine(
    (v) =>
      v === '' ||
      /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(v) ||
      /^\/(?!\/)/.test(v) ||
      /^https:\/\//i.test(v),
    'Use a PNG, JPG, GIF, WebP or SVG image, a /path or an https:// link',
  );

export const workspaceSchema = z.object({
  name: z.string().trim().min(2, 'Name needs at least 2 characters').max(80, 'Keep the name under 80'),
  logoUrl: logoUrlSchema.default(''),
});
export type WorkspaceInput = z.infer<typeof workspaceSchema>;

export const clientOrgSchema = z.object({
  name: z.string().trim().min(2, 'Client name needs at least 2 characters').max(120, 'Keep it under 120'),
  logoUrl: logoUrlSchema.default(''),
});
export type ClientOrgInput = z.infer<typeof clientOrgSchema>;

/** Splits a pasted list (commas, semicolons, spaces or new lines) into unique lower-case emails. */
export const splitEmails = (raw: string) => [
  ...new Set(
    raw
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  ),
];

const email = z.string().email();

export const inviteSchema = z
  .object({
    emails: z.string(),
    role: z.enum(INVITE_ROLES).default('team_member'),
  })
  .superRefine((v, ctx) => {
    const list = splitEmails(v.emails);
    if (list.length === 0)
      ctx.addIssue({ code: 'custom', path: ['emails'], message: 'Add at least one email' });
    const bad = list.filter((e) => !email.safeParse(e).success);
    if (bad.length)
      ctx.addIssue({ code: 'custom', path: ['emails'], message: `Not an email address: ${bad.join(', ')}` });
    if (list.length > 50)
      ctx.addIssue({ code: 'custom', path: ['emails'], message: 'Invite up to 50 at a time' });
  });
export type InviteInput = z.input<typeof inviteSchema>;

/** New invites only: skips people who already have an account or a pending invite. */
export function newInvites(
  emails: string[],
  existing: { profiles: Pick<Profile, 'email'>[]; invites: Pick<Invite, 'email'>[] },
) {
  const taken = new Set(
    [...existing.profiles.map((p) => p.email), ...existing.invites.map((i) => i.email)].map((e) =>
      e.toLowerCase(),
    ),
  );
  return emails.filter((e) => !taken.has(e.toLowerCase()));
}

export const isInviteRole = (r: Role): r is InviteRole => (INVITE_ROLES as readonly string[]).includes(r);
