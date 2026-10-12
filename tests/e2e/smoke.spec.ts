import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

test.describe.configure({ mode: 'serial' });

test('lead creates a project from the template in one pass', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Smoke Test Rollout');
  await page.getByLabel('Key (e.g. ACME)').fill('SMK');
  await page.getByLabel('Client').click();
  await page.getByRole('option', { name: 'Riverbend County IT' }).click();
  await page.getByLabel('Target').fill('2027-06-30');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/SMK$/);
  await expect(page.getByRole('list', { name: 'Delivery gates' }).getByText('Mobilize')).toBeVisible();
  await expect(page.getByText('Project charter approved')).toBeVisible();
});

test('team member moves a card with the keyboard and comments internally', async ({ page }) => {
  await asUser(page, 'u_dev');
  await page.goto('/projects/EHR/board');
  const card = page.getByTestId('card-EHR-8');
  await expect(card).toBeVisible();
  await card.focus();
  // Pause between keys like a person would; dnd-kit attaches its key listeners after pick-up.
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  await expect(
    page.getByRole('region', { name: /In Progress column/ }).getByTestId('card-EHR-8'),
  ).toBeVisible();

  await page.getByTestId('card-EHR-8').click();
  await expect(page).toHaveURL(/item=EHR-8/);
  await page.getByLabel('Comment', { exact: true }).fill('Reconciliation script is ready (internal note).');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByText('Reconciliation script is ready (internal note).')).toBeVisible();
});

test('client sees only shared work, never internal comments, and accepts', async ({ page }) => {
  await asUser(page, 'u_sponsor');
  await page.goto('/projects/EHR');
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByText('Riverbend Permit Portal')).toHaveCount(0);
  await page.goto('/portal/EHR?item=EHR-8');
  await expect(page.getByText('Reconciliation script is ready (internal note).')).toHaveCount(0);
  await page.goto('/portal/EHR');
  await expect(page.getByText('Confirm HL7 ADT feed endpoint with lab vendor')).toHaveCount(0); // internal item
  await page.goto('/portal/EHR?item=EHR-9');
  await page.getByLabel('Status').click();
  await page.getByRole('option', { name: 'Accepted' }).click();
  await page.goto('/portal/EHR');
  await expect(
    page.getByRole('link', { name: /Build family-medicine progress note template/ }).getByText('Accepted'),
  ).toBeVisible();
});

test('a team member cannot mark work Accepted', async ({ page }) => {
  await asUser(page, 'u_dev');
  const res = await page.request.patch('/api/items/EHR-10', { data: { status: 'accepted' } });
  expect(res.status()).toBe(403);
});

for (const path of ['/', '/projects/EHR/board', '/projects/EHR/list']) {
  test(`no serious a11y violations on ${path}`, async ({ page }) => {
    await asUser(page, 'u_lead');
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);
  });
}
