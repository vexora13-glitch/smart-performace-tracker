# VexBot Realtime implementation and verification

Status: implemented on `portal` in `D:\Projects\smart-performance-tracker`. Hosted activation and human voice-fidelity acceptance remain pending. No commit, push, deployment, website modification or hosted database migration was performed.

## Architecture and session flow

1. Click the robot, then **Start voice conversation**, or use **Talk to Vexbot**. The browser primes playback during the click, obtains microphone permission, creates an `RTCPeerConnection`, adds the microphone track and opens `oai-events`.
2. An authenticated POST to `/api/vexbot-voice` sends the SDP offer and selected workspace/conversation identifiers. The server verifies Supabase Auth, authoritative profile state, session cutoff, conversation ownership and workspace access.
3. The service-role-only `vexbot_voice_admit` RPC atomically admits one session per user, across server instances. The server exchanges SDP with OpenAI using its private API key. No provider credential is sent to the browser.
4. An outbound authenticated sideband WebSocket attaches to the provider call. The server confirms the configured session before releasing the SDP answer over a continuously open NDJSON response. The browser's audio then travels directly over WebRTC; the NDJSON stream carries server-approved conversation snapshots and heartbeats.
5. Provider VAD detects speech. The server requests a text-only native Realtime tool round to `workspace_knowledge`. The existing portal planner retrieves published knowledge, approved business information and permitted workspace files. Supplementary transcription is used for the visible/persisted user transcript, not a separate recorded-file transcription request.
6. The same native Realtime model prepares a concise answer through `prepare_answer`. Existing `validateAnswer` rules validate supplied source identifiers; factual answers need current source IDs, while non-factual conversation/clarification may omit them. The server rechecks evidence visibility, then requests an audio response with only the validated speech text as input, excluding internal tool-planning dialogue. There is no `/audio/transcriptions`, Chat Completions or `/audio/speech` request in the live conversation path. Source-ID validation is not a semantic proof of every generated factual assertion; the same grounding limits as the existing text model still apply.
7. Provider playback-buffer events drive Speak, independently of response generation completion. Completed approved answers and citations enter the existing conversation tables. Interrupted replies are replaced by an omitted-words marker; the unplayed answer is not restored to saved context. Provider supplementary transcription can arrive late, so server first-seen timestamps preserve turn order.
8. Returning to text drains server transcript updates. Restarting voice uses the same conversation ID and bounded, revalidated history. A new session never repeats the greeting if history already exists.

The server retains sole ownership of tool execution and answer persistence. The browser cannot choose a tool's workspace, submit trusted citations/history or obtain service credentials. Browser-caption events are provisional; the server independently receives provider events.

## Interruption and animations

`server_vad` retains `interrupt_response:true`. On `input_audio_buffer.speech_started`, the client immediately mutes stale playback and leaves Speak, requests `response.cancel` and `output_audio_buffer.clear`, and waits for the next response. WebRTC performs provider-managed truncation at the provider's playback position. The application never guesses `audio_end_ms` or sends a second manual truncate.

The supervisor versions turns, discards late tool results, tracks server-authored response nonces and cancels responses created after their turn was superseded. A new turn waits for an already-active cancelled response to finish. Expected `response_cancel_not_active` races are tolerated. Other protocol errors end the session.

The existing GLB, renderer, animator, director, flight, walking speed, sidebar perch, layout collision rules and reduced-motion support are preserved. Waiting/ended/muted use neutral attention, user speech uses Listen, processing uses Think, and provider playback uses Speak where space permits. Existing station Present behaviour remains available. Native speech does not use fixed animation-duration timers.

## Security, reliability and cost controls

- Admission, end requests and knowledge access are authenticated. Conversation ownership is separate from workspace membership. Live access is revalidated every ten seconds and again around tool/evidence operations. A revoked or expired session fails closed.
- `vexbot_voice_sessions` and the admission RPC have RLS and no browser grants. Admission uses a PostgreSQL transaction advisory lock, not process memory. The necessary migration reuses the existing Supabase project; no separate cache/database service was introduced.
- Limits: 240 seconds per call, 75 seconds idle, six starts per user per rolling hour, sixty starts globally per rolling hour, ninety native responses per call (tool rounds included), 16,000 output tokens per call, and 200,000 completed output tokens globally per rolling day. A final in-flight response may exceed a token threshold by up to its configured response allowance. Concurrent calls' final usage is not an exact currency budget; provider project spend/rate limits remain useful.
- A 270-second durable lease reserves cleanup time. Expired leases are reclaimed only after confirmed provider hangup. Transient hangup failure gets one retry. Confirmed end requests cannot be overwritten by a concurrent inconclusive supervisor result.
- The streamed Vercel function remains alive for supervision and has a 300-second maximum. No detached background promise is used. Ending, closing the panel, changing workspace, signing out, leaving the page or hiding the tab releases browser media and ends supervision. Unexpected data-channel/stream loss also ends the call. Brief WebRTC disconnection shows reconnecting; an eight-second failure requires explicit restart with the same voice and saved context.
- Browser Web Locks prevent a second live microphone in another tab; durable server admission also covers other browsers/devices. Device loss and permission rejection produce safe messages. A playback-permission failure provides **Enable voice playback**.
- No microphone audio is stored by the portal. Conversation text/citations and usage metadata are stored. OpenAI receives live audio and the minimum approved context. Provider retention is governed by the account's OpenAI settings; the portal makes no zero-retention claim.
- Only `ws@8.22.2` was added. It is needed for an outbound sideband WebSocket with an Authorization header. No client OpenAI SDK, extra auth service or replacement 3D package was added.

