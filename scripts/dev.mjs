import './require-portal-checkout.mjs';
import { createServer, loadEnv } from 'vite';
import clients from '../api/clients.mjs';
import notifications from '../api/notifications.mjs';
import vexbot from '../api/vexbot.mjs';
import vexbotVoice from '../api/vexbot-voice.mjs';
import gmail from '../api/gmail/[action].mjs';

// Vexbot accepts a one-minute voice turn as base64 JSON; everything else keeps the small limit.
const BODY_LIMITS = { '/api/vexbot': 1_600_000, '/api/vexbot-voice': 70_000 };

// Keep server-only variables in the Node process. Vite exposes only VITE_* variables.
// `npm run dev` uses .env.local (hosted Portal). `npm run dev:localtest` uses .env.localtest.local (local
// Supabase on 127.0.0.1:56421) on port 5186 and refuses any non-loopback database.
const mode = process.argv.includes('--localtest') ? 'localtest' : process.env.PORTAL_DEV_MODE || 'development';
process.env.PORTAL_DEV_MODE = mode;
Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
if (mode === 'localtest') {
  process.env.PORTAL_DEV_PORT ||= '5186';
  for (const name of ['VITE_SUPABASE_URL', 'SUPABASE_URL']) {
    if (!['localhost', '127.0.0.1'].includes(new URL(process.env[name]).hostname))
      throw new Error(`Local testing requires a loopback database: ${name}.`);
  }
}
const server = await createServer({
  mode,
  plugins: [
    {
      name: 'portal-api',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          const pathname = req.url?.split('?')[0];
          const gmailAction = /^\/api\/gmail\/(connect|callback|status|disconnect)$/.exec(
            pathname || '',
          )?.[1];
          const handler =
            pathname === '/api/clients'
              ? clients
              : pathname === '/api/notifications'
                ? notifications
                : pathname === '/api/vexbot-voice' ? vexbotVoice : pathname === '/api/vexbot'
                  ? vexbot
                  : gmailAction
                    ? gmail
                    : null;
          if (!handler) return next();
          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (value) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(value));
            return res;
          };
          try {
            let body = '';
            for await (const chunk of req) {
              body += chunk;
              if (Buffer.byteLength(body) > (BODY_LIMITS[pathname] ?? 16384)) {
                res.status(413).json({ error: 'Request is too large.' });
                return;
              }
            }
            req.body = body ? JSON.parse(body) : {};
            if (gmailAction)
              req.query = {
                ...Object.fromEntries(new URL(req.url, 'http://localhost').searchParams),
                action: gmailAction,
              };
            await handler(req, res);
          } catch {
            res.status(400).json({ error: 'Invalid request body.' });
          }
        });
      },
    },
  ],
});
await server.listen();
server.printUrls();
