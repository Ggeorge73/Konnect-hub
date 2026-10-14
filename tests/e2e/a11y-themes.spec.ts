import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A11Y-01 (KH-52): the internal app passes WCAG 2.1 AA in the LIGHT theme too (the AA-safe light
 * palette now lives in lib/theme.ts), and the dark theme keeps passing. Zero serious or critical
 * axe issues on the main internal screens in both themes.
 */
const SCREENS: [string, string][] = [
  ['portfolio', '/'],
  ['board', '/projects/EHR/board'],
  ['list', '/projects/EHR/list'],
  ['backlog', '/projects/EHR/backlog'],
  ['timeline', '/projects/EHR/timeline'],
  ['RAID', '/projects/EHR/raid'],
  ['gates', '/projects/EHR/gates'],
  ['dashboard', '/projects/EHR/dashboard'],
  ['people', '/people'],
  ['timesheet', '/timesheet'],
];

async function seriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `${v.id}: ${v.nodes
          .slice(0, 5)
          .map((n) => `${n.target.join(' ')} ${n.any[0]?.message ?? ''}`)
          .join(' | ')}`,
    );
}

for (const mode of ['light', 'dark'] as const) {
  test.describe(`A11Y-01: main internal screens in the ${mode} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((m) => localStorage.setItem('kh_mode', m), mode);
      const res = await page.request.post('/api/session', { data: { userId: 'u_lead' } });
      expect(res.ok()).toBeTruthy();
    });

    for (const [name, path] of SCREENS)
      test(`${name} (${path}) has no serious or critical axe issues`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        // The light theme really is on (the dark body is a gradient, so only light has a flat colour).
        if (mode === 'light')
          await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(245, 247, 250)');
        expect(await seriousA11y(page), `${mode} ${path}`).toEqual([]);
      });
  });
}
