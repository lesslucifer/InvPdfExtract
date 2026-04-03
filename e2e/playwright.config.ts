import { defineConfig } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 0,
  // E2E tests are run serially — each test launches its own Electron instance
  workers: 1,
  use: {
    // The built Electron app entry point (after `pnpm start` has compiled webpack)
    // Tests launch Electron directly via electronApp in fixtures.ts
  },
  projects: [
    {
      name: 'electron',
    },
  ],
  reporter: [['list'], ['html', { outputFolder: 'e2e-report', open: 'never' }]],
  // Compiled webpack output — run `pnpm start` (or `electron-forge start`) first
  // to ensure .webpack/main exists before running E2E tests
  outputDir: path.join(__dirname, '..', 'e2e-results'),
});
