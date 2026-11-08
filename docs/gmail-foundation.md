# Google Workspace Gmail foundation

This is a **local, disabled foundation** for Vexora Client Portal. No mailbox has been connected, OAuth consent requested, Google API activated, remote migration applied, production setting changed or deployment performed in this phase. `.env.local` has not been edited. The proposed migration requires explicit approval before any remote use.

## Existing architecture and boundaries

The app uses React/Vite, Supabase Auth and RLS, and Vercel Node functions. `portal_profiles` has only `admin` and `client` roles. A `portal_clients.id` is the client's profile/Auth identity and the workspace ownership key. There are no organisation, project, service or enquiry tables. Company is a text field, not an organisation/tenant key.

The existing `portal_messages`/`portal_conversations` are portal chat, not Gmail records. Client questions create `portal_email_jobs` in the database transaction. `/api/notifications` performs immediate delivery or scheduled retry; the current transport uses the Resend REST API and has no Resend SDK dependency. The new provider adapter preserves this behaviour when `EMAIL_DELIVERY_PROVIDER` is unset or `resend`.

Client creation uses `auth.admin.createUser` with an administrator-issued initial password and confirmed email. It does not send an invitation email. Credential recovery uses `auth.admin.updateUserById`; there is no self-service reset UI. Supabase Auth owns authentication email delivery if confirmation, invitations or recovery email flows are later enabled. No Google OAuth/Gmail implementation existed before this foundation.

| Workflow                                                      | Delivery owner                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Current account provisioning/managed recovery                 | Supabase Auth admin API; password shared securely by administrator, no app email                |
| Future Auth invitations, confirmations, password-reset emails | Supabase Auth and its separately configured email/SMTP provider                                 |
| Portal question notifications                                 | Explicit application provider: existing Resend or a separately approved Gmail SYSTEM connection |
| Future customer replies                                       | A scoped, authorised Gmail mailbox with responder permission and human send approval            |

Connecting Gmail does **not** configure Supabase Auth SMTP. The Gmail adapter is not SMTP and does not replace Supabase's delivery configuration.

## Modules and routes

- `server/mail/config.mjs`: disabled-by-default activation, strict redirect/mailbox configuration and minimal scope mapping.
- `server/mail/security.mjs`: AES-256-GCM credential encryption with organisation/connection-bound authenticated data, key IDs and rotation; signed, expiring OAuth state.
- `server/mail/oauth.mjs`: Google's official `google-auth-library`, confidential web-server OAuth, PKCE, offline refresh access, single-use intent and cookie binding, mailbox identity validation, token rotation, reconnect/revocation and disconnect.
- `server/mail/gmail.mjs`: fixed-origin official Gmail REST endpoints for profile, messages, threads, labels, attachments, read/label modification, sending and RFC-compliant plain-text replies. Normalisation stores selected metadata rather than raw HTML/attachments.
- `server/mail/repository.mjs`: scoped server access checks, credential/intent RPCs, sync commits, assignment, manual client links and explicitly approved/revocable client snapshots.
- `server/mail/sync.mjs`: one bounded full/incremental sync page per invocation. No watchers, schedulers or background API requests are registered.
- `server/mail/service.mjs`: wiring and designated-system-mailbox notification delivery. It never selects a staff mailbox automatically.
- `server/email/providers.mjs`: explicit provider selection; Gmail selection does not require a Resend key. `disabled` rejects delivery before claiming outbox jobs.
- `server/mail/contracts.ts`: future dashboard/query and human-reviewed AI suggestion boundaries. No AI provider or automatic action is implemented.
- `/api/gmail/connect` POST, `/callback` GET, `/status` GET and `/disconnect` POST are inert unless explicitly enabled. They return `503 gmail_foundation_disabled` before any database/provider call by default. No navigation links or inbox UI were added.

## Proposed data model

`supabase/migrations/20261107113547_gmail_foundation.sql` is additive and **unapplied**. It creates only integration-owned objects; it does not alter existing portal roles/tables, chat, Storage or notification jobs.

