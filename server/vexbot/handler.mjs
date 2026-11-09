// The Vexbot API. One POST endpoint with an `action`. Every request is authenticated, every workspace is
// rechecked against the database on every call (including saved answers and spoken replies), and every
// knowledge or settings change requires an administrator session verified with MFA (AAL2).
import { selectHistory, retrievalQueries } from './context.mjs';
import { realtimeReadiness } from './realtime.mjs';
import { randomUUID } from 'node:crypto';
import { authenticate, check, database, method, respondError } from '../runtime.mjs';
import { HttpError, id as uuid, requiredText } from '../validation.mjs';
import { chunk, declaredFile, extractText, sniff } from './files.mjs';
import { createProvider } from './provider.mjs';
import { createScanner } from './scanner.mjs';
import { contactText, DETAIL, noAnswerText, PROFILE_FIELDS, profileText, TONES, validateAnswer } from './prompt.mjs';

const BUCKET = 'vexbot-private';
const QUESTIONS_PER_HOUR = 60;
const AUDIO_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];
const MAX_AUDIO_BYTES = 1_000_000;

function claims(req) {
  try {
    return JSON.parse(Buffer.from(req.headers.authorization.split(' ')[1].split('.')[1], 'base64url').toString());
  } catch {
    return {};
  }
}

// ---- Access ----------------------------------------------------------------------------------------------
async function accessLevel(ctx, workspace) {
  if (workspace === null) return ctx.admin ? 'write' : null;
  return check(await ctx.db.rpc('vexbot_workspace_access', { person: ctx.user.id, issued_at: ctx.iat, workspace }));
}
async function requireAccess(ctx, workspace, level = 'read') {
  const access = await accessLevel(ctx, workspace);
  if (!access) throw new HttpError(403, 'You do not have access to this workspace.');
  if (level === 'write' && access !== 'write') throw new HttpError(403, 'Your access to this workspace is read-only.');
  return access;
}
function requireAdmin(ctx) {
  if (!ctx.admin) throw new HttpError(403, 'Access denied.');
}
function requireMfa(ctx) {
  requireAdmin(ctx);
  if (ctx.aal !== 'aal2') throw new HttpError(403, 'Verify with your authenticator app to make Vexbot changes.');
}
function workspaceInput(ctx, value) {
  if (value === null || value === undefined || value === '') {
    if (!ctx.admin) throw new HttpError(400, 'Choose a workspace first.');
    return null;
  }
  return uuid(value);
}
async function audit(ctx, action, target, detail = {}) {
  check(await ctx.db.from('vexbot_audit').insert({ actor: ctx.user.id, action, target, detail }));
}

// ---- Settings --------------------------------------------------------------------------------------------
async function loadSettings(ctx) {
  return check(await ctx.db.from('vexbot_settings').select('*').eq('id', 1).single());
}
function settingsInput(input) {
  const profile = {};
  const raw = input.business_profile && typeof input.business_profile === 'object' ? input.business_profile : {};
  for (const [key, max] of Object.entries(PROFILE_FIELDS)) {
    const value = raw[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || value.trim().length > max) throw new HttpError(400, `Invalid business profile field: ${key}.`);
    profile[key] = value.trim();
  }
  if (profile.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.contact_email)) throw new HttpError(400, 'Invalid contact email.');
  if (profile.website && !/^https:\/\/[^\s]+$/.test(profile.website)) throw new HttpError(400, 'The website must start with https://.');
  if (!(input.tone in TONES)) throw new HttpError(400, 'Choose a tone preset.');
  if (!(input.detail in DETAIL)) throw new HttpError(400, 'Choose an answer detail level.');
  if (typeof input.guidance !== 'string' || input.guidance.length > 4000) throw new HttpError(400, 'Guidance must be at most 4,000 characters.');
  return { business_profile: profile, tone: input.tone, detail: input.detail, guidance: input.guidance.trim() };
}

