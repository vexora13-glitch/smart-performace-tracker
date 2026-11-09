# Video chapters in the canonical portal

Use `D:\Projects\smart-performance-tracker` on branch `portal`. Run `node scripts/require-portal-checkout.mjs` there before making portal changes.

## Test locally

1. Use the local Supabase stack and confirm the target is `127.0.0.1:56422`. Run `supabase migration list` and `supabase db push --include-all --dry-run` to review what is pending. The new chapter migration is `20261109100200_portal_video_chapters.sql`. The dry run may also list earlier pending migrations. Apply those only if they are intended and approved for that local database.
2. Apply the reviewed batch. Run `supabase migration list` again and confirm that the local database lists the new revision. If Storage is still using the previous 50 MiB global limit, restart the local stack with the updated config. For private client uploads, the scanner also needs to accept 100 MiB.
3. Run `npm run dev:localtest` and use the URL it prints, normally `http://localhost:5186`. Sign in as an administrator, open a workspace, and look for **Manage video chapters** beside an MP4 or WebM under **Shared files**.
4. Add two chapters, capture a frame, reorder the list, and save a draft. Open the same workspace as a client and verify that the draft stays private. Publish, reopen the video, and try the chapter cards, timeline markers and keyboard navigation. Confirm that a second client without workspace access cannot read the chapters or sign the thumbnail URLs.

Shared and private MP4 uploads support up to 100 MiB. The canonical portal already supported documents, images and WebM up to 50 MiB and keeps that limit. Existing video files and downloads use the same storage paths. Chapter links inherit workspace access and expire after one hour. Removed thumbnail objects stay private and are collected by the existing workspace deletion flow.
