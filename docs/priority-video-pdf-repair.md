# Priority video viewer and proposal PDF repair

Implemented locally in the canonical `portal` checkout. No commit, push, deployment, hosted SQL mutation, file replacement or production cache update was performed.

## Findings and evidence

### Proposal PDF

Read-only diagnosis located the existing proposal in its recorded workspace and `portal-private` bucket. The path starts with that workspace ID, the metadata declares `application/pdf` and 55,202 bytes, and the downloaded object has exactly 55,202 bytes and a valid `%PDF-1.4` header. PDF.js opens it and extracts **11,835 characters across four pages**. The original file is not damaged according to these checks. The production cache instead contains `status=failed`, revision `index-v2`, and the generic note `Text extraction failed.`

The confirmed failure stage is extraction/cache reuse, after document identification. The old code swallowed every parser exception, cached failures for 24 hours and described generic failures as possible damage. The current diagnostic Storage download succeeds; there is no evidence of a missing object, expired signed URL or denied server download in this case. VexBot downloads directly through the server SDK; it does not consume the video's one-hour browser playback URL. Supabase supports authenticated private downloads separately from time-limited signed URLs ([documentation](https://supabase.com/docs/guides/storage/serving/downloads)).

The previous loader imports only PDF.js's API. PDF.js discovers its worker using a computed sibling-module import, which serverless dependency tracing can miss. A local package lacking that sibling reproduces `Setting up fake worker failed: Cannot find module ... pdf.worker.mjs`. Both the installed worker implementation and Mozilla's [PDFWorker documentation](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFWorker.html) confirm its in-process worker dependency. The repaired bundled parser successfully extracts the original PDF. **Missing worker packaging is a reproduced deployment failure mechanism, not a proven reading of the historical hosted exception:** that exception was discarded, and the Vercel connector returned a team-scope 403 when attempting to inspect the deployment. No infrastructure changes were made to work around that restriction.

### Video layout

The latest referenced customer screenshot was not present in this conversation. The current canonical viewer and the public deployed main stylesheet already specify a 98vw dialog. The initial browser run passed the existing near-viewport checks; the reported tiny centred modal was **not reproduced**. It would be inaccurate to claim a newly discovered 540px modal cap caused the current customer screenshot. General dialogs do have a 540px default, but the current video class already overrides it.

Confirmed chapter constraints were a 310px minimum sidebar, 64px thumbnail, and three-line title clamp, with timestamps below titles. The layout breakpoint also used the browser viewport instead of the actual player width. This can keep an inline Videos-page player in two columns even when portal navigation has removed much of its usable width. The fix sizes the columns from the player container itself and gives the modal explicit, independent dimensions.

## Implemented repairs

- Viewer: **98vw × 96dvh**, no maximum-width cap, centred with small margins, constrained overflow and compact header. At 1440 × 900 the measured outer box is **1411.19 × 864px**; sidebar width is **453.72px**.
- Layout: approximately 67/33 columns with a 380px minimum chapter panel when the player container is at least 1100 CSS pixels wide. Narrower containers stack. This applies correctly to both a modal and the inline Videos page.
- Chapters: compact 16px number slot, 44px thumbnail, 14px single-line title, 12px right-aligned timestamp, subtle active state and at least 44px touch targets. Full text remains in the button's accessible name and native hover title. Normal titles fit; deliberately long titles use ellipsis.
- Playback: unchanged video node through chapter hiding, theatre and workspace fullscreen. Existing controls, captions, speed, PiP, seeking, markers, active chapter state, URL refresh and keyboard navigation remain.
- Supporting content stays collapsed. Body scroll lock, independent chapter scrolling, visible header and close behaviour remain.
- PDF.js: literal lazy imports for both API and matching worker, shared initialisation, and loading-task cleanup even when opening fails.
- Cache: extractor revision `index-v3` invalidates old results, including the observed failed cache. Failures retry after 30 seconds; successful extraction retains the existing maximum 24-hour lifetime. Concurrent requests share an in-process extraction, scoped by database, workspace, file and version fingerprint. Stale processing rows must also match the current fingerprint.
- Retrieval: verifies downloaded byte count and actual extraction size before parsing. Storage denial, missing object, signature mismatch, password protection, invalid PDF and service failures retain distinct internal codes and client explanations. Generic service failure no longer suggests damage.
- Diagnostics: logs stage/code, file/workspace IDs and HTTP status only. No raw SDK exception, token, object URL, file content or privileged credential is logged or returned.

