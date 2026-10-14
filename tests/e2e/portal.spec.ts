import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Team Portal: client portal polish (KH-33 / PRT-01) and onboarding (KH-40 / ONB-01).
 * Uses its own fresh Peachtree project so it is independent of other spec files.
 */
const STAMP = Date.now().toString(36).slice(-5).toUpperCase();
const KEY = `PT${STAMP}`;
const PROJECT = `Portal Polish ${STAMP}`;
const SPONSOR_EMAIL = 'grace@peachtreeclinic.example';

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

const badge = (n: number) => `Needs your approval: ${n} ${n === 1 ? 'item' : 'items'}`;

const seriousA11y = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
};

/** Lead creates a shared, submitted deliverable on the test project. */
async function submittedDeliverable(req: APIRequestContext, name: string, dueDate: string) {
  const project = await (await req.get(`/api/projects/${KEY}`)).json();
  const item = await (
    await req.post('/api/items', {
      data: {
        projectId: project.project.id,
        type: 'story',
        title: `${name} work`,
        status: 'done',
        visibility: 'shared',
      },
    })
  ).json();
  const d = await (
    await req.post(`/api/projects/${KEY}/deliverables`, {
      data: {
        name,
        ownerId: 'u_lead',
        dueDate,
        visibility: 'shared',
        itemIds: [item.id],
        criteria: ['Opens in the clinic EHR', 'Matches the signed template'],
      },
    })
  ).json();
  expect((await req.post(`/api/deliverables/${d.id}/submit`)).ok()).toBe(true);
  return d.id as string;
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await asUser(page, 'u_lead');
  const res = await page.request.post('/api/projects', {
    data: {
      name: PROJECT,
      key: KEY,
      clientOrgId: 'org_peachtree',
      leadId: 'u_lead',
      startDate: '2026-10-01',
      targetDate: '2027-03-31',
      methodology: 'hybrid',
      contractType: 'fixed_fee',
      bac: 1000,
      templateId: 'kdf-hybrid',
    },
  });
  expect(res.ok()).toBe(true);
  await page.close();
});

