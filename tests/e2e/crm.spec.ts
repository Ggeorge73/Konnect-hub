import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Konnector CRM integration end to end against the mock CRM (lib/integration/mock-crm.ts,
 * POST /api/dev/mock-crm): handoff → project created; health sent; item published → viewed →
 * accepted / changes requested / declined; withdrawn; survey. Screenshots of "For your review" go
 * to test-results/crm/ (CRM_SCREENSHOTS=1) in both themes at desktop and phone widths.
 */
const STAMP = Date.now().toString(36).slice(-5).toUpperCase();
const PEACHTREE = 'org_peachtree';
const SPONSOR = 'grace@peachtreeclinic.example';
const shots = process.env.CRM_SCREENSHOTS === '1';

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

const crm = async (req: APIRequestContext, data: Record<string, unknown>) => {
  const res = await req.post('/api/dev/mock-crm', { data });
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  return body as { sent: Record<string, unknown>; body: Record<string, unknown> };
};

const received = async (req: APIRequestContext) =>
  (await (await req.get('/api/dev/mock-crm')).json()) as {
    event: string;
    payload: Record<string, unknown>;
  }[];

const seriousA11y = async (page: Page) => {
  // Measure the settled layout: web fonts change text widths (and what overlaps what).
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.html.slice(0, 120)} ${n.any[0]?.message ?? ''}`).join(' | ')}`,
    );
};

/** Publishes a fresh EHR item for Peachtree and returns its id. */
async function publish(req: APIRequestContext, over: Record<string, unknown> = {}) {
  const r = await crm(req, {
    action: 'publish',
    clientId: PEACHTREE,
    projectId: 'p_ehr',
    title: `CR ${STAMP} ${Math.random().toString(36).slice(2, 6)}`,
    ...over,
  });
  return (r.sent.item as { item_id: string; title: string }).item_id;
}

