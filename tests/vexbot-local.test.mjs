// Vexbot API against a LOCAL Supabase stack (supabase start): real Auth with TOTP MFA, PostgREST, RLS and
// Storage. Synthetic users and documents only. Refuses to run unless the configured URL is loopback.
// The AI provider and malware scanner are the labelled local mocks; see tests/vexbot-unit.test.mjs for
// the OpenAI and clamd adapters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { createHandler } from '../server/vexbot/handler.mjs';
import { createHandler as createClientsHandler } from '../api/clients.mjs';
import { createScanner, EICAR } from '../server/vexbot/scanner.mjs';
import { createProvider } from '../server/vexbot/provider.mjs';
import { docx } from './helpers/office.mjs';
import { totp } from './helpers/totp.mjs';

const env = {
  ...loadEnv(process.env.PORTAL_DEV_MODE || 'localtest', process.cwd(), ''),
  ...process.env,
};
const url = env.VITE_SUPABASE_URL;
const local = url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

test(
  'Vexbot API against local Supabase',
  { skip: !local && 'Local Supabase is not configured (run supabase start)' },
  async (t) => {
    const service = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anon = () =>
      createClient(url, env.VITE_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    process.env.SUPABASE_URL = url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    let scanner = createScanner({ VEXBOT_SCANNER: 'mock' });
    const vexbot = createHandler({
      getProvider: () => createProvider({ VEXBOT_PROVIDER: 'mock' }),
      getScanner: () => scanner,
    });
    const clients = createClientsHandler();
    const run = async (handler, token, body, methodName = 'POST') => {
      let status = 200,
        json;
      const res = {
        setHeader() {},
        status(code) {
          status = code;
          return res;
        },
        json(value) {
          json = value;
          return res;
        },
      };
      await handler(
        { method: methodName, headers: { authorization: `Bearer ${token}` }, body },
        res,
      );
      return { status, ...json };
    };
    const call = (token, body) => run(vexbot, token, body);

    const tag = randomUUID().slice(0, 8);
    // Each run's synthetic knowledge is retired afterwards; leftovers from interrupted runs and the browser
    // suite's seed ("Synthetic: …") are retired first, so suites never answer from each other's documents.
    // Local database only.
    const synthetic = /^(Synthetic: |(Onboarding|Acme brief) [0-9a-f]{8}$)/;
    const retireSynthetic = async (only) => {
      const { data } = await service
        .from('vexbot_documents')
        .select('id,title,status')
        .eq('status', 'published');
      for (const row of data ?? [])
        if (synthetic.test(row.title) && (!only || row.title.endsWith(only)))
          await service.rpc('vexbot_set_status', {
            document: row.id,
            next: 'retired',
            actor: null,
          });
    };
    await retireSynthetic();
    t.after(() => retireSynthetic(tag));
    const password = 'Synthetic-Passw0rd';
    const signIn = async (email) => {
      const client = anon();
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return { client, token: data.session.access_token };
    };
    const createUser = async (name) => {
      const { data, error } = await service.auth.admin.createUser({
        email: `${name}-${tag}@example.test`,
        password,
        email_confirm: true,
      });
      if (error) throw error;
      return data.user;
    };

    // Synthetic people: one administrator, two client workspaces, and a read-only member of the first.
    const adminUser = await createUser('staff');
    assert.equal(
      (
        await service
          .from('portal_profiles')
          .insert({ id: adminUser.id, role: 'admin', display_name: 'Synthetic Staff' })
      ).error,
      null,
    );
    const acme = await createUser('acme'),
      beta = await createUser('beta');
    for (const [user, company] of [
      [acme, 'Acme Synthetic'],
      [beta, 'Beta Synthetic'],
    ])
      assert.equal(
        (
          await service.rpc('portal_provision_client', {
            user_id: user.id,
            contact: company,
            company,
            email: user.email,
          })
        ).error,
        null,
      );
    const staff = await signIn(adminUser.email);
    const enrolled = await staff.client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `test-${tag}`,
    });
    assert.equal(enrolled.error, null);
    const challenge = await staff.client.auth.mfa.challenge({ factorId: enrolled.data.id });
    const verified = await staff.client.auth.mfa.verify({
      factorId: enrolled.data.id,
      challengeId: challenge.data.id,
      code: totp(enrolled.data.totp.secret),
    });
    assert.equal(verified.error, null);
    const staffMfa = verified.data.access_token;
    const a = await signIn(acme.email),
      b = await signIn(beta.email);

    const member = await run(
      clients,
      staff.token,
      {
        action: 'member',
        id: acme.id,
        email: `viewer-${tag}@example.test`,
        display_name: 'Synthetic Viewer',
        password,
        access: 'read_only',
      },
      'PATCH',
    );
    assert.equal(member.status, 201);
    const viewer = await signIn(`viewer-${tag}@example.test`);

    const upload = async (token, fields, bytes) => {
      const created = await call(token, { action: 'upload_create', size: bytes.length, ...fields });
      if (created.status !== 200) return created;
      const put = await anon()
        .storage.from('vexbot-private')
        .uploadToSignedUrl(created.path, created.token, bytes, { contentType: fields.mime });
      assert.equal(put.error, null);
      return call(token, { action: 'upload_complete', upload_id: created.upload_id });
    };

    await t.test('staff MFA is required for settings and knowledge changes', async () => {
      const values = {
        action: 'settings_save',
        business_profile: {
          name: 'Vexora',
          contact_email: 'team@vexora.test',
          hours: 'Support hours are 9am to 5pm, Monday to Friday.',
        },
        tone: 'friendly',
        detail: 'standard',
        guidance: 'Keep answers short.',
      };
      assert.equal((await call(staff.token, values)).status, 403, 'AAL1 staff session');
      assert.match((await call(staff.token, values)).error, /authenticator/);
      assert.equal((await call(a.token, values)).status, 403, 'clients');
      const saved = await call(staffMfa, values);
      assert.equal(saved.status, 200);
      assert.ok(saved.settings.version >= 2);
      assert.equal(
        (await call(staff.token, { action: 'document_create', title: 'x', content: 'y' })).status,
        403,
      );
      assert.equal(
        (
          await call(staff.token, {
            action: 'upload_create',
            purpose: 'knowledge',
            name: 'k.txt',
            mime: 'text/plain',
            size: 3,
          })
        ).status,
        403,
      );
      const history = await staff.client
        .from('vexbot_settings_history')
        .select('version,changed_by')
        .order('version', { ascending: false })
        .limit(1);
      assert.equal(history.data[0].changed_by, adminUser.id);
      assert.equal(
        (await a.client.from('vexbot_settings_history').select('*')).data.length,
        0,
        'clients cannot read settings history',
      );
    });

    let businessDoc, acmeDoc;
    await t.test(
      'a synthetic document goes from private upload through scan, review and publication',
      async () => {
        const done = await upload(
          staffMfa,
          { purpose: 'knowledge', name: `onboarding-${tag}.docx`, mime: DOCX },
          docx([
            'Onboarding guide',
            `Every new client receives a welcome pack within two business days. Reference ${tag}.`,
          ]),
        );
        assert.equal(done.upload.status, 'clean');
        const created = await call(staffMfa, {
          action: 'document_create',
          upload_id: done.upload.id,
          title: `Onboarding ${tag}`,
        });
        assert.equal(created.status, 200);
        assert.match(created.document.content, /welcome pack within two business days/);
        businessDoc = created.document.id;
        const asked = async () =>
          (
            await call(a.token, {
              action: 'ask',
              workspace_id: acme.id,
              question: 'How soon do new clients receive a welcome pack?',
            })
          ).messages[1];
        assert.equal((await asked()).outcome, 'no_answer', 'a draft is never used');
        assert.equal(
          (await call(staffMfa, { action: 'document_status', id: businessDoc, to: 'in_review' }))
            .status,
          200,
        );
        assert.equal((await asked()).outcome, 'no_answer', 'nor is a document in review');
        assert.equal(
          (await call(staffMfa, { action: 'document_status', id: businessDoc, to: 'published' }))
            .status,
          200,
        );
        const answer = await asked();
        assert.equal(answer.outcome, 'answered');
        assert.match(answer.content, /two business days/);
        assert.deepEqual(
          answer.citations.map((c) => c.document_id),
          [businessDoc],
        );
        assert.equal(answer.citations[0].title, `Onboarding ${tag}`);
      },
    );

    await t.test(
      'uploads are validated, malware is blocked, and nothing is clean without a scanner',
      async () => {
        const fake = await upload(
          a.token,
          {
            purpose: 'workspace',
            workspace_id: acme.id,
            name: 'invoice.pdf',
            mime: 'application/pdf',
          },
          Buffer.from('<html>not a pdf</html>'),
        );
        assert.equal(fake.upload.status, 'rejected');
        const infected = await upload(
          a.token,
          { purpose: 'workspace', workspace_id: acme.id, name: 'notes.txt', mime: 'text/plain' },
          Buffer.from(EICAR),
        );
        assert.equal(infected.upload.status, 'infected');
        assert.equal(
          (await service.storage.from('vexbot-private').list(`${acme.id}/${infected.upload.id}`))
            .data.length,
          0,
          'infected bytes are deleted',
        );
        scanner = null;
        const held = await upload(
          a.token,
          { purpose: 'attachment', workspace_id: acme.id, name: 'brief.txt', mime: 'text/plain' },
          Buffer.from(`Acme brief ${tag}`),
        );
        assert.equal(held.upload.status, 'quarantined');
        assert.match(held.upload.status_detail, /Waiting for the malware scanner/);
        assert.equal(
          (await call(a.token, { action: 'upload_url', upload_id: held.upload.id })).status,
          409,
          'quarantined files cannot be opened',
        );
        const withNote = await call(a.token, {
          action: 'ask',
          workspace_id: acme.id,
          question: 'Can you read my brief?',
          attachments: [held.upload.id],
        });
        assert.match(
          withNote.messages[1].content,
          /“brief\.txt” is quarantined while it is checked for malware/,
        );
        scanner = createScanner({ VEXBOT_SCANNER: 'mock' });
        assert.equal(
          (await call(staff.token, { action: 'upload_rescan', upload_id: held.upload.id })).upload
            .status,
          'clean',
        );
        assert.equal(
          (
            await call(b.token, {
              action: 'ask',
              workspace_id: beta.id,
              question: 'x',
              attachments: [held.upload.id],
            })
          ).status,
          400,
          "another client's upload cannot be attached",
        );
        const listed = await viewer.client
          .from('vexbot_uploads')
          .select('name,status')
          .eq('workspace_id', acme.id);
        assert.ok(
          listed.data.some((row) => row.name === 'brief.txt' && row.status === 'clean'),
          'members see real upload status',
        );
        assert.equal(
          (await b.client.from('vexbot_uploads').select('id').eq('workspace_id', acme.id)).data
            .length,
          0,
        );
        // The approved client file becomes Acme-only knowledge, never business-wide.
        assert.equal(
          (
            await call(staffMfa, {
              action: 'document_create',
              upload_id: held.upload.id,
              title: 'Brief',
            })
          ).status,
          400,
        );
        const scoped = await call(staffMfa, {
          action: 'document_create',
          upload_id: held.upload.id,
          workspace_id: acme.id,
          title: `Acme brief ${tag}`,
          content: `The Acme launch workshop is scheduled for the ninth of June. Code ${tag}.`,
        });
        acmeDoc = scoped.document.id;
        await call(staffMfa, { action: 'document_status', id: acmeDoc, to: 'in_review' });
        assert.equal(
          (await call(staffMfa, { action: 'document_status', id: acmeDoc, to: 'published' }))
            .status,
          200,
        );
      },
    );

    let acmeAnswer, conversationId;
    await t.test('answers are grounded per workspace: no cross-project leakage', async () => {
      const asked = await call(a.token, {
        action: 'ask',
        workspace_id: acme.id,
        question: 'When is the launch workshop scheduled?',
      });
      acmeAnswer = asked.messages[1];
      conversationId = asked.conversation.id;
      assert.equal(acmeAnswer.outcome, 'answered');
      assert.match(acmeAnswer.content, /ninth of June/);
      assert.deepEqual(
        acmeAnswer.citations.map((c) => c.document_id),
        [acmeDoc],
      );
      const other = await call(b.token, {
        action: 'ask',
        workspace_id: beta.id,
        question: 'When is the launch workshop scheduled?',
      });
      assert.equal(other.messages[1].outcome, 'no_answer');
      assert.ok(!other.messages[1].content.includes('June'));
      assert.match(other.messages[1].content, /won't guess.*Messages or email team@vexora\.test/);
      assert.equal(
        (
          await call(b.token, {
            action: 'ask',
            workspace_id: acme.id,
            question: 'When is the launch workshop?',
          })
        ).status,
        403,
      );
      assert.equal(
        (await call(b.token, { action: 'conversation', conversation_id: conversationId })).status,
        404,
      );
      assert.equal(
        (await call(b.token, { action: 'speech', message_id: acmeAnswer.id })).status,
        404,
      );
      assert.equal(
        (
          await call(b.token, {
            action: 'transcribe',
            workspace_id: acme.id,
            mime: 'audio/webm',
            audio: 'AAAA',
          })
        ).status,
        403,
      );
      assert.equal(
        (await call(a.token, { action: 'ask', question: 'Hours?' })).status,
        400,
        'clients must choose a workspace',
      );
      const general = await call(b.token, {
        action: 'ask',
        workspace_id: beta.id,
        question: 'What are your support hours?',
      });
      assert.equal(
        general.messages[1].outcome,
        'answered',
        'business profile answers in every workspace',
      );
      assert.equal(general.messages[1].uses_profile, true);
    });

    await t.test('read-only members can ask and read, but cannot upload or post', async () => {
      const asked = await call(viewer.token, {
        action: 'ask',
        workspace_id: acme.id,
        question: 'When is the launch workshop scheduled?',
      });
      assert.equal(asked.messages[1].outcome, 'answered');
      const blocked = await call(viewer.token, {
        action: 'upload_create',
        purpose: 'workspace',
        workspace_id: acme.id,
        name: 'a.txt',
        mime: 'text/plain',
        size: 3,
      });
      assert.equal(blocked.status, 403);
      assert.match(blocked.error, /read-only/);
      const post = await viewer.client.rpc('portal_start_conversation', {
        workspace: acme.id,
        title: 'Hi',
        body: 'Question',
      });
      assert.ok(post.error, 'cannot start a message thread');
      assert.equal(
        (await call(viewer.token, { action: 'ask', workspace_id: beta.id, question: 'Hours?' }))
          .status,
        403,
      );
      assert.equal(
        (await call(viewer.token, { action: 'conversation', conversation_id: conversationId }))
          .status,
        404,
        "cannot read the owner's conversation",
      );
    });

    await t.test(
      'voice: turn-based transcription and spoken replies, rechecked each time',
      async () => {
        const heard = await call(a.token, {
          action: 'transcribe',
          workspace_id: acme.id,
          mime: 'audio/webm;codecs=opus',
          audio: Buffer.from('synthetic audio').toString('base64'),
        });
        assert.equal(heard.text, 'What are your support hours?');
        assert.equal(
          (
            await call(a.token, {
              action: 'transcribe',
              workspace_id: acme.id,
              mime: 'video/mp4',
              audio: 'AAAA',
            })
          ).status,
          400,
        );
        const spoken = await call(a.token, { action: 'speech', message_id: acmeAnswer.id });
        assert.equal(spoken.mime, 'audio/wav');
        assert.ok(Buffer.from(spoken.audio, 'base64').subarray(0, 4).equals(Buffer.from('RIFF')));
      },
    );

    await t.test(
      'retiring a source withdraws saved answers and spoken replies immediately',
      async () => {
        assert.equal(
          (await call(staffMfa, { action: 'document_status', id: acmeDoc, to: 'retired' })).status,
          200,
        );
        const history = await call(a.token, {
          action: 'conversation',
          conversation_id: conversationId,
        });
        const saved = history.messages.find((m) => m.id === acmeAnswer.id);
        assert.equal(saved.withdrawn, true);
        assert.ok(!saved.content.includes('June'));
        assert.deepEqual(saved.citations, []);
        assert.equal(
          (await call(a.token, { action: 'speech', message_id: acmeAnswer.id })).status,
          410,
        );
        const again = await call(a.token, {
          action: 'ask',
          workspace_id: acme.id,
          conversation_id: conversationId,
          question: 'When is the launch workshop scheduled?',
        });
        assert.equal(again.messages[1].outcome, 'no_answer');
        assert.equal(
          (
            await call(staffMfa, {
              action: 'document_update',
              id: acmeDoc,
              title: 'x',
              content: 'y',
            })
          ).status,
          409,
          'retired text is frozen',
        );
      },
    );

    await t.test('removing or disabling a member revokes access on the next request', async () => {
      assert.equal(
        (
          await run(
            clients,
            staff.token,
            { action: 'member_access', id: member.id, workspace_id: acme.id, access: 'remove' },
            'PATCH',
          )
        ).status,
        200,
      );
      // Windows issues the cutoff; local Auth can run in a VM with a slightly different clock.
      // Wait for a genuinely newer JWT rather than assuming a 1.1-second sleep crosses both clocks.
      const cutoff = await service
        .from('portal_profiles')
        .select('sessions_invalid_before')
        .eq('id', member.id)
        .single();
      assert.equal(cutoff.error, null);
      let fresh,
        issuedAt = 0;
      const deadline = Date.now() + 10_000;
      do {
        fresh = await signIn(`viewer-${tag}@example.test`);
        issuedAt = JSON.parse(Buffer.from(fresh.token.split('.')[1], 'base64url').toString()).iat;
        if (issuedAt > cutoff.data.sessions_invalid_before) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      } while (Date.now() < deadline);
      assert.ok(
        issuedAt > cutoff.data.sessions_invalid_before,
        'Auth issued a session newer than the credential cutoff',
      );
      assert.equal(
        (await call(fresh.token, { action: 'ask', workspace_id: acme.id, question: 'Hours?' }))
          .status,
        403,
      );
      assert.equal((await fresh.client.from('portal_clients').select('id')).data.length, 0);
      assert.equal(
        (await call(viewer.token, { action: 'ask', workspace_id: acme.id, question: 'Hours?' }))
          .status,
        401,
        'old session is cut off',
      );
      assert.equal(
        (await run(clients, staff.token, { action: 'status', id: acme.id, active: false }, 'PATCH'))
          .status,
        200,
      );
      assert.equal(
        (await call(a.token, { action: 'ask', workspace_id: acme.id, question: 'Hours?' })).status,
        403,
      );
    });

    await t.test('staff preview uses unsaved settings and stores nothing', async () => {
      const countPreviewMessages = async () =>
        (
          await service
            .from('vexbot_messages')
            .select('id,vexbot_conversations!inner(user_id)', { count: 'exact', head: true })
            .eq('vexbot_conversations.user_id', adminUser.id)
        ).count;
      const before = await countPreviewMessages();
      const preview = await call(staff.token, {
        action: 'preview',
        question: 'How soon do new clients receive a welcome pack?',
        settings: { business_profile: {}, tone: 'concise', detail: 'brief', guidance: '' },
      });
      assert.equal(preview.outcome, 'answered');
      assert.equal(preview.citations[0].document_id, businessDoc);
      assert.equal(await countPreviewMessages(), before);
      assert.equal((await call(a.token, { action: 'preview', question: 'x' })).status, 403);
    });
  },
);
