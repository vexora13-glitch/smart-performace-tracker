# Vexora Client Portal — Gmail foundation completion report

Date: 8 November 2026 (Pacific/Auckland).

**Status:** implemented locally, disabled by default, uncommitted and undeployed. No live mailbox connection, Google API activation, OAuth consent, production data mutation or remote migration was performed. No infrastructure was created. `.env.local` was not edited.

## Audit findings

The intended repository is `D:\Projects\smart-performance-tracker`, branch `portal`, remote `vexora13-glitch/smart-performace-tracker`. The existing React/Vite, Supabase, Vercel and account architecture is retained.

The local baseline migration and a read-only hosted PostgREST schema inspection confirm eight existing portal tables: profiles, clients, chat conversations/messages/receipts, announcements, files and notification jobs. Profiles support `admin` and `client`; each client's profile ID is its workspace owner. There are no organisation, project, service or enquiry entities. No Private Sale-specific schema or functionality was introduced.

Management-CLI schema inspection returned 403 in this phase. The existing server credential successfully fetched read-only API schema metadata instead. Remote policies were not modified or revalidated by applying the new migration; the proposed policy behaviour was validated in local PostgreSQL/PGlite.

Application notifications previously called Resend REST directly from `server/notifications.mjs`; there was no Resend SDK, provider abstraction, Gmail integration or Google OAuth dependency. `portal_email_jobs` provides transactional queuing/retry. The existing configured provider remains unchanged and actual notification delivery still requires its credentials/sender.

Current client account creation and managed recovery use Supabase Auth admin APIs with administrator-issued passwords; they do not send an invitation/reset email. Supabase Auth owns any future invitation/confirmation/recovery email flows and requires its own separately configured delivery/SMTP. The local Supabase config contains no custom SMTP setup; hosted custom SMTP could not be verified through the current management account. Gmail connectivity does not configure Auth SMTP.

## Implemented components

- Official Google OAuth client library, server-side callback/connect/status/disconnect route foundation, offline access, PKCE, signed/expiring state, one-time server intent and HttpOnly/Secure browser binding.
- Exact expected-mailbox validation, minimal capability scopes, encrypted refresh-token storage with tenant/connection/purpose authentication, key IDs/rotation, refresh, reconnect and revocation/disconnect handling. Access tokens stay in memory; codes/tokens are not returned by status/error responses.
- Scoped Gmail REST client for messages, threads, labels, read-state changes, attachment retrieval and send/reply preparation. All Google responses in tests are mocked; no live Gmail account was accessed.
- Bounded full/incremental synchronisation with history anchors, string cursors, persisted pagination/batches, message deduplication, atomic row/checkpoint commits, optimistic sync-version concurrency checks, deletion metadata and recovery from expired history.
- Organisation-scoped mailbox access, thread/client links and assignments. Existing admin/client roles are preserved. Mail memberships do not turn client profiles into staff.
- Explicit, separately approved and revocable per-client communication snapshots. Linking a thread does not expose its messages; future internal replies/attachments remain private. No inbox navigation or UI was added.
- Delivery-provider abstraction retaining existing Resend behaviour, explicit `disabled`/`gmail` alternatives, designated-system-mailbox approval and conservative handling of uncertain Gmail sends. Selecting Gmail does not require `RESEND_API_KEY`.
- Future dashboard/query and AI-suggestion service contracts. No external AI provider, automatic send, client creation or publication is implemented.
- Placeholder-only Google configuration in `.env.example` and a complete future setup/runbook in `docs/gmail-foundation.md`.

## Proposed database changes

Local migration: `supabase/migrations/20261107113547_gmail_foundation.sql`, generated with the installed CLI's migration command. **Not applied remotely.**

It creates ten integration-owned public tables: organisations, memberships, client scopes, connections, threads, messages, client links, assignments, publications and audit. Two non-exposed private tables hold authenticated ciphertext and short-lived OAuth intents. All enable RLS; browser roles cannot write any of them or access credential/intent RPCs.

The initial mail organisation is Vexora. The nominated existing active administrator receives manager membership; existing client workspaces are mapped to Vexora in this proposed migration. Composite foreign keys prevent mixed-organisation references, and a client workspace can belong to only one mail organisation. There are no changes to the existing portal role constraint, working account APIs, chat tables, Storage buckets or notification-job schema.

