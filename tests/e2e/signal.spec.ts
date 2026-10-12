import { expect, test, type Browser, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Team Signal: real-time board updates and presence (RT-01), notifications with email deep links
 * and preferences (NTF-01), and the calendar feed (ICS-01). Uses its own items and a fresh
 * Peachtree project so it is independent of other spec files.
 */
const STAMP = Date.now().toString(36).slice(-5).toUpperCase();
const KEY = `S${STAMP}`;
const SPONSOR_EMAIL = 'grace@peachtreeclinic.example';

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};

async function newPersona(browser: Browser, userId: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await asUser(page, userId);
  return { ctx, page };
}

let cardKey = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  const { ctx, page } = await newPersona(browser, 'u_lead');
  const res = await page.request.post('/api/items', {
    data: {
      projectId: 'EHR',
      type: 'task',
      title: `Signal live card ${STAMP}`,
      status: 'ready',
      visibility: 'shared',
    },
  });
  expect(res.ok()).toBe(true);
  cardKey = (await res.json()).key;
  await ctx.close();
});

test('a card the dev moves appears on the lead’s board within 3 seconds, without a reload', async ({
  browser,
}) => {
  const lead = await newPersona(browser, 'u_lead');
  const dev = await newPersona(browser, 'u_dev');
  // The lead's live connection (SSE) is open once its response headers arrive.
  const live = lead.page.waitForResponse((r) => r.url().includes('/api/realtime?projectId='));
  await lead.page.goto('/projects/EHR/board');
  await dev.page.goto('/projects/EHR/board');
  const leadReady = lead.page.getByRole('region', { name: /^Ready column/ });
  await expect(leadReady.getByTestId(`card-${cardKey}`)).toBeVisible();
  expect((await live).status()).toBe(200);
  let reloaded = false;
  lead.page.on('framenavigated', (f) => {
    if (f === lead.page.mainFrame()) reloaded = true;
  });

  // The dev moves the card Ready -> In Progress with the keyboard.
  const card = dev.page.getByTestId(`card-${cardKey}`);
  await card.focus();
  await dev.page.keyboard.press('Space');
  await dev.page.waitForTimeout(250);
  await dev.page.keyboard.press('ArrowRight');
  await dev.page.waitForTimeout(250);
  await dev.page.keyboard.press('Space');
  await expect(
    dev.page.getByRole('region', { name: /^In Progress column/ }).getByTestId(`card-${cardKey}`),
  ).toBeVisible();

  await expect(
    lead.page.getByRole('region', { name: /^In Progress column/ }).getByTestId(`card-${cardKey}`),
  ).toBeVisible({ timeout: 3_000 });
  expect(reloaded).toBe(false);
  await lead.ctx.close();
  await dev.ctx.close();
});

