import { MailError } from './security.mjs';
import { SCOPES } from './config.mjs';
const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
export class GmailApi {
  constructor({ accessToken, fetcher = fetch, capabilities = ['read'], grantedScopes = [] }) {
    this.accessToken = accessToken;
    this.fetcher = fetcher;
    this.capabilities = capabilities;
    this.grantedScopes = grantedScopes;
  }
  require(capability) {
    const needed = SCOPES[capability];
    if (
      !this.capabilities.includes(capability) ||
      !(
        this.grantedScopes.includes(needed) ||
        (capability !== 'labels' && this.grantedScopes.includes(SCOPES.manage)) ||
        (capability === 'labels' && this.grantedScopes.includes(SCOPES.manage))
      )
    )
      throw new MailError('gmail_capability_not_granted', 403);
  }
  async request(path, { query = {}, body, method = 'GET', token } = {}) {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(query))
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    try {
      const response = await this.fetcher(url, {
        method,
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${token || (await this.accessToken())}`,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        if (method === 'POST' && path === '/messages/send' && response.status >= 500)
          throw new MailError('gmail_delivery_uncertain', 503);
        const code =
          response.status === 401
            ? 'gmail_reconnect_required'
            : response.status === 404
              ? 'gmail_not_found'
              : response.status === 429
                ? 'gmail_rate_limited'
                : 'gmail_request_failed';
        throw new MailError(code, response.status);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof MailError) throw error;
      throw new MailError(
        method === 'POST' && path === '/messages/send'
          ? 'gmail_delivery_uncertain'
          : 'gmail_unavailable',
        503,
      );
    }
  }
  profile() {
    this.require('read');
    return this.request('/profile');
  }
  listMessages({ pageToken, q, maxResults = 100 } = {}) {
    this.require('read');
    return this.request('/messages', {
      query: { pageToken, q, maxResults: Math.min(100, Math.max(1, maxResults)) },
    });
  }
  getMessage(id) {
    this.require('read');
    return this.request(`/messages/${encodeURIComponent(id)}`, { query: { format: 'full' } });
  }
  getThread(id) {
    this.require('read');
    return this.request(`/threads/${encodeURIComponent(id)}`, { query: { format: 'full' } });
  }
  history({ startHistoryId, pageToken }) {
    this.require('read');
    if (!/^\d+$/.test(startHistoryId)) throw new MailError('invalid_history_cursor');
    return this.request('/history', { query: { startHistoryId, pageToken, maxResults: 100 } });
  }
  listLabels() {
    this.require('read');
    return this.request('/labels');
  }
  createLabel(name) {
    this.require('labels');
    return this.request('/labels', { method: 'POST', body: { name } });
  }
  modifyMessage(id, { addLabelIds = [], removeLabelIds = [] }) {
    this.require('manage');
    return this.request(`/messages/${encodeURIComponent(id)}/modify`, {
      method: 'POST',
      body: { addLabelIds, removeLabelIds },
    });
  }
  attachment(messageId, attachmentId) {
    this.require('read');
    return this.request(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
  }
  send({ raw, threadId }) {
    this.require('send');
    return this.request('/messages/send', {
      method: 'POST',
      body: { raw, ...(threadId ? { threadId } : {}) },
    });
  }
}
export async function mailboxProfile(accessToken, fetcher = fetch) {
  const api = new GmailApi({
    accessToken: async () => accessToken,
    fetcher,
    capabilities: ['read'],
    grantedScopes: [SCOPES.read],
  });
  return api.profile();
}
export function normaliseMessage(message) {
  if (
    typeof message.id !== 'string' ||
    !message.id ||
    typeof message.threadId !== 'string' ||
    !message.threadId
  )
    throw new MailError('invalid_gmail_message');
  const headers = message.payload?.headers || [];
  const header = (name) =>
    headers
      .filter((h) => h.name?.toLowerCase() === name)
      .map((h) => String(h.value || ''))
      .join(', ');
  const attachments = [];
  const walk = (part, depth = 0) => {
    if (depth > 20) throw new MailError('gmail_payload_too_deep');
    if (part.filename && part.body?.attachmentId)
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId,
      });
    for (const child of part.parts || []) walk(child, depth + 1);
  };
  if (message.payload) walk(message.payload);
  const timestamp = Number(message.internalDate);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 8640000000000000)
    throw new MailError('invalid_gmail_timestamp');
  return {
    provider_message_id: message.id,
    provider_thread_id: message.threadId,
    sender: header('from'),
    recipients: [header('to'), header('cc')].filter(Boolean),
    subject: header('subject'),
    preview: String(message.snippet || '').slice(0, 2000),
    received_at: new Date(timestamp).toISOString(),
    label_ids: message.labelIds || [],
    is_unread: message.labelIds?.includes('UNREAD') || false,
    history_id: message.historyId ? String(message.historyId) : null,
    attachment_metadata: attachments,
  };
}
export function plainTextMime({ from, to, subject, text, messageId, inReplyTo, references = [] }) {
  const address = (value) => {
    if (typeof value !== 'string' || !/^[-+.\w]+@[-.\w]+$/.test(value))
      throw new MailError('invalid_email_address');
    return value;
  };
  if (
    !Array.isArray(to) ||
    !to.length ||
    to.length > 20 ||
    typeof text !== 'string' ||
    text.length > 100000
  )
    throw new MailError('invalid_outgoing_email');
  for (const value of [subject, messageId, inReplyTo, ...references])
    if (value !== undefined && (typeof value !== 'string' || /[\r\n]/.test(value)))
      throw new MailError('invalid_email_header');
  const headers = [
    `From: ${address(from)}`,
    `To: ${to.map(address).join(', ')}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject || '').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  if (messageId) headers.push(`Message-ID: ${messageId}`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references.length) headers.push(`References: ${references.join(' ')}`);
  return Buffer.from(
    `${headers.join('\r\n')}\r\n\r\n${Buffer.from(text).toString('base64')}`,
  ).toString('base64url');
}
