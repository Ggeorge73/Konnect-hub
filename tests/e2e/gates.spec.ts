import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Gate review flow (GATE-01/02), deliverable acceptance (DLV-01) and the Acceptance Record (PDF-01).
 * Uses its own fresh Peachtree project so it is independent of other spec files.
 */
const KEY = `G${Date.now().toString(36).slice(-6).toUpperCase()}`;
const SPONSOR_EMAIL = 'grace@peachtreeclinic.example';

type Gates = {
  phases: { id: string; gate: number; status: string }[];
  criteria: { id: string; phaseId: string; done: boolean }[];
  reviews: { id: string; phaseId: string; status: string; decision?: string }[];
};

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};
const gates = async (req: APIRequestContext): Promise<Gates> =>
  (await req.get(`/api/projects/${KEY}/gates`)).json();

/** Lead ticks every criterion of a gate and requests review; sponsor re-auths and approves (API). */
async function passGateViaApi(page: Page, gate: number) {
  await asUser(page, 'u_lead');
  const g = await gates(page.request);
  const phase = g.phases.find((p) => p.gate === gate)!;
  for (const c of g.criteria.filter((x) => x.phaseId === phase.id))
    expect(
      (
        await page.request.patch(`/api/projects/${KEY}/gates/criteria/${c.id}`, { data: { done: true } })
      ).ok(),
    ).toBe(true);
  const review = await page.request.post(`/api/projects/${KEY}/gates/request`, {
    data: { phaseId: phase.id },
  });
  expect(review.ok()).toBe(true);
  const { id } = await review.json();
  await asUser(page, 'u_sponsor');
  expect((await page.request.post('/api/reauth', { data: { email: SPONSOR_EMAIL } })).ok()).toBe(true);
  const decided = await page.request.post(`/api/gates/reviews/${id}/decide`, {
    data: { decision: 'approved' },
  });
  expect(decided.ok()).toBe(true);
}

test.describe.configure({ mode: 'serial' });

test('lead ticks all Execute criteria on a fresh project and requests a gate review', async ({ page }) => {
  await asUser(page, 'u_lead');
  const created = await page.request.post('/api/projects', {
    data: {
      name: 'Gate Flow Rollout',
      key: KEY,
      clientOrgId: 'org_peachtree',
      leadId: 'u_lead',
      startDate: '2026-10-01',
      targetDate: '2027-03-31',
      methodology: 'hybrid',
      contractType: 'fixed_fee',
      bac: 150000,
      description: '',
      templateId: 'kdf-hybrid',
    },
  });
  expect(created.ok()).toBe(true);
  await passGateViaApi(page, 1);
  await passGateViaApi(page, 2);

  await asUser(page, 'u_lead');
  await page.goto(`/projects/${KEY}/gates`);
  const execute = page.getByRole('region', { name: 'Gate 3 · Execute' });
  await expect(execute.getByText('Active', { exact: true })).toBeVisible();
  // Add a criterion, then tick everything in Execute.
  await execute.getByLabel('New exit criterion for Execute').fill('Increment 1 demo signed off');
  await execute.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(execute.getByRole('checkbox', { name: 'Increment 1 demo signed off' })).toBeVisible();
  const boxes = execute.getByRole('checkbox');
  await expect(boxes).toHaveCount(2);
  for (const name of ['Each increment demonstrated and accepted', 'Increment 1 demo signed off']) {
    await execute.getByRole('checkbox', { name }).check();
    await expect(execute.getByRole('checkbox', { name })).toBeChecked();
  }
  await expect(execute.getByText(/Done by Lara Bennett/)).toHaveCount(2);

  await execute.getByRole('button', { name: 'Mark ready for gate review' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('All 2 exit criteria are complete.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Request gate review' }).click();
  await expect(dialog).toBeHidden();
  await expect(execute.getByText('Ready for gate review', { exact: true })).toBeVisible();
  await expect(execute.getByText('Gate pack')).toBeVisible();
  // The tracker strip stays in sync.
  await expect(page.getByRole('list', { name: 'Delivery gates' })).toContainText(
    'Execute — Ready for gate review',
  );
});

test('sponsor approves from the portal card in two clicks, passing re-auth', async ({ page }) => {
  await asUser(page, 'u_sponsor');
  await page.goto('/portal');
  const card = page.getByRole('region', { name: /Gate reviews awaiting your decision/ });
  const review = card.getByTestId(`gate-review-${KEY}`);
  await expect(review).toContainText('Gate 3 · Execute');
  await expect(review).not.toContainText('BAC'); // budget is internal unless shared
  await review.getByRole('button', { name: /^Approve Gate 3/ }).click(); // click 1
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Confirm it’s you', { exact: true })).toBeVisible();
  await dialog.getByLabel('Email').fill(SPONSOR_EMAIL);
  await dialog.getByRole('button', { name: 'Confirm and approve' }).click(); // click 2
  await expect(dialog).toBeHidden();
  await expect(card.getByText(/Decision recorded for Gate Flow Rollout/)).toBeVisible();
  await expect(card.getByTestId(`gate-review-${KEY}`)).toHaveCount(0);
});

test('the next phase is active and the decision is recorded', async ({ page }) => {
  await asUser(page, 'u_lead');
  const g = await gates(page.request);
  expect(g.phases.map((p) => p.status)).toEqual([
    'approved',
    'approved',
    'approved',
    'active',
    'not_started',
  ]);
  const execute = g.phases.find((p) => p.gate === 3)!;
  expect(g.reviews.find((r) => r.phaseId === execute.id)).toMatchObject({
    status: 'decided',
    decision: 'approved',
  });
  await page.goto(`/projects/${KEY}/gates`);
  await expect(
    page.getByRole('region', { name: 'Gate 4 · Accept' }).getByText('Active', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Gate 3 · Execute' }).getByText(/Grace Whitfield/),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Delivery gates' })).toContainText('Accept — Active');
});

