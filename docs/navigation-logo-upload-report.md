# Navigation, logo and video upload corrections

Changes remain local in `D:\Projects\smart-performance-tracker`, branch `portal`. No commit, push, deployment or hosted database/storage update was performed. Existing customer data and uploaded videos were preserved. The archived worktree was not edited.

## Navigation and design

The desktop sidebar and mobile menu now share one navigation definition. Full-sized items retain the current navy surfaces, violet/blue active gradient, spacing, icons and hover/focus treatment. The miniature secondary links were removed.

| Item | Existing destination and permissions |
| --- | --- |
| Dashboard | Original staff dashboard; customers return to their complete workspace, including updates and private file submission. |
| Clients | Original client management and workspace selection; staff only. Existing create, membership management and delete controls remain. |
| Messages | Original conversation list, unread counts and messaging. Existing workspace read/write rules remain. |
| Documents | Existing shared file library with the Documents filter selected. |
| Videos | Existing real video library, redesigned player and published chapters. The staff upload control is also available when a presentation is open. |
| VexBot | Original staff knowledge/settings area, including its MFA gate; customers open the existing chat/voice assistant. The floating assistant remains available to staff. |

The redesign's redundant Overview, AI Assistant, Workspace, Project Updates and Team & Contacts sidebar entries were consolidated. Their underlying workspace, update, contact/messaging, membership and assistant capabilities remain available through the original pages. No role or backend permission was broadened. These are state-based application destinations, as in the existing application; no replacement routing framework was introduced.

The video/chapter layout, cards, typography, responsive shell and 3D robot styling were retained. The player gained more descriptive network/format/decoder error text, without changing its controls or chapter appearance.

## Authentic logo

Restored the existing `public/brand/vexora-logo.png` asset. Git commit `fe18b77` (`Style update vexora digital`) used that exact file in `src/design/Brand.tsx`. `public/brand/README.md` records its origin as `D:/Projects/Vexora-website/public/vexora-logo.png`, the source used by vexoradigital.com.

The file was not regenerated or recoloured. Its current Git blob hash and the original HEAD asset both equal `871709469ce36665d1472585b6a0aaec2f6b6125`. CSS uses automatic image height to preserve its proportions. The original accompanying wordmark arrangement remains, styled within the redesigned shell. The unused replacement SVG from the previous work remains on disk but is no longer referenced by the brand component.

## Diagnosis of the 89 MB failure

**The exact historical failure is not established.** The original failed file, its extension/codec and its browser/server error were not available during this implementation. An optional request for that information was sent. It would be incorrect to attribute that specific failure to file size alone.

Confirmed findings:

- The old shared-file frontend permitted MP4 up to 100 MiB, but WebM only up to 50 MiB. An 89 MB WebM was therefore rejected before any storage request. Both supported video types now allow 200 MiB.
- A read-only query of the configured hosted project found `portal-private` private, with a 104,857,600-byte bucket limit and both `video/mp4` and `video/webm` allowed. There were no `portal_files` records above 50 MiB at the time of inspection. This does not prove whether a failed transfer left an unregistered object.
- The original bucket migration used 50 MiB; the chapter migration raised the bucket and MP4 metadata limit to 100 MiB. Different deployments can therefore have different effective limits if migrations or project configuration differ.
- A real 89 MiB MP4 **succeeded locally through the old standard-upload path**, before the new upload code was tested. The local Storage container had `FILE_SIZE_LIMIT=52428800` in its environment, but this observed upload shows that environment value alone was not its effective cap. It is not presented as the proven root cause.
- File bytes already travelled directly from the browser to Supabase. The application API and Vercel function body limit were not on this upload data path. There was no signed-upload-URL lifetime involved in the old shared-library upload; uploads used the authenticated Storage SDK. Playback uses separate expiring signed read URLs.
- The old standard transfer provided no byte progress, resumable chunks or pause/resume. Network interruption, a different hosted project global cap, unsupported MIME/codec, or a metadata-registration failure remain possible explanations for the original attempt without its error evidence.

The confirmed WebM restriction and transfer reliability gaps have been fixed. Equivalent 89 MiB MP4 upload/playback now passes in the isolated local browser test. Rechecking the original failing customer file on the target deployment is still needed to close its specific diagnosis.

## Upload architecture and supported size

Shared portal MP4 and WebM: **200 MiB (209,715,200 bytes) maximum**. Other shared file types retain 50 MiB. There is no new video duration limit. Unsupported MIME types remain rejected.

