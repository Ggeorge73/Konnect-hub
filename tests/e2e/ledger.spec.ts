import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Team Ledger: time tracking (KH-37), CSV / Excel exports (KH-39) and the audit viewer (KH-38).
 * Serial: the dev logs time, the lead approves it, and EHR's actual cost moves by exactly
 * 2.5 h × $95 = $237.50. Uses the dev's own entry only, so other specs are unaffected.
 */
const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

const today = () => new Date().toISOString().slice(0, 10);
const NOTE = `E2E dry-run ${Date.now()}`;
let acBefore = 0;

const ehrAc = async (page: Page) => {
  await asUser(page, 'u_lead');
  const res = await page.request.get('/api/projects/EHR/dashboard');
  expect(res.ok()).toBe(true);
  return (await res.json()).evm.ac as number;
};

const csvLines = (text: string) => text.replace(/^﻿/, '').split('\r\n').filter(Boolean);

test.describe.configure({ mode: 'serial' });

test('the dev logs 2.5 h on EHR-7 from the item panel and submits the week', async ({ page }) => {
  acBefore = await ehrAc(page);
  await asUser(page, 'u_dev');
  await page.goto('/projects/EHR/board?item=EHR-7');
  const section = page.getByRole('region', { name: 'Log time' });
  await expect(section).toBeVisible();
  const form = section.getByRole('form', { name: 'Log time on this item' });
  await form.getByLabel('Hours').fill('2.3');
  await expect(form.getByText('Log time in quarter hours (0.25 steps).')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Log time' })).toBeDisabled();
  await form.getByLabel('Hours').fill('2.5');
  await form.getByLabel('Date').fill(today());
  await form.getByLabel('Note').fill(NOTE);
  await form.getByRole('button', { name: 'Log time' }).click();
  await expect(section.getByRole('list', { name: 'Your time on this item' })).toContainText(NOTE);

  await page.goto('/timesheet');
  await expect(page.getByRole('heading', { name: 'Timesheet', level: 1 })).toBeVisible();
  const row = page.getByTestId('ts-row-EHR-7');
  await expect(row).toBeVisible();
  await expect(row.locator('input[value="2.5"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Submit week' }).click();
  await expect(page.getByText(/^Submitted \d+ entries for approval\.$/)).toBeVisible();
  await expect(row.getByText('Submitted').first()).toBeVisible();

  // Week navigation keeps working (previous week has the seeded, approved and locked time).
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(page.getByTestId('ts-row-EHR-7').getByText('Approved').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next week' }).click();
});

test('the lead approves the dev’s week and it is locked', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/timesheet/approvals');
  await expect(page.getByRole('heading', { name: 'Time approvals' })).toBeVisible();
  const group = page.getByRole('region', { name: /^Adeoba Cole — \d{4}-W\d{2}$/ }).filter({ hasText: NOTE });
  await expect(group).toBeVisible();
  await expect(group).not.toContainText('$'); // Leads never see cost
  await group.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/^Approved \d+ entries for Adeoba Cole\.$/)).toBeVisible();
  await expect(group).toBeHidden();

  // Approved time is locked for its owner.
  await asUser(page, 'u_dev');
  const week = (await (await page.request.get(`/api/time?week=${today()}`)).json()) as {
    id: string;
    note: string;
    status: string;
  }[];
  const mine = week.find((e) => e.note === NOTE)!;
  expect(mine.status).toBe('approved');
  const edit = await page.request.patch(`/api/time/${mine.id}`, { data: { hours: 1 } });
  expect(edit.status()).toBe(403);
});

test('EHR actual cost rises by 2.5 h × $95 (API)', async ({ page }) => {
  expect((await ehrAc(page)) - acBefore).toBe(23_750);
});

test('approved-time CSV: the lead gets no rate column, the admin does', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/timesheet/approvals');
  await page.getByRole('button', { name: 'Export approved time' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^approved-time-all-\d{4}-\d{2}-\d{2}\.csv$/);
  const lead = csvLines(await readFile((await download.path())!, 'utf8'));
  expect(lead[0]).toBe('Person,Project,Item,Date,Hours,Billable,Note,Approved by,Approved at');
  expect(lead.some((l) => l.includes(NOTE))).toBe(true);

  await asUser(page, 'u_admin');
  const res = await page.request.get('/api/exports/time?format=csv&project=EHR');
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('text/csv');
  const admin = csvLines(await res.text());
  expect(admin[0]).toBe(
    'Person,Project,Item,Date,Hours,Billable,Note,Approved by,Approved at,Cost rate,Cost',
  );
  expect(admin.find((l) => l.includes(NOTE))).toMatch(/,95,237\.5$/);

  // Excel works too; team members can't export approved time.
  const xlsx = await page.request.get('/api/exports/time?format=xlsx&project=EHR');
  expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
  await asUser(page, 'u_dev');
  expect((await page.request.get('/api/exports/time?format=csv')).status()).toBe(403);
});

test('a client CSV export of portal items contains no internal keys', async ({ page }) => {
  await asUser(page, 'u_lead');
  const items = (await (await page.request.get('/api/items?projectId=p_ehr')).json()) as {
    key: string;
    visibility: string;
  }[];
  const internal = items.filter((i) => i.visibility === 'internal').map((i) => i.key);
  expect(internal.length).toBeGreaterThan(0);

  await asUser(page, 'u_sponsor');
  await page.goto('/portal/EHR');
  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'CSV' }).click(),
  ]);
  const lines = csvLines(await readFile((await download.path())!, 'utf8'));
  expect(lines[0]).toBe('Key,Title,Type,Status');
  expect(lines.length).toBeGreaterThan(1);
  const keys = lines.slice(1).map((l) => l.split(',')[0]);
  for (const k of internal) expect(keys).not.toContain(k);
  // Asking for internal columns or another org's project doesn't help.
  const sneaky = await page.request.get('/api/exports/items?format=csv&project=EHR&cols=visibility,assignee');
  expect(csvLines(await sneaky.text())[0]).toBe('Key,Title,Type,Status');
  expect((await page.request.get('/api/exports/items?format=csv&project=RVB')).status()).toBe(404);
});

test('the admin audit viewer shows the export entries', async ({ page }) => {
  await asUser(page, 'u_admin');
  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await page.getByLabel('Action starts with').fill('export.');
  const rows = page.getByTestId('audit-row');
  await expect(rows.first()).toContainText('export.');
  await expect(rows.filter({ hasText: 'export.csv' }).filter({ hasText: 'items' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'export.csv' }).filter({ hasText: 'time' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'Lara Bennett' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'Grace Whitfield' }).first()).toBeVisible();
  await rows
    .first()
    .getByRole('button', { name: /View changes/ })
    .click();
  const drawer = page.getByRole('dialog', { name: /export\./ });
  await expect(drawer.getByRole('table', { name: 'Before and after' })).toContainText('rows');
  await drawer.getByRole('button', { name: 'Close' }).click();

  // Persona switches are audited as logins; other roles can't read the log.
  await page.getByLabel('Action starts with').fill('auth.login');
  await expect(rows.first()).toContainText('auth.login');
  await asUser(page, 'u_lead');
  expect((await page.request.get('/api/admin/audit')).status()).toBe(403);
});

for (const [path, user] of [
  ['/timesheet', 'u_dev'],
  ['/timesheet/approvals', 'u_admin'],
  ['/admin/audit', 'u_admin'],
] as const) {
  test(`no serious a11y violations on ${path}`, async ({ page }) => {
    await asUser(page, user);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);
  });
}
