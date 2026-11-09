// The Vexbot API. One POST endpoint with an `action`. Every request is authenticated, every workspace is
// rechecked against the database on every call (including saved answers and spoken replies), and every
// knowledge or settings change requires an administrator session verified with MFA (AAL2).
import { selectHistory, retrievalQueries } from './context.mjs';
import { INTERRUPTED_VOICE_TEXT, realtimeReadiness } from './realtime.mjs';
import { randomUUID } from 'node:crypto';
import { authenticate, check, database, method, respondError } from '../runtime.mjs';
import { HttpError, id as uuid, requiredText } from '../validation.mjs';
import { pageChunks, declaredFile, extractText, sniff } from './files.mjs';
import { createProvider, providerSetup } from './provider.mjs';
import { createScanner } from './scanner.mjs';
import { contactText, DETAIL, noAnswerText, PROFILE_FIELDS, profileText, TONES, validateAnswer } from './prompt.mjs';
import { fileSources, inventory, missingTable, readableNames, readTarget, resolve, sharedPassages, uploadState } from './sources.mjs';

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
/** Rows from a table added by a later migration; empty when that migration has not been applied yet. */
async function optionalRows(query) {
  const result = await query;
  if (missingTable(result.error)) return null;
  return check(result);
}

/**
 * Assistant messages are withdrawn when a cited document was retired, unpublished or moved out of scope, or
 * a cited shared file was removed from the workspace.
 */
async function present(ctx, conversation, messages) {
  const ids = messages.filter((m) => m.role === 'assistant').map((m) => m.id);
  const [citations, fileCitations] = ids.length ? await Promise.all([
    ctx.db.from('vexbot_citations').select('message_id,document_id,excerpt,vexbot_documents(title,status,workspace_id)').in('message_id', ids).then(check),
    optionalRows(ctx.db.from('vexbot_file_citations').select('message_id,file_id,file_name,excerpt').in('message_id', ids)).then(rows => rows ?? []),
  ]) : [[], []];
  const fileIds = [...new Set(fileCitations.map((c) => c.file_id))];
  const live = new Map((fileIds.length ? check(await ctx.db.from('portal_files').select('id,workspace_id').in('id', fileIds)) : []).map((row) => [row.id, row.workspace_id]));
  return messages.map((message) => {
    if (message.role === 'user') return { id: message.id, role: 'user', content: message.content, attachments: message.attachments, created_at: message.created_at };
    const own = citations.filter((c) => c.message_id === message.id);
    const files = fileCitations.filter((c) => c.message_id === message.id);
    const documentsValid = own.every((c) => c.vexbot_documents?.status === 'published' && (c.vexbot_documents.workspace_id === null || c.vexbot_documents.workspace_id === conversation.workspace_id));
    const filesValid = files.every((c) => live.get(c.file_id) === conversation.workspace_id);
    if (!documentsValid || !filesValid) {
      const reason = documentsValid ? 'a shared file it relied on was removed from this workspace' : 'a document it relied on has been withdrawn';
      return { id: message.id, role: 'assistant', outcome: message.outcome, withdrawn: true, content: `This answer is no longer available because ${reason}. Ask again for a current answer.`, citations: [], uses_profile: false, created_at: message.created_at };
    }
    return {
      id: message.id, role: 'assistant', outcome: message.outcome, withdrawn: false, interrupted: message.content === INTERRUPTED_VOICE_TEXT, content: message.content === INTERRUPTED_VOICE_TEXT ? 'You interrupted this reply.' : message.content, uses_profile: message.uses_profile, created_at: message.created_at,
      citations: [
        ...own.map((c) => ({ kind: 'document', id: c.document_id, document_id: c.document_id, title: c.vexbot_documents.title, excerpt: c.excerpt })),
        ...files.map((c) => ({ kind: 'file', id: c.file_id, file_id: c.file_id, title: c.file_name, excerpt: c.excerpt })),
      ],
    };
  });
}

