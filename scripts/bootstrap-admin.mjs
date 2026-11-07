import { database, check } from '../server/runtime.mjs';

// Run with node --env-file=.env.local scripts/bootstrap-admin.mjs
// Provision only the explicitly nominated, confirmed account. Never promote by user metadata.
const db = database();
const email = 'allan@vexoradigital.com';
let found;
for (let page = 1; ; page++) {
  const { users } = check(await db.auth.admin.listUsers({ page, perPage: 100 }));
  found = users.find((user) => user.email?.toLowerCase() === email);
  if (found || users.length < 100) break;
}
if (!found?.email_confirmed_at)
  throw new Error(
    'Create and verify allan@vexoradigital.com in the existing Supabase Auth project first.',
  );
check(
  await db
    .from('portal_profiles')
    .upsert({ id: found.id, role: 'admin', display_name: 'Allan', active: true }),
);
console.log('Verified administrator has been provisioned.');
