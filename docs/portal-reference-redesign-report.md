# Vexora client portal — reference redesign report

Implemented locally in `D:\Projects\smart-performance-tracker`, branch `portal`. The archived VexBot worktree was preserved. No commit, push, deployment, hosted migration or customer-content replacement was performed.

## Design audit and implementation

Opened `docs/Vexora.png` directly before editing. The reference is 1672 × 941, with a 255px sidebar, a presentation heading, approximately 890px-wide player, a 460px chapter panel, a 20px column gap, and an information card below the presentation metadata.

The previous portal used the public website's charcoal/lime tokens, a different logo, compact sidebar navigation, native video controls plus separate seeking tools, and a small metallic robot with violet lighting. The existing app already supplied authentication, workspace membership, private storage, a chapter editor, revisioned draft/published chapter records, and a fully animated robot with chat, voice and retrieval. These systems were reused.

The redesign adds the reference's navy shell, violet navigation gradient, cyan highlights, V-shaped brand mark, presentation icon, outlined Download/Share buttons, user profile, chapter rows and lower information panel. The Videos sidebar item opens an actual full-page presentation. Documents, Workspace, Project Updates, Team & Contacts and AI Assistant connect to existing data and actions. Staff Clients, Messages and VexBot management remain available.

The breadcrumb and presentation headings use the selected video's name. Duration, chapter count, chapter titles, timestamps and signed thumbnail URLs come from actual media metadata and chapter records. No reference screenshot, example title, example chapter or example thumbnail was installed as production video content.

## Design tokens

| Token / purpose | Implemented value |
| --- | --- |
| Main background | `#09172B` |
| Sidebar | `#071326` |
| Surface / card | `#10213A` |
| Elevated surface | `#162A48` |
| Primary purple | `#6545F5` |
| Primary accent / focus | `#8264FF` |
| Blue | `#3564FF` |
| Cyan | `#21D9FF` |
| Main text | `#F7F9FF` |
| Secondary text | `#B7C7E5` |
| Border | `#2B4268` |
| Active navigation | `linear-gradient(110deg, #6545F5, #5149F6)` |
| Sidebar width | `255px`; `76px` tablet rail |
| Font | Locally hosted Geist; system fallbacks |

Reference pixel samples confirmed the gradient's navy range: `(1000,930)` = `#091527`, sidebar `(20,100)` = `#081222`, chapter surface `(1200,190)` = `#112036`, and lower information surface `(1550,850)` = `#16263F`. Layered backgrounds and translucent surfaces reproduce this range; the table records reusable base tokens rather than treating a gradient as one flat colour.

## Video player and chapters

- Actual uploaded video remains served through the existing private storage and signed-URL service.
- Custom controls provide play/pause, ±10-second seeking, current/total time, mute, volume, speed settings, captions when tracks exist, picture-in-picture where supported, and fullscreen. Native controls remain the initial fallback before enhanced controls mount; iOS native fullscreen is supported as a fallback.
- The content retains a measured 16:9 aspect ratio. Controls sit below the content within the rounded player surface.
- The thin buffered/played timeline has violet glow markers positioned at real chapter timestamps, with accessible seeking controls and keyboard support.
- Space/K toggle playback; J/L rewind/forward; arrow keys seek; M mutes; F opens fullscreen. Chapter buttons work with normal keyboard navigation.
- The chapter panel includes total duration, numbered thumbnails, aligned timestamps and a purple active row. It follows playback automatically and seeks immediately when selected.
- Fixed a media-engine precision issue: a seek to a fractional timestamp could round slightly below the record's start time and leave the previous chapter highlighted. Chapter selection now compares at the records' millisecond precision, with regression coverage.
- Private downloads retain the original filename. Share copies or shares an authenticated portal location containing a file ID, never a signed storage token; reload and same-page hash navigation resolve the selected accessible video.

## Administrator chapter management

Reused the existing editor and backend contracts: create/edit titles and descriptions; enter start/end timestamps or capture current time; upload or capture thumbnails; move chapters up/down; delete; preview; save draft; publish. Existing upload compression, private thumbnail paths, optimistic revision checks, validation and workspace policies remain intact.

