import { defineConfig } from '@playwright/test';

// Smoke, accessibility and responsive checks against the production web build (dist/).
// Build first: npm run build:web. The server is `expo serve`, which mirrors production routing.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  webServer: { command: 'npx expo serve --port 4173', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