Abrupt infrastructure termination can interrupt supervision before its cleanup request finishes. Browser closure normally closes media, and stale durable leases are not reused without provider termination. This is a bounded serverless supervisor, not a separately deployed always-on watchdog. Hosted network/disconnect/failure testing is still required before rollout.

## Environment and Vercel configuration

Existing server-only variables remain: `SUPABASE_URL` (or the existing URL fallback), `SUPABASE_SERVICE_ROLE_KEY`, and `OPENAI_API_KEY`. Existing `VEXBOT_OPENAI_MODEL`, `VEXBOT_TRANSCRIBE_MODEL`, `VEXBOT_TTS_MODEL` and `VEXBOT_TTS_VOICE` continue to govern text/recorded fallback, independently of native live audio.

New switch: `VEXBOT_REALTIME_ENABLED=true`, server only. It defaults off. Do not prefix server secrets/switches with `VITE_`. The native identity is intentionally fixed to the audited model/voice; no environment-driven silent replacement was introduced.

After explicit approval for hosted changes:

1. Apply the reviewed `supabase/migrations/20261109021904_vexbot_realtime_sessions.sql` to the existing project. It adds only session accounting and atomic admission.
2. Enable the switch in the existing Vercel project's intended environment and verify the existing API key has Realtime account access.
3. Verify the existing project supports the route's 300-second execution/streaming configuration. `api/vexbot-voice.mjs` declares it. Audio uses WebRTC and the server opens an outbound WebSocket; Vercel does not need an inbound WebSocket server.
4. Deploy only with approval, then repeat the acceptance checks on the hosted URL. No domain, repository, Supabase project, Vercel project, GitHub wiring or CSP changes are required by this implementation.

The migration was applied and tested only against the existing local Docker Supabase stack (`127.0.0.1:56422`), with local migration history recorded. Hosted infrastructure was untouched. The status action checks that session controls exist before advertising live voice.

## Files changed

| File | Purpose |
| --- | --- |
| `src/vexbot/realtime.ts` | Browser WebRTC, NDJSON supervision stream, state/captions, interruption, mute, autoplay recovery and cleanup |
| `src/vexbot/Vexbot.tsx` | Existing UI integration, live controls, shared conversation context and animation attention |
| `src/vexbot/voice.ts` | Clarifies that existing recording code is the retained fallback |
| `server/vexbot/realtime.mjs` | Audited configuration, SDP/provider calls, native tools, supervisor and limits |
| `server/vexbot/realtime-handler.mjs` | Authenticated streamed session/end endpoint and durable accounting |
| `server/vexbot/handler.mjs` | Reuses existing visibility/planner/history/citations for native voice; status readiness check |
| `api/vexbot-voice.mjs` | Existing Vercel API convention, with 300-second duration |
| `scripts/dev.mjs` | Routes the same API locally with a bounded SDP request body |
| `supabase/migrations/20261109021904_vexbot_realtime_sessions.sql` | Private session accounting and serialized admission |
| `package.json`, `package-lock.json` | Pinned sideband WebSocket dependency |
| `.env.example` | Server-only enablement switch |
| `tests/vexbot-realtime.test.mjs` | Protocol, authorization boundary, interruption races, cancellation/cleanup, citation and PostgreSQL tests |
| `tests/vexbot-realtime-local.test.mjs` | Real local Auth/PostgREST isolation, withdrawal, history and durable admission |
| `tests/browser/vexbot-realtime.spec.ts` | Explicitly mocked transport lifecycle checks at desktop/mobile widths |
| `scripts/vexbot-realtime-provider-check.mjs` | Opt-in real provider protocol check with synthetic text/knowledge |
| `scripts/vexbot-realtime-browser-check.mjs` | Opt-in local portal/Auth/database/provider test with synthesised microphone input |
| `docs/VEXBOT_REALTIME.md`, `docs/VEXBOT_VOICE_COMPARISON.md` | Implementation/evidence report and repeatable human comparison procedure |