Closing the editor refreshes the presentation's published chapters. There is no new backend schema or migration in this redesign. The existing local `portal_video_chapter_sets` relation was checked through loopback PostgREST and returned HTTP 200. Database tests exercise actual SQL persistence and policies in PGlite; browser chapter-editing tests use an isolated service fixture.

## VexBot

**Source-verified:** the existing GLB, hierarchy, twelve animation clips, gait metadata, speech configuration, voice identity, chat, retrieval, workspace context and upload services remain in use. The original GLB bytes are unchanged and remain protected by the existing asset hash test.

Runtime 3D changes include white/silver armour, a separate white helmet finish, cyan emissive materials, larger round eyes with dark pupils and highlights attached to the existing blink joints, a curved cyan smile, additional ear rings, a slightly larger helmet inside the original vertical envelope, and a cyan/violet V chest badge. These are rendered meshes, not a PNG overlay.

The character grows into the available lower-left sidebar space while retaining collision checks and room for its flight silhouette. Short viewports use the reserved control bar. Switching between responsive docks transfers directly, preventing the previous desktop-sized character from travelling across mobile content. The launcher, voice controls, Hide robot, Keep still, WebGL fallback and reduced motion remain available.

**Limitation:** the original procedural model has a slimmer torso, longer legs and different helmet/body geometry than the reference. Its white/cyan finish and face are closer, but it is not an exact sculpt. Exact reproduction would require a purpose-built rounded model, retargeted to the existing joint/clip contracts and revalidated for movement bounds. No substitute static illustration was introduced.

## Responsive and accessibility verification

Desktop uses the reference's player/chapter proportions. Smaller available columns place chapters below the video. Tablet uses a compact sidebar rail; mobile uses a compact brand bar plus a keyboard-accessible navigation dialog. All chapter thumbnails remain available in the scrollable chapter list.

At 320px, playback controls use two rows so fullscreen and settings remain reachable. Headings and action buttons wrap independently; the breadcrumb truncates within its allotted space. The assistant reserves space rather than covering the composer or video. Focus outlines, meaningful labels, keyboard chapter controls and reduced motion are retained.

Screenshots and measured aspect ratios are stored in the artifacts below. The browser checks include horizontal overflow, fullscreen-button bounds, narrow-heading width, settled responsive robot placement and preservation of assistant drafts.

## Visual evidence

The screenshots use a real six-second test upload, isolated chapter records and a synthetic client account. Its blue video frames, short duration, account name and missing saved thumbnail imagery differ from the reference. Production displays the selected customer's uploaded content and thumbnails. The source reference is never used as a video frame or poster.

- [Original design](Vexora.png)
- [Reference-size desktop viewport](../artifacts/portal-reference/desktop-viewport.png)
- [Full desktop](../artifacts/portal-reference/desktop.png)
- [Laptop](../artifacts/portal-reference/laptop.png)
- [Tablet](../artifacts/portal-reference/tablet.png)
- [Mobile](../artifacts/portal-reference/mobile.png)
- [320px mobile](../artifacts/portal-reference/small-mobile.png)
- [Interactive reference/implementation divider](../artifacts/portal-reference/comparison.html)
- [Measured video dimensions](../artifacts/portal-reference/measurements.json)

The desktop layout was compared visually with the source image, then refined for heading/player alignment, chapter row fit, timeline thumb alignment, branding and robot appearance. Responsive captures exposed and prompted fixes for a squeezed mobile heading, breadcrumb overflow, clipped narrow controls and robot travel during resize. This is a close reference implementation with the stated content/model differences; no pixel-perfect claim is made.

## Files changed for this work