test('the sponsor sees the inbox count and accepts a deliverable from the inbox, on a phone', async ({
  page,
}) => {
  const NAME = `Inbox sign-off ${STAMP}`;
  await asUser(page, 'u_lead');
  const id = await submittedDeliverable(page.request, NAME, '2026-10-13');

  await page.setViewportSize({ width: 375, height: 800 });
  await asUser(page, 'u_sponsor');
  const before = (await (await page.request.get('/api/portal/inbox')).json()) as { id: string }[];
  expect(before.some((e) => e.id === id)).toBe(true);
  await page.goto('/portal');
  const n = before.length;
  await expect(page.getByRole('link', { name: badge(n) })).toBeVisible();
  const inbox = page.getByRole('region', { name: 'Needs your approval' });
  await expect(inbox.getByTestId('inbox-count')).toHaveText(`${n} waiting`);
  // Merged list sorted by due date: our deliverable (due 13 Oct) comes before later items.
  await expect(inbox.getByRole('link', { name: `Deliverable · ${NAME}` })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);

  await inbox.getByRole('button', { name: `Accept “${NAME}”` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Confirm it’s you', { exact: true })).toBeVisible();
  await dialog.getByLabel('Email').fill(SPONSOR_EMAIL);
  await dialog.getByRole('button', { name: 'Confirm and accept' }).click();
  await expect(dialog).toBeHidden();
  await expect(inbox.getByText(`Accepted “${NAME}” for ${PROJECT}.`)).toBeVisible();
  await expect(inbox.getByRole('link', { name: `Deliverable · ${NAME}` })).toHaveCount(0);
  await expect(page.getByRole('link', { name: badge(n - 1) })).toBeVisible();

  const list = await (await page.request.get(`/api/projects/${KEY}/deliverables`)).json();
  expect(list.find((d: { id: string }) => d.id === id).status).toBe('accepted');
});

test('a client member submits a request and the lead sees it on the board', async ({ page }) => {
  const TITLE = `Add a referral field ${STAMP}`;
  await asUser(page, 'u_cmember');
  await page.goto(`/portal/${KEY}`);
  await page.getByRole('button', { name: 'Submit a request' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Submit a request' });
  // Validation: a title is required.
  await dialog.getByRole('button', { name: 'Submit request' }).click();
  await expect(dialog.getByText('Give the request a short title')).toBeVisible();
  await dialog.getByLabel('Title').fill(TITLE);
  await dialog.getByLabel('Description').fill('Front desk needs the referring provider on intake.');
  await dialog.getByLabel('Priority').click();
  await page.getByRole('option', { name: 'High' }).click();
  await dialog.getByRole('button', { name: 'Submit request' }).click();
  const done = page.getByRole('dialog', { name: 'Request submitted' });
  await expect(done).toBeVisible();
  const key = (await done.getByText(new RegExp(`^${KEY}-\\d+$`)).textContent())!;
  await done.getByRole('button', { name: 'Done' }).click();

  await asUser(page, 'u_lead');
  const item = (await (await page.request.get(`/api/items/${key}`)).json()).item;
  expect(item).toMatchObject({
    type: 'client_request',
    visibility: 'shared',
    status: 'backlog',
    priority: 'high',
  });
  await page.goto(`/projects/${KEY}/board`);
  const card = page.getByTestId(`card-${key}`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(TITLE);
});

test('Riverbend sees zero Peachtree projects in every portal view, and Peachtree keys 404', async ({
  page,
}) => {
  await asUser(page, 'u_rsponsor');
  await page.goto('/portal');
  await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible();
  await expect(page.getByText('Riverbend Permit Portal').first()).toBeVisible();
  await expect(page.getByAltText('Riverbend County IT logo')).toBeVisible();
  const home = await page.locator('main').innerText();
  for (const leak of ['Peachtree', 'Clinic EHR', PROJECT, 'EHR-', `${KEY}-`])
    expect(home).not.toContain(leak);

  for (const path of [
    '/portal/EHR',
    '/portal/PSR',
    `/portal/${KEY}`,
    '/portal/EHR/dashboard',
    '/portal/EHR/reports/sr_ehr_1005',
    `/portal/${KEY}?item=EHR-9`,
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    expect(await page.locator('body').innerText()).not.toContain('Peachtree');
  }
  // Their own project page shows only Riverbend content.
  await page.goto('/portal/RVB');
  await expect(page.getByRole('heading', { name: 'Riverbend Permit Portal', level: 1 })).toBeVisible();
  expect(await page.locator('main').innerText()).not.toContain('Peachtree');
  await page.goto('/notifications');
  expect(await page.locator('main').innerText()).not.toContain('Peachtree');

  for (const url of [
    '/api/projects/EHR',
    '/api/projects/PSR',
    `/api/projects/${KEY}`,
    '/api/projects/EHR/gates',
    '/api/projects/EHR/deliverables',
    '/api/projects/EHR/dashboard',
    '/api/projects/EHR/activity',
    '/api/projects/EHR/timeline',
    '/api/items/EHR-1',
    '/api/items/EHR-9',
    '/api/items?projectId=p_ehr',
  ]) {
    const res = await page.request.get(url);
    expect(res.status(), url).toBe(404);
  }
  const write = await page.request.post('/api/items', {
    data: { projectId: 'p_ehr', type: 'client_request', title: 'Cross-org request' },
  });
  expect(write.status()).toBe(404);
  const projects = (await (await page.request.get('/api/projects')).json()) as { key: string }[];
  expect(projects.map((p) => p.key)).toEqual(['RVB']);
  const inbox = (await (await page.request.get('/api/portal/inbox')).json()) as { projectKey: string }[];
  expect(inbox.every((e) => e.projectKey === 'RVB')).toBe(true);
  const orgs = (await (await page.request.get('/api/orgs')).json()) as { name: string }[];
  expect(orgs.map((o) => o.name)).not.toContain('Peachtree Clinic Group');
});

test.describe('onboarding', () => {
  test.afterAll(async ({ browser }) => {
    // Leave the shared demo workspace onboarded even if the wizard test failed half way.
    const page = await browser.newPage();
    await asUser(page, 'u_admin');
    await page.request.post('/api/onboarding/complete');
    await page.close();
  });

  test('the admin runs the setup wizard end to end on a fresh workspace', async ({ page }) => {
    await asUser(page, 'u_admin');
    expect((await page.request.post('/api/onboarding/reset')).ok()).toBe(true);
    await asUser(page, 'u_lead');
    expect((await page.request.post('/api/onboarding/reset')).status()).toBe(403);
    await page.goto('/'); // leads are never redirected
    await expect(page).toHaveURL(/\/$/);

    await asUser(page, 'u_admin');
    await page.goto('/');
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();

    // 1. Workspace (validated)
    const name = page.getByLabel('Workspace name');
    await name.fill('K');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByText('Name needs at least 2 characters')).toBeVisible();
    await name.fill('Konnect Hub');
    await page.getByRole('button', { name: 'Save and continue' }).click();

    // 2. First client
    await expect(page.getByRole('heading', { name: 'Add your first client' })).toBeVisible();
    await page.getByLabel('Client name').fill(`Wizard Client ${STAMP}`);
    await page.getByRole('button', { name: 'Save and continue' }).click();

    // 3. First project from a template
    await expect(
      page.getByRole('heading', { name: `Create the first project for Wizard Client ${STAMP}` }),
    ).toBeVisible();
    await page.getByLabel('Project name').fill(`Wizard Project ${STAMP}`);
    await page.getByLabel('Key (e.g. ACME)').fill(`W${STAMP}`);
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByText('Target date required')).toBeVisible();
    await page.getByLabel('Target').fill('2027-06-30');
    await page.getByRole('button', { name: 'Create project' }).click();

    // 4. Invite the team
    await expect(page.getByRole('heading', { name: 'Invite your team' })).toBeVisible();
    await page
      .getByLabel('Email addresses')
      .fill(`new.${STAMP.toLowerCase()}@konnectortech.com, not-an-email`);
    await page.getByRole('button', { name: 'Send invites and finish' }).click();
    await expect(page.getByText('Not an email address: not-an-email')).toBeVisible();
    await page.getByLabel('Email addresses').fill(`new.${STAMP.toLowerCase()}@konnectortech.com`);
    await page.getByRole('button', { name: 'Send invites and finish' }).click();
    await expect(page.getByRole('heading', { name: 'Your workspace is ready' })).toBeVisible();
    await expect(page.getByText('1 invite is pending')).toBeVisible();

    const state = await (await page.request.get('/api/onboarding')).json();
    expect(state.workspace.onboardedAt).toBeTruthy();
    expect(state.clients.map((c: { name: string }) => c.name)).toContain(`Wizard Client ${STAMP}`);
    expect(state.invites.map((i: { email: string }) => i.email)).toContain(
      `new.${STAMP.toLowerCase()}@konnectortech.com`,
    );
    expect((await page.request.get(`/api/projects/W${STAMP}`)).ok()).toBe(true);

    await page.getByRole('link', { name: `Open W${STAMP} backlog` }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/W${STAMP}/backlog`));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();

    // /admin: re-run setup, and the demo-project delete asks for confirmation first.
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: 'Re-run setup' })).toHaveAttribute('href', '/onboarding');
    await page.getByRole('button', { name: 'Delete demo project' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete the demo project?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    expect((await page.request.get('/api/projects/EHR')).ok()).toBe(true);
  });
});

test.describe('accessibility in the light theme', () => {
  test('no serious a11y issues on the portal home and a portal project page', async ({ page }) => {
    await asUser(page, 'u_sponsor');
    for (const path of ['/portal', `/portal/${KEY}`, '/portal/EHR']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 250)');
      expect(await seriousA11y(page), path).toEqual([]);
    }
  });

  test('no serious a11y issues on the onboarding steps', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('kh_mode', 'light'));
    await asUser(page, 'u_admin');
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main')).toHaveCSS('color', 'rgb(15, 23, 42)');
    const check = async (heading: string) => {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      expect(await seriousA11y(page), heading).toEqual([]);
    };
    await check('Name your workspace');
    await page.getByLabel('Workspace name').fill('Konnect Hub');
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await check('Add your first client');
    await page.getByLabel('Client name').fill(`Axe Client ${STAMP}`);
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await check(`Create the first project for Axe Client ${STAMP}`);
    await page.getByLabel('Project name').fill(`Axe Project ${STAMP}`);
    await page.getByLabel('Key (e.g. ACME)').fill(`AX${STAMP}`);
    await page.getByLabel('Target').fill('2027-06-30');
    await page.getByRole('button', { name: 'Create project' }).click();
    await check('Invite your team');
    await page.getByRole('button', { name: 'Skip and finish' }).click();
    await check('Your workspace is ready');
  });
});
