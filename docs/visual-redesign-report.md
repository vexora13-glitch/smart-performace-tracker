# Vexora portal visual redesign

> Historical source audit and original-worktree verification. The redesign has now been integrated into the canonical portal checkout. For current functionality, test counts, preview ownership and Git status, see [Canonical integration report](portal-visual-integration-report.md). Original counts and entry-bundle figures below describe the older source snapshot.


Implemented locally on 9 November 2026. No commit, push or deployment was made.

## A. Design audit

**Source verified:** inspected `D:/Projects/Vexora-website/src/app/vexora.css`, `layout.tsx`, the current homepage, `new-website/scroll-reveal.tsx`, and `companion/companion.module.css`. The current homepage uses the newer `nw` design system; the checkout also contains older lavender styles that are not the current public homepage's theme.

**Execution verified:** visited https://vexoradigital.com (redirects to https://www.vexoradigital.com/), extracted its computed CSS variables and font families, and captured desktop/mobile screenshots using `scripts/capture-design-reference.mjs`. The live values agree with the local source. Evidence is in `artifacts/redesign/reference/audit.json` and the adjacent PNGs. Browser connector access was unavailable; the public reference was successfully captured with Chrome through Playwright after network access approval.

| Property | Verified website value |
| --- | --- |
| Background / second layer / surface | `#0b0d0e` / `#101413` / `#141817` |
| Primary accent / hover / accent text | `#c8f56a` / `#d8fb8e` / `#10140a` |
| Main / secondary / muted text | `#f6f7f4` / `#bfc4bf` / `#8f9590` |
| Border / stronger border | `#262b29` / `#3a413d` |
| Success / danger | `#c8f56a` / `#ff9bb0` |
| Card gradient | `linear-gradient(180deg, #171c1a 0%, #101413 100%)` |
| Radii | 8 / 12 / 18px |
| Website shadow | `0 0 0 1px #c8f56a0f, 0 18px 50px #00000080` |
| Font | Geist, variable weights 100–900; section headings typically 650–700 |
| Micro / page duration | 160 / 220ms |
| Easing | `cubic-bezier(.2,.7,.2,1)` |

The website has a dark header, muted navigation, lime active underlines, outlined secondary buttons, restrained primary-button glow, thin card borders, and dark gradient surfaces. Blur appears in the header and dialog backdrop. Its blue/purple gradient is part of the actual logo; it is not the primary UI accent. Lucide iconography is shared with the portal.

Website display headings are approximately 40–68px, with 16px body type. The portal adapts this to 28–40px page headings and 14px application text to suit dense business information. Spacing uses a centralized 4/8/12/16/24/32/48px scale. Portal breakpoints remain 560/800/1100px, supplemented by a 720px content-column container query when the assistant reserves space.

Website motion includes brief page fades/rises, one-time below-fold reveals (600ms with a 24px rise), staggered section reveals, and interactive workflow demonstrations. The portal adapts those entrances to a shorter 220ms/8px movement. It does not copy the marketing demos' continuous animations into ordinary work screens.

**Existing portal audit:** React/React DOM 19.2.7, Vite, TypeScript, custom CSS, Lucide, Supabase, native HTML dialogs, and a dynamically imported Three.js renderer. No pre-existing React motion package. Existing motion consisted of CSS button colour/shadow transitions, a busy spinner, canvas opacity transitions, and the robot's independent frame-driven animator/director/flight engine.

All existing user-facing areas were covered: login and access errors; sidebar/header/dashboard/client list; workspace selector and workspaces; shared document/video library and private uploads; updates; messaging and archive/new-conversation forms; client/team/credential dialogs; VexBot text/voice/history/attachments; MFA, knowledge, uploads, profile, behaviour, preview and history settings; loading/empty/error/status states. This repository has no separate project-routing module, media-player implementation, drag-and-drop upload zone, attachment system for team Messages, or live teammate typing protocol. Existing native video controls and supported file-picking interfaces were retained.

## B. Implementation

