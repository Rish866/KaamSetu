import { defineConfig } from '@playwright/test';
// Demo walkthrough: runs only against a LOCAL stack seeded by scripts/demo/seed-demo.mjs and saves screenshots of each
// step to test-results/demo (uploaded by CI as an artifact). Demo accounts use a local-only password.
export default defineConfig({ testDir: '.', timeout: 120_000, expect: { timeout: 15_000 }, retries: 0, workers: 1, fullyParallel: false,
  reporter: [['list']], use: { trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 20_000, navigationTimeout: 30_000, viewport: { width: 1280, height: 900 } } });
