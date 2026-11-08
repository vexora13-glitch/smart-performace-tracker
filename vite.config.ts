import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PORTAL_DEV_PORT lets a local test server run beside an ordinary `npm run dev` without either moving.
const port = Number(process.env.PORTAL_DEV_PORT) || undefined;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: port ? { port, strictPort: true } : undefined,
});