## Verification

Existing API/unit tests and the local VexBot Playwright suite ran sequentially because they share and retire synthetic knowledge.

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 163 passed, zero failed/skipped, including local Auth/database and PostgreSQL policy tests.
- `npm run build`: passed. Vite reports the existing large application/Three.js chunk advisory; this is not a build failure.
- `npx playwright test --config playwright.config.ts`: six passed, including two new explicit mock-transport lifecycle tests at 1440px/390px. Existing fixture tests emit expected DNS errors for their intentionally nonexistent fixture Supabase hostname.
- `npx playwright test --config playwright.vexbot.config.ts`: ten passed, eight intentional project/device skips. Covers existing GLB/motion/layout, real local Auth/RLS/retrieval, recorded voice and desktop/mobile portal flows. Recorded/fake-input tests do not verify native audible fidelity.
- Local `supabase db advisors --type security --level warn --fail-on error`: no issues found.
- Real provider protocol test: actual configured model, voice, WebRTC/sideband connection, server tools, provider playback events and confirmed hangup succeeded. Synthetic text input/knowledge; no physical microphone/listening claim.
- Full local portal test: real Supabase Auth/database and real OpenAI WebRTC output, with synthesised speech injected through Chrome's test microphone. The initial run completed three turns; the repeated run completed two. The provider emitted `output_audio_buffer.cleared` and `conversation.item.truncated` during interruption of the greeting. Mute/unmute UI and voice-to-text persisted context passed. Initial end-of-speech-event to output-buffer-start delays: 2,488 / 2,385 / 2,736 ms; the repeated run measured 2,373 / 3,265 ms. These are event timings, not acoustic end-to-end latency, and exclude the configured 500ms VAD silence window. Repetition exposed a teardown race; the corrected run asserted zero active session leases after returning to text, confirmed by an independent local database query. Only benign `response_cancel_not_active` errors occurred in that run. After this check, a targeted real-provider test verified the isolated audio rendition and a spoken transcript without internal workflow narration.

Generated evidence stays in ignored `artifacts/`: provider JSON, full browser JSON, screenshot, and synthetic input WAV. The synthetic input uses Alloy solely as a test speaker; the assistant output remains Marin. The scripts require `--live` because they make small billable provider requests. They never target the hosted portal database. Run the regular VexBot browser suite first to seed synthetic local accounts, then run the live browser check separately.

Physical microphone, real mobile Safari/Chrome permission/playback, human interruption/listening, hosted failure recovery and the website/portal A/B listening comparison remain outstanding. No mocked or synthesised microphone check is presented as passing those criteria.

## Vexora Website vs Client Portal — Voice Fidelity Report

