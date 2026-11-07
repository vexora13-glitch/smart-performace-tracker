# Vexora Client Portal

Phase 1 administrator and client application. React 19, TypeScript, Vite, Supabase Auth/Postgres/private Storage and Vercel Node functions. The existing repository and Vercel project are retained. The old Smart Performance UI, workflows, AI integration, tests and migrations have been replaced.

## Infrastructure

| Resource              | Intended target                                                |
| --------------------- | -------------------------------------------------------------- |
| GitHub                | `vexora13-glitch/smart-performace-tracker`                     |
| Development branch    | `portal`, based on `main` at `d66352e`                         |
| Supabase              | `ccxkaqbajugimmtsztif` (user supplied replacement project)     |
| Vercel                | `smart-performace-tracker`, `prj_zu9PLowasAyC4DgrpFoUiKlhhS80` |
| Vercel team           | `vexoranz`, `team_KHxOc29JG0UPCkwm2k2nSLXw`                    |
| Existing production   | `https://smart-performace-tracker.vercel.app`                  |
| Initial administrator | `allan@vexoradigital.com`                                      |

The repository remains a Vite application; introducing Next.js would replace working infrastructure without a Phase 1 benefit. The new Supabase project supersedes the original database at the user's explicit direction. No new repository, hosting project or cloud service account is created by this implementation.

## Functionality

- Shared email/password login, authoritative database roles, role-specific navigation and secure sign-out.
- Administrator dashboard with client and unread-message panels; client search, creation, company/contact editing, disabling/re-enabling access, and managed password replacement.
- One private workspace per client. Administrators upload PDF/Office documents, images, text files, MP4/WebM videos, and publish workspace-specific updates. Clients download files, play videos and read updates.
- Two-way conversations, atomic thread/first-message creation, read receipts, unread counts, administrator archiving/reopening and readable archived history.
- Transactional email outbox for every client message. Immediate authenticated delivery attempt and scheduled retry; failures do not discard messages.
- Responsive desktop/mobile UI, native accessible dialogs, form validation, explicit loading/error/empty states, private file deletion confirmation, and CSP/security headers.

## Local development

Use Node 24 and npm. Copy `.env.example` to `.env.local` only if the local file does not already exist. Preserve the user's configured values.

```powershell
npm ci
npm run dev
```

The dev runner starts Vite and the same `/api/clients` and `/api/notifications` handlers used by Vercel. The normal application has no demo mode or fixture data. Missing configuration fails visibly.

| Variable                    | Scope                     | Purpose                                                   |
| --------------------------- | ------------------------- | --------------------------------------------------------- |
| `VITE_SUPABASE_URL`         | Browser + server fallback | `https://ccxkaqbajugimmtsztif.supabase.co`                |
| `VITE_SUPABASE_ANON_KEY`    | Browser                   | Matching project anon key; public by design               |
| `SUPABASE_URL`              | Optional server override  | Must match the portal project if set                      |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only               | Supabase Auth admin and privileged operations             |
| `RESEND_API_KEY`            | Server only               | Email provider credential                                 |
| `NOTIFICATION_FROM`         | Server only               | Verified sender, e.g. `Vexora <portal@vexoradigital.com>` |
| `CRON_SECRET`               | Server only               | Long random secret for Vercel's cron Authorization header |

Never give privileged variables a `VITE_` prefix, commit them, include them in PRs or log them. Passwords go directly to Supabase Auth via the server and are not stored in application tables or returned to the browser. The `openai` dependency and analyzer are removed; old AI variables are unused and may be removed from local settings.

## Database setup

Only `supabase/migrations/20261107101815_client_portal.sql` belongs to this application's migration sequence. The six old Smart Performance migrations were reviewed: they create visit, quote, booking, task, KPI and activity tables and their triggers/policies; none are required for the portal. They have been removed from the active sequence. Git history contains ordinary prior versions. No old remote database tables or storage objects were deleted.

Before applying anything, authenticate to the account that owns **ccxkaqbajugimmtsztif**, verify the project, inspect its tables, policies, buckets and migration history, and ensure `portal-private` is not an existing public bucket with unrelated contents. Do not use a stale link to the previous project.

```powershell
supabase login
supabase projects list
supabase link --project-ref ccxkaqbajugimmtsztif
supabase db query --remote=ccxkaqbajugimmtsztif --read-only "select schemaname,tablename from pg_tables where schemaname in ('public','storage','supabase_migrations');"
supabase migration list --remote=ccxkaqbajugimmtsztif
supabase db push --help
```

After inspection confirms the additive migration is appropriate, apply only the reviewed migration with the CLI's explicit remote target. Supabase CLI 3 defaults to local and requires `--yes` for authorised hosted changes. `config.toml` describes local services; it does **not** silently change hosted Auth settings.

```powershell
supabase db push --remote=ccxkaqbajugimmtsztif --yes
supabase migration list --remote=ccxkaqbajugimmtsztif
supabase db advisors --help
node --env-file=.env.local scripts/verify-remote.mjs
```

Run security advisors and inspect the final schema. If the remote has a different migration history, reconcile it after inspection; do not blindly repair, reset or replay historical migrations.

### Schema and access control

