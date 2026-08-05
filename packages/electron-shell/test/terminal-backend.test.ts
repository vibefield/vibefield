import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IPC_CHANNELS, TerminalBridgeStatus } from "@vibefield/contracts";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  type BackendExitDetail,
  type ExternalBackendOptions,
  type TerminalBackendLike,
  TerminalBackendRegistry,
} from "../src/main/terminal-backend";

// The Backend lifecycle (GT-D3): lazy per window, external mode only, and a
// bounded recovery ladder whose terminal state is an honest request for a new
// ticket. No Electron here — the host takes a WebContents but only ever calls
// four of its members, so a structural fake drives the whole ladder.

const TICKET = {
  controlSocket: "/run/termctl.sock",
  frameSocket: "/run/termframe.sock",
  token: "per-boot-token",
};

class FakeBackend implements TerminalBackendLike {
  running = false;
  attachments = 0;
  stopped = 0;
  startFailure: Error | null = null;
  private readonly listeners = new Set<(detail: BackendExitDetail) => void>();

  constructor(readonly options: ExternalBackendOptions) {}

  async start(): Promise<void> {
    if (this.startFailure !== null) throw this.startFailure;
    this.running = true;
  }

  attachRenderer(): void {
    this.attachments += 1;
  }

  stop(): void {
    this.running = false;
    this.stopped += 1;
  }

  on(_event: "unexpected-exit", listener: (detail: BackendExitDetail) => void): this {
    this.listeners.add(listener);
    return this;
  }

  die(detail: BackendExitDetail = { source: "bridge", code: null, signal: "SIGKILL" }): void {
    this.running = false;
    for (const listener of this.listeners) listener(detail);
  }
}

function harness(opts: { failStartsAfterFirst?: number } = {}) {
  const built: FakeBackend[] = [];
  const sent: unknown[] = [];
  const target = {
    id: 7,
    isDestroyed: () => false,
    send: (channel: string, payload: unknown) => {
      expect(channel).toBe(IPC_CHANNELS.terminalStatus);
      sent.push(payload);
    },
    once: () => undefined,
  } as unknown as WebContents;
  const registry = new TerminalBackendRegistry({
    bridgeEntryPoint: "/dist/main/bridge-entry.mjs",
    createBackend: (options) => {
      const backend = new FakeBackend(options);
      if (opts.failStartsAfterFirst !== undefined && built.length >= opts.failStartsAfterFirst) {
        backend.startFailure = new Error("ghosttead refused the connection");
      }
      built.push(backend);
      return backend;
    },
    // The ladder's backoff is real time in production and nothing here.
    delay: async () => undefined,
  });
  return { built, sent, target, host: registry.ensure(target), registry };
}

const statuses = (sent: unknown[]): string[] =>
  sent.map((raw) => TerminalBridgeStatus.parse(raw).state);

