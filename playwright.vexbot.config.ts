import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

// Vexbot checks in real Google Chrome against a LOCAL Supabase stack with synthetic data (see
// scripts/vexbot-local-seed.mjs). Not part of CI: it needs `supabase start` and local Supabase variables.
// VEXBOT_E2E_PORT runs the test server on its own port, so an ordinary `npm run dev` can keep running.
// The fake microphone plays a speech-like recording (written by the seed): a pause, about 1.6 seconds of
// "speech", then silence, on a loop, so hands-free voice mode can hear a question start and end.
const port = Number(process.env.VEXBOT_E2E_PORT) || 5173;
const chrome = {
  channel: 'chrome',
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${resolve('artifacts/vexbot-voice.wav')}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
};
export default defineConfig({
  testDir: './tests/vexbot-e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  globalSetup: './scripts/vexbot-local-seed.mjs',
  use: { baseURL: `http://localhost:${port}`, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], ...chrome, viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'], ...chrome } },
  ],
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${port}`,
    reuseExistingServer: port === 5173,
    env: port === 5173 ? {} : { PORTAL_DEV_PORT: String(port) },
  },
});
