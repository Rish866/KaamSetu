import { defineConfig } from '@playwright/test';
// Live configuration: no local web server; targets LIVE_BASE_URL. Traces are off because they would record typed values.
export default defineConfig({ testDir: '.', timeout: 120_000, retries: 0, reporter: [['list']], use: { trace: 'off', screenshot: 'off' } });
