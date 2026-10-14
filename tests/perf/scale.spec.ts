import { expect, test, type Page } from '@playwright/test';

/**
 * KH-46 [PERF-01]: CLAUDE.md §4 performance targets at 2× scale, measured in a real browser
 * against `next start` with KH_LOAD=1 (see playwright.perf.config.ts and docs/performance.md).
 * Only runs with KH_PERF=1. KH_PERF_RECORD=1 records numbers without asserting (for baselines).
 */
test.skip(!process.env.KH_PERF, 'Performance suite: run with KH_PERF=1 npm run test:perf');
test.describe.configure({ mode: 'serial' });

const RECORD_ONLY = Boolean(process.env.KH_PERF_RECORD);
// Drag: 60 fps means a 16.7 ms median frame; p95 under 67 ms means no hitch longer than 4 frames
// (pickup and column changes re-render a column; headless Chromium on a shared CI box is noisy).
const BUDGET = {
  portfolio: 1500,
  board: 2000,
  panel: 300,
  search: 500,
  dragFrameMedian: 20,
  dragFrameP95: 67,
};
const results: Record<string, number> = {};

const asUser = async (page: Page, userId: string) => {
  const res = await page.request.post('/api/session', { data: { userId } });
  expect(res.ok()).toBeTruthy();
};
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];

function report(name: string, value: number, budget?: number) {
  results[name] = Math.round(value * 10) / 10;
  console.log(`[perf] ${name}: ${results[name]}${budget ? ` (budget ${budget})` : ''}`);
  if (budget !== undefined && !RECORD_ONLY) expect(value, `${name} within budget`).toBeLessThan(budget);
}

test.afterAll(() => console.log(`[perf] summary ${JSON.stringify(results)}`));

test('warm up the server (first compile of each route is not what users see)', async ({ page }) => {
  await asUser(page, 'u_lead');
  for (const path of ['/', '/projects/LOAD/board']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
});

test('portfolio with 120+ projects is interactive in under 1.5 s', async ({ page }) => {
  await asUser(page, 'u_lead');
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.goto('/');
    // Client-rendered after hydration + /api/projects, so "content visible" implies interactive.
    const t = await page.waitForFunction(
      () => document.querySelectorAll('a[href^="/projects/L"]').length >= 60 && performance.now(),
      undefined,
      { timeout: 30_000, polling: 'raf' },
    );
    samples.push((await t.jsonValue()) as number);
  }
  const projects = await page.locator('a[href^="/projects/L"]').count();
  console.log(`[perf] portfolio project links: ${projects}`);
  // Interactive check: toggling to the table view responds.
  await page.getByRole('button', { name: 'Table view' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  report('portfolio_ms', median(samples), BUDGET.portfolio);
});

test('board with 500+ cards renders in under 2 s and drags smoothly', async ({ page }) => {
  await asUser(page, 'u_lead');
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.goto('/projects/LOAD/board');
    const t = await page.waitForFunction(
      () => document.querySelectorAll('[data-testid^="card-LOAD-"]').length > 0 && performance.now(),
      undefined,
      { timeout: 60_000, polling: 'raf' },
    );
    samples.push((await t.jsonValue()) as number);
  }
  const loaded = await page.evaluate(() =>
    [...document.querySelectorAll('section[data-loaded]')]
      .map((s) => Number(s.getAttribute('data-loaded')))
      .reduce((a, b) => a + b, 0),
  );
  const dom = await page.locator('[data-testid^="card-LOAD-"]').count();
  report('board_ms', median(samples), BUDGET.board);
  report('board_cards_loaded', loaded);
  report('board_card_dom_nodes', dom);
  // What the board downloads now (one page) vs the whole project (what it fetched before KH-46).
  const kb = async (url: string) => (await (await page.request.get(url)).body()).length / 1024;
  report(
    'board_payload_kb',
    await kb('/api/projects/LOAD/board?type=story,task,bug,change_request,client_request'),
  );
  report('whole_project_items_kb', await kb('/api/items?projectId=p_load_big'));
  expect(loaded).toBeGreaterThanOrEqual(500);

  // Drag a Backlog card over the Ready column while sampling frame intervals.
  const card = page.locator('section[aria-label^="Backlog column"] [data-testid^="card-LOAD-"]').first();
  const target = page.locator('section[aria-label^="Ready column"]');
  const from = (await card.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean };
    w.__frames = [];
    w.__stop = false;
    let last = performance.now();
    const tick = (t: number) => {
      w.__frames.push(t - last);
      last = t;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(from.x + 40, from.y + 20);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++)
    await page.mouse.move(
      from.x + 40 + ((to.x + 60 - from.x - 40) * i) / 40,
      from.y + 20 + ((to.y + 80 - from.y - 20) * i) / 40,
    );
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __stop: boolean };
    w.__stop = true;
    return w.__frames.slice(2);
  });
  await page.mouse.up(); // the drop (a save + re-render) is not part of the drag itself
  report('drag_frame_median_ms', median(frames), BUDGET.dragFrameMedian);
  report('drag_frame_p95_ms', pct(frames, 0.95), BUDGET.dragFrameP95);

  // Lazy loading: scrolling a long column to its end fetches the next page of that column.
  const backlog = page.locator('section[aria-label^="Backlog column"]');
  await page.waitForLoadState('networkidle'); // the drop's save and refetch have settled
  const before = Number(await backlog.getAttribute('data-loaded'));
  await backlog.locator('[data-virtualized]').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect
    .poll(async () => Number(await backlog.getAttribute('data-loaded')), { timeout: 10_000 })
    .toBeGreaterThan(before);
  report('backlog_loaded_after_scroll', Number(await backlog.getAttribute('data-loaded')));
});

test('item side panel opens in under 300 ms after hover prefetch', async ({ page }) => {
  await asUser(page, 'u_lead');
  await page.goto('/projects/LOAD/board');
  const samples: number[] = [];
  for (let i = 0; i < 7; i++) {
    const card = page.locator('section[aria-label^="In Progress column"] [data-testid^="card-LOAD-"]').nth(i);
    await card.hover();
    await page.waitForLoadState('networkidle');
    // Time from the browser's click event (not Playwright's actionability checks) to the panel
    // showing the item's title.
    await page.evaluate(() =>
      document.addEventListener(
        'click',
        () => ((window as unknown as { __t0: number }).__t0 = performance.now()),
        { capture: true, once: true },
      ),
    );
    await card.click();
    const t1 = await page.waitForFunction(
      () => {
        const el = document.querySelector<HTMLInputElement>('input[aria-label="Title"]');
        return el && el.value ? performance.now() - (window as unknown as { __t0: number }).__t0 : 0;
      },
      undefined,
      { polling: 'raf' },
    );
    samples.push((await t1.jsonValue()) as number);
    await page.getByRole('button', { name: 'Close item panel' }).click();
  }
  report('panel_open_ms', median(samples), BUDGET.panel);
});

test('search answers in under 500 ms on the large dataset (memory store)', async ({ page }) => {
  await asUser(page, 'u_lead');
  const samples: number[] = [];
  for (const q of ['reconcile', 'billing export', 'LOAD-19999', 'vendor', 'cutover runbook', 'xyzzy']) {
    const t0 = Date.now();
    const res = await page.request.get(`/api/search?q=${encodeURIComponent(q)}`);
    expect(res.ok()).toBeTruthy();
    await res.json();
    samples.push(Date.now() - t0);
  }
  report('search_median_ms', median(samples));
  report('search_max_ms', Math.max(...samples), BUDGET.search);
});