// ---- Answers ---------------------------------------------------------------------------------------------
/** Assistant messages whose cited documents were retired, unpublished or moved out of scope are withdrawn. */
async function present(ctx, conversation, messages) {
  const ids = messages.filter((m) => m.role === 'assistant').map((m) => m.id);
  const citations = ids.length
    ? check(await ctx.db.from('vexbot_citations').select('message_id,document_id,excerpt,vexbot_documents(title,status,workspace_id)').in('message_id', ids))
    : [];
  return messages.map((message) => {
    if (message.role === 'user') return { id: message.id, role: 'user', content: message.content, attachments: message.attachments, created_at: message.created_at };
    const own = citations.filter((c) => c.message_id === message.id);
    const valid = own.every((c) => c.vexbot_documents?.status === 'published' && (c.vexbot_documents.workspace_id === null || c.vexbot_documents.workspace_id === conversation.workspace_id));
    if (!valid) return { id: message.id, role: 'assistant', outcome: message.outcome, withdrawn: true, content: 'This answer is no longer available because a document it relied on has been withdrawn. Ask again for a current answer.', citations: [], uses_profile: false, created_at: message.created_at };
    return {
      id: message.id, role: 'assistant', outcome: message.outcome, withdrawn: false, content: message.content, uses_profile: message.uses_profile, created_at: message.created_at,
      citations: own.map((c) => ({ document_id: c.document_id, title: c.vexbot_documents.title, excerpt: c.excerpt })),
    };
  });
}

async function gather(ctx, workspace, question, history, settings) {
  const rows = [];
  const seen = new Set();
  for (const query of retrievalQueries(question, history)) {
    if (rows.length >= 6) break;
    const matches = check(await ctx.db.rpc('vexbot_search', { workspace, question: query, max_results: 6 })) ?? [];
    for (const row of matches) {
      const key = `${row.document_id}:${row.content}`;
      if (!seen.has(key) && rows.length < 6) { seen.add(key); rows.push(row); }
    }
  }
  const sources = rows.map((row, index) => ({ id: `S${index + 1}`, document_id: row.document_id, title: row.title, content: row.content }));
  const profile = profileText(settings.business_profile);
  if (profile) sources.push({ id: 'P', document_id: null, title: 'Vexora business profile', content: profile });
  return sources;
}

/** Runs one grounded answer. Never stores anything; callers decide whether to persist. */
async function answer(ctx, { workspace, question, history, settings }) {
  const profile = settings.business_profile ?? {};
  if (!ctx.provider) return { outcome: 'unavailable', content: `Vexbot can't answer right now. ${contactText(profile)}`, cited: [], usesProfile: false };
  const sources = await gather(ctx, workspace, question, history, settings);
  let result;
  try {
    result = validateAnswer(await ctx.provider.answer({ settings, question, sources, history }), sources);
  } catch {
    return { outcome: 'unavailable', content: `Vexbot couldn't reach its answer service. Please try again shortly. ${contactText(profile)}`, cited: [], usesProfile: false };
  }
  if (!result.answered) return { outcome: 'no_answer', content: noAnswerText(profile), cited: [], usesProfile: false };
  const byDocument = new Map();
  for (const id of result.cited) {
    const source = sources.find((s) => s.id === id);
    if (source.document_id && !byDocument.has(source.document_id)) byDocument.set(source.document_id, { document_id: source.document_id, title: source.title, excerpt: source.content.slice(0, 280) });
  }
  return { outcome: 'answered', content: result.answer, cited: [...byDocument.values()], usesProfile: result.cited.includes('P') };
}

const ATTACHMENT_STATE = {
  awaiting_upload: 'did not finish uploading',
  quarantined: 'is quarantined while it is checked for malware',
  scanning: 'is quarantined while it is checked for malware',
  scan_failed: 'could not be checked yet, so it stays quarantined',
  clean: 'passed the malware check and is waiting for the Vexora team to review it',
  infected: 'was blocked by the malware check and will not be used',
  rejected: 'was rejected because its contents did not match its file type',
};

async function attachmentNote(ctx, workspace, ids) {
  if (!ids.length) return '';
  const uploads = check(await ctx.db.from('vexbot_uploads').select('id,name,status').in('id', ids).eq('workspace_id', workspace).eq('uploaded_by', ctx.user.id));
  if (uploads.length !== ids.length) throw new HttpError(400, 'An attachment is not available in this workspace.');
  const lines = uploads.map((upload) => `“${upload.name}” ${ATTACHMENT_STATE[upload.status]}.`);
  return `\n\nAbout your ${uploads.length === 1 ? 'attachment' : 'attachments'}: ${lines.join(' ')} I can only use files after the team approves them for this workspace.`;
}

