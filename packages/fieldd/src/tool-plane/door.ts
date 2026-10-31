import { TextDecoder } from "node:util";
import {
  NATIVE_DOOR,
  NativeDoorClosed,
  NativeDoorOpen,
  type NativeDoorPane,
  NativeDoorSnapshot,
  type SparkId,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { McpConnection, type McpServerOptions } from "./mcp";

// CP-1b — fieldd's half of the `vibefield` door (the compose plane, version 2; CP-L1, CP-L3, CP-D1). The floor accepts
// each connection on `door.sock`, has the kernel name the caller, walks it to the pane that holds it, and announces the
// door on `native.door.subscribe` (CP-1a). The door's bytes ride the meshdata plane as a lane of their own. This side
// claims each announced door's lane, splits its bytes into lines (the floor moves raw chunks and never parses a
// message), answers each line through an McpConnection, and writes the answer back down the same lane.
//
// Who is calling is the floor's walk plus fieldd's own map of panes to runs, and what each caller is served is the tool
// plane's (index.ts, by the rows' audience; MT-0): a spark every served row, a run the `agent` rows, and a pane with no
// run or a caller outside every pane nothing. A token plays no part (CP-D1). Lines on one door are answered in order;
// doors do not wait on each other.
//
// MT-0's settle rule (the MT lead's rulings 8 and 9, as corrected 2026-10-30 23:40Z): a caller is SETTLED only on
// positive evidence, a spark that verifies or a run whose verified record names no spark, and its answer is then final
// for the door's life (MT-D4: the list is stable per session). Anything else is UNSETTLED: served nothing and asked
// again, at most once per REASK_MS. A door can open before fieldd knows its run or its spark: after a fieldd restart
// the floor re-announces the doors it held before the session records and the spark store are read back.

/** Why an unsettled run is served nothing yet: its record is missing or does not verify, or it names a spark that does
 * not (a spark's run must never be served a plain run's rows, nor a forged spark's run anything). */
export type DoorUnsettled = "record-unverified" | "spark-unverified";

/** Who opened a door, as fieldd knows it. `profiles` are the Agent Profiles its calls are held to: a spark's record's,
 * or the one a run is filed under. */
export type DoorCaller =
  | {
      readonly kind: "spark";
      readonly sparkId: SparkId;
      readonly runtimeRunId: string;
      readonly profiles: readonly string[];
    }
  | {
      readonly kind: "run";
      readonly runtimeRunId: string;
      readonly profiles: readonly string[];
      readonly unsettled?: DoorUnsettled;
    }
  | { readonly kind: "pane"; readonly terminalSessionId: string }
  | { readonly kind: "outside" };

/** A settled caller's answer is final for its door; an unsettled one is asked again. */
export const isSettled = (caller: DoorCaller): boolean =>
  caller.kind === "spark" || (caller.kind === "run" && caller.unsettled === undefined);

/** How often an unsettled door is asked again, at most: each ask reads a session record and checks its HMAC, so a
 * forged spark's run cannot make fieldd do that at its own request rate (EL7; the MT lead, 23:40Z). */
export const REASK_MS = 1000;

export interface DoorNative {
  subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }>;
  request(method: string, params: unknown): Promise<unknown>;
}

/** The meshdata lane link's door-facing half (mesh-lane.ts). */
export interface DoorLanes {
  onLane(laneId: number, handler: (payload: Uint8Array) => void): void;
  offLane(laneId: number): void;
  send(laneId: number, payload: Uint8Array): boolean;
  flush(laneId: number, timeoutMs?: number): Promise<void>;
}

export interface DoorServiceOptions {
  readonly native: DoorNative;
  readonly lanes: DoorLanes;
  /** The pane's run, and whether that run is a spark's own session. Asked again, at most once per REASK_MS, until the
   * answer is settled, so a door that opens a moment before fieldd records its run or its spark is served once it is. */
  identify(pane: NativeDoorPane | undefined): DoorCaller;
  /** The server a caller is served (index.ts: its rows by audience). */
  serve(caller: () => DoorCaller, door: { readonly connId: string }): McpServerOptions;
  /** Whether a caller is served any row. */
  holdsTools(caller: DoorCaller): boolean;
  /** A door whose caller holds no tools: once per door, for the record (CP-L6). */
  onPlainCaller?(caller: DoorCaller, door: NativeDoorOpen): void;
  /** The clock the re-ask bound reads (tests). Default Date.now. */
  readonly now?: () => number;
  readonly logger?: Logger;
  /** A line longer than this closes its door. Default NATIVE_DOOR.LINE_MAX_BYTES, the bound the bridge itself ends on
   * (exit 4), so this is the backstop. Counted in UTF-16 units, never more than the line's bytes, so it never closes a
   * line the bridge would carry. */
  readonly maxLineBytes?: number;
}

interface Door {
  readonly open: NativeDoorOpen;
  readonly connection: McpConnection;
  readonly decoder: TextDecoder;
  /** Who is calling, asked again until it is settled (DoorServiceOptions.identify). */
  readonly caller: () => DoorCaller;
  pending: string;
  chain: Promise<void>;
  toldPlain: boolean;
}

export class DoorService {
  readonly #doors = new Map<string, Door>();
  readonly #encoder = new TextEncoder();
  readonly #logger: Logger;
  #subscription: { dispose: () => void } | undefined;
  #starting: Promise<void> | undefined;
  #stopped = false;

  constructor(private readonly opts: DoorServiceOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
  }

