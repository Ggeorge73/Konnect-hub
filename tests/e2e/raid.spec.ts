import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

test.describe.configure({ mode: 'serial' });

// Unique per run so the spec is independent of other specs and of re-runs on a reused server.
const TITLE = `E2E vendor cutover clash ${Date.now().toString(36)}`;

test('lead adds a 5×4 risk, filters by heat map and closes it only with a note', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/projects/EHR/raid');
  await expect(page.getByRole('tab', { name: /Risks/ })).toHaveAttribute('aria-selected', 'true');

  // 1. Add a 5×4 risk and see the Escalate chip.
  await page.getByRole('button', { name: 'Add risk' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title').fill(TITLE);
  await dialog.getByLabel('Category').click();
  await page.getByRole('option', { name: 'Vendor' }).click();
  await dialog.getByLabel('Probability (1–5)').click();
  await page.getByRole('option', { name: '5', exact: true }).click();
  await dialog.getByLabel('Impact (1–5)').click();
  await page.getByRole('option', { name: '4', exact: true }).click();
  await expect(dialog.getByText('Escalate to steering')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add risk' }).click();
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole('row', { name: new RegExp(TITLE) });
  await expect(row).toBeVisible();
  await expect(row.getByText('20 · High')).toBeVisible();
  await expect(row.getByText('Escalate to steering')).toBeVisible();
  // The Lead is notified that the risk needs steering.
  await expect(page.getByRole('button', { name: /Notifications, \d+ unread/ })).toBeVisible();

  // 2. Click its heat-map cell and see the list filter.
  const seeded = page.getByRole('row', { name: /Duplicate patient records delay cutover/ });
  await expect(seeded).toBeVisible();
  const cell = page.getByRole('button', { name: /^Probability 5, impact 4: score 20/ });
  await cell.click();
  await expect(cell).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Filtered: P5 × I4/)).toBeVisible();
  await expect(row).toBeVisible();
  await expect(seeded).toHaveCount(0);

  // 3. Closing without a note fails (server rule too); with a note it succeeds.
  const api = await page.request.patch('/api/raid/rd_ehr_2', { data: { status: 'closed' } });
  expect(api.status()).toBe(400);
  expect((await api.json()).error).toBe('A risk cannot be closed without a closure note.');

  await row.getByRole('button', { name: `Edit ${TITLE}` }).click();
  await dialog.getByLabel('Status').click();
  await page.getByRole('option', { name: 'Closed' }).click();
  const note = dialog.getByLabel('Closure note');
  await expect(note).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('A risk cannot be closed without a closure note.');
  await note.fill('Vendor moved their release window; no longer clashes with cutover.');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByText('Closed')).toBeVisible();
  await expect(row.getByText('Escalate to steering')).toHaveCount(0);
});

test('client sponsor sees only the shared risk in the portal', async ({ page }) => {
  await asUser(page, 'u_sponsor');
  await page.goto('/portal/EHR');
  const section = page.getByRole('region', { name: 'Shared risks and issues' });
  await expect(section).toBeVisible();
  await expect(section.getByRole('listitem')).toHaveCount(1);
  await expect(section.getByText('Duplicate patient records delay cutover')).toBeVisible();
  await expect(page.getByText('Integration estimate may be low')).toHaveCount(0);
  await expect(page.getByText(TITLE)).toHaveCount(0);
  const write = await page.request.patch('/api/raid/rd_ehr_1', { data: { title: 'Client edit' } });
  expect(write.status()).toBe(403);
});

for (const tab of ['risk', 'issue']) {
  test(`no serious a11y violations on the RAID ${tab} tab`, async ({ page }) => {
    await asUser(page, 'u_lead');
    await page.goto(`/projects/EHR/raid?tab=${tab}`);
    await expect(
      page.getByRole('tablist', { name: 'RAID register' }).getByRole('tab', { selected: true }),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);
  });
}
