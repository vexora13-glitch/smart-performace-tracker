// Exact source-reported reference contract. Not an enabled transport or account-access claim.
// A supervised, durable session lifecycle is required before admitting any live call.
export function referenceRealtimeSession(instructions) {
  return {
    type: 'realtime',
    model: 'gpt-realtime-2.1-mini',
    output_modalities: ['audio'],
    max_output_tokens: 800,
    tracing: null,
    truncation: {
      type: 'retention_ratio',
      retention_ratio: 0.8,
      token_limits: { post_instructions: 4000 },
    },
    instructions,
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
        transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice: 'marin' },
    },
  };
}
export function realtimeReadiness() {
  return {
    available: false,
    model: 'gpt-realtime-2.1-mini',
    voice: 'marin',
    reason:
      'Live conversation is not configured for this portal yet. You can type or use recorded questions when available.',
  };
}
