import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Team Flow (Sprint 5): KH-45 critical path on the timeline, KH-46 board paging.
// Read-only against the seeded EHR project, so it is independent of other spec files.

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

test('critical path toggle highlights critical bars and announces float', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/projects/EHR/timeline');
  await expect(page.locator('[data-testid^="bar-epic-"]').first()).toBeVisible();
  await expect(page.locator('[data-critical]')).toHaveCount(0);

  await page.getByRole('checkbox', { name: 'Critical path' }).check();
  const critical = page.locator('[data-testid^="bar-"][data-critical]');
  await expect(critical.first()).toBeVisible();
  expect(await critical.count()).toBeGreaterThanOrEqual(1);
  await expect(critical.first()).toHaveAttribute('aria-label', /float 0 days, on the critical path/);
  await expect(critical.first()).toHaveAttribute('aria-label', /critical/);
  // EHR-3 blocks EHR-2 and runs to the end of Execute, so both are critical and so is the arrow.
  await expect(page.getByTestId('bar-epic-wi_ehr_3')).toHaveAttribute('data-critical', 'true');
  await expect(page.getByTestId('bar-epic-wi_ehr_2')).toHaveAttribute('data-critical', 'true');
  await expect(page.locator('[data-testid="dependency-arrow"][data-critical]')).toHaveCount(1);
  // Non-critical bars show their float too.
  await expect(page.getByTestId('bar-epic-wi_ehr_1')).toHaveAttribute('aria-label', /float \d+ days?\./);
  await expect(page.getByTestId('critical-summary')).toContainText(
    'Critical path (Execute phase): EHR-3 → EHR-2',
  );

  // Scope: all phases.
  await page.getByRole('combobox', { name: 'Critical path scope' }).click();
  await page.getByRole('option', { name: 'All phases' }).click();
  await expect(page.getByTestId('critical-summary')).toContainText('Critical path (all phases)');

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);

  await page.getByRole('checkbox', { name: 'Critical path' }).uncheck();
  await expect(page.locator('[data-critical]')).toHaveCount(0);
});

test('board API pages each column and reports totals', async ({ page }) => {
  await asUser(page, 'u_lead');
  const full = await (await page.request.get('/api/projects/EHR/board?type=story,task,bug')).json();
  expect(full.items.length).toBe(
    Object.values(full.totals as Record<string, number>).reduce((a, b) => a + b, 0),
  );
  const res = await page.request.get('/api/projects/EHR/board?type=story,task,bug&limits=backlog:1,ready:1');
  const paged = await res.json();
  expect(paged.totals).toEqual(full.totals);
  expect(paged.items.filter((i: { status: string }) => i.status === 'backlog').length).toBe(
    Math.min(1, full.totals.backlog),
  );
  expect(paged.limits.backlog).toBe(1);

  // Clients only ever get shared cards; another client's board is not found.
  await asUser(page, 'u_sponsor');
  const client = await (await page.request.get('/api/projects/EHR/board?type=story,task,bug')).json();
  expect(client.items.every((i: { visibility: string }) => i.visibility === 'shared')).toBe(true);
  await asUser(page, 'u_rsponsor');
  expect((await page.request.get('/api/projects/EHR/board')).status()).toBe(404);
});

test('board card filter narrows on the server and the item panel opens in place', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/projects/EHR/board');
  await expect(page.getByTestId('card-EHR-7')).toBeVisible();
  await page.getByLabel('Filter cards').fill('cutover');
  await expect(page.getByTestId('card-EHR-8')).toHaveCount(0);
  await expect(page.getByTestId('card-EHR-7')).toBeVisible();
  await page.getByTestId('card-EHR-7').click();
  await expect(page).toHaveURL(/item=EHR-7/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(/Dry-run conversion/);
  await page.getByRole('button', { name: 'Close item panel' }).click();
  await expect(page).not.toHaveURL(/item=/);
});
