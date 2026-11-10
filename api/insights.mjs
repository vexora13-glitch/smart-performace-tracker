import { timingSafeEqual } from 'node:crypto';
import {
  authenticate,
  check as checkDatabase,
  database,
  method,
  respondError,
} from '../server/runtime.mjs';
import { HttpError, id } from '../server/validation.mjs';
import { processSummaries, retainInsights } from '../server/insights.mjs';

const EVENTS = new Set([
  'login',
  'logout',
  'workspace_opened',
  'document_opened',
  'document_previewed',
  'document_downloaded',
  'video_opened',
  'chapter_selected',
  'file_uploaded',
]);
const pageSize = 40;
// A locally served UI can use a hosted database that has not received this feature's migration.
// Keep provider details private, but distinguish missing setup from a retryable request failure.
const missingSchemaCodes = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);
function check(result) {
  if (missingSchemaCodes.has(result.error?.code))
    throw new HttpError(
      503,
      'Client activity and VexBot conversation history need a database update. Contact your portal administrator.',
    );
  return checkDatabase(result);
}
export const config = { maxDuration: 300 };
const offsetOf = (input) =>
  Math.min(1000000, Math.max(0, Number.isInteger(input.offset) ? input.offset : 0));
function tokenClaims(req) {
  try {
    return JSON.parse(
      Buffer.from(req.headers.authorization.split(' ')[1].split('.')[1], 'base64url'),
    );
  } catch {
    return {};
  }
}
export function createInsightsHandler(getDatabase = database) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      method(req, ['GET', 'POST']);
      const db = getDatabase();
      if (req.method === 'GET') {
        const actual = Buffer.from(req.headers.authorization || '');
        const expected = Buffer.from(`Bearer ${process.env.CRON_SECRET || ''}`);
        if (
          !process.env.CRON_SECRET ||
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        )
          throw new HttpError(401, 'Access denied.');
        const result = await processSummaries(db);
        await retainInsights(db);
        return res.status(200).json(result);
      }
      const { user, profile } = await authenticate(req, db);
      const input = req.body || {},
        claims = tokenClaims(req);
      const admin = profile.role === 'admin';
      if (input.action === 'event') {
        if (admin) return res.status(200).json({ recorded: false });
        const workspace = id(input.workspace_id);
        const access = check(
          await db.rpc('vexbot_workspace_access', {
            person: user.id,
            issued_at: Number(claims.iat) || 0,
            workspace,
          }),
        );
        if (!access) throw new HttpError(403, 'Access denied.');
        if (!EVENTS.has(input.event)) throw new HttpError(400, 'Invalid activity type.');
        const eventId = id(input.event_id);
        let target = null,
          targetName = '',
          metadata = {};
        if (input.file_id) {
          const file = check(
            await db
              .from('portal_files')
              .select('id,name,mime_type')
              .eq('id', id(input.file_id))
              .eq('workspace_id', workspace)
              .maybeSingle(),
          );
          if (!file) throw new HttpError(404, 'File not found.');
          target = file.id;
          targetName = file.name;
          if (/proposal|statement.of.work|\bsow\b/i.test(file.name))
            metadata.document_category = /proposal/i.test(file.name)
              ? 'proposal'
              : 'statement_of_work';
          if (input.event === 'chapter_selected') {
            const set = check(
              await db
                .from('portal_video_chapter_sets')
                .select('chapters')
                .eq('file_id', file.id)
                .eq('state', 'published')
                .maybeSingle(),
            );
            const chapter = set?.chapters?.find((chapter) => chapter.id === input.chapter_id);
            if (!chapter) throw new HttpError(404, 'Chapter not found.');
            metadata = {
              ...metadata,
              chapter_id: chapter.id,
              chapter_title: chapter.title,
              start_seconds: chapter.start,
            };
          }
        } else if (/^(document_|video_|chapter_)/.test(input.event))
          throw new HttpError(400, 'Choose a file.');
        if (input.event === 'file_uploaded') {
          const upload = check(
            await db
              .from('vexbot_uploads')
              .select('id,name')
              .eq('id', id(input.upload_id))
              .eq('workspace_id', workspace)
              .eq('uploaded_by', user.id)
              .maybeSingle(),
          );
          if (!upload) throw new HttpError(404, 'Upload not found.');
          target = upload.id;
          targetName = upload.name;
        }
        const name = check(
          await db.from('portal_profiles').select('display_name').eq('id', user.id).single(),
        ).display_name;
        // Never persist arbitrary request metadata, URLs, tokens or message bodies.
        const session =
          typeof claims.session_id === 'string'
            ? claims.session_id
            : typeof input.session_id === 'string' &&
                /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                  input.session_id,
                )
              ? input.session_id
              : eventId;
        const dedup =
          input.event === 'login' && typeof claims.session_id === 'string'
            ? `${user.id}:login:${workspace}:${claims.session_id}`
            : `${user.id}:${eventId}`;
        check(
          await db.from('portal_activity_events').upsert(
            {
              workspace_id: workspace,
              actor_id: user.id,
              client_name: name,
              action: input.event,
              target_id: target,
              target_name: targetName,
              session_id: session,
              metadata,
              dedup_key: dedup,
            },
            { onConflict: 'dedup_key', ignoreDuplicates: true },
          ),
        );
        return res.status(200).json({ recorded: true });
      }
      if (!admin) throw new HttpError(403, 'Access denied.');
      const workspace = input.workspace_id ? id(input.workspace_id) : null;
      // Existing portal administrators have global workspace access, revalidated from server-owned profiles.
      if (
        workspace &&
        !check(await db.from('portal_clients').select('id').eq('id', workspace).maybeSingle())
      )
        throw new HttpError(404, 'Client not found.');
      const scoped = (query) => (workspace ? query.eq('workspace_id', workspace) : query);
      const offset = offsetOf(input);
      let result;
      switch (input.action) {
        case 'overview': {
          const [counts, events, notifications, own] = await Promise.all([
            db.rpc('portal_admin_insight_counts', { person: user.id }).then(check),
            db
              .from('portal_activity_events')
              .select('*')
              .order('created_at', { ascending: false })
              .order('id', { ascending: false })
              .limit(5)
              .then(check),
            db
              .from('portal_admin_notifications')
              .select('*,vexbot_conversations(kind)')
              .order('created_at', { ascending: false })
              .order('id', { ascending: false })
              .limit(5)
              .then(check),
            db.from('portal_profiles').select('timezone').eq('id', user.id).single().then(check),
          ]);
          result = { counts, events, notifications, timezone: own.timezone };
          break;
        }
        case 'activity': {
          let query = scoped(db.from('portal_activity_events').select('*'))
            .order('created_at', { ascending: false })
            .order('id', { ascending: false });
          if (input.type) query = query.eq('action', String(input.type).slice(0, 60));
          if (input.highlight) query = query.eq('id', id(input.highlight));
          if (input.from) query = query.gte('created_at', new Date(input.from).toISOString());
          if (input.to) query = query.lt('created_at', new Date(input.to).toISOString());
          result = { events: check(await query.range(offset, offset + pageSize - 1)) };
          break;
        }
        case 'conversations': {
          let query = scoped(
            db
              .from('vexbot_conversations')
              .select(
                'id,workspace_id,user_id,title,kind,status,created_at,ended_at,partial_transcript,summary_status,summary_preview,summary_completed_at,follow_up,revision,portal_profiles!vexbot_conversations_user_id_fkey!inner(role)',
              )
              .eq('portal_profiles.role', 'client'),
          )
            .order('created_at', { ascending: false })
            .order('id', { ascending: false });
          if (input.search)
            query = query.textSearch('search', String(input.search).slice(0, 160), {
              type: 'websearch',
              config: 'simple',
            });
          if (input.follow_up) query = query.eq('follow_up', 'required');
          const conversations = check(await query.range(offset, offset + pageSize - 1));
          const reads = conversations.length
            ? check(
                await db
                  .from('vexbot_admin_reads')
                  .select('conversation_id,revision,read_at')
                  .eq('admin_id', user.id)
                  .in(
                    'conversation_id',
                    conversations.map((c) => c.id),
                  ),
              )
            : [];
          result = {
            conversations: conversations.map((c) => ({
              ...c,
              unread: !reads.some(
                (r) =>
                  r.conversation_id === c.id &&
                  r.revision === c.revision &&
                  (!c.summary_completed_at ||
                    Date.parse(r.read_at) >= Date.parse(c.summary_completed_at)),
              ),
            })),
          };
          break;
        }
        case 'conversation': {
          if (!workspace) throw new HttpError(400, 'Choose a client.');
          const conversation = check(
            await db
              .from('vexbot_conversations')
              .select('*')
              .eq('id', id(input.conversation_id))
              .eq('workspace_id', workspace)
              .maybeSingle(),
          );
          if (!conversation) throw new HttpError(404, 'Conversation not found.');
          const messages = check(
            await db
              .from('vexbot_messages')
              .select(
                'id,role,content,medium,outcome,attachments,created_at,vexbot_citations(document_id,excerpt,vexbot_documents(title)),vexbot_file_citations(file_id,file_name,excerpt)',
              )
              .eq('conversation_id', conversation.id)
              .order('created_at')
              .order('id')
              .range(offset, offset + 99),
          );
          const author = check(
            await db
              .from('portal_profiles')
              .select('display_name')
              .eq('id', conversation.user_id)
              .maybeSingle(),
          );
          result = { conversation, messages, author: author?.display_name };
          break;
        }
        case 'conversation_read':
        case 'follow_up':
        case 'retry_summary': {
          const conversation = check(
            await scoped(
              db
                .from('vexbot_conversations')
                .select('id,revision,status,summary_status,summary_locked_until,summary_lease')
                .eq('id', id(input.conversation_id)),
            ).maybeSingle(),
          );
          if (!conversation) throw new HttpError(404, 'Conversation not found.');
          if (input.action === 'conversation_read') {
            if (input.unread)
              check(
                await db
                  .from('vexbot_admin_reads')
                  .delete()
                  .eq('conversation_id', conversation.id)
                  .eq('admin_id', user.id),
              );
            else
              check(
                await db.from('vexbot_admin_reads').upsert({
                  conversation_id: conversation.id,
                  admin_id: user.id,
                  revision: conversation.revision,
                  read_at: new Date().toISOString(),
                }),
              );
          } else if (input.action === 'follow_up') {
            if (!['none', 'required', 'resolved'].includes(input.status))
              throw new HttpError(400, 'Invalid follow-up status.');
            check(
              await db
                .from('vexbot_conversations')
                .update({ follow_up: input.status })
                .eq('id', conversation.id),
            );
          } else {
            if (
              conversation.status !== 'completed' ||
              conversation.summary_status === 'ready' ||
              (conversation.summary_locked_until &&
                Date.parse(conversation.summary_locked_until) > Date.now())
            )
              throw new HttpError(409, 'This conversation is not ready to retry.');
            let update = db
              .from('vexbot_conversations')
              .update({
                summary_status: 'pending',
                summary_attempts: 0,
                summary_available_at: new Date().toISOString(),
                summary_locked_until: null,
                summary_lease: null,
              })
              .eq('id', conversation.id)
              .eq('revision', conversation.revision)
              .eq('summary_status', conversation.summary_status);
            update = conversation.summary_lease
              ? update.eq('summary_lease', conversation.summary_lease)
              : update.is('summary_lease', null);
            if (!check(await update.select('id')).length)
              throw new HttpError(409, 'The summary changed. Refresh before retrying.');
          }
          result = { saved: true };
          break;
        }
        case 'notifications': {
          const notifications = check(
            await db
              .from('portal_admin_notifications')
              .select('*,vexbot_conversations(kind)')
              .order('created_at', { ascending: false })
              .order('id', { ascending: false })
              .range(offset, offset + pageSize - 1),
          );
          const reads = notifications.length
            ? check(
                await db
                  .from('portal_admin_notification_reads')
                  .select('notification_id')
                  .eq('admin_id', user.id)
                  .in(
                    'notification_id',
                    notifications.map((n) => n.id),
                  ),
              )
            : [];
          result = {
            notifications: notifications.map((n) => ({
              ...n,
              unread: !reads.some((r) => r.notification_id === n.id),
            })),
            counts: check(await db.rpc('portal_admin_insight_counts', { person: user.id })),
          };
          break;
        }
        case 'mark_all_read':
          check(await db.rpc('portal_mark_all_admin_notifications', { person: user.id }));
          result = { saved: true };
          break;
        case 'attention': {
          if (!['messages', 'summaries', 'follow_up'].includes(input.category))
            throw new HttpError(400, 'Choose an attention list.');
          result = {
            items: check(
              await db.rpc('portal_admin_attention', {
                person: user.id,
                category: input.category,
                page_offset: offset,
              }),
            ),
          };
          break;
        }
        case 'notification_read': {
          const notification = check(
            await db
              .from('portal_admin_notifications')
              .select('id')
              .eq('id', id(input.notification_id))
              .maybeSingle(),
          );
          if (!notification) throw new HttpError(404, 'Notification not found.');
          if (input.unread)
            check(
              await db
                .from('portal_admin_notification_reads')
                .delete()
                .eq('notification_id', notification.id)
                .eq('admin_id', user.id),
            );
          else
            check(
              await db
                .from('portal_admin_notification_reads')
                .upsert({ notification_id: notification.id, admin_id: user.id }),
            );
          result = { saved: true };
          break;
        }
        case 'preferences': {
          try {
            new Intl.DateTimeFormat('en-NZ', { timeZone: input.timezone }).format();
          } catch {
            throw new HttpError(400, 'Choose a valid IANA timezone.');
          }
          if (typeof input.timezone !== 'string' || input.timezone.length > 100)
            throw new HttpError(400, 'Choose a timezone.');
          check(
            await db.from('portal_profiles').update({ timezone: input.timezone }).eq('id', user.id),
          );
          result = { saved: true };
          break;
        }
        case 'rules':
          result = { rules: check(await db.from('portal_activity_rules').select('*')) };
          break;
        case 'rule': {
          if (!EVENTS.has(input.event) || typeof input.enabled !== 'boolean')
            throw new HttpError(400, 'Invalid activity rule.');
          check(
            await db
              .from('portal_activity_rules')
              .upsert({ action: input.event, enabled: input.enabled }),
          );
          result = { saved: true };
          break;
        }
        default:
          throw new HttpError(400, 'Unknown action.');
      }
      return res.status(200).json(result);
    } catch (error) {
      return respondError(res, error);
    }
  };
}
export default createInsightsHandler();
