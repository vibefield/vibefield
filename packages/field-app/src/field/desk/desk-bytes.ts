// Bytes the desk's bundled modules carry as text (DK-3, ruling 8): base64 in, bytes out, and a gzip
// member inflated in memory. No request anywhere — what the packaged CSP's `connect-src` would refuse
// (r6 §3) never happens here.

/** Base64 text (line breaks allowed — `atob` is the forgiving decode) → bytes. */
export function base64Bytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Inflate a gzip member: a stream through `DecompressionStream`, read to its end. */
export async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream("gzip")).getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    length += value.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
