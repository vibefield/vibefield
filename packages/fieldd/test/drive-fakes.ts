// DR-3b (W3, VF-RELAY) — the drive's test fakes: its two lane planes (doc-sync-service.test.ts's FakeControl and
// FakeBytes, with `drive` admitted), its holders store (holders-store.ts's, with the store's own snapshot shape),
// floors that refuse file-transfer verbs and one that answers them, the pin's unsupported golden, the exhausted and the
// conflict ones, and a logger that keeps every event.
// Test-local; never shipped.
import { readFileSync } from "node:fs";
import { ErrorData, RPC_ERROR_CODES, STORES } from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import type { LaneInfo } from "../src/doc-sync";
import type { DriveHoldersMesh } from "../src/drive/holders";
import type { DriveLaneBytes, DriveLaneControl } from "../src/drive/lane-relay";
import type { DrivePullsFloor } from "../src/drive/pulls";
import { RpcCallError } from "../src/native-link";

type Handler = (payload: unknown, kind: "snapshot" | "delta") => void;

const UNSUPPORTED_FIXTURE = new URL(
  "../../contracts/fixtures/error-data.file-transfer-unsupported.json",
  import.meta.url,
);

/** A floor's answer to every file-transfer verb until the substrate slice, at `=0.7.24` and `=0.7.27` alike
 * (*corrected 2026-11-08 (EL8-TRUFFLE, truffle 0.7.27): it said "The floor at the `=0.7.24` pin's answer"*),
 * as the contract's golden holds it
 * (`error-data.file-transfer-unsupported.json`), parsed through `ErrorData` (EL9). */
export const UNSUPPORTED_GOLDEN = ErrorData.parse(
  JSON.parse(readFileSync(UNSUPPORTED_FIXTURE, "utf8")),
);

const EXHAUSTED_FIXTURE = new URL(
  "../../contracts/fixtures/error-data.file-transfer-exhausted.json",
  import.meta.url,
);

/** A pull past DRIVE_LIMITS.PULLS_IN_FLIGHT, refused as the contract's golden holds it
 * (`error-data.file-transfer-exhausted.json`: RESOURCE_EXHAUSTED, retryable true, no details; W3-15, VF-PM
 * 2026-11-06), parsed through `ErrorData` (EL9). */
export const EXHAUSTED_GOLDEN = ErrorData.parse(
  JSON.parse(readFileSync(EXHAUSTED_FIXTURE, "utf8")),
);

const CONFLICT_FIXTURE = new URL(
  "../../contracts/fixtures/error-data.file-transfer-conflict.json",
  import.meta.url,
);

/** A second pull of a running digest (or of a running id), refused as the contract's golden holds it
 * (`error-data.file-transfer-conflict.json`: CONFLICT, retryable false, no details; C1's nit 9), parsed through
 * `ErrorData` (EL9). */
export const CONFLICT_GOLDEN = ErrorData.parse(JSON.parse(readFileSync(CONFLICT_FIXTURE, "utf8")));

/** The drive's lane lifecycle, in memory: every open and close it was asked, and a stream a test announces on. A
 * subscription is one NativeLink entry: `subscribes - disposed` is how many the link would replay, and only an entry
 * with a route hears `announce`. */
export class FakeDriveLaneControl implements DriveLaneControl {
  readonly opened: Array<{ laneId: number; class: string; peer: string; protocol: string }> = [];
  readonly closed: number[] = [];
  lanes: LaneInfo[] = [];
  /** when set, every open is refused with it (the floor's node gate, say) */
  refuse: Error | null = null;
  /** while set, an open waits for it before it answers */
  openGate: Promise<void> | null = null;
  /** every subscribe asked */
  subscribes = 0;
  /** every subscription let go */
  disposed = 0;
  /** when set, the next subscribe is refused with it */
  refuseNextSubscribe: Error | null = null;
  /** while set, a subscribe waits for it before it answers or is refused */
  subscribeGate: Promise<void> | null = null;
  readonly #routes = new Set<Handler>();

  async open(req: {
    laneId: number;
    class: "reliable";
    peer: string;
    protocol: "drive";
  }): Promise<void> {
    if (this.openGate !== null) await this.openGate;
    if (this.refuse !== null) throw this.refuse;
    this.opened.push({ ...req });
  }

  async close(laneId: number): Promise<void> {
    this.closed.push(laneId);
  }

  async subscribe(onEvent: Handler): Promise<{ lanes: LaneInfo[]; dispose: () => void }> {
    this.subscribes += 1;
    if (this.subscribeGate !== null) await this.subscribeGate;
    if (this.refuseNextSubscribe !== null) {
      const refusal = this.refuseNextSubscribe;
      this.refuseNextSubscribe = null;
      throw refusal;
    }
    this.#routes.add(onEvent);
    return {
      lanes: this.lanes,
      dispose: () => {
        this.disposed += 1;
        this.#routes.delete(onEvent);
      },
    };
  }

