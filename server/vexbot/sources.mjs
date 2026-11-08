// What Vexbot may read in one workspace, and how it reads it. The boundary is the client's own workspace:
//   - Shared files (portal_files) that Vexora shared into the workspace, read from their actual contents.
//   - Client uploads only after they pass the malware scan AND staff publish them as a document.
//   - Documents staff published for this workspace or for everyone, and the business profile.
// Never: drafts or documents in review (staff working notes), retired documents, quarantined, infected or
// unreviewed uploads, or anything belonging to another workspace. Callers recheck workspace access first.
// File contents are untrusted data; prompt.mjs fences them before they reach the model.
import { chunk, extractText, MAX_EXTRACT_BYTES, sniff, UPLOAD_TYPES } from './files.mjs';

const SHARED_BUCKET = 'portal-private';
/** Characters of whole-file text given to the model for one answer, split across the files asked about. */
export const FILE_BUDGET = 60_000;
const PROCESSING_STALE_MS = 3 * 60_000;
const EXTRACT_WAIT_MS = 25_000;
const SEARCH_EXTRACT_FILES = 2;
const SEARCH_EXTRACT_BYTES = 5 * 1024 * 1024;
const SEARCH_EXTRACT_WAIT_MS = 8_000;
const MAX_TARGETS = 4;

const ok = (result) => {
  if (result.error) throw new Error('Database operation failed');
  return result.data;
};
/** True when the workspace-files migration has not been applied yet; Vexbot then works without the cache. */
export const missingTable = (error) => Boolean(error) && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message ?? ''));

export const readable = (mime) => Boolean(UPLOAD_TYPES[mime]?.text);
const kindOf = (mime) => (mime?.startsWith('video/') ? 'video' : mime?.startsWith('image/') ? 'image' : 'file');

// ---- Matching what the person asked about -------------------------------------------------------------------
export function normalise(text) {
  return ` ${String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
}
const stem = (name) => name.replace(/\.[a-z0-9]{1,8}$/i, '');

/** The question names this file: its full name, or a base name distinctive enough not to be an ordinary word. */
export function mentions(question, name) {
  if (!name) return false;
  const asked = normalise(question), full = normalise(name).trim(), base = normalise(stem(name)).trim();
  if (full && asked.includes(` ${full} `)) return true;
  const titled = normalise(name.replace(/^[^:]{1,40}:\s*/, '')).trim();
  if (titled !== full && titled.length >= 6 && asked.includes(` ${titled} `)) return true;
  return Boolean(base) && (base.includes(' ') || base.length >= 6) && asked.includes(` ${base} `);
}

const DEICTIC = /\b(?:this|that|the|my|our|attached|shared|uploaded)\s+(?:file|document|doc|pdf|attachment|deck|slides?|spreadsheet|presentation|report|brief|upload)s?\b|\b(?:file|document|doc|pdf|attachment)s?\s+(?:here|above|attached)\b|\b(?:summari[sz]e|analy[sz]e|review|explain|read)\s+(?:it|this|that)\b/i;
/** “Summarize the document here”, “what does this file say”: a file is meant without being named. */
export const refersToFile = (question) => DEICTIC.test(question);

const EXTENSION = /\.(?:pdf|docx?|xlsx?|pptx?|txt|md|markdown|csv|jpe?g|png|gif|mp4|webm|mov)$/i;
const LEAD_WORDS = new Set(['summarise', 'summarize', 'analyse', 'analyze', 'review', 'explain', 'read', 'open', 'check', 'about', 'of', 'in', 'on', 'the', 'from', 'for', 'is', 'what', 'whats', 'does', 'say', 'tell', 'me', 'please', 'can', 'you', 'my', 'a', 'an', 'file', 'document', 'called', 'named']);
/** A file name the person typed, so a reply can say exactly which file it could not find. */
export function requestedName(question) {
  const quoted = question.match(/[`“"‘']([^`”"’']{1,160}\.[a-z0-9]{2,8})[`”"’']/i);
  if (quoted) return quoted[1].trim();
  const words = question.split(/\s+/).map((word) => word.replace(/^[([]+|[)\]?!,;:]+$/g, ''));
  const at = words.findIndex((word) => EXTENSION.test(word));
  if (at < 0) return null;
  let from = at;
  while (from > 0 && at - from < 4 && !LEAD_WORDS.has(words[from - 1].toLowerCase().replace(/[^a-z]/g, ''))) from--;
  return words.slice(from, at + 1).join(' ');
}

