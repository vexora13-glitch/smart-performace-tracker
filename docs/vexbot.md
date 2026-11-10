# Vexbot in the Vexora Client Portal

Maintained on branch `portal` in `D:/Projects/smart-performance-tracker` (the earlier `vexbot` worktree is merged and obsolete). See `RELEASE.md` for hosted migration/release notes; the voice performance report describes locally verified configuration.

See [the voice performance report](vexbot-voice-performance-report.md) for the current architecture, benchmark evidence and limitations. The earlier [upgrade report](vexbot-upgrade-report.md) is historical.

## What it is

- **Robot.** The public website's exact GLB (`public/bot/vexora-bot.glb`, SHA-256 `f1c9a542…5c45bc`) and its renderer, animator, director, flight and safe-layout modules, ported to `src/vexbot/`. Only two things changed. First, the two glow materials (`LimeGlow`, `EyeGlow`), the rim light, the studio accent panels and the glow sprites use the portal purple instead of lime. Second, `Airspace.strip` lets the portal give the robot its own flight strip. `stations.ts` is portal-specific: the robot stands on a **perch** in the fixed sidebar (between the navigation and the account block) and walks along it between pages; it sits on Messages. Scrolling makes it take off, cruise inside the sidebar and land on the same spot. Below 800 px it uses the website's reserved bottom bar. Reduced motion, Keep still, Hide robot, the clickable body and a text launcher that works without WebGL are preserved.
- **Assistant.** A ChatGPT-style panel with saved conversations, workspaces, private attachments and cited answers. When enabled, live voice uses supervised OpenAI WebRTC with Marin, streaming captions and interruption. Recorded questions and text remain fallbacks; recorded TTS can sound different. Explicit message selection, document previews and supported on-device “Hey Vexbot” activation are described in the voice performance report. The portal does not store microphone recordings.
- **Project boundary.** Each client workspace (`portal_clients.id`) is the boundary. Additional people join a workspace through `portal_workspace_members` with `read_only` or `full` access (Manage client → Team access). Read-only members can read and ask Vexbot, but cannot upload, start a thread or reply.
- **Uploads.** Bytes go straight to the private `vexbot-private` bucket through server-issued signed upload URLs. The server checks the file name, declared type and actual bytes (macro-enabled Office files are rejected). Each upload starts quarantined, and only a scanner verdict can mark it clean. Infected files are deleted. Clean is not the same as approved: a file reaches retrieval only after staff turn it into a document and publish it. A client's file can only ever become knowledge for that client's own workspace.
- **Grounded answers.** These use Postgres full-text search over the passages of *published* documents in scope (business-wide or the current workspace), plus the business profile. Documents, messages and questions are fenced as untrusted data. A factual answer is accepted only if it cites sources that were actually provided; explicitly classified non-factual acknowledgements and clarification questions may omit citations; otherwise Vexbot says it doesn't know and points to Messages or the contact details. Workspace access is rechecked on every request. Saved answers, and spoken replies of them, are withdrawn if any cited document is retired or unpublished.
- **Admin (Vexbot section).** Knowledge upload with text extraction (PDF, Word, Excel, PowerPoint, text), draft → review → publish → retire, an uploads queue with rescan, the business profile, tone presets, answer detail, behaviour guidance, a preview using unsaved settings, versioned settings history with restore, and an audit log. Every knowledge or settings change requires an **AAL2 (TOTP MFA)** session; the server enforces this as well as the UI.

## Workspace files and voice mode (November 2026)

- **Reading workspace files.** Vexbot reads authorised Shared files and scanned, staff-published uploads. The workspace catalogue resolves natural titles, proposal/SOW/quotation/contract terms, partial filenames and small spelling errors. Written documents are preferred unless video is requested; close matches require clarification. Recent valid citations carry document context into follow-ups and comparisons. Upload completion starts best-effort indexing through the authenticated `file_index` action; first-use extraction remains a fallback. PDF text includes page markers. Whole-document summaries use all available text within a combined 200,000-character budget; factual queries select relevant passages within 12,000 characters. Truncation is disclosed. The private cache checks workspace, file, size, immutable storage path, creation version and extractor revision, with a 24-hour maximum age. Removing files cascades cached text and withdraws cited answers. Video content requires approved written content; chapter names alone are not a transcript.

