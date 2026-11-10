# Client activity, VexBot history and administrator notifications

Implemented in the canonical `D:\Projects\smart-performance-tracker` checkout on `portal`. On 10 November 2026, the user explicitly approved applying the missing voice-session and client-insights migrations to the hosted Portal database. Those two migrations are now applied and recorded in migration history; no website deployment was performed. Existing client and conversation records are preserved.

## Existing architecture reused

- `portal_profiles`, `portal_clients`, workspace membership and the existing database-authoritative active-role/session-cutoff checks remain the identity and permission system.
- `portal_messages`, `portal_conversations`, `portal_reads`, the existing `Chat` component and transactional email outbox remain the messaging system. A separate in-app notification is added when a client message commits; email delivery behavior is preserved.
- `vexbot_conversations`, `vexbot_messages`, document citations and shared-file citations remain the VexBot history. Text, recorded voice and supervised live voice use these same records.
- Existing private Storage authorization, shared-file library, video player, published chapter sets, localtest environment, design tokens and browser configurations are reused.

## Features

Administrators can open a client workspace and choose Workspace, Activity, VexBot Conversations or Messages. Activity is paginated and filtered by action and date. UTC database timestamps are formatted in the administrator's saved IANA timezone, defaulting to `Pacific/Auckland`; date boundaries account for daylight saving.

Activity includes login, explicit logout, workspace visits, document open/preview/download, video visits, explicitly selected chapters, client messages, private uploads and text/voice conversation start/completion. Proposals and statements of work are labelled from their file names. The shared library now supports lazy PDF, image and text previews; Office files retain download access. PDF pages are rendered locally using the existing PDF.js dependency. Scrolls, mouse movements and keystrokes are not tracked.

The conversation list supports title/summary search, follow-up filtering, type, duration, summary preview and per-administrator unread state. A detail view loads the summary and transcript separately from the list, pages long transcripts, shows citation names and attachment references, and supports follow-up status and summary retry. Available voice text is explicitly marked as potentially partial. Interrupted audio replies retain the existing omitted-words marker. No raw audio storage is introduced.

The header bell provides paginated notifications, unread badges, mark read/unread and mark all read. Links identify both the workspace and exact conversation or message thread/message. Dashboard cards show unread messages, new summaries, follow-up counts and recent meaningful activity. Notifications for minor activity default to off; administrators can explicitly enable important activity in dashboard Notification settings. Summary and message notifications are always enabled.

Each dashboard count opens its own paginated attention list. Staff-authored VexBot conversations remain in their existing history and are excluded from client summary processing and the client conversation list. Summary completion time is tracked separately from message revision, so a summary generated after an administrator read the transcript is correctly marked new.

## Database migration

### Missing activity/history on localhost

`npm run dev` serves the portal at `localhost:5173` but uses the **hosted** database in
`.env.local`. Applying migrations to the isolated local Supabase stack does not update that
hosted database. If Activity and VexBot Conversations both fail, check that the database used
by the server has this migration: `portal_activity_events`, `portal_profiles.timezone` and
`vexbot_conversations.kind` must exist. Missing tables/columns now return HTTP 503 with a
specific database-update message rather than the generic retry error; unrelated failures
remain private.

On 10 November 2026, read-only checks confirmed those three objects were missing from the
hosted Portal project (`ccxkaqbajugimmtsztif`) and present in the isolated local stack.
The root fix is to deploy `20261110003157_client_insights.sql` to that hosted project,
with the explicit approval required by `AGENTS.md`. Its prerequisite
`20261109021904_vexbot_realtime_sessions.sql` is also missing there: the insights migration
installs a trigger on `vexbot_voice_sessions`, so that prerequisite must be applied first.
The workspace-file citation and video-chapter tables are already present; do not blindly
push every pending migration. Preserve the existing conversation
and message rows. This additive migration adds the required schema, grants, policies,
indexes and triggers; it does not reconstruct activity that was never recorded.

Supabase CLI v3 targets the local database by default. Select the hosted target explicitly
for an approved release, review its pending migration history first, and do not apply
unrelated pending migrations as part of this fix. Restart the development server after
API module changes; its Node API imports are not hot reloaded by Vite.

