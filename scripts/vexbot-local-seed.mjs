// Seeds SYNTHETIC data into a LOCAL Supabase stack for Vexbot browser checks. Refuses any non-loopback URL,
// so it can never write to the hosted Portal project. Each run creates fresh, tagged accounts and retires the
// previous run's synthetic knowledge. Writes the accounts to artifacts/vexbot-seed.json (git-ignored).
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';
import { pdf, PIKE_POINT } from '../tests/helpers/pdf.mjs';

/**
 * Chrome's fake microphone input: 0.6 s of quiet, 1.6 s of a voice-like, syllable-modulated tone, then 6 s of
 * quiet. Chrome loops it, so voice mode hears one "question" start and end per loop. 16-bit mono WAV.
 */
function speechLike() {
  const rate = 16000, seconds = 8.2, samples = Math.round(rate * seconds), buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples * 2, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const voiced = t >= 0.6 && t < 2.2;
    const syllables = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t);
    const tone = Math.sin(2 * Math.PI * 180 * t) + 0.5 * Math.sin(2 * Math.PI * 360 * t) + 0.25 * Math.sin(2 * Math.PI * 720 * t);
    buffer.writeInt16LE(Math.round(voiced ? tone * syllables * 9000 : 0), 44 + i * 2);
  }
  return buffer;
}

export default async function seed() {
  const env = { ...loadEnv(process.env.PORTAL_DEV_MODE || 'localtest', process.cwd(), ''), ...process.env };
  const url = env.VITE_SUPABASE_URL;
  if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) throw new Error('Refusing to seed: VITE_SUPABASE_URL is not a local Supabase stack.');
  const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const ok = (result, what) => { if (result.error) throw new Error(`${what}: ${result.error.message}`); return result.data; };
  const tag = Date.now().toString(36);
  const password = 'Synthetic-Passw0rd';
  const user = async (name) => ok(await db.auth.admin.createUser({ email: `${name}.${tag}@example.test`, password, email_confirm: true }), `user ${name}`).user;

  // Earlier runs' synthetic knowledge is retired so answers cite this run's documents only.
  for (const row of ok(await db.from('vexbot_documents').select('id,title').eq('status', 'published'), 'documents'))
    if (row.title.startsWith('Synthetic: ')) ok(await db.rpc('vexbot_set_status', { document: row.id, next: 'retired', actor: null }), 'retire');

  const staff = await user('staff');
  ok(await db.from('portal_profiles').insert({ id: staff.id, role: 'admin', display_name: 'Sam Staff' }), 'staff profile');
  const alice = await user('alice'), bob = await user('bob'), vera = await user('vera');
  ok(await db.rpc('portal_provision_client', { user_id: alice.id, contact: 'Alice Ng', company: `Acme Studio ${tag}`, email: alice.email }), 'acme');
  ok(await db.rpc('portal_provision_client', { user_id: bob.id, contact: 'Bob Reid', company: `Beta Works ${tag}`, email: bob.email }), 'beta');
  ok(await db.rpc('portal_add_member', { user_id: vera.id, contact: 'Vera Viewer', workspace: alice.id, level: 'read_only' }), 'member');

  ok(await db.from('vexbot_settings').update({
    business_profile: {
      name: 'Vexora Digital',
      summary: 'Vexora designs and builds websites, client portals and workflow tools for growing businesses.',
      hours: 'Support hours are 9am to 5pm, Monday to Friday, New Zealand time.',
      contact_email: 'hello@vexora.example',
      website: 'https://vexora.example',
    },
    tone: 'friendly', detail: 'standard', guidance: 'Use New Zealand English.', updated_by: staff.id,
  }).eq('id', 1), 'settings');

  const publish = async (title, workspace, content) => {
    const doc = ok(await db.from('vexbot_documents').insert({ title, workspace_id: workspace, content, created_by: staff.id }).select('id').single(), title);
    ok(await db.rpc('vexbot_set_status', { document: doc.id, next: 'in_review', actor: staff.id }), 'review');
    ok(await db.rpc('vexbot_set_status', { document: doc.id, next: 'published', actor: staff.id, passages: [content] }), 'publish');
    return doc.id;
  };
  const onboarding = await publish('Synthetic: Onboarding guide', null, 'Every new client receives a welcome pack within two business days of signing. To share a file with the team, use Upload privately in your workspace; files are scanned for malware and reviewed before use.');
  const plan = await publish('Synthetic: Acme project plan', alice.id, 'The Acme launch workshop is scheduled for 9 June at 10am. Design review follows two weeks later, and the site goes live after client sign-off.');

  // Enough ordinary workspace content to scroll, so flight can be seen.
  const updates = [
    ['Discovery complete', 'We have finished discovery interviews and shared the summary in your files.'],
    ['Wireframes ready', 'The first wireframes are ready for your review. Comments are welcome in Messages.'],
    ['Content checklist', 'Please gather your team bios, service descriptions and three customer quotes.'],
    ['Brand assets received', 'Thanks for sending your logo files. We will prepare web-optimised versions.'],
    ['Hosting confirmed', 'Your hosting plan is confirmed and the staging site is being prepared.'],
  ];
  for (const [title, body] of updates) ok(await db.from('portal_announcements').insert({ workspace_id: alice.id, title, body, author_id: staff.id }), 'update');
  const thread = ok(await db.from('portal_conversations').insert({ workspace_id: alice.id, subject: 'Launch timing' }).select('id').single(), 'thread');
  ok(await db.from('portal_messages').insert({ conversation_id: thread.id, author_id: alice.id, body: 'Can we confirm the launch workshop time?' }), 'message');
  ok(await db.from('portal_email_jobs').update({ available_at: 'infinity' }).is('sent_at', null), 'hold email jobs');

  // The "Test" workspace for the pike point.pdf acceptance check: files shared the way staff share them.
  // The PDF's content is synthetic; the real file is not in the Portal project.
  const tess = await user('tess');
  ok(await db.rpc('portal_provision_client', { user_id: tess.id, contact: 'Tess Test', company: 'Test', email: tess.email }), 'test');
  const share = async (name, mime, bytes) => {
    const path = `${tess.id}/${randomUUID()}/${name}`;
    ok(await db.storage.from('portal-private').upload(path, bytes, { contentType: mime }), `share ${name}`);
    ok(await db.from('portal_files').insert({ workspace_id: tess.id, name, path, mime_type: mime, size_bytes: bytes.length }), name);
  };
  await share('pike point.pdf', 'application/pdf', pdf(PIKE_POINT));
  await share('part-one.txt', 'text/plain', Buffer.from('Part one\n\nThe discovery phase covers interviews with five staff members and a review of the current booking process.'));

  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/vexbot-voice.wav', speechLike());

  const accounts = {
    tag, password, url,
    tess: { email: tess.email, id: tess.id, company: 'Test' },
    staff: { email: staff.email, id: staff.id },
    alice: { email: alice.email, id: alice.id, company: `Acme Studio ${tag}` },
    bob: { email: bob.email, id: bob.id, company: `Beta Works ${tag}` },
    vera: { email: vera.email, id: vera.id },
    documents: { onboarding, plan },
  };
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/vexbot-seed.json', JSON.stringify(accounts, null, 2));
  return accounts;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || import.meta.url === `file://${process.argv[1]}`) {
  const accounts = await seed();
  console.log(`Seeded synthetic local data (tag ${accounts.tag}).`);
}
