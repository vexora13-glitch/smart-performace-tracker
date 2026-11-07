import { timingSafeEqual } from 'node:crypto';
import { authenticate, check, database, method, respondError } from '../server/runtime.mjs';
import { deliverNotifications } from '../server/notifications.mjs';
import { HttpError, id } from '../server/validation.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    method(req, ['GET', 'POST']);
    const db = database();
    let messageId = null;
    if (req.method === 'GET') {
      const actual = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ''}`);
      if (
        !process.env.CRON_SECRET ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new HttpError(401, 'Access denied.');
    } else {
      const { user, profile } = await authenticate(req, db);
      messageId = id(req.body?.messageId);
      const message = check(
        await db.from('portal_messages').select('author_id').eq('id', messageId).single(),
      );
      if (profile.role !== 'admin' && message.author_id !== user.id)
        throw new HttpError(403, 'Access denied.');
    }
    const result = await deliverNotifications(db, messageId);
    return res.status(result.failed ? 502 : 200).json(result);
  } catch (error) {
    return respondError(res, error);
  }
}