Investigation checks: 204 API/database tests passed, lint/build passed, and the local
security advisors found no issues. All five insights browser cases passed across the
initial run and an isolated rerun (the two initial navigation/polling timeouts passed
when rerun without the concurrent VexBot browser suite). The initial VexBot run had
8 passes, 8 skips, 3 tests not run, and a failure in its source-withdrawal/history case;
this is recorded separately from the confirmed hosted schema mismatch.
The isolated VexBot rerun passed all three selected cases (staff setup, saved conversation
history, and source withdrawal), including the initially failing case.

After explicit user approval, both missing migrations were applied together in one transaction
through the signed-in Portal SQL editor and recorded with their source SQL in
`supabase_migrations.schema_migrations`. This avoided the CLI's IPv6 connection failure and
the current CLI account's HTTP 403 on the management SQL endpoint. The remote database
retained all 27 conversations and 78 messages. Read-only SQL confirmed RLS on all six new
tables, no anonymous/authenticated EXECUTE grants on the seven service RPCs, and notification
publication enabled. The existing signed-in `localhost:5173` browser session successfully
loaded Activity, listed client conversations, and opened a saved four-message transcript.
Activity events that failed before this migration cannot be reconstructed.

`supabase/migrations/20261110003157_client_insights.sql` is additive:

- Extends `portal_profiles` with the administrator timezone.
- Extends `vexbot_conversations` with type, lifecycle/end time, partial-transcript marker, revision, indexed search, summary/processing/lease/retry fields and follow-up status.
- Extends `vexbot_messages` with text/voice medium.
- Adds `portal_activity_events`, `portal_activity_rules`, `portal_admin_notifications`, `portal_admin_notification_reads` and `vexbot_admin_reads`.
- Adds internal message/activity triggers and service-only RPCs for completion, summary claims/commit, dashboard counts and mark all read.
- Adds notification publication to `supabase_realtime` when that publication exists.

Database-generated defaults provide UTC timestamps. The trusted server may preserve historical timestamps when importing or supervising speech. Browser activity requests cannot supply stored timestamps, client identity, arbitrary metadata or arbitrary target names. Foreign keys cascade new tracking data on existing client deletion paths.

## API and lifecycle

`POST /api/insights` authenticates every request. Clients may only submit validated, allowlisted events for a workspace they can access. Read APIs, preferences, rules, read state, follow-up edits and summary retries require the existing administrator role. Conversation detail queries also match the supplied workspace, preventing a deep-link record/workspace mismatch.

`POST /api/vexbot` adds `complete`. Text user messages are saved before answer generation. Assistant responses are saved separately. If a streamed response is interrupted, available partial text is saved with an explicit incomplete-response marker. Voice transcripts continue to be persisted by the server supervisor, rather than trusting browser transcripts. Recorded voice carries the same voice medium label.

The recorded-voice fallback requests immediate transcript persistence from `transcribe`, before starting its separate answer request. The returned saved-message ID is checked against conversation ownership, workspace, medium and exact question content, then reused so the client utterance is not duplicated. A repeated answer request for an already-answered transcript is rejected. A disconnect after transcription therefore leaves the client utterance in history even if no answer was requested. Legacy transcription-only callers remain compatible.

Explicit panel/new-chat/workspace/voice endings request completion. Live supervision completes after queued transcript writes; an inactivity sweep closes sessions with no saved turns for 15 minutes. Reconnection/new messages increment a revision, invalidate an older worker claim and reopen the existing conversation. Explicit end retries are idempotent.

`GET /api/insights` is a background worker protected by a constant-time comparison against `CRON_SECRET`. `vercel.json` schedules it once daily at 18:00 UTC to support Vercel Hobby. Hobby may invoke it anywhere within the 18:00–18:59 UTC window. It claims at most three jobs with row locks and expiring leases. Each summary commit checks both the message revision and the unique lease token; stale workers cannot overwrite newer turns or duplicate canonical notifications. A five-second end grace period allows queued turns to settle. Failed jobs preserve all messages, retry with backoff up to five attempts and remain visible for administrator retry.

