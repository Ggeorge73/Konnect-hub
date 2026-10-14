import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * AI assist (KH-42..44) end to end with the deterministic fake client (CI has no API key).
 * Everything runs on a fresh project so other spec files are unaffected.
 */
test.describe.configure({ mode: 'serial' });

const STAMP = Date.now().toString(36).slice(-5).toUpperCase();
const KEY = `AI${STAMP}`;
const INTERNAL = `Internal margin note ${STAMP}`;
const today = () => new Date().toISOString().slice(0, 10);

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

const noSeriousA11y = async (page: Page, include: string) => {
  const results = await new AxeBuilder({ page })
    .include(include)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);
};

const createItem = async (page: Page, data: Record<string, unknown>) => {
  const res = await page.request.post('/api/items', { data: { projectId: KEY, type: 'task', ...data } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { id: string; key: string };
};

test('the lead enables AI on a fresh project; a team member cannot (403)', async ({ page }) => {
  await asUser(page, 'u_lead');
  const created = await page.request.post('/api/projects', {
    data: {
      name: `AI Assist ${STAMP}`,
      key: KEY,
      clientOrgId: 'org_peachtree',
      leadId: 'u_lead',
      startDate: today(),
      targetDate: '2027-06-30',
      methodology: 'hybrid',
      contractType: 'fixed_fee',
      bac: 120000,
      description: '',
      templateId: 'kdf-hybrid',
    },
  });
  expect(created.ok()).toBeTruthy();
  const staffed = await page.request.post(`/api/projects/${KEY}/team`, {
    data: { userId: 'u_team', projectRole: 'QA', allocationPct: 0 }, // 0%: leaves capacity specs alone
  });
  expect(staffed.ok()).toBeTruthy();

  // Off by default, with the explanation shown where AI would be used.
  await page.goto(`/projects/${KEY}/raid`);
  await expect(page.getByTestId('ai-off-notice')).toContainText('AI assist is off for this project');

  await page.goto(`/projects/${KEY}`);
  const toggle = page.getByLabel('AI assist is off');
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(page.getByLabel('AI assist is on')).toBeChecked();
  await expect(page.getByText(/Last changed by Lara Bennett/)).toBeVisible();
  await noSeriousA11y(page, '[aria-labelledby="ai-settings-heading"]');

  await asUser(page, 'u_team');
  const denied = await page.request.patch(`/api/ai/projects/${KEY}`, { data: { enabled: false } });
  expect(denied.status()).toBe(403);
  const st = await (await page.request.get(`/api/ai/projects/${KEY}`)).json();
  expect(st).toMatchObject({ enabled: true, canToggle: false, provider: 'fake' });
  await page.goto(`/projects/${KEY}`);
  await expect(page.getByLabel('AI assist is on')).toBeDisabled();
});

test('"Draft with AI" fills a preview; nothing is saved until the lead accepts', async ({ page }) => {
  await asUser(page, 'u_lead');
  await createItem(page, { title: `Kick-off workshop ${STAMP}`, visibility: 'shared' });
  const gen = await page.request.post('/api/reports', { data: { projectKey: KEY } });
  expect(gen.ok()).toBeTruthy();
  const report = await gen.json();
  const original = report.sections.scope as string;

  await page.goto(`/reports/${report.id}`);
  await page.getByRole('button', { name: 'Draft with AI' }).click();
  const dialog = page.getByRole('dialog', { name: /AI draft of the status report/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'AI draft of the Scope section' })).toContainText(
    'Scope in brief:',
  );
  await noSeriousA11y(page, '[role="dialog"]');

  // Still the original text on the server.
  const before = await (await page.request.get(`/api/reports/${report.id}`)).json();
  expect(before.sections.scope).toBe(original);

  await dialog.getByRole('button', { name: 'Accept scope' }).click();
  await expect(dialog.getByText('Accepted', { exact: true })).toBeVisible();
  const mid = await (await page.request.get(`/api/reports/${report.id}`)).json();
  expect(mid.sections.scope).toContain('Scope in brief:');
  expect(mid.sections.schedule).toBe(report.sections.schedule);

  await dialog.getByRole('button', { name: 'Accept all' }).click();
  await expect(dialog.getByRole('button', { name: 'Accept all' })).toBeDisabled();
  const after = await (await page.request.get(`/api/reports/${report.id}`)).json();
  expect(after.sections.schedule).toContain('Schedule in brief:');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('report-section-scope')).toContainText('Scope in brief:');
});