/** Passages for an ordinary question: published documents in scope, matching shared files, the profile. */
async function gather(ctx, workspace, question, history, settings, inv) {
  const rows = [];
  const seen = new Set();
  for (const query of retrievalQueries(question, history)) {
    if (rows.length >= 6) break;
    const matches = check(await ctx.db.rpc('vexbot_search', { workspace, question: query, max_results: 6 })) ?? [];
    for (const row of matches) {
      const key = `${row.document_id}:${row.content}`;
      if (!seen.has(key) && rows.length < 6) { seen.add(key); rows.push(row); }
    }
    if (rows.length) break; // Fall back to older intent only when the current query found nothing.
  }
  const passages = [
    ...rows.map((row) => ({ kind: 'document', document_id: row.document_id, file_id: null, title: row.title, content: row.content })),
    ...(inv ? await sharedPassages(ctx.db, inv, question) : []),
  ];
  const sources = passages.map((source, index) => ({ id: `S${index + 1}`, ...source }));
  const profile = profileText(settings.business_profile);
  if (profile) sources.push({ id: 'P', kind: 'profile', document_id: null, file_id: null, title: 'Vexora business profile', content: profile });
  return sources;
}

const notConfiguredText = (profile) => `Vexbot's answer service isn't switched on for this portal yet, so it can't read files or answer questions right now. ${contactText(profile)}`;
const failedText = (profile) => `Vexbot couldn't reach its answer service just now. Please try again shortly. ${contactText(profile)}`;

/**
 * Works out what a question is about and gathers its sources. Returns { reply } when the answer is a fact
 * about the files themselves (not found, still processing, unsupported, awaiting review), or { sources, notes }.
 */
async function plan(ctx, { workspace, question, history, settings, attachments, recent }) {
  const lookupStarted = performance.now();
  const inv = await inventory(ctx.db, workspace);
  if (ctx.timings) ctx.timings.catalogue = performance.now() - lookupStarted;
  const choice = resolve(question, inv, { attachments, recent });
  const listed = (names) => (names.length ? ` Files I can read here: ${names.slice(0, 12).map((name) => `“${name}”`).join(', ')}.` : ' There are no files I can read in this workspace yet.');
  if (choice.missing) return { reply: `I couldn't find a file called “${choice.missing}” in this workspace.${listed(readableNames(inv))}` };
  if (choice.ambiguous) return { reply: choice.ambiguous.length ? `Which file do you mean: ${choice.ambiguous.slice(0, 8).map(item => `“${item.alias || item.name}”`).join(', ')}?` : `There are no files I can read in this workspace yet. Files shared by Vexora appear under Shared files, and your uploads become available after they are scanned and approved.` };
  if (choice.targets) {
    const retrievalStarted = performance.now();
    const read = await Promise.all(choice.targets.map((item) => readTarget(ctx.db, item)));
    if (ctx.timings) ctx.timings.retrieval = performance.now() - retrievalStarted;
    const usable = read.filter((row) => row.content);
    const problems = read.filter((row) => row.problem).map((row) => row.problem);
    if (!usable.length) return { reply: problems.join(' ') };
    const profile = profileText(settings.business_profile);
    const sources = fileSources(usable, question);
    if (sources.some(source => source.content.includes('[The file continues beyond this point.]')))
      problems.push('This answer covers only the text available within the document processing and context limits; it is not a complete summary of the original file.');
    if (profile) sources.push({ id: 'P', kind: 'profile', document_id: null, file_id: null, title: 'Vexora business profile', content: profile });
    return { sources, notes: problems };
  }
  // An ordinary question. Unready attachments are explained after the answer.
  const notes = (choice.attached ?? []).filter((item) => item.kind === 'upload').map((item) => uploadState(item));
  return { sources: await gather(ctx, workspace, question, history, settings, workspace === null ? null : inv), notes: notes.length ? [...notes, 'I can only use uploads after they pass the malware check and the Vexora team approves them for this workspace.'] : [] };
}

