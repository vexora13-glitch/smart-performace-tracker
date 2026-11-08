import { OAuth2Client } from 'google-auth-library';
import { randomUUID, createHash } from 'node:crypto';
import { digest, MailError, oauthState, randomSecret, tokenCipher } from './security.mjs';
import { scopesFor } from './config.mjs';

export function googleOAuth(config) {
  const client = () =>
    new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      transporterOptions: { timeout: 15000, retry: false },
    });
  return {
    authorizationUrl(scopes, state, verifier) {
      return client().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: scopes,
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        include_granted_scopes: false,
      });
    },
    async exchange(code, verifier) {
      const c = client();
      const { tokens } = await c.getToken({
        code,
        codeVerifier: verifier,
        redirect_uri: config.redirectUri,
      });
      return tokens;
    },
    async refresh(refreshToken) {
      const c = client();
      c.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await c.refreshAccessToken();
      return credentials;
    },
    async revoke(token) {
      await client().revokeToken(token);
    },
  };
}
export function connectionService({
  repo,
  config,
  oauth = googleOAuth(config),
  profileForToken,
  now = () => Date.now(),
}) {
  const cipher = tokenCipher(config.keys, config.activeKeyId);
  const state = oauthState(config.stateKey, now);
  const context = (org, id) => `${org}:${id}:refresh`;
  return {
    async begin(actor, org, { connectionId, capabilities = ['read'], issuedAt }) {
      if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0)
        throw new MailError('invalid_session', 401);
      await repo.access(actor, org, 'manage', issuedAt);
      const scopes = scopesFor(capabilities);
      if (!capabilities.includes('read') && !capabilities.includes('manage'))
        throw new MailError('mailbox_connection_requires_read_capability');
      const id = connectionId || randomUUID();
      if (connectionId) {
        const previous = await repo.connection(org, id);
        if (previous.status === 'connected') throw new MailError('disconnect_before_reconnecting');
      } else
        await repo.createConnection({
          id,
          organisation_id: org,
          capabilities,
          status: 'disconnected',
        });
      const value = state.issue({ organisationId: org, connectionId: id, actorId: actor });
      const binder = randomSecret();
      const verifier = randomSecret();
      await repo.putIntent({
        state_hash: digest(value),
        binder_hash: digest(binder),
        organisation_id: org,
        connection_id: id,
        actor_id: actor,
        actor_iat: issuedAt,
        verifier_envelope: cipher.seal({ verifier, capabilities }, `${org}:${id}:oauth`),
        expires_at: new Date(now() + 600000).toISOString(),
      });
      await repo.updateConnection(org, id, {
        status: 'connecting',
        capabilities,
        last_error_code: null,
      });
      await repo.audit(org, actor, id, 'oauth_started');
      return { url: oauth.authorizationUrl(scopes, value, verifier), binder, connectionId: id };
    },
    async callback({ state: value, binder, code, error }) {
      const claims = state.verify(value);
      if (typeof binder !== 'string' || !binder || binder.length > 128)
        throw new MailError('oauth_binding_missing');
      const intent = await repo.consumeIntent(digest(value), digest(binder));
      if (
        intent.organisation_id !== claims.organisationId ||
        intent.connection_id !== claims.connectionId ||
        intent.actor_id !== claims.actorId
      )
        throw new MailError('oauth_binding_mismatch');
      const { organisation_id: org, connection_id: id, actor_id: actor } = intent;
      await repo.access(actor, org, 'manage', intent.actor_iat);
      let issuedTokens;
      try {
        if (error || typeof code !== 'string' || !code || code.length > 4096)
          throw new MailError('oauth_consent_not_completed');
        const { verifier, capabilities } = cipher.open(
          intent.verifier_envelope,
          `${org}:${id}:oauth`,
        );
        const tokens = await oauth.exchange(code, verifier);
        issuedTokens = tokens;
        const scopes = (tokens.scope || '').split(' ').filter(Boolean);
        if (
          !tokens.refresh_token ||
          !tokens.access_token ||
          scopesFor(capabilities).some((s) => !scopes.includes(s))
        )
          throw new MailError('oauth_offline_access_or_scope_missing');
        const profile = await profileForToken(tokens.access_token);
        if (profile.emailAddress?.toLowerCase() !== config.mailbox)
          throw new MailError('unexpected_mailbox');
        await repo.putSecret(
          org,
          id,
          cipher.seal({ refresh_token: tokens.refresh_token }, context(org, id)),
        );
        await repo.updateConnection(org, id, {
          mailbox: config.mailbox,
          status: 'connected',
          granted_scopes: scopes,
          credential_reference: id,
          checkpoint: null,
          history_id: null,
          last_error_code: null,
        });
        await repo.audit(org, actor, id, 'mailbox_connected');
        return { connectionId: id, status: 'connected' };
      } catch (e) {
        if (issuedTokens?.refresh_token) {
          try {
            await oauth.revoke(issuedTokens.refresh_token);
          } catch {
            /* Local credentials are still removed; reconnection remains required. */
          }
        }
        await repo.deleteSecret(org, id);
        await repo.updateConnection(org, id, {
          status: 'needs_reconnect',
          credential_reference: null,
          last_error_code: e instanceof MailError ? e.code : 'oauth_exchange_failed',
        });
        await repo.audit(org, actor, id, 'oauth_failed', {
          code: e instanceof MailError ? e.code : 'oauth_exchange_failed',
        });
        throw new MailError(e instanceof MailError ? e.code : 'oauth_exchange_failed', 400);
      }
    },
    async accessToken(org, id) {
      const connection = await repo.connection(org, id);
      if (connection.status !== 'connected') throw new MailError('mailbox_needs_reconnect', 409);
      const lease = randomUUID();
      const envelope = await repo.claimSecret(org, id, lease);
      if (!envelope) throw new MailError('mailbox_needs_reconnect', 409);
      const stored = cipher.open(envelope, context(org, id));
      try {
        const tokens = await oauth.refresh(stored.refresh_token);
        if (!tokens.access_token) throw new Error();
        // Persist refresh-token rotation and re-encrypt with the current key; never store access tokens.
        const saved = await repo.finishSecret(
          org,
          id,
          lease,
          cipher.seal(
            { refresh_token: tokens.refresh_token || stored.refresh_token },
            context(org, id),
          ),
        );
        if (!saved) throw new MailError('mail_refresh_superseded', 409);
        return tokens.access_token;
      } catch (e) {
        const invalid = e?.response?.data?.error === 'invalid_grant';
        const owned = await repo.finishSecret(org, id, lease, null, invalid);
        if (!owned) throw new MailError('mail_refresh_superseded', 409);
        await repo.updateConnection(org, id, {
          ...(invalid ? { status: 'needs_reconnect' } : {}),
          last_error_code: invalid ? 'oauth_revoked' : 'oauth_refresh_unavailable',
        });
        if (invalid) {
          await repo.audit(org, null, id, 'oauth_access_revoked');
        }
        throw new MailError(invalid ? 'mailbox_needs_reconnect' : 'oauth_refresh_unavailable', 503);
      }
    },
    async disconnect(actor, org, id) {
      await repo.access(actor, org, 'manage');
      const row = await repo.connection(org, id);
      const envelope = await repo.getSecret(org, id);
      let revoked = true;
      if (envelope) {
        try {
          await oauth.revoke(cipher.open(envelope, context(org, id)).refresh_token);
        } catch {
          revoked = false;
        }
      }
      await repo.deleteSecret(org, id);
      await repo.updateConnection(org, id, {
        status: 'disconnected',
        credential_reference: null,
        history_id: null,
        checkpoint: null,
        sync_version: row.sync_version + 1,
        allow_system_notifications: false,
        last_error_code: revoked ? null : 'remote_revocation_unconfirmed',
      });
      await repo.audit(org, actor, id, 'mailbox_disconnected', {
        remote_revocation_confirmed: revoked,
      });
      return { status: 'disconnected', remoteRevocationConfirmed: revoked };
    },
  };
}
