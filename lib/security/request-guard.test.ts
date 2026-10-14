import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, csrfCheck, previewBlocks } from './request-guard';

const h = (o: Record<string, string>) => new Headers({ host: 'hub.example.com', ...o });

describe('csrfCheck', () => {
  it('lets safe methods through whatever their origin', () => {
    expect(
      csrfCheck('GET', '/api/items', h({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })),
    ).toBe('ok');
    expect(csrfCheck('HEAD', '/api/items', h({ 'sec-fetch-site': 'cross-site' }))).toBe('ok');
  });

  it('accepts same-origin writes', () => {
    expect(
      csrfCheck(
        'POST',
        '/api/items',
        h({ origin: 'https://hub.example.com', 'sec-fetch-site': 'same-origin' }),
      ),
    ).toBe('ok');
    expect(csrfCheck('PATCH', '/api/items/EHR-1', h({ origin: 'https://HUB.example.com' }))).toBe('ok');
  });

  it('refuses cross-site and same-site (sibling subdomain) writes by Sec-Fetch-Site', () => {
    expect(csrfCheck('POST', '/api/items', h({ 'sec-fetch-site': 'cross-site' }))).toBe('cross-site');
    expect(csrfCheck('DELETE', '/api/demo', h({ 'sec-fetch-site': 'same-site' }))).toBe('cross-site');
  });

  it('refuses a foreign or opaque Origin when Sec-Fetch-Site is missing', () => {
    expect(csrfCheck('POST', '/api/items', h({ origin: 'https://evil.example' }))).toBe('cross-site');
    expect(csrfCheck('POST', '/api/items', h({ origin: 'https://hub.example.com.evil.example' }))).toBe(
      'cross-site',
    );
    expect(csrfCheck('POST', '/api/items', h({ origin: 'null' }))).toBe('cross-site');
    expect(csrfCheck('PUT', '/api/items', h({ origin: 'http://hub.example.com:8080' }))).toBe('cross-site');
  });

  it('honours X-Forwarded-Host behind a proxy', () => {
    expect(
      csrfCheck(
        'POST',
        '/api/items',
        new Headers({
          host: 'internal:3000',
          'x-forwarded-host': 'hub.example.com',
          origin: 'https://hub.example.com',
        }),
      ),
    ).toBe('ok');
  });

  it('passes non-browser requests (no Origin, no Sec-Fetch-Site): they carry no ambient cookies', () => {
    expect(csrfCheck('POST', '/api/items', h({}))).toBe('ok');
  });

  it('exempts the cron and calendar endpoints', () => {
    const x = h({ origin: 'https://scheduler.example', 'sec-fetch-site': 'cross-site' });
    expect(csrfCheck('POST', '/api/notifications/digest', x)).toBe('ok');
    expect(csrfCheck('POST', '/api/raid/escalate', x)).toBe('ok');
    expect(csrfCheck('POST', '/api/projects/EHR/calendar.ics', x)).toBe('ok');
    expect(csrfCheck('POST', '/api/projects/EHR/calendar', x)).toBe('cross-site');
  });
});

describe('previewBlocks (View as client is read-only)', () => {
  it('blocks every write while previewing, except exit preview and sign out', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(previewBlocks(m, '/api/items/EHR-1', true), m).toBe(true);
    expect(previewBlocks('POST', '/api/session/preview', true)).toBe(true);
    expect(previewBlocks('POST', '/portal/EHR', true)).toBe(true); // server actions are POSTs to pages
    expect(previewBlocks('DELETE', '/api/session/preview', true)).toBe(false);
    expect(previewBlocks('POST', '/auth/sign-out', true)).toBe(false);
  });
  it('never blocks reads, and nothing when not previewing', () => {
    expect(previewBlocks('GET', '/api/items', true)).toBe(false);
    expect(previewBlocks('POST', '/api/items', false)).toBe(false);
  });
});

describe('contentSecurityPolicy', () => {
  it('uses a nonce and strict-dynamic for scripts, with no unsafe-inline scripts', () => {
    const csp = contentSecurityPolicy('abc123');
    const script = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
  it("adds 'unsafe-eval' in development only (React Refresh)", () => {
    expect(contentSecurityPolicy('n', true)).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy('n', false)).not.toContain("'unsafe-eval'");
  });
});