describe("the terminal Backend host (GT-D3)", () => {
  it("constructs nothing until a renderer hands over a ticket", async () => {
    const { built, host } = harness();
    expect(built).toHaveLength(0);

    await host.connect(TICKET);
    expect(built).toHaveLength(1);
    expect(built[0]?.attachments).toBe(1);
  });

  it("can only build the external arm — the supervisor path is not reachable", async () => {
    const { built, host } = harness();
    await host.connect(TICKET);

    const options = built[0]?.options;
    expect(options?.mode).toBe("external");
    expect(options && "daemon" in options).toBe(false);
    expect(options?.connection).toEqual({
      controlSocket: TICKET.controlSocket,
      frameSocket: TICKET.frameSocket,
      authToken: TICKET.token,
    });
    expect(options?.bridge?.entryPoint).toBe("/dist/main/bridge-entry.mjs");

    // And it cannot construct one behind the factory's back: the module's only
    // reference to ghosttea is a TYPE import, so there is no Backend
    // constructor in scope at all — external or otherwise.
    const source = readFileSync(
      join(fileURLToPath(new URL("../src/main/terminal-backend.ts", import.meta.url))),
      "utf8",
    );
    expect(source).toMatch(/^import type \{[^}]*\} from "@vibecook\/ghosttea-electron\/main";$/m);
    expect(source).not.toMatch(/^import \{[^}]*\} from "@vibecook\//m);
    expect(source).not.toMatch(/mode: "managed"/);
  });

  it("a reloaded document re-attaches instead of rebuilding the bridge", async () => {
    const { built, host } = harness();
    await host.connect(TICKET);
    await host.connect(TICKET);

    expect(built).toHaveLength(1);
    expect(built[0]?.attachments).toBe(2);
  });

  it("rebuilds on the stored connection when the bridge dies, and says so", async () => {
    const { built, sent, host } = harness();
    await host.connect(TICKET);
    built[0]?.die();
    await vi.waitFor(() => expect(built).toHaveLength(2));

    expect(built[1]?.options.connection.authToken).toBe(TICKET.token);
    expect(statuses(sent)).toEqual(["bridge-down", "bridge-up"]);
    expect(TerminalBridgeStatus.parse(sent[1]).attempts).toBe(0);

    // The rebuild does NOT push ports at a renderer holding dead ones — every
    // attach costs the bridge a fresh dial to the floor, and only the renderer
    // knows when it has a runtime able to read them. bridge-up is the
    // invitation; the renderer's next connect is what attaches.
    expect(built[1]?.attachments).toBe(0);
    await host.connect(TICKET);
    expect(built).toHaveLength(2);
    expect(built[1]?.attachments).toBe(1);
  });

  it("asks the renderer for a fresh ticket once the ladder is spent", async () => {
    const { built, sent, host } = harness({ failStartsAfterFirst: 1 });
    await host.connect(TICKET);
    built[0]?.die();
    await vi.waitFor(() => expect(statuses(sent)).toContain("ticket-expired"));

    // five rebuild attempts, all refused — the reference app's bound
    expect(built).toHaveLength(6);
    expect(statuses(sent)).toEqual(["bridge-down", "ticket-expired"]);
    const expired = TerminalBridgeStatus.parse(sent[1]);
    expect(expired.attempts).toBe(5);
    expect(expired.detail).toContain("refused");
  });

  it("a freshly redeemed ticket supersedes a ladder still in flight", async () => {
    const { built, sent, host } = harness({ failStartsAfterFirst: 1 });
    await host.connect(TICKET);
    built[0]?.die();
    // The renderer answers ticket-expired the way GT-1 says it must: redeem
    // again. A new field-native boot keeps the socket paths and rotates the
    // token, so the connection differs by exactly one field.
    await vi.waitFor(() => expect(statuses(sent)).toContain("ticket-expired"));
    const rebuilt = built.length;
    await host.connect({ ...TICKET, token: "next-boot-token" }).catch(() => undefined);

    expect(built).toHaveLength(rebuilt + 1);
    expect(built.at(-1)?.options.connection.authToken).toBe("next-boot-token");
    // no second ticket-expired: the superseded ladder announced nothing more
    expect(statuses(sent).filter((s) => s === "ticket-expired")).toHaveLength(1);
  });

  it("a dead host stops its backend and stays quiet", async () => {
    const { built, sent, host, registry } = harness();
    await host.connect(TICKET);
    registry.dispose();

    expect(built[0]?.stopped).toBe(1);
    built[0]?.die();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(built).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("hands one host per window and forgets it when the window dies", async () => {
    const destroyers: Array<() => void> = [];
    const make = (id: number): WebContents =>
      ({
        id,
        isDestroyed: () => false,
        send: () => undefined,
        once: (_event: string, listener: () => void) => destroyers.push(listener),
      }) as unknown as WebContents;
    const registry = new TerminalBackendRegistry({
      bridgeEntryPoint: "/dist/main/bridge-entry.mjs",
      createBackend: (options) => new FakeBackend(options),
    });

    const first = registry.ensure(make(1));
    expect(registry.ensure(make(1))).toBe(first);
    expect(registry.ensure(make(2))).not.toBe(first);

    for (const destroy of destroyers) destroy();
    expect(registry.ensure(make(1))).not.toBe(first);
  });
});

// A compile-time half to the runtime proof above: widening the module's option
// type back to ghosttea's full union would make this line legal.
// @ts-expect-error — the managed arm is not part of ExternalBackendOptions
const _managedIsUnreachable: ExternalBackendOptions = { mode: "managed", daemon: {} as never };
void _managedIsUnreachable;
