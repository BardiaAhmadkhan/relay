import { defineConfig } from '@playwright/test';
import path from 'node:path';
const run=process.env.RELAY_LIVE_RUN ?? 'verified-v2';
export default defineConfig({
  testDir: '../../tests',
  testMatch: 'round-03-live.spec.ts',
  workers: 1,
  timeout: 100000,
  reporter: [['list'], ['json', { outputFile: path.resolve('benchmarks/round-03/live-ui-'+run+'.json') }]],
  use: {
    baseURL: 'http://localhost:4173',
    browserName: 'chromium',
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    actionTimeout: 15000,
    trace: 'retain-on-failure',
  },
  outputDir: path.resolve('output/playwright/round-03/live-'+run+'-traces'),
});
