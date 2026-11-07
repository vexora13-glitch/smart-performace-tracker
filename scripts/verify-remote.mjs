const expected = 'https://ccxkaqbajugimmtsztif.supabase.co';
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
if (url !== expected || !key)
  throw new Error('Expected portal project URL and anon key in .env.local.');
const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
if (claims.ref !== 'ccxkaqbajugimmtsztif' || claims.role !== 'anon')
  throw new Error('Anon key does not match the portal project.');
console.log('Portal URL and anon-key project claim match.');
const settings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
if (!settings.ok) throw new Error(`Auth settings request failed (${settings.status}).`);
const auth = await settings.json();
console.log({
  authReachable: true,
  emailAuth: auth.external?.email,
  publicSignupDisabled: auth.disable_signup,
});
const response = await fetch(`${url}/rest/v1/portal_profiles?select=id&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
console.log({ portalTableAnonStatus: response.status });
if (response.status === 404) {
  console.error('Portal migration is not present in the remote API schema.');
  process.exitCode = 1;
} else if (response.ok) {
  throw new Error('Anonymous table access must be denied. Inspect grants and RLS before release.');
}
