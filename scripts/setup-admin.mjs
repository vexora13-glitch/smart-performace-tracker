import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { database, check } from '../server/runtime.mjs';

const expected = 'https://ccxkaqbajugimmtsztif.supabase.co';
if ((process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) !== expected)
  throw new Error('Unexpected Supabase project.');
const db = database();
const email = 'allan@vexoradigital.com';
const users = check(await db.auth.admin.listUsers({ page: 1, perPage: 1000 })).users;
let user = users.find((row) => row.email?.toLowerCase() === email);
if (!user) {
  const password = `Vx9!${randomBytes(24).toString('base64url')}`;
  // Store the credential locally before provisioning so an interrupted run does not lose it.
  let env = readFileSync('.env.local', 'utf8').replace(
    /^PORTAL_ADMIN_INITIAL_PASSWORD=.*\r?\n?/gm,
    '',
  );
  writeFileSync('.env.local', `${env.trimEnd()}\nPORTAL_ADMIN_INITIAL_PASSWORD=${password}\n`);
  user = check(await db.auth.admin.createUser({ email, password, email_confirm: true })).user;
  console.log('Administrator account created. Initial password saved only in ignored .env.local.');
}
if (!user?.email_confirmed_at)
  throw new Error('Administrator email must be confirmed before provisioning.');
check(
  await db
    .from('portal_profiles')
    .upsert({ id: user.id, role: 'admin', display_name: 'Allan', active: true }),
);
let env = readFileSync('.env.local', 'utf8');
if (!/^CRON_SECRET=.+$/m.test(env)) {
  env = env.replace(/^CRON_SECRET=.*\r?\n?/gm, '');
  writeFileSync('.env.local', `${env.trimEnd()}\nCRON_SECRET=${randomBytes(32).toString('hex')}\n`);
}
console.log('Confirmed administrator profile provisioned; no credentials displayed.');
