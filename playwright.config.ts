import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  use: { baseURL: 'http://localhost:5188', browserName: 'chromium', screenshot: 'only-on-failure' },
  webServer: {
    // Fixtures intercept all service calls. A separate port prevents reusing a real-data dev server.
    command: 'node node_modules/vite/bin/vite.js --host localhost --port 5188 --strictPort',
    url: 'http://localhost:5188',
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: 'https://portal-fixture.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'fixture-public-key',
    },
  },
});
