# VexBot upgrade report - 9 November 2026

## A. Initial audit (before edits)

Inspected the existing portal, API, migration, tests, model and original website source. Reference documents were available at `D:/Projects/Vexora-website/docs/vexrobot-replication/`: `personality-and-behaviour.md`, `voice-identity.md` and `animation-engine.md` (Movement and Animation Replication Blueprint). No missing reference attachment prevented the movement audit.

| Feature | Initial classification | Evidence / gap |
| --- | --- | --- |
| Original GLB and twelve animation clips | Implemented | Existing `public/bot/vexora-bot.glb`; exact reference hash; no asset replacement needed |
| Layering, fade, turn handoff, gait and flight equations | Implemented | Existing animator, director and flight modules already ported from website |
| Portal stations, sidebar corridor, mobile reserved bar | Implemented | Portal-specific stations; website hero placements intentionally do not apply |
| Listen / Think / Speak interaction binding | Partially implemented | Recorded turns only; text answers incorrectly simulated speaking with a timer |
| Grounded chat and citations | Implemented | Server workspace check, published passages, citations and source withdrawal |
| Natural dialogue and corrections | Partially implemented | Rigid source-only prompt; no explicit correction or requirement-status rules |
| Conversation memory | Partially implemented | Saved per user/workspace, but only eight turns selected; query fetched earliest 200 messages |
| Realtime speech-to-speech, Marin, VAD and interruption | Missing / incompatible transport | Existing voice is MediaRecorder -> transcription -> grounded answer -> TTS; API lifetime is 60 seconds |
| Uploads and media processing | Partially implemented | Private signed uploads, byte validation, quarantine and staff approval work; no automatic video transcription or visual analysis |
| Admin | Partially implemented | MFA, business profile, guidance, tone/detail presets, knowledge workflow, history and audit work; greeting, capability policy and supported model picker absent |
| Permissions | Implemented | Server Auth validation, session cutoff, workspace membership and database RLS; service key remains server-side |
| Accessibility and responsive behaviour | Partially implemented | Keyboard, focus, reduced motion, keep-still, hide and WebGL fallback work; chat always forced scroll to bottom |
| Voice cleanup | Partially implemented | Cancellation while permission pending could leak a late microphone stream; paused audio blob URLs were not always released |
| Escalation | Implemented | Opens portal Messages; no SMTP/contact submission or booking tool copied |

User-owned untracked `OBSOLETE.txt` and password-helper scripts were left untouched. No environment secrets were printed, no production environment changed, no infrastructure created, and no migration was added.

## B. Changes implemented

- `server/vexbot/prompt.mjs`: adapted the reference shared dialogue rules to authenticated projects. Added correction/short-reply/multiple-answer handling, one-question guidance, proposed/approved/implemented/completed distinctions, source conflicts, attachment limitations and honest escalation. Explicit conversational/clarification response kinds allow non-factual acknowledgements without invented citations. Factual answers still require known sources; any unknown citation now rejects the answer rather than silently dropping that citation.
- `server/vexbot/context.mjs`: selects up to 60 contiguous recent turns using a conservative 6,000 UTF-8-byte/token upper-bound budget including role overhead. No partial messages or invented summaries; withdrawn answers excluded. This is conservative budgeting, not exact provider tokenisation. Older facts outside the bounded window are not guaranteed to remain in context.
- `server/vexbot/handler.mjs`: fetches the latest 200 messages, restores chronological order, prioritises the current retrieval query and supplements from up to four prior client turns with deduplication. History is server-loaded and reauthorised, not accepted from React. Usage-count errors now fail closed. Reports live voice as unavailable rather than suggesting the recorded-turn pipeline is Realtime.
- `server/vexbot/provider.mjs`: requests `store:false` for text completions. Existing server-only credentials and provider configuration are preserved.
- `server/vexbot/realtime.mjs`: preserves the exact requested session configuration as a tested contract. **It does not create a live session or implement WebRTC.** No model or voice replacement was made.
- `src/vexbot/Vexbot.tsx`: scroll-position-aware log, immediate duplicate-send guard, operation generations to ignore replies from cancelled chats, recording permission state, mute/resume, cancel recording, stop playback, media cancellation on close/workspace/history/new-chat/unmount/hidden-tab, URL cleanup and plain-language live-voice availability. Removed simulated Speak animation on silent text answers. Deferred reservation writes outside ResizeObserver delivery.
- `src/vexbot/voice.ts`: stops late-granted microphones after cancellation, cleans up recorder startup failures, supports real track mute with recorder pause/resume and settles pending stop on cancellation. Retains the existing 55-second recording limit.
- Tests: twelve clip durations and exact gait metadata, context bounds/corrections/Unicode, withdrawn history, retrieval priority, citation rejection, reference voice configuration, recorder lifecycle and browser mute/resume.