| Object                              | Purpose and visibility                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `portal_mail_organisations`         | Owning business boundary; initial `vexora` row                                                                                 |
| `portal_mail_memberships`           | Explicit reader/responder/manager membership                                                                                   |
| `portal_mail_client_scopes`         | Each existing workspace belongs to at most one mail organisation                                                               |
| `portal_mail_connections`           | Mailbox, capabilities/scopes, health, sync version/checkpoint, credential reference; internal only                             |
| `portal_mail_threads`               | Provider thread key scoped to organisation and connection                                                                      |
| `portal_mail_messages`              | Provider IDs, sender/recipients, subject/preview, timestamps, labels/unread/deletion state, attachment metadata; internal only |
| `portal_mail_client_links`          | Explicit manual/approved association to a client; does not publish any content                                                 |
| `portal_mail_assignments`           | Thread assignment to an authorised member in the same organisation                                                             |
| `portal_mail_publications`          | Approved, curated plain-text snapshots for one client; revocable, no mailbox expansion                                         |
| `portal_mail_audit`                 | Actor/action/code metadata, excluding email bodies, credentials and OAuth codes                                                |
| `portal_private.mail_credentials`   | Authenticated ciphertext only, inaccessible to browser roles                                                                   |
| `portal_private.mail_oauth_intents` | State/binder hashes and encrypted PKCE verifier, short expiry, atomic one-time consumption                                     |

Internal tables are SELECT-only for authenticated organisation members; all writes go through authorised server code. RLS additionally requires an active existing **admin** profile and a current credential issuance timestamp. A `client` profile cannot become staff by receiving a mail membership. Only the existing nominated active administrator receives initial manager membership. Adding ordinary staff roles is a separate, explicit extension to the established portal permission model; this foundation does not silently widen client permissions.

Composite foreign keys prevent cross-organisation connection/thread/message/client/assignment references even in privileged writes. Existing clients are mapped to Vexora when the proposed migration is eventually approved. Newly created clients after that point must be explicitly registered in `portal_mail_client_scopes` by an approved staff-management workflow before linking. The future multi-organisation account model must make that ownership authoritative; no organisation is inferred from an email domain or company name.

Clients cannot query Gmail connections, messages, thread links, assignments, audit records or secrets. They may only read unrevoked `portal_mail_publications` addressed to their own active workspace. Publication requires a pre-existing client link, matching source thread/message and explicit manager approval. Publications are snapshots: future internal replies and sync changes do not extend them. Email attachments are never automatically published. To share one, use a reviewed copy through the existing private workspace file workflow. Published text must be rendered as text; do not inject email HTML into the DOM.

There are no fabricated project/service/enquiry foreign keys. Add those associations only if those real domain objects are introduced later.

## OAuth and credential security

Default connection capability is `read` (`gmail.readonly`). `send` adds `gmail.send`. `manage` uses `gmail.modify` for message/label and read-state changes and subsumes redundant read/send scopes. Label creation alone maps to `gmail.labels`; the mailbox connection flow still requires read capability to verify identity and sync. Local capability gates also apply even if Google granted broader scopes. The unrestricted `https://mail.google.com/` scope is not requested. No service account or domain-wide delegation is used.

Connect requires the existing verified bearer session, an active admin profile and mail-organisation manager membership. State is signed with a separate random 32-byte key and expires after ten minutes. The server stores a state hash, cookie-binding hash, actor/org/connection and encrypted PKCE verifier. Callback checks signature/expiry, atomically consumes the matching intent, rechecks current actor permissions and validates the exact configured mailbox. The binding cookie is HttpOnly, Secure, SameSite=Lax, limited to `/api/gmail`, and cleared on callback. OAuth codes and tokens must not appear in logs or error responses; server/proxy access logs should redact callback query strings before activation.

Refresh tokens are encrypted with AES-256-GCM and fresh IVs, bound to organisation, connection and purpose. The active key ID is recorded in the envelope. Access tokens remain in server memory only. Refresh obtains a server-only two-minute database lease, re-encrypts with the active key and persists a returned rotated refresh token only if the lease still belongs to that operation. Provider requests have bounded timeouts. Concurrent/stale refreshes cannot overwrite the current ciphertext or recreate a disconnected credential. Keep previous decryption keys until all envelopes are rewrapped. Production keys belong in server-only environment secrets or a managed secret store, not browser variables, migrations or the repository. Generate real keys only during an approved setup, not by copying test fixtures.

Revoked/expired grants move the connection to `needs_reconnect`; transient refresh errors retain reconnectable state. Disconnect attempts Google revocation, removes local ciphertext, increments the sync version and disables system sending. If Google revocation cannot be confirmed, health reports `remote_revocation_unconfirmed`; the operator must revoke the app in the Google account settings. Local disconnection still prevents future use. Message retention is separate from disconnection; it does not delete archived communications or client snapshots.

This foundation's server-only repository helpers assume a verified actor from the application authentication boundary. Any future dashboard routes must call `authenticate` and the membership/permission check on every request. Never accept an arbitrary actor ID from a browser body as proof of authorisation.

## Sync and delivery semantics

The worker captures a full-sync history anchor **before** listing messages, then commits pages atomically with their checkpoints. A unique organisation/connection/provider-message key makes replay idempotent. An optimistic `sync_version` check rejects concurrent/stale commits. History cursors remain strings, preserving values beyond JavaScript's safe integer range. The durable history cursor advances only after all pages/batches have committed.

