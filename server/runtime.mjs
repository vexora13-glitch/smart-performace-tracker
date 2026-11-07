import { createClient } from '@supabase/supabase-js';
import { HttpError } from './validation.mjs';

export function database() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'Portal server is awaiting Supabase configuration.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function authenticate(req, db, adminOnly = false) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!match) throw new HttpError(401, 'Sign in to continue.');
  const { data, error } = await db.auth.getUser(match[1]);
  if (error || !data.user || !data.user.email_confirmed_at)
    throw new HttpError(401, 'Your session has expired. Sign in again.');
  const { data: profile, error: profileError } = await db
    .from('portal_profiles')
    .select('id,role,active,sessions_invalid_before')
    .eq('id', data.user.id)
    .single();
  if (profileError || !profile?.active || (adminOnly && profile.role !== 'admin'))
    throw new HttpError(403, 'Access denied.');
  // getUser has already verified the JWT; now enforce our server-controlled session cutoff.
  let issuedAt = 0;
  try {
    issuedAt = JSON.parse(Buffer.from(match[1].split('.')[1], 'base64url').toString()).iat || 0;
  } catch {
    /* invalid token */
  }
  if (profile.sessions_invalid_before && issuedAt <= profile.sessions_invalid_before)
    throw new HttpError(401, 'Your credentials changed. Sign in again.');
  return { user: data.user, profile };
}
export function method(req, allowed) {
  if (!allowed.includes(req.method)) throw new HttpError(405, 'Method not allowed.');
}
export function respondError(res, error) {
  // Never send provider errors, credentials or request bodies to the browser/logs.
  res
    .status(error instanceof HttpError ? error.status : 500)
    .json({
      error:
        error instanceof HttpError
          ? error.message
          : 'The request could not be completed. Please try again.',
    });
}
export function check(result) {
  if (result.error) throw new Error('Database operation failed');
  return result.data;
}