/** Runs one grounded answer. Never stores anything; callers decide whether to persist. */
async function answer(ctx, { workspace, question, history, settings, attachments = [], recent = [] }) {
  const profile = settings.business_profile ?? {};
  const none = { cited: [], usesProfile: false };
  if (!attachments.length && /^(?:hi|hello|hey|kia ora|thanks|thank you)[!.\s]*$/i.test(question.trim()))
    return { outcome: 'answered', content: /thank/i.test(question) ? 'You’re welcome. Let me know what else you need.' : 'Kia ora. What would you like to know about your workspace?', ...none };
  const planned = await plan(ctx, { workspace, question, history, settings, attachments, recent });
  if (planned.reply) return { outcome: 'no_answer', content: planned.reply, ...none };
  const note = planned.notes.length ? `\n\n${planned.notes.join(' ')}` : '';
  if (!ctx.provider) return { outcome: 'unavailable', content: notConfiguredText(profile) + note, ...none };
  const { sources } = planned;
  let result;
  try {
    const started = performance.now();
    let first = false;
    result = validateAnswer(await ctx.provider.answer({ settings, question, sources, history, signal: ctx.signal,
      onDelta: ctx.emit ? async text => {
        ctx.signal.throwIfAborted();
        if (!first) { ctx.timings.first_text = performance.now() - ctx.started; first = true; }
        ctx.emit('delta', { text });
      } : undefined,
    }), sources);
    if (ctx.timings) ctx.timings.model = performance.now() - started;
  } catch (error) {
    if (ctx.signal?.aborted) throw error;
    // Status only: enough to tell a bad key (401), an unknown model (404) or a rate limit (429) apart.
    console.error(`[vexbot] answer service failed${error?.status ? ` (HTTP ${error.status})` : error?.name === 'TimeoutError' ? ' (timeout)' : ''}`);
    return { outcome: 'unavailable', content: (error?.status === 401 || error?.status === 403 ? "The answer service rejected the portal credentials. Ask the portal administrator to check its server API key and permissions." : error?.status === 429 ? "The answer service is rate limited or its quota is exhausted. Please try later; the portal administrator can check usage limits." : error?.status === 404 ? "The configured answer model is unavailable. The portal administrator needs to check the server model setting." : error?.name === "TimeoutError" ? "The answer service timed out. Please try again." : failedText(profile)) + note, ...none };
  }
  if (!result.answered) return { outcome: 'no_answer', content: noAnswerText(profile) + note, ...none };
  const cited = new Map();
  for (const id of result.cited) {
    const source = sources.find((s) => s.id === id);
    const key = source.document_id ?? source.file_id;
    if (key && !cited.has(key)) cited.set(key, { kind: source.document_id ? 'document' : 'file', id: key, document_id: source.document_id, file_id: source.file_id, title: source.title, excerpt: source.content.slice(0, 280) });
  }
  return { outcome: 'answered', content: result.answer + note, cited: [...cited.values()], usesProfile: result.cited.includes('P') };
}

/** Attachments must be the asker's own uploads in this workspace. */
async function checkAttachments(ctx, workspace, ids) {
  if (!ids.length) return;
  const uploads = check(await ctx.db.from('vexbot_uploads').select('id').in('id', ids).eq('workspace_id', workspace).eq('uploaded_by', ctx.user.id));
  if (uploads.length !== ids.length) throw new HttpError(400, 'An attachment is not available in this workspace.');
}

