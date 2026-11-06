// DR-3b (W3, VF-RELAY) — the drive's test fakes: its two lane planes (doc-sync-service.test.ts's FakeControl and
// FakeBytes, with `drive` admitted), its holders store (holders-store.ts's, with the store's own snapshot shape),
// floors that refuse file-transfer verbs, the pin's unsupported golden and the exhausted one, and a logger that keeps
// every event.
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

/** The floor at the `=0.7.24` pin's answer to every file-transfer verb, as the contract's golden holds it
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

/** The drive's lane lifecycle, in memory: every open and close it was asked, and a stream a test announces on. */
export class FakeDriveLaneControl implements DriveLaneControl {
  readonly opened: Array<{ laneId: number; class: string; peer: string; protocol: string }> = [];
  readonly closed: number[] = [];
  lanes: LaneInfo[] = [];
  /** when set, every open is refused with it (the floor's node gate, say) */
  refuse: Error | null = null;
  #emit: Handler | null = null;

  async open(req: {
    laneId: number;
    class: "reliable";
    peer: string;
    protocol: "drive";
  }): Promise<void> {
    if (this.refuse !== null) throw this.refuse;
    this.opened.push({ ...req });
  }

  async close(laneId: number): Promise<void> {
    this.closed.push(laneId);
  }

  async subscribe(onEvent: Handler): Promise<{ lanes: LaneInfo[] }> {
    this.#emit = onEvent;
    return { lanes: this.lanes };
  }

  announce(payload: unknown, kind: "snapshot" | "delta" = "delta"): void {
    this.#emit?.(payload, kind);
  }
}

/** The byte plane, in memory: what was sent, a settable watermark reading, and delivery to a claimed lane. */
export class FakeDriveLaneBytes implements DriveLaneBytes {
  readonly sent: Array<{ laneId: number; payload: Uint8Array }> = [];
  bufferedBytes = 0;
  readonly #handlers = new Map<number, (payload: Uint8Array) => void>();

  send(laneId: number, payload: Uint8Array): boolean {
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
 * floor's shape (`StoreSnapshot`: `{storeId, slices: {deviceId: {data, version}}}`). */
export class FakeDriveStore {
  /** deviceId → the slice it last published */
  readonly slices = new Map<string, unknown>();
  /** every slice a member wrote, in order */
  readonly writes: Array<{ deviceId: string; storeId: string; data: unknown }> = [];
  /** the next member write fails, as a mesh that is down does */
  failNextSet = false;
  /** the next member subscribe fails, as a store with no node up does */
  failNextSubscribe = false;
  readonly #handlers = new Map<string, Handler>();

  member(deviceId: string): DriveHoldersMesh {
    return {
      setSlice: async (storeId: string, data: unknown) => {
        if (this.failNextSet) {
          this.failNextSet = false;
          throw new Error("mesh down");
        }
        this.writes.push({ deviceId, storeId, data });
        this.put(deviceId, data);
        return { storeId, version: this.writes.length };
      },
      subscribeStoreManaged: async (storeId: string, onEvent: Handler) => {
        if (this.failNextSubscribe) {
          this.failNextSubscribe = false;
          throw new Error("mesh node not up");
        }
        this.#handlers.set(deviceId, onEvent);
        return { snapshot: this.snapshot(storeId), dispose: () => this.#handlers.delete(deviceId) };
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

  #emit(payload: unknown, kind: "snapshot" | "delta"): void {
    for (const handler of [...this.#handlers.values()]) handler(payload, kind);
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

/** The floor at the `=0.7.24` pin: every verb answers UNSUPPORTED_GOLDEN. */
export function unsupportedFloor(): DrivePullsFloor & { asked: string[] } {
  const { kind, retryable, details } = UNSUPPORTED_GOLDEN;
  const code = RPC_ERROR_CODES[kind];
  return refusingFloor(new RpcCallError(kind, "unsupported", retryable, details, code));
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

/** Wait for `predicate`, or throw naming what never came. */
export async function until(predicate: () => boolean, label: string, ms = 4_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await sleep(10);
  }
}