No new dependency, model asset, database schema, workspace, provider account or hosting project was introduced.

## C. Comparison with the reference

| Area | Result | Limit |
| --- | --- | --- |
| Conversation rules | Functionally equivalent instructions | Live generative adherence unverified; mock is extractive and cannot validate natural conversation |
| Workspace grounding | Functionally equivalent, portal adaptation | Published/approved documents only; unprocessed uploads and correspondence are not automatically knowledge |
| Text/recorded-voice continuity | Functionally equivalent within bounded window | Both use the same saved conversation; unconfirmed transcription remains imperfect; no full-duplex voice continuity |
| Realtime voice identity and natural turn-taking | Blocked / unverified | Configuration contract only; current UI remains explicitly turn-based |
| GLB and clip durations | Matched | Exact original model file; portal glow tint remains purple |
| Walking, turning, layering and flight equations | Matched algorithms | Existing original modules retained, numerical tests executed |
| Positioning and collision avoidance | Functionally equivalent portal adaptation | Sidebar/per-panel/mobile placements; arbitrary future dialogs still need targeted coverage |
| Listening/thinking/speaking | Functionally equivalent for recorded turns | Speak reflects audio playback, no phoneme/viseme synchronisation |
| Accessibility / interaction | Functionally equivalent in tested flows | No exhaustive assistive-technology certification |
| Acoustic similarity / authentic NZ accent | Unverified | No paid call, consented audio recording or measured reference audio |

The original robot itself is a procedural model approximating its design image. Asset equality does not certify pixel-for-pixel appearance across GPUs, lighting, tint or devices.

## D. Executed validation

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 106 passed, zero failed/skipped. Includes portal and VexBot database/RLS tests, actual local Supabase Auth/Storage/API integration, file validation, source revocation, numerical animation/movement tests and mocked provider/recorder tests. Synthetic local data only.
- `npm run build`: passed; Vite reports the existing dynamically loaded Three.js stage chunk around 640 kB (161 kB gzip), above its 500 kB warning threshold.
- Browser tests: first full run passed 7 applicable tests, 7 platform-inapplicable cases skipped. Chrome desktop and Pixel 7 emulation with real WebGL, fake microphone and mock AI. Final rerun also passed 7 applicable tests with 7 platform-inapplicable skips, including mute/resume; no ResizeObserver notification recurred. The intentionally forced WebGL failure emitted the expected renderer diagnostic.
- After the final `store:false` change, the 11 provider/file/prompt unit tests were rerun and passed. `git diff --check` passed (Git noted normal Windows line-ending conversion).
- Initial unit run failed one Unicode fixture because PowerShell converted the literal emoji; fixed with a JavaScript Unicode escape and reran successfully.
- First browser run logged mobile ResizeObserver loop notifications despite passing; reservation writes were moved to requestAnimationFrame and rerun.
- No live OpenAI call, Marin playback, measured acoustic similarity, real microphone/network interruption or production verification was performed. Prompt tests establish instructions and fencing, not a guarantee against semantic prompt injection or hallucinated assertions.

