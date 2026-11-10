# Vexbot voice upgrade — 10–11 November 2026

## Scope and evidence

Only the canonical `D:/Projects/smart-performance-tracker` checkout, branch `portal`, was edited. The checkout guard passed before editing. No commit, push, deployment, hosted configuration change, website edit or new database migration was made.

The reference source is `D:/Projects/Vexora-website/src/lib/companion/{voice-server,voice-client,voice-shared}.ts`. The two user recordings in `resources/` are 38.04 and 38.21 seconds. Contact sheets were inspected: the portal recording explicitly shows **Recorded voice — may sound different**; it asks about an unidentified message and produces a long limitation explanation. The website recording shows its voice interface. The recordings establish visible behaviour, not provider architecture or an acoustically reusable voice model.

## Findings and architecture

The public website source uses OpenAI WebRTC speech-to-speech with a server sideband supervisor. Its defaults, and the inspected local website configuration, are `gpt-realtime-2.1-mini`, `marin`, `gpt-4o-mini-transcribe`, English, near-field noise reduction, 500 ms server VAD, threshold 0.5, 300 ms prefix padding and normal speech speed. The portal already had a compatible supervised transport. The older `vexbot-upgrade-report.md` describes an earlier implementation and must not be treated as its current architecture.

Before this change the portal live path was: microphone → native VAD → model-generated `workspace_knowledge` query → authorised retrieval → model `prepare_answer` → server citation validation → model audio rendition → playback. Ordinary turns used three model responses. The recorded fallback is still a different path: recording → transcription → grounded text answer → TTS.

The revised live path uses the final recognised question directly for server retrieval, overlapping the durable transcript write. It then prepares and validates a grounded answer before the Marin audio rendition: two model responses. Narrow, single-field requests for approved business hours, email or phone, file-opening actions and deterministic clarifications use one audio response. Compound requests retain the normal grounding path. The native connection persists across turns, with the existing four-minute session and server-owned access, concurrency, quota, idle and hangup controls.

Other root causes included waiting up to two seconds for ICE gathering, serialized transcript/UI-history refreshes, repeated concurrent Auth checks, absent recognition vocabulary, final-only user captions, stale caption handling and a reconnecting indicator that could be overwritten by normal response events. The recorded fallback's 1.1-second silence detector and different TTS voice also explain part of the recorded experience. That fallback is not relabelled as Marin Realtime.

The text streaming client also waited for HTTP EOF after receiving an authoritative, saved answer. It now accepts the server's saved-and-reauthorised `answer` frame for silent text, or `result` for speech-bearing requests, and closes the reader. A browser regression test holds the transport open after `answer` and verifies completion and reader cancellation. Unvalidated partial deltas still cannot become completed answers.

## Changes

| Area | Files | Behaviour |
| --- | --- | --- |
| Live transport and supervision | `server/vexbot/realtime.mjs`, `realtime-handler.mjs`, `src/vexbot/realtime.ts` | Direct retrieval from recognised questions, overlapping storage/retrieval, coalesced history snapshots, immediate SDP exchange, parallel token lookup, transcript deduplication and superseded-turn checks; playback and reconnect states follow actual events |
| Recognition | `server/vexbot/speech.mjs`, `provider.mjs`, `handler.mjs` | Provider-supported English/vocabulary hints for Vexora, Vexbot, Smart Express and workspace document titles; partial captions, final reconciliation and short missing-transcript clarification; no invented replacement transcript |
| Context and intents | `server/vexbot/{portal-context,direct-answer,catalogue,prompt,handler}.mjs`, `src/components/{Chat,Workspace}.tsx`, `src/vexbot/Vexbot.tsx` | Explicit selected-message and previewed-file identifiers; server-loaded message text; short clarification without a selected message; natural follow-ups; narrow direct approved-profile reads; natural file opening through the private document preview |
| Wake phrase | `src/vexbot/wake-word.ts`, `Vexbot.tsx` | Explicitly armed “Hey Vexbot”, only when browser on-device recognition and its installed language pack are available; no cloud recognition fallback or automatic pack download; stops before voice playback, on hide/sign-out and cleanup |
| Benchmark and tests | `scripts/vexbot-voice-benchmark.mjs`, voice quality, Realtime, local integration and browser tests | Fixed cached synthetic utterances, real-provider event timings, WER, response rounds, source isolation and lifecycle checks |

Additional affected files: `src/vexbot/chat-stream.ts` and `tests/browser/vexbot-stream.spec.ts` implement/test authoritative answer delivery; `tests/vexbot-e2e/vexbot.spec.ts` foregrounds each actor window in the multi-window access/revocation test; `tests/vexbot-e2e/voice-context.spec.ts` covers selected messages and PDF opening on desktop/mobile; `tests/browser/vexbot-realtime.spec.ts`, `tests/vexbot-{realtime,realtime-local,voice-quality}.test.mjs` cover the revised protocol and security. `package.json` runs Node test files serially to avoid concurrent local-database/WASM resource contention. `docs/vexbot.md` points to this current report.

