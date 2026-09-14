import {
  AGENT_FIELD,
  type AgentFieldSlice,
  type AgentListResult,
  MESH_CONTROL_LIMITS,
  STORES,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { FieldProjection } from "./agent-field";
import { RpcCallError } from "./native-link";

// MF-1 (§10.2, D4's hybrid) — the field's SECOND carrier: fieldd publishes its
// own rows into the `field.agents.v1` SyncedStore, so a phone that joins the
// tailnet gets every desktop's board from the mesh itself — replication,
// catch-up on join, removal on leave, and no fieldd in the read path. The
// product door (`agent.subscribe {projection: "field"}`) serves the SAME rows
// to a reader that prefers to dial.
//
// Three honesty rules hold this together:
//   - MESH-DOWN IS A NORMAL STATE. The slice simply is not written and the next
//     change tries again — DeviceService's own posture. Nothing throws, nothing
//     is logged at error, and no caller waits on the mesh.
//   - AN UNCHANGED BOARD IS NOT NEWS. The projection's revision only moves when
//     a projected fact moved, so a working agent's mirror revising many times a
//     second costs the mesh nothing.
//   - A DEAD DESKTOP MUST NOT LIE. Every slice carries `expiresAt`; a live
//     publisher pushes it forward on a heartbeat, and a graceful stop publishes
//     empty rows with the clock already past. A reader drops what it cannot
//     see refreshed, so a desktop that was unplugged mid-sentence fades instead
//     of haunting every phone with rows that will never change again.

export interface AgentFieldPublisherOptions {
  /** the C2 store facade (`MeshClient`), structurally typed so the publisher
   * never imports the client it is handed */
  mesh: { setSlice(storeId: string, data: unknown): Promise<unknown> };
  /** this device's mesh identity (DeviceService's — the slice key's own value) */
  deviceId: () => string;
  /** the fold */
  list: () => AgentListResult;
  subscribe: (emit: (rows: AgentListResult) => void) => () => void;
  /**
   * THE GATE. Serving this device's agent field to the tailnet is a consent
   * act, and the publisher writes only while that consent holds.
   *
   * §10.2 asks for "the floor's terminal mesh is SERVING" — the same consent
   * that already advertises this device's sessions in `terminal.v1.hosts`.
   * fieldd cannot read that today: the floor reports its terminal-mesh state
   * ONLY as prose in a unit `detail` string
   * (`field-native/src/services/terminal.rs`, the `publishing {store}` / `off —
   * {reason}` face), the mgmt hello carries `terminal`/`terminalRoutes` and no
   * mesh flag (`contracts/src/envelope.ts` HelloAck), and fieldd subscribes to
   * no observed-unit stream at all. Adding a typed fact to the floor's hello is
   * cross-plane work; until it lands, the daemon passes the best structured
   * truth it HAS, and the gap is stated here rather than papered over with a
   * string match on someone else's prose.
   *
   * MF-1h — THE FALSE POSITIVE that leaves, named. The product serve can be
   * active while the floor's terminal mesh is OFF (both native flags ship
   * off), and every row carries its `terminal` join verbatim: a phone then
   * draws a TAPPABLE card for a PTY that is not on the mesh and cannot be
   * attached to. The floor knows the answer — it mints a mirror-write
   * capability at boot exactly when the mesh is on — but the only mgmt verb
   * that reveals it hands over the CAPABILITY ITSELF, which MF-2a pins to one
   * hop per grant (nothing caches it, and a plugin never even causes it to be
   * read into this process). Polling it here would move a secret across the
   * mgmt channel on a schedule nothing needs. A SECRET-FREE fact closes it: a
   * `terminalMesh` boolean on the floor's hello beside `terminal`, or a
   * `configured`-only verb. OWED.
   */
  serving: () => boolean;
  now?: () => number;
  /** test seams; the registry's values by default */
  sliceBytes?: number;
  minIntervalMs?: number;
  heartbeatMs?: number;
  expiryMs?: number;
  logger?: Logger;
}

export class AgentFieldPublisher {
  private readonly projection = new FieldProjection();
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private readonly heartbeatMs: number;
  private readonly expiryMs: number;
  private readonly sliceBytes: number;
  /** MF-1h — whether the board is CURRENTLY over the cap, so the crossing is
   * logged once in each direction instead of on every flush */
  private capped = false;
  private readonly logger: Logger;
  private unsubscribe: (() => void) | null = null;
  private coalesce: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  /** writes SERIALIZE: two slices for one store must never race to the node */
  private chain: Promise<void> = Promise.resolve();
  /** what the mesh was last told — so a gate that closes can clear it */
  private published = false;
  private disposed = false;

  constructor(private readonly opts: AgentFieldPublisherOptions) {
    this.now = opts.now ?? Date.now;
    this.minIntervalMs = opts.minIntervalMs ?? AGENT_FIELD.STORE_MIN_INTERVAL_MS;
    this.heartbeatMs = opts.heartbeatMs ?? AGENT_FIELD.STORE_HEARTBEAT_MS;
    this.expiryMs = opts.expiryMs ?? AGENT_FIELD.STORE_EXPIRY_MS;
    this.sliceBytes = opts.sliceBytes ?? MESH_CONTROL_LIMITS.AGENT_FIELD_SLICE_BYTES;
    this.logger = opts.logger ?? createNoopLogger();
  }

  /** Subscribe the fold and publish what is already there. */
  start(): void {
    if (this.disposed || this.unsubscribe !== null) return;
    this.unsubscribe = this.opts.subscribe(() => this.schedule());
    this.schedule();
  }

  /** The gate moved (the serve went active, or away). A gate that OPENS
   * publishes what the board holds; one that CLOSES withdraws it rather than
   * leaving rows to age out of a reader on the expiry clock. */
  notifyServingChanged(): void {
    if (this.disposed) return;
    this.schedule();
  }

  /** A graceful stop: rows gone, `expiresAt` already past. A reader drops this
   * desktop immediately instead of waiting out the clock. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clearTimers();
    if (!this.published) return;
    this.published = false;
    // MF-1h — a teardown must not throw: `deviceId()` is DeviceService, which
    // a stop may already have disposed, and this is awaited by the daemon's
    // own stop ladder. A field left standing for its expiry is a far smaller
    // harm than a stop that rejects halfway through.
    try {
      const at = this.now();
      await this.write({
        v: 1,
        deviceId: this.opts.deviceId(),
        publishedAt: at,
        expiresAt: at,
        revision: this.projection.revision,
        rows: [],
      });
    } catch (error) {
      this.trouble("dispose", error);
    }
  }

  // ---- internals ----

  private schedule(): void {
    if (this.disposed || this.coalesce !== null) return;
    this.coalesce = setTimeout(() => {
      this.coalesce = null;
      void this.flush().catch((error: unknown) => this.trouble("flush", error));
    }, this.minIntervalMs);
    this.coalesce.unref?.();
  }

  /** The heartbeat's own body, so its `void` site has something to catch. */
  private async beat(): Promise<void> {
    if (this.disposed || !this.opts.serving()) return;
    await this.publish();
  }

  /** MF-1h — EVERY call in here is an injected live service: `list()` is the
   * fold mid-rebuild, `serving()` reads the mesh's fused serve state,
   * `deviceId()` is DeviceService before it is ready. Each can throw, and this
   * runs from a timer with no caller to catch it — Node's default handler for
   * an unhandled rejection TERMINATES the daemon, and fieldd installs none. So
   * the whole body is guarded, not just the mesh write. */
  private async flush(): Promise<void> {
    if (this.disposed) return;
    const changed = this.projection.apply(this.opts.list()) !== null;
    if (!this.opts.serving()) {
      // consent is gone (or never arrived). Withdraw anything already out
      // there, then stay quiet — the projection keeps folding either way, so
      // the moment the gate opens the board is current.
      this.clearHeartbeat();
      if (this.published) {
        this.published = false;
        const at = this.now();
        await this.write({
          v: 1,
          deviceId: this.opts.deviceId(),
          publishedAt: at,
          expiresAt: at,
          revision: this.projection.revision,
          rows: [],
        });
      }
      return;
    }
    // A first publish after the gate opened is news even when the board did
    // not move — the mesh has never seen it.
    if (!changed && this.published) return;
    await this.publish();
  }

  private async publish(): Promise<void> {
    const snapshot = this.projection.snapshot();
    const at = this.now();
    this.published = true;
    await this.write(
      this.capToLimit({
        v: 1,
        deviceId: this.opts.deviceId(),
        publishedAt: at,
        expiresAt: at + this.expiryMs,
        revision: snapshot.revision,
        rows: snapshot.rows,
      }),
    );
    // The heartbeat exists for rows: an empty board has nothing to keep alive,
    // and a reader with no rows to age has nothing to be wrong about.
    if (snapshot.rows.length === 0) {
      this.clearHeartbeat();
      return;
    }
    this.armHeartbeat();
  }

  private armHeartbeat(): void {
    if (this.heartbeat !== null || this.disposed) return;
    this.heartbeat = setTimeout(() => {
      this.heartbeat = null;
      void this.beat().catch((error: unknown) => this.trouble("heartbeat", error));
    }, this.heartbeatMs);
    this.heartbeat.unref?.();
  }

  private clearHeartbeat(): void {
    if (this.heartbeat === null) return;
    clearTimeout(this.heartbeat);
    this.heartbeat = null;
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.coalesce !== null) {
      clearTimeout(this.coalesce);
      this.coalesce = null;
    }
  }

  /** MF-1h — a slice has a transport limit, and a board can outgrow it: a
   * populated row measures ≈725 B against a 64 KiB cap, so roughly ninety
   * agents reach it. The floor REFUSES an oversized write
   * (`RESOURCE_EXHAUSTED`), which the catch below would otherwise read as
   * mesh-down and retry forever — this desktop would simply vanish from every
   * phone rather than arrive short. So the board is trimmed from its END (the
   * fold's own order is oldest first, so the newest runs are what a reader
   * loses) and the slice says how many it lost. The DOOR is never capped; a
   * phone that wants the whole board subscribes. */
  private capToLimit(slice: AgentFieldSlice): AgentFieldSlice {
    if (Buffer.byteLength(JSON.stringify(slice), "utf8") <= this.sliceBytes) {
      if (this.capped) {
        this.capped = false;
        this.logger.info(
          "fieldd.agents.field_slice_whole",
          "The agent field fits its transport limit again; the whole board is published",
          { rows: slice.rows.length, limit: this.sliceBytes },
        );
      }
      return slice;
    }
    const rows = [...slice.rows];
    let capped: AgentFieldSlice = slice;
    while (rows.length > 0) {
      rows.pop();
      capped = { ...slice, rows: [...rows], omitted: slice.rows.length - rows.length };
      if (Buffer.byteLength(JSON.stringify(capped), "utf8") <= this.sliceBytes) break;
    }
    if (!this.capped) {
      this.capped = true;
      this.logger.warn(
        "fieldd.agents.field_slice_capped",
        "The agent field outgrew its transport limit; the newest rows are left out of the slice",
        { rows: capped.rows.length, omitted: capped.omitted ?? 0, limit: this.sliceBytes },
      );
    }
    return capped;
  }

  /** A throw from a timer, said once and swallowed — the alternative is Node's
   * default handler, which ends the daemon over a fold that was mid-rebuild. */
  private trouble(where: string, error: unknown): void {
    this.logger.warn(
      "fieldd.agents.field_publish_failed",
      "The agent field publisher could not complete a pass",
      { where, error: error instanceof Error ? error.message : String(error) },
    );
  }

  /** One writer, serialized, and quiet when the mesh is not there. */
  private write(slice: AgentFieldSlice): Promise<void> {
    const run = this.chain.then(async () => {
      try {
        await this.opts.mesh.setSlice(STORES.AGENT_FIELD, slice);
      } catch (error) {
        this.published = false;
        // MF-1h — the floor REFUSING the slice is not the mesh being down. The
        // refusal says the transport limit was exceeded, in the floor's own
        // words, and retrying it unchanged would never succeed — so it is news
        // at WARN rather than a quiet DEBUG a nobody reads.
        if (error instanceof RpcCallError && error.kind === "RESOURCE_EXHAUSTED") {
          this.logger.warn(
            "fieldd.agents.field_slice_refused",
            "The floor refused the agent field slice",
            {
              rows: slice.rows.length,
              bytes: Buffer.byteLength(JSON.stringify(slice), "utf8"),
              reason: error.message,
            },
          );
          return;
        }
        // mesh disabled / auth pending / node building — a NORMAL state, and
        // the next change retries. Never an error, never a throw at a caller.
        this.logger.debug(
          "fieldd.agents.field_slice_unpublished",
          "The agent field slice was not published; the mesh is not there",
          {
            rows: slice.rows.length,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    });
    this.chain = run.catch(() => {});
    return run;
  }
}
