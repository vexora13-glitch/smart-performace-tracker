import { db, unwrap } from '../services/portal';
import { events } from './stream.mjs';

export async function streamQuestion<T>(body: object, signal: AbortSignal, onText: (text: string) => void): Promise<T> {
  const session = unwrap(await db().auth.getSession()).session;
  if (!session) throw new Error('Sign in to continue.');
  const response = await fetch('/api/vexbot', {
    method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!response.ok) throw new Error((await response.json()).error || 'Request failed.');
  if (response.headers.get('content-type')?.includes('application/json')) return response.json() as Promise<T>;
  let result: T | undefined;
  for await (const event of events(response.body)) {
    const value = JSON.parse(event.data);
    if (event.event === 'error') throw new Error(value.error);
    if (event.event === 'delta') onText(value.text);
    if (event.event === 'result') result = value as T;
  }
  if (!result) throw new Error('The reply was interrupted. Retry your question.');
  return result;
}