- **Streaming text.** `ask` accepts optional `stream:true` over the existing Node API route. Authenticated SSE carries processing status, genuine provider answer deltas and a final validated/persisted result. Source metadata precedes answer text in the structured provider schema; unknown citations do not stream. Incomplete/error replies are discarded by the UI and the question is restored for manual retry. Stop, close, workspace switch and unmount abort the request. The legacy JSON contract remains supported. `Server-Timing` on JSON answers and the final SSE `timings` object expose numeric phase timings without document content. No provider/model, Vercel region or hosting account changed. See [the coordinated implementation report](unified-portal-upgrade-report.md) for validation and limits.
- **Never in reach:** drafts and documents in review (staff working notes), retired documents, quarantined, infected or unreviewed uploads, and any other workspace's files. A file named from another workspace gets "I couldn't find a file called …", with no hint that it exists.
- **PDF runtime and recovery.** Both PDF.js and its matching in-process worker use literal lazy imports, so serverless packagers can trace the worker. Cache revision `index-v3` discards older extraction results; failed attempts retry after 30 seconds rather than remaining cached for a day. Concurrent reads share extraction within a process. Run `node scripts/verify-vexbot-pdf-package.mjs` to verify a bundled parser locally, optionally passing an authorised PDF path. This does not contact Supabase or a model.
- **Distinct replies.** Processing, unsupported video, scanned/empty text, oversized files and review status remain separate. Storage denial, missing objects, download-size mismatch, password-protected PDFs and verified signature/parser rejection have distinct diagnostics; a generic extraction service failure is never evidence of file damage. Server diagnostics log only stage/code, file/workspace IDs and HTTP status, without raw SDK errors, private URLs or document text. Answer service configuration/provider failures remain separate.
- **Voice mode.** **Talk to Vexbot** starts supervised WebRTC when live voice is enabled. It streams microphone audio and captions, uses the Cedar voice with semantic turn detection and interruption, and keeps one connection across turns. Calls end after four minutes or 75 seconds idle. The bubble follows real listening, processing, speaking, interruption and reconnect events; Mute, Open chat and End remain available. Full connection loss offers explicit reconnect. Recorded voice is a separate fallback using `UtteranceDetector`, transcription, a grounded `ask` and TTS, with about 45 seconds idle before ending. Opening chat carries on in the same saved conversation.
- **Wake phrase and context.** Explicitly arm “Hey Vexbot” where installed browser on-device recognition is available; otherwise tap Talk. The idle wake listener has no cloud fallback and stops before Vexbot speaks. Messages provides an Ask Vexbot control for exact authorised selection; unidentified messages get a short clarification. Simple open-file requests resolve authorised metadata and open a private PDF/image/text preview, or download other formats. Compound summary requests retain normal grounding.
- **Configuration.** Text answers need `OPENAI_API_KEY` and `VEXBOT_OPENAI_MODEL`. Live voice uses `VEXBOT_REALTIME_ENABLED=true`, the existing voice-session migration and a route capable of its configured duration. Recorded voice also needs `VEXBOT_TRANSCRIBE_MODEL` and `VEXBOT_TTS_MODEL`; its configured TTS voice can differ. The `status` action reports missing variable names and workspace-file-index readiness. Without the workspace-files migration, extraction can use an in-memory cache but file citations are not saved.
- **Migration.** `supabase/migrations/20261109090000_vexbot_workspace_files.sql`. Additive, service-role only.
- **Tests.** Matching and local API tests cover approved files and isolation. `tests/vexbot-e2e/` checks a synthetic **Test** workspace, text/recorded voice, message selection and private previews. `npx playwright test -c playwright.vexbot.config.ts` starts its own isolated `dev:localtest` server. Run it sequentially with `npm test`; both use the local stack. The report includes live-provider benchmark commands and unresolved timing limitations.

## Files

| Area | Files |
| --- | --- |
| Database | `supabase/migrations/20261108100000_vexbot.sql` |
| API | `api/vexbot.mjs`, `server/vexbot/{handler,files,prompt,provider,scanner}.mjs`, members in `api/clients.mjs` |
| UI | `src/vexbot/*`, `src/components/VexbotAdmin.tsx`, changes in `App.tsx`, `Workspace.tsx`, `Chat.tsx`, `ClientDialog.tsx` |
| Config | `vercel.json` (`microphone=(self)`), `supabase/config.toml` (TOTP MFA, local ports 56420–56422), `.env.example` |
| Tests | `tests/vexbot-{motion,database,unit,local}.test.mjs`, `tests/vexbot-e2e/`, `playwright.vexbot.config.ts`, `scripts/vexbot-local-seed.mjs` |

## Running it locally

```sh
supabase start -x realtime,edge-runtime,logflare,vector,imgproxy,supavisor,studio,postgres-meta,mailpit
supabase db reset            # local stack only; applies both migrations
# .env.localtest.local (copy .env.localtest.example): local API URL and keys from `supabase status -o env`; optionally
#   VEXBOT_PROVIDER=mock and VEXBOT_SCANNER=mock
npm test                     # includes the local API suite when the URL is loopback
npm run dev:localtest        # http://localhost:5186, refuses any non-loopback database
npx playwright test -c playwright.vexbot.config.ts   # own localtest server on :5181 with mocks, synthetic data, real Chrome
```

The local ports moved from 54321/54322 because Windows reserves 54312–54411 on this machine.

## Provider configuration (portal-owned)

`OPENAI_API_KEY`, `VEXBOT_OPENAI_MODEL`, `VEXBOT_TRANSCRIBE_MODEL`, `VEXBOT_TTS_MODEL`, `VEXBOT_TTS_VOICE`, `VEXBOT_CLAMD_HOST`, `VEXBOT_CLAMD_PORT`. All are server-only. The mock provider and mock scanner are refused on every Vercel deployment (`VERCEL`/`VERCEL_ENV` set), previews included.