async function synthesise(ctx, text) {
  if (!ctx.provider?.voice) return { speech_error: 'Spoken replies are not available right now.' };
  try {
    const { audio, mime } = await ctx.provider.speak(text.slice(0, 4000));
    return { speech: { audio: audio.toString('base64'), mime } };
  } catch (error) {
    console.error(`[vexbot] speech service failed${error?.status ? ` (HTTP ${error.status})` : ''}`);
    return { speech_error: error?.status === 401 || error?.status === 403
      ? 'The speech service rejected the portal credentials. Ask the administrator to check the server API key and permissions, then retry Talk.'
      : error?.status === 429 ? 'The speech service is rate limited or out of quota. Try Talk again later.'
      : error?.status === 400 || error?.status === 404 ? 'The configured speech model or voice is unavailable. Ask the administrator to check the speech model and voice settings.'
      : error?.name === 'TimeoutError' ? 'The speech service timed out. Retry Talk.'
      : 'The spoken reply could not be created. Retry Talk or use Ask for text.' };
  }
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
    const value = { provider: ctx.provider?.name ?? null, voice: Boolean(ctx.provider?.voice), scanner: ctx.scanner?.name ?? null, realtime: realtimeReadiness() };
    if (value.realtime.available) {
      const probe = await ctx.db.from('vexbot_voice_sessions').select('id', { head: true }).limit(1);
      if (probe.error) value.realtime = { ...value.realtime, available: false, reason: 'Live voice session controls need administrator setup. Use text or recorded voice.' };
    }
    if (!ctx.admin) return value;
    // Staff see what is missing (variable names only) and whether the workspace-files migration is applied.
    const cache = await ctx.db.from('vexbot_file_text').select('file_id', { head: true, count: 'exact' });
    return { ...value, setup: { ...ctx.setup, file_index: !missingTable(cache.error) } };
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
    const authStarted = performance.now();
    await requireAccess(ctx, workspace);
    if (ctx.timings) ctx.timings.authorization = performance.now() - authStarted;
    if (workspace === null && attachments.length) throw new HttpError(400, 'Choose a workspace to attach files.');
    if (workspace !== null) await checkAttachments(ctx, workspace, attachments);
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count, error: countError } = await ctx.db.from('vexbot_messages').select('id,vexbot_conversations!inner(user_id)', { count: 'exact', head: true }).eq('role', 'user').eq('vexbot_conversations.user_id', ctx.user.id).gte('created_at', since);
    if (countError) throw new HttpError(503, 'Usage limits could not be checked. Please try again shortly.');
    if ((count ?? 0) >= QUESTIONS_PER_HOUR) throw new HttpError(429, 'You have asked a lot of questions this hour. Please try again later or message the team.');

    const [settings, state] = await Promise.all([loadSettings(ctx), (async () => {
      let conversation;
      let history = [];
      let recent = [];
      if (input.conversation_id) {
        conversation = await conversationFor(ctx, input.conversation_id);
        if (conversation.workspace_id !== workspace) throw new HttpError(400, 'This conversation belongs to another workspace.');
        // Withdrawn answers are not fed back to the model.
        const shown = await present(ctx, conversation, await messagesOf(ctx, conversation.id));
        history = selectHistory(shown);
        // Follow-ups use the latest authorised citation, rather than all historical topics.
        recent = (shown.filter((m) => m.role === 'assistant' && !m.withdrawn).at(-1)?.citations ?? []).map((c) => ({ kind: c.kind, id: c.id }));
      } else {
        conversation = check(await ctx.db.from('vexbot_conversations').insert({ workspace_id: workspace, user_id: ctx.user.id, title: question.replace(/\s+/g, ' ').slice(0, 80) }).select('*').single());
      }
      return { conversation, history, recent };
    })()]);
    const { conversation, history, recent } = state;
    const retrievalStarted = performance.now();
    const result = await answer(ctx, { workspace, question, history, settings, attachments, recent });
    if (ctx.timings) ctx.timings.answer = performance.now() - retrievalStarted;
    ctx.signal?.throwIfAborted();
    await requireAccess(ctx, workspace);
    const persistenceStarted = performance.now();
    const at = Date.now();
    // One atomic insert prevents a failed second write leaving a half-saved turn.
    const pair = check(await ctx.db.from('vexbot_messages').insert([
      { conversation_id: conversation.id, role: 'user', content: question, attachments, outcome: null, uses_profile: false, created_at: new Date(at).toISOString() },
      { conversation_id: conversation.id, role: 'assistant', content: result.content.slice(0, 20000), attachments: [], outcome: result.outcome, uses_profile: result.usesProfile, created_at: new Date(at + 1).toISOString() },
    ]).select('*'));
    const asked = pair.find(message => message.role === 'user');
    const reply = pair.find(message => message.role === 'assistant');
    const documents = result.cited.filter((c) => c.kind === 'document');
    const files = result.cited.filter((c) => c.kind === 'file');
    // Before the workspace-files migration the file citation is shown now but not kept with the answer.
    await Promise.all([
      documents.length ? ctx.db.from('vexbot_citations').insert(documents.map((c) => ({ message_id: reply.id, document_id: c.document_id, excerpt: c.excerpt }))).then(check) : null,
      files.length ? optionalRows(ctx.db.from('vexbot_file_citations').insert(files.map((c) => ({ message_id: reply.id, file_id: c.file_id, file_name: c.title, excerpt: c.excerpt })))) : null,
    ]);
    check(await ctx.db.from('vexbot_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversation.id));
    const [user, assistant] = await present(ctx, conversation, [asked, reply]);
    if (ctx.timings) ctx.timings.persistence = performance.now() - persistenceStarted;
    if (!assistant.withdrawn && files.length && !assistant.citations.some((c) => c.kind === 'file'))
      assistant.citations.push(...files.map((c) => ({ kind: 'file', id: c.file_id, file_id: c.file_id, title: c.title, excerpt: c.excerpt })));
    // Voice mode asks for the spoken reply in the same request, so it plays without a second round trip.
    if (ctx.emit) ctx.emit('answer', { conversation: { id: conversation.id }, messages: [user, assistant] });
    const spoken = input.speak === true && !assistant.withdrawn && assistant.outcome !== 'unavailable' ? await synthesise(ctx, assistant.content) : {};
    return { conversation: { id: conversation.id, title: conversation.title, workspace_id: conversation.workspace_id }, messages: [user, assistant], contact: { email: settings.business_profile?.contact_email ?? null, phone: settings.business_profile?.contact_phone ?? null }, ...spoken };
  },

  async file_index(ctx, input) {
    const workspace = workspaceInput(ctx, input.workspace_id);
    await requireAccess(ctx, workspace);
    const inv = await inventory(ctx.db, workspace);
    const file = inv.files.find(file => file.id === uuid(input.file_id));
    if (!file) throw new HttpError(404, 'File not found in this workspace.');
    const result = await readTarget(ctx.db, file);
    return { ready: Boolean(result.content), detail: result.problem ?? null };
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
    } catch (error) {
      console.error(`[vexbot] transcription service failed${error?.status ? ` (HTTP ${error.status})` : ''}`);
      throw new HttpError(502, 'That recording could not be transcribed. You can try again or type instead.');
    }
  },

  async greeting(ctx, input) {
    await requireAccess(ctx, workspaceInput(ctx, input.workspace_id));
    return synthesise(ctx, 'Hi, I’m Vexbot. How can I help you today?');
  },

  async speech(ctx, input) {
    const message = check(await ctx.db.from('vexbot_messages').select('*').eq('id', uuid(input.message_id)).maybeSingle());
    if (!message || message.role !== 'assistant') throw new HttpError(404, 'Answer not found.');
    const conversation = await conversationFor(ctx, message.conversation_id);
    const [shown] = await present(ctx, conversation, [message]);
    if (shown.withdrawn) throw new HttpError(410, 'This answer is no longer available, so it will not be read aloud.');
    if (shown.outcome === 'unavailable') throw new HttpError(409, 'This is a service error, not an answer. Retry your question.');
    if (!ctx.provider?.voice) throw new HttpError(503, 'Spoken replies are not available right now.');
    const result = await synthesise(ctx, shown.content);
    if (result.speech_error) throw new HttpError(502, result.speech_error);
    return result.speech;
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
    const passages = input.to === 'published' ? pageChunks(document.content) : null;
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

export function createHandler({ getDatabase = database, getProvider = () => createProvider(), getScanner = () => createScanner(), getSetup = () => providerSetup() } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const started = performance.now();
    const timings = {};
    const controller = new AbortController();
    let heartbeat;
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    try {
      method(req, ['POST']);
      const db = getDatabase();
      const { user, profile } = await authenticate(req, db);
      timings.authentication = performance.now() - started;
      const token = claims(req);
      const ctx = { db, user, profile, admin: profile.role === 'admin', iat: Number(token.iat) || 0, aal: token.aal, provider: getProvider(), scanner: getScanner(), setup: getSetup(), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55000)]), started, timings };
      const input = req.body && typeof req.body === 'object' ? req.body : {};
      const action = Object.hasOwn(ACTIONS, input.action) ? ACTIONS[input.action] : null;
      if (!action) throw new HttpError(400, 'Unknown action.');
      if (input.action === 'ask' && input.stream === true) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        res.on?.('close', disconnected);
        ctx.emit = (event, data) => { if (!res.destroyed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
        ctx.emit('status', { stage: 'processing' });
        heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 10000);
        const result = await action(ctx, input);
        timings.total = performance.now() - started;
        ctx.emit('result', { ...result, timings });
        return res.end();
      }
      const result = await action(ctx, input);
      if (input.action === 'ask') {
        timings.total = performance.now() - started;
        res.setHeader('Server-Timing', Object.entries(timings).map(([name, value]) => `${name};dur=${value.toFixed(1)}`).join(', '));
      }
      return res.status(200).json(result);
    } catch (error) {
      if (res.headersSent) {
        if (!res.destroyed && !res.writableEnded) { res.write(`event: error\ndata: ${JSON.stringify({ error: controller.signal.aborted ? 'Request cancelled.' : 'The reply was interrupted. Please try again.' })}\n\n`); res.end(); }
        return;
      }
      return respondError(res, error);
    } finally {
      clearInterval(heartbeat);
      res.off?.('close', disconnected);
    }
  };
}

