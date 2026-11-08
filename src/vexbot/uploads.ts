import { api, db, unwrap } from '../services/portal';

export type UploadState = {
  id: string;
  name: string;
  status: 'awaiting_upload' | 'quarantined' | 'scanning' | 'clean' | 'infected' | 'rejected' | 'scan_failed';
  status_detail: string | null;
  workspace_id?: string | null;
  purpose?: string;
  created_at?: string;
  mime_type?: string;
  size_bytes?: number;
};

const TYPES: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'text/plain': ['txt'],
  'text/markdown': ['md', 'markdown'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
};
export const UPLOAD_ACCEPT = [...Object.keys(TYPES), ...Object.values(TYPES).flat().map((ext) => `.${ext}`)].join(',');
export const UPLOAD_HINT = 'PDF, Word, Excel, PowerPoint, text, JPEG, PNG, MP4 or WebM · up to 50 MB';

/** What each state really means, in the words shown to people. */
export const UPLOAD_STATUS: Record<UploadState['status'], string> = {
  awaiting_upload: 'Uploading',
  quarantined: 'Quarantined · waiting for malware scan',
  scanning: 'Quarantined · scanning for malware',
  scan_failed: 'Quarantined · scan could not run yet',
  clean: 'Passed malware scan · awaiting Vexora review',
  infected: 'Blocked · malware detected',
  rejected: 'Rejected · contents did not match the file type',
};

function typeOf(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (file.type && TYPES[file.type]?.includes(extension)) return file.type;
  return Object.entries(TYPES).find(([, extensions]) => extensions.includes(extension))?.[0] ?? '';
}

/**
 * Private upload: the server issues a one-time signed URL into the private Vexbot bucket, the bytes go
 * straight there, and the server then checks the type and runs the malware scan. Returns the real status.
 */
export async function uploadPrivate(file: File, purpose: 'workspace' | 'knowledge' | 'attachment', workspaceId: string | null): Promise<UploadState> {
  const mime = typeOf(file);
  if (!mime) throw new Error(`Choose a supported file: ${UPLOAD_HINT}.`);
  if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('Files must be between 1 byte and 50 MB.');
  const created = await api('vexbot', { action: 'upload_create', purpose, workspace_id: workspaceId, name: file.name, mime, size: file.size });
  unwrap(await db().storage.from('vexbot-private').uploadToSignedUrl(created.path, created.token, file, { contentType: mime }));
  return (await api('vexbot', { action: 'upload_complete', upload_id: created.upload_id })).upload as UploadState;
}
