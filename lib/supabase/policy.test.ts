import { describe, expect, it } from 'vitest';
import { authenticatedAt, checkSessionPolicy, CLIENT_MAX_AGE_S, INTERNAL_MAX_AGE_S } from './policy';

const NOW = 2_000_000_000;
const HOUR = 3600;

describe('session policy', () => {
  it('uses auth_time, then the earliest amr timestamp, then iat', () => {
    expect(authenticatedAt({ auth_time: 10, iat: 99, amr: [{ method: 'password', timestamp: 5 }] })).toBe(10);
    expect(
      authenticatedAt({
        iat: 99,
        amr: [
          { method: 'totp', timestamp: 50 },
          { method: 'password', timestamp: 40 },
        ],
      }),
    ).toBe(40);
    expect(authenticatedAt({ iat: 99, amr: ['password'] })).toBe(99);
    expect(authenticatedAt({})).toBeUndefined();
  });

  it('requires aal2 for internal roles only', () => {
    const fresh = { auth_time: NOW - HOUR };
    for (const role of ['admin', 'delivery_lead', 'team_member', 'associate'] as const) {
      expect(checkSessionPolicy(role, { ...fresh, aal: 'aal1' }, NOW)).toBe('mfa_required');
      expect(checkSessionPolicy(role, { ...fresh }, NOW)).toBe('mfa_required');
      expect(checkSessionPolicy(role, { ...fresh, aal: 'aal2' }, NOW)).toBe('ok');
    }
    for (const role of ['client_sponsor', 'client_member', 'client_viewer'] as const)
      expect(checkSessionPolicy(role, { ...fresh, aal: 'aal1' }, NOW)).toBe('ok');
  });

  it('expires internal sessions after 12 hours', () => {
    const ok = { aal: 'aal2', auth_time: NOW - INTERNAL_MAX_AGE_S + 60 };
    expect(checkSessionPolicy('delivery_lead', ok, NOW)).toBe('ok');
    expect(checkSessionPolicy('delivery_lead', { ...ok, auth_time: NOW - 13 * HOUR }, NOW)).toBe('expired');
  });

  it('expires client sessions after 7 days, not 12 hours', () => {
    expect(checkSessionPolicy('client_sponsor', { auth_time: NOW - 13 * HOUR }, NOW)).toBe('ok');
    expect(checkSessionPolicy('client_sponsor', { auth_time: NOW - CLIENT_MAX_AGE_S - 1 }, NOW)).toBe(
      'expired',
    );
  });

  it('checks expiry before MFA, and treats a missing sign-in time as expired', () => {
    expect(checkSessionPolicy('admin', { aal: 'aal1', auth_time: NOW - 2 * INTERNAL_MAX_AGE_S }, NOW)).toBe(
      'expired',
    );
    expect(checkSessionPolicy('client_member', {}, NOW)).toBe('expired');
  });
});