1. **Original website settings — source-verified.** Read-only checkout: `D:\Projects\Vexora-website`, HEAD `6dc79162c401b34a2ef7ced51abc670debcda2e4`. Inspected `src/lib/companion/voice-server.ts`, `voice-client.ts`, `voice-shared.ts`, `conversation.ts`, and the voice route. The checkout has an unrelated navigation edit and untracked replication documentation; none was modified. Source defaults are `gpt-realtime-2.1-mini`, `marin`, `gpt-4o-mini-transcribe` with `en`, `near_field`, and `server_vad` threshold 0.5, prefix 300ms, silence 500ms, automatic response creation and interruption enabled. Output allowance 800; tracing null; retention ratio 0.8 with 4,000 post-instruction tokens. Model/transcription/voice can be overridden by website environment variables; no local override was found. The deployed website's private environment has not been independently verified.
2. **Portal settings — execution-verified with OpenAI.** Same model, Marin voice, English transcription model, noise reduction, VAD threshold/padding/silence, interruption, output allowance, tracing and truncation configuration. Provider responses confirmed output speed 1 and the expected voice. The portal has no automatic alternative model or voice.
3. **Confirmed matches.** Native WebRTC microphone/playback transport, server-key SDP exchange, server sideband supervision, provider VAD/barge-in/truncation, microphone echo cancellation/noise suppression/automatic gain, original greeting wording, warm/plain New Zealand English instructions and concise conversational intent. Neither client applies output pitch shifting, resampling effects or a custom timbre filter; playback uses a normal audio element.
4. **Configuration differences and reasons.** Portal `create_response:false` lets the trusted server create text-only tool rounds before audio. Website `create_response:true` immediately generates the native response. The portal adds workspace lookup, structured answer/citation validation and visibility rechecks. This deliberately costs extra round trips and prevents spoken tool preambles before evidence approval. The final native audio round excludes tool-planning context and speaks the validated text, which can affect expressive delivery relative to the website's direct conversational response. Website published business knowledge and optional contact-submission tools are replaced with authenticated portal knowledge and existing Messages guidance. No website contact workflow is offered or claimed. Session admission uses the existing portal PostgreSQL database rather than the website's Redis connection locks. Native sessions use the same voice on greeting, responses and reconnection; recorded fallback retains its separately configured voice and discloses that it may sound different.
5. **Personality/delivery differences.** The website asks for one or two short conversational sentences, with no lists/URLs, contextual corrections, at most one clarification, no repeated discovery and no unsupported commitments. The portal follows those constraints while answering workspace questions and displaying citations separately. The source has no explicit phonetic pronunciation map, guaranteed NZ accent setting or pitch/post-processing configuration to copy. Early automated output was too verbose and narrated source provenance; the speech-preparation instructions were tightened, and escaped JSON wording was removed from the speech directive. Remaining audible cadence, pronunciation, timbre and sentence-ending differences require listening, not inference from prompts.
6. **Live A/B listening results: PENDING.** No new human side-by-side listening session or matched raw reference recordings were available during implementation. The website contains a historical physical-microphone QA report dated 31 October 2026; that is evidence about an earlier website test, not a current portal comparison. No similarity percentage, exact acoustic match or guaranteed New Zealand accent is claimed.
7. **Interruptibility/latency observations.** Real provider events showed truncation/clearing during synthetic microphone interruption and successful subsequent turns. Observed portal speech-stop-to-output-buffer-start delays were 2.37–3.27 seconds across the two browser runs, before the isolated-rendition delivery change. Those measurements are too limited to claim a latency distribution or a human-perceived conversational timing match with the website. Physical barge-in responsiveness and interruption recovery still need the paired test.
8. **Remaining limitations.** Production website environment overrides are unconfirmed; human acoustic comparison is pending; actual mobile microphones and speaker echo are untested; server grounding rounds alter response latency; bounded source excerpts can omit later file contents and are disclosed as partial. Saved answers are the validated speech plan; live captions come from the provider's actual audio transcript, so small wording/punctuation differences are possible. Model/provider changes can affect the same voice ID over time. Hosted activation and hosted failure testing require approval.
9. **Recommended adjustments.** Complete `VEXBOT_VOICE_COMPARISON.md` using the website as baseline. Keep Marin and the verified model fixed; first adjust only concision/pacing instructions based on observed differences. Test Vexora/project-name pronunciation before adding a phonetic override, because the original source supplies none. Evaluate the grounding-round latency with representative real questions and poor networks. Do not replace the voice or claim fidelity completion without listening evidence.

Voice replication is **not fully accepted** until the paired listening tests pass.

## Manual local testing

Use the existing local Supabase stack and ignored `.env.localtest.local`, never a hosted database for synthetic seeding. Configure its existing server OpenAI key, `VEXBOT_PROVIDER=openai` and `VEXBOT_REALTIME_ENABLED=true`, after the local session migration is applied. Run `npm run dev:localtest`, sign into an authorised local workspace and use **Start voice conversation**. Follow `VEXBOT_VOICE_COMPARISON.md` for natural speech, interruption, citations, text continuity, cleanup and physical mobile checks.

For repeatable automated checks, run the commands listed above sequentially. `node scripts/vexbot-realtime-provider-check.mjs --live` makes a real provider call with synthetic text/knowledge. After the local VexBot Playwright suite seeds synthetic accounts, `node scripts/vexbot-realtime-browser-check.mjs --live` creates synthetic spoken input, starts an isolated local server on port 5192, exercises the real portal/provider pipeline and verifies the session lease ends. It reads the existing development OpenAI key but uses only the guarded local database for portal writes. Its generated input/JSON/screenshots stay in ignored `artifacts/`.

## Official documentation consulted

- [Realtime API overview and current event shapes](https://developers.openai.com/api/docs/guides/realtime)
- [GPT-Realtime-2.1 Mini model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini)
- [WebRTC / Realtime unified interface](https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime)
- [Server-side sideband controls](https://developers.openai.com/api/docs/guides/voice-server-controls?api=realtime)
- [Provider VAD settings](https://developers.openai.com/api/docs/guides/realtime-vad)
- [Conversations, native tools and WebRTC interruption/truncation](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [Vercel function duration](https://vercel.com/docs/functions/configuring-functions/duration) and [streaming](https://vercel.com/docs/functions/streaming-functions)
- [Supabase update/filter semantics](https://supabase.com/docs/reference/javascript/update)
