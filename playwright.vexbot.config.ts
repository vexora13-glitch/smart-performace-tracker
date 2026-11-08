import { defineConfig, devices } from '@playwright/test';

// Vexbot checks in real Google Chrome against a LOCAL Supabase stack with synthetic data (see
// scripts/vexbot-local-seed.mjs). Not part of CI: it needs `supabase start` and .env.development.local.
const chrome = {
  channel: 'chrome',
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
};
export default defineConfig({
  testDir: './tests/vexbot-e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  globalSetup: './scripts/vexbot-local-seed.mjs',
  use: { baseURL: 'http://localhost:5173', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], ...chrome, viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'], ...chrome } },
  ],
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