| Files | Change |
| --- | --- |
| `src/design/tokens.css` | Shared brand, font, surface, type, spacing, radius, shadow, focus, gradient, timing and breakpoint tokens; documented portal extensions |
| `src/design/Brand.tsx` | Reusable real logo/wordmark |
| `src/design/motion-tokens.ts` | Shared seconds-based timing/easing and controlled spring |
| `src/design/motion.tsx`, `motion-features.ts` | `VexoraMotionProvider`, `VexoraPageTransition`, `VexoraReveal`; async-loaded Motion features |
| `src/main.tsx` | Persistent global motion configuration |
| `src/index.css`, `src/App.css` | Shared buttons/inputs/cards/statuses, complete branded shell/login/content/dialog/responsive styles |
| `src/App.tsx` | Collapsible sidebar, animated active navigation, native mobile navigation dialog, page/reveal motion, labelled navigation, skip link and loading status |
| `src/components/Login.tsx` | Brand asset, dark split layout, short form entrance; unchanged sign-in calls |
| `src/components/Workspace.tsx` | All files/Documents/Videos filters, animated selection/rows/publish form, truthful busy state, labelled native video/removal dialogs |
| `src/components/Chat.tsx` | Conversation/filter/message transitions, bottom-aware scrolling, jump-to-latest action |
| `src/components/ClientDialog.tsx` | Explicit accessible title and trigger focus restoration |
| `src/components/VexbotAdmin.tsx` | Shared branded styles, moving tab indicator, content transitions, arrow/Home/End keyboard support and tab-panel relationships |
| `src/vexbot/Vexbot.tsx`, `vexbot.css` | Panel/history/message/attachment motion, branded bubbles/controls/sources, truthful recording/thinking/speaking state styling |
| `public/brand`, `public/fonts`, `index.html` | Unchanged source logo, matching favicon, local Geist Latin/Latin Extended with OFL notice, font preload and matching browser theme colour |
| `tests/helpers/portal-fixture.ts`, `tests/browser/*`, `playwright.config.ts` | Shared fixture helper, seven added UI regressions, isolated fixture server on port 5188 |

Installed **`motion@14.10.1`** with npm. Imports use `motion/react` and its lighter `m` components with `LazyMotion`. React 19.2.7 meets Motion's [React 18.2+ requirement](https://motion.dev/docs/react-installation). `framer-motion@14.10.1` appears only as Motion's own transitive dependency; it was not added as a direct dependency or imported by application code.

Existing native controls/dialogs were retained and restyled rather than replaced by a second component library. The shared `.panel`, button variants, input styles, tabs, badges, loading and notice classes remain the reusable component system; redundant wrapper components were not added just to rename them.

No source changes to `api/`, `supabase/`, `src/services/`, `src/lib/`, or `src/types/`. Authentication, authorisation, RLS, roles, API contracts, database schema, Vercel/Supabase integrations, secrets and environment files were preserved. Local integration tests used synthetic accounts/data and the existing local mock AI/scanner providers.

## C. Motion coverage

| Area | Implemented motion and interaction | Reduction / performance |
| --- | --- | --- |
| Shell/navigation | Shared active indicator, desktop sidebar width transition, native mobile menu entrance, 220ms page rise/fade | Persistent content container, no animation-only route key; sidebar transitions disabled at small breakpoints to prevent resizing overflow |
| Dashboard/workspaces | Short overview/banner reveals, 40ms stagger between those two sections, consistent card/row hover | Entrances mount once; polling data does not replay them; static connected-system motif |
| Documents/media | Shared animated category indicator, short added/removed-row fades, upload-control feedback, publish-form entrance, native preview dialog entrance | Real upload status only; no fabricated percentage; native video/download behavior preserved |
| Team Messages | Conversation transition, active/archive indicator, only newly added message entrances | Existing history is not staggered; earlier-message readers keep position and get a jump-to-latest button |
| VexBot | 240ms surrounding-panel entrance, 160ms exit, history/attachment/message appearance; state-dependent composer border and recording control | Canvas stays outside Motion; no shared transforms or replacement of Three.js animation; drafts survive closing/reopening |
| Administration | Shared tabs/indicator, brief content transition, consistent forms/badges/MFA/status surfaces | State remains in existing admin component; arrow keys/Home/End supported |
| Forms/dialogs/notices | 160ms CSS hover/focus colour feedback, short native-dialog entrance and notice fade | Native focus/modal semantics retained; no wait before requests or form actions |

