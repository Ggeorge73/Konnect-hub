import { describe, expect, it } from 'vitest';
import { DEV_SECRET, MissingSecretError, serverSecret } from './secrets';
import { cronAuthorized } from './cron';

const strong = 's'.repeat(32);

describe('serverSecret', () => {
  it('returns a strong configured secret in every mode', () => {
    expect(serverSecret('REAUTH_SECRET', { REAUTH_SECRET: strong }, false)).toBe(strong);
    expect(serverSecret('ICS_SECRET', { ICS_SECRET: strong }, true)).toBe(strong);
  });
  it('falls back to the dev secret in demo mode only', () => {
    expect(serverSecret('REAUTH_SECRET', {}, true)).toBe(DEV_SECRET);
    expect(() => serverSecret('REAUTH_SECRET', {}, false)).toThrow(MissingSecretError);
    expect(() => serverSecret('ICS_SECRET', {}, false)).toThrow(/ICS_SECRET/);
  });
  it('refuses a short secret once real sign-in is configured', () => {
    expect(() => serverSecret('REAUTH_SECRET', { REAUTH_SECRET: 'short' }, false)).toThrow(
      MissingSecretError,
    );
    expect(serverSecret('REAUTH_SECRET', { REAUTH_SECRET: 'short' }, true)).toBe('short');
  });
});

describe('cronAuthorized', () => {
  const h = (v?: string) => new Headers(v === undefined ? {} : { 'x-cron-secret': v });
  it('needs the exact secret', () => {
    expect(cronAuthorized(h(strong), strong)).toBe(true);
    expect(cronAuthorized(h(strong + 'x'), strong)).toBe(false);
    expect(cronAuthorized(h('nope'), strong)).toBe(false);
    expect(cronAuthorized(h(), strong)).toBe(false);
  });
  it('is closed when CRON_SECRET is unset, empty or trivially short', () => {
    expect(cronAuthorized(h(''), undefined)).toBe(false);
    expect(cronAuthorized(h(''), '')).toBe(false);
    expect(cronAuthorized(h('abc'), 'abc')).toBe(false);
  });
});
