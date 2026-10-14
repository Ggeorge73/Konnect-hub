import { describe, expect, it } from 'vitest';
import { ORGS, PROFILES } from '@/lib/data/seed';
import {
  impersonationOf,
  pickPreviewSubject,
  PREVIEW_MAX_AGE_S,
  previewStartSchema,
  signPreview,
  verifyPreview,
  type PreviewClaim,
} from './preview';

const KEY = 'k'.repeat(40);
const now = new Date('2026-10-14T12:00:00.000Z');
const claim: PreviewClaim = {
  adminId: 'u_admin',
  orgId: 'org_peachtree',
  role: 'client_sponsor',
  startedAt: now.toISOString(),
};

describe('preview cookie', () => {
  it('round-trips for the admin who started it', () => {
    expect(verifyPreview(signPreview(claim, KEY), 'u_admin', now, KEY)).toEqual(claim);
  });

  it('is bound to that admin: another user cannot replay it', () => {
    expect(verifyPreview(signPreview(claim, KEY), 'u_lead', now, KEY)).toBeNull();
  });

  it('rejects tampering, another key and garbage', () => {
    const t = signPreview(claim, KEY);
    const [payload, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claim, orgId: 'org_riverbend' })).toString('base64url');
    expect(verifyPreview(`${forged}.${sig}`, 'u_admin', now, KEY)).toBeNull();
    expect(verifyPreview(`${payload}.${sig}x`, 'u_admin', now, KEY)).toBeNull();
    expect(verifyPreview(t, 'u_admin', now, 'other'.repeat(10))).toBeNull();
    expect(verifyPreview(undefined, 'u_admin', now, KEY)).toBeNull();
    expect(verifyPreview('nodot', 'u_admin', now, KEY)).toBeNull();
    expect(verifyPreview('.sig', 'u_admin', now, KEY)).toBeNull();
  });

  it('only previews client roles', () => {
    const t = signPreview({ ...claim, role: 'admin' as never }, KEY);
    expect(verifyPreview(t, 'u_admin', now, KEY)).toBeNull();
    expect(previewStartSchema.safeParse({ orgId: 'org_peachtree', role: 'delivery_lead' }).success).toBe(
      false,
    );
    expect(previewStartSchema.safeParse({ orgId: 'org_peachtree', role: 'client_viewer' }).success).toBe(
      true,
    );
  });

  it('expires after its max age', () => {
    const t = signPreview(claim, KEY);
    const later = new Date(now.getTime() + PREVIEW_MAX_AGE_S * 1000 + 1);
    expect(verifyPreview(t, 'u_admin', later, KEY)).toBeNull();
    const earlier = new Date(now.getTime() - 1000);
    expect(verifyPreview(t, 'u_admin', earlier, KEY)).toBeNull();
  });
});

describe('pickPreviewSubject', () => {
  it('picks a real profile of that client org and role', () => {
    expect(pickPreviewSubject(PROFILES, ORGS, 'org_peachtree', 'client_sponsor')?.id).toBe('u_sponsor');
    expect(pickPreviewSubject(PROFILES, ORGS, 'org_peachtree', 'client_viewer')?.id).toBe('u_cviewer');
    expect(pickPreviewSubject(PROFILES, ORGS, 'org_riverbend', 'client_sponsor')?.id).toBe('u_rsponsor');
  });
  it('never picks an internal org, an unknown org or an empty role', () => {
    expect(pickPreviewSubject(PROFILES, ORGS, 'org_konnector', 'client_sponsor')).toBeNull();
    expect(pickPreviewSubject(PROFILES, ORGS, 'org_konnector', 'admin')).toBeNull();
    expect(pickPreviewSubject(PROFILES, ORGS, 'org_nope', 'client_sponsor')).toBeNull();
    expect(pickPreviewSubject(PROFILES, ORGS, 'org_riverbend', 'client_viewer')).toBeNull();
  });
  it('describes the preview as read-only, naming the admin and the subject', () => {
    const admin = PROFILES.find((p) => p.id === 'u_admin')!;
    const subject = PROFILES.find((p) => p.id === 'u_sponsor')!;
    const org = ORGS.find((o) => o.id === 'org_peachtree')!;
    expect(impersonationOf(admin, subject, org, claim.startedAt)).toMatchObject({
      adminId: 'u_admin',
      role: 'client_sponsor',
      orgId: 'org_peachtree',
      asUserId: 'u_sponsor',
      readOnly: true,
    });
  });
});