Files above 6 MiB use the lazy-loaded `tus-js-client` library and Supabase's resumable Storage endpoint. Hosted Supabase URLs use the direct `.storage.supabase.co` hostname; loopback/custom domains remain unchanged. Requests contain 6 MiB chunks, not the entire video in application memory. No video payload is proxied through the portal API or a Vercel function.

Authentication is forwarded to Storage and checked by the existing Storage/RLS policies. Tokens are refreshed through the existing Supabase session mechanism before requests; no bearer tokens are put into resumable local-storage records. Resume fingerprints are scoped to signed-in user, workspace and file identity. Object paths remain unique, with overwrite disabled. The real `portal_files` record is written after transfer completion. Registration ignores duplicate paths without overwriting their metadata; after a failed save, cleanup first checks for an existing record and preserves registered objects or objects whose registration state cannot be confirmed. Two recovery tests cover a lost response after a commit and an unregistered failed save.

The interface shows percentage progress, saving/completion feedback, a pause/resume control for resumable transfers and failure details. Transient network/server errors retry with backoff and a server-offset check. A stalled XHR times out after 120 seconds and can retry. Selecting the same unchanged file in the same browser/profile can recover a stored TUS transfer after reload. Storage upload URLs expire after about 24 hours; older entries start a fresh upload. Browser storage being disabled prevents cross-reload recovery; current-session transfer/retry remains available.

`20261110120000_portal_video_upload_200mib.sql` raises the **shared library** database constraint for MP4/WebM and the `portal-private` bucket cap. `supabase/config.toml` now requests a 200 MiB local global limit for future starts. The migration was applied to the isolated local database only, without a reset. No storage container replacement or hosted configuration change was needed for the successful local 200 MiB test.

The separate quarantined VexBot attachment/private-submission pipeline retains its existing file limits and malware-review rules. It was not silently raised to 200 MiB, which would require separate scanner/runtime capacity work.

### Hosted limitation and rollout requirement

**200 MiB is verified locally, not on the hosted project.** The hosted bucket remains 100 MiB until the new migration is approved and applied. The hosted project plan and global file limit were not available through the configured service-role read API; no Supabase Management API credential was present.

For hosted support, the project global file limit must allow at least 209,715,200 bytes, and the bucket/database migration must be applied. Supabase documents a maximum global limit of 50 MB on Free projects; a project on that plan needs Pro or higher (or a different appropriate storage service) for 200 MiB. A bucket migration cannot override the project global cap. No plan purchase or remote setting change was made.

