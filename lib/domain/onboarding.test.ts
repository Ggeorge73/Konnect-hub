import { describe, expect, it } from 'vitest';
import {
  clientOrgSchema,
  inviteSchema,
  isInviteRole,
  logoUrlSchema,
  newInvites,
  shouldRedirectToOnboarding,
  splitEmails,
  workspaceDisplayName,
  workspaceSchema,
} from './onboarding';
import { APP_NAME } from '../config';

describe('workspace', () => {
  it('falls back to APP_NAME when unnamed', () => {
    expect(workspaceDisplayName({ name: '' })).toBe(APP_NAME);
    expect(workspaceDisplayName(null)).toBe(APP_NAME);
    expect(workspaceDisplayName({ name: ' Konnector Delivery ' })).toBe('Konnector Delivery');
  });

  it('validates the name and logo', () => {
    expect(workspaceSchema.safeParse({ name: 'K' }).success).toBe(false);
    expect(workspaceSchema.parse({ name: 'Konnector' })).toEqual({ name: 'Konnector', logoUrl: '' });
    expect(logoUrlSchema.safeParse('data:image/png;base64,AAAA').success).toBe(true);
    expect(logoUrlSchema.safeParse('/clients/peachtree.svg').success).toBe(true);
    expect(logoUrlSchema.safeParse('https://cdn.example/logo.png').success).toBe(true);
    expect(logoUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(logoUrlSchema.safeParse('http://insecure.example/x.png').success).toBe(false);
    expect(logoUrlSchema.safeParse('//evil.example/x.png').success).toBe(false);
    expect(logoUrlSchema.safeParse('data:text/html;base64,AAAA').success).toBe(false);
    expect(logoUrlSchema.safeParse('data:image/png;base64,' + 'A'.repeat(200_001)).success).toBe(false);
  });

  it('validates client names', () => {
    expect(clientOrgSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(clientOrgSchema.parse({ name: ' Acme Health ' }).name).toBe('Acme Health');
  });
});

describe('redirect to the wizard', () => {
  it('sends Admins once while the workspace is not onboarded', () => {
    expect(shouldRedirectToOnboarding({ role: 'admin' }, { onboardedAt: null }, false)).toBe(true);
    expect(shouldRedirectToOnboarding({ role: 'admin' }, { onboardedAt: null }, true)).toBe(false);
    expect(shouldRedirectToOnboarding({ role: 'admin' }, { onboardedAt: '2026-10-01' }, false)).toBe(false);
    expect(shouldRedirectToOnboarding({ role: 'delivery_lead' }, { onboardedAt: null }, false)).toBe(false);
  });
});

describe('invites', () => {
  it('splits and de-duplicates pasted lists', () => {
    expect(splitEmails('A@x.com, b@x.com;\n a@x.com  c@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('rejects empty lists, bad addresses and client roles', () => {
    expect(inviteSchema.safeParse({ emails: '  ' }).success).toBe(false);
    const bad = inviteSchema.safeParse({ emails: 'ok@x.com, nope' });
    expect(bad.error?.issues[0].message).toBe('Not an email address: nope');
    expect(inviteSchema.safeParse({ emails: 'ok@x.com', role: 'client_sponsor' }).success).toBe(false);
    expect(inviteSchema.parse({ emails: 'ok@x.com' }).role).toBe('team_member');
    expect(isInviteRole('associate')).toBe(true);
    expect(isInviteRole('admin')).toBe(false);
  });

  it('skips people who already have an account or a pending invite', () => {
    expect(
      newInvites(['ada@k.com', 'new@k.com', 'pending@k.com'], {
        profiles: [{ email: 'Ada@k.com' }],
        invites: [{ email: 'pending@k.com' }],
      }),
    ).toEqual(['new@k.com']);
  });
});
