export function events(body: ReadableStream<Uint8Array> | null): AsyncGenerator<{ event: string; data: string }>;
export function partialAnswer(json: string, sources: { id: string }[]): string;
