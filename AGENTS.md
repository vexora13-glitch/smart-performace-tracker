# Canonical portal development

All future development for this project must use the existing canonical checkout:

- Repository: D:\Projects\smart-performance-tracker
- Branch: portal

This applies to portal UI, VexBot, voice, backend, tests, documentation and tooling.
Before editing, run node scripts/require-portal-checkout.mjs from the repository root.
Both dev launch commands enforce the same check at startup.
Do not develop in smart-performance-tracker-vexbot or another checkout. Do not switch
to another branch or create another development branch or worktree unless the user
explicitly requests it. An existing alternate worktree is not permission to use it.
Preserve newer canonical portal functionality when integrating older visual work.

Do not commit, push or deploy without the user's explicit approval.

## Local verification

Run npm test and the VexBot Playwright suite sequentially. They share the local
Supabase stack, and the API tests retire synthetic documents used by browser tests.
Use npm run dev:localtest and the existing isolated Playwright configuration for
operations that write synthetic data. Keep production credentials and configuration
separate. Verify which checkout owns a preview server before reporting its URL.
