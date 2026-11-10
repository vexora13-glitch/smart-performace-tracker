# Vexora website / Client Portal listening acceptance

Status: PENDING. A matching voice ID and a successful API connection do not establish audible fidelity.

Note, 11 November 2026: the portal's live voice is now `cedar`, chosen for a clear professional delivery, so the portal and website intentionally sound different. Use this procedure to judge the portal's clarity, pacing, turn-taking and accuracy on its own terms; the website column is a reference for behaviour, not a voice to match.

Use `https://vexoradigital.com` as the reference and the local portal with the reviewed session migration and `VEXBOT_REALTIME_ENABLED=true`. Do not modify the website or deploy either project. Use an authorised synthetic workspace with a short approved project description. A website agent may legitimately lack that private project context; compare delivery separately from knowledge accuracy.

## Setup

1. Use the same physical microphone, headphones/output device, volume, browser, room and network. Run one agent at a time to prevent acoustic cross-talk.
2. Note OS/browser/device, test date, approximate network conditions and the source/deployed configuration where available. Keep model and voice fixed. Confirm each session's first greeting and later turns retain the same identity.
3. Have the participant explicitly agree before recording their microphone or other participants. Audio capture is optional. If capturing, use a local screen/system-audio recorder for matched outputs, avoid private client data and agree where recordings are stored/deleted. Do not upload recordings automatically.
4. Open a fresh voice conversation with each agent. Repeat the same words at similar volume and pace. Record observations for both agents without guessing numeric similarity scores.

## Matched prompts

| Step | Spoken input/action | Website observation | Portal observation |
| --- | --- | --- | --- |
| 1 | “Hi VexBot, can you introduce yourself?” | Pending | Pending |
| 2 | “Can you explain what Vexora does?” | Pending | Pending |
| 3 | “Tell me about the project we're working on.” | Pending; knowledge may differ | Pending; must use authorised workspace evidence |
| 4 | “Actually, make that explanation much shorter.” | Pending | Pending; latest correction must win |
| 5 | Ask for a longer explanation, then speak “Actually, stop. Let's change the subject.” halfway through audible speech. | Pending | Pending; no stale words should resume |

For every step compare perceived voice identity/timbre, warmth/energy, pace/rhythm, pauses, sentence endings, pronunciation of Vexora/project names, answer length, unnecessary acknowledgements, glitches and recovery. If paired recordings exist, listen to alternating reference/portal clips with comparable playback level. Report subjective judgements as such; do not invent acoustic similarity percentages. Any instrumental measurement must name its method, recording conditions and limits.

## Additional portal checks

- Continue for at least five turns without restarting the microphone. Ask a workspace question, open its displayed source and confirm it is authorised/published. Ask about an unavailable detail and expect an honest limitation.
- Interrupt early, midway and near the end of a response. Repeat interruptions quickly and while knowledge is loading. Check immediate exit from Speak, no queued stale audio/caption replay, and a relevant answer to the latest request.
- Mute while speaking, confirm microphone is muted, then resume. Try the playback-enablement control if the browser blocks sound. End and immediately restart; no busy lease should remain after confirmed cleanup.
- Return to text with Open chat; check persisted transcript/citations and make a correction. Resume voice in the same conversation; no repeated introduction or loss of that correction.
- Close the panel, switch workspace, sign out, hide/close the tab, unplug the microphone, revoke permission, and interrupt the network. Check browser microphone release, neutral robot attention, safe notices and server session termination. A workspace change must never carry private context into another workspace.
- Test desktop Chrome/Edge and real mobile Chrome/Safari. Test speaker echo separately from headphones. Check the keyboard, small-screen controls, reduced motion, Keep still and Hide robot.
- Repeat after reconnection/navigation and compare the voice to the first greeting. If recorded fallback is used, confirm its different-voice disclosure is visible.

## Record the result

| Acceptance item | Result / evidence |
| --- | --- |
| Original configuration audited | Source verified; deployed private overrides unconfirmed |
| Portal native configuration accepted by provider | Verified; see implementation report |
| Human physical microphone / multiple turns | Pending |
| Human audible interruption and recovery | Pending |
| Voice identity, cadence and pronunciation A/B | Pending |
| Desktop and real mobile audible QA | Pending |
| Workspace citations / text continuity | Local automated checks pass; human confirmation pending |
| Remaining audible differences and agreed adjustments | Pending |
| Participant/date / recording consent and location | Fill in during testing |

Do not mark the voice replication requirement complete until actual listening supports the result. Hosted rollout needs separate approval.