/** Private adapter for the Realtime supervisor. Never accepts client-supplied history,
 * source ids or workspace from a model tool. It reuses the text path's visibility,
 * file resolution, withdrawal, correction and citation rules. */
export async function voiceContext(req, input, db = database()) {
  let ctx;
  const workspace = input.workspace_id == null ? null : uuid(input.workspace_id);
  const refresh = async () => {
    const { user, profile } = await authenticate(req, db);
    const token = claims(req);
    ctx = { db, user, profile, admin: profile.role === 'admin', iat: Number(token.iat) || 0, aal: token.aal };
    await requireAccess(ctx, workspaceInput(ctx, workspace));
  };
  await refresh();
  const conversation = input.conversation_id ? await conversationFor(ctx, input.conversation_id)
    : check(await db.from('vexbot_conversations').insert({ user_id: ctx.user.id, workspace_id: workspace, title: 'Voice conversation' }).select('*').single());
  if (conversation.workspace_id !== workspace) throw new HttpError(400, 'This conversation belongs to another workspace.');
  const shown = async () => { await refresh(); return present(ctx, conversation, await messagesOf(ctx, conversation.id)); };
  return {
    user: ctx.user.id, workspace, conversation, refresh,
    async evidence(sources) {
      await refresh();
      const visible = await inventory(db, workspace);
      for (const source of sources) {
        if (source.kind === 'document' && !visible.documents.some(d => d.id === source.document_id)) throw new HttpError(410, 'A referenced document was withdrawn. Ask again.');
        if (source.kind === 'file' && !visible.files.some(f => f.id === source.file_id)) throw new HttpError(410, 'A referenced file is no longer available. Ask again.');
      }
    },
    async history() { return selectHistory(await shown()); },
    async snapshot() { return { conversation, messages: await shown() }; },
    async lookup(question) {
      const [messages, settings] = await Promise.all([shown(), loadSettings(ctx)]);
      const history = selectHistory(messages);
      const recent = messages.filter(m => m.role === 'assistant' && !m.withdrawn).at(-1)?.citations ?? [];
      const result = await plan(ctx, { workspace, question: requiredText(question, 'question', 2000), history, settings, attachments: [], recent: recent.map(c => ({ kind: c.kind, id: c.id })) });
      await refresh();
      return { ...result, history, fallback: noAnswerText(settings.business_profile ?? {}) };
    },
    async userMessage(content, at = new Date().toISOString()) {
      await refresh();
      check(await db.from('vexbot_messages').insert({ conversation_id: conversation.id, role: 'user', content: requiredText(content, 'transcript', 2000), created_at: at }));
    },
    async assistantMessage(content, sources = [], interrupted = false, at = new Date().toISOString()) {
      await refresh();
      // Check evidence again immediately before persisting/displaying a voice answer.
      const row = check(await db.from('vexbot_messages').insert({ conversation_id: conversation.id, role: 'assistant', content: interrupted ? INTERRUPTED_VOICE_TEXT : content.slice(0, 20000), outcome: interrupted ? 'no_answer' : 'answered', uses_profile: !interrupted && sources.some(s => s.kind === 'profile'), created_at: at }).select('*').single());
      if (!interrupted) {
        const docs = [...new Map(sources.filter(s => s.kind === 'document').map(s => [s.document_id, s])).values()];
        const files = [...new Map(sources.filter(s => s.kind === 'file').map(s => [s.file_id, s])).values()];
        if (docs.length) check(await db.from('vexbot_citations').insert(docs.map(s => ({ message_id: row.id, document_id: s.document_id, excerpt: s.content.slice(0, 600) }))));
        if (files.length) await optionalRows(db.from('vexbot_file_citations').insert(files.map(s => ({ message_id: row.id, file_id: s.file_id, file_name: s.title, excerpt: s.content.slice(0, 600) }))));
      }
      check(await db.from('vexbot_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversation.id));
      return row.id;
    },
  };
}
