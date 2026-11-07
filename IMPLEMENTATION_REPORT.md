# Phase 1 implementation report

Date: 7 November 2026 (Pacific/Auckland).

The portal application is implemented on `portal`; live service activation is pending the configuration/access items below. This is not yet a production-ready live deployment.

## Implemented

Administrator/client login and role routing; dashboard; client creation/editing/access control and credential recovery; private client workspaces; document/video upload, private download and playback; published updates; two-way messaging, read receipts/unread badges and conversation archive/reopen; transactional email queue, authenticated immediate delivery and scheduled retry; responsive UI; deployment security headers; automated CI and technical documentation. All runtime demo/Smart Performance functionality and old application-only dependencies have been removed.

## Supabase

The user superseded the original infrastructure instruction with project `ccxkaqbajugimmtsztif`. The local URL and anon key match that project. Its Auth settings endpoint responds HTTP 200 with email enabled. Public signup currently remains enabled, and the portal tables endpoint returns HTTP 404.

The local schema now has one reviewed additive portal migration with eight RLS-protected tables, private Storage bucket/policies, restricted role helpers, atomic client provisioning/update and conversation RPCs, read status and an email outbox/worker. Six historical migrations were reviewed and removed from the active sequence because they install Smart Performance-only objects.

**No hosted migration has been applied.** Both connected Supabase accounts list other projects, and the CLI's account receives HTTP 403 when linking the intended new project. Remote tables, relationships, migration history, auth users, bucket contents and advisors cannot yet be inspected through those credentials. A browser fallback was unavailable. No old or new remote data was deleted. The stale old local project-link metadata was removed from version control; use the explicit new project reference when relinking.

Required: authenticate an authorised Supabase account; inspect the new remote; apply the single reviewed migration; run advisors; disable public signup; configure the intended site URL; supply its server-only service-role key; create/verify the nominated administrator and run the bootstrap script. Then verify actual administrator/client permissions and private Storage on the remote.

## Tests

| Check                                             | Result                                   |
| ------------------------------------------------- | ---------------------------------------- |
| TypeScript project check                          | Passed                                   |
| Oxlint                                            | Passed                                   |
| Production Vite build                             | Passed                                   |
| Node/API/PostgreSQL tests                         | 25 passed, 0 failed                      |
| Playwright Chromium workflows                     | 4 passed, 0 failed                       |
| npm audit                                         | 0 vulnerabilities after compatible fixes |
| Remote URL/key/Auth reachability                  | Passed                                   |
| Remote portal schema                              | Missing; HTTP 404                        |
| Live administrator/client/Storage/email workflows | Pending service access and configuration |

The database tests execute the real migration under separate PostgreSQL roles using PGlite. Browser tests use isolated network fixtures and do not establish live backend integration. Tests caught and fixed a Storage policy column-reference bug. Visual checks cover administrator desktop and mobile login/messaging layouts. Screenshots are in ignored `artifacts/`.

## GitHub and Vercel

Existing repository: `vexora13-glitch/smart-performace-tracker`; existing Vercel project: `smart-performace-tracker` in `vexoranz`. No new repository or hosting project was created. `portal` starts at `main` commit `d66352e`. The existing unrelated working-tree application edits were replaced as explicitly requested. Production/main has not been merged or deployed.

Vercel Development public variables were changed to the new project. The Vercel project has no Git connection; branch-specific Preview variables are unavailable until that is connected. The shared generic Preview/Production variables remain unchanged. Direct preview configuration must explicitly point at the new project. Server-only Supabase and email credentials are not configured.

Preview deployment and PR details will be recorded after source checks and upload finish.

## Remaining release requirements

1. Resolve Supabase access and perform the database/Auth/Storage setup above.
2. Configure `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, a verified `NOTIFICATION_FROM` and `CRON_SECRET` on the preview. No email account/domain was created. Daily retry cron is Hobby-compatible; choose a 15-minute schedule on an eligible plan if faster retries are needed.
3. Complete live preview workflow/security tests and verify actual email receipt. Confirm limits: 50 MB/file, hour-long video links, visible-tab polling every 15 seconds, small-portfolio data loading and provider idempotency retention.
4. After user approval, connect Git deployment automation as appropriate, change production variables to the new Supabase project and server credentials, merge the reviewed PR into `main`, deploy the existing production project and verify replacement. Do not promote the current preview while service setup is incomplete.