test('presence avatars show who else has the item open', async ({ browser }) => {
  const lead = await newPersona(browser, 'u_lead');
  const dev = await newPersona(browser, 'u_dev');
  await lead.page.goto(`/projects/EHR/board?item=${cardKey}`);
  await expect(lead.page.getByRole('button', { name: 'Close item panel' })).toBeVisible();
  await dev.page.goto(`/projects/EHR/board?item=${cardKey}`);
  await expect(dev.page.getByRole('group', { name: 'Also viewing: Lara Bennett' })).toBeVisible();
  await expect(lead.page.getByRole('group', { name: 'Also viewing: Adeoba Cole' })).toBeVisible({
    timeout: 5_000,
  });
  // The panel has a Watch toggle; the lead reported the card so already watches it.
  await expect(lead.page.getByRole('button', { name: 'Watching', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dev.page.getByRole('button', { name: 'Close item panel' }).click();
  await expect(lead.page.getByTestId('presence-avatars')).toHaveCount(0, { timeout: 5_000 });
  await lead.ctx.close();
  await dev.ctx.close();
});

test('mentioning @Tiara in a comment gives u_team an unread notification', async ({ page }) => {
  await asUser(page, 'u_dev');
  await page.goto(`/projects/EHR/board?item=${cardKey}`);
  const body = `@Tiara can you pair on ${cardKey}?`;
  await page.getByLabel('Comment', { exact: true }).fill(body);
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByText(body)).toBeVisible();

  await asUser(page, 'u_team');
  await page.goto('/notifications');
  const row = page.locator('li[data-unread]').filter({ hasText: `Adeoba mentioned you on ${cardKey}` });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Unread');
  await expect(page.getByRole('button', { name: /^Notifications, \d+ unread$/ })).toBeVisible();
  await row.getByRole('button').click();
  await expect(page).toHaveURL(new RegExp(`/projects/EHR/board\\?item=${cardKey}`));
  await page.goto('/notifications');
  await expect(
    page.locator('li:not([data-unread])').filter({ hasText: `Adeoba mentioned you on ${cardKey}` }),
  ).toBeVisible();
});

test('a gate approval email deep-links the sponsor to the approve dialog (≤ 3 clicks with re-auth)', async ({
  browser,
}) => {
  const lead = await newPersona(browser, 'u_lead');
  const created = await lead.page.request.post('/api/projects', {
    data: {
      name: `Signal Gate ${STAMP}`,
      key: KEY,
      clientOrgId: 'org_peachtree',
      leadId: 'u_lead',
      startDate: '2026-10-01',
      targetDate: '2027-04-30',
      methodology: 'hybrid',
      contractType: 'fixed_fee',
      bac: 90000,
      description: '',
      templateId: 'kdf-hybrid',
    },
  });
  expect(created.ok()).toBe(true);
  const g = await (await lead.page.request.get(`/api/projects/${KEY}/gates`)).json();
  const phase = g.phases.find((p: { gate: number }) => p.gate === 1);
  for (const c of g.criteria.filter((x: { phaseId: string }) => x.phaseId === phase.id))
    expect(
      (
        await lead.page.request.patch(`/api/projects/${KEY}/gates/criteria/${c.id}`, { data: { done: true } })
      ).ok(),
    ).toBe(true);
  const review = await lead.page.request.post(`/api/projects/${KEY}/gates/request`, {
    data: { phaseId: phase.id },
  });
  expect(review.ok()).toBe(true);
  const { id } = await review.json();

  const box = await (await lead.page.request.get(`/api/dev/outbox?to=${SPONSOR_EMAIL}`)).json();
  const mail = box.find((m: { subject: string }) => m.subject.includes(`Signal Gate ${STAMP}`));
  expect(mail).toBeTruthy();
  const href = mail.html.match(/href="([^"]*\/portal\?approve=[^"]+)"/)?.[1];
  expect(href).toBeTruthy();
  const link = new URL(href);
  expect(link.pathname + link.search).toBe(`/portal?approve=${id}`);

  // Sponsor, fresh browser (no re-auth yet): click 1 opens the link from the email.
  const sponsor = await newPersona(browser, 'u_sponsor');
  await sponsor.page.goto(link.pathname + link.search);
  const dialog = sponsor.page.getByRole('dialog');
  await expect(dialog.getByText(`Approve Gate 1 · Mobilize for Signal Gate ${STAMP}`)).toBeVisible();
  await expect(dialog.getByText('Confirm it’s you', { exact: true })).toBeVisible();
  await dialog.getByLabel('Email').fill(SPONSOR_EMAIL);
  await dialog.getByRole('button', { name: 'Confirm and approve' }).click(); // click 2
  await expect(dialog).toBeHidden();
  await expect(
    sponsor.page.getByText(new RegExp(`Decision recorded for Signal Gate ${STAMP}`)),
  ).toBeVisible();

  // The lead hears about the decision.
  const notes = await (await lead.page.request.get('/api/notifications')).json();
  expect(
    notes.some((n: { kind: string; title: string }) => n.kind === 'gate_decided' && n.title.includes(KEY)),
  ).toBe(true);
  await lead.ctx.close();
  await sponsor.ctx.close();
});

test('the calendar feed is valid iCalendar and a client token omits internal milestones', async ({
  page,
  playwright,
  baseURL,
}) => {
  await asUser(page, 'u_lead');
  const dl = await page.request.post(`/api/projects/${KEY}/deliverables`, {
    data: {
      name: `Internal runbook ${STAMP}`,
      ownerId: 'u_lead',
      dueDate: '2026-12-15',
      visibility: 'internal',
      itemIds: [],
      criteria: ['Reviewed'],
    },
  });
  expect(dl.ok()).toBe(true);
  const leadPath = (await (await page.request.get(`/api/projects/${KEY}/calendar`)).json()).path;
  await asUser(page, 'u_sponsor');
  const clientPath = (await (await page.request.get(`/api/projects/${KEY}/calendar`)).json()).path;

  // Calendar apps fetch without cookies: the token alone identifies the subscriber.
  const anon = await playwright.request.newContext({ baseURL });
  const leadFeed = await anon.get(leadPath);
  expect(leadFeed.status()).toBe(200);
  expect(leadFeed.headers()['content-type']).toContain('text/calendar');
  const leadIcs = await leadFeed.text();
  expect(leadIcs.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
  expect(leadIcs).toContain('BEGIN:VEVENT');
  expect(leadIcs).toContain(`Internal runbook ${STAMP}`);

  const clientFeed = await anon.get(clientPath);
  expect(clientFeed.headers()['content-type']).toContain('text/calendar');
  const clientIcs = await clientFeed.text();
  expect(clientIcs).toContain('BEGIN:VEVENT');
  expect(clientIcs).toContain('Target date');
  expect(clientIcs).not.toContain(`Internal runbook ${STAMP}`);
  expect(clientIcs).not.toContain('Sprint');

  // A tampered token or another project's token is a plain 404.
  expect((await anon.get(`${clientPath}x`)).status()).toBe(404);
  expect((await anon.get(clientPath.replace(KEY, 'EHR'))).status()).toBe(404);
  await anon.dispose();
});

test('Subscribe to calendar on the Overview gives the feed URL', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto(`/projects/${KEY}`);
  await page.getByRole('button', { name: 'Subscribe to calendar' }).click();
  const url = page.getByRole('dialog').getByLabel('Calendar feed URL');
  await expect(url).toHaveValue(new RegExp(`/api/projects/${KEY}/calendar\\.ics\\?token=`));
});

test('notification settings save per event type', async ({ page }) => {
  await asUser(page, 'u_dev');
  await page.goto('/settings/notifications');
  await page.getByRole('combobox', { name: 'Someone mentions you' }).click();
  await page.getByRole('option', { name: 'Daily digest' }).click();
  await expect(page.getByText('Notification settings saved')).toBeVisible();
  const prefs = await (await page.request.get('/api/notifications/preferences')).json();
  expect(prefs.mention).toBe('digest');
  // Reachable from the user menu.
  await page.goto('/notifications');
  await page.getByRole('button', { name: /Signed in as Adeoba Cole/ }).click();
  await page.getByRole('menuitem', { name: 'Notification settings' }).click();
  await expect(page).toHaveURL(/\/settings\/notifications$/);
});

for (const path of ['/notifications', '/settings/notifications']) {
  test(`no serious a11y violations on ${path}, and it fits a phone`, async ({ page }) => {
    await asUser(page, 'u_team');
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} — ${v.nodes[0]?.target}`)).toEqual([]);

    await page.setViewportSize({ width: 375, height: 740 });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('the client portal has the inbox too, on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await asUser(page, 'u_sponsor');
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await expect(
    page
      .locator('li')
      .filter({ hasText: `Signal Gate ${STAMP}` })
      .first(),
  ).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
