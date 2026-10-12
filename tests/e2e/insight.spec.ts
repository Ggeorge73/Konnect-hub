import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Executive dashboard (DASH-01), earned value (EVM-01) and portfolio dashboard (DASH-02).
 * Uses the seeded EHR project; every change made here (RAG, budget sharing) is restored.
 */
const SEED_RAG = { rag: 'amber', reason: 'Conversion dry-run found duplicate patient records.' };

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

test.describe.configure({ mode: 'serial' });

test('lead opens the EHR dashboard and sees SPI/CPI tiles and the top 3 risks', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/projects/EHR');
  await page.getByRole('tab', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL(/\/projects\/EHR\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Executive dashboard' })).toBeVisible();
  await expect(page.getByRole('group', { name: /^SPI \(schedule\): \d\.\d{3}/ })).toBeVisible();
  await expect(page.getByRole('group', { name: /^CPI \(cost\): \d\.\d{3}/ })).toBeVisible();
  await expect(page.getByRole('group', { name: /^EAC: \$/ })).toBeVisible();
  await expect(page.getByTestId('suggested-rag')).toContainText('Suggested:');
  const risks = page.getByTestId('top-risks').getByRole('listitem');
  await expect(risks).toHaveCount(3);
  await expect(risks.first()).toContainText('Duplicate patient records delay cutover');
  await expect(page.getByRole('region', { name: 'Budget burn' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Gate progress' }).getByRole('list', { name: 'Delivery gates' }),
  ).toBeVisible();
});

test('lead overrides the RAG with a reason and the change is audited', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/projects/EHR/dashboard');
  await page.getByRole('button', { name: 'Override RAG' }).click();
  const dialog = page.getByRole('dialog', { name: 'Set RAG status' });
  await dialog.getByRole('radio', { name: 'Red' }).check();
  const save = dialog.getByRole('button', { name: 'Save status' });
  await expect(save).toBeDisabled();
  await dialog.getByLabel(/Reason/).fill('Go-live rehearsal failed; recovery plan in review.');
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('current-rag')).toContainText('RED');
  await expect(page.getByText('Go-live rehearsal failed; recovery plan in review.')).toBeVisible();

  // A reason is mandatory at the API too.
  const noReason = await page.request.patch('/api/projects/EHR/dashboard', {
    data: { rag: 'green', reason: ' ' },
  });
  expect(noReason.status()).toBe(400);
  // Non-managers cannot override.
  await asUser(page, 'u_dev');
  const dev = await page.request.patch('/api/projects/EHR/dashboard', {
    data: { rag: 'green', reason: 'x' },
  });
  expect(dev.status()).toBe(403);

  await asUser(page, 'u_lead');
  const audit = await (await page.request.get('/api/projects/EHR/dashboard/audit')).json();
  const entry = audit.find(
    (a: { action: string; after?: { ragReason?: string } }) =>
      a.action === 'project.rag_override' &&
      a.after?.ragReason === 'Go-live rehearsal failed; recovery plan in review.',
  );
  expect(entry).toMatchObject({ actorId: 'u_lead', entity: 'project', after: { rag: 'red' } });

  // Restore the seeded status for other specs.
  const restored = await page.request.patch('/api/projects/EHR/dashboard', { data: SEED_RAG });
  expect(restored.ok()).toBe(true);
});

test('Export PDF downloads a PDF and the export is audited', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/projects/EHR/dashboard');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Export PDF' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^EHR-dashboard-\d{4}-\d{2}-\d{2}\.pdf$/);
  const res = await page.request.get('/api/projects/EHR/dashboard.pdf');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
  const audit = await (await page.request.get('/api/projects/EHR/dashboard/audit')).json();
  expect(
    audit.filter((a: { action: string }) => a.action === 'dashboard.export_pdf').length,
  ).toBeGreaterThanOrEqual(2);
});

test('the sponsor portal dashboard shows no budget until the lead shares it', async ({ page }) => {
  await asUser(page, 'u_sponsor');
  await page.goto('/portal/EHR');
  await page.getByRole('link', { name: 'Open dashboard' }).click();
  await expect(page).toHaveURL(/\/portal\/EHR\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Executive dashboard' })).toBeVisible();
  await expect(page.getByText('Budget and earned value are not shared on this dashboard.')).toBeVisible();
  await expect(page.getByText('Duplicate patient records delay cutover')).toBeVisible();
  const body = await page.locator('main').innerText();
  for (const hidden of [
    'BAC',
    'EAC',
    'CPI',
    'Budget burn',
    '$480,000',
    'Suggested',
    'Integration estimate may be low',
  ])
    expect(body).not.toContain(hidden);
  const api = await (await page.request.get('/api/projects/EHR/dashboard')).json();
  expect(api).toMatchObject({ evmAccess: 'none', evm: null, burn: null, suggested: null });
  expect(JSON.stringify(api)).not.toContain('48000000');
  expect(
    (await page.request.patch('/api/projects/EHR/dashboard', { data: { shareBudget: true } })).status(),
  ).toBe(403);

  // The lead shares the budget view; the sponsor now sees EVM. Then it is unshared again.
  await asUser(page, 'u_lead');
  expect(
    (await page.request.patch('/api/projects/EHR/dashboard', { data: { shareBudget: true } })).ok(),
  ).toBe(true);
  await asUser(page, 'u_sponsor');
  await page.reload();
  await expect(page.getByRole('group', { name: /^CPI \(cost\)/ })).toBeVisible();
  await asUser(page, 'u_lead');
  expect(
    (await page.request.patch('/api/projects/EHR/dashboard', { data: { shareBudget: false } })).ok(),
  ).toBe(true);
});

test('u_assoc is blocked from /dashboards; the lead sees the portfolio', async ({ page }) => {
  await asUser(page, 'u_assoc');
  await page.goto('/dashboards');
  await expect(page).not.toHaveURL(/\/dashboards/);
  expect((await page.request.get('/api/dashboards/portfolio')).status()).toBe(403);

  await asUser(page, 'u_sponsor');
  expect((await page.request.get('/api/dashboards/portfolio')).status()).toBe(403);

  await asUser(page, 'u_lead');
  await page.goto('/dashboards');
  await expect(page.getByRole('heading', { name: 'Portfolio dashboard' })).toBeVisible();
  const table = page.getByRole('table', { name: 'Projects', exact: true });
  await expect(table).toContainText('EHR');
  await expect(table).toContainText('RVB');
  await expect(table).not.toContainText('PSR'); // led by the admin, lead is not a member
  await page.getByRole('combobox', { name: 'RAG' }).click();
  await page.getByRole('option', { name: 'Green' }).click();
  await expect(table).not.toContainText('EHR');
  await expect(table).toContainText('RVB');
});

for (const path of ['/projects/EHR/dashboard', '/dashboards']) {
  test(`no serious a11y violations on ${path}`, async ({ page }) => {
    await asUser(page, 'u_lead');
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);
  });
}
