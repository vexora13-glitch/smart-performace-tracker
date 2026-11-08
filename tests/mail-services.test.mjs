import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connectionService } from '../server/mail/oauth.mjs';
import { tokenCipher, MailError, digest } from '../server/mail/security.mjs';
import { SCOPES } from '../server/mail/config.mjs';
import { syncMailboxPage } from '../server/mail/sync.mjs';
import { GmailApi, normaliseMessage } from '../server/mail/gmail.mjs';

function fixture() {
  const key = randomBytes(32).toString('base64');
  const config = {
    keys: { one: key },
    activeKeyId: 'one',
    stateKey: randomBytes(32).toString('base64'),
    mailbox: 'vexora@example.test',
  };
  const intents = new Map(),
    rows = new Map(),
    secrets = new Map(),
    events = [];
  const leases = new Map();
  const repo = {
    async access(actor, org) {
      if (actor !== 'admin' || org !== 'org') throw new MailError('mail_access_denied', 403);
    },
    async createConnection(row) {
      rows.set(row.id, { ...row, sync_version: 0 });
    },
    async connection(org, id) {
      const row = rows.get(id);
      if (!row || row.organisation_id !== org) throw new MailError('mail_access_denied', 403);
      return { ...row };
    },
    async updateConnection(org, id, value) {
      Object.assign(rows.get(id), value);
    },
    async putIntent(intent) {
      intents.set(intent.state_hash, { ...intent });
    },
    async consumeIntent(hash, binder) {
      const intent = intents.get(hash);
      if (!intent || intent.consumed || intent.binder_hash !== binder)
        throw new MailError('oauth_state_expired_or_replayed');
      intent.consumed = true;
      return { ...intent };
    },
    async putSecret(org, id, value) {
      secrets.set(`${org}:${id}`, value);
    },
    async getSecret(org, id) {
      return secrets.get(`${org}:${id}`);
    },
    async deleteSecret(org, id) {
      secrets.delete(`${org}:${id}`);
      leases.delete(`${org}:${id}`);
    },
    async claimSecret(org, id, lease) {
      const key = `${org}:${id}`;
      if (leases.has(key) || !secrets.has(key)) throw new MailError('mail_refresh_busy');
      leases.set(key, lease);
      return secrets.get(key);
    },
    async finishSecret(org, id, lease, secret = null, erase = false) {
      const key = `${org}:${id}`;
      if (leases.get(key) !== lease || !secrets.has(key)) return false;
      leases.delete(key);
      if (erase) secrets.delete(key);
      else if (secret) secrets.set(key, secret);
      return true;
    },
    async audit(...event) {
      events.push(event);
    },
  };
  let exchangeCalls = 0,
    revocations = 0;
  const oauth = {
    authorizationUrl(_scopes, state) {
      return `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`;
    },
    async exchange() {
      exchangeCalls++;
      return { refresh_token: 'SECRET_REFRESH', access_token: 'SECRET_ACCESS', scope: SCOPES.read };
    },
    async refresh() {
      return { access_token: 'NEW_ACCESS', refresh_token: 'ROTATED_REFRESH' };
    },
    async revoke() {
      revocations++;
    },
  };
  const service = connectionService({
    repo,
    config,
    oauth,
    profileForToken: async () => ({ emailAddress: 'vexora@example.test' }),
  });
  const begin = () => service.begin('admin', 'org', { issuedAt: 100 });
  return {
    repo,
    config,
    oauth,
    service,
    begin,
    intents,
    rows,
    secrets,
    events,
    get exchangeCalls() {
      return exchangeCalls;
    },
    get revocations() {
      return revocations;
    },
  };
}
test('OAuth flow binds actor, organisation, PKCE, cookie and a single-use server intent', async () => {
  const f = fixture();
  const result = await f.begin();
  const state = new URL(result.url).searchParams.get('state');
  const intent = f.intents.get(digest(state));
  assert(!JSON.stringify(intent).includes('SECRET'));
  assert(intent.verifier_envelope.ciphertext);
  await assert.rejects(f.service.callback({ state, binder: 'wrong', code: 'code' }), /replayed/);
  assert.equal(f.exchangeCalls, 0);
  const connected = await f.service.callback({ state, binder: result.binder, code: 'code' });
  assert.equal(connected.status, 'connected');
  assert(!JSON.stringify([...f.secrets.values()]).includes('SECRET_REFRESH'));
  assert(!JSON.stringify(connected).includes('SECRET'));
  await assert.rejects(
    f.service.callback({ state, binder: result.binder, code: 'code' }),
    /replayed/,
  );
  assert.equal(f.exchangeCalls, 1);
  await assert.rejects(f.service.begin('client', 'org', { issuedAt: 100 }), /denied/);
  await assert.rejects(f.service.begin('admin', 'other-org', { issuedAt: 100 }), /denied/);
});
test('failed consent never exchanges code and mismatched mailbox is revoked without credentials', async () => {
  const f = fixture();
  const start = await f.begin();
  const state = new URL(start.url).searchParams.get('state');
  await assert.rejects(
    f.service.callback({ state, binder: start.binder, error: 'access_denied' }),
    /consent_not_completed/,
  );
  assert.equal(f.exchangeCalls, 0);
  assert.equal(f.rows.get(start.connectionId).status, 'needs_reconnect');
  const other = connectionService({
    repo: f.repo,
    config: f.config,
    oauth: f.oauth,
    profileForToken: async () => ({ emailAddress: 'unexpected@example.test' }),
  });
  const next = await other.begin('admin', 'org', { issuedAt: 100 });
  await assert.rejects(
    other.callback({
      state: new URL(next.url).searchParams.get('state'),
      binder: next.binder,
      code: 'code',
    }),
    /unexpected_mailbox/,
  );
  assert.equal(f.revocations, 1);
  assert.equal(f.secrets.size, 0);
});
test('token refresh rotates encrypted secrets, revoked access reconnects, disconnect wipes local credential', async () => {
  const f = fixture();
  const start = await f.begin();
  await f.service.callback({
    state: new URL(start.url).searchParams.get('state'),
    binder: start.binder,
    code: 'code',
  });
  assert.equal(await f.service.accessToken('org', start.connectionId), 'NEW_ACCESS');
  const decrypted = tokenCipher(f.config.keys, 'one').open(
    f.secrets.get(`org:${start.connectionId}`),
    `org:${start.connectionId}:refresh`,
  );
  assert.equal(decrypted.refresh_token, 'ROTATED_REFRESH');
  f.oauth.refresh = async () => {
    const e = new Error('provider secret must not leak');
    e.response = { data: { error: 'invalid_grant' } };
    throw e;
  };
  await assert.rejects(f.service.accessToken('org', start.connectionId), /needs_reconnect/);
  assert.equal(f.rows.get(start.connectionId).status, 'needs_reconnect');
  assert.equal(f.secrets.size, 0);
  await f.service.disconnect('admin', 'org', start.connectionId);
  assert.equal(f.rows.get(start.connectionId).status, 'disconnected');
});

