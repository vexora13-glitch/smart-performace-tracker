import { supabase } from '../lib/supabase';
import type {
  Announcement,
  Client,
  Conversation,
  Message,
  PortalData,
  PortalFile,
  Profile,
  ReadReceipt,
  WorkspaceMember,
} from '../types/portal';

export function db() {
  if (!supabase) throw new Error('The portal is awaiting Supabase configuration.');
  return supabase;
}
export function unwrap<T extends { data: unknown; error: { message: string } | null }>(
  result: T,
): NonNullable<T['data']> {
  if (result.error) throw new Error(result.error.message);
  return result.data as NonNullable<T['data']>;
}
async function all<T>(table: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = unwrap(
      await db()
        .from(table)
        .select('*')
        .order(table === 'portal_reads' ? 'conversation_id' : table === 'portal_workspace_members' ? 'user_id' : 'id')
        .range(offset, offset + 499),
    ) as T[];
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
export async function loadPortal(): Promise<PortalData> {
  const [profiles, clients, conversations, messages, reads, announcements, files, members] =
    await Promise.all([
      all<Profile>('portal_profiles'),
      all<Client>('portal_clients'),
      all<Conversation>('portal_conversations'),
      all<Message>('portal_messages'),
      all<ReadReceipt>('portal_reads'),
      all<Announcement>('portal_announcements'),
      all<PortalFile>('portal_files'),
      all<WorkspaceMember>('portal_workspace_members'),
    ]);
  return {
    profiles,
    clients,
    conversations: conversations.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    messages: messages.sort((a, b) => a.created_at.localeCompare(b.created_at)),
    reads,
    announcements: announcements.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    files: files.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    members,
  };
}
export async function api(path: string, body: object, method = 'POST', signal?: AbortSignal) {
  const session = unwrap(await db().auth.getSession()).session;
  if (!session) throw new Error('Sign in to continue.');
  const response = await fetch(`/api/${path}`, {
    signal,
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const value = await response
    .json()
    .catch(() => ({ error: 'Portal server is unavailable. Please try again.' }));
  if (!response.ok) throw new Error(value.error || 'Request failed.');
  return value;
}
export const allowedTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'video/mp4',
  'video/webm',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];
export async function uploadFile(workspace: string, file: File) {
  if (!allowedTypes.includes(file.type))
    throw new Error('Choose a PDF, Office document, image, text file, MP4 or WebM video.');
  const limit = file.type === 'video/mp4' ? 100 : 50;
  if (!file.size || file.size > limit * 1024 * 1024)
    throw new Error(`Files must be between 1 byte and ${limit} MB.`);
  const name = file.name.slice(0, 240);
  const path = `${workspace}/${crypto.randomUUID()}/${name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  unwrap(
    await db()
      .storage.from('portal-private')
      .upload(path, file, { contentType: file.type, upsert: false }),
  );
  try {
    unwrap(
      await db()
        .from('portal_files')
        .insert({
          workspace_id: workspace,
          name,
          path,
          mime_type: file.type,
          size_bytes: file.size,
        }),
    );
  } catch (error) {
    await db().storage.from('portal-private').remove([path]);
    throw error;
  }
}
export async function removeFile(file: PortalFile) {
  unwrap(await db().storage.from('portal-private').remove([file.path]));
  unwrap(await db().from('portal_files').delete().eq('id', file.id));
}
export async function fileUrl(file: PortalFile, download = false) {
  return unwrap(
    await db()
      .storage.from('portal-private')
      .createSignedUrl(file.path, 3600, download ? { download: file.name } : undefined),
  ).signedUrl;
}
export function unread(conversation: string, data: PortalData, userId: string) {
  const read =
    data.reads.find((row) => row.conversation_id === conversation && row.user_id === userId)
      ?.last_read_at || '';
  return data.messages.filter(
    (message) =>
      message.conversation_id === conversation &&
      message.author_id !== userId &&
      message.created_at > read,
  ).length;
}

/** The signed-in person's access per workspace: staff and owners write; members per their access level. */
export function accessMap(profile: Profile, data: PortalData): Record<string, 'read' | 'write'> {
  const map: Record<string, 'read' | 'write'> = {};
  for (const client of data.clients) {
    if (profile.role === 'admin' || client.id === profile.id) map[client.id] = 'write';
    const member = data.members.find((row) => row.workspace_id === client.id && row.user_id === profile.id);
    if (member) map[client.id] = member.access === 'full' ? 'write' : 'read';
  }
  return map;
}
