import { createHandler } from '../server/vexbot/handler.mjs';

// Vexbot assistant, uploads, knowledge and settings. See server/vexbot/handler.mjs.
export const config = { maxDuration: 60 };
export default createHandler();
