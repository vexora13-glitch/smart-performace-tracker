# Release: Vexbot workspace files, voice and localtest consolidation

Prepared 9 November 2026. Nothing below is executed until the release is approved.

## Targets

| | |
| --- | --- |
| Source | `D:\Projects\smart-performance-tracker`, branch `portal` (PR #1 → `main`) |
| GitHub | `vexora13-glitch/smart-performace-tracker` (**public**) |
| Supabase | Portal, `ccxkaqbajugimmtsztif` (ap-southeast-2) |
| Vercel | `vexoranz/smart-performace-tracker` (`prj_zu9PLowasAyC4DgrpFoUiKlhhS80`), **Preview** target. Production (the old Smart Performance build) is not changed. |

## Order

1. **Push** `portal` to GitHub (fast-forward from `4f20580`; updates draft PR #1). The Vercel project has no Git connection, so pushing deploys nothing.
2. **Migrate** the hosted database (below). The deployed code tolerates the migration being absent, so this can run before or after deployment; applying it first means file citations are saved from the first answer.
3. **Configure** Vercel Preview variables (below).
4. **Deploy** a Preview from a clean export of the pushed commit (only committed files are uploaded).
5. **Verify** online (below).

## Hosted database

Hosted state (verified read-only on 9 Nov 2026): every table, column and RPC from
`20261107101815_client_portal`, `20261107113547_gmail_foundation` and `20261108100000_vexbot` exists. Buckets
`portal-private` and `vexbot-private` are private with 50 MB limits. Only `20261109090000_vexbot_workspace_files`
is missing (`vexbot_file_text`, `vexbot_file_citations` return PGRST205).

Apply **only** `supabase/migrations/20261109090000_vexbot_workspace_files.sql`:

- Additive: two new empty tables, RLS enabled, no anon/authenticated grants, service role only.
- Existing rows: none changed or deleted. Cascades only remove cached text/citations when their own file/message is deleted.
- No seed accounts, passwords or synthetic documents are part of any migration.
- Before applying, check `supabase_migrations.schema_migrations` on the hosted project. If the first three versions are
  not recorded there (they may have been applied outside `db push`), do **not** let `db push` replay them. Apply
  this one file and record only its version.

Rollback (safe at any time; the API falls back to an in-memory text cache and simply stops saving file citations):

```sql
drop table if exists public.vexbot_file_citations;
drop table if exists public.vexbot_file_text;
delete from supabase_migrations.schema_migrations where version = '20261109090000';
```

## Vercel Preview configuration

Already set for Preview: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (both verified to match the Portal project).

To add (Preview, encrypted, server-only, never `VITE_`):

| Variable | Value |
| --- | --- |
| `OPENAI_API_KEY` | a **working** portal-owned key with Chat Completions + Audio (transcriptions, speech) access |
| `VEXBOT_OPENAI_MODEL` | `gpt-4.1-mini` |
| `VEXBOT_TRANSCRIBE_MODEL` | `gpt-4o-mini-transcribe` |
| `VEXBOT_TTS_MODEL` | `tts-1` |
| `VEXBOT_TTS_VOICE` | optional, default `alloy` |

Public build/runtime values passed at deploy time (the shared Preview/Production `VITE_*` entries are from the old project):
`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, plus runtime `SUPABASE_URL`, all for `ccxkaqbajugimmtsztif`.

Deliberately **not** set: `VEXBOT_PROVIDER`/`VEXBOT_SCANNER` (mocks are refused on every Vercel deployment anyway),
`VEXBOT_CLAMD_HOST` (no hosted scanner yet), Gmail variables (integration stays disabled), `RESEND_API_KEY`
(email remains pending as before).

### Malware scanning

The local ClamAV container is not a hosted service, and clamd has no authentication, so it must not be exposed to the
internet. Until a hosted scanner exists, **every Vexbot upload stays quarantined** (verified). Staff can still add
knowledge by pasting reviewed text. Shared files uploaded by administrators are unaffected. Production options:
an authenticated HTTPS scanning service wrapping ClamAV on a private container host, or a commercial scanning API
that does not share files. Avoid VirusTotal for client files (uploads are shared with researchers). Either option
needs a small adapter in `server/vexbot/scanner.mjs`.

## Verification after deployment

- `status` action: provider `openai`, voice `true`, scanner `null`, `missing: []`, `file_index: true`.
- Administrator sign-in, role-specific navigation, sign-out.
- Ask: business-wide answer from the published "General vexbot" document, with citation.
- Ask about a shared file in an existing validation workspace (`part-one.txt`), with file citation.
- Talk: transcription of webm/opus and mp4 recordings, spoken reply returned and playable.
- Client isolation: a direct API call for another workspace is rejected.
- Upload: a new Vexbot upload stays `quarantined` (no hosted scanner).
- In a real browser: microphone permission, greeting, Mute, End, Open chat (mobile Safari/Chrome included).

## Recovery

- **Code:** redeploy the previous Preview (`smart-performace-tracker-cirkdbyf5-vexoranz.vercel.app`) or simply stop
  using the new Preview URL. Production is untouched.
- **Git:** the push is a fast-forward of `portal`; revert commits on `portal` if needed. `main` is not changed.
- **Database:** rollback SQL above. No existing data is touched.
- **Variables:** `vercel env rm <NAME> preview` for each added variable.