Global `MotionConfig reducedMotion="user"` follows the [official accessibility approach](https://motion.dev/docs/react-accessibility). Hooks additionally remove entrance/exit delays and translation in reduced mode. CSS disables nonessential transitions/keyframes; loading/status text remains. Robot reduced-motion/Keep still/Hide robot behavior is unchanged and covered by its existing tests.

**VexBot preservation:** source model, camera, materials, animation clips, station geometry, flight/director code, WebGL load delay and frame budgeting are unchanged. The portal's existing purple emissive eyes/chest are retained; the website's model normally uses lime emission. This is a deliberate retained difference, not a claim of identical material colour. Voice model, voice identity, transcription, speech settings, playback lifecycle, knowledge access and workspace scope are unchanged.

## D. Verification

| Check | Result |
| --- | --- |
| Dependency installation | Passed; npm reported zero vulnerabilities |
| `npm run build` | Passed; includes `tsc -b` |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed without warnings |
| `npm test` | 106 passed, zero skipped/failing, before and after implementation |
| `npm run test:e2e -- --workers=1` | 11 passed: four original flows plus seven redesign regressions |
| `npx playwright test --config playwright.vexbot.config.ts` | 7 applicable scenarios passed; 7 complementary desktop/mobile scenarios intentionally skipped |
| Responsive | 1440px desktop captures; shell/admin overflow checks at 1024/768/390/320px; actual Pixel 7 emulation and assistant side-column checks |
| Keyboard | Visible focus, mobile dialog, client modal Escape/return focus, assistant Escape/return focus and draft persistence, admin arrow/Home/End support |
| Media | A real silent WebM generated locally loads and advances playback; native controls/close focus verified; document download filename verified |
| Chat | Start/send/archive/reopen/sign-out; incoming refresh does not scroll earlier readers; jump-to-latest verified |
| Browser runtime | Tests assert no uncaught page errors; no failures in the completed runs |
| Scope review | Backend/service/schema/configuration sources unchanged; `git diff --check` passes |

The local Chrome integration suite covers staff MFA and the full knowledge review/publish/preview/history flow; client WebGL pixels, walking, flight and landing; grounded cited answers; no-answer behavior; attachments and malware-review status; voice recording/mute/resume/transcription; saved history; read-only access; source withdrawal; robot visibility preferences; no-WebGL fallback; reduced motion; and mobile sheet/composer access.

Voice integration uses Chrome's fake microphone and the existing **local mock provider**. Actual human microphone acoustics, production OpenAI transcription/speech quality, production storage/email delivery and live hosted authentication were not exercised. Email failures in fixture tests are intentional and verify the honest queued-notification notice. Physical Safari/iOS/Android devices and a full screen-reader audit remain unverified. No production writes were performed.

### Performance evidence

Vite production bundle measurements (kB, gzip as reported by Vite):

| Asset | Before | After |
| --- | --- | --- |
| Entry JavaScript | 213.74 / 68.67 gzip | 288.99 / 95.66 gzip |
| Async Motion features | None | 65.50 / 21.05 gzip |
| Three.js stage | 640.43 / 161.17 gzip | 640.43 / 161.17 gzip |
| Application CSS | 33.39 / 8.16 gzip | 42.13 / 9.02 gzip |

Motion adds approximately 48kB gzip including its asynchronously loaded features. It introduces no second rendering loop or broad tree layout animation. Shared layout animation is limited to small indicators. The renderer's chunk/hash is unchanged, and the pre-existing >500kB Three.js warning remains; the renderer is still loaded dynamically. Font assets add 29.3kB Latin plus an on-demand 16.5kB Latin Extended subset, and the real logo is 51.8kB. No controlled CPU/GPU/FPS or production Web Vitals benchmark was performed, so no claim of improved frame rate is made.

## E. Before and after

Open the local [comparison gallery](../artifacts/redesign/index.html), or inspect:

| Capture | Location |
| --- | --- |
| Public reference, desktop/mobile | `artifacts/redesign/reference/{desktop,mobile}.png` |
| Portal baseline | `artifacts/redesign/before/{admin-dashboard,login-mobile,client-messages-mobile}.png` |
| New desktop dashboard/login/workspace | `artifacts/redesign/after/{dashboard-desktop,login-desktop,workspace-desktop}.png` |
| New mobile login/messages/assistant/admin | `artifacts/redesign/after/{login-mobile,messages-mobile,assistant-mobile,admin-mobile}.png` |
| Real local integration captures | `artifacts/screenshots/` (knowledge, MFA, robot, citations, voice, attachment, permissions, mobile) |

The before/after changes replace pale lavender backgrounds, placeholder V marks, faint text, pastel cards and purple actions with the source logo/Geist, charcoal layers, stronger readable hierarchy, lime actions/selection, thin borders, source-matched radii and controlled motion. Captures use synthetic data; baseline and new screenshots may differ in viewport size and content scroll position. Screenshot artifacts are intentionally git-ignored, matching the repository's existing convention.

## F. Remaining recommendations and local inspection

1. Before approving production deployment, run a smoke test with an authorised nonproduction hosted account and the real AI/voice, storage/scanning and email services. This remains separate from the successful local mock-provider integration checks.
2. Check a physical iPhone/Safari device, real microphone/speaker interactions and a screen reader. The automated browser coverage uses Chromium/Chrome and Pixel emulation.
3. Profile production frame timing on a lower-powered device if further motion or 3D effects are added. The existing renderer chunk is the dominant payload and was preserved intentionally.

Development server: **http://localhost:5173/**, started with the existing `npm run dev` workflow and existing local configuration. Fixture tests use a separate frontend-only server at port 5188, so they cannot reuse the real-data development server. Local test credentials, if needed for inspection, remain in the pre-existing git-ignored `artifacts/vexbot-seed.json`; no credentials are copied into this report. Existing unrelated untracked files were left untouched.
