# Vexora portal intelligence and presentation upgrade

Implementation date: 10 November 2026. Canonical checkout: `D:\Projects\smart-performance-tracker`, branch `portal`. Baseline revision: `1be9a9c295bed14d12a214c234f40b6ee1070876`. No commit, push, deployment, production data change, hosted configuration change or paid AI call was made.

## Executive result

Implemented natural document selection, contextual follow-ups, page-aware extraction, safer reusable text caching, progressive text transport, cancellation, request phase timings and a near-full-screen presentation workspace. Existing authentication, database, provider settings, robot assets, voice identity, uploads and chapter administration remain in place. The implemented local flow can select the proposal without an exact filename, cite its actual PDF text and use the proposal for a pricing follow-up.

Live AI answer quality, live provider latency and authentic voice startup remain unverified. Long documents still have explicit processing/context limits. This is locally reviewable code, not a deployed production result.

## Audit and confirmed initial limitations

| Area | Existing architecture and confirmed limitation |
| --- | --- |
| Frontend | Vite, React 19, TypeScript, existing navy/purple CSS tokens, Motion and a lazy Three.js robot stage. The chat already displayed pending user messages immediately and preserved recent history. It waited for a complete JSON answer before displaying assistant text. |
| Backend | Existing Vercel Node routes delegate to `server/vexbot/handler.mjs`; local Vite middleware invokes the same handlers. Text used the existing server-only OpenAI Chat Completions adapter and strict structured output. The route has an existing 60-second limit. |
| Permissions | Authoritative Auth validation, active profile/session cutoff, workspace access RPC, private Storage, RLS and staff MFA. The server uses privileged database credentials and must maintain explicit workspace predicates; RLS is not a substitute for those checks. |
| Knowledge | Published workspace/global documents, reviewed upload workflow, Postgres full-text passage search, shared-file extraction cache and saved citations/withdrawal already existed. No replacement vector database was needed. |
| Recognition | Full/distinctive filename phrases and deictic references dominated selection. Natural proposal/SOW descriptions, misspellings and document-versus-video preferences were not reliably resolved before content search. |
| Extraction | PDF.js, bounded Office ZIP extraction and text formats were already supported. PDFs lost page labels; summaries were restricted to the opening 60,000 characters. Long unbroken paragraphs could lose text during chunking. |
| Latency | Ordinary retrieval could issue up to five sequential historical searches. Citation reads and turn writes were sequential; voice lookup loaded the same history twice. Live model generation and first-use extraction were plausible additional costs, but were not measured against production. |
| Video | `ChapterPlayer`, signed URLs, chapters, captions, PiP, speed, keyboard shortcuts and an admin editor already existed. The dialog was limited to 900px. Conflicting CSS rules enlarged chapter numbers/thumbnails, forced mid-word wrapping, and gave supporting content excessive space. |
| Monitoring | Existing tests covered Auth, database/RLS, ingestion, voice lifecycle, robot motion, video storage and chapters. There was no per-phase text request timing or progressive chat transport. |

The supplied screenshot's exact customer content was not available as an attachment. Before/after evidence uses the repository's real synthetic WebM fixture and long representative chapter titles. No customer documents were copied or inspected.

## Document intelligence and retrieval

- A workspace-scoped catalogue ranks normalised filenames, titles, aliases and document categories. It recognises proposals, statements of work/SOW, quotations and contracts, partial titles and small edit/transposition errors. It does not contain customer-specific filename mappings.
- Exact filenames remain supported. Written documents take preference for ordinary document requests; explicit video/PDF requests constrain the format. Close scores produce one clarification listing plausible candidates. Published aliases can take precedence over the corresponding shared-file representation.
- Recent, non-withdrawn server-loaded citations carry context into deliverables, cost, scope and timeline follow-ups. Comparisons include the prior source and the newly identified document. Deleted/out-of-scope references are not restored from history.
- Catalogue entries retain identifiers, workspace, MIME/content format, normalised display title, inferred document type and known processing/publication status. Shared-file versions use the existing immutable upload path and creation timestamp. There is no new user-facing version editor or implicit “newest version wins” rule: multiple plausible versions remain ambiguous.
- New shared document uploads trigger best-effort authenticated `file_index` work once their library record exists. Failed indexing does not roll back a successful upload; first-use extraction remains available. Existing client uploads still require scanning and staff publication.
- PDF text includes page labels. Page-aware passages retain their page when a long page is split. Whole summaries include all available text within the combined 200,000-character context budget; factual questions select relevant sections within 12,000 characters. Short factual prompts no longer receive entire large files.
- Truncated processing/context results carry an explicit partial-coverage notice. Existing limits remain: 20 MiB automatic extraction, 300 PDF pages and 200,000 extracted characters. Complete hierarchical summaries beyond these limits are pending; the code does not claim that partial text represents the entire original.
- Extracted text stays in the existing private cache. Cache identity includes database origin for memory fallback, workspace, file, size, storage path, creation version and extractor revision, with a 24-hour maximum age. Old cache revisions are reprocessed. Deleted files cascade cached text; membership and current catalogue visibility are checked independently on every request. Out-of-band replacement of bytes at an identical immutable path/size requires explicit cache invalidation or expiry; the normal upload workflow creates a new path.
- Videos are not transcribed or watched automatically. A video with only chapter titles is not treated as verified spoken content. Approved written descriptions/transcripts can be read through the existing publication workflow.