// ---- What exists in the workspace ---------------------------------------------------------------------------
/** Everything Vexbot could read or report on in a workspace, without any file contents. */
export async function inventory(db, workspace) {
  if (workspace === null) {
    const documents = ok(await db.from('vexbot_documents').select('id,title,workspace_id,upload_id').eq('status', 'published').is('workspace_id', null).limit(200));
    return { files: [], documents: documents.map(documentItem), uploads: [] };
  }
  const [files, documents, uploads, reviewing] = await Promise.all([
    db.from('portal_files').select('id,name,mime_type,size_bytes,path,created_at').eq('workspace_id', workspace).order('created_at', { ascending: false }).limit(200),
    db.from('vexbot_documents').select('id,title,workspace_id,upload_id,vexbot_uploads(name)').eq('status', 'published').or(`workspace_id.is.null,workspace_id.eq.${workspace}`).limit(200),
    db.from('vexbot_uploads').select('id,name,status').eq('workspace_id', workspace).in('purpose', ['workspace', 'attachment']).order('created_at', { ascending: false }).limit(200),
    // Only to say "waiting for review"; draft text is never read.
    db.from('vexbot_documents').select('upload_id').eq('workspace_id', workspace).in('status', ['draft', 'in_review']).not('upload_id', 'is', null),
  ]).then((results) => results.map(ok));
  const published = new Set(documents.map((row) => row.upload_id).filter(Boolean));
  const inReview = new Set(reviewing.map((row) => row.upload_id));
  return {
    files: files.map((row) => ({ kind: 'file', id: row.id, name: row.name, mime: row.mime_type, size: Number(row.size_bytes), path: row.path, workspace_id: workspace })),
    documents: documents.map(documentItem),
    // Uploads that became a published document are read through that document instead.
    uploads: uploads.filter((row) => !published.has(row.id)).map((row) => ({ kind: 'upload', id: row.id, name: row.name, status: row.status, reviewing: inReview.has(row.id) })),
  };
}
function documentItem(row) {
  return { kind: 'document', id: row.id, name: row.title, alias: row.vexbot_uploads?.name ?? null, upload_id: row.upload_id, workspace_id: row.workspace_id };
}
/** Names of what can actually be read, for replies that list the options. */
export function readableNames(inv) {
  return [...inv.files.filter((file) => readable(file.mime)).map((file) => file.name), ...inv.documents.filter((doc) => doc.workspace_id).map((doc) => doc.alias || doc.name)];
}

/**
 * Decides which files a question is about. Returns { targets }, { missing: name }, { ambiguous: items } or
 * { general: true } for an ordinary question answered by search.
 */
export function resolve(question, inv, { attachments = [], recent = [] } = {}) {
  const all = [...inv.files, ...inv.documents, ...inv.uploads];
  const named = all.filter((item) => mentions(question, item.name) || mentions(question, item.alias));
  if (named.length) return { targets: named.slice(0, MAX_TARGETS) };
  const asked = requestedName(question);
  if (asked) return { missing: asked };
  const attached = attachments.map((id) => inv.documents.find((doc) => doc.upload_id === id) ?? inv.uploads.find((upload) => upload.id === id)).filter(Boolean);
  if (attached.length && (refersToFile(question) || attached.some((item) => item.kind === 'document'))) return { targets: attached };
  if (!refersToFile(question)) return { general: true, attached };
  const earlier = recent.map((ref) => all.find((item) => item.kind === ref.kind && item.id === ref.id)).filter(Boolean);
  if (earlier.length) return { targets: earlier.slice(0, MAX_TARGETS) };
  const candidates = [...inv.files.filter((file) => readable(file.mime)), ...inv.documents.filter((doc) => doc.workspace_id)];
  if (candidates.length === 1) return { targets: candidates };
  return { ambiguous: candidates };
}

