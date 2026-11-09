import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Keep an existing live deployment in place if Vercel Production is missing portal settings.
if (process.env.VERCEL_ENV === 'production') {
  const portalOrigin = 'https://ccxkaqbajugimmtsztif.supabase.co';
  const publicUrl = process.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, '');
  const serverUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/, '') || publicUrl;
  if (
    publicUrl !== portalOrigin ||
    serverUrl !== portalOrigin ||
    !process.env.VITE_SUPABASE_ANON_KEY?.trim() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  ) {
    throw new Error('Vercel Production needs the portal Supabase URL and both public and server credentials.');
  }
}

// PORTAL_DEV_PORT lets a local test server run beside an ordinary `npm run dev` without either moving.
const port = Number(process.env.PORTAL_DEV_PORT) || undefined;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: port ? { port, strictPort: true } : undefined,
});
