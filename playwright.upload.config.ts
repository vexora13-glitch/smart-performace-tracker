import { defineConfig } from '@playwright/test';

// Real uploads to the isolated loopback Supabase stack. No hosted/customer writes.
export default defineConfig({
  testDir: './tests/uploads',
  outputDir: './artifacts/playwright/uploads',
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 20_000 },
  // Binary request tracing substantially distorts a 200 MiB transport test.
  use: { baseURL: 'http://localhost:5187', browserName: 'chromium', actionTimeout: 30_000, screenshot: 'only-on-failure', trace: 'off' },
  webServer: {
    command: 'npm run dev:localtest',
    url: 'http://localhost:5187',
    reuseExistingServer: false,
    env: { PORTAL_DEV_PORT: '5187', VEXBOT_PROVIDER: 'mock', VEXBOT_SCANNER: 'mock' },
  },
});
