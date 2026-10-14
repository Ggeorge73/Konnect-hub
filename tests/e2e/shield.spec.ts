import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Team Shield, Sprint 4. The e2e server runs in demo mode (no Supabase, no DATABASE_URL), so these
// cover what demo mode must keep doing; the Postgres path is covered by the contract suites
// (supabase/tests/run-contract-tests.sh) and real OAuth needs a Supabase project.

const a11y = async (page: import('@playwright/test').Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`);
};

test('KH-41: demo mode hides the Google and Microsoft buttons and keeps the demo notice', async ({
  page,
}) => {
  await page.goto('/auth/sign-in');
  await expect(page.getByText(/Demo mode: Supabase Auth is not configured/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with Microsoft' })).toHaveCount(0);
});

test('KH-41: an uninvited social sign-in lands on a clear invite page', async ({ page }) => {
  await page.goto('/auth/invite');
  await expect(page.getByRole('heading', { name: 'Ask your Konnector admin for an invite' })).toBeVisible();
  await expect(page.getByText(/Accounts are created by invitation only/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/auth/sign-in');
  expect(await a11y(page)).toEqual([]);
});

test('KH-41: the OAuth callback does nothing in demo mode', async ({ page }) => {
  const res = await page.request.get('/auth/callback?code=abc', { maxRedirects: 0 });
  expect([302, 307]).toContain(res.status());
  expect(new URL(res.headers()['location'], 'http://x').pathname).toBe('/');
});

test('KH-51: the Sprint 3 domains still answer through their stores in demo mode', async ({ page }) => {
  await page.request.post('/api/session', { data: { userId: 'u_lead' } });
  const dash = await (await page.request.get('/api/projects/EHR/dashboard')).json();
  expect(dash.evmAccess).toBe('full');
  const metrics = await page.request.get('/api/projects/EHR/metrics');
  expect(metrics.ok()).toBeTruthy();
  const draft = await page.request.post('/api/reports', {
    data: { projectKey: 'EHR', weekStart: '2027-06-07' },
  });
  expect(draft.ok()).toBeTruthy();
  expect((await draft.json()).status).toBe('draft');

  // A comment @mention still reaches the notification center through the active Signal store.
  await page.request.post('/api/session', { data: { userId: 'u_dev' } });
  const comment = await page.request.post('/api/items/EHR-4/comments', {
    data: { body: '@Tiara shield e2e ping', visibility: 'internal' },
  });
  expect(comment.ok()).toBeTruthy();
  await page.request.post('/api/session', { data: { userId: 'u_team' } });
  const notes = await (await page.request.get('/api/notifications')).json();
  expect(
    notes.some(
      (n: { kind: string; body?: string }) => n.kind === 'mention' && n.body?.includes('shield e2e'),
    ),
  ).toBe(true);

  // Clients still never get the dashboard money or the agile metrics.
  await page.request.post('/api/session', { data: { userId: 'u_cviewer' } });
  expect((await page.request.get('/api/projects/EHR/metrics')).status()).toBe(403);
});
