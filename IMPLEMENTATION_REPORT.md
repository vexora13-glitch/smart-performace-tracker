# Phase 1 implementation report

Updated: 8 November 2026 (Pacific/Auckland).

The portal is implemented and its administrator/client workflows are verified against the hosted Supabase project and a real Vercel preview. Email provider activation and the approved production release remain outstanding.

## Database connection and migration

- Intended project: **Portal**, `ccxkaqbajugimmtsztif`, ap-southeast-2. CLI authentication is now authorised, and the repository is linked to this project.
- The local URL and anon key match the intended project; Auth responds successfully. The previous Smart Performance project was not used.
- Before migration, inspection found no public application tables, migration history, Storage buckets/objects or Auth users. No pre-existing data needed removal.
- Reviewed dry run contained only `20261107101815_client_portal.sql`. It was applied successfully, and the local/remote migration history matches.
- All eight portal tables have RLS enabled; 19 policies cover application rows and Storage. Foreign keys, indexes, grants and RPC security modes were checked on the hosted database.
- The `portal-private` bucket is private, has a 50 MB file limit and the reviewed MIME allowlist. Real document upload/download and cross-client Storage denial passed.
- The six historical Smart Performance migrations were removed from the active sequence in the earlier implementation pass. No historical remote database or stored objects were deleted.

## Authentication and administrator

Email/password authentication is enabled, public signup is disabled, minimum password length is 12 with uppercase/lowercase/digit requirements, and the site URL points to the portal preview. Only the declared Auth settings were changed; unrelated hosted settings were retained. The production site URL can be set during the approved release.

`allan@vexoradigital.com` was created and confirmed through the admin API, assigned an active administrator profile and successfully used for real browser login and account management. The initial credential is encrypted with Windows DPAPI in ignored `artifacts/portal-admin.dpapi.local`. Retrieve it locally with `scripts/show-admin-credential.ps1 -Show`; it has not been printed in chat, committed or retained in plaintext files.

The final hosted advisor check found no database/RLS/performance issues at warning/error level. One Auth advisory remains: leaked-password protection is disabled. Supabase documents this feature as available on Pro and above; no plan or billing changes were made. Application and Auth password-strength requirements are enforced. [Supabase password-security documentation](https://supabase.com/docs/guides/auth/password-security).

## Implemented functionality

Shared login and authoritative roles; administrator dashboard; client creation, details, access control and managed credential recovery; private workspaces; documents/videos and published updates; two-way messaging with unread/read status; conversation archiving/reopening; transactional email queue with immediate delivery attempt and scheduled retries; responsive desktop/mobile UI; security headers; CI and operational documentation. The old application functionality is removed.

## Verification results

| Check                                               | Result                         |
| --------------------------------------------------- | ------------------------------ |
| TypeScript, Oxlint and production build             | Passed                         |
| Node/API/PostgreSQL tests                           | 25 passed                      |
| Isolated Chromium UI workflow tests                 | 4 passed                       |
| Dependency audit                                    | 0 vulnerabilities              |
| Hosted backend workflow groups                      | 9 passed                       |
| Full deployed browser workflow groups               | 8 passed                       |
| Migration history and remote RLS/Storage inspection | Passed                         |
| Public signup disabled and anonymous table denial   | Verified                       |
| Actual email receipt                                | Pending provider configuration |

The nine hosted backend groups cover administrator login/role; administrator-issued client accounts and workspaces; cross-client/role-escalation rejection; scoped updates; private document access; messages/outbox/read receipts; archive/reopen; disabled-client access and password recovery; sign-out.

The eight real preview browser groups cover administrator login; creating a client through the deployed Vercel API; document upload/update publication; generated playable WebM upload; client initial-password login, document download and video playback; persisted client question and pending-email notice; administrator reply/archive; client reading the reply/archive on mobile. The browser used the deployed app, real hosted Auth/database and private Storage, with no network fixtures. No page errors were observed in the completed run.

Validation accounts/files/messages are retained for review. All six validation accounts created during the checks are disabled. No remote rows, users or Storage objects were deleted. Test credentials are encrypted locally. Evidence is in ignored `artifacts/live-results.json`, `artifacts/live-preview-results.json` and `artifacts/live-preview-client-mobile.png`. Earlier browser harness failures were corrected by waiting for sign-out and generating an animated video with a valid playback duration; the complete rerun passed.

## GitHub and Vercel

- Repository: `vexora13-glitch/smart-performace-tracker`; development branch: `portal`; [draft PR #1](https://github.com/vexora13-glitch/smart-performace-tracker/pull/1) targets `main`.
- Existing Vercel project: `smart-performace-tracker`, `prj_zu9PLowasAyC4DgrpFoUiKlhhS80`, team `vexoranz`.
- Current verified preview: [Vexora Client Portal](https://smart-performace-tracker-cirkdbyf5-vexoranz.vercel.app), deployment `dpl_n6Qs62vam3ZwxUpGhfG1Pp2jD193`, Ready, Preview target. The deployed application source corresponds to `1d54d69`; subsequent commits update operational checks, Auth configuration and documentation.
- Development uses the new Supabase public configuration. Development and Preview have the intended server-only Supabase credential and cron secret. The direct preview explicitly receives the new public URL/key at build and runtime.
- Generic shared Preview/Production public settings remain unchanged. The existing Vercel project has no Git connection, so connecting deployment automation remains a release configuration task. No new infrastructure was created.
- Production deployment and `main` have not been changed or merged.

## Remaining requirements

1. Supply an existing email provider configuration. The implemented Resend adapter needs `RESEND_API_KEY` and a verified `NOTIFICATION_FROM`. No provider account/domain was created. Questions are durably queued and the app reports pending delivery; actual email receipt is not yet verified.
2. After provider setup, configure the preview and verify a real notification to `allan@vexoradigital.com`. Retained validation jobs are held with `available_at = infinity` so enabling email does not send a test backlog; explicitly requeue one for delivery verification. The current retry cron is daily; a more frequent schedule requires an eligible Vercel plan.
3. Review the Auth leaked-password advisory against the existing plan. No paid feature has been enabled automatically.
4. After explicit release approval: configure production public/server/email variables for the new database; set the intended production Auth site URL; connect Git automation as appropriate; merge the reviewed PR; deploy the existing production project and verify replacement. Do not promote while email configuration remains incomplete.

Operational limits remain 50 MB per file, one-hour signed video links, visible-tab polling every 15 seconds, small-portfolio loading and the email provider's finite idempotency retention. Existing downloads cannot be recalled. See `README.md` for setup, security details and verification commands.