The current portal has no ordinary staff role. Explicit reader/responder/manager mail memberships are prepared, but current runtime access additionally requires an active existing administrator. A future staff-account feature needs its own reviewed extension to the established permission model. Future projects/services must be linked only when those real domain entities exist.

## Security controls and phase limits

Mailbox records default to internal-only access. A client can only read its own active workspace's unrevoked curated publications; it cannot traverse the source mailbox, internal thread, recipients, assignments, audit trail or credentials. Attachment publication is not automatic. Privileged future routes must authenticate the session and recheck current role/organisation/operation permission on every request.

Refresh tokens use AES-256-GCM with random IVs, separate purpose-bound authenticated data and server-held key material. OAuth state uses a distinct signing key, a ten-minute expiry, PKCE, actor/organisation binding and atomic one-time consumption. Callback checks the exact configured mailbox, clears the binding cookie, rejects missing scopes/offline grants and removes local credentials after failed connection. Errors/audits contain safe codes rather than provider bodies or tokens.

Before activation, operators must configure query-string redaction for OAuth callback access logs and review retention/key custody. Sync page commits have database concurrency protection. Credential refresh uses a server-only two-minute database lease, ownership-checked completion and bounded provider timeouts; stale refreshes cannot overwrite rotated credentials or recreate a disconnected credential. Scheduler/backoff orchestration belongs to the next phase; no workers are scheduled now.

Disconnect wipes local credentials even if remote Google revocation cannot be confirmed; an explicit health code then requires operator revocation in Google account settings. Gmail does not provide an exactly-once send guarantee. Uncertain send outcomes stop automatic notification retry for human review.

## Validation

| Check                                       | Result                                             |
| ------------------------------------------- | -------------------------------------------------- |
| Existing + new Node/API/PostgreSQL tests    | 48 passed, 0 failed                                |
| Existing Chromium UI/account workflow tests | 4 passed, 0 failed                                 |
| TypeScript project check                    | Passed                                             |
| Oxlint                                      | Passed                                             |
| Production build                            | Passed                                             |
| Dependency audit                            | 0 vulnerabilities                                  |
| Proposed migration                          | Executed only in ephemeral local PostgreSQL/PGlite |
| Live Gmail / consent / send / sync          | Not performed, intentionally                       |

New tests cover tenant isolation, client-default privacy, cross-org foreign keys, inactive/client-role membership denial, encrypted secrets and rotation, OAuth tampering/replay/cookie binding/failed consent, unexpected-mailbox rejection, revoked grants, deduplication, interrupted sync, oversized history pages, stale concurrent page commits, expired history, MIME injection, disabled endpoints/provider configuration and Resend compatibility. Existing account creation/recovery and notification tests remain passing. Browser fixtures exercise the established portal without connecting Gmail.

## Next phase and exact activation prerequisites

1. Review/approve this local diff and the new migration. Resolve management-account access, inspect the intended hosted schema/policies and apply only after explicit approval; run hosted advisors afterward.
2. Select an existing approved Google Cloud project, enable Gmail API and configure the Workspace consent audience and minimum scopes. Review Google verification/security-assessment requirements before any external/public use.
3. Create confidential Web OAuth credentials and register the exact stable HTTPS `/api/gmail/callback` URI. No wildcard previews or service account/domain-wide delegation.
4. Supply verified server-only client ID/secret, redirect URI, exact mailbox/domain, independent encryption/state keys and current key ID. Grant the intended administrator mail membership. Leave Gmail disabled until connection testing is authorised.
5. Review access logs, state cookies, revocation, retention, key rotation, token-refresh worker coordination and permission enforcement. Then explicitly enable the integration in the intended test environment and have the authorised mailbox owner consent with read-only capabilities first.
6. Validate status, scoped message/thread/attachment retrieval, controlled full/incremental sync, refresh/revoke/reconnect, 401/429 recovery, deduplication and cross-client invisibility against authorised test messages.
7. Build the actual staff dashboard and authenticated client publication views in the existing theme/component system. Add approved send/manage scopes and human-confirmed reply/assignment/publication flows incrementally.
8. Separately choose transactional-notification delivery. Gmail requires explicit system connection IDs and `allow_system_notifications`; it never automatically uses a connected staff mailbox. Keep Supabase Auth SMTP independently configured and tested.
9. Obtain approval before committing, pushing, deploying, modifying production infrastructure or connecting the live mailbox. None of those actions occurred in this phase.

Detailed module paths, schema semantics, configuration variables and Google source references are in [the setup/runbook](docs/gmail-foundation.md).