// ---- Reading a file's contents ------------------------------------------------------------------------------
// Fallback cache for a deployment whose database does not have vexbot_file_text yet. Bounded.
const memory = new Map();
function remember(row) {
  memory.delete(row.file_id);
  memory.set(row.file_id, row);
  while (memory.size > 40) memory.delete(memory.keys().next().value);
}
async function store(db, row) {
  remember(row);
  const result = await db.from('vexbot_file_text').upsert(row);
  if (result.error && !missingTable(result.error)) throw new Error('Database operation failed');
}
async function extractShared(db, file) {
  if (file.size > MAX_EXTRACT_BYTES) return { status: 'too_large', content: '' };
  const { data, error } = await db.storage.from(SHARED_BUCKET).download(file.path);
  if (error || !data) return { status: 'failed', content: '', note: 'The file could not be opened from storage.' };
  const bytes = Buffer.from(await data.arrayBuffer());
  const problem = sniff(bytes, file.mime);
  if (problem) return { status: 'failed', content: '', note: problem };
  const { text } = await extractText(bytes, file.mime);
  return text ? { status: 'ready', content: text } : { status: 'empty', content: '' };
}
const later = (ms) => {
  let timer;
  const promise = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); timer.unref?.(); });
  return { promise, cancel: () => clearTimeout(timer) };
};

/**
 * The text of a shared file: from the cache, or extracted now. If extraction takes longer than `wait`, it
 * carries on in the background and the file is reported as still processing.
 */
export async function sharedText(db, file, { wait = EXTRACT_WAIT_MS } = {}) {
  if (!readable(file.mime)) return { status: 'unsupported', content: '' };
  const cached = await db.from('vexbot_file_text').select('*').eq('file_id', file.id).maybeSingle();
  if (cached.error && !missingTable(cached.error)) throw new Error('Database operation failed');
  const hit = cached.error ? memory.get(file.id) : cached.data;
  if (hit && Number(hit.size_bytes) === file.size) {
    if (hit.status !== 'processing' || Date.now() - Date.parse(hit.updated_at) < PROCESSING_STALE_MS) return hit;
  }
  const base = { file_id: file.id, workspace_id: file.workspace_id, size_bytes: file.size, content: '', note: null };
  await store(db, { ...base, status: 'processing', updated_at: new Date().toISOString() });
  const work = extractShared(db, file)
    .catch(() => ({ status: 'failed', content: '', note: 'Text extraction failed.' }))
    .then(async (result) => {
      const row = { ...base, ...result, note: result.note?.slice(0, 300) ?? null, content: result.content.slice(0, 200000), updated_at: new Date().toISOString() };
      await store(db, row).catch(() => {});
      return row;
    });
  const timer = later(wait);
  const done = await Promise.race([work, timer.promise]);
  timer.cancel();
  return done ?? { ...base, status: 'processing' };
}

const UPLOAD_STATE = {
  awaiting_upload: 'did not finish uploading',
  quarantined: 'is quarantined while it is checked for malware',
  scanning: 'is quarantined while it is checked for malware',
  scan_failed: 'could not be checked yet, so it stays quarantined',
  clean: 'passed the malware check and is waiting for the Vexora team to review it',
  infected: 'was blocked by the malware check and will not be used',
  rejected: 'was rejected because its contents did not match its file type',
};
export const uploadState = (upload) => `“${upload.name}” ${UPLOAD_STATE[upload.status] ?? 'is not available yet'}.`;
const UPLOAD_RULE = 'I can only use uploads after they pass the malware check and the Vexora team approves them for this workspace.';

