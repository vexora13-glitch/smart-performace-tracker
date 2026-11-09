import { createVoiceHandler } from '../server/vexbot/realtime-handler.mjs';

// Holds a sideband supervisor for at most 240s, leaving time for admission and cleanup.
export const config = { maxDuration: 300 };
export default createVoiceHandler();
