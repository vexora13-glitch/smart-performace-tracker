# Vexbot in the Vexora Client Portal

Maintained on branch `portal` in `D:/Projects/smart-performance-tracker` (the earlier `vexbot` worktree is merged and obsolete). The base Vexbot migration is applied to the hosted Portal project; `20261109090000_vexbot_workspace_files.sql` is the one pending migration (see `RELEASE.md`).

See [the November 2026 upgrade report](vexbot-upgrade-report.md) for current behaviour, validation and Realtime limitations.

## What it is

- **Robot.** The public website's exact GLB (`public/bot/vexora-bot.glb`, SHA-256 `f1c9a542…5c45bc`) and its renderer, animator, director, flight and safe-layout modules, ported to `src/vexbot/`. Only two things changed. First, the two glow materials (`LimeGlow`, `EyeGlow`), the rim light, the studio accent panels and the glow sprites use the portal purple instead of lime. Second, `Airspace.strip` lets the portal give the robot its own flight strip. `stations.ts` is portal-specific: the robot stands on a **perch** in the fixed sidebar (between the navigation and the account block) and walks along it between pages; it sits on Messages. Scrolling makes it take off, cruise inside the sidebar and land on the same spot. Below 800 px it uses the website's reserved bottom bar. Reduced motion, Keep still, Hide robot, the clickable body and a text launcher that works without WebGL are preserved.
- **Assistant.** A ChatGPT-style panel: conversation history, new chat, a workspace selector, a multi-line composer (Enter sends, Shift+Enter adds a newline), private file attachments, cited answers, "Message the team" when the sources have no answer, and optional spoken replies. **Voice is turn-based**: record a question, stop, and it is transcribed and answered. It is not a live conversation. Audio is not stored.
- **Project boundary.** Each client workspace (`portal_clients.id`) is the boundary. Additional people join a workspace through `portal_workspace_members` with `read_only` or `full` access (Manage client → Team access). Read-only members can read and ask Vexbot, but cannot upload, start a thread or reply.
- **Uploads.** Bytes go straight to the private `vexbot-private` bucket through server-issued signed upload URLs. The server checks the file name, declared type and actual bytes (macro-enabled Office files are rejected). Each upload starts quarantined, and only a scanner verdict can mark it clean. Infected files are deleted. Clean is not the same as approved: a file reaches retrieval only after staff turn it into a document and publish it. A client's file can only ever become knowledge for that client's own workspace.
- **Grounded answers.** These use Postgres full-text search over the passages of *published* documents in scope (business-wide or the current workspace), plus the business profile. Documents, messages and questions are fenced as untrusted data. A factual answer is accepted only if it cites sources that were actually provided; explicitly classified non-factual acknowledgements and clarification questions may omit citations; otherwise Vexbot says it doesn't know and points to Messages or the contact details. Workspace access is rechecked on every request. Saved answers, and spoken replies of them, are withdrawn if any cited document is retired or unpublished.
- **Admin (Vexbot section).** Knowledge upload with text extraction (PDF, Word, Excel, PowerPoint, text), draft → review → publish → retire, an uploads queue with rescan, the business profile, tone presets, answer detail, behaviour guidance, a preview using unsaved settings, versioned settings history with restore, and an audit log. Every knowledge or settings change requires an **AAL2 (TOTP MFA)** session; the server enforces this as well as the UI.

## Workspace files and voice mode (November 2026)

- **Reading workspace files.** Vexbot answers from the actual contents of files the client can already see: **Shared files** (`portal_files`) and client uploads once they are scanned clean *and* published by staff. It also uses documents published for that workspace or for everyone, and the business profile. Name a file ("Summarize `pike point.pdf`"), say "the document here" (when there is exactly one readable file), or follow up with "it" after an answer about a file. Text is extracted on first use (PDF, Word, Excel, PowerPoint, text, Markdown), cached server-side in `vexbot_file_text`, and given whole to the model, up to 60,000 characters. Answers cite the file (`vexbot_file_citations`) and are withdrawn if it is removed. Shared files also have an "Ask Vexbot about this file" button.
- **Never in reach:** drafts and documents in review (staff working notes), retired documents, quarantined, infected or unreviewed uploads, and any other workspace's files. A file named from another workspace gets "I couldn't find a file called …", with no hint that it exists.
- **Distinct replies.** "Still being processed", "a video I can't read", "no readable text" (scanned), "couldn't open" (damaged or mismatched), "over 20 MB", "quarantined / waiting for review", "couldn't find", and "which file do you mean?" are each separate from the two service messages. "Answer service isn't switched on" means no provider is configured. "Couldn't reach its answer service just now" means the provider call failed; the server logs only its HTTP status.
- **Voice mode.** **Talk to Vexbot** beside the robot starts hands-free voice with the panel closed. The robot stays on its perch and the bubble shows listening, thinking and speaking, what it heard, the answer and its sources, with Mute, Open chat and End. Speech detection (`UtteranceDetector`) ends each question at a pause. The spoken reply comes back in the same `ask` request (`speak: true`) and plays on its own, then Vexbot listens again. About 45 seconds of silence ends the session. Touching the robot while it speaks interrupts it. Opening chat ends voice mode and carries on with the same conversation.
- **Configuration.** Answers need `OPENAI_API_KEY` and `VEXBOT_OPENAI_MODEL`. Voice also needs `VEXBOT_TRANSCRIBE_MODEL` and `VEXBOT_TTS_MODEL`. The `status` action tells administrators which of these are missing (names only) and whether the workspace-files migration is applied. Without that migration Vexbot still reads files, with an in-memory cache, but file citations are not saved.
- **Migration.** `supabase/migrations/20261109090000_vexbot_workspace_files.sql`. Additive, service-role only.
- **Tests.** `tests/vexbot-sources.test.mjs` (matching, speech detection, fixture) and `tests/vexbot-files-local.test.mjs` (local stack). In the browser, `tests/vexbot-e2e/workspace-files.spec.ts` runs the acceptance check in a local **Test** workspace with a synthetic `pike point.pdf`, in text and by voice with the panel closed. Run it beside an ordinary dev server with `VEXBOT_E2E_PORT=5181 VEXBOT_MOCK_TRANSCRIPT='Summarize pike point.pdf' npx playwright test -c playwright.vexbot.config.ts`.

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
