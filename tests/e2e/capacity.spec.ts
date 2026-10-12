import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

/** Monday (UTC) of the current ISO week plus n weeks, as YYYY-MM-DD (same rule as lib/domain/capacity.ts). */
const week = (n: number) => {
  const now = new Date();
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86_400_000 + n * 7 * 86_400_000).toISOString().slice(0, 10);
};

test.describe.configure({ mode: 'serial' });

test('lead assigns Tiara to EHR at 60% and sees the over-80% warning', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/projects/EHR/team');
  await expect(page.getByRole('tab', { name: 'Team' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Assign person' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Person').click();
  await page.getByRole('option', { name: /^Tiara Mensah/ }).click();
  await dialog.getByLabel('Project role').fill('QA Lead');
  await dialog.getByLabel('Allocation %').fill('60');
  const warning = dialog.getByRole('status');
  await expect(warning).toContainText(
    /Tiara Mensah would be above 80% of capacity in \d+ weeks? \(peak 90% in W\d\d\)/,
  );
  // A warning, not a block.
  await dialog.getByRole('button', { name: 'Assign' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Assigned\. Tiara Mensah would be above 80%/)).toBeVisible();
  const row = page.getByRole('row', { name: /Tiara Mensah/ });
  await expect(row.getByText('QA Lead')).toBeVisible();
  await expect(row.getByText('60%')).toBeVisible();

  // The grid shows her at 90% (amber) this week: EHR 24 h + 12 h on PSR, which the Lead can't see.
  await page.goto('/people/allocations');
  const cell = page.getByTestId(`cell-u_team-${week(0)}`);
  await expect(cell).toHaveAttribute('data-level', 'amber');
  await expect(cell).toContainText('90%');
  await expect(cell).toContainText('EHR 24h');
  await expect(cell).toContainText('Other 12h');
});

test('an allocation cell over 100% is red with its % text; hours edit inline from the keyboard', async ({
  page,
}) => {
  await asUser(page, 'u_lead');
  await page.goto('/people/allocations');
  const spike = page.getByTestId(`cell-u_dev-${week(2)}`);
  await expect(spike).toHaveAttribute('data-level', 'red');
  await expect(spike).toContainText('120%');
  await expect(spike.getByRole('button')).toHaveAccessibleName(
    /^120% · Adeoba Cole, W\d\d: 48 of 40 hours, Over capacity$/,
  );

  // Keyboard: focus Lara's first cell, Enter opens the editor, type hours, Enter saves.
  const mine = page.getByTestId(`cell-u_lead-${week(1)}`);
  await mine.getByRole('button').focus();
  await page.keyboard.press('Enter');
  const editor = page.getByRole('form', { name: /Edit hours: Lara Bennett/ });
  await expect(editor).toBeVisible();
  await editor.getByLabel('EHR hours').fill('30');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(mine).toHaveAttribute('data-level', 'red');
  await expect(mine).toContainText('115%');
  await expect(mine).toContainText('EHR 30h');
  // Arrow keys move between cells.
  await mine.getByRole('button').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId(`cell-u_lead-${week(2)}`).getByRole('button')).toBeFocused();
});

test('u_assoc on restricted RVB is refused in the dialog and via the API', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/projects/RVB/team');
  await expect(page.getByText('Restricted · U.S. persons only').first()).toBeVisible();
  await page.getByRole('button', { name: 'Assign person' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Person').click();
  await page.getByRole('option', { name: /^Sam Rivera.*\(non-U\.S\.\)/ }).click();
  await dialog.getByLabel('Project role').fill('Integration');
  const msg = 'Sam Rivera is not a U.S. person and cannot be assigned to restricted project RVB.';
  await expect(dialog.getByRole('status')).toHaveText(msg);
  await dialog.getByRole('button', { name: 'Assign' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(msg);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('row', { name: /Sam Rivera/ })).toHaveCount(0);

  const assign = await page.request.post('/api/projects/RVB/team', {
    data: { userId: 'u_assoc', projectRole: 'Integration', allocationPct: 50 },
  });
  expect(assign.status()).toBe(400);
  const item = await page.request.patch('/api/items/RVB-2', { data: { assigneeId: 'u_assoc' } });
  expect(item.status()).toBe(400);
  expect((await item.json()).error).toBe(msg);
  const flip = await page.request.patch('/api/projects/EHR/restricted', { data: { restricted: true } });
  expect(flip.status()).toBe(400);
  expect((await flip.json()).error).toContain('remove these non-U.S. people first: Sam Rivera');
});

test('u_assoc sees names and skills only on /people; clients get 403', async ({ page }) => {
  await asUser(page, 'u_assoc');
  await page.goto('/people');
  const people = page.getByRole('list', { name: 'People' });
  await expect(people.getByText('Tiara Mensah')).toBeVisible();
  await expect(people.getByText('Playwright')).toBeVisible();
  await expect(page.getByText(/U\.S\. person|Non-U\.S\./)).toHaveCount(0);
  await expect(page.getByText(/\$\d+/)).toHaveCount(0);
  await expect(page.getByText(/^\d+%$/)).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Allocation grid' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Table view' }).click();
  await expect(page.getByRole('columnheader', { name: 'U.S. person' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Cost rate' })).toHaveCount(0);
  const api = await page.request.get('/api/people/directory');
  const list = (await api.json()) as Record<string, unknown>[];
  expect(list.every((p) => Object.keys(p).sort().join() === 'id,name,skills')).toBe(true);
  expect((await page.request.get('/api/capacity/grid')).status()).toBe(403);

  await asUser(page, 'u_sponsor');
  expect((await page.request.get('/api/people/directory')).status()).toBe(403);
  expect((await page.request.get('/api/people/u_team')).status()).toBe(403);
});

test('lead edits skills in the profile drawer; the rate stays admin-only', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/people');
  await page.getByRole('button', { name: 'Open profile: Adeoba Cole' }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('U.S. person: Yes')).toBeVisible();
  await expect(drawer.getByText(/Cost rate/)).toHaveCount(0);
  await expect(drawer.getByLabel('Cost rate ($/hour, Admin only)')).toHaveCount(0);
  const skills = drawer.getByLabel('Skills');
  await skills.fill(`Kubernetes`);
  await skills.press('Enter');
  await drawer.getByRole('button', { name: 'Save profile' }).click();
  await expect(drawer.getByText('Saved.')).toBeVisible();
  const flag = await page.request.patch('/api/people/u_dev', { data: { usPerson: false } });
  expect(flag.status()).toBe(403);
});

for (const [name, path] of [
  ['/people', '/people'],
  ['the allocation grid', '/people/allocations'],
  ['the Team tab', '/projects/EHR/team'],
] as const) {
  test(`axe: no serious or critical issues on ${name}`, async ({ page }) => {
    await asUser(page, 'u_lead');
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);
  });
}