test('handoff from the CRM creates the client, the project and the invites', async ({ page }) => {
  const r = await crm(page.request, {
    action: 'handoff',
    name: `Harbor Rollout ${STAMP}`,
    account: `Harbor Health ${STAMP}`,
  });
  expect(r.body.project_url).toMatch(/\/projects\/[A-Z0-9]+$/);
  const key = String(r.body.project_url).split('/').pop()!;
  await asUser(page, 'u_lead');
  await page.goto(`/projects/${key}`);
  await expect(page.getByRole('heading', { name: `Harbor Rollout ${STAMP}` }).first()).toBeVisible();
  const card = page.getByTestId('crm-commercial');
  await expect(card).toContainText('HHP-2026-007');
  await expect(card).toContainText('Portal live at all three hospitals');
  // Invites went out (dev outbox) to the client contacts.
  const mails = await (await page.request.get('/api/dev/outbox?to=dana.reyes@harborhealth.example')).json();
  expect(mails.length).toBeGreaterThan(0);

  // Health is sent for linked projects (Admin "Send project health now").
  await asUser(page, 'u_admin');
  await page.goto('/admin/integrations');
  await expect(page.getByTestId('crm-mode')).toContainText('Mock CRM');
  await page.getByRole('button', { name: 'Send project health now' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Project health sent' })).toBeVisible();
  const events = await received(page.request);
  expect(
    events.some(
      (e) =>
        e.event === 'project.health_updated' &&
        e.payload.konnect_hub_project_id === r.body.konnect_hub_project_id,
    ),
  ).toBe(true);
  await expect(page.getByTestId('event-opportunity.won').first()).toBeVisible();
});

test('a payload with cost fields is rejected and shows as a failure', async ({ page }) => {
  const res = await page.request.post('/api/dev/mock-crm', {
    data: {
      action: 'raw',
      payload: {
        version: '1',
        event: 'client_item.published',
        idempotency_key: `bad_${STAMP}`,
        item: { item_id: `bad_${STAMP}`, margin: 0.4 },
      },
    },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).body.error).toMatch(/outside the contract/);
  await asUser(page, 'u_admin');
  await page.goto('/admin/integrations');
  await page.getByRole('button', { name: /Failures/ }).click();
  await expect(page.getByText(/outside the contract: \$\.item\.margin/).first()).toBeVisible();
});

test('published → viewed → accepted (re-auth, name, title) reaches the CRM', async ({ page }) => {
  const id = await publish(page.request);
  await asUser(page, 'u_sponsor');
  await page.goto('/portal');
  const section = page.getByTestId('for-your-review');
  await expect(section).toBeVisible();
  await expect(page.getByTestId('review-count')).toContainText('waiting');
  await section.getByTestId(`review-item-${id}`).getByRole('link').click();
  await expect(page.getByTestId('review-total')).toContainText('$17,200.00');
  await expect(page.getByRole('table', { name: 'Price lines' })).toContainText('Project management');
  await expect
    .poll(async () =>
      (await received(page.request)).some(
        (e) => e.event === 'client_item.viewed' && e.payload.item_id === id,
      ),
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Job title').fill('Chief Operating Officer');
  await dialog.getByLabel('Email').fill(SPONSOR);
  await dialog.getByRole('button', { name: /accept/i }).click();
  await expect(page.getByTestId('review-status')).toHaveText('Accepted');
  await expect(page.getByText(/Accepted by .*Chief Operating Officer/)).toBeVisible();
  const decided = (await received(page.request)).find(
    (e) => e.event === 'client_item.decided' && e.payload.item_id === id,
  );
  expect(decided?.payload).toMatchObject({
    decision: 'accepted',
    decided_by: { title: 'Chief Operating Officer', email: SPONSOR },
  });

  // The Lead hears about it.
  await asUser(page, 'u_lead');
  const notes = await (await page.request.get('/api/notifications')).json();
  expect(JSON.stringify(notes)).toContain('accepted');
});

test('request changes needs a note; decline works; members cannot decide', async ({ page }) => {
  const a = await publish(page.request);
  const b = await publish(page.request);
  await asUser(page, 'u_cmember');
  await page.goto(`/portal/review/${a}`);
  await expect(page.getByTestId('review-blocker')).toContainText('approvers');
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);

  await asUser(page, 'u_sponsor');
  await page.goto(`/portal/review/${a}`);
  await page.getByRole('button', { name: 'Request changes' }).click();
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByRole('dialog')).toContainText('what should change');
  await page.getByLabel('What should change?').fill('Split the interface work into two phases.');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByTestId('review-status')).toHaveText('Changes requested');

  await page.goto(`/portal/review/${b}`);
  await page.getByRole('button', { name: 'Decline' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Decline' }).click();
  await expect(page.getByTestId('review-status')).toHaveText('Declined');
  const got = (await received(page.request)).filter((e) => e.event === 'client_item.decided');
  expect(got.find((e) => e.payload.item_id === a)?.payload).toMatchObject({
    decision: 'changes_requested',
    note: 'Split the interface work into two phases.',
  });
  expect(got.find((e) => e.payload.item_id === b)?.payload.decision).toBe('declined');
});

test('a new version supersedes v1; a withdrawn item shows "withdrawn by Konnector"', async ({ page }) => {
  const lineage = `lin_${STAMP}`;
  const v1 = await publish(page.request, { id: `v1_${STAMP}`, lineage, version: 1 });
  await publish(page.request, { id: `v2_${STAMP}`, lineage, version: 2 });
  await asUser(page, 'u_sponsor');
  await page.goto('/portal/EHR#review');
  await expect(page.getByTestId(`review-item-v2_${STAMP}`)).toContainText('supersedes v1');
  await expect(page.getByTestId(`review-item-${v1}`)).toHaveCount(0);
  await page.goto(`/portal/review/${v1}`);
  await expect(page.getByText('A newer version replaces this one')).toBeVisible();

  await crm(page.request, { action: 'withdraw', itemId: `v2_${STAMP}`, version: 2 });
  await page.goto(`/portal/review/v2_${STAMP}`);
  await expect(page.getByTestId('withdrawn-banner')).toContainText('Withdrawn by Konnector');
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
});

test('surveys take a 0–10 score; signature items show Sign', async ({ page }) => {
  const s = await publish(page.request, { type: 'survey' });
  const sig = await publish(page.request, { requiresSignature: true });
  await asUser(page, 'u_cmember');
  await page.goto(`/portal/review/${s}`);
  await page.getByRole('button', { name: '9', exact: true }).click();
  await page.getByLabel('Anything to add? (optional)').fill('Great team');
  await page.getByRole('button', { name: 'Send my answer' }).click();
  await expect(page.getByText(/answered 9\/10/)).toBeVisible();
  const sub = (await received(page.request)).find(
    (e) => e.event === 'survey.submitted' && e.payload.item_id === s,
  );
  expect(sub?.payload).toMatchObject({ score: 9, comment: 'Great team' });

  await asUser(page, 'u_sponsor');
  await page.goto(`/portal/review/${sig}`);
  await expect(page.getByRole('link', { name: 'Sign' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toHaveCount(0);
});

test('another client never sees Peachtree items', async ({ page }) => {
  const id = await publish(page.request);
  await asUser(page, 'u_rsponsor');
  const res = await page.request.get(`/api/portal/review/${id}`);
  expect(res.status()).toBe(404);
  await page.goto('/portal');
  await expect(page.getByTestId(`review-item-${id}`)).toHaveCount(0);
});

for (const mode of ['light', 'dark'] as const)
  for (const [width, height, label] of [
    [1280, 900, 'desktop'],
    [390, 844, 'mobile'],
  ] as const)
    test(`"For your review" in the ${mode} theme on ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.addInitScript((m) => {
        localStorage.setItem('kh_portal_mode', m);
      }, mode);
      const id = await publish(page.request, { title: 'Change request CR-12: lab interface' });
      await asUser(page, 'u_sponsor');
      await page.goto('/portal#review');
      await expect(page.getByTestId('for-your-review')).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await seriousA11y(page), `${mode} ${label} portal`).toEqual([]);
      if (shots)
        await page
          .getByTestId('for-your-review')
          .screenshot({ path: `test-results/crm/review-list-${mode}-${label}.png` });
      await page.goto(`/portal/review/${id}`);
      await expect(page.getByTestId('review-total')).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await seriousA11y(page), `${mode} ${label} item`).toEqual([]);
      if (shots)
        await page.screenshot({ path: `test-results/crm/review-item-${mode}-${label}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Accept', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.locator('.MuiDialog-container')).toHaveCSS('opacity', '1');
      if (shots) await page.screenshot({ path: `test-results/crm/review-accept-${mode}-${label}.png` });
    });
