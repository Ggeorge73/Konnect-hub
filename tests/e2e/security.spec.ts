import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Team Shield, Sprint 5: KH-47 [SEC-03] security review and hardening.
 *
 * The e2e server runs in demo mode (no Supabase): a request without a persona cookie is signed in
 * as the default demo persona (u_lead), because demo mode has no sign-in at all. So "no session"
 * cannot be produced here; it is covered for every route by lib/security/routes.test.ts, which
 * simulates Supabase mode without claims. This file covers what demo mode can show: object-level
 * authorization across tenants, CSRF, rate limits, security headers and the read-only preview.
 */

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

/** Every app/api route and its exported methods, read from the filesystem (new routes are covered). */
function apiRoutes(): { route: string; methods: Method[] }[] {
  const dir = path.join(process.cwd(), 'app/api');
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => path.basename(f) === 'route.ts')
    .map((f) => {
      const src = readFileSync(path.join(dir, f), 'utf8');
      const methods = METHODS.filter((m) =>
        new RegExp(`export (const ${m}\\b|async function ${m}\\b|function ${m}\\b)`).test(src),
      );
      return { route: '/api/' + path.dirname(f).split(path.sep).join('/'), methods };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}

/** Peachtree (org_peachtree) object keys from the demo seed: project EHR and its children. */
const PEACHTREE: Record<string, string> = {
  key: 'EHR',
  entity: 'items',
  userId: 'u_dev',
  cid: 'dlc_ehr_1_1',
};
const ID_BY_ROUTE: [RegExp, string][] = [
  [/^\/api\/deliverables\//, 'dl_ehr_1'],
  [/^\/api\/gates\/reviews\//, 'gr_ehr_1'],
  [/^\/api\/projects\/\[key\]\/gates\/criteria\//, 'p_ehr_ph1_c0'],
  [/^\/api\/raid\//, 'rd_ehr_1'],
  [/^\/api\/sprints\//, 's_ehr1'],
  [/^\/api\/reports\//, 'sr_ehr_1005'],
  [/^\/api\/time\//, 'te_1'],
  [/^\/api\/people\//, 'u_sponsor'],
];
const QUERY = 'projectId=p_ehr&project=EHR&item=EHR-1&q=EHR&visibility=internal&format=csv';

function concrete(route: string) {
  const id = ID_BY_ROUTE.find(([r]) => r.test(route))?.[1] ?? 'missing';
  const key = route.startsWith('/api/items/') ? 'EHR-1' : PEACHTREE.key;
  return route
    .replace('[key]', key)
    .replace('[id]', id)
    .replace(/\[(cid|userId|entity)\]/g, (_, p: string) => PEACHTREE[p]!);
}

/** A body that passes many route schemas, so authorization (not validation) is what refuses it. */
const BODY = {
  status: 'accepted',
  decision: 'approved',
  title: 'Shield probe',
  body: 'Shield probe',
  text: 'Shield probe',
  name: 'Shield probe',
  visibility: 'shared',
  watching: true,
  done: true,
  itemKey: 'EHR-1',
  ids: ['wi_ehr_1'],
  patch: { status: 'done' },
  projectKey: 'EHR',
  project: 'EHR',
  projectId: 'p_ehr',
  phaseId: 'p_ehr_ph3',
  restricted: true,
  shareBudget: true,
  rag: 'red',
  reason: 'probe',
  hours: 1,
  date: '2026-10-14',
  week: '2026-10-12',
  carryOver: 'backlog',
  role: 'client_sponsor',
  email: 'probe@riverbend.example',
};

/** Leak markers: Peachtree data a Riverbend user must never receive. */
const LEAK = /Peachtree|peachtreeclinic|Clinic EHR|Grace|"p_ehr"|"wi_ehr_|"bac":\s*[1-9]|costRate/i;

/** Routes scoped to the caller only (no other tenant's object involved): a 2xx is fine without leaks. */
const SELF_SCOPED = new Set([
  'GET /api/session',
  'GET /api/reauth',
  'GET /api/notifications',
  'PATCH /api/notifications',
  'GET /api/notifications/preferences',
  'PATCH /api/notifications/preferences',
  'GET /api/portal/inbox',
  'GET /api/gates/pending',
  'GET /api/deliverables/pending',
  'GET /api/projects',
  'GET /api/orgs',
  'GET /api/people',
  'GET /api/search',
  'GET /api/items',
  'GET /api/raid',
  'GET /api/reports',
  'GET /api/sprints',
  'GET /api/session/preview',
  'DELETE /api/session/preview',
  'GET /api/time',
]);
/** Not part of the matrix: demo-only routes (persona switch = the demo's sign-in; the dev outbox). */
// The demo outbox shows every outgoing email to anyone (404 once Supabase is configured; finding F-16).
const SKIP = new Set(['POST /api/session', 'GET /api/dev/outbox']);

test.describe('KH-47: every API route as a client of the other org', () => {
  test('route list comes from the filesystem', () => {
    const routes = apiRoutes();
    expect(routes.length).toBeGreaterThan(60);
    expect(routes.every((r) => r.methods.length > 0)).toBe(true);
  });

  test('Riverbend sponsor gets 401/403/404 (or own-scoped data) and never Peachtree data', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await asUser(page, 'u_rsponsor');
    const failures: string[] = [];
    for (const { route, methods } of apiRoutes()) {
      for (const m of methods) {
        if (SKIP.has(`${m} ${route}`)) continue;
        const url = `${concrete(route)}?${QUERY}`;
        const res = await page.request.fetch(url, {
          method: m,
          data: m === 'GET' ? undefined : BODY,
          maxRedirects: 0,
        });
        const status = res.status();
        const body = route.includes('realtime') && status === 200 ? '' : await res.text();
        const self = SELF_SCOPED.has(`${m} ${route}`);
        const ok =
          [401, 403, 404].includes(status) || (m !== 'GET' && status === 400) || (self && status < 300);
        if (!ok) failures.push(`${m} ${url} -> ${status} ${body.slice(0, 160)}`);
        if (LEAK.test(body))
          failures.push(`${m} ${url} leaks: ${body.match(LEAK)?.[0]} in ${body.slice(0, 160)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test('Peachtree data is still there for its own sponsor (the probe is not vacuous)', async ({ page }) => {
    await asUser(page, 'u_sponsor');
    expect((await page.request.get('/api/projects/EHR')).status()).toBe(200);
    expect((await page.request.get('/api/projects/EHR/gates')).status()).toBe(200);
    await asUser(page, 'u_rsponsor');
    expect((await page.request.get('/api/projects/EHR')).status()).toBe(404);
  });

  test('demo mode always has a persona: no cookie means the default demo user', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
    const me = await (await anon.get('/api/session')).json();
    expect(me.auth).toBe('demo');
    expect(me.user.id).toBe('u_lead');
    await anon.dispose();
  });
});

test.describe('KH-47: security headers', () => {
  const expectHardened = (h: Record<string, string>) => {
    expect(h['strict-transport-security']).toContain('max-age=63072000');
    expect(h['strict-transport-security']).toContain('includeSubDomains');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toContain('camera=()');
    expect(h['permissions-policy']).toContain('microphone=()');
    expect(h['permissions-policy']).toContain('geolocation=()');
    const csp = h['content-security-policy']!;
    const script = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(script).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'$/);
    expect(script).not.toContain('unsafe-inline');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(h['x-powered-by']).toBeUndefined();
  };

  test('pages and API responses carry the hardened headers with a fresh nonce', async ({ page }) => {
    await asUser(page, 'u_lead');
    const a = await page.request.get('/');
    const b = await page.request.get('/');
    expectHardened(a.headers());
    expectHardened(b.headers());
    const nonce = (h: Record<string, string>) => /'nonce-([^']+)'/.exec(h['content-security-policy']!)![1];
    expect(nonce(a.headers())).not.toBe(nonce(b.headers()));
    expectHardened((await page.request.get('/api/projects')).headers());
    expectHardened((await page.request.get('/auth/sign-in')).headers());
  });

  test('the app runs under the nonce CSP with no violations', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to (execute|load|apply)/i.test(m.text()))
        violations.push(m.text());
    });
    await asUser(page, 'u_lead');
    const res = await page.goto('/projects/EHR/board');
    await page.waitForLoadState('networkidle');
    const n = /'nonce-([^']+)'/.exec(res!.headers()['content-security-policy']!)![1]!;
    expect(n.length).toBeGreaterThan(10);
    // Next.js stamped the nonce on its scripts (browsers hide the value from the DOM), and the page
    // hydrated: the board's columns rendered from client-side data.
    expect(await page.locator('script[nonce]').count()).toBeGreaterThan(0);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.goto('/projects/EHR/list');
    await page.waitForLoadState('networkidle');
    expect(violations).toEqual([]);
  });
});

test.describe('KH-47: CSRF', () => {
  test('cross-site writes are refused, same-origin and non-browser writes pass', async ({
    page,
    baseURL,
  }) => {
    await asUser(page, 'u_lead');
    const data = { body: 'csrf probe', visibility: 'internal' };
    const evil = await page.request.post('/api/items/EHR-4/comments', {
      data,
      headers: { origin: 'https://evil.example' },
    });
    expect(evil.status()).toBe(403);
    expect((await evil.json()).error).toMatch(/cross-site/i);
    const fetchSite = await page.request.patch('/api/notifications', {
      data: {},
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(fetchSite.status()).toBe(403);
    const sameSite = await page.request.delete('/api/demo', { headers: { 'sec-fetch-site': 'same-site' } });
    expect(sameSite.status()).toBe(403);
    const same = await page.request.post('/api/items/EHR-4/comments', {
      data,
      headers: { origin: baseURL!, 'sec-fetch-site': 'same-origin' },
    });
    expect(same.status()).toBe(200);
    // Reads are never blocked; the cron endpoint is exempt (and answers 401 without its secret).
    expect(
      (await page.request.get('/api/projects', { headers: { origin: 'https://evil.example' } })).status(),
    ).toBe(200);
    expect(
      (
        await page.request.post('/api/notifications/digest', {
          headers: { origin: 'https://scheduler.example', 'sec-fetch-site': 'cross-site' },
        })
      ).status(),
    ).toBe(401);
  });

  test('a forged form post from another site is refused in a real browser', async ({ page, baseURL }) => {
    await asUser(page, 'u_lead');
    const before = (await (await page.request.get('/api/items/EHR-4')).json()).comments.length;
    // A page on another origin auto-submits a form at the API (classic CSRF).
    await page.route('https://evil.example/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<form method="post" enctype="text/plain" action="${baseURL}/api/items/EHR-4/comments">
          <input name='{"body":"csrf","visibility":"internal","x":"' value='"}'></form>
          <script>document.forms[0].submit()</script>`,
      }),
    );
    const refused = page.waitForResponse((r) => r.url().endsWith('/api/items/EHR-4/comments'));
    await page.goto('https://evil.example/attack');
    expect((await refused).status()).toBe(403);
    const after = (await (await page.request.get('/api/items/EHR-4')).json()).comments.length;
    expect(after).toBe(before);
  });
});

test.describe('KH-47: rate limiting', () => {
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;

  test('re-auth attempts are limited per client with 429 and Retry-After', async ({ page }) => {
    await asUser(page, 'u_sponsor');
    const statuses: number[] = [];
    let last: Awaited<ReturnType<APIRequestContext['post']>> | undefined;
    for (let i = 0; i < 12; i++) {
      last = await page.request.post('/api/reauth', {
        data: { email: 'wrong@peachtreeclinic.example' },
        headers: { 'x-forwarded-for': ip },
      });
      statuses.push(last.status());
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(Number(last!.headers()['retry-after'])).toBeGreaterThan(0);
    expect(Number(last!.headers()['retry-after'])).toBeLessThanOrEqual(60);
    // Other clients are unaffected.
    const other = await page.request.post('/api/reauth', {
      data: { email: 'wrong@peachtreeclinic.example' },
      headers: { 'x-forwarded-for': `${ip}1` },
    });
    expect(other.status()).toBe(401);
  });

  test('the public calendar feed is limited too', async ({ page }) => {
    const feedIp = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
    const statuses: number[] = [];
    for (let i = 0; i < 62; i++)
      statuses.push(
        (
          await page.request.get('/api/projects/EHR/calendar.ics?token=bad.token', {
            headers: { 'x-forwarded-for': feedIp },
          })
        ).status(),
      );
    expect(statuses.slice(0, 60).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(60)).toEqual([429, 429]);
  });
});

test.describe.serial('KH-47: View as client preview (read-only, audited)', () => {
  test('only Admins can start a preview', async ({ page }) => {
    for (const who of ['u_lead', 'u_sponsor']) {
      await asUser(page, who);
      const res = await page.request.post('/api/session/preview', {
        data: { orgId: 'org_peachtree', role: 'client_sponsor' },
      });
      expect(res.status(), who).toBe(403);
    }
    await asUser(page, 'u_admin');
    const bad = await page.request.post('/api/session/preview', {
      data: { orgId: 'org_konnector', role: 'client_sponsor' },
    });
    expect(bad.status()).toBe(404);
    const role = await page.request.post('/api/session/preview', {
      data: { orgId: 'org_peachtree', role: 'admin' },
    });
    expect(role.status()).toBe(400);
  });

  test('while previewing, no write succeeds on any route, and data is unchanged', async ({ page }) => {
    test.setTimeout(120_000);
    await asUser(page, 'u_admin');
    const before = await (await page.request.get('/api/items/EHR-1')).json();
    const start = await page.request.post('/api/session/preview', {
      data: { orgId: 'org_peachtree', role: 'client_sponsor' },
    });
    expect(start.status()).toBe(200);
    const me = await (await page.request.get('/api/session')).json();
    expect(me.user.role).toBe('client_sponsor');
    expect(me.org.id).toBe('org_peachtree');
    expect(me.impersonation).toMatchObject({ adminId: 'u_admin', role: 'client_sponsor', readOnly: true });

    const writes: string[] = [];
    for (const { route, methods } of apiRoutes())
      for (const m of methods.filter((x) => x !== 'GET')) {
        if (m === 'DELETE' && route === '/api/session/preview') continue;
        const res = await page.request.fetch(concrete(route), { method: m, data: BODY, maxRedirects: 0 });
        const error = await res
          .json()
          .then((j: { error?: string }) => j.error)
          .catch(() => undefined);
        if (res.status() !== 403 || error !== 'preview_read_only')
          writes.push(`${m} ${route} -> ${res.status()}`);
      }
    // Server actions and page POSTs are refused too, as is switching persona mid-preview.
    expect((await page.request.post('/portal/EHR', { data: {} })).status()).toBe(403);
    expect((await page.request.post('/api/session', { data: { userId: 'u_lead' } })).status()).toBe(403);
    expect(writes).toEqual([]);

    // Reads work, as that client: the shared portal view only.
    expect((await page.request.get('/api/projects/EHR')).status()).toBe(200);
    expect((await page.request.get('/api/projects/RVB')).status()).toBe(404);

    expect((await page.request.delete('/api/session/preview')).status()).toBe(200);
    const after = await (await page.request.get('/api/items/EHR-1')).json();
    expect(after.item.status).toBe(before.item.status);
    expect(after.item.title).toBe(before.item.title);
    expect(after.comments.length).toBe(before.comments.length);
    const back = await (await page.request.get('/api/session')).json();
    expect(back.user.id).toBe('u_admin');
    expect(back.impersonation).toBeNull();
  });

  test('admin previews from /admin, sees the banner, exits; start and stop are audited', async ({ page }) => {
    await asUser(page, 'u_admin');
    await page.goto('/admin');
    const card = page.getByRole('region', { name: 'View as client' });
    await card.getByLabel('Client organization').click();
    await page.getByRole('option', { name: 'Riverbend County IT' }).click();
    await card.getByRole('button', { name: 'Start preview' }).click();
    await page.waitForURL('**/portal');
    const banner = page.getByTestId('preview-banner');
    await expect(banner).toContainText('Read-only preview');
    await expect(banner).toContainText('Client Sponsor');
    await expect(banner).toContainText('Riverbend County IT');
    await expect(page.getByText('Riverbend County IT portal')).toBeVisible();
    await page.goto('/portal/RVB');
    await expect(page.getByTestId('preview-banner')).toBeVisible();
    await page.getByRole('button', { name: 'Exit preview' }).click();
    await page.waitForURL('**/admin');
    await expect(page.getByRole('heading', { name: 'Admin', level: 1 })).toBeVisible();

    const audit = await (await page.request.get('/api/admin/audit?action=preview.&pageSize=50')).json();
    const rows = audit.rows as { action: string; actorId: string; entityId: string }[];
    expect(rows.some((r) => r.action === 'preview.start' && r.entityId === 'org_riverbend')).toBe(true);
    expect(rows.some((r) => r.action === 'preview.stop' && r.entityId === 'org_riverbend')).toBe(true);
    expect(rows.every((r) => r.actorId === 'u_admin')).toBe(true);
  });
});
