// NR (track NR, "native re-arm": item 237's root, with 238 and 262 its first consumers;
// `draft/thinking-native-replay-rearm.md` §3.2) — ONE native mesh subscription that asks again when the floor refuses
// it. To the stream, a refused FIRST subscribe and a refused REPLAY are the same event:
// - a refused first subscribe is thrown to `start`'s caller (the owner's "not live yet"), as it always was;
// - a refused replay is ended by NativeLink and told here (`NativeSubscribeOptions.onReplayFailed`).
// Either way the stream decides when to ask again, by what refused it:
// - THE NODE GATE (UNAVAILABLE, `MeshNotUpDetails` naming the mesh unit: field-native `mgmt/mesh.rs`, held to the golden
//   `error-data.mesh-not-up.json`). If the floor's health reads the node up NOW, the stream asks once now. That is the
//   one window the gate's answer and its health share: the node came up between the gate's check and the refusal's
//   write (§3.3). Otherwise it waits for the next moment its mesh gives it: the link connected, or the node turned up.
//   One ask per wait, so a gate that keeps refusing under a node read up cannot loop.
// - TIMEOUT, a full mesh queue (RESOURCE_EXHAUSTED, the floor's `mesh_queue`), or the link's own door while the floor
//   is held unresponsive (WG-D4, `NativeUnavailableDetails`): the same moments, and a paced ask between them,
//   500 ms × 2ⁿ to at most 10 s, while no moment comes (Q4 as amended 2026-11-08). A full queue is load, as a TIMEOUT
//   is. A held floor can come back with no redial and no turn of its node, so no moment would follow it.
// - any other retryable refusal: the next moment.
// - a refusal that is not retryable: the stream stops, and its owner hears it (`onStopped`) and reads UNAVAILABLE.
// The event is in-process and owes no wire schema. Its witnesses are `test/native-rearm-matrix.test.ts` and
// `test/mesh-stream.test.ts`.
import { MeshNotUpDetails } from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { isNativeUnresponsive, type NativeSubscribeOptions, RpcCallError } from "./native-link";

type StreamEventKind = "snapshot" | "delta";

/** The node gate's service: `MeshNotUpDetails.service` is "always mesh-gateway" (contracts `mgmt.ts`); the drive's
 * reader (`drive/service.ts`) and egress (`egress.ts`) read the same literal. */
const NODE_GATE_SERVICE = "mesh-gateway";

/** The pace of a paced refusal's ask (Q4 as amended), FielddClient's replay backoff. */
const BACKOFF = { baseMs: 500, capMs: 10_000 } as const;

/** Whether a refusal is the floor's node gate: its mesh node is not up (field-native `mgmt/mesh.rs` `unavailable`). */
export function isMeshNodeGate(error: unknown): boolean {
  if (!(error instanceof RpcCallError) || error.kind !== "UNAVAILABLE") return false;
  const details = MeshNotUpDetails.safeParse(error.details);
  return details.success && details.data.service === NODE_GATE_SERVICE;
}

/** How a refusal decides the stream's next ask (the header). "paced" is a TIMEOUT, a full mesh queue and a held
 * floor's door. */
export type MeshStreamRefusal = "node-gate" | "paced" | "retryable" | "final";

export function meshStreamRefusal(error: unknown): MeshStreamRefusal {
  if (isMeshNodeGate(error)) return "node-gate";
  if (!(error instanceof RpcCallError)) return "final";
  if (error.kind === "TIMEOUT" || isNativeUnresponsive(error)) return "paced";
  if (error.kind === "RESOURCE_EXHAUSTED" && error.retryable) return "paced";
  return error.retryable ? "retryable" : "final";
}

/** What a stream reads of its mesh to know when to ask again: MeshClient's. */
export interface MeshStreamWake {
  /** The floor's health last said its mesh node is up (`MeshClient.noteNodeState`). */
  nodeReadsUp(): boolean;
  /** Calls `fn` at each moment a waiting stream asks again: the link connected, the node turned up. Returns its off. */
  onRearm(fn: () => void): () => void;
}

