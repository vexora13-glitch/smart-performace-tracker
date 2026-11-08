import { MailError } from './security.mjs';
const result = (value) => {
  if (value.error) throw new MailError('mail_storage_failed', 503);
  return value.data;
};
export function mailRepository(db) {
  return {
    async access(actor, org, permission = 'read', issuedAt = Infinity) {
      const profile = result(
        await db
          .from('portal_profiles')
          .select('role,active,sessions_invalid_before')
          .eq('id', actor)
          .single(),
      );
      const member = result(
        await db
          .from('portal_mail_memberships')
          .select('permission')
          .eq('organisation_id', org)
          .eq('user_id', actor)
          .maybeSingle(),
      );
      const allowed =
        permission === 'manage'
          ? ['manager']
          : permission === 'respond'
            ? ['responder', 'manager']
            : ['reader', 'responder', 'manager'];
      if (
        profile?.role !== 'admin' ||
        !profile.active ||
        issuedAt <= profile.sessions_invalid_before ||
        !member ||
        !allowed.includes(member.permission)
      )
        throw new MailError('mail_access_denied', 403);
      return member;
    },
    async connection(org, id) {
      const row = result(
        await db
          .from('portal_mail_connections')
          .select('*')
          .eq('organisation_id', org)
          .eq('id', id)
          .maybeSingle(),
      );
      if (!row) throw new MailError('mail_connection_not_found', 404);
      return row;
    },
    async createConnection(row) {
      result(await db.from('portal_mail_connections').insert(row));
    },
    async updateConnection(org, id, changes) {
      result(
        await db
          .from('portal_mail_connections')
          .update(changes)
          .eq('organisation_id', org)
          .eq('id', id),
      );
    },
    async putIntent(intent) {
      result(await db.rpc('portal_mail_oauth_put', { intent }));
    },
    async consumeIntent(hash, binder) {
      const rows = result(await db.rpc('portal_mail_oauth_consume', { hash, binder }));
      if (rows?.length !== 1) throw new MailError('oauth_state_expired_or_replayed');
      return rows[0];
    },
    async getSecret(org, connection) {
      return result(await db.rpc('portal_mail_secret_get', { org, connection }));
    },
    async putSecret(org, connection, secret) {
      result(await db.rpc('portal_mail_secret_put', { org, connection, secret }));
    },
    async deleteSecret(org, connection) {
      result(await db.rpc('portal_mail_secret_delete', { org, connection }));
    },
    async claimSecret(org, connection, lease) {
      return result(await db.rpc('portal_mail_secret_claim', { org, connection, lease }));
    },
    async finishSecret(org, connection, lease, secret = null, erase = false) {
      return result(
        await db.rpc('portal_mail_secret_finish', { org, connection, lease, secret, erase }),
      );
    },
    async audit(org, actor, connection, event, details = {}) {
      result(
        await db.from('portal_mail_audit').insert({
          organisation_id: org,
          actor_id: actor,
          connection_id: connection,
          event,
          details,
        }),
      );
    },
    async commitPage(org, connection, version, page) {
      return result(
        await db.rpc('portal_mail_commit_page', {
          org,
          connection,
          expected_version: version,
          messages: page.messages,
          deleted_ids: page.deletedIds || [],
          next_checkpoint: page.checkpoint,
          next_history: page.historyId,
          complete: page.complete,
        }),
      );
    },
    async linkClient(org, actor, connection, thread, client) {
      await this.access(actor, org, 'manage');
      const scope = result(
        await db
          .from('portal_mail_client_scopes')
          .select('client_id')
          .eq('organisation_id', org)
          .eq('client_id', client)
          .maybeSingle(),
      );
      if (!scope) throw new MailError('client_outside_mail_organisation', 403);
      result(
        await db.from('portal_mail_client_links').upsert({
          organisation_id: org,
          connection_id: connection,
          provider_thread_id: thread,
          client_id: client,
          linked_by: actor,
          method: 'manual',
        }),
      );
      await this.audit(org, actor, connection, 'client_thread_linked', {
        client_id: client,
        thread_id: thread,
      });
    },
    async assign(org, actor, connection, thread, staff) {
      await this.access(actor, org, 'manage');
      await this.access(staff, org, 'respond');
      result(
        await db.from('portal_mail_assignments').upsert({
          organisation_id: org,
          connection_id: connection,
          provider_thread_id: thread,
          assigned_to: staff,
          assigned_by: actor,
          status: 'open',
          updated_at: new Date().toISOString(),
        }),
      );
      await this.audit(org, actor, connection, 'thread_assigned', {
        thread_id: thread,
        staff_id: staff,
      });
    },
    async publish(
      org,
      actor,
      { connectionId, threadId, messageId, clientId, title, bodyText, approved },
    ) {
      await this.access(actor, org, 'manage');
      if (approved !== true) throw new MailError('explicit_publication_approval_required');
      if (
        typeof title !== 'string' ||
        !title.trim() ||
        title.length > 160 ||
        typeof bodyText !== 'string' ||
        !bodyText.trim() ||
        bodyText.length > 100000
      )
        throw new MailError('invalid_publication');
      // DB composite FKs require an explicit client link and matching source thread/message.
      const row = result(
        await db
          .from('portal_mail_publications')
          .insert({
            organisation_id: org,
            connection_id: connectionId,
            provider_thread_id: threadId,
            provider_message_id: messageId,
            client_id: clientId,
            title: title.trim(),
            body_text: bodyText,
            approved_by: actor,
          })
          .select('id')
          .single(),
      );
      await this.audit(org, actor, connectionId, 'message_snapshot_published', {
        publication_id: row.id,
        client_id: clientId,
      });
      return row.id;
    },
    async revokePublication(org, actor, publicationId) {
      await this.access(actor, org, 'manage');
      const row = result(
        await db
          .from('portal_mail_publications')
          .update({ revoked_at: new Date().toISOString() })
          .eq('organisation_id', org)
          .eq('id', publicationId)
          .select('connection_id')
          .single(),
      );
      await this.audit(org, actor, row.connection_id, 'message_snapshot_revoked', {
        publication_id: publicationId,
      });
    },
  };
}
