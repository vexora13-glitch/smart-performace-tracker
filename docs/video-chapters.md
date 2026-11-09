# Video chapters in the canonical portal

Use `D:\Projects\smart-performance-tracker` on branch `portal`. Run `node scripts/require-portal-checkout.mjs` there before making portal changes.

## Test locally

1. Use the local Supabase stack and confirm the target is `127.0.0.1:56422`. Run `supabase migration list` and `supabase db push --include-all --dry-run` to review what is pending. The new chapter migration is `20261109100200_portal_video_chapters.sql`. The dry run may also list earlier pending migrations. Apply those only if they are intended and approved for that local database.
2. Apply the reviewed batch. Run `supabase migration list` again and confirm that the local database lists the new revision. If Storage is still using the previous 50 MiB global limit, restart the local stack with the updated config. For private client uploads, the scanner also needs to accept 100 MiB.
3. Run `npm run dev:localtest` and use the URL it prints, normally `http://localhost:5186`. Sign in as an administrator, open a workspace, and look for **Manage video chapters** beside an MP4 or WebM under **Shared files**.
4. Add two chapters, capture a frame, reorder the list, and save a draft. Open the same workspace as a client and verify that the draft stays private. Publish, reopen the video, and try the chapter cards, timeline markers and keyboard navigation. Confirm that a second client without workspace access cannot read the chapters or sign the thumbnail URLs.

The existing canonical shared-file workflow supports MP4 and WebM uploads up to 200 MiB (`20261110120000_portal_video_upload_200mib.sql`). Private VexBot upload limits remain separate. Documents and images keep their existing limits. Existing video files and downloads use the same storage paths. Chapter links inherit workspace access and expire after one hour. Removed thumbnail objects stay private and are collected by the existing workspace deletion flow.

## Presentation workspace

Client video dialogs occupy 98vw × 98dvh. At desktop widths the video and chapters use a roughly 74/26 split, with a minimum 310px chapter panel; smaller screens stack chapters below the player. The header exposes chapter visibility, theatre mode, workspace fullscreen and close. A separate media fullscreen control remains available. Hiding chapters and changing theatre/fullscreen modes preserve the same video DOM node and playback state. The chapter list retains its scroll position when hidden. Supporting instructions are collapsed, background scrolling is locked while the dialog is open and restored on close. Admin draft, publish, ordering, frame capture and thumbnail workflows use the existing player and services.

Run `npx playwright test tests/browser/video-chapters.spec.ts` for five viewport checks and admin-to-client chapter publication/keyboard seeking. The broader presentation-reference test covers playback, volume, captions, speed, chapter updates and responsive screenshots. See [the implementation report](unified-portal-upgrade-report.md).
