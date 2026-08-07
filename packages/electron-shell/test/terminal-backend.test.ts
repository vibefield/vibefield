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

function harness(
  opts: { failStartsAfterFirst?: number; delay?: (ms: number) => Promise<void> } = {},
) {
  const built: FakeBackend[] = [];
  const sent: unknown[] = [];
  /** Whether the Nth build refuses, as a MUTABLE predicate. The ladder's whole
   * behaviour is about when a build fails relative to what else is happening,
   * so a test that needs the floor to start (or stop) refusing partway through
   * a run replaces this rather than choosing once at construction. */
  const control = {
    failStart: (index: number): boolean =>
      opts.failStartsAfterFirst !== undefined && index >= opts.failStartsAfterFirst,
  };
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
      if (control.failStart(built.length)) {
        backend.startFailure = new Error("ghosttead refused the connection");
      }
      built.push(backend);
      return backend;
    },
    // The ladder's backoff is real time in production and nothing here, unless
    // a test needs to hold a ladder inside it.
    delay: opts.delay ?? (async () => undefined),
  });
  return { built, sent, control, target, host: registry.ensure(target), registry };
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

  it("a freshly redeemed ticket supersedes a SPENT ladder", async () => {
    const { built, sent, control, host } = harness({ failStartsAfterFirst: 1 });
    await host.connect(TICKET);
    built[0]?.die();
    // The renderer answers ticket-expired the way GT-1 says it must: redeem
    // again. A new field-native boot keeps the socket paths and rotates the
    // token, so the connection differs by exactly one field — and this one
    // opens, which is what a live boot's token does.
    await vi.waitFor(() => expect(statuses(sent)).toContain("ticket-expired"));
    const rebuilt = built.length;
    control.failStart = () => false;
    await host.connect({ ...TICKET, token: "next-boot-token" });

    expect(built).toHaveLength(rebuilt + 1);
    expect(built.at(-1)?.options.connection.authToken).toBe("next-boot-token");
    // no second ticket-expired: the superseded ladder announced nothing more
    expect(statuses(sent).filter((s) => s === "ticket-expired")).toHaveLength(1);
  });

  it("a death at a NEW generation gets its own ladder, not a sleeping one's silence", async () => {
    // The interleaving the review found (GT §9 7b) and the reason the smoke's
    // recovery row had to become able to fail: a ladder sleeping in backoff
    // from generation 1 used to be handed straight back to a generation-2
    // death, and it answers that death with nothing at all — it wakes, reads a
    // generation that moved, and returns. The renderer holds `bridge-down`
    // forever, because `bridge-up` and `ticket-expired` are the only two states
    // it acts on and neither is ever coming.
    let wake: () => void = () => undefined;
    const backoff = new Promise<void>((resolve) => {
      wake = resolve;
    });
    let sleeps = 0;
    const { built, sent, control, host } = harness({
      delay: async () => {
        sleeps += 1;
        await backoff;
      },
    });
    await host.connect(TICKET); // generation 1
    control.failStart = () => true;
    built[0]?.die(); // the generation-1 ladder fails once and parks
    await vi.waitFor(() => expect(sleeps).toBe(1));
    expect(statuses(sent)).toEqual(["bridge-down"]);

    // While it sleeps, the renderer redeems again and main builds on the new
    // ticket — generation 2, and the sleeping ladder now speaks for nothing.
    control.failStart = () => false;
    await host.connect({ ...TICKET, token: "next-boot-token" });

    // …and THAT bridge dies.
    built.at(-1)?.die();
    await vi.waitFor(() =>
      expect(statuses(sent)).toEqual(["bridge-down", "bridge-down", "bridge-up"]),
    );
    expect(built.at(-1)?.options.connection.authToken).toBe("next-boot-token");

    // The superseded ladder still returns in silence when it finally wakes —
    // that half was always right, and the fix must not have made it loud.
    wake();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(statuses(sent)).toEqual(["bridge-down", "bridge-down", "bridge-up"]);
  });

  it("a connect that cannot build publishes a state, not only a rejection", async () => {
    // Publishing was reachable from the ladder alone, so the renderer's status
    // listener heard nothing at all about a ticket main could not open — the
    // page got a bare rejection and the bridge banner had no state to draw.
    const { sent, host } = harness({ failStartsAfterFirst: 0 });
    await expect(host.connect(TICKET)).rejects.toThrow(/refused/);

    expect(statuses(sent)).toEqual(["ticket-expired"]);
    const published = TerminalBridgeStatus.parse(sent[0]);
    expect(published.attempts).toBe(0); // no ladder ran; the honest count is none
    expect(published.detail).toContain("refused");
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
