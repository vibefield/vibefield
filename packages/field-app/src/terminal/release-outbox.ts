import { TerminalReleaseParams, TerminalReleaseResult } from "@vibefield/contracts";

const PREFIX = "vf-terminal-release-v1:";
type Request = { sessionId: string; condition: "unused" | "exited" };
const requestKey = (request: Request): string => `${request.sessionId}:${request.condition}`;
type Pending = { request: Request; promise: Promise<void>; resolve(): void; active: boolean };

/** Durable delivery of conditional cleanup intents, never browser authority
 * to terminate a PTY. Replaying an intent asks the owner to check it again. */
export class TerminalReleaseOutbox {
  private pending = new Map<string, Pending>();
  private send: ((request: Request) => Promise<unknown>) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly storage: () => Storage | undefined) {}

  connect(send: (request: Request) => Promise<unknown>): void {
    this.send = send;
    // A damaged entry must not prevent the terminal runtime from connecting.
    // Leave unrecognized entries intact; no deletion is authorized by bad data.
    try {
      const storage = this.storage();
      if (storage !== undefined) {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (!key?.startsWith(PREFIX)) continue;
          try {
            const parsed = TerminalReleaseParams.safeParse(
              JSON.parse(storage.getItem(key) ?? "null"),
            );
            if (parsed.success && key === PREFIX + requestKey(parsed.data)) this.hold(parsed.data);
          } catch {
            /* Keep the corrupt entry for diagnosis. */
          }
        }
      }
    } catch {
      /* Requests still refuse if durable storage is unavailable. */
    }
    void this.flush();
  }

  request(request: Request): Promise<void> {
    const held = this.pending.get(requestKey(request));
    if (held !== undefined) return held.promise;
    // An unwritable outbox refuses before relinquishing the caller's receipt.
    const storage = this.storage();
    if (storage === undefined)
      return Promise.reject(new Error("Terminal cleanup storage is unavailable"));
    storage.setItem(PREFIX + requestKey(request), JSON.stringify(request));
    const pending = this.hold(request);
    void this.flush();
    return pending.promise;
  }

  disconnect(): void {
    this.send = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private hold(request: Request): Pending {
    const existing = this.pending.get(requestKey(request));
    if (existing !== undefined) return existing;
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    const pending = { request, promise, resolve, active: false };
    this.pending.set(requestKey(request), pending);
    return pending;
  }

  async flush(): Promise<void> {
    const send = this.send;
    if (send === undefined) return;
    await Promise.all(
      [...this.pending.values()].map(async (pending) => {
        if (pending.active) return;
        pending.active = true;
        try {
          TerminalReleaseResult.parse(await send(pending.request));
          this.storage()?.removeItem(PREFIX + requestKey(pending.request));
          this.pending.delete(requestKey(pending.request));
          pending.resolve();
        } catch {
          // The owner's acknowledgement is missing. The durable intent stays,
          // including when the response was lost after it queued the release.
        } finally {
          pending.active = false;
        }
      }),
    );
    if (this.send !== undefined && this.pending.size > 0 && this.timer === undefined) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.flush();
      }, 1_000);
    }
  }
}