| Table                  | Access                                                         |
| ---------------------- | -------------------------------------------------------------- |
| `portal_profiles`      | Own profile/admin read; privileged server writes only          |
| `portal_clients`       | Own workspace/admin read; privileged server writes only        |
| `portal_files`         | Workspace read; administrator insert/delete                    |
| `portal_announcements` | Workspace read; administrator publish/delete                   |
| `portal_conversations` | Workspace read/create; administrator archive/reopen only       |
| `portal_messages`      | Workspace read; current author insert into an open thread only |
| `portal_reads`         | Workspace read; current user writes own receipt only           |
| `portal_email_jobs`    | Server only; durable, locked notification jobs                 |

All tables enable RLS. Foreign keys, indexes, length limits and timestamp constraints protect integrity. Client-facing roles cannot update profiles, grant themselves privileges, change workspace ownership, forge authors, write into archived conversations or read the outbox. Authorization never trusts user-editable metadata. Role/membership helper functions live in non-exposed `portal_private`, use a fixed empty search path and have narrow grants. Public RPCs use invoker rights; provisioning and queue claiming are service-only. Client provisioning and detail edits use transactional RPCs.

The `portal-private` bucket permits selected file types up to 50 MB. A file path starts with its workspace UUID. Client access also requires matching authorised file metadata. Downloads use authenticated Storage requests; video URLs expire after one hour. Disabling access immediately blocks database and new storage requests. Previously downloaded content cannot be recalled; existing video links remain valid until expiry. Password recovery sets a server-controlled JWT issuance cutoff as well as updating Supabase Auth credentials.

### Auth and administrator setup

In the intended hosted project:

1. Enable email/password authentication and disable public signup. OAuth and anonymous sign-in are not required.
2. Set the site URL to the approved portal production URL. Add exact development/preview URLs only as needed. Phase 1 uses password login and does not accept URL sessions or offer self-service reset flows.
3. Create and verify `allan@vexoradigital.com` through Supabase Auth if it does not already exist. Choose its initial password securely; never place it in tracked files.
4. With the correct server-only key in `.env.local`, run:

```powershell
node --env-file=.env.local scripts/bootstrap-admin.mjs
```

The bootstrap script finds only that exact confirmed email and upserts its administrator profile. It does not create a new account, guess a password, or promote accounts based on metadata. Clients are created through the administrator UI with an initial password of 12–128 characters containing uppercase, lowercase and a number. Verify the intended client's identity before replacing a password, then share it through a secure channel. Existing unrelated Auth users gain no workspace automatically.

## Email delivery and operations

The original project had no email configuration. A Resend API adapter is implemented; no Resend account or domain has been provisioned. Configure a verified sender and API key before sending live notifications. The recipient is fixed to `allan@vexoradigital.com`; no message bodies, documents or credentials are included in email.

Client messages queue an outbox row in the database transaction. The UI calls the authenticated notification endpoint immediately after saving. A failed call leaves the durable row pending and shows a delivery-pending notice. `/api/notifications` GET requires `CRON_SECRET`; POST requires an active authenticated author or administrator. Claiming uses `FOR UPDATE SKIP LOCKED` and a two-minute lease. Retries wait at least 15 minutes, stop after five attempts and use a stable provider idempotency key. Provider deduplication has a finite retention window, so a provider-success/database-failure crash may still duplicate a notification after that window. Monitor failures rather than assuming exactly-once email.

The checked-in cron runs once daily at 18:00 UTC to remain compatible with Hobby scheduling limits. On an eligible paid plan, change the retry schedule to every 15 minutes before release if prompt retries are required. Immediate delivery is unaffected. The worker processes at most 20 jobs per invocation. Inspect `portal_email_jobs` for pending or exhausted jobs and retry deliberately after fixing provider settings. Never delete client messages as a delivery-recovery mechanism.

The UI refreshes data every 15 seconds while visible. Data retrieval pages through PostgREST's row limits. Phase 1 is intended for a small client portfolio; larger accounts should add server pagination and scoped loading before high-volume use.

## Validation

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm audit
```

The PostgreSQL tests run the actual migration in PGlite with minimal Auth/Storage platform contracts. They exercise RLS under different PostgreSQL roles, isolation, malicious inserts, credential cutoff, transactional provisioning, two-way messaging, read status, archiving, private Storage policies and outbox locks. Unit/API tests exercise input limits, authoritative role verification, provisioning compensation, managed credentials and notification success/failure. Browser tests use isolated network fixtures to verify administrator/client UI contracts and mobile layout. They are **not proof of a live Supabase/Vercel/email end-to-end deployment**. `.github/workflows/portal.yml` runs all checks on pushes and PRs.

Before approving production, repeat the real admin/client flows against the configured preview, including account creation, initial-password login, updates, document download, video playback, cross-client direct API rejection, disable/re-enable, password recovery, read receipts, archive/reopen, notification delivery and sign-out. Record delivery evidence and remove only explicitly disposable test data.

## Deployment and release

Keep all development on `portal`. Commit, push and open a reviewable PR into `main`. Do not merge or promote without user approval. The local Vercel link is ignored by Git and points to the existing project; no new project is necessary.

The existing Vercel project currently lacks a Git repository connection. Development variables were updated to the new Supabase public configuration. Branch-specific Preview settings require a Git connection; direct preview deployments can receive explicit public build/runtime configuration. The existing generic Preview/Production variables still refer to the original database until the release configuration is approved. Server-only credentials and email settings must be added to the intended preview first. Connecting Git and changing production environment variables are release actions to review before enabling automatic production deployments.

See `IMPLEMENTATION_REPORT.md` for this pass's concrete test results, source status, deployment URL and remaining blockers.
