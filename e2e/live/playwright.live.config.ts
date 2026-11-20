import { defineConfig } from '@playwright/test';
// Live configuration: no web server of its own; targets LIVE_BASE_URL. One worker, files in order, so the run is
// deterministic. Traces and screenshots are off because they would record typed values (passwords, emails).
export default defineConfig({ testDir: '.', timeout: 180_000, expect: { timeout: 15_000 }, retries: 0, workers: 1, fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: '../../test-results/live-results.json' }]], use: { trace: 'off', screenshot: 'off', video: 'off', actionTimeout: 20_000, navigationTimeout: 30_000 } });
