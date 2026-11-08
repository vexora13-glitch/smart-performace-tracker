import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';

// Invoked by set-local-admin-password.ps1. Creates (or updates) the LOCAL copy of the
// info@vexoradigital.com administrator so it can sign in on the localtest server (:5186).
// Never touches the hosted Portal. Never accept a password in argv or log it.
try {
  const env = loadEnv('localtest', process.cwd(), '');
  for (const name of ['VITE_SUPABASE_URL', 'SUPABASE_URL']) {
    if (env[name] && env[name] !== 'http://127.0.0.1:56421')
      throw new Error(`Refusing: ${name} is not this portal’s local Supabase on port 56421.`);
  }
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const password = input.replace(/\r?\n$/, '');
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password))
    throw new Error('Use at least 12 characters, including lowercase, uppercase and a digit.');
  const client = createClient('http://127.0.0.1:56421', env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = 'info@vexoradigital.com';
  let user;
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error('Could not list local users.');
    user = data.users.find((row) => row.email?.toLowerCase() === email);
    if (user || data.users.length < 100) break;
  }
  const result = user
    ? await client.auth.admin.updateUserById(user.id, { password, email_confirm: true })
    : await client.auth.admin.createUser({ email, password, email_confirm: true });
  if (result.error) throw new Error('Local account update failed; no credentials were logged.');
  const profile = await client
    .from('portal_profiles')
    .upsert({ id: result.data.user.id, role: 'admin', display_name: 'Vexora', active: true });
  if (profile.error) throw new Error(`Local admin profile failed: ${profile.error.message}`);
  console.log(`Local admin ${user ? 'updated' : 'created'}. Sign in at http://localhost:5186/ as ${email}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