test('concurrent refresh is serialized and disconnect cannot resurrect a secret', async () => {
  const f = fixture();
  const start = await f.begin();
  await f.service.callback({
    state: new URL(start.url).searchParams.get('state'),
    binder: start.binder,
    code: 'code',
  });
  let release, started;
  const entered = new Promise((resolve) => {
    started = resolve;
  });
  f.oauth.refresh = async () => {
    started();
    return new Promise((resolve) => {
      release = () => resolve({ access_token: 'NEW', refresh_token: 'ROTATED' });
    });
  };
  const first = f.service.accessToken('org', start.connectionId);
  await entered;
  await assert.rejects(f.service.accessToken('org', start.connectionId), /refresh_busy/);
  await f.service.disconnect('admin', 'org', start.connectionId);
  release();
  await assert.rejects(first, /superseded/);
  assert.equal(f.secrets.size, 0);
  assert.equal(f.rows.get(start.connectionId).status, 'disconnected');
});

const message = (id) => ({
  id,
  threadId: 'thread',
  historyId: '90071992547409930000',
  internalDate: '1794090000000',
  labelIds: ['INBOX', 'UNREAD'],
  snippet: 'Preview',
  payload: {
    headers: [
      { name: 'From', value: 'Client <client@example.test>' },
      { name: 'Subject', value: 'Subject' },
    ],
    parts: [
      {
        filename: 'file.pdf',
        mimeType: 'application/pdf',
        body: { size: 100, attachmentId: 'attachment' },
      },
    ],
  },
});
function syncFixture(row = {}) {
  let state = { status: 'connected', sync_version: 0, history_id: null, checkpoint: null, ...row };
  const records = new Map();
  const commits = [];
  return {
    records,
    commits,
    get state() {
      return state;
    },
    repo: {
      async connection() {
        return structuredClone(state);
      },
      async updateConnection(_org, _id, changes) {
        Object.assign(state, changes);
      },
      async commitPage(_org, _id, version, page) {
        assert.equal(version, state.sync_version);
        for (const m of page.messages) records.set(m.provider_message_id, m);
        state = {
          ...state,
          sync_version: version + 1,
          checkpoint: page.checkpoint,
          history_id: page.complete ? page.historyId : state.history_id,
        };
        commits.push(page);
      },
    },
  };
}
test('full sync anchors before listing, handles pagination and retries without duplicate messages', async () => {
  const f = syncFixture();
  const order = [];
  let fail = true;
  const api = {
    async profile() {
      order.push('profile');
      return { historyId: '90071992547409930000' };
    },
    async listMessages({ pageToken }) {
      order.push('list');
      return {
        messages: [{ id: pageToken ? 'm2' : 'm1' }],
        ...(!pageToken ? { nextPageToken: 'page2' } : {}),
      };
    },
    async getMessage(id) {
      if (id === 'm2' && fail) {
        fail = false;
        throw new MailError('gmail_unavailable', 503);
      }
      return message(id);
    },
  };
  const step = () =>
    syncMailboxPage({ repo: f.repo, api, organisationId: 'org', connectionId: 'conn' });
  assert.equal((await step()).status, 'syncing');
  assert.deepEqual(order, ['profile', 'list']);
  assert.equal(f.state.history_id, null);
  const checkpoint = structuredClone(f.state.checkpoint);
  await assert.rejects(step(), /unavailable/);
  assert.deepEqual(f.state.checkpoint, checkpoint);
  assert.equal((await step()).status, 'idle');
  assert.equal(f.records.size, 2);
  assert.equal(f.state.history_id, '90071992547409930000');
});
test('incremental sync deduplicates label/add events, marks deletion and recovers from expired history', async () => {
  const f = syncFixture({ history_id: '90071992547409930000' });
  let expired = false;
  const api = {
    async history() {
      if (expired) throw new MailError('gmail_not_found', 404);
      return {
        historyId: '90071992547409930001',
        history: [
          {
            messagesAdded: [{ message: { id: 'm1' } }],
            labelsAdded: [{ message: { id: 'm1' } }],
            messagesDeleted: [{ message: { id: 'm2' } }],
          },
        ],
      };
    },
    async getMessage(id) {
      return message(id);
    },
  };
  await syncMailboxPage({ repo: f.repo, api, organisationId: 'org', connectionId: 'conn' });
  assert.equal(f.records.size, 1);
  assert.deepEqual(f.commits[0].deletedIds, ['m2']);
  expired = true;
  assert.equal(
    (await syncMailboxPage({ repo: f.repo, api, organisationId: 'org', connectionId: 'conn' }))
      .status,
    'full_sync_required',
  );
  assert.equal(f.state.checkpoint.mode, 'full');
});
test('large history pages are durably split before advancing the history cursor', async () => {
  const f = syncFixture({ history_id: '1' });
  let historyCalls = 0;
  const api = {
    async history() {
      historyCalls++;
      return {
        historyId: '2',
        history: [
          { messagesAdded: Array.from({ length: 140 }, (_, i) => ({ message: { id: `m${i}` } })) },
        ],
      };
    },
    async getMessage(id) {
      return message(id);
    },
  };
  await syncMailboxPage({ repo: f.repo, api, organisationId: 'org', connectionId: 'conn' });
  assert.equal(f.records.size, 100);
  assert.equal(f.state.history_id, '1');
  assert.equal(f.state.checkpoint.mode, 'batch');
  await syncMailboxPage({ repo: f.repo, api, organisationId: 'org', connectionId: 'conn' });
  assert.equal(f.records.size, 140);
  assert.equal(f.state.history_id, '2');
  assert.equal(historyCalls, 1);
});
test('Gmail methods use scoped endpoints and redact failures; send is separately gated', async () => {
  const requests = [];
  const api = new GmailApi({
    accessToken: async () => 'ACCESS_SECRET',
    capabilities: ['read'],
    grantedScopes: [SCOPES.read],
    fetcher: async (url, options) => {
      requests.push({ url: String(url), options });
      return { ok: true, json: async () => message('id') };
    },
  });
  await api.getMessage('id/with?characters');
  assert(requests[0].url.includes('id%2Fwith%3Fcharacters'));
  assert.equal(requests[0].options.headers.Authorization, 'Bearer ACCESS_SECRET');
  assert.throws(() => api.send({ raw: 'raw' }), /not_granted/);
  assert.equal(normaliseMessage(message('id')).attachment_metadata[0].attachmentId, 'attachment');
  const bad = new GmailApi({
    accessToken: async () => 'SECRET',
    capabilities: ['read'],
    grantedScopes: [SCOPES.read],
    fetcher: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ secret: 'must not return' }),
    }),
  });
  await assert.rejects(bad.profile(), /gmail_reconnect_required/);
});

test('uncertain Gmail sends are not treated as safe retries', async () => {
  const api = new GmailApi({
    accessToken: async () => 'SECRET',
    capabilities: ['read', 'send'],
    grantedScopes: [SCOPES.read, SCOPES.send],
    fetcher: async () => ({ ok: false, status: 500 }),
  });
  await assert.rejects(api.send({ raw: 'encoded' }), /gmail_delivery_uncertain/);
});