Primary documentation: [Supabase upload limits](https://supabase.com/docs/guides/storage/uploads/file-limits), [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads), [Vercel function limits](https://vercel.com/docs/functions/limitations).

## Verification and evidence

The local upload tests use real browser file selection, real Supabase Auth/Storage/PostgREST, isolated synthetic staff/customer/read-only accounts and private media URLs. Test-created completed files/accounts are removed afterward; no customer file is touched.

Fixtures are valid H.264 MP4 videos, eight seconds long, with an ISO BMFF `free` box extending the files to exact sizes. The complete byte payloads are transferred and persisted. They verify transport size, streaming, playback and seeking; they do not represent every customer codec or sustained high-bitrate decoding workload. Generation is reproducible with `node scripts/generate-upload-test-media.mjs` (ffmpeg required).

| Actual file bytes | Upload/metadata | Playback | Chapter seek | Range streaming |
| --- | --- | --- | --- | --- |
| 15,728,640 (15 MiB) | Passed | Advanced | 4 seconds | HTTP 206 |
| 93,323,264 (89 MiB) | Passed | Advanced | 4 seconds | HTTP 206 |
| 209,715,200 (200 MiB) | Passed | Advanced | 4 seconds | HTTP 206 |

The 89 MiB transfer also passed manual pause/resume; a forced transient HTTP 503 recovered automatically. Server upload offsets confirmed a largest accepted PATCH of 6,291,456 bytes (6 MiB). Customer and read-only accounts could play the uploaded library videos, while staff upload controls remained absent. The existing chapter editor/publishing and player-control regression tests are retained.

| Check | Final result | Evidence |
| --- | --- | --- |
| `npm run typecheck` | Passed | [Log](../artifacts/upload-typecheck-final.log) |
| `npm run lint` | Passed, no lint warnings | [Log](../artifacts/upload-lint-final.log) |
| `npm run build` | Passed | [Log](../artifacts/upload-build-final.log) |
| `npm test` | 175 passed, zero failures/skips | [Log](../artifacts/navigation-upload-unit-final.log) |
| Portal browser regression run, one worker | 21 passed | [Log](../artifacts/navigation-browser-final.log) |
| Final focused navigation/home/logo checks | 2 passed | [Log](../artifacts/navigation-screenshots-final.log) |
| Additional metadata recovery browser checks | 2 passed | [Log](../artifacts/upload-recovery.log) |
| Final real large-upload/playback/role suite | 2 passed, 3.3 minutes | [Log](../artifacts/upload-tests/browser-final-clean.log) |
| `git diff --check` | Passed | Only normal Windows line-ending notices |

There are 23 distinct portal browser cases across the regression/recovery runs, plus two real-upload cases; focused navigation rechecks are not additional unique cases. The existing build advisory for chunks larger than 500 kB remains. The resumable library is a separate on-demand chunk (about 60 kB uncompressed / 16 kB gzip), rather than part of initial portal loading.

To repeat the real transfer tests, start the isolated local Supabase stack, apply the new migration there, generate media with `node scripts/generate-upload-test-media.mjs`, then run `npx playwright test --config playwright.upload.config.ts`. The configuration starts its own `dev:localtest` server on port 5187 and refuses a non-loopback database. Run validation sequentially on this workstation to avoid memory/timing contention. Hosted media/codec behaviour and native Safari/mobile-device uploads were not verified.

Screenshots, directly inspected:

- [Updated desktop sidebar and dashboard](../artifacts/navigation-restoration/sidebar-desktop.png)
- [Sidebar detail](../artifacts/navigation-restoration/sidebar-detail.png)
- [Mobile navigation](../artifacts/navigation-restoration/sidebar-mobile.png)
- [Mobile logo and workspace](../artifacts/navigation-restoration/mobile-home.png)
- [Successful real 200 MiB upload, player and chapters](../artifacts/upload-tests/upload-200MiB-desktop.png)
- [Paused 89 MiB upload](../artifacts/upload-tests/paused-upload.png)
- [Machine-readable upload evidence](../artifacts/upload-tests/results.json)
- [Screenshot gallery](../artifacts/navigation-restoration/index.html)

Earlier validation attempts exposed a large-file time limit at 72% with binary request tracing/interception enabled, an assertion racing browser autoplay, and navigation cancelling a still-pending sign-out. The test harness now omits binary tracing, allows sufficient transfer time, starts playback from a known paused state and waits for sign-out before switching roles. A six-worker browser run hit the existing five-second media-readiness timeout; the suite passed with one worker. One overlapping unit/browser run exhausted a Node worker's memory; the sequential unit run passed all 175 tests. These intermediate failures are not omitted from this report.

## Files changed for this correction

| File | Change |
| --- | --- |
| `src/App.tsx` | One permission-aware primary/mobile navigation definition; original destinations and unread badge. |
| `src/App.css` | Removed miniature-link rules; original logo proportions; progress feedback styling. |
| `src/design/Brand.tsx` | References the authentic existing PNG. |
| `src/components/Workspace.tsx` | Progress/pause/resume and retained upload control beside an open presentation. |
| `src/services/portal.ts` | Shared video size validation and resumable transfer integration. |
| `src/services/resumable-upload.ts` | New lazy TUS helper, authenticated chunks, retries, scoped resume and errors. |
| `src/components/video/chapter-player.tsx` | More useful playback error descriptions. |
| `supabase/config.toml` | 200 MiB local global-size configuration. |
| `supabase/migrations/20261110120000_portal_video_upload_200mib.sql` | Video metadata constraint and private shared-bucket cap. |
| `package.json`, `package-lock.json` | Added resumable-upload dependency. |
| `scripts/generate-upload-test-media.mjs` | Reproducible real transport fixtures. |
| `playwright.upload.config.ts`, `tests/uploads/video-upload.spec.ts` | Real isolated local large-upload/playback/role tests. |
| `tests/browser/navigation-restoration.spec.ts` | Destination/permissions/logo/responsive navigation checks and screenshots. |
| `tests/browser/upload-recovery.spec.ts` | Lost metadata responses preserve registered objects and clean only unregistered new objects. |
| `tests/browser/client-deletion.spec.ts`, `tests/browser/presentation-reference.spec.ts`, `tests/browser/redesign.spec.ts` | Assertions updated for restored Dashboard/VexBot labels. |
| `tests/resumable-upload.test.mjs`, `tests/video-chapters.test.mjs` | Endpoint/error checks and database video-size boundaries. |
| This report | Implementation, diagnosis, test evidence and hosted limitations. |

The working tree already contained the visual redesign, client deletion work and other uncommitted changes. They were preserved; this report does not claim those as newly implemented corrections.
