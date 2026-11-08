// Seeds SYNTHETIC data into a LOCAL Supabase stack for Vexbot browser checks. Refuses any non-loopback URL,
// so it can never write to the hosted Portal project. Each run creates fresh, tagged accounts and retires the
// previous run's synthetic knowledge. Writes the accounts to artifacts/vexbot-seed.json (git-ignored).
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

export default async function seed() {
  const env = { ...loadEnv('development', process.cwd(), ''), ...process.env };
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

  const accounts = {
    tag, password, url,
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