/** Why a file cannot be read, in words for the client. Each state is distinct from a service failure. */
export function problemText(item, state) {
  const name = `“${item.name}”`;
  switch (state.status) {
    case 'processing': return `${name} is still being processed, so I can't read it yet. Please ask again in a minute.`;
    case 'unsupported': return `${name} is ${kindOf(item.mime) === 'file' ? 'a file type' : `a ${kindOf(item.mime)}`} I can't read. I can read the text of PDF, Word, Excel, PowerPoint, text and Markdown files.`;
    case 'empty': return `I couldn't find any readable text in ${name}. It may be a scanned image or a document without a text layer.`;
    case 'too_large': return `${name} is larger than the 20 MB I can read automatically.`;
    case 'upload': return `${uploadState(item)} ${UPLOAD_RULE}`;
    default: return `I couldn't open ${name} to read it. It may be damaged or not match its file type.`;
  }
}

/** Reads one target. Returns { item, content } when readable, or { item, problem } with the reason. */
export async function readTarget(db, item) {
  if (item.kind === 'upload') return { item, problem: problemText(item, { status: 'upload' }) };
  if (item.kind === 'document') {
    const row = ok(await db.from('vexbot_documents').select('content,status').eq('id', item.id).single());
    return row.status === 'published' && row.content ? { item, content: row.content } : { item, problem: `“${item.name}” is no longer published.` };
  }
  const state = await sharedText(db, item);
  return state.status === 'ready' && state.content ? { item, content: state.content } : { item, problem: problemText(item, state) };
}

/** Whole-file sources for the files a question is about, sharing the character budget between them. */
export function fileSources(read) {
  const share = Math.floor(FILE_BUDGET / Math.max(1, read.length));
  return read.map(({ item, content }, index) => ({
    id: `F${index + 1}`,
    kind: item.kind,
    file_id: item.kind === 'file' ? item.id : null,
    document_id: item.kind === 'document' ? item.id : null,
    title: item.kind === 'document' ? item.alias || item.name : item.name,
    label: item.kind === 'file' ? 'shared file' : 'approved document',
    whole: true,
    content: content.length > share ? `${content.slice(0, share)}\n\n[The file continues beyond this point.]` : content,
  }));
}

// ---- Search across shared files for ordinary questions ------------------------------------------------------
const STOP = new Set('about above after again also been before being could does doing from have having here into just more most much need only other over please same should some such tell than that their them then there these they this those through under very what when where which while will with would your yours know want'.split(' '));
export const keywords = (question) => [...new Set(question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])].filter((word) => !STOP.has(word));

/** The shared-file passages that best match an ordinary question. Uses cached text, extracting a few files. */
export async function sharedPassages(db, inv, question, limit = 3) {
  const terms = keywords(question);
  const files = inv.files.filter((file) => readable(file.mime)).slice(0, 20);
  if (!terms.length || !files.length) return [];
  const cached = await db.from('vexbot_file_text').select('file_id,status,size_bytes,content').eq('workspace_id', files[0].workspace_id).eq('status', 'ready');
  if (cached.error && !missingTable(cached.error)) throw new Error('Database operation failed');
  const texts = new Map((cached.error ? [...memory.values()] : cached.data).filter((row) => row.status === 'ready').map((row) => [row.file_id, row]));
  const missing = files.filter((file) => !texts.has(file.id) && file.size <= SEARCH_EXTRACT_BYTES).slice(0, SEARCH_EXTRACT_FILES);
  for (const state of await Promise.all(missing.map((file) => sharedText(db, file, { wait: SEARCH_EXTRACT_WAIT_MS }).catch(() => null))))
    if (state?.status === 'ready') texts.set(state.file_id, state);
  const scored = [];
  for (const file of files) {
    const row = texts.get(file.id);
    if (!row || Number(row.size_bytes) !== file.size) continue;
    for (const passage of chunk(row.content)) {
      const lower = passage.toLowerCase();
      const hits = terms.filter((term) => lower.includes(term)).length;
      if (hits) scored.push({ file, passage, hits });
    }
  }
  return scored.sort((a, b) => b.hits - a.hits).slice(0, limit).map(({ file, passage }) => ({ kind: 'file', file_id: file.id, document_id: null, title: file.name, label: 'shared file', content: passage }));
}