test('suggested risks appear for a stalled item; accepting creates a linked RAID risk', async ({ page }) => {
  await asUser(page, 'u_lead');
  const stalled = await createItem(page, { title: `Interface engine config ${STAMP}` });
  expect(
    (await page.request.patch(`/api/items/${stalled.key}`, { data: { status: 'in_progress' } })).ok(),
  ).toBeTruthy();

  await page.goto(`/projects/${KEY}/raid`);
  const panel = page.getByRole('region', { name: 'Suggested risks' });
  // Nothing is stalled today; looking two weeks ahead the item will have sat for 14 days.
  await panel.getByRole('button', { name: 'Find risks' }).click();
  await expect(panel.getByTestId('no-risk-suggestions')).toBeVisible();
  await panel.getByRole('combobox', { name: 'Signals' }).click();
  await page.getByRole('option', { name: 'Looking 14 days ahead' }).click();
  await panel.getByRole('button', { name: 'Find risks' }).click();
  const suggestion = panel.getByTestId('risk-suggestion').filter({ hasText: stalled.key });
  await expect(suggestion).toHaveCount(1);
  await expect(suggestion).toContainText(`${stalled.key} stalled in In Progress`);
  await noSeriousA11y(page, '[aria-labelledby="suggested-risks-heading"]');

  await suggestion.getByRole('button', { name: /^Accept risk/ }).click();
  await expect(panel.getByText(/Accepted risks are in the register below/)).toBeVisible();

  const risks = await (await page.request.get(`/api/raid?item=${stalled.key}`)).json();
  expect(risks).toHaveLength(1);
  expect(risks[0]).toMatchObject({ kind: 'risk', visibility: 'internal', linkedItemIds: [stalled.id] });
  await expect(page.getByRole('cell', { name: risks[0].title }).first()).toBeVisible();

  // Decided signals are not suggested again.
  const again = await page.request.post(`/api/ai/projects/${KEY}/risk-suggestions`, {
    data: { lookaheadDays: 14 },
  });
  expect((await again.json()).suggestions).toEqual([]);
});

test('meeting notes produce 3 preview rows; creating 2 of them makes 2 items', async ({ page }) => {
  await asUser(page, 'u_lead');
  const before = (await (await page.request.get(`/api/items?projectId=${KEY}`)).json()).length;
  await page.goto(`/projects/${KEY}/board`);
  await page.getByRole('button', { name: 'Paste meeting notes' }).click();
  const dialog = page.getByRole('dialog', { name: /Meeting notes to work items/ });
  await dialog
    .getByRole('textbox', { name: 'Meeting notes' })
    .fill(
      [
        `Weekly sync ${STAMP}`,
        'Discussed the go-live checklist.',
        '- Lara to confirm the cutover window by Friday',
        '- Fix the login error on the scheduling screen ASAP',
        '- Tiara: draft the UAT scripts',
        'Next meeting Thursday.',
      ].join('\n'),
    );
  await dialog.getByRole('button', { name: 'Propose items' }).click();
  await expect(dialog.getByTestId('proposed-item')).toHaveCount(3);
  await expect(dialog.getByRole('textbox', { name: 'Title of item 2' })).toHaveValue(
    'Fix the login error on the scheduling screen ASAP',
  );
  await noSeriousA11y(page, '[role="dialog"]');
  // Still nothing created.
  expect((await (await page.request.get(`/api/items?projectId=${KEY}`)).json()).length).toBe(before);

  await dialog.getByRole('checkbox', { name: /^Create item 3/ }).uncheck();
  await dialog.getByRole('button', { name: 'Create 2 items' }).click();
  await expect(dialog.getByTestId('notes-created')).toContainText('Created 2 internal backlog items');

  const items = (await (await page.request.get(`/api/items?projectId=${KEY}`)).json()) as {
    title: string;
    visibility: string;
    assigneeId: string | null;
    type: string;
  }[];
  expect(items.length).toBe(before + 2);
  const made = items.filter((i) => /cutover window|login error/.test(i.title));
  expect(made).toHaveLength(2);
  expect(made.every((i) => i.visibility === 'internal')).toBe(true);
  expect(made.find((i) => /cutover/.test(i.title))?.assigneeId).toBe('u_lead');
  expect(made.find((i) => /login error/.test(i.title))?.type).toBe('bug');
});

test('a client’s thread summary never contains the text of an internal comment', async ({ page }) => {
  await asUser(page, 'u_lead');
  const item = await createItem(page, { title: `Clinic training plan ${STAMP}`, visibility: 'shared' });
  for (let i = 1; i <= 6; i++) {
    const res = await page.request.post(`/api/items/${item.key}/comments`, {
      data: { body: `Shared training update ${i}`, visibility: 'shared' },
    });
    expect(res.ok()).toBeTruthy();
  }
  expect(
    (
      await page.request.post(`/api/items/${item.key}/comments`, {
        data: { body: INTERNAL, visibility: 'internal' },
      })
    ).ok(),
  ).toBeTruthy();

  // Internal users get a summary of everything they can see.
  const internal = await (await page.request.post(`/api/ai/items/${item.key}/summary`)).json();
  expect(internal).toMatchObject({ scope: 'all', commentCount: 7 });
  expect(JSON.stringify(internal)).toContain(INTERNAL);

  for (const persona of ['u_sponsor', 'u_cviewer']) {
    await asUser(page, persona);
    const res = await page.request.post(`/api/ai/items/${item.key}/summary`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({ scope: 'shared', commentCount: 6 });
    expect(JSON.stringify(body)).not.toContain(INTERNAL);
    expect(JSON.stringify(body)).not.toContain('margin');
  }

  // In the portal's item panel.
  await page.goto(`/portal/${KEY}?item=${item.key}`);
  await page.getByRole('button', { name: 'Summarize thread' }).click();
  const summary = page.getByTestId('thread-summary');
  await expect(summary).toContainText('6 comments');
  await expect(summary).toContainText('Built from 6 shared comments');
  await expect(summary).not.toContainText(INTERNAL);
  await noSeriousA11y(page, '[data-testid="thread-summary"]');
});
