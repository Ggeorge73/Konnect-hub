import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Team Portal, Sprint 5: Admin console (ADM-01) and attachments (FILE-01). Uses its own Peachtree
 * project, field, template and invite (stamped), and restores the one seeded role it changes, so it
 * is independent of the other spec files that share the server.
 */
const STAMP = Date.now().toString(36).slice(-5).toUpperCase();
const KEY = `AD${STAMP}`;
const TEMPLATE = `E2E Retainer ${STAMP}`;
const CRITERION = `Kick-off pack signed ${STAMP}`;
const FIELD = `Contract line ${STAMP}`;
const INVITEE = `e2e.${STAMP.toLowerCase()}@peachtreeclinic.example`;

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

const seriousA11y = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
};

test.describe.configure({ mode: 'serial' });

test('admin changes a role and the audit log shows the permission change', async ({ page }) => {
  await asUser(page, 'u_admin');
  try {
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Client users' }).click();
    const row = page.getByTestId('user-vi@peachtreeclinic.example');
    await row.getByLabel('Role for Vi Tran').click();
    await page.getByRole('option', { name: 'Client Member' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'is now Client Member' })).toBeVisible();

    await page.goto('/admin/audit');
    await page.getByLabel('Action starts with').fill('permission.role');
    const entry = page.getByTestId('audit-row').filter({ hasText: 'u_cviewer' }).first();
    await expect(entry).toContainText('permission.role_change');
    await expect(entry).toContainText('Ada Okafor');
  } finally {
    await page.request.patch('/api/admin/users/u_cviewer', { data: { role: 'client_viewer' } });
  }
  // Only Admins reach the console.
  await asUser(page, 'u_lead');
  expect((await page.request.get('/api/admin/users')).status()).toBe(403);
  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/$/);
});

test('an invite with a role and an org lands in the dev outbox', async ({ page }) => {
  await asUser(page, 'u_admin');
  await page.goto('/admin/invites');
  await page.getByLabel('Emails').fill(INVITEE);
  await page.getByLabel('Organization').click();
  await page.getByRole('option', { name: 'Peachtree Clinic Group' }).click();
  await page.getByLabel('Role').click();
  await page.getByRole('option', { name: 'Client Sponsor' }).click();
  await page.getByRole('button', { name: 'Send invites' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invited 1 person to Peachtree' })).toBeVisible();
  await expect(page.getByTestId(`invite-${INVITEE}`)).toContainText('Client Sponsor');

  const mail = await (await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(INVITEE)}`)).json();
  expect(mail).toHaveLength(1);
  expect(mail[0].subject).toMatch(/invited/i);
  expect(mail[0].text).toContain('Client Sponsor');

  await page.getByRole('button', { name: `Re-send invite to ${INVITEE}` }).click();
  await expect(page.getByTestId(`invite-${INVITEE}`)).toContainText('2×');
  expect(
    await (await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(INVITEE)}`)).json(),
  ).toHaveLength(2);
});

test('a custom template made by the admin is used to create a project', async ({ page }) => {
  await asUser(page, 'u_admin');
  await page.goto('/admin/templates');
  await page.getByRole('button', { name: 'Create a template from Kanban Support Retainer' }).click();
  const dialog = page.getByRole('dialog', { name: /New template from/ });
  await dialog.getByLabel('Template name').fill(TEMPLATE);
  await dialog.getByLabel('1. Mobilize').fill(`${CRITERION}\nAcceptance criteria approved`);
  await dialog.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('heading', { name: TEMPLATE })).toBeVisible();

  await asUser(page, 'u_lead');
  await page.goto('/');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill(`Admin console ${STAMP}`);
  await page.getByLabel('Key (e.g. ACME)').fill(KEY);
  await page.getByLabel('Client').click();
  await page.getByRole('option', { name: 'Peachtree Clinic Group' }).click();
  await page.getByLabel('Template').click();
  await page.getByRole('option', { name: TEMPLATE }).click();
  await page.getByLabel('Target').fill('2027-06-30');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`));
  await expect(page.getByText(CRITERION)).toBeVisible();
});

test('a WIP limit set in the admin console shows on the board', async ({ page }) => {
  await asUser(page, 'u_lead');
  const project = await (await page.request.get(`/api/projects/${KEY}`)).json();
  for (const title of ['Build intake form', 'Build status page'])
    expect(
      (
        await page.request.post('/api/items', {
          data: { projectId: project.project.id, type: 'task', title, status: 'in_progress' },
        })
      ).ok(),
    ).toBe(true);

  await asUser(page, 'u_admin');
  await page.goto('/admin/workflows');
  await page.getByLabel('Project to configure').click();
  await page.getByRole('option', { name: new RegExp(`^${KEY} `) }).click();
  await page.getByLabel('Name for in_progress').fill('Building');
  await page.getByLabel('WIP limit for in_progress').fill('1');
  await expect(page.getByLabel('Name for accepted')).toBeDisabled();
  await page.getByRole('button', { name: 'Save workflow' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Workflow for ${KEY} saved` })).toBeVisible();

  await page.goto(`/projects/${KEY}/board`);
  const column = page.getByRole('region', { name: /Building column, 2 items, over WIP limit/ });
  await expect(column).toBeVisible();
  await expect(column.getByText('WIP exceeded')).toBeVisible();
  await expect(page.getByRole('region', { name: /Accepted column/ })).toBeVisible();
});

