import { MailError } from './security.mjs';
import { normaliseMessage } from './gmail.mjs';

// One bounded page per invocation. No timers, watchers or production cron are registered.
export async function syncMailboxPage({ repo, api, organisationId, connectionId }) {
  const row = await repo.connection(organisationId, connectionId);
  if (row.status !== 'connected') throw new MailError('mailbox_needs_reconnect', 409);
  const checkpoint = row.checkpoint || { mode: row.history_id ? 'incremental' : 'full' };
  let page;
  let ids = [];
  let deletedIds = [];
  let historyId;
  let nextCheckpoint;
  try {
    if (checkpoint.mode === 'batch') {
      ids = checkpoint.ids;
      deletedIds = checkpoint.deletedIds || [];
      historyId = checkpoint.historyId;
      nextCheckpoint = checkpoint.after;
    } else if (checkpoint.mode === 'full') {
      // Capture history before listing, then consume changes from that anchor next time.
      const anchor = checkpoint.anchorHistoryId || (await api.profile()).historyId;
      if (!/^\d+$/.test(anchor)) throw new MailError('invalid_history_cursor');
      page = await api.listMessages({ pageToken: checkpoint.nextPageToken });
      ids = (page.messages || []).map((m) => m.id);
      historyId = anchor;
      nextCheckpoint = page.nextPageToken
        ? { mode: 'full', anchorHistoryId: anchor, nextPageToken: page.nextPageToken }
        : null;
    } else {
      const baseline = checkpoint.startHistoryId || row.history_id;
      try {
        page = await api.history({ startHistoryId: baseline, pageToken: checkpoint.nextPageToken });
      } catch (e) {
        if (e.code !== 'gmail_not_found') throw e;
        await repo.commitPage(organisationId, connectionId, row.sync_version, {
          messages: [],
          deletedIds: [],
          checkpoint: { mode: 'full' },
          historyId: null,
          complete: false,
        });
        return { status: 'full_sync_required' };
      }
      const changed = new Set();
      const deleted = new Set();
      for (const item of page.history || []) {
        for (const m of item.messagesAdded || []) changed.add(m.message.id);
        for (const m of [...(item.labelsAdded || []), ...(item.labelsRemoved || [])])
          changed.add(m.message.id);
        for (const m of item.messagesDeleted || []) deleted.add(m.message.id);
      }
      ids = [...changed].filter((id) => !deleted.has(id));
      deletedIds = [...deleted];
      historyId = page.historyId;
      if (!/^\d+$/.test(historyId)) throw new MailError('invalid_history_cursor');
      nextCheckpoint = page.nextPageToken
        ? { mode: 'incremental', startHistoryId: baseline, nextPageToken: page.nextPageToken }
        : null;
    }
    // Persist oversized history pages as bounded batches before following the next page.
    ids = [...new Set(ids)];
    if (ids.length > 10000) throw new MailError('gmail_history_page_too_large', 503);
    if (ids.length > 100) {
      nextCheckpoint = {
        mode: 'batch',
        ids: ids.slice(100),
        deletedIds: [],
        historyId,
        after: nextCheckpoint,
      };
      ids = ids.slice(0, 100);
    }
    const messages = [];
    for (const id of new Set(ids)) {
      try {
        messages.push(normaliseMessage(await api.getMessage(id)));
      } catch (e) {
        if (e.code === 'gmail_not_found') deletedIds.push(id);
        else throw e;
      }
    }
    const complete = !nextCheckpoint;
    await repo.commitPage(organisationId, connectionId, row.sync_version, {
      messages,
      deletedIds,
      checkpoint: nextCheckpoint,
      historyId,
      complete,
    });
    return { status: complete ? 'idle' : 'syncing', processed: messages.length };
  } catch (e) {
    // Never replace the checkpoint on failures; retries replay the same page safely.
    if (e.code === 'gmail_reconnect_required')
      await repo.updateConnection(organisationId, connectionId, {
        status: 'needs_reconnect',
        sync_status: 'error',
        last_error_code: e.code,
      });
    else
      await repo.updateConnection(organisationId, connectionId, {
        sync_status: 'error',
        last_error_code: e instanceof MailError ? e.code : 'mail_sync_failed',
      });
    throw new MailError(e instanceof MailError ? e.code : 'mail_sync_failed', 503);
  }
}