With this Hobby-compatible schedule, summaries, inactivity closure and automatic retries wait for the next daily run. Only three queued summaries are attempted per day, so a backlog can take multiple days to clear. Saved transcripts and activity remain available independently. More frequent processing requires a separately configured trusted scheduler calling this same endpoint with `Authorization: Bearer <CRON_SECRET>`, or a Vercel plan that supports more frequent cron jobs. Never expose the secret to browser code. See [Vercel's cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

The canonical `dev:localtest` server also runs a non-overlapping background sweep every 30 seconds. It uses only the isolated local credentials and the same configured provider as that server. The ordinary hosted-data development mode does not start this local worker.

The existing server-side AI provider gains structured summarisation using the configured answer model, or `VEXBOT_SUMMARY_MODEL` when provided. It produces the seven requested sections. Summary points require exact quotes and saved message IDs; client requests and follow-up items additionally require client-authored evidence. Long sessions are processed in bounded chunks covering all saved messages. The labelled mock is used only for local tests; it is refused on hosted deployments by the existing provider rules.

## Environment and configuration

Existing Supabase server/public settings and `OPENAI_API_KEY` / `VEXBOT_OPENAI_MODEL` are reused. No new browser secret is required.

- `CRON_SECRET`: required to invoke the background worker in hosting. Use the platform's existing cron secret if configured.
- `VEXBOT_SUMMARY_MODEL`: optional structured-output-capable model override. Defaults to `VEXBOT_OPENAI_MODEL`.
- `PORTAL_INSIGHTS_RETENTION_DAYS`: optional integer of at least 30 days. Unset by default, so this implementation does not remove existing history. When explicitly configured, the background worker removes expired activity/notifications and completed conversation data, including dependent read/citation rows. Existing client deletion controls also remove this feature's dependent records.

For a future approved release, apply the migration to the intended hosted database, verify its notification table is in the Realtime publication, configure the cron secret/model and confirm hosting supports the configured daily cron and 300-second worker. The checked-in schedules support Vercel Hobby; a five-minute Vercel cron would block deployment on Hobby. These infrastructure changes were not made here. Realtime is an optimisation: the admin view also polls every 20 seconds while visible and refreshes on focus; neither triggers summary processing.

## Security and privacy

Every new public table has RLS. Clients and anonymous users cannot read administrator activity or notifications, and cannot read raw VexBot tables. Transcript access stays behind the authenticated server. New service RPCs have no `PUBLIC`, `anon` or `authenticated` EXECUTE grants. Privileged trigger functions are in the existing private schema, have fixed empty search paths and no public execution grants. Existing authoritative administrator checks also reject disabled accounts and revoked sessions.

Activity payloads use a fixed allowlist. The server resolves file/chapter titles within the authenticated workspace and stores only safe contextual fields. Tokens, signed URLs, arbitrary request bodies and raw audio are excluded. The login page, workspace and VexBot UI disclose administrator-visible recording. Summary content is rendered as text, not HTML.

## Verification

Use the local stack and synthetic data only:

```powershell
node scripts/require-portal-checkout.mjs
supabase migration up
npm.cmd test
npx.cmd playwright test --config=playwright.vexbot.config.ts
npx.cmd playwright test tests/browser/insights.spec.ts
npm.cmd run lint
npm.cmd run build
supabase db advisors --type security --level warn
```

Run `npm test` and the VexBot browser suite sequentially; the former retires synthetic documents used by the latter. The existing VexBot configuration launches its own canonical `dev:localtest` server. Ordinary previews use `npm run dev:localtest`; inspect the process working directory before sharing a URL. Production credentials are never used for synthetic writes.

New tests exercise real PostgreSQL RLS, incorrect-client access, service-only execution, UTC defaults, independent turn persistence, mixed conversations, idempotent endings/notifications, revision fencing, per-admin unread state, opt-in activity notifications, deletion cascades, evidence validation, summary failure recovery, real local Auth/PostgREST and exact browser deep links. The staff-preview regression assertion was scoped to its own account so concurrent synthetic test writers cannot invalidate it.

## Practical limits

- Production AI summary quality and live audio/provider behavior need an approved deployment and configured credentials; automated verification uses labelled local AI responses and the existing live-voice supervisor tests.
- Evidence quote validation reduces unsupported summary items but does not prove that every model paraphrase is semantically correct; administrators can inspect the supporting transcript.
- Available voice transcripts can omit speech. The UI intentionally labels voice history as partial, even when the captured portion appears complete.
- Browser telemetry is bounded and best-effort. A browser killed before a request is sent, persistent offline use or logout token revocation can lose an activity event. Server-saved messages and queued summaries do not depend on unload requests.
- Session closure after a browser crash occurs on the next worker run following 15 minutes of inactivity. A cron schedule/hosting failure delays completion and summaries; saved messages remain available.
- Activity and transcript lists are paginated and indexed. The existing portal-wide messaging loader is unchanged; that pre-existing data-loading model is outside this feature.
- Retention is explicitly opt-in. Configure a period according to the organisation's client-data policy before enabling automated expiry.
- A retained live-voice lease can defer conversation expiry until provider termination is confirmed; the existing voice-safety restrictions are preserved.

## Files

Created: `api/insights.mjs`, `server/insights.mjs`, `src/services/activity.ts`, `src/services/use-admin-insights.ts`, `src/components/AdminNotifications.tsx`, `src/components/ClientInsights.tsx`, `src/components/DocumentPreview.tsx`, `src/components/insights.css`, the migration above, `tests/insights-database.test.mjs`, `tests/insights-local.test.mjs`, `tests/browser/insights.spec.ts` and this report.

Modified: `.env.example`, `scripts/dev.mjs`, `vercel.json`, `server/vexbot/handler.mjs`, `server/vexbot/provider.mjs`, `server/vexbot/realtime.mjs`, `src/App.tsx`, `src/components/Chat.tsx`, `src/components/Login.tsx`, `src/components/Workspace.tsx`, `src/components/video/client-video.tsx`, `src/components/video/chapter-player.tsx`, `src/vexbot/Vexbot.tsx`, `tests/helpers/portal-fixture.ts`, `tests/vexbot-local.test.mjs`, `tests/vexbot-stream-local.test.mjs` and `tests/vexbot-e2e/workspace-files.spec.ts`. The streamed-turn browser regression now waits for each new answer before asserting its content, so the price in a previous answer cannot satisfy the next question's assertion.

## Verification results (local, 10 November 2026)

- `npm.cmd test`: **202 passed, 0 failed, 0 skipped**. Includes the real local Supabase API checks and PostgreSQL policy tests.
- New insights browser suite: **5 passed**, including exact-record navigation, unread state, daylight-saving date boundaries, telemetry failure isolation, private text/PDF previews, mobile layout and polling recovery without Realtime.
- Existing portal and navigation fixture suites: **6 passed**.
- Combined final administration/portal browser run: **11 passed, 0 failures**.
- `npm.cmd run lint`: passed without warnings.
- `npm.cmd run build`: passed. Vite retains its existing large-chunk advisory; document previews and the PDF worker are loaded lazily.
- Local Supabase security advisors: **no issues found**.
- Ten warm local HTTP requests with real local Auth/Storage/PostgREST and the labelled mock answer provider measured approximately **230 ms median / 476 ms p95** end to end. These numbers do not measure live model latency. A 10,000-event PostgreSQL test confirms that paginated workspace timelines use the intended index.
- Full isolated VexBot Playwright suite: **11 passed, 9 expected device-specific skips, 0 failures**. Run sequentially after the 202-test API/database suite. Includes desktop/mobile hands-free recorded voice, saved history, workspace source grounding, read-only access, withdrawal, WebGL fallback and reduced motion.

Screenshots are under `artifacts/insights/`; test logs are `artifacts/insights-npm-test.log`, `artifacts/insights-browser.log` and `artifacts/insights-vexbot-playwright.log`. These generated files are ignored by Git.

Implementation references: [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes), [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