test('a custom field defined by the admin is edited on an item', async ({ page }) => {
  await asUser(page, 'u_admin');
  await page.goto('/admin/fields');
  await page.getByRole('button', { name: 'Add field' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add a custom field' });
  await dialog.getByLabel('Field name').fill(FIELD);
  await dialog.getByLabel('Type').click();
  await page.getByRole('option', { name: 'Number' }).click();
  await dialog.getByRole('button', { name: 'Add field' }).click();
  await expect(page.getByTestId(`cf-${FIELD}`)).toContainText('Number');

  await asUser(page, 'u_lead');
  await page.goto(`/projects/${KEY}/board?item=${KEY}-1`);
  const input = page.getByTestId(`field-${FIELD}`);
  await input.fill('12.50');
  await input.press('Enter');
  await expect
    .poll(async () => Object.values(await (await page.request.get(`/api/items/${KEY}-1/fields`)).json()))
    .toContain('12.5');
  await page.reload();
  await expect(page.getByTestId(`field-${FIELD}`)).toHaveValue('12.5');

  // The list view offers the field as a column.
  await page.goto(`/projects/${KEY}/list`);
  await page.getByRole('button', { name: 'Choose columns' }).click();
  await page.getByRole('menuitem', { name: FIELD }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('columnheader', { name: FIELD })).toBeVisible();
  await expect(page.getByTestId(`row-${KEY}-1`)).toContainText('12.5');
});

test('an internal attachment is invisible to the sponsor while a shared one downloads', async ({ page }) => {
  await asUser(page, 'u_lead');
  const project = await (await page.request.get(`/api/projects/${KEY}`)).json();
  const item = await (
    await page.request.post('/api/items', {
      data: {
        projectId: project.project.id,
        type: 'story',
        title: `Shared scope ${STAMP}`,
        visibility: 'shared',
      },
    })
  ).json();

  await page.goto(`/projects/${KEY}/board?item=${item.key}`);
  const upload = page.getByLabel('Attach file', { exact: true });
  await upload.setInputFiles({
    name: `internal-${STAMP}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from('internal only'),
  });
  await expect(page.getByTestId(`attachment-internal-${STAMP}.txt`)).toContainText('Internal');
  await page
    .getByRole('group', { name: 'New file visibility' })
    .getByRole('button', { name: 'Shared' })
    .click();
  await upload.setInputFiles({
    name: `shared-${STAMP}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% shared scope\n'),
  });
  await expect(page.getByTestId(`attachment-shared-${STAMP}.pdf`)).toBeVisible();
  // Executables are refused before upload.
  await upload.setInputFiles({
    name: 'run.exe',
    mimeType: 'application/x-msdownload',
    buffer: Buffer.from('MZ'),
  });
  await expect(page.getByRole('alert').filter({ hasText: 'not allowed' })).toBeVisible();

  const files = await (
    await page.request.get(`/api/attachments?entityType=work_item&entityId=${item.key}`)
  ).json();
  const internal = files.find((f: { fileName: string }) => f.fileName === `internal-${STAMP}.txt`);
  const shared = files.find((f: { fileName: string }) => f.fileName === `shared-${STAMP}.pdf`);

  await asUser(page, 'u_sponsor');
  await page.goto(`/portal/${KEY}?item=${item.key}`);
  await expect(page.getByTestId(`attachment-shared-${STAMP}.pdf`)).toBeVisible();
  await expect(page.getByText(`internal-${STAMP}.txt`)).toHaveCount(0);
  const listed = await (
    await page.request.get(`/api/attachments?entityType=work_item&entityId=${item.key}`)
  ).json();
  expect(listed.map((f: { fileName: string }) => f.fileName)).toEqual([`shared-${STAMP}.pdf`]);

  const ok = await page.request.get(`/api/attachments/${shared.id}/download`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()['content-disposition']).toContain(`shared-${STAMP}.pdf`);
  expect(await ok.text()).toContain('% shared scope');
  expect((await page.request.get(`/api/attachments/${internal.id}/download`)).status()).toBe(404);

  // Another client's sponsor gets nothing at all.
  await asUser(page, 'u_rsponsor');
  expect((await page.request.get(`/api/attachments/${shared.id}/download`)).status()).toBe(404);
});

test('no serious or critical a11y issues on the admin pages', async ({ page }) => {
  await asUser(page, 'u_admin');
  for (const path of [
    '/admin',
    '/admin/users',
    '/admin/invites',
    '/admin/clients',
    '/admin/templates',
    '/admin/workflows',
    '/admin/fields',
  ]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    expect(await seriousA11y(page), path).toEqual([]);
  }
});
