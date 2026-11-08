import { createServer, loadEnv } from 'vite';
import clients from '../api/clients.mjs';
import notifications from '../api/notifications.mjs';
import vexbot from '../api/vexbot.mjs';

// Vexbot accepts a one-minute voice turn as base64 JSON; everything else keeps the small limit.
const BODY_LIMITS = { '/api/vexbot': 1_600_000 };

// Keep server-only variables in the Node process. Vite exposes only VITE_* variables.
Object.assign(process.env, loadEnv('development', process.cwd(), ''));
const server = await createServer({
  plugins: [
    {
      name: 'portal-api',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          const pathname = req.url?.split('?')[0];
          const handler =
            pathname === '/api/clients'
              ? clients
              : pathname === '/api/notifications'
                ? notifications
                : pathname === '/api/vexbot'
                  ? vexbot
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
