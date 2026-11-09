import { database, authenticate, method, respondError, check } from '../runtime.mjs';
import { HttpError, id as uuid } from '../validation.mjs';
import { voiceContext } from './handler.mjs';
import { admit, createCall, hangUp, portalRealtimeSession, realtimeReadiness, supervise } from './realtime.mjs';

export function createVoiceHandler({ getDatabase = database, getContext = voiceContext, connect = createCall, superviseCall = supervise, terminate = hangUp, enabled = realtimeReadiness } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let db, lease, call, supervisor, heartbeat, closed = false;
    const emit = value => { if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(value)}\n`); };
    const disconnect = () => { closed = true; void supervisor?.finish('client-ended'); };
    try {
      method(req, ['POST']);
      db = getDatabase();
      const { user } = await authenticate(req, db);
      const input = req.body ?? {};
      if (input.action === 'end') {
        const row = check(await db.from('vexbot_voice_sessions').select('id,call_id,state').eq('id', uuid(input.session_id)).eq('user_id', user.id).maybeSingle());
        if (!row) throw new HttpError(404, 'Voice session not found.');
        if (row.state !== 'ended') await terminate(row.call_id);
        check(await db.from('vexbot_voice_sessions').update({ state: 'ended', ended_reason: 'client-ended' }).eq('id', row.id));
        return res.status(200).json({ ended: true });
      }
      if (!enabled().available) throw new HttpError(503, 'Live voice is not enabled. Use recorded voice or text.');
      if (typeof input.sdp !== 'string' || !input.sdp.startsWith('v=0') || input.sdp.length > 64000) throw new HttpError(400, 'A valid voice connection offer is required.');
      const context = await getContext(req, input, db);
      lease = await admit(db, context, terminate);
      res.on('close', disconnect);
      const history = await context.history();
      const config = portalRealtimeSession(history);
      call = await connect(input.sdp, config, context.user);
      check(await db.from('vexbot_voice_sessions').update({ call_id: call.callId, state: 'live' }).eq('id', lease));
      if (closed) {
        await terminate(call.callId);
        check(await db.from('vexbot_voice_sessions').update({ state: 'ended', ended_reason: 'client-ended' }).eq('id', lease));
        return;
      }
      supervisor = superviseCall({ callId: call.callId, session: config, context, emit, terminate });
      await supervisor.ready;
      if (closed) void supervisor.finish('client-ended');
      else {
        res.status(200);
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.flushHeaders?.();
        emit({ type: 'ready', answer: call.answer, session_id: lease, conversation: context.conversation, model: config.model, voice: config.audio.output.voice, seconds: 240 });
        if (!history.length) supervisor.greet();
        heartbeat = setInterval(() => emit({ type: 'heartbeat' }), 10000);
      }
      const result = await supervisor.done;
      // A concurrent authenticated end request may already have confirmed hangup.
      // An inconclusive supervisor request must never resurrect that ended lease.
      check(await db.from('vexbot_voice_sessions').update({ ...(result.terminated ? { state: 'ended' } : {}), ended_reason: result.reason, input_tokens: result.input, output_tokens: result.output, responses: result.responses }).eq('id', lease));
      emit({ type: 'ended', reason: result.reason });
      res.end();
    } catch (error) {
      if (supervisor) await supervisor.finish('error');
      let terminated = !call;
      if (call) { try { await terminate(call.callId); terminated = true; } catch { /* Lease stays blocked until confirmed hangup. */ } }
      if (lease && terminated) await db.from('vexbot_voice_sessions').update({ state: 'ended', ended_reason: 'error' }).eq('id', lease);
      if (res.headersSent) { emit({ type: 'ended', reason: 'unavailable' }); res.end(); }
      else if (!closed) respondError(res, error);
    } finally {
      clearInterval(heartbeat);
      res.off?.('close', disconnect);
      // All provider cleanup happens before this function returns to Vercel.
    }
  };
}