  /** Subscribe to the floor's doors, once; called again on every NativeLink "connected" (a refused first subscribe is
   * not retried by the link itself, terminal-service.ts's rule). A floor that answers with no door unit (a build
   * before CP-1a, or Windows) leaves the compose plane without a door and says so once. */
  ensureStarted(): Promise<void> {
    if (this.#stopped || this.#subscription) return Promise.resolve();
    this.#starting ??= this.opts.native
      .subscribe("native.door.subscribe", {}, (payload, kind) => this.#event(payload, kind))
      .then(({ snapshot, dispose }) => {
        if (this.#stopped) return dispose();
        this.#subscription = { dispose };
        this.#event(snapshot, "snapshot");
      })
      .catch((err: unknown) => {
        this.#logger.warn(
          "fieldd.compose.door_unavailable",
          "The floor offers no vibefield door yet",
          {
            reason: (err as Error).message,
          },
        );
      })
      .finally(() => {
        this.#starting = undefined;
      });
    return this.#starting;
  }

  stop(): void {
    this.#stopped = true;
    this.#subscription?.dispose();
    this.#subscription = undefined;
    for (const connId of [...this.#doors.keys()]) this.#release(connId);
  }

  /** The doors open now, for tests and diagnostics: connId → who is calling. */
  doors(): ReadonlyMap<string, DoorCaller> {
    return new Map([...this.#doors].map(([id, d]) => [id, d.caller()]));
  }

  #event(payload: unknown, kind: "snapshot" | "delta"): void {
    if (kind === "snapshot") {
      // A snapshot is the whole truth (a first subscribe, a floor's replay after a reconnect, a coalesced backlog):
      // claim what is new, let go of what is gone.
      const parsed = NativeDoorSnapshot.safeParse(payload);
      if (!parsed.success) {
        this.#logger.warn(
          "fieldd.compose.snapshot_unread",
          "A door snapshot from the floor could not be read",
        );
        return;
      }
      const live = new Set(parsed.data.doors.map((d) => d.connId));
      for (const connId of [...this.#doors.keys()]) if (!live.has(connId)) this.#release(connId);
      for (const door of parsed.data.doors) this.#open(door);
      return;
    }
    const opened = NativeDoorOpen.safeParse(payload);
    const closed = opened.success ? undefined : NativeDoorClosed.safeParse(payload);
    if (opened.success) this.#open(opened.data);
    else if (closed?.success) this.#release(closed.data.connId);
    else
      this.#logger.warn(
        "fieldd.compose.delta_unread",
        "A door delta from the floor could not be read",
      );
  }

  #open(open: NativeDoorOpen): void {
    const known = this.#doors.get(open.connId);
    if (known && known.open.laneId === open.laneId) return;
    if (known) this.#release(open.connId);
    const now = this.opts.now ?? Date.now;
    let seen = this.opts.identify(open.pane);
    let askedAt = now();
    const caller = (): DoorCaller => {
      if (!isSettled(seen) && now() - askedAt >= REASK_MS) {
        seen = this.opts.identify(open.pane);
        askedAt = now();
      }
      return seen;
    };
    const door: Door = {
      open,
      caller,
      connection: new McpConnection(this.opts.serve(caller, { connId: open.connId })),
      decoder: new TextDecoder("utf-8"),
      pending: "",
      chain: Promise.resolve(),
      toldPlain: false,
    };
    this.#doors.set(open.connId, door);
    this.opts.lanes.onLane(open.laneId, (payload) => this.#bytes(door, payload));
  }

  #bytes(door: Door, payload: Uint8Array): void {
    if (this.#doors.get(door.open.connId) !== door) return;
    door.pending += door.decoder.decode(payload, { stream: true });
    let cut = door.pending.indexOf("\n");
    while (cut >= 0) {
      const line = door.pending.slice(0, cut).replace(/\r$/, "");
      door.pending = door.pending.slice(cut + 1);
      if (line.trim().length > 0) door.chain = door.chain.then(() => this.#answer(door, line));
      cut = door.pending.indexOf("\n");
    }
    if (door.pending.length > (this.opts.maxLineBytes ?? NATIVE_DOOR.LINE_MAX_BYTES)) {
      this.#logger.warn(
        "fieldd.compose.line_too_long",
        "A door line passed its bound; the door is closed",
        {
          connId: door.open.connId,
        },
      );
      void this.opts.native
        .request("native.door.close", { connId: door.open.connId, reason: "line-too-long" })
        .catch(() => undefined);
      this.#release(door.open.connId);
    }
  }

  async #answer(door: Door, line: string): Promise<void> {
    const out = await door.connection.receive(line);
    const caller = door.caller();
    if (!this.opts.holdsTools(caller) && !door.toldPlain) {
      door.toldPlain = true;
      this.opts.onPlainCaller?.(caller, door.open);
    }
    if (out === undefined || this.#doors.get(door.open.connId) !== door) return;
    const bytes = this.#encoder.encode(`${out}\n`);
    try {
      if (!this.opts.lanes.send(door.open.laneId, bytes)) {
        await this.opts.lanes.flush(door.open.laneId);
        this.opts.lanes.send(door.open.laneId, bytes);
      }
    } catch (err) {
      // The lane link is down: the floor holds the door, and the client re-asks on its own timeout.
      this.#logger.warn(
        "fieldd.compose.send_failed",
        "An answer could not be written to its door",
        {
          connId: door.open.connId,
          reason: (err as Error).message,
        },
      );
    }
  }

  #release(connId: string): void {
    const door = this.#doors.get(connId);
    if (!door) return;
    this.#doors.delete(connId);
    this.opts.lanes.offLane(door.open.laneId);
  }
}
