# Client deletion database setup

On 10 November 2026, a read-only check of the hosted Portal project
(`ccxkaqbajugimmtsztif`) confirmed that the REST API exposes neither
`portal_client_deletions` nor `portal_begin_client_deletion` or
`portal_finish_client_deletion`. The table request returns `PGRST205`.
The local test database has both functions. This explains why the locally served
portal can show deletion controls but return a generic server error when using
the hosted database.

## Required hosted update

User approval is required before applying these existing migrations:

1. `supabase/migrations/20261109100000_client_deletion.sql`
2. `supabase/migrations/20261109100100_client_deletion_mail_links.sql`

The first adds a service-role-only deletion job table and begin/finish functions,
revokes client access before file cleanup, prevents restoring access during
pending deletion, and permits Auth deletion to cascade to the client's profile
and workspace. The second cascades workspace mailbox links and publications;
shared mailbox data remains with its organisation. Applying these migrations
does not itself request deletion of any client or remove uploaded files.

Before applying, inspect the hosted migration history, table constraints and
existing functions using an account with database administration access. The
connected accounts available during diagnosis could not query this project's
database catalog (403), so that inspection remains required. Reconcile any
migrations applied outside the migration runner. Apply only the two reviewed
migrations in order; do not blindly push every pending migration. No unrelated
feature migration is part of this repair.

After applying, verify both RPCs and the job table are exposed to the service
role, that anon/authenticated roles cannot execute the deletion RPCs, and that
the Auth/profile/workspace and mailbox link constraints match these migrations.
Then the administrator can retry their intended client deletion in the portal.
Use the isolated local database for synthetic deletion tests.

## Error handling

The deletion API returns HTTP 503 with a database-update message when beginning
deletion fails because its database schema is absent. Storage and Auth cleanup
do not run after this failure. Unexpected provider errors retain the generic
message and never expose provider details. Partial cleanup failures retain the
existing durable retry flow.

## Local verification (10 November 2026)

- `npm test`: 206 passed, including database deletion, workspace isolation,
  revoked sessions, private RPC permissions and missing-schema error handling.
- Client deletion Playwright tests: 4 passed (confirmation, bulk selection,
  partial failure/retry and mobile/client access).
- `npm run build` and `npm run lint`: passed. Build retains its bundle-size warning.
- VexBot Playwright suite, run after `npm test`: 8 passed, 1 failed, 8 skipped
  and 3 did not run. The failure was outside the deletion path: the read-only
  member chat at `tests/vexbot-e2e/vexbot.spec.ts:244` remained at
  "Reading your workspace" without an assistant reply within 20 seconds.
  The failure trace is retained under `artifacts/playwright/vexbot`.

No hosted migrations, client deletions, commits, pushes or deployments were
performed during this repair.
