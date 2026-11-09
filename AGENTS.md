# VexBot development

All subsequent VexBot development must happen on `portal` in this repository,
`D:\Projects\smart-performance-tracker`.
Do not switch to `vexbot`, create another development branch, or create another worktree
for VexBot work.

Run `npm test` and the VexBot Playwright suite sequentially. They share the local
Supabase stack, and the API tests retire synthetic documents used by browser tests.
