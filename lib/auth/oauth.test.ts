import { describe, expect, it } from 'vitest';
import { callbackErrorReason, enabledOAuthProviders, linkDecision, OAUTH_LABEL, oauthSignIn } from './oauth';
import { checkSessionPolicy } from '../supabase/policy';

const NOW = 2_000_000_000;

describe('OAuth sign-in (KH-41)', () => {
  it('offers Google and Microsoft by default, or the configured subset', () => {
    expect(enabledOAuthProviders(undefined)).toEqual(['google', 'azure']);
    expect(enabledOAuthProviders('')).toEqual(['google', 'azure']);
    expect(enabledOAuthProviders('google')).toEqual(['google']);
    expect(enabledOAuthProviders(' Microsoft , nope')).toEqual(['azure']);
    expect(enabledOAuthProviders('none')).toEqual([]);
    expect(OAUTH_LABEL).toEqual({ google: 'Continue with Google', azure: 'Continue with Microsoft' });
  });

  it('asks for openid, email and profile and returns to /auth/callback', () => {
    expect(oauthSignIn('azure', 'https://hub.konnectortech.com')).toEqual({
      provider: 'azure',
      options: { redirectTo: 'https://hub.konnectortech.com/auth/callback', scopes: 'openid email profile' },
    });
    expect(oauthSignIn('google', 'http://localhost:3000').options.redirectTo).toBe(
      'http://localhost:3000/auth/callback',
    );
  });

  it('lets in only an invited profile with the same id and email', () => {
    const profile = { id: 'u1', email: 'Lara@KonnectorTech.com' };
    expect(linkDecision({ id: 'u1', email: 'lara@konnectortech.com' }, profile)).toBe('ok');
    expect(linkDecision({ id: 'u1', email: 'lara@konnectortech.com' }, null)).toBe('no-invite');
    expect(linkDecision({ id: 'u2', email: 'lara@konnectortech.com' }, profile)).toBe('no-invite');
    expect(linkDecision({ id: 'u1', email: 'someone@gmail.com' }, profile)).toBe('no-invite');
    expect(linkDecision({ id: 'u1', email: null }, profile)).toBe('no-invite');
  });

  it('maps a refused sign-up to the invite page and other provider errors to a retry', () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(callbackErrorReason(q('code=abc'))).toBeNull();
    expect(
      callbackErrorReason(q('error=access_denied&error_description=Signups+not+allowed+for+this+instance')),
    ).toBe('invite');
    expect(callbackErrorReason(q('error=access_denied&error_code=signup_disabled'))).toBe('invite');
    expect(callbackErrorReason(q('error=server_error&error_description=Unable+to+exchange'))).toBe(
      'link-failed',
    );
  });

  it('MFA is still required for internal roles after an OAuth sign-in (aal1), not for clients', () => {
    // Claims of a fresh Google/Microsoft session: amr method "oauth", assurance level aal1.
    const oauth = { aal: 'aal1', amr: [{ method: 'oauth', timestamp: NOW - 60 }], iat: NOW - 60 };
    for (const role of ['admin', 'delivery_lead', 'team_member', 'associate'] as const)
      expect(checkSessionPolicy(role, oauth, NOW)).toBe('mfa_required');
    for (const role of ['client_sponsor', 'client_member', 'client_viewer'] as const)
      expect(checkSessionPolicy(role, oauth, NOW)).toBe('ok');
    // After TOTP the session is aal2; the OAuth sign-in time still drives the 12-hour limit.
    const verified = {
      aal: 'aal2',
      amr: [
        { method: 'totp', timestamp: NOW - 30 },
        { method: 'oauth', timestamp: NOW - 60 },
      ],
      iat: NOW - 30,
    };
    expect(checkSessionPolicy('delivery_lead', verified, NOW)).toBe('ok');
    expect(checkSessionPolicy('delivery_lead', { ...verified, iat: NOW + 13 * 3600 }, NOW + 13 * 3600)).toBe(
      'expired',
    );
  });
});