Incremental sync handles added messages, label changes and deletions. Oversized history pages become persisted batches of at most 100 messages. Expired history (`404`) resets to a full sync without discarding cached content. Interrupted requests retain the existing checkpoint. Rate limits/transient failures set an internal error code for a future scheduler/backoff policy; no scheduler is activated now. Per-request attachment retrieval stays server-side and must recheck organisation membership; this phase stores attachment metadata only.

Gmail sends are not exactly-once. A stable Message-ID helps correlation but is not an idempotency guarantee. The existing Resend idempotency header is retained. Uncertain Gmail send outcomes are held for manual review rather than blindly retried. System Gmail notification delivery additionally requires an explicitly configured organisation/connection and `allow_system_notifications=true` on that connection. Connecting a user's mailbox never enables that flag.

## Future dashboard and AI work

The future dashboard can implement Inbox/Sent, unread, mine/unassigned, client/thread filters, search and keyset pagination against the internal read model. Next-phase routes must enforce reader/responder/manager permissions, fetch bodies/attachments safely, and require confirmation for compose/reply/publication. Gmail source data is untrusted content. Search terms, AI output, send headers and attachment names require validation. Authenticated client routes must use only approved snapshots and the existing private-file rules.

`MailAiAssistant` is a server-side suggestion contract for classification, client matching, summaries, suggested replies and priority. It has no provider implementation, tools or automatic sends/client creation/publication. Every suggestion carries organisation/message context and `requiresHumanApproval: true`. The next phase must recheck permissions and source ownership when accepting a suggestion; suggestions are data, never trusted instructions.

## Exact steps before a live connection

1. Review this local code/migration and approve the intended migration target. Inspect current remote tables/policies and confirm no name conflicts before applying it; run security advisors afterwards. Do not apply it as part of an unrelated automatic deployment.
2. Select Vexora's existing Google Cloud project. Do not create another project automatically. In the approved project, enable the Gmail API only when authorised for the connection phase.
3. Configure the consent audience (internal Workspace where eligible), application details, support contacts and smallest initial scopes. Google classifies Gmail scopes as sensitive/restricted; check current verification and security-assessment obligations before choosing a public/external audience. Do not request production consent in this phase.
4. Create confidential **Web application** OAuth client credentials in that approved project. Add the exact HTTPS URI `https://<approved-portal-host>/api/gmail/callback`. Avoid wildcard preview redirects. Use an approved stable test host with HTTPS for the initial connection.
5. Populate server-only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, exact `GMAIL_EXPECTED_MAILBOX` and `GMAIL_ALLOWED_DOMAIN`. Generate distinct random 32-byte encryption/state keys; set `GMAIL_TOKEN_ENCRYPTION_KEYS` (JSON key-ID map), `GMAIL_ACTIVE_KEY_ID` and `GMAIL_STATE_SIGNING_KEY` in the existing secret configuration. Do not add unverified values to `.env.local`.
6. Review initial mail-organisation memberships and client scopes. Keep clients out of internal mail membership. Preserve existing portal roles and account workflows.
7. Review access-log query redaction, deployment protection, callback cookies, error monitoring, retention, key backup/rotation and disconnect/revocation procedures. Approve enabling `GMAIL_INTEGRATION_ENABLED=true` in the intended test environment only.
8. Using an approved manager session, initiate POST `/api/gmail/connect` with the intended organisation ID and `capabilities: ["read"]`. The authorised owner completes Google consent for the exact configured mailbox. Verify status without exposing any token in the browser.
9. Invoke one sync page at a time through an approved server job. Verify deduplication, cursor recovery, concurrent-worker rejection, 401/429 handling, revocation, tenant isolation and client invisibility using authorised test messages. Do not seed a fake inbox or expose incomplete navigation.
10. Separately approve incremental capabilities (`send`, `manage` or label creation), staff access and the future dashboard. For system notifications, explicitly select the designated system mailbox and sender flag; choose `EMAIL_DELIVERY_PROVIDER=gmail` only then. Leave Supabase Auth SMTP separately configured and tested.
11. Re-run account/authentication, existing Resend notification, Gmail scope/refresh/revoke, private client and publication tests. Obtain approval for commits, push, deployment, production migration and live-mailbox connection as required by the user's phase boundary.

## References

- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Official Node OAuth library](https://docs.cloud.google.com/nodejs/docs/reference/google-auth-library/latest)
- [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Full and incremental synchronisation](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Thread/reply requirements](https://developers.google.com/workspace/gmail/api/guides/threads)

Tests use mocked Google transports and ephemeral local PostgreSQL/PGlite. They never connect to a live mailbox or apply the proposed migration remotely.
