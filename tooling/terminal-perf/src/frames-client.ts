// A Node client for the CELL'S FRAMES SOCKET — the door the shipped
// `GhostteaAutomationClient` deliberately does not open ("This client never
// opens the frame socket, attaches a renderer view, or claims terminal layout
// authority" — ghosttea-client/dist/index.d.ts:38-42).
//
// The protocol is not documented anywhere; it is read off the shipped bridge,
// which is the only implementation:
//   * framing — `[u32le length][body]`, both directions
//     (`ghosttea-electron/dist/bridge-socket.js:2-8`, `packet()`)
//   * auth    — the FIRST packet written is the ticket token; the daemon answers
//     one packet whose body is exactly `ok` (`bridge-socket.js:45,60-63`)
//   * subscribe — a JSON packet `{type:"subscribe", requestId, sessionHandles}`
//     (`ghosttea-react/dist/runtime.js:466-471`)
//   * frames  — a packet whose first u32le is TRF1's magic is the frame VERBATIM;
//     anything else is JSON (`subscription-ack` | `frame-gap`)
//     (`ghosttea-electron/dist/bridge-entry.js:46-72`)
//
// `frameCredits`/`bridgeCapabilities` are deliberately NOT sent. They are a
// BRIDGE concern: `bridge-entry.js:105-116` consumes `frame-credit` locally and
// returns before writing anything to the socket, so credits never reach the
// daemon at all. A recorder that asked for them would be modelling the bridge's
// backpressure rather than the cell's output, and would then have to return
// credits it has no renderer to earn.

import type { Socket } from "node:net";
import { openEndpoint } from "@vibecook/ghosttea-client";
import { isFrameBody } from "./trf1-container";

/** The bridge's own frame ceiling (`bridge-entry.js:7`). A body larger than this
 * is a framing error, not a big frame. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** Length-prefix a body. `bridge-socket.js:2-8`. */
export function packet(bytes: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(4 + bytes.byteLength);
  out.writeUInt32LE(bytes.byteLength, 0);
  out.set(bytes, 4);
  return out;
}

export interface FramesSocketEvents {
  /** A TRF1 frame, verbatim. The buffer is a COPY owned by the callback — the
   * recorder keeps it, so it must not alias the read buffer. */
  onFrame(bytes: Uint8Array, receivedAtUs: number): void;
  /** `subscription-ack`, `frame-gap`, or anything else JSON the daemon sends.
   * Kept rather than dropped: a `frame-gap` during a capture means the corpus
   * entry has a hole in it, and a corpus that hides that is worse than none. */
  onMessage(message: Record<string, unknown>): void;
  onError(error: Error): void;
}

export interface FramesSocket {
  /** Subscribe to a set of session handles. Replaces any previous set — the
   * daemon's subscription is the whole list, not a delta (`runtime.js:462-471`
   * sends every subscribed handle every time). */
  subscribe(sessionHandles: readonly string[]): void;
  close(): void;
}

/** Microseconds on the same monotonic clock the container's offsets use. */
export function nowUs(): number {
  return Number(process.hrtime.bigint() / 1000n);
}

/**
 * Dial, authenticate, and start reading the frames socket.
 *
 * Resolves once the daemon has answered `ok`, so a caller that subscribes on the
 * next line cannot race the handshake.
 */
export async function connectFramesSocket(
  path: string,
  token: string,
  events: FramesSocketEvents,
  timeoutMs = 10_000,
): Promise<FramesSocket> {
  const deadline = Date.now() + timeoutMs;
  const socket: Socket = await openEndpoint(path, deadline);

  return await new Promise<FramesSocket>((resolve, reject) => {
    // `Buffer<ArrayBufferLike>`, not `Buffer<ArrayBuffer>`: a socket chunk is
    // the looser type, and narrowing here only to cast it back at every append
    // buys nothing.
    let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let authenticated = false;
    let settled = false;
    let requestId = 0;

    const timer = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error(`frames socket timed out authenticating at ${path}`));
      },
      Math.max(0, deadline - Date.now()),
    );

    const fail = (error: Error): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(error);
      } else {
        events.onError(error);
      }
    };

    socket.on("error", fail);
    socket.on("close", () => {
      if (!settled) fail(new Error(`frames socket closed during authentication at ${path}`));
    });

    // `openEndpoint` resolves only once connected, so the token goes now.
    socket.write(packet(Buffer.from(token)));

    socket.on("data", (chunk: Buffer) => {
      // The timestamp is taken ONCE per read, before any parsing: several frames
      // can arrive in one chunk, and stamping them individually after decode
      // would attribute this process's parse cost to the cell's cadence.
      const receivedAtUs = nowUs();
      buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const length = buffered.readUInt32LE(0);
        if (length > MAX_FRAME_BYTES) {
          fail(new Error(`frames socket packet of ${length} bytes exceeds the quota`));
          return;
        }
        if (buffered.length < 4 + length) return;
        const body = buffered.subarray(4, 4 + length);
        buffered = buffered.subarray(4 + length);

        if (!authenticated) {
          if (body.toString() !== "ok") {
            fail(new Error("frames socket authentication failed"));
            return;
          }
          authenticated = true;
          settled = true;
          clearTimeout(timer);
          resolve({
            subscribe(sessionHandles): void {
              socket.write(
                packet(
                  Buffer.from(
                    JSON.stringify({
                      type: "subscribe",
                      requestId: requestId++,
                      sessionHandles: [...sessionHandles],
                    }),
                  ),
                ),
              );
            },
            close(): void {
              socket.destroy();
            },
          });
          continue;
        }

        if (isFrameBody(body)) {
          // COPY: `body` is a view into `buffered`, which the next chunk
          // replaces. A recorder that kept the view would hold a corpus of
          // whatever happened to be in the socket buffer at the end.
          events.onFrame(Uint8Array.prototype.slice.call(body), receivedAtUs);
          continue;
        }
        try {
          events.onMessage(JSON.parse(body.toString("utf8")) as Record<string, unknown>);
        } catch (cause) {
          fail(new Error(`frames socket sent an undecodable message: ${String(cause)}`));
          return;
        }
      }
    });
  });
}