test('a client member cannot approve: no button, and the API returns 403', async ({ page }) => {
  // The Lead requests the Accept gate with an override note, so a review is pending.
  await asUser(page, 'u_lead');
  const accept = (await gates(page.request)).phases.find((p) => p.gate === 4)!;
  const blocked = await page.request.post(`/api/projects/${KEY}/gates/request`, {
    data: { phaseId: accept.id },
  });
  expect(blocked.status()).toBe(400);
  const req = await page.request.post(`/api/projects/${KEY}/gates/request`, {
    data: { phaseId: accept.id, overrideNote: 'UAT sign-off scheduled for Monday' },
  });
  expect(req.ok()).toBe(true);
  const { id } = await req.json();

  await asUser(page, 'u_cmember');
  await page.goto('/portal');
  await expect(page.getByText('Gate reviews awaiting your decision')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
  await page.goto(`/portal/${KEY}`);
  await expect(page.getByText('Gate 4 · Accept — ready for your review')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
  await expect(page.getByText('Your Client Sponsor approves or rejects this gate.')).toBeVisible();
  // Even with a fresh re-auth the member is forbidden.
  expect(
    (await page.request.post('/api/reauth', { data: { email: 'mo@peachtreeclinic.example' } })).ok(),
  ).toBe(true);
  const res = await page.request.post(`/api/gates/reviews/${id}/decide`, { data: { decision: 'approved' } });
  expect(res.status()).toBe(403);
  // The sponsor without a fresh re-auth gets 401 reauth_required.
  await asUser(page, 'u_sponsor');
  await page.context().clearCookies({ name: 'kh_reauth' });
  const stale = await page.request.post(`/api/gates/reviews/${id}/decide`, {
    data: { decision: 'approved' },
  });
  expect(stale.status()).toBe(401);
  expect((await stale.json()).error).toBe('reauth_required');
});

test('rejecting a deliverable criterion reopens the linked item', async ({ page }) => {
  await asUser(page, 'u_lead');
  const project = await (await page.request.get(`/api/projects/${KEY}`)).json();
  const item = await (
    await page.request.post('/api/items', {
      data: {
        projectId: project.project.id,
        type: 'story',
        title: 'Discharge summary export',
        status: 'done',
        visibility: 'shared',
      },
    })
  ).json();
  expect(item.status).toBe('done');

  // Internal user creates the deliverable in the UI and submits it.
  await page.goto(`/projects/${KEY}/deliverables`);
  await page.getByRole('button', { name: 'New deliverable' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Deliverable name').fill('Discharge export sign-off');
  await dialog.getByLabel('Linked work items').fill(item.key);
  await page.getByRole('option', { name: new RegExp(`${item.key} Discharge summary export`) }).click();
  await dialog
    .getByLabel('Acceptance criteria')
    .fill('Export opens in the clinic EHR\nFields match the template');
  await dialog.getByRole('button', { name: 'Create deliverable' }).click();
  await expect(dialog).toBeHidden();
  const section = page.getByRole('region', { name: 'Discharge export sign-off' });
  await section.getByRole('button', { name: 'Submit for acceptance' }).click();
  await expect(section.getByText('Awaiting acceptance')).toBeVisible();

  // The client sees it in "Needs your approval" and rejects one criterion.
  await asUser(page, 'u_sponsor');
  await page.goto('/portal');
  await page.getByRole('link', { name: 'Deliverable · Discharge export sign-off' }).click();
  await expect(page).toHaveURL(new RegExp(`/portal/${KEY}`));
  const portalSection = page.getByRole('region', { name: 'Discharge export sign-off' });
  await portalSection.getByRole('button', { name: 'Reject: Fields match the template' }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByLabel('Note (optional)').fill('Allergy field is missing');
  // New browser context, so the sponsor confirms it's them again.
  await confirm.getByLabel('Email').fill(SPONSOR_EMAIL);
  await confirm.getByRole('button', { name: 'Confirm and reject' }).click();
  await expect(confirm).toBeHidden();
  await expect(portalSection.getByText('Rejected', { exact: true }).first()).toBeVisible();
  await expect(portalSection.getByTestId(`dlv-item-${item.key}`)).toContainText('In Progress');

  const after = await (await page.request.get(`/api/items/${item.key}`)).json();
  expect(after.item.status).toBe('in_progress');
  expect(after.activity.some((a: { action: string }) => a.action === 'item.reopened')).toBe(true);
});

test('acceptance record PDF: sponsor downloads it, members cannot', async ({ page }) => {
  await asUser(page, 'u_sponsor');
  const pdf = await page.request.get(`/api/projects/${KEY}/acceptance-record`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await asUser(page, 'u_cmember');
  expect((await page.request.get(`/api/projects/${KEY}/acceptance-record`)).status()).toBe(403);
  await asUser(page, 'u_lead');
  await page.goto(`/projects/${KEY}/gates`);
  await expect(page.getByRole('link', { name: 'Download Acceptance Record' })).toHaveAttribute(
    'href',
    `/api/projects/${KEY}/acceptance-record`,
  );
});

for (const path of ['/projects/EHR/gates', '/projects/EHR/deliverables']) {
  test(`no serious a11y violations on ${path}`, async ({ page }) => {
    await asUser(page, 'u_lead');
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);
  });
}
