# Canonical portal visual integration

The latest canonical portal implementation and the visual redesign are now combined in **D:\Projects\smart-performance-tracker**, on **portal**. HEAD remains **aede3eb18e935cc88060d504b17de94f27fe9a21**; integration changes are uncommitted. Nothing was pushed or deployed. No new branch or worktree was created.

## What was integrated

The earlier redesign was recovered from uncommitted work in the older vexbot worktree at d62bbb019babcb4367b7a66951a8dbc53bc620d8. The current portal files were the integration base. Shared styling, brand assets, local Geist fonts, motion utilities, dashboard/login/shell styles, responsive navigation, dialogs, file-category filtering, chat scrolling and motion, VexBot UI motion, and administration styles were integrated. motion@14.10.1 is installed; its framer-motion dependency is transitive only.

Seven overlapping files were reviewed against the common base. package.json retained dev:localtest, google-auth-library and ws; its lockfile was regenerated in the canonical checkout. Workspace retained READABLE file detection and ASK_EVENT. App retained maybeSingle access handling and header logout. VexBot retained the complete current canonical behavior; only presentation JSX, a reduced-motion hook and imports were added. The current Talk/source controls were restyled with the shared tokens.

AGENTS.md now directs all future project work to this canonical checkout on portal. Another branch, checkout or worktree requires an explicit user request. It also retains the requirement to run the Supabase-dependent API tests and VexBot browser suite sequentially.

## Current functionality preserved

- Realtime two-way voice, WebRTC transport, interruption, mute/unmute, supervision and session cleanup.
- Hands-free Talk mode, recorded-voice fallback, audio playback, voice configuration and lifecycle.
- Separate Talk/Ask controls, voice conversation without opening chat, and history after voice.
- Shared-file questions, readable-file action, ASK_EVENT prefill, citations, source opening and withdrawal.
- Existing authentication, roles, workspace access, RLS, uploads/downloads, Gmail foundation and Vercel/Supabase integration.
- Exact existing GLB, Three.js renderer, animator, flight/director/station geometry and frame budgeting.

No changes to api/, server/, supabase/, src/services/, src/lib/, src/types/, scripts/dev.mjs, src/vexbot/realtime.ts, src/vexbot/voice.ts, the renderer or companion-engine sources. No environment files or secrets changed. A TypeScript AST comparison confirms all Vexbot component behavior statements are structurally identical to the canonical pre-integration version, excluding the added useReducedMotion hook and the presentation return tree.

## Canonical validation results

| Check | Result |
| --- | --- |
| npm install | Passed, zero reported vulnerabilities |
| npm run build (includes TypeScript) | Passed |
| npm run lint | Passed, no lint warnings |
| npm test | **163 passed**, zero skipped/failing |
| npm run test:e2e -- --workers=1 | **13 passed**, including desktop/mobile mocked realtime lifecycle |
| npx playwright test --config playwright.vexbot.config.ts | **10 passed**, 8 intentional device-specific skips |

The full VexBot suite exercised staff MFA/knowledge/publish/profile/preview/history; real WebGL pixels, walking/flight/landing; cited chat and attachments; recorded voice; read-only membership and source revocation; no-WebGL fallback and reduced motion; shared PDF questions and citations; and hands-free voice with the panel closed on desktop and mobile. The no-WebGL test deliberately emits a renderer-context error while verifying the fallback. Voice tests use the existing local mock provider and Chrome fake microphone; these results do not establish live provider audio quality or physical-device microphone behavior.

The API and VexBot suites ran sequentially against the existing local test stack. The fixture-only browser server uses port 5188, and the VexBot suite retains the canonical isolated localtest configuration on port 5181. No production writes were performed.

## Preview and screenshots

**http://localhost:5173/** now serves the canonical checkout. The older preview process was stopped. The served main.tsx explicitly identifies D:/Projects/smart-performance-tracker/src/main.tsx and imports VexoraMotionProvider. This was checked after starting npm run dev from the canonical directory.

- [Dashboard](../artifacts/redesign/after/dashboard-desktop.png)
- [Mobile login](../artifacts/redesign/after/login-mobile.png)
- [Mobile assistant](../artifacts/redesign/after/assistant-mobile.png)
- [Shared-PDF cited answer](../artifacts/screenshots/files-01-text-summary-cited.png)
- [Mobile hands-free voice and source](../artifacts/screenshots/files-mobile-04-voice-reply-with-source.png)
- [Comparison gallery](../artifacts/redesign/index.html)

The comparison gallery and public-reference evidence were retained; current after screenshots were regenerated by tests in this canonical checkout. The original design audit remains in visual-redesign-report.md, explicitly identified as historical rather than canonical validation.

## Performance and remaining limits

Current production output: entry JS 616.13 kB / 181.34 kB gzip; asynchronous Motion features 65.50 / 21.05; CSS 45.94 / 9.61; renderer 640.43 / 161.17. The renderer hash is unchanged (bot-stage-C8-ocLbl.js). Vite reports >500 kB chunks. The older redesign's entry measurements are not a valid canonical before/after comparison because portal adds realtime voice and other newer functionality. No controlled production CPU/GPU benchmark was performed.

Live hosted authentication, production email/storage/scanner/AI services, real microphone acoustics and physical Safari/iOS/Android devices were not tested. They remain deployment smoke-test recommendations; no production readiness claim is made for those external services.

## Latest-version status and recovery

**Yes: the local portal working tree has the latest canonical functionality plus the integrated visual redesign.** The Git commit and origin/portal still point to aede3eb until separately approved commit/push actions. Untracked design assets must be included in any eventual reviewed commit; do not stage tracked files alone.

Original canonical versions of modified integration files and the import manifest are preserved in the git-ignored artifacts/portal-integration-backup directory. The old worktree was not deleted or reset; its unrelated files and original redesign remain untouched for recovery. It is not the active development or preview source.
