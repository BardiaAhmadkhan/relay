import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  // mobile-v2.spec.ts (added 2026-11-17) drives the app against a real v2 service with the stub scorer.
  testMatch: ['**/mobile.spec.ts', '**/mobile-v2.spec.ts'],
  workers: 1,
  timeout: 90_000,
  reporter: [['list'], ['json', { outputFile: 'benchmarks/ui-results.json' }]],
  use: {
    baseURL: process.env.RELAY_UI_URL ?? 'http://localhost:8081',
    browserName: 'chromium',
    channel: 'chrome',
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
  outputDir: 'output/playwright/test-results',
});