| File | Purpose |
| --- | --- |
| `src/design/tokens.css` | Navy/purple/cyan palette and reference dimensions |
| `src/design/Brand.tsx` | Portal mark and subtitle |
| `public/brand/vexora-portal-mark.svg` | Lightweight V-shaped gradient mark |
| `src/App.tsx` | Sidebar destinations, user profile, dynamic breadcrumbs and shared-video navigation |
| `src/App.css` | Shell, heading/actions, surfaces and responsive layout |
| `src/components/Workspace.tsx` | Full presentation page, video selector, secure sharing and existing content sections |
| `src/components/video/chapter-player.tsx` | Custom player controls, chapter rows and dynamic information |
| `src/components/video/video.module.css` | Player, chapter and editor styling |
| `src/components/video/video-chapters.ts` | Fractional timestamp precision fix |
| `src/vexbot/bot-stage.ts` | Reference material finish and 3D face/ear/chest additions |
| `src/vexbot/companion/stations.ts` | Larger safe sidebar placement and short viewport fitting |
| `src/vexbot/Vexbot.tsx` | Direct responsive dock transfer |
| `tests/browser/presentation-reference.spec.ts` | Playback, chapters, download/share, responsive verification and captures |
| `tests/browser/redesign.spec.ts` | Updated brand, scoped file tabs and custom-control assertions |
| `tests/browser/client-deletion.spec.ts` | Existing navigation test follows the Overview label |
| `tests/video-chapters.test.mjs` | Millisecond seek regression |
| `tests/vexbot-motion.test.mjs` | Reference materials and safe sizing assertions |
| `tests/vexbot-e2e/vexbot.spec.ts` | Actual cyan WebGL pixel verification |
| `tests/vexbot-local.test.mjs` | Wait for a genuinely post-cutoff Auth token across Windows/VM clocks |
| This report and local artifacts | Review and validation evidence |

Pre-existing client-deletion/API/dev-launcher changes and untracked work were preserved.

## Validation results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, no warnings |
| `npm run build` | Passed; existing >500kB bundle-size advisory remains |
| `npm test` — final full run | **172 passed, 0 failed, 0 skipped** |
| `npx playwright test --workers=1` | 19 passed |
| `npx playwright test --config playwright.vexbot.config.ts` | 10 passed; 8 expected platform-specific skips |
| Presentation browser recheck with picture-in-picture | Passed; entered and exited picture-in-picture |
| `git diff --check` | Passed |

The presentation browser test verifies real WebM loading/playback; backward/forward boundary clamping; timeline seeking; automatic chapter updates; mute/volume; captions with an available track; speed changes; fullscreen; picture-in-picture; original-name download; a token-free shared link surviving reload; responsive geometry; and the mobile AI Assistant destination. The chapter editor browser test verifies capture, reordering, draft save, publish, client permissions and mobile keyboard seeking.

The local VexBot suite verifies real WebGL cyan pixels and movement, chat, cited answers from files, attachments, voice controls, history, source revocation, read-only access, reduced motion, hidden-robot preference and no-WebGL fallback. Voice/answer generation uses the suite's explicitly configured mock provider. No live OpenAI conversation or hosted customer workspace was used for these checks.

An earlier full `npm test` run passed all 171 then-existing cases. The additional fractional-seek regression subsequently passed. A later concurrent validation run exhausted a Node worker's memory; subsequent full runs exposed an existing one-second credential-cutoff timing failure. The test now reads the recorded cutoff and waits for Auth to issue a genuinely newer JWT, accommodating Windows/local-VM clock differences. Its original denial assertions remain unchanged; production authentication and authorization code were not modified. The focused local API suite passed all 10 checks after this test-only correction.

The final full `npm test` run passed all 172 tests in 19.9 seconds. Validation logs: [unit/database suite](../artifacts/portal-reference-tests-complete.log), [portal browser suite](../artifacts/portal-reference-browser-final.log), [local VexBot browser suite](../artifacts/portal-reference-vexbot-e2e.log), and [picture-in-picture presentation recheck](../artifacts/portal-reference-pip.log).

## Remaining limitations and follow-up

- The robot's exact silhouette needs a replacement modelling asset and animation retargeting, as described above.
- The reference's search/bell/account-menu artwork differs from the retained working refresh/sign-out header controls. Account identity and media imagery remain real data rather than copied reference text.
- The existing media schema has no caption-upload management UI. The player supports captions supplied through available browser text tracks or its caption-track interface; it does not invent subtitles for uploads without captions.
- iOS Safari, Android native picture-in-picture, hardware GPU frame rates and a paid live AI/voice call were not exercised. Browser results are Chrome/Chromium and the isolated local services described above.
- The main and dynamically loaded Three.js chunks still trigger Vite's size advisory. No dependencies or heavyweight animation frameworks were added. The robot remains dynamically loaded, uses low-power WebGL and retains the existing resting/reduced-motion render limits.