## Actual proposal acceptance check

An unchanged copy of the original PDF was uploaded to a synthetic, authenticated **local-only** test workspace. The test seeded the old failed cache state and asked exactly:

> Can you open the proposal here and summarize it for me?

The request passed through the actual HTTP API, authentication, workspace checks, local private Storage download, extraction, cache, configured **OpenAI provider**, answer validation and persisted file citation. The test asserts that **all 11,835 extracted characters reach the provider**, that the result is `answered`, that it cites the correct local file ID, and that the cache becomes `ready` with revision `index-v3`. The generated summary's scope, commercial amount, timetable and exclusions were compared with the original extracted text. Test users, database records and Storage copies were cleaned up locally. Customer document text and the model output are retained only in ignored local artifacts, not this report or source control.

This verifies a real model call through the local route. It does not claim the undeployed hosted endpoint is repaired. No production conversation or cache record was changed.

## Validation

Executed successfully:

- Canonical checkout guard; branch `portal`.
- TypeScript, lint and production build. Existing main/Three.js chunk-size warnings remain.
- `npm test`: **187 passed**, no failures or skips. Includes real local Auth/Storage/API, cross-workspace isolation and database tests.
- Optional actual-proposal integration run: **5 passed**, including a live OpenAI summary, stale-cache recovery, concurrent workspace isolation, streaming and cancellation.
- Bundled PDF parser with the original PDF: **55,202 bytes → four pages / 11,835 characters**.
- Focused video browser suite: **7 passed**, covering six required dimensions and staff chapter editing/publication, thumbnail capture and client keyboard seeking.

The full portal browser run completed with **28 passed and two failures**: an initial page-load timeout and a logo assertion that read before image decoding. A subsequent serial run of all deletion/navigation tests and the expanded presentation test passed **7/7**, including both failures. The logo assertion now polls image readiness. The expanded presentation test also verifies container-based stacking and single-line titles on the inline Videos page. No product deletion/navigation behaviour was changed.

The first VexBot browser run completed with 8 passes, one failure, nine platform skips and two tests blocked by its serial group. The failed test typed a new question while the prior streamed answer was still saving, then pressed Enter while Send was disabled. It now waits for the real enabled control. The final complete rerun passed **11 tests**, with **nine platform-inapplicable skips** and no failures. It includes the exact proposal question, pricing follow-up, SOW selection, citation withdrawal, MFA, fallback without WebGL and recorded-voice interactions with synthetic microphone/provider fixtures. It does not certify live Realtime voice.

Logs: [Node tests](../artifacts/urgent-unit-tests.log), [video checks](../artifacts/urgent-video-tests.log), [full portal run](../artifacts/urgent-portal-tests.log), [portal rechecks](../artifacts/urgent-portal-recheck.log), [final VexBot suite](../artifacts/urgent-vexbot-recheck.log), [live proposal acceptance](../artifacts/pdf-diagnosis/route-tests.log), [production build](../artifacts/urgent-build-final.log).

The six viewer sizes are 1920 × 1080, 1440 × 900, 1366 × 768, 1024 × 768, 768 × 1024 and 390 × 844. Geometry checks assert viewport coverage, every chapter title's height is at most one line, timestamps do not overlap, no horizontal overflow, no modal scrolling, independent chapter scrolling, stacking at narrow widths, contain-fit video, playback continuity and fullscreen/close/scroll restoration. Screenshots use actual browser rendering with a synthetic video; they are not mockup images or customer video content. Browser toolbar zoom and Safari/iOS native fullscreen remain manual checks; responsive container behaviour was tested at the listed CSS viewport sizes.