The robot asset, branding, animation and layout contracts are preserved. Source preview is lazy-loaded. Privileged server reads recheck user/workspace access. Only concurrent checks within the same live context are coalesced; there is no authorization TTL or cross-user cache. Browser identifiers and page names never authorize access or supply message contents. Message reads quote correspondence with its thread title; they do not assert that the author's statement is an independently verified project fact. Message quotations are stored as conversation text, without a separate durable message-citation record. Existing document citations and withdrawal checks remain in place.

## Measurements

Raw, git-ignored evidence is in `artifacts/voice-upgrade/`. `before.json` is the pre-optimization portal baseline; `website-retry.json` measures the unmodified public website with the same cached utterances. All results below use six turns, not a population-scale p95. The corpus mixes support hours, a simpler explanation, a named PDF absent from this account, a follow-up, an unidentified message and repeated support hours. Missing-file and message-clarification responses are intentional tasks; this corpus does not establish successful PDF summarization. PDF/content accuracy is covered separately by the isolated workspace suite.

Audio input is generated speech streamed through a WebAudio media destination. Timings use the known end of that waveform. “First audio” is the provider output-buffer-start event, not sound measured at a physical speaker. “First text” is the first assistant transcript delta, not a painted-pixel measurement. Completion is actual output-buffer-stopped, not model generation completion. Microphone activation uses a synthetic stream and cannot measure real permission/device latency.

| Measurement, ms: median / nearest-rank p95 | Portal before, n=6 | Portal final, n=6 | Public website, n=6 |
| --- | ---: | ---: | ---: |
| End detection event | 527 / 677 | 765 / 932 | 560 / 716 |
| First assistant audio | 3,259 / 3,671 | 2,505 / 4,640 | 974 / 1,249 |
| First transcript delta | 3,144 / 3,590 | 2,358 / 4,430 | 879 / 1,118 |
| Playback completion after input waveform | 12,980 / 14,946 | 9,888 / 16,372 | 13,806 / 20,936 |
| End-to-end, input start through playback completion | 15,247 / 17,896 | 12,172 / 19,322 | 16,006 / 22,986 |

**The final sample reduced median first audio by 23%, but p95 worsened and the portal remains slower than the website.** Final evidence is `verified.json`; `comparison.json` derives baseline/website end-to-end timing from completion latency plus the exact cached WAV duration and cross-checks the final direct measurement. Model responses across the six measured turns fell from 17 to eight (website: six). All six final transport turns completed without a timeout; this is one session, not a reliable population failure-rate estimate. Playback duration also depends on response length and differing authorised knowledge.

The baseline synthetic microphone/connection-ready samples were 242 / 4,551 ms, each n=1; no activation percentile can be inferred. Per-turn WER median was 0 in both baseline and website runs; p95 was 1.0 because “Summarise pike point.pdf” became “Summarize PikePoint.pdf”. That orthographic/joining difference is retained in the literal WER calculation. It is not evidence of improved natural accents or vocabulary accuracy.

Final synthetic microphone/connection-ready samples were 167 / 4,782 ms, each n=1. Literal corpus WER was unchanged at 9.375% (three word edits across 32 reference words) in baseline, final and website runs. The vocabulary hints are implemented, but this corpus does not prove a recognition-accuracy improvement. No claim that the overall speed/accuracy success criterion has been met is warranted yet.

An intermediate two-round portal run (`after.json`) had first-audio median/p95 3,388/3,555 ms. Removing a round alone did **not** improve its median. Another diagnostic run (`final.json`) had substantial latency spikes: 6,272/15,721 ms. These observations are retained; they must not be omitted to imply consistent low latency. The initial old harness also timed out waiting for a second turn. A first WebAudio harness attempt lacked continuous trailing silence; it is saved separately and is not counted as a product latency sample. The first website attempt timed out before playback; its successful retry is reported separately, not described as zero connection failures.

The initial portal tree was clean at commit `12f821470241cd3f5efc680b3611638bae91fd6c`. Final benchmark reports include SHA-256 fingerprints of the transport, handler and browser client; changes remain uncommitted. No acoustic microphone activation or network-recovery percentile is claimed. Reconnection/permission paths have simulated-event coverage and a manual acceptance checklist, rather than invented real-network failure rates.

## Executed verification

- `npm test`: 213 passed, zero failed/skipped, after serializing test-file execution. Includes real local Supabase Auth/PostgREST/Storage, PostgreSQL RLS, source withdrawal, revoked access, admission controls and provider/recorder tests. No hosted synthetic writes.
- Latest targeted backend checks: 24 streaming/Realtime tests passed; five vocabulary/message/local-access tests passed after the final message-response classification change.
- Type checks, lint and production build passed. Existing application/Three.js chunks remain over Vite's 500 kB warning threshold. The preview reuses the existing lazy PDF component; no new dependency was installed.
- Browser transport/stream checks: four passed in installed Chrome, including desktop/mobile captions, duplicate starts, interruption, reconnect state, cancellation, authoritative answer without EOF and text fallback. The bundled Chromium fixture attempts initially crashed; installed Chrome supplied the successful run.
- Real local UI checks caught and corrected the compound open-and-summarize regression and a mobile test that had omitted opening navigation. Foregrounding the separate actor windows made the five-check MFA/read-only/revocation/WebGL/reduced-motion rerun pass. Earlier unsuccessful suite runs and the prematurely filtered rerun without its MFA fixture were not counted as passing.