  announce(payload: unknown, kind: "snapshot" | "delta" = "delta"): void {
    for (const route of [...this.#routes]) route(payload, kind);
  }

  /** NativeLink's replay was refused or read TIMEOUT: every entry stays, with no route, and nothing says so. */
  replayRefused(): void {
    this.#routes.clear();
  }
}

/** The byte plane, in memory: what was sent, a settable watermark reading, and delivery to a claimed lane. */
export class FakeDriveLaneBytes implements DriveLaneBytes {
  readonly sent: Array<{ laneId: number; payload: Uint8Array }> = [];
  bufferedBytes = 0;
  /** while set, every send throws it, as a link that is down or past its cap does (mesh-lane.ts `send`) */
  throwOnSend: Error | null = null;
  readonly #handlers = new Map<number, (payload: Uint8Array) => void>();

  send(laneId: number, payload: Uint8Array): boolean {
    if (this.throwOnSend !== null) throw this.throwOnSend;
    this.sent.push({ laneId, payload });
    return true;
  }

  onLane(laneId: number, handler: (payload: Uint8Array) => void): void {
    this.#handlers.set(laneId, handler);
  }

  offLane(laneId: number): void {
    this.#handlers.delete(laneId);
  }

  deliver(laneId: number, payload: Uint8Array): void {
    this.#handlers.get(laneId)?.(payload);
  }

  claimed(laneId: number): boolean {
    return this.#handlers.has(laneId);
  }
}

/** STORES.DRIVE in memory, as each member sees it: it writes its own slice and hears everyone's. A snapshot is the
 * floor's shape (`StoreSnapshot`: `{storeId, slices: {deviceId: {data, version}}}`). A subscription is one NativeLink
 * entry: `subscribes - disposed` is how many the link would replay, and only an entry with a route hears the store. */
export class FakeDriveStore {
  /** deviceId → the slice it last published */
  readonly slices = new Map<string, unknown>();
  /** every slice a member wrote, in order */
  readonly writes: Array<{ deviceId: string; storeId: string; data: unknown }> = [];
  /** the next member write fails, as a mesh that is down does */
  failNextSet = false;
  /** the next member write lands and reads as refused: the floor ran it, and this side's deadline passed */
  failNextSetAfterLanding = false;
  /** while set, a member write waits for it, in the order the writes were made, as the floor's mesh queue does */
  setGate: Promise<void> | null = null;
  /** every subscribe a member asked */
  subscribes = 0;
  /** every subscription a member let go */
  disposed = 0;
  /** the next member subscribe fails, as a store with no node up does */
  failNextSubscribe = false;
  /** while set, a member subscribe waits for it before it answers or fails */
  subscribeGate: Promise<void> | null = null;
  readonly #routes = new Set<Handler>();

  member(deviceId: string): DriveHoldersMesh {
    return {
      setSlice: async (storeId: string, data: unknown) => {
        if (this.setGate !== null) await this.setGate;
        if (this.failNextSet) {
          this.failNextSet = false;
          throw new Error("mesh down");
        }
        this.writes.push({ deviceId, storeId, data });
        this.put(deviceId, data);
        if (this.failNextSetAfterLanding) {
          this.failNextSetAfterLanding = false;
          throw new Error("deadline passed");
        }
        return { storeId, version: this.writes.length };
      },
      subscribeStoreManaged: async (storeId: string, onEvent: Handler) => {
        this.subscribes += 1;
        if (this.subscribeGate !== null) await this.subscribeGate;
        if (this.failNextSubscribe) {
          this.failNextSubscribe = false;
          throw new Error("mesh node not up");
        }
        this.#routes.add(onEvent);
        return {
          snapshot: this.snapshot(storeId),
          dispose: () => {
            this.disposed += 1;
            this.#routes.delete(onEvent);
          },
        };
      },
    };
  }

  snapshot(storeId: string = STORES.DRIVE): { storeId: string; slices: Record<string, unknown> } {
    const slices: Record<string, unknown> = {};
    for (const [deviceId, data] of this.slices) slices[deviceId] = { data, version: 1 };
    return { storeId, slices };
  }

  /** A desktop's slice, written and heard (`peerUpdated`). */
  put(deviceId: string, data: unknown): void {
    this.slices.set(deviceId, data);
    this.#emit({ kind: "peerUpdated", deviceId, data, version: 1 }, "delta");
  }

  /** A desktop leaves the mesh: its slice goes (`peerRemoved`). */
  leave(deviceId: string): void {
    this.slices.delete(deviceId);
    this.#emit({ kind: "peerRemoved", deviceId }, "delta");
  }

  /** The broadcast-lag path: every member hears the whole store again. */
  resnapshot(): void {
    this.#emit(this.snapshot(), "snapshot");
  }

  /** Every member hears this snapshot, whatever its shape. */
  hearSnapshot(payload: unknown): void {
    this.#emit(payload, "snapshot");
  }

  /** The node is built anew: this is a new store, and every stream that stands keeps its entry and goes quiet, its
   * forwarder holding the old one. Only a new subscribe hears it. */
  rebuild(): void {
    this.#routes.clear();
  }

  #emit(payload: unknown, kind: "snapshot" | "delta"): void {
    for (const route of [...this.#routes]) route(payload, kind);
  }
}

/** A floor that refuses every file-transfer verb with `error`; `asked` is every method that reached it. */
export function refusingFloor(error: RpcCallError): DrivePullsFloor & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    request: async (method: string) => {
      asked.push(method);
      throw error;
    },
    subscribe: async (method: string) => {
      asked.push(method);
      throw error;
    },
  };
}

/** A floor before the substrate slice, at `=0.7.24` or `=0.7.27`: every verb answers UNSUPPORTED_GOLDEN.
 * *Corrected 2026-11-08 (EL8-TRUFFLE, truffle 0.7.27): it said "The floor at the `=0.7.24` pin".* */
export function unsupportedFloor(): DrivePullsFloor & { asked: string[] } {
  const { kind, retryable, details } = UNSUPPORTED_GOLDEN;
  const code = RPC_ERROR_CODES[kind];
  return refusingFloor(new RpcCallError(kind, "unsupported", retryable, details, code));
}

/** A floor that answers every verb with no pull running and no root registered; `asked` is every method that reached
 * it, and while `subscribeGate` is set a subscribe waits for it before it answers (one no deadline has ended yet). */
export function answeringFloor(): DrivePullsFloor & {
  asked: string[];
  subscribeGate: Promise<void> | null;
} {
  const floor = {
    asked: [] as string[],
    subscribeGate: null as Promise<void> | null,
    request: async (method: string) => {
      floor.asked.push(method);
      return { roots: [] };
    },
    subscribe: async (method: string) => {
      floor.asked.push(method);
      if (floor.subscribeGate !== null) await floor.subscribeGate;
      return { snapshot: { transfers: [] }, dispose: () => undefined };
    },
  };
  return floor;
}

/** A floor whose stream is refused ONCE with `error` (a node gate, say), then answered with no pull running; every
 * declared root registers. `asked` is every method that reached it. */
export function streamRefusedOnce(error: RpcCallError): DrivePullsFloor & { asked: string[] } {
  const asked: string[] = [];
  let refuse = true;
  return {
    asked,
    request: async (method: string, params: unknown) => {
      asked.push(method);
      const roots = (params as { roots?: string[] } | undefined)?.roots ?? [];
      return { roots: roots.map((name) => ({ name, registered: true })) };
    },
    subscribe: async (method: string) => {
      asked.push(method);
      if (refuse) {
        refuse = false;
        throw error;
      }
      return { snapshot: { transfers: [] }, dispose: () => undefined };
    },
  };
}

export interface CapturedLog {
  event: string;
  attrs?: LogFields | undefined;
}

/** Every log line, by event name: a refusal's log line is part of what it promises. */
export function captureLogger(events: CapturedLog[]): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: (event, _message, attrs) => events.push({ event, attrs }),
    debug: (event, _message, attrs) => events.push({ event, attrs }),
    info: (event, _message, attrs) => events.push({ event, attrs }),
    warn: (event, _message, attrs) => events.push({ event, attrs }),
    error: (event, _message, _error, attrs) => events.push({ event, attrs }),
    fatal: (event, _message, _error, attrs) => events.push({ event, attrs }),
    isLevelEnabled: () => true,
  };
  return logger;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A gate a fake's call waits on, opened by the row. */
export function gate(): { waits: Promise<void>; open: () => void } {
  let open = () => {};
  const waits = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { waits, open: () => open() };
}

/** Run `fn` once `turns` microtask turns have passed: a call landed between two steps of a promise chain. */
export function afterTurns(turns: number, fn: () => void): void {
  let chain = Promise.resolve();
  for (let turn = 0; turn < turns; turn++) chain = chain.then(() => undefined);
  void chain.then(fn);
}

/** Wait for `predicate`, or throw naming what never came. */
export async function until(predicate: () => boolean, label: string, ms = 4_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await sleep(10);
  }
}