| Browser viewport | Measured viewer | Chapter panel | Layout |
| --- | --- | --- | --- |
| 1920 × 1080 | 1881.6 × 1036.8 | 610.5px | Alongside |
| 1440 × 900 | 1411.2 × 864.0 | 453.7px | Alongside |
| 1366 × 768 | 1338.7 × 737.3 | 429.5px | Alongside |
| 1024 × 768 | 1003.5 × 737.3 | 969.5px | Stacked |
| 768 × 1024 | 752.6 × 983.0 | 718.6px | Stacked |
| 390 × 844 | 382.2 × 810.2 | 368.2px | Stacked |

## Browser evidence

- [Before this repair: 1440](../artifacts/pdf-diagnosis/video-after-1440.png)
- [After: 1920](../artifacts/screenshots/video-after-1920.png)
- [After: 1440](../artifacts/screenshots/video-after-1440.png)
- [After: 1366](../artifacts/screenshots/video-after-1366.png)
- [After: 1024](../artifacts/screenshots/video-after-1024.png)
- [After: 768](../artifacts/screenshots/video-after-768.png)
- [After: 390](../artifacts/screenshots/video-after-390.png)
- [Measured 1440 geometry](../artifacts/screenshots/video-geometry-1440.json)
- [Original PDF diagnosis](../artifacts/pdf-diagnosis/result-before.json)
- [Bundled parser verification](../artifacts/pdf-diagnosis/package-verification.json)

The before image already has a large dialog; the verified visual change is wider, single-line chapter navigation and balanced presentation at the requested 96dvh. We cannot substantiate a size comparison against an unavailable customer screenshot.

## Files and compatibility

Runtime: `server/vexbot/files.mjs`, `server/vexbot/sources.mjs`, `src/App.css`, `src/components/video/chapter-player.tsx`, `src/components/video/video.module.css`.

Verification: `scripts/verify-vexbot-pdf-package.mjs`, `tests/browser/video-chapters.spec.ts`, `tests/browser/presentation-reference.spec.ts`, `tests/browser/navigation-restoration.spec.ts`, `tests/vexbot-e2e/workspace-files.spec.ts`, `tests/vexbot-files-local.test.mjs`, `tests/vexbot-intelligence.test.mjs`, `tests/vexbot-stream-local.test.mjs`.

Documentation: this report, `docs/video-chapters.md`, `docs/vexbot.md`.

No new packages, database schema/RLS changes, storage policy changes, model/voice changes or Vercel settings were introduced. The worker is now discoverable through the source dependency graph; the actual hosted package/runtime still needs release verification. Authentication and current workspace inventory remain mandatory before cached contents are used. Existing uploads, immutable paths, signed playback URL lifecycle, private file permissions, admin draft/publication tooling, robot assets and voice workflows remain in place.

## Reproduction and release checks

```powershell
node scripts/require-portal-checkout.mjs
npm run typecheck
npm run lint
npm test
# Sequentially after npm test, because these suites share the local database:
npx playwright test -c playwright.vexbot.config.ts
npx playwright test --workers=1
npm run build
node scripts/verify-vexbot-pdf-package.mjs
```

For the optional private-file acceptance check, use an authorised local PDF copy and the existing server provider configuration. This flag performs a live model call; database and Storage writes remain guarded to loopback:

```powershell
$env:VEXBOT_REPAIR_PDF = 'artifacts/pdf-diagnosis/proposal-original.pdf'
$env:VEXBOT_REPAIR_LIVE = '1'
node --test tests/vexbot-stream-local.test.mjs
Remove-Item Env:VEXBOT_REPAIR_PDF, Env:VEXBOT_REPAIR_LIVE
```

After separately approved deployment, verify the actual hosted authenticated question and responsive viewer, inspect safe extraction stage codes if needed, and confirm the first `index-v3` refresh. No manual production cache edit is needed. Extraction of scanned PDFs still requires a text layer/OCR; this patch adds no OCR or transcription. Serverless extraction that exceeds its existing request wait still lacks a durable background queue. Distributed locking, content hashing for out-of-band object replacement and hosted runtime verification remain outside this repair.