**The complete browser suite is still intermittent.** Its latest full run had 10 passes, one read-only-member response timeout at the 20-second assertion, eight skips and three cases not run because of the serial failure. The correct reply was saved in local PostgreSQL. A subsequent focused run of MFA setup, grounded chat and read-only/source-revocation passed all three; the earlier five-case focused run also passed WebGL fallback and reduced motion. These passing reruns do not turn the failed full run into an all-green result. This timing failure remains a delivery limitation requiring investigation under a representative runtime/load; no authorization bypass or fabricated answer was used to make it pass.

Local screenshots of selected-message reading and the fully rendered PDF preview are in `artifacts/voice-upgrade/`. The first preview screenshot captured its loading state; the final test waits for the synthetic PDF's extracted page text before taking the image. Real microphone/accent testing and human listening remain outstanding.

Reproduce a current six-turn synthetic voice run only against the local database: seed with `node scripts/vexbot-local-seed.mjs`, then run `node scripts/vexbot-voice-benchmark.mjs --live --label=review`. `--live` makes billable provider calls. `--website --identity` opens one public website call to inspect its announced model/voice without sending user questions. The benchmark uses cached `input-0.wav` through `input-5.wav` for consistent repeated input. Do not run it alongside tests that retire synthetic knowledge.

## Configuration and limitations

The live voice identity remains OpenAI `gpt-realtime-2.1-mini` / `marin`, normal speed, with the website's VAD/noise defaults. Source identity/configuration matches; acoustic identity across recordings, devices and differing model prompts is not certified. No extracted greeting or custom voice was created. The existing website greeting remains the live startup greeting for a new conversation. A continued conversation avoids a repeated introduction.

Live provider announcements in `verified.json` and `website-identity-ready.json` were compared: both reported `gpt-realtime-2.1-mini`, `marin` and `gpt-4o-mini-transcribe`. The identity-only website check sent no user questions. An earlier identity attempt clicked before the site's voice capability had loaded and opened text instead; the harness now waits for its actual voice-ready attribute. The successful identity check verifies configuration, not acoustic reproduction from the MP4.

Hosted live voice requires the existing server-only `OPENAI_API_KEY`, `VEXBOT_REALTIME_ENABLED=true`, existing Supabase server configuration, the already-existing voice-session migration and sufficient route duration (the voice route already declares 300 seconds). No environment value was changed. `VEXBOT_OPENAI_MODEL`, `VEXBOT_TRANSCRIBE_MODEL`, `VEXBOT_TTS_MODEL` and `VEXBOT_TTS_VOICE` still configure the text/recorded fallback; that voice may differ. Local synthetic tests use `npm run dev:localtest`, never hosted credentials for synthetic database writes.

Optional server-only `VEXBOT_TIMING_LOG=true` emits phase names, elapsed milliseconds and random request labels to the server console for diagnosing delivery stalls. It logs no questions, transcripts, workspace identifiers, tokens or keys. It is off by default and was not enabled in hosted configuration. Matching remains full-text/metadata/fuzzy-title retrieval; no vector index or reranking service was introduced.

Always-on wake detection is unavailable in browsers without an installed on-device recognition pack. Tap-to-start remains available. Full connection loss ends the supervised call and offers explicit reconnect; transient ICE disconnections have an eight-second recovery window. No microphone resumes silently after a failed call. Physical microphones, varied accents/noise, real network loss, wake false-activation rates and human A/B listening still require the manual checks below. No recognition confidence threshold is claimed: the current model configuration does not expose a calibrated score to this implementation.

## Manual acceptance checklist

1. On desktop and mobile, allow/deny microphone permission; verify visible listening, mute, End and text fallback.
2. In an opted-in live call, ask the fixed benchmark questions plus “Vexora”, “Vexbot”, “Smart Express” and the real proposal/SOW names, at different speeds and with consented accent/noise samples. Record reference transcripts for corpus WER and separately score intent and task completion.
3. Interrupt during playback and during slow retrieval. Confirm no stale answer restarts and no unheard words appear as completed dialogue. Continue in text and verify corrections and source links.
4. Arm wake detection only where the browser reports an installed on-device pack; verify permission denial, false phrases, duplicate phrases, hidden tabs and no activation from Vexbot's own playback.
5. Briefly interrupt connectivity, then restore it; separately lose it for over eight seconds and explicitly reconnect. Verify no second live lease or microphone remains.
6. Select a message through its Ask Vexbot control, read it, then request an unidentified message. Open the SOW/proposal by its natural title and continue with a simpler explanation/comparison. Try the same identifiers as another client and with revoked access.

Official references checked during implementation: [Realtime conversations and WebRTC interruption](https://developers.openai.com/api/docs/guides/realtime-conversations), [transcription vocabulary prompting](https://developers.openai.com/api/docs/guides/speech-to-text#prompting), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). Documentation describes API capabilities; live-provider and local security tests supply the implementation evidence.
