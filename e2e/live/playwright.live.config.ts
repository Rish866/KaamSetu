import { defineConfig } from '@playwright/test';
// Live configuration: no local web server; targets LIVE_BASE_URL. Traces are kept only on failure and contain no passwords
// (fills are recorded, so do not share traces publicly).
export default defineConfig({ testDir: '.', timeout: 120_000, retries: 0, reporter: [['list']], use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' } });