export interface MeshStreamOptions {
  /** Says which stream this is, in its log lines (a store id, a method). */
  label: string;
  /** ONE subscribe, carrying the stream's replay owner, e.g. MeshClient's `subscribeStoreManaged` for one store. */
  subscribe(
    onEvent: (payload: unknown, kind: StreamEventKind) => void,
    opts: NativeSubscribeOptions,
  ): Promise<{ snapshot: unknown; dispose: () => void }>;
  wake: MeshStreamWake;
  /** The stream's deltas, and the fresh snapshot of a replay the floor answered (P5). */
  onEvent(payload: unknown, kind: StreamEventKind): void;
  /** Each ask's answer. `again` is false for `start`'s ask and true for every re-arm, which an owner that publishes
   * into the store takes as its moment to publish again: a node built anew holds none of its slice. */
  onSnapshot(snapshot: unknown, again: boolean): void;
  /** The stream stopped on a refusal it does not re-arm on. */
  onStopped?(error: unknown): void;
  logger?: Logger;
  /** The pace of a TIMEOUT's ask (tests). */
  backoff?: { baseMs: number; capMs: number };
}

export class MeshStream {
  readonly #opts: MeshStreamOptions;
  readonly #log: Logger;
  /** The stream's hold on its moments, from `start` until `stop`. */
  #off: (() => void) | null = null;
  #dispose: (() => void) | null = null;
  #asking = false;
  #started = false;
  #stopped = false;
  /** A refusal left the stream owed an ask at the next moment. */
  #waiting = false;
  /** This wait's one ask under a node that reads up now (the header), spent. */
  #spentNow = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #timeouts = 0;

  constructor(opts: MeshStreamOptions) {
    this.#opts = opts;
    this.#log = (opts.logger ?? createNoopLogger()).child({ component: "mesh.stream" });
  }

  /** The first ask. Resolves once the stream is live. A refusal rejects with the error (the owner's "not live yet"),
   * and the stream stays armed for any refusal it re-arms on. It asks once: every later ask is the stream's own, so a
   * second `start`, or one after `stop`, does nothing. */
  async start(): Promise<void> {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    this.#off = this.#opts.wake.onRearm(() => this.#moment());
    await this.#ask(false);
  }

  /** The floor answered the stream's last ask, and nothing has refused it since. */
  get live(): boolean {
    return this.#dispose !== null;
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#waiting = false;
    this.#off?.();
    this.#off = null;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#dispose?.();
    this.#dispose = null;
  }

  #moment(): void {
    if (!this.#waiting || this.#asking || this.#stopped) return;
    this.#spentNow = false;
    void this.#ask(true).catch(() => undefined);
  }

  async #ask(again: boolean): Promise<void> {
    if (this.#stopped) return;
    this.#asking = true;
    this.#waiting = false;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    let answer: { snapshot: unknown; dispose: () => void };
    try {
      answer = await this.#opts.subscribe(
        (payload, kind) => {
          if (!this.#stopped) this.#opts.onEvent(payload, kind);
        },
        { onReplayFailed: (error) => this.#refused(error) },
      );
    } catch (error) {
      this.#asking = false;
      this.#refused(error);
      if (!again) throw error;
      return;
    }
    this.#asking = false;
    if (this.#stopped) {
      answer.dispose();
      return;
    }
    this.#dispose = answer.dispose;
    this.#spentNow = false;
    this.#timeouts = 0;
    this.#opts.onSnapshot(answer.snapshot, again);
  }

  #refused(error: unknown): void {
    // a refused replay was ended by the link, and a refused ask never stood: either way nothing is left to dispose
    this.#dispose = null;
    if (this.#stopped) return;
    const refusal = meshStreamRefusal(error);
    this.#log.info("fieldd.mesh_stream.refused", "A native mesh stream was refused", {
      stream: this.#opts.label,
      refusal,
      error: String(error),
    });
    if (refusal === "final") {
      this.#opts.onStopped?.(error);
      return;
    }
    this.#waiting = true;
    if (refusal === "node-gate") {
      if (this.#opts.wake.nodeReadsUp() && !this.#spentNow) {
        this.#spentNow = true;
        void this.#ask(true).catch(() => undefined);
      }
      return;
    }
    if (refusal === "paced") {
      const pace = this.#opts.backoff ?? BACKOFF;
      const delay = Math.min(pace.capMs, pace.baseMs * 2 ** this.#timeouts);
      this.#timeouts += 1;
      this.#timer = setTimeout(() => {
        this.#timer = null;
        if (this.#waiting && !this.#asking && !this.#stopped)
          void this.#ask(true).catch(() => undefined);
      }, delay);
      this.#timer.unref?.();
    }
  }
}