## Streaming, responsiveness and runtime

`ask` now accepts optional `stream:true`; existing JSON callers keep their contract. The actual API route sends SSE processing, provider delta, validated-answer, result and error events, with heartbeat comments and `no-store`. The existing provider/model is preserved. No SDK, animation library, infrastructure service or dependency was added.

The provider still uses strict structured output with `store:false`. Answered/kind/source metadata precedes answer text; only known citation IDs are accepted before decoding answer deltas. Final output still passes existing citation validation. Refusal, truncation, malformed output and missing completion are handled as failures. Partial text remains provisional until the final result; the client removes interrupted/failed partials and restores the question for manual retry. This checks citation identity, not semantic truthfulness: live model evaluation is still required.

The browser paints user messages immediately, batches partial updates to animation frames, follows the log only when the client was already at its bottom, and provides Stop response. Stop, close, workspace change and unmount abort the HTTP/provider request. There is no automatic retry that could silently duplicate paid generations. Distributed exactly-once request handling across simultaneous tabs is not implemented.

Deterministic greetings skip AI/retrieval. Other requests retain the configured model. Natural resolution avoids unnecessary search; ordinary search stops historical fallbacks after the current query finds evidence. Settings and conversation preparation run concurrently. Citation reads/writes run concurrently where independent. User and assistant rows are inserted together atomically; citations and conversation updates still use separate operations.

Numeric timings expose authentication, authorisation, catalogue lookup, retrieval, model duration, first streamed text when supplied, persistence and total duration. JSON responses use `Server-Timing`; SSE final results include `timings`. They contain no source text. First-text timing includes upstream model/structured metadata delay; model duration measures the provider operation, not a separately instrumented provider-internal queue.

