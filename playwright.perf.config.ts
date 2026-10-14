import { defineConfig, devices } from '@playwright/test';

/**
 * KH-46 performance suite (tests/perf). Not part of `npm run test:e2e`: run it with
 * `npm run build && KH_PERF=1 npm run test:perf`. The server starts with KH_LOAD=1, which seeds the
 * 2×-scale dataset (120 projects, 20,000 items in project LOAD) into the in-memory store.
 */
const PORT = Number(process.env.PORT ?? 3190);

export default defineConfig({
  testDir: 'tests/perf',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/session`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { KH_LOAD: '1', ...(process.env.KH_LOAD_ITEMS ? { KH_LOAD_ITEMS: process.env.KH_LOAD_ITEMS } : {}) },
  },
});
