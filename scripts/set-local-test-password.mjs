import { loadEnv } from 'vite';
import { createClient } from '@supabase/supabase-js';

// Invoked by the masked PowerShell prompt. Never accept a password in argv or log it.
try {
  const env = loadEnv('development', process.cwd(), '');
  if (env.VITE_SUPABASE_URL !== 'http://127.0.0.1:56421')
    throw new Error('Refusing: expected this portal’s local Supabase on port 56421.');
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const password = input.replace(/\r?\n$/, '');
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password))
    throw new Error('Use at least 12 characters, including lowercase, uppercase and a digit.');
  const client = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const id = '9f81494b-ce72-4fe6-ac2c-8554d750fed2';
  const email = 'tess.mw7r0v1f@example.test';
  const user = await client.auth.admin.getUserById(id);
  const workspace = await client.from('portal_clients').select('company').eq('id', id).single();
  const profile = await client.from('portal_profiles').select('active,role').eq('id', id).single();
  if (user.error || workspace.error || profile.error || user.data.user?.email !== email ||
      workspace.data?.company !== 'Test' || !profile.data?.active || profile.data.role !== 'client')
    throw new Error('Refusing: the expected active local Test account was not found.');
  const result = await client.auth.admin.updateUserById(id, { password });
  if (result.error) throw new Error('Local password update failed; no credentials were logged.');
  console.log(`Local password set. Sign in at http://localhost:5186/ as ${email}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