No Vercel runtime, region, execution limit, Supabase index, model, key or deployment configuration changed. There is no evidence yet to justify a region/runtime migration. Vercel proxy buffering, warm hosted latency and serverless cold starts need a protected preview/live-provider verification after approval. Reference: [Vercel streaming functions](https://vercel.com/docs/functions/streaming-functions), [OpenAI structured output streaming](https://developers.openai.com/api/docs/guides/structured-outputs#streaming).

## Voice

Recorded questions and supervised Realtime knowledge lookup share the same document plan, visibility checks and history. Voice lookup now loads its authorised messages once and fetches settings concurrently. Existing New Zealand English instructions, configured audio models/voices, Marin Realtime configuration, VAD, interruptions, microphone cleanup, robot appearance and motion are preserved.

Recorded speech still waits for a validated answer and complete TTS audio; incremental segment synthesis was not introduced. Existing live Realtime transport/supervision remains feature-gated. Mock audio and transport tests establish lifecycle behaviour, not authentic speech quality, account entitlement or live operation. No under-three-second voice claim is made.

## Video and chapters

- The client dialog uses 98vw × 98dvh, a compact header and a dark presentation surface. At desktop widths the columns use approximately 74/26 with a minimum 310px chapter width. Below 1024px chapters stack under the media.
- The header provides title, duration, chapter toggle, theatre mode, workspace fullscreen and close. Existing media fullscreen remains available. Supporting guidance is collapsed in a details section; duplicate presentation headings were removed.
- Video uses `object-fit:contain`, preserving the original image/aspect ratio. Chapter toggles and theatre/fullscreen changes retain the same video DOM element, current time and playback state. Hiding chapters retains the mounted list and its scroll position.
- Chapter rows use small numbers, consistent 64px thumbnails, 14px medium-weight titles, 12px timestamps below titles and subtle purple active styling. Words wrap naturally, with three-line clamping and the full title in the button tooltip. Rows exceed 44px touch height. Thumbnails remain lazy loaded.
- Desktop scrolling belongs to the chapter list, with the video fixed in the available presentation area. Tablet/mobile stack the chapter list below media without horizontal overflow. Mobile playback tools occupy two accessible rows rather than shrinking into tiny controls. Safe-area padding is applied.
- Existing play/pause, range seeking, skip, mute/volume, speed, captions, PiP, chapter markers and keyboard shortcuts remain. Background scrolling is locked during the dialog and restored afterwards. Existing native dialog focus handling is retained.
- Admin draft/publication, ordering, timestamps, frame capture and thumbnails use the same services and editor. Existing 200 MiB shared MP4/WebM resumable uploads, signed URLs and Storage policies were preserved.

## Security and compatibility verification

Executed tests exercise authoritative authentication, workspace membership/read-only access, session revocation, RLS, direct private-text denial, malware quarantine, publication rules, source withdrawal and concurrent customers with different pricing. Stream access is authenticated on the same route and generates no source deltas for a denied workspace. Access is checked again before saving a completed text answer; current citation visibility is checked before presenting it.

Source text remains fenced untrusted data; client-supplied history/source IDs are not accepted as knowledge. Service credentials remain server-only. No browser cache of extracted document contents or cross-customer response cache was introduced. Existing uploads, downloads, portal messaging, administration and robot lifecycle remain covered by regressions. Passing tests do not constitute a guarantee against semantic prompt injection or provider hallucination. Reference: [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Executed checks and evidence

Final run counts and benchmark values are recorded below. Logs and screenshots are local, git-ignored artifacts.

- `node scripts/require-portal-checkout.mjs`: passed before editing; canonical branch preserved.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 186 passed, zero failed/skipped, including local Auth/Storage/API and PostgreSQL/RLS.
- `npm run build`: passed. Existing main/Three.js chunks exceed Vite's 500 kB advisory threshold; no bundle warning was suppressed.
- `npx playwright test --workers=1`: 29 passed, covering the portal, mocked voice lifecycle, interrupted/cancelled chat, five viewer sizes, playback controls, admin chapter publication and client keyboard seeking.
- `npx playwright test -c playwright.vexbot.config.ts`: 11 passed, 9 platform-inapplicable skips. Includes real local streaming headers, natural proposal/SOW selection, pricing follow-up, MFA/knowledge publication, fake-microphone recorded voice, source revocation, real WebGL robot motion and mobile navigation.
- `npx playwright test -c playwright.upload.config.ts`: 2 passed. Actual 15, 89 and 200 MiB uploads persisted with correct sizes, played, sought chapters and returned HTTP 206. Includes interrupted/resumed transport and customer/read-only playback permissions.
- `git diff --check`: passed; Windows line-ending notices only.

Initial failures were investigated rather than hidden: Docker/local Supabase was initially offline; two expectations needed updating for intentional page labels/clarification copy; an empty PDF page initially acquired a false text label and was corrected; a bulk insert needed explicit defaults for both role shapes and was corrected; scroll-restoration assertions now wait for React cleanup; concurrent browser runs collided in their shared artifact directory. Configurations now use separate artifact directories. The existing mobile VexBot test was updated to open the canonical mobile navigation menu before selecting Messages.

## Measurements and screenshots

Local warm measurements use real local Auth/PostgREST/Storage and deterministic extractive AI. Ten samples are useful diagnostics, not production service levels. Baseline route comparison loads the committed handler/resolver into memory and uses the same local database/current provider and extractor; it does not create a second checkout. Samples alternate between implementations. Do not interpret mock model time as live model latency.

The final controlled run used ten alternating warm requests per implementation, without the other suites running:

| Metric | Before | After |
| --- | ---: | ---: |
| Full HTTP completion, p50, exact filename / JSON | 216.3ms | 195.4ms |
| Full HTTP completion, p95, exact filename / JSON | 230.0ms | 216.8ms |

This is a modest local p50 reduction of about 9.6%, not evidence of a corresponding production improvement. The current SSE route's separate ten-request run measured HTTP completion p50 199.4ms / p95 217.2ms. Phase p50/p95 values were authentication 34.4/37.2ms, workspace authorisation 8.4/22.2ms, catalogue 9.8/11.5ms, cached retrieval 17.9/20.8ms and persistence/presentation 75.0/78.0ms. These measurements identify database round trips and persistence as the largest measured local costs; mock AI took less than a millisecond and cannot establish the live provider bottleneck. Percentiles are individual phase percentiles, not additive totals.

[Raw warm phase samples](../artifacts/vexbot-warm-local.json), [before/after samples](../artifacts/vexbot-before-after.json), [single browser DOM sample](../artifacts/vexbot-browser-render.json).

The final single browser fixture sample measured 15.9ms for user message/processing DOM visibility and 18.2ms to API request initiation. The fixture's first response byte arrived at 24.5ms; that byte is processing feedback, not meaningful live model output. These are click-to-DOM/resource timings, not painted pixels, a p95, or production latency. Live model time to first token, real speech startup, cold starts and production p50/p95 were not measured.

Before/after captures exist for 1920×1080, 1440×900, 1366×768, 768×1024 and 390×844. Desktop/mobile after images and the desktop before image were visually inspected. The fixture video is a deliberately simple coloured clip, not customer presentation footage.

| View | Before | After |
| --- | --- | --- |
| Desktop 1920 | [Before](../artifacts/screenshots/video-before-1920.png) | [After](../artifacts/screenshots/video-after-1920.png) |
| Laptop 1440 | [Before](../artifacts/screenshots/video-before-1440.png) | [After](../artifacts/screenshots/video-after-1440.png) |
| Laptop 1366 | [Before](../artifacts/screenshots/video-before-1366.png) | [After](../artifacts/screenshots/video-after-1366.png) |
| Tablet 768 | [Before](../artifacts/screenshots/video-before-768.png) | [After](../artifacts/screenshots/video-after-768.png) |
| Mobile 390 | [Before](../artifacts/screenshots/video-before-390.png) | [After](../artifacts/screenshots/video-after-390.png) |

The old dialog was limited to 900px; the new dialog occupies 98% of available width and height. Automated checks verify viewport coverage, overflow, retained video node/time, fullscreen exit, chapter visibility and scrolling restoration. Live hardware PiP and Safari/iOS fullscreen behaviour were not certified by Chromium tests.

## Files changed

Backend: `server/vexbot/catalogue.mjs`, `files.mjs`, `sources.mjs`, `handler.mjs`, `provider.mjs`, `prompt.mjs`.

Frontend: `src/vexbot/Vexbot.tsx`, `chat-stream.ts`, `stream.mjs`, `stream.d.mts`; `src/components/Workspace.tsx`; `src/components/video/chapter-player.tsx`, `client-video.tsx`, `video.module.css`; `src/services/portal.ts`; `src/App.css`.

Tests/tooling: `tests/vexbot-intelligence.test.mjs`, `vexbot-stream-local.test.mjs`, `vexbot-files-local.test.mjs`, `vexbot-unit.test.mjs`; `tests/browser/vexbot-stream.spec.ts`, `video-chapters.spec.ts`; `tests/vexbot-e2e/vexbot.spec.ts`, `workspace-files.spec.ts`; `scripts/vexbot-local-seed.mjs`; the three Playwright configuration files.

Documentation: this report, `docs/vexbot.md`, `docs/video-chapters.md`. No package, lockfile, GLB, migration, production environment or Vercel configuration file changed.

## Remaining limits, local instructions and deployment readiness

No new Supabase migration or Vercel environment/configuration change is required. Existing migrations must already be installed, especially workspace file text/citations and video chapters; they were exercised locally. Existing provider keys/model configuration are still required for live answers. Best-effort upload indexing is not a durable extraction queue; long background work after a serverless response is not guaranteed. The existing catalogue caps remain 200 rows per source category, and passage ranking remains lexical rather than embedding-based; older files outside that catalogue window and paraphrases with no matching terms need further retrieval work. OCR, automatic video transcription, embeddings, hierarchical summaries beyond limits, historical fact compaction and distributed request idempotency remain future work.

For local verification, start the existing Docker/Supabase stack and use `.env.localtest.local` with loopback Supabase only. Keep hosted credentials separate. Run these in order:

```powershell
node scripts/require-portal-checkout.mjs
npm run typecheck
npm run lint
npm test
npm run build
npx playwright test -c playwright.vexbot.config.ts
npx playwright test --workers=1
npx playwright test -c playwright.upload.config.ts
```

Do not run `npm test` concurrently with the VexBot suite: API tests retire synthetic documents. The isolated configuration starts `npm run dev:localtest` on its own port; it does not reuse a hosted-data dev server. For the optional controlled baseline comparison, run `$env:VEXBOT_BASELINE_REF='1be9a9c295bed14d12a214c234f40b6ee1070876'; node --test tests/vexbot-stream-local.test.mjs` after other local tests finish, then remove that environment variable. Artifacts contain synthetic data and stay git-ignored.

The implemented code passed the local checks above and is ready for review. Before claiming hosted readiness, verify the actual configured provider/model's structured streaming, grounded summaries, proxy flushing, request interruption, context capacity and voice startup in an approved protected preview. No production latency promise or live voice operational claim is made. Commit, push, hosted tests that change data, configuration changes and deployment remain unperformed and require the user's explicit approval.
