import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Runs as the Delivery Lead on a project this spec creates, so it never collides with other specs.
const KEY = 'FLOW';
const SPRINT = `${KEY} Sprint 1`;

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  await request.post('/api/session', { data: { userId: 'u_lead' } });
  const existing = await request.get(`/api/projects/${KEY}`);
  if (existing.ok()) return; // reused dev server: project already there
  const res = await request.post('/api/projects', {
    data: {
      name: 'Flow Sprint Planning',
      key: KEY,
      clientOrgId: 'org_riverbend',
      leadId: 'u_lead',
      startDate: addDays(today(), -30),
      targetDate: addDays(today(), 150),
      methodology: 'scrum',
      contractType: 'fixed_fee',
      bac: 100000,
      description: 'E2E project for sprints and timeline.',
      templateId: 'kdf-hybrid',
    },
  });
  expect(res.ok()).toBeTruthy();
  const project = await res.json();
  for (const [title, estimate] of [
    ['Flow intake form', 3],
    ['Flow status emails', 2],
  ] as const) {
    const r = await request.post('/api/items', {
      data: { projectId: project.id, type: 'story', title, estimate },
    });
    expect(r.ok()).toBeTruthy();
  }
});

test('lead creates a sprint and drags an item into it with the keyboard', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto(`/projects/${KEY}/backlog`);
  await expect(page.getByRole('tab', { name: 'Backlog' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId(`backlog-row-${KEY}-1`)).toBeVisible();

  await page.getByRole('button', { name: 'Create sprint' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create sprint' });
  await expect(dialog.getByLabel('Sprint name')).toHaveValue(SPRINT);
  // End before start is rejected.
  const start = await dialog.getByLabel('Start date').inputValue();
  await dialog.getByLabel('End date').fill(addDays(start, -1));
  await expect(dialog.getByText('End date must be after the start date.').first()).toBeVisible();
  await dialog.getByLabel('End date').fill(addDays(start, 13));
  await dialog.getByLabel('Sprint goal').fill('Intake ready for pilot');
  await dialog.getByLabel('Capacity (hours)').fill('12');
  await dialog.getByRole('button', { name: 'Create sprint' }).click();
  await expect(dialog).toBeHidden();

  const sprintPanel = page.getByTestId(`panel-${SPRINT}`);
  await expect(sprintPanel).toBeVisible();
  await expect(sprintPanel.getByText('Drag work items here from the backlog.')).toBeVisible();

  const row = page.getByTestId(`backlog-row-${KEY}-1`);
  await row.focus();
  // Pause between keys like a person would; dnd-kit attaches its key listeners after pick-up.
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  await page.keyboard.press('PageUp');
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');

  await expect(sprintPanel.getByTestId(`backlog-row-${KEY}-1`)).toBeVisible();
  await expect(page.getByTestId('panel-Backlog').getByTestId(`backlog-row-${KEY}-1`)).toHaveCount(0);
  // 3 points × 6 h per point = 18 h against 12 h available: red, with a text label.
  await expect(sprintPanel.getByText('18 of 12 h · 150% · Overloaded')).toBeVisible();
});

test('lead starts the sprint, and a second sprint cannot start while one is active', async ({ page }) => {
  await asUser(page, 'u_lead');
  const bundle = await (await page.request.get(`/api/projects/${KEY}`)).json();
  const phaseId = bundle.phases.find((p: { status: string }) => p.status === 'active').id;
  const second = await page.request.post('/api/sprints', {
    data: {
      projectId: bundle.project.id,
      name: `${KEY} Sprint 2`,
      phaseId,
      startDate: addDays(today(), 20),
      endDate: addDays(today(), 33),
      capacityHours: 40,
    },
  });
  expect(second.ok()).toBeTruthy();

  await page.goto(`/projects/${KEY}/backlog`);
  const sprintPanel = page.getByTestId(`panel-${SPRINT}`);
  await sprintPanel.getByRole('button', { name: 'Start sprint' }).click();
  await expect(sprintPanel.getByText('Active', { exact: true })).toBeVisible();

  await page.getByTestId(`panel-${KEY} Sprint 2`).getByRole('button', { name: 'Start sprint' }).click();
  await expect(page.getByRole('alert').filter({ hasText: `${SPRINT} is still active` })).toBeVisible();
});

test('lead completes the sprint and moves unfinished work to the backlog', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto(`/projects/${KEY}/backlog`);
  await page.getByTestId(`panel-${SPRINT}`).getByRole('button', { name: 'Complete sprint' }).click();
  const dialog = page.getByRole('dialog', { name: `Complete ${SPRINT}` });
  await expect(dialog.getByRole('list', { name: 'Unfinished items' })).toContainText(`${KEY}-1`);
  await expect(dialog.getByLabel(`Next planned sprint: ${KEY} Sprint 2`)).toBeChecked();
  await dialog.getByLabel('Backlog').check();
  await dialog.getByRole('button', { name: 'Complete sprint' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByTestId(`panel-${SPRINT}`)).toHaveCount(0);
  await expect(page.getByTestId('panel-Backlog').getByTestId(`backlog-row-${KEY}-1`)).toBeVisible();

  const activity = await (await page.request.get(`/api/projects/${KEY}/activity`)).json();
  expect(activity.some((a: { action: string }) => a.action === 'sprint.completed')).toBe(true);
});

test('timeline shows 5 phase bands, gate diamonds and the today line; bars move with arrows', async ({
  page,
}) => {
  await asUser(page, 'u_lead');
  await page.goto(`/projects/${KEY}/timeline`);
  await expect(page.getByTestId('phase-band')).toHaveCount(5);
  await expect(page.getByTestId('gate-diamond')).toHaveCount(5);
  await expect(page.getByTestId('today-line')).toHaveCount(1);

  const bar = page.locator('[data-testid^="bar-sprint-"]').filter({ hasText: `${KEY} Sprint 2` });
  await expect(bar).toHaveAttribute('aria-label', new RegExp(`Sprint: ${KEY} Sprint 2, planned, .* to .*`));
  const before = await bar.getAttribute('data-start');
  await bar.focus();
  await page.keyboard.press('ArrowRight');
  await expect(bar).toHaveAttribute('data-start', addDays(before!, 1));
  // Persisted through the API.
  await page.reload();
  await expect(
    page.locator('[data-testid^="bar-sprint-"]').filter({ hasText: `${KEY} Sprint 2` }),
  ).toHaveAttribute('data-start', addDays(before!, 1));
});

for (const path of ['/projects/EHR/backlog', '/projects/EHR/timeline', `/projects/${KEY}/timeline`]) {
  test(`no serious a11y violations on ${path}`, async ({ page }) => {
    await asUser(page, 'u_lead');
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);
  });
}
