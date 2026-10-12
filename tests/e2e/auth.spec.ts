import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The e2e server runs in demo mode (no Supabase): the auth pages explain that and link back,
// and the persona switcher keeps working. Real sign-in + MFA needs a Supabase project.

for (const path of ['/auth/sign-in', '/auth/mfa']) {
  test(`${path} renders the demo-mode notice without a11y violations`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText(/Demo mode/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the app' })).toHaveAttribute('href', '/');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);
  });
}

test('demo persona switching accepts known personas only', async ({ page }) => {
  const bad = await page.request.post('/api/session', { data: { userId: 'u_nobody' } });
  expect(bad.status()).toBe(400);
  const ok = await page.request.post('/api/session', { data: { userId: 'u_cviewer' } });
  expect(ok.ok()).toBeTruthy();
  const me = await (await page.request.get('/api/session')).json();
  expect(me.user.role).toBe('client_viewer');
  // Viewers are read-only through the same API the portal uses.
  const res = await page.request.post('/api/items/EHR-9/comments', {
    data: { body: 'hi', visibility: 'shared' },
  });
  expect(res.status()).toBe(403);
});

test('sign-out redirects to the sign-in page', async ({ page }) => {
  const res = await page.request.post('/auth/sign-out', { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()['location']).toContain('/auth/sign-in');
});

test('demo mode: the session reports demo auth and the user menu keeps the persona switcher', async ({
  page,
}) => {
  await page.request.post('/api/session', { data: { userId: 'u_lead' } });
  const me = await (await page.request.get('/api/session')).json();
  expect(me.auth).toBe('demo');
  await page.goto('/');
  await page.getByRole('button', { name: /Switch demo user/ }).click();
  await expect(page.getByText('Demo mode — view as')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Sign out (Supabase mode)' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
});
