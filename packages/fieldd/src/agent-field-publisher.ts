import {
  AGENT_FIELD,
  type AgentFieldSlice,
  type AgentListResult,
  STORES,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { FieldProjection } from "./agent-field";

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
   */
  serving: () => boolean;
  now?: () => number;
  /** test seams; the registry's values by default */
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

  // ---- internals ----

  private schedule(): void {
    if (this.disposed || this.coalesce !== null) return;
    this.coalesce = setTimeout(() => {
      this.coalesce = null;
      void this.flush();
    }, this.minIntervalMs);
    this.coalesce.unref?.();
  }

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
    await this.write({
      v: 1,
      deviceId: this.opts.deviceId(),
      publishedAt: at,
      expiresAt: at + this.expiryMs,
      revision: snapshot.revision,
      rows: snapshot.rows,
    });
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
      if (this.disposed || !this.opts.serving()) return;
      void this.publish();
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

  /** One writer, serialized, and quiet when the mesh is not there. */
  private write(slice: AgentFieldSlice): Promise<void> {
    const run = this.chain.then(async () => {
      try {
        await this.opts.mesh.setSlice(STORES.AGENT_FIELD, slice);
      } catch (error) {
        // mesh disabled / auth pending / node building — a NORMAL state, and
        // the next change retries. Never an error, never a throw at a caller.
        this.published = false;
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
