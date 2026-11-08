import { authenticate, database } from '../../server/runtime.mjs';
import { id } from '../../server/validation.mjs';
import { gmailServices } from '../../server/mail/service.mjs';
import { gmailConfig } from '../../server/mail/config.mjs';
import { MailError } from '../../server/mail/security.mjs';

export function createGmailHandler({
  getDatabase = database,
  services = gmailServices,
  env = process.env,
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    let callback = false;
    try {
      // Disabled before configuration, database access, consent or provider requests.
      gmailConfig(env);
      const action = req.query?.action;
      callback = action === 'callback';
      if (callback)
        res.setHeader(
          'Set-Cookie',
          'portal_gmail_binding=; HttpOnly; Secure; SameSite=Lax; Path=/api/gmail; Max-Age=0',
        );
      if (!['connect', 'callback', 'status', 'disconnect'].includes(action))
        throw new MailError('unknown_mail_action', 404);
      if (req.method !== (callback || action === 'status' ? 'GET' : 'POST'))
        throw new MailError('method_not_allowed', 405);
      const db = getDatabase();
      const service = services(db, env);
      if (callback) {
        const binder = /(?:^|;\s*)portal_gmail_binding=([^;]+)/.exec(req.headers.cookie || '')?.[1];
        const result = await service.connections.callback({
          state: req.query.state,
          binder,
          code: req.query.code,
          error: req.query.error,
        });
        return res.status(200).json(result);
      }
      const { user } = await authenticate(req, db, true);
      const input = action === 'status' ? req.query : req.body || {};
      const org = id(input.organisationId);
      let issuedAt;
      try {
        issuedAt = JSON.parse(
          Buffer.from(req.headers.authorization.split(' ')[1].split('.')[1], 'base64url'),
        ).iat;
      } catch {
        throw new MailError('invalid_session', 401);
      }
      await service.repo.access(user.id, org, action === 'status' ? 'read' : 'manage', issuedAt);
      if (action === 'connect') {
        const result = await service.connections.begin(user.id, org, {
          connectionId: input.connectionId ? id(input.connectionId) : undefined,
          capabilities: input.capabilities || ['read'],
          issuedAt,
        });
        res.setHeader(
          'Set-Cookie',
          `portal_gmail_binding=${result.binder}; HttpOnly; Secure; SameSite=Lax; Path=/api/gmail; Max-Age=600`,
        );
        return res
          .status(200)
          .json({ authorizationUrl: result.url, connectionId: result.connectionId });
      }
      const connection = id(input.connectionId);
      if (action === 'disconnect')
        return res.status(200).json(await service.connections.disconnect(user.id, org, connection));
      const row = await service.repo.connection(org, connection);
      return res.status(200).json({
        id: row.id,
        mailbox: row.mailbox,
        status: row.status,
        syncStatus: row.sync_status,
        lastSyncedAt: row.last_synced_at,
        errorCode: row.last_error_code,
      });
    } catch (e) {
      return res
        .status(e instanceof MailError ? e.status : e.status || 500)
        .json({ error: e instanceof MailError ? e.code : 'mail_request_failed' });
    }
  };
}
export default createGmailHandler();
