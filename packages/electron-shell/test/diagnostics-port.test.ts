import { LOG_STREAMS } from "@vibefield/contracts";
import type { DiagnosticLogSnapshotV1 } from "@vibefield/contracts/diagnostics";
import { createNoopLogger } from "@vibefield/logging";
import { describe, expect, it, vi } from "vitest";
import { type DiagnosticsHostActions, DiagnosticsPortSession } from "../src/main/diagnostics-port";
import type {
  ElectronLocalDiagnostics,
  LocalDiagnosticsSubscription,
} from "../src/main/local-diagnostics";

class FakePort {
  readonly messages: string[] = [];
  readonly listeners = new Map<string, (...args: never[]) => void>();
  started = 0;
  closed = 0;

  postMessage(message: string): void {
    this.messages.push(message);
  }

  start(): void {
    this.started += 1;
  }

  close(): void {
    this.closed += 1;
  }

  on(event: "message", listener: (event: { data: unknown }) => void): void;
  on(event: "close", listener: () => void): void;
  on(
    event: "message" | "close",
    listener: ((event: { data: unknown }) => void) | (() => void),
  ): void {
    this.listeners.set(event, listener as (...args: never[]) => void);
  }
}

const snapshot: DiagnosticLogSnapshotV1 = {
  v: 1,
  producers: [],
  records: [],
  nextCursor: "cursor-1",
  droppedBefore: 0,
};

function request(id: string, method: string, params?: unknown): string {
  return JSON.stringify({ v: 1, id, method, ...(params === undefined ? {} : { params }) });
}

function fakeDiagnostics(overrides: Partial<ElectronLocalDiagnostics> = {}): {
  diagnostics: ElectronLocalDiagnostics;
  emit(event: unknown, kind: "delta" | "snapshot"): void;
  dispose: ReturnType<typeof vi.fn>;
} {
  let subscriber: ((payload: never, kind: "delta" | "snapshot") => void) | undefined;
  const dispose = vi.fn();
  const diagnostics = {
    query: vi.fn(async () => snapshot),
    subscribe: vi.fn(
      async (
        _query: unknown,
        emit: (payload: never, kind: "delta" | "snapshot") => void,
      ): Promise<LocalDiagnosticsSubscription> => {
        subscriber = emit;
        return { snapshot, dispose };
      },
    ),
    createLease: vi.fn(),
    listLeases: vi.fn(),
    revokeLease: vi.fn(),
    ...overrides,
  } as unknown as ElectronLocalDiagnostics;
  return {
    diagnostics,
    emit: (event, kind) => subscriber?.(event as never, kind),
    dispose,
  };
}

describe("main diagnostics MessagePort session", () => {
  it("serves bounded request/response calls and disposes subscriptions on close", async () => {
    const port = new FakePort();
    const fake = fakeDiagnostics();
    const actions: DiagnosticsHostActions = {
      openLogs: () => ({ opened: true }),
    };
    const session = new DiagnosticsPortSession(port, fake.diagnostics, actions, createNoopLogger());
    session.start();
    expect(port.started).toBe(1);

    session.accept(
      request("q1", "query", {
        sources: [LOG_STREAMS.SYSTEM_DESKTOP],
        limit: 10,
      }),
    );
    await vi.waitFor(() => expect(port.messages).toHaveLength(1));
    expect(JSON.parse(port.messages[0] ?? "")).toEqual({
      v: 1,
      id: "q1",
      ok: true,
      result: snapshot,
    });

    session.accept(
      request("s1", "subscribe", {
        sources: [LOG_STREAMS.SYSTEM_DESKTOP],
        limit: 10,
      }),
    );
    await vi.waitFor(() => expect(port.messages).toHaveLength(2));
    expect(JSON.parse(port.messages[1] ?? "")).toMatchObject({
      id: "s1",
      ok: true,
      result: { subId: "local-1", snapshot },
    });
    fake.emit(
      {
        v: 1,
        cursor: "cursor-2",
        records: [],
        droppedSincePrevious: 0,
      },
      "delta",
    );
    expect(JSON.parse(port.messages[2] ?? "")).toMatchObject({
      kind: "event",
      subId: "local-1",
      eventKind: "delta",
    });

    session.close();
    expect(fake.dispose).toHaveBeenCalledOnce();
    expect(port.closed).toBe(1);
  });

  it("caps concurrent requests before calling the diagnostics producer", async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = fakeDiagnostics({
      query: vi.fn(async () => {
        await blocked;
        return snapshot;
      }),
    });
    const port = new FakePort();
    const session = new DiagnosticsPortSession(port, fake.diagnostics, {}, createNoopLogger());
    for (let index = 0; index < 17; index += 1) {
      session.accept(
        request(`q${index}`, "query", {
          sources: [LOG_STREAMS.SYSTEM_DESKTOP],
          limit: 10,
        }),
      );
    }
    await vi.waitFor(() => expect(port.messages).toHaveLength(1));
    expect(JSON.parse(port.messages[0] ?? "")).toMatchObject({
      id: "q16",
      ok: false,
      error: { kind: "RESOURCE_EXHAUSTED" },
    });
    release?.();
    await vi.waitFor(() => expect(port.messages).toHaveLength(17));
  });
});