## E. Configuration and provider validation

Existing server variable names: `OPENAI_API_KEY`, `VEXBOT_OPENAI_MODEL`, `VEXBOT_TRANSCRIBE_MODEL`, `VEXBOT_TTS_MODEL`, `VEXBOT_TTS_VOICE`, `VEXBOT_CLAMD_HOST`, `VEXBOT_CLAMD_PORT`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_URL` (or existing `VITE_SUPABASE_URL`). Frontend retains `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. `VEXBOT_PROVIDER=mock` and `VEXBOT_SCANNER=mock` remain local-only and refused on production. No environment values were changed.

No new variable enables Realtime: its transport is not implemented. Do not label the existing TTS pipeline as Marin Realtime by simply changing `VEXBOT_TTS_VOICE`.

Official OpenAI documentation was checked on 9 November 2026: the [requested model](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini) is documented and the [Realtime call schema](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/create) supports Marin, server VAD, near-field reduction and retention-ratio truncation. Documentation is not account entitlement verification. The generic WebRTC guide now defaults to a different Live API; it was not treated as permission to migrate the specified model/API.

## F. Visual evidence

Generated by actual local Chrome tests, synthetic workspaces only (git-ignored artifacts):

- [Desktop robot](../artifacts/screenshots/desktop-06-client-workspace-robot.png)
- [Scroll flight](../artifacts/screenshots/desktop-07-client-scroll-flight.png)
- [Cited answer](../artifacts/screenshots/desktop-09-client-cited-answer.png)
- [Mobile answer and robot](../artifacts/screenshots/mobile-02-client-sheet-answer.png)
- [WebGL fallback](../artifacts/screenshots/desktop-17-no-webgl-text-launcher.png)

Desktop cited-answer and mobile answer screenshots were visually inspected. Other screenshots are test captures; browser assertions additionally measure robot pixels, placement and state.

## G. Remaining work

Automatic contextual Present selection is not added; the original Present clip and its duration are available and verified.

1. Implement a durable supervised Realtime session lifecycle within approved existing hosting: server-owned call ID, authenticated start/end, bounded server-loaded context injection, ordered transcript event persistence, workspace access rechecks, per-user quotas, idle/duration cutoffs, fail-closed sideband supervision and provider hangup. The reference uses several-minute sessions; the current route declares 60 seconds. Increasing a number alone does not supply durable supervision. Browser credentials must remain absent.
2. With paid-use approval, verify actual account access to the exact model and Marin, then test WebRTC, VAD interruption, transcript reconciliation, mute/resume, failure cleanup and audio. No named alternative is currently required by evidence; none was substituted.
3. Add semantic retrieval/reranking if full-text lexical matching misses spelling variants; current prompt understands misspellings only when relevant passages are retrieved. Add explicit version supersession metadata if needed; retiring previous versions remains the existing approved workflow.
4. Add opt-in video transcription/media analysis and approved correspondence indexing using existing workspace permissions. Until then these are not claimed as analysed knowledge.
5. Extend admin greeting/voice/model/capability policies after supported provider/account options are verified; existing security rules stay protected.
6. Add durable request idempotency/transactional turn sequencing for simultaneous tabs/retries. Current UI guard prevents immediate duplicate clicks, but it is not distributed exactly-once persistence. Conversation writes still use the existing separate inserts.
7. Long-term fact summaries beyond the bounded window, real network failure tests, broader modal/assistive-device coverage and production retention review remain outstanding. No retention rule was changed.

## H. Final status

The implemented text, recorded-voice reliability and animation verification upgrades are ready for local review. Full Realtime replication remains incomplete; acoustic equivalence is unverified. No push, commit, deployment, hosted configuration change or paid provider call was performed. Deployment and paid provider testing require the user's explicit approval.
