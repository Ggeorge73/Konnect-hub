import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

test.describe.configure({ mode: 'serial' });

const NOTE = `Re-run of the conversion dry-run is booked ${Date.now().toString(36)}`;
/** Internal EHR RAID titles (lib/data/seed-raid.ts) that must never reach the client. */
const INTERNAL_RAID = [
  'Integration estimate may be low',
  'Super-users unavailable during training window',
  'Provider schedule extract missing two clinics',
  'Dry-run halted on duplicate MRNs',
  'Lab vendor provides production HL7 ADT endpoint',
];
let reportId = '';

test('Metrics tab shows six sprints of velocity and the active sprint burndown', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/projects/EHR');
  await page.getByRole('tab', { name: 'Metrics' }).click();
  await expect(page).toHaveURL(/\/projects\/EHR\/metrics$/);
  const velocity = page.getByRole('table', { name: 'Velocity data' });
  await expect(velocity.getByRole('row')).toHaveCount(7); // header + 6 sprints
  await expect(velocity.getByRole('rowheader', { name: 'EHR Sprint 2 (in progress)' })).toHaveCount(1);
  await expect(page.getByTestId('velocity-chart').locator('.recharts-bar-rectangle').first()).toBeVisible();
  const burndown = page.getByTestId('burndown-chart');
  await expect(burndown.getByRole('heading', { name: 'Sprint burndown' })).toBeVisible();
  await expect(burndown.locator('.recharts-line-curve')).toHaveCount(2);
  for (const id of ['cfd-chart', 'cycle-chart', 'throughput-chart'])
    await expect(page.getByTestId(id).locator('svg.recharts-surface').first()).toBeVisible();
});

test('moving an item to Done adds to this week’s throughput', async ({ page }) => {
  await asUser(page, 'u_dev');
  const thisWeek = async () => {
    const res = await page.request.get('/api/projects/EHR/metrics');
    expect(res.ok()).toBeTruthy();
    return (await res.json()).throughput.at(-1).count as number;
  };
  const created = await page.request.post('/api/items', {
    data: { projectId: 'EHR', type: 'task', title: `Pulse throughput check ${Date.now().toString(36)}` },
  });
  expect(created.ok()).toBeTruthy();
  const { key } = await created.json();
  expect(
    (await page.request.patch(`/api/items/${key}`, { data: { status: 'in_progress' } })).ok(),
  ).toBeTruthy();
  const before = await thisWeek();
  expect((await page.request.patch(`/api/items/${key}`, { data: { status: 'done' } })).ok()).toBeTruthy();
  expect(await thisWeek()).toBe(before + 1);
});

test('lead generates a draft, edits a section and publishes through the checklist', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Status reports' })).toBeVisible();
  const row = page.getByTestId('report-row-EHR');
  await row
    .getByRole('button', { name: /Generate draft for Demo — Clinic EHR Go-Live/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/reports\/sr_/);
  reportId = page.url().split('/').pop()!;
  await expect(page.getByTestId('report-section-budget')).toBeVisible();
  await expect(page.getByTestId('report-section-risks')).toContainText('Integration estimate may be low');

  const scope = page.getByRole('textbox', { name: 'Scope section' });
  await scope.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type(NOTE);
  const saved = page.waitForResponse(
    (r) => r.url().endsWith(`/api/reports/${reportId}`) && r.request().method() === 'PATCH',
  );
  await page.getByRole('heading', { name: 'Schedule' }).click(); // blur saves
  expect((await saved).ok()).toBeTruthy();
  await expect(page.getByText('All changes saved')).toBeVisible();

  await page.getByRole('button', { name: 'Publish…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish to the client portal' });
  const removed = dialog.getByRole('list', { name: 'Removed from the client copy' });
  await expect(removed.getByText('Budget section (internal only)')).toBeVisible();
  await expect(removed.getByText('Risk: Integration estimate may be low')).toBeVisible();
  await expect(dialog.getByText('3 client users are notified when you publish.')).toBeVisible();
  const publish = dialog.getByRole('button', { name: 'Publish report' });
  await expect(publish).toBeDisabled();
  await dialog.getByLabel('I have reviewed the report and it is ready for the client').check();
  await publish.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Left out of the client copy' })).toBeVisible();
});

test('the sponsor reads the report in the portal without internal risks or the budget', async ({ page }) => {
  test.skip(!reportId, 'needs the published report from the previous test');
  await asUser(page, 'u_sponsor');
  await page.goto('/portal/EHR');
  const section = page.getByTestId('portal-status-reports');
  await expect(section).toBeVisible();
  await section.locator(`a[href="/portal/EHR/reports/${reportId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/portal/EHR/reports/${reportId}$`));
  await expect(page.getByText(NOTE)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scope' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Budget' })).toHaveCount(0);
  const body = await page.locator('main').innerText();
  expect(body).not.toContain('480,000');
  for (const title of INTERNAL_RAID) expect(body).not.toContain(title);
  // The API serves the same client copy.
  const api = await page.request.get(`/api/reports/${reportId}`);
  const json = JSON.stringify(await api.json());
  expect(json).not.toContain('480,000');
  for (const title of INTERNAL_RAID) expect(json).not.toContain(title);
  const notes = await (await page.request.get('/api/notifications')).json();
  expect(notes.some((n: { kind: string }) => n.kind === 'status_report_published')).toBe(true);
});

test('a team member can draft but publishing returns 403', async ({ page }) => {
  await asUser(page, 'u_team');
  const draft = await page.request.post('/api/reports', { data: { projectKey: 'PSR' } });
  expect(draft.ok()).toBeTruthy();
  const { id, canPublish, budgetHidden } = await draft.json();
  expect(canPublish).toBe(false);
  expect(budgetHidden).toBe(true);
  const res = await page.request.post(`/api/reports/${id}/publish`, { data: {} });
  expect(res.status()).toBe(403);
  await page.goto(`/reports/${id}`);
  await expect(page.getByText('Only the project’s Delivery Lead or an Admin can publish it.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish…' })).toHaveCount(0);
});

for (const path of ['/projects/EHR/metrics', '/reports', 'report']) {
  test(`no serious a11y violations on ${path}`, async ({ page }) => {
    await asUser(page, 'u_lead');
    await page.goto(path === 'report' ? `/reports/${reportId || 'sr_ehr_1005'}` : path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);
  });
}

test('no serious a11y violations on a portal status report', async ({ page }) => {
  await asUser(page, 'u_sponsor');
  await page.goto('/portal/EHR/reports/sr_ehr_1005');
  await expect(page.getByRole('heading', { name: 'Scope' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);
});