async function conversationFor(ctx, id) {
  const conversation = check(await ctx.db.from('vexbot_conversations').select('*').eq('id', uuid(id)).maybeSingle());
  if (!conversation || conversation.user_id !== ctx.user.id) throw new HttpError(404, 'Conversation not found.');
  await requireAccess(ctx, conversation.workspace_id);
  return conversation;
}
async function messagesOf(ctx, conversationId, limit = 200) {
  const rows = check(await ctx.db.from('vexbot_messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit));
  return rows.reverse();
}

// ---- Uploads ---------------------------------------------------------------------------------------------
async function scanUpload(ctx, upload, bytes) {
  const update = async (values) => check(await ctx.db.from('vexbot_uploads').update(values).eq('id', upload.id).select('id,name,status,status_detail,scanned_at').single());
  if (!ctx.scanner) return update({ status: 'quarantined', status_detail: 'Waiting for the malware scanner. The file stays quarantined until it is checked.' });
  await update({ status: 'scanning', status_detail: null });
  try {
    const verdict = await ctx.scanner.scan(bytes);
    if (verdict.clean) return update({ status: 'clean', status_detail: null, scanned_at: new Date().toISOString() });
    await ctx.db.storage.from(BUCKET).remove([upload.path]);
    return update({ status: 'infected', status_detail: `Blocked: ${verdict.signature || 'malware detected'}`.slice(0, 300), scanned_at: new Date().toISOString() });
  } catch {
    return update({ status: 'scan_failed', status_detail: 'The scanner could not check this file. It stays quarantined.' });
  }
}
async function download(ctx, path) {
  const blob = check(await ctx.db.storage.from(BUCKET).download(path));
  return Buffer.from(await blob.arrayBuffer());
}

// ---- Actions ---------------------------------------------------------------------------------------------
const ACTIONS = {
  async status(ctx) {
    return { provider: ctx.provider?.name ?? null, voice: Boolean(ctx.provider?.voice), scanner: ctx.scanner?.name ?? null, realtime: realtimeReadiness() };
  },

  async conversations(ctx, input) {
    const workspace = workspaceInput(ctx, input.workspace_id);
    await requireAccess(ctx, workspace);
    let query = ctx.db.from('vexbot_conversations').select('id,title,workspace_id,updated_at').eq('user_id', ctx.user.id).order('updated_at', { ascending: false }).limit(50);
    query = workspace === null ? query.is('workspace_id', null) : query.eq('workspace_id', workspace);
    return { conversations: check(await query) };
  },

  async conversation(ctx, input) {
    const conversation = await conversationFor(ctx, input.conversation_id);
    return { conversation: { id: conversation.id, title: conversation.title, workspace_id: conversation.workspace_id }, messages: await present(ctx, conversation, await messagesOf(ctx, conversation.id)) };
  },

  async ask(ctx, input) {
    const workspace = workspaceInput(ctx, input.workspace_id);
    const question = requiredText(input.question, 'question', 2000);
    const attachments = Array.isArray(input.attachments) ? [...new Set(input.attachments.map(uuid))] : [];
    if (attachments.length > 5) throw new HttpError(400, 'Attach at most five files.');
    await requireAccess(ctx, workspace);
    if (workspace === null && attachments.length) throw new HttpError(400, 'Choose a workspace to attach files.');
    const note = workspace === null ? '' : await attachmentNote(ctx, workspace, attachments);
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count, error: countError } = await ctx.db.from('vexbot_messages').select('id,vexbot_conversations!inner(user_id)', { count: 'exact', head: true }).eq('role', 'user').eq('vexbot_conversations.user_id', ctx.user.id).gte('created_at', since);
    if (countError) throw new HttpError(503, 'Usage limits could not be checked. Please try again shortly.');
    if ((count ?? 0) >= QUESTIONS_PER_HOUR) throw new HttpError(429, 'You have asked a lot of questions this hour. Please try again later or message the team.');

    let conversation;
    let history = [];
    if (input.conversation_id) {
      conversation = await conversationFor(ctx, input.conversation_id);
      if (conversation.workspace_id !== workspace) throw new HttpError(400, 'This conversation belongs to another workspace.');
      // Withdrawn answers are not fed back to the model.
      history = selectHistory(await present(ctx, conversation, await messagesOf(ctx, conversation.id)));
    } else {
      conversation = check(await ctx.db.from('vexbot_conversations').insert({ workspace_id: workspace, user_id: ctx.user.id, title: question.replace(/\s+/g, ' ').slice(0, 80) }).select('*').single());
    }
    const settings = await loadSettings(ctx);
    const result = await answer(ctx, { workspace, question, history, settings });
    const asked = check(await ctx.db.from('vexbot_messages').insert({ conversation_id: conversation.id, role: 'user', content: question, attachments }).select('*').single());
    const reply = check(await ctx.db.from('vexbot_messages').insert({ conversation_id: conversation.id, role: 'assistant', content: (result.content + note).slice(0, 20000), outcome: result.outcome, uses_profile: result.usesProfile }).select('*').single());
    if (result.cited.length) check(await ctx.db.from('vexbot_citations').insert(result.cited.map((c) => ({ message_id: reply.id, document_id: c.document_id, excerpt: c.excerpt }))));
    check(await ctx.db.from('vexbot_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversation.id));
    const [user, assistant] = await present(ctx, conversation, [asked, reply]);
    return { conversation: { id: conversation.id, title: conversation.title, workspace_id: conversation.workspace_id }, messages: [user, assistant], contact: { email: settings.business_profile?.contact_email ?? null, phone: settings.business_profile?.contact_phone ?? null } };
  },

  async transcribe(ctx, input) {
    const workspace = workspaceInput(ctx, input.workspace_id);
    await requireAccess(ctx, workspace);
    if (!ctx.provider?.voice) throw new HttpError(503, 'Voice is not available right now. You can type instead.');
    const mime = String(input.mime || '').split(';')[0];
    if (!AUDIO_TYPES.includes(mime) || typeof input.audio !== 'string') throw new HttpError(400, 'Unsupported recording.');
    const audio = Buffer.from(input.audio, 'base64');
    if (!audio.length || audio.length > MAX_AUDIO_BYTES) throw new HttpError(400, 'Recordings must be under one minute.');
    try {
      return { text: (await ctx.provider.transcribe(audio, mime)).slice(0, 2000) };
    } catch {
      throw new HttpError(502, 'That recording could not be transcribed. You can try again or type instead.');
    }
  },

  async speech(ctx, input) {
    const message = check(await ctx.db.from('vexbot_messages').select('*').eq('id', uuid(input.message_id)).maybeSingle());
    if (!message || message.role !== 'assistant') throw new HttpError(404, 'Answer not found.');
    const conversation = await conversationFor(ctx, message.conversation_id);
    const [shown] = await present(ctx, conversation, [message]);
    if (shown.withdrawn) throw new HttpError(410, 'This answer is no longer available, so it will not be read aloud.');
    if (!ctx.provider?.voice) throw new HttpError(503, 'Spoken replies are not available right now.');
    try {
      const { audio, mime } = await ctx.provider.speak(shown.content.slice(0, 4000));
      return { audio: audio.toString('base64'), mime };
    } catch {
      throw new HttpError(502, 'The spoken reply could not be created. The text answer is still available.');
    }
  },

  async upload_create(ctx, input) {
    const purpose = input.purpose;
    if (!['workspace', 'knowledge', 'attachment'].includes(purpose)) throw new HttpError(400, 'Invalid upload purpose.');
    const file = declaredFile(input);
    let workspace;
    if (purpose === 'knowledge') {
      requireMfa(ctx);
      workspace = input.workspace_id ? uuid(input.workspace_id) : null;
      if (workspace) check(await ctx.db.from('portal_clients').select('id').eq('id', workspace).single());
    } else {
      workspace = uuid(input.workspace_id);
      await requireAccess(ctx, workspace, 'write');
    }
    const id = randomUUID();
    const path = `${workspace ?? 'business'}/${id}/${file.safeName}`;
    check(await ctx.db.from('vexbot_uploads').insert({ id, workspace_id: workspace, uploaded_by: ctx.user.id, purpose, name: file.name, path, mime_type: file.mime, size_bytes: file.size }));
    const signed = check(await ctx.db.storage.from(BUCKET).createSignedUploadUrl(path));
    return { upload_id: id, path, token: signed.token };
  },

  async upload_complete(ctx, input) {
    const upload = check(await ctx.db.from('vexbot_uploads').select('*').eq('id', uuid(input.upload_id)).maybeSingle());
    if (!upload || upload.uploaded_by !== ctx.user.id) throw new HttpError(404, 'Upload not found.');
    if (upload.workspace_id) await requireAccess(ctx, upload.workspace_id, 'write');
    else requireMfa(ctx);
    if (upload.status !== 'awaiting_upload') throw new HttpError(409, 'This upload has already been processed.');
    let bytes;
    try {
      bytes = await download(ctx, upload.path);
    } catch {
      throw new HttpError(400, 'The file did not finish uploading. Please try again.');
    }
    const problem = bytes.length !== Number(upload.size_bytes) ? 'The uploaded size does not match.' : sniff(bytes, upload.mime_type);
    if (problem) {
      await ctx.db.storage.from(BUCKET).remove([upload.path]);
      return { upload: check(await ctx.db.from('vexbot_uploads').update({ status: 'rejected', status_detail: problem }).eq('id', upload.id).select('id,name,status,status_detail,scanned_at').single()) };
    }
    return { upload: await scanUpload(ctx, upload, bytes) };
  },

  async upload_rescan(ctx, input) {
    requireAdmin(ctx);
    const upload = check(await ctx.db.from('vexbot_uploads').select('*').eq('id', uuid(input.upload_id)).single());
    if (!['quarantined', 'scan_failed'].includes(upload.status)) throw new HttpError(409, 'Only quarantined files can be rescanned.');
    await audit(ctx, 'upload.rescan', upload.id);
    return { upload: await scanUpload(ctx, upload, await download(ctx, upload.path)) };
  },

  async upload_url(ctx, input) {
    const upload = check(await ctx.db.from('vexbot_uploads').select('*').eq('id', uuid(input.upload_id)).maybeSingle());
    if (!upload) throw new HttpError(404, 'Upload not found.');
    if (upload.workspace_id) await requireAccess(ctx, upload.workspace_id);
    else requireAdmin(ctx);
    if (upload.status !== 'clean') throw new HttpError(409, 'Only files that passed the malware check can be opened.');
    return { url: check(await ctx.db.storage.from(BUCKET).createSignedUrl(upload.path, 300, { download: upload.name })).signedUrl };
  },

  async document_create(ctx, input) {
    requireMfa(ctx);
    const title = requiredText(input.title, 'title', 160);
    const workspace = input.workspace_id ? uuid(input.workspace_id) : null;
    if (workspace) check(await ctx.db.from('portal_clients').select('id').eq('id', workspace).single());
    let content = typeof input.content === 'string' ? input.content.slice(0, 200000) : '';
    let note = '';
    let uploadId = null;
    if (input.upload_id) {
      const upload = check(await ctx.db.from('vexbot_uploads').select('*').eq('id', uuid(input.upload_id)).single());
      if (upload.status !== 'clean') throw new HttpError(409, 'Only files that passed the malware check can become knowledge.');
      // A client's file may only ever inform answers in that client's own workspace.
      if (upload.workspace_id && upload.workspace_id !== workspace) throw new HttpError(400, "A client's upload can only become knowledge for that client's workspace.");
      uploadId = upload.id;
      if (!content) ({ text: content, note } = await extractText(await download(ctx, upload.path), upload.mime_type).catch(() => ({ text: '', note: 'Text extraction failed. Paste the reviewed text instead.' })));
    }
    const document = check(await ctx.db.from('vexbot_documents').insert({ title, workspace_id: workspace, upload_id: uploadId, content, created_by: ctx.user.id }).select('*').single());
    await audit(ctx, 'document.create', document.id, { workspace_id: workspace, upload_id: uploadId });
    return { document, note };
  },

  async document_update(ctx, input) {
    requireMfa(ctx);
    const current = check(await ctx.db.from('vexbot_documents').select('status').eq('id', uuid(input.id)).single());
    if (!['draft', 'in_review'].includes(current.status)) throw new HttpError(409, 'Only drafts and documents in review can be edited.');
    const title = requiredText(input.title, 'title', 160);
    if (typeof input.content !== 'string' || input.content.length > 200000) throw new HttpError(400, 'Invalid document text.');
    const document = check(await ctx.db.from('vexbot_documents').update({ title, content: input.content }).eq('id', input.id).select('*').single());
    await audit(ctx, 'document.update', document.id);
    return { document };
  },

  async document_status(ctx, input) {
    requireMfa(ctx);
    const document = check(await ctx.db.from('vexbot_documents').select('*').eq('id', uuid(input.id)).single());
    const allowed = { draft: ['in_review'], in_review: ['draft', 'published'], published: ['retired'], retired: ['draft'] };
    if (!allowed[document.status]?.includes(input.to)) throw new HttpError(409, `A ${document.status.replace('_', ' ')} document cannot move to ${String(input.to).replace('_', ' ')}.`);
    const passages = input.to === 'published' ? chunk(document.content) : null;
    if (input.to === 'published' && !passages.length) throw new HttpError(409, 'Add reviewed text before publishing.');
    check(await ctx.db.rpc('vexbot_set_status', { document: document.id, next: input.to, actor: ctx.user.id, passages }));
    await audit(ctx, `document.${input.to}`, document.id);
    return { document: check(await ctx.db.from('vexbot_documents').select('*').eq('id', document.id).single()) };
  },

  async settings_save(ctx, input) {
    requireMfa(ctx);
    const values = settingsInput(input);
    const settings = check(await ctx.db.from('vexbot_settings').update({ ...values, updated_by: ctx.user.id }).eq('id', 1).select('*').single());
    await audit(ctx, 'settings.save', null, { version: settings.version });
    return { settings };
  },

  async settings_restore(ctx, input) {
    requireMfa(ctx);
    const version = Number(input.version);
    if (!Number.isInteger(version) || version < 1) throw new HttpError(400, 'Invalid version.');
    const row = check(await ctx.db.from('vexbot_settings_history').select('snapshot').eq('version', version).single());
    const values = settingsInput(row.snapshot);
    const settings = check(await ctx.db.from('vexbot_settings').update({ ...values, updated_by: ctx.user.id }).eq('id', 1).select('*').single());
    check(await ctx.db.from('vexbot_settings_history').update({ note: `Restored version ${version}` }).eq('version', settings.version));
    await audit(ctx, 'settings.restore', null, { from: version, version: settings.version });
    return { settings };
  },

  async preview(ctx, input) {
    requireAdmin(ctx);
    const workspace = input.workspace_id ? uuid(input.workspace_id) : null;
    const question = requiredText(input.question, 'question', 2000);
    const settings = input.settings ? settingsInput(input.settings) : await loadSettings(ctx);
    const result = await answer(ctx, { workspace, question, history: [], settings });
    return { outcome: result.outcome, content: result.content, citations: result.cited, uses_profile: result.usesProfile };
  },
};

export function createHandler({ getDatabase = database, getProvider = () => createProvider(), getScanner = () => createScanner() } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try {
      method(req, ['POST']);
      const db = getDatabase();
      const { user, profile } = await authenticate(req, db);
      const token = claims(req);
      const ctx = { db, user, profile, admin: profile.role === 'admin', iat: Number(token.iat) || 0, aal: token.aal, provider: getProvider(), scanner: getScanner() };
      const input = req.body && typeof req.body === 'object' ? req.body : {};
      const action = Object.hasOwn(ACTIONS, input.action) ? ACTIONS[input.action] : null;
      if (!action) throw new HttpError(400, 'Unknown action.');
      return res.status(200).json(await action(ctx, input));
    } catch (error) {
      return respondError(res, error);
    }
  };
}
