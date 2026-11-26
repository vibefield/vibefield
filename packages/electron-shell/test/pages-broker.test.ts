import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PAGES_MADE_DEVICE_SCALE,
  PAGES_MADE_VIEWPORT,
  PAGES_RUN_PANES_MAX,
  type ShellSurfacesControlParams,
} from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  activeTargetOf,
  PAGES_HUNG_CALLS,
  PAGES_INTRODUCE_TRIES,
  type PagesBinding,
  PagesBrokerCore,
  type PagesBrokerDeps,
  PagesBrokerError,
  type PagesEnginesPort,
  type PagesMakeOrder,
  type PagesMakeOutcome,
  type PagesPopups,
  type PagesView,
  type PagesWindowsPort,
} from "../src/main/pages/broker/broker";
import type {
  exchangeDaemon,
  PagesDaemonCommand,
  PagesDaemonExchange,
} from "../src/main/pages/broker/daemon-client";
import type { EngineLease, EnsureAnswer } from "../src/main/pages/broker/engine-supervisor";
import {
  STILL_HEAD_BYTES,
  type StillEntryFacts,
  type StillFileFacts,
} from "../src/main/pages/core/still-folder";
import type {
  BridgeVerdict,
  CallRefusal,
  CallWindow,
  PageClass,
  PageLease,
  WindowClosedBy,
  WindowKind,
  WindowState,
} from "../src/main/pages/core/types";

// EY-1 (2026-11-19): the pages broker on fake ports. The bridge, the windows, the engines and the
// engine's socket are all fakes: nothing starts, nothing listens, nothing is signalled.

const TARGET = {
  "page-a": "A".repeat(32),
  "page-b": "B".repeat(32),
  "page-c": "C".repeat(32),
  "page-d": "D".repeat(32),
  "page-e": "E".repeat(32),
  "page-f": "F".repeat(32),
  "page-g": "9".repeat(32),
} as const;
type PageName = keyof typeof TARGET;

class FakePage {
  held = false;
  /** the pop-up policy the broker set on the page; null: none */
  policy: PagesPopups | null = null;
  readonly listeners = new Set<(held: boolean) => void>();
  onHeld(listener: (held: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  popups(policy: PagesPopups | null): void {
    this.policy = policy;
  }
  hand(held: boolean): void {
    this.held = held;
    for (const listener of this.listeners) listener(held);
  }
}

class FakeWindows implements PagesWindowsPort {
  readonly leases = new Map<string, PageLease>();
  readonly opened = new Map<string, CallWindow>();
  readonly closed: CallWindow[] = [];
  readonly held = new Set<string>();
  expireNext = false;
  /** an act window's lease, as the windows set its deadline; null: no deadline */
  leaseMs: number | null = null;
  constructor(private readonly events: string[]) {}
  lease(pageId: string, lease: PageLease): void {
    this.leases.set(pageId, lease);
    this.events.push(`lease ${pageId}`);
  }
  unlease(pageId: string): CallWindow | null {
    this.leases.delete(pageId);
    this.events.push(`unlease ${pageId}`);
    return this.end(pageId, "grant-end");
  }
  open(
    pageId: string,
    w: { readonly kind: WindowKind; readonly callId: string; readonly action: string },
  ): BridgeVerdict {
    this.events.push(`open ${pageId} ${w.kind}`);
    if (this.held.has(pageId)) return { ok: false, code: "held", reason: "held" };
    if (!this.leases.has(pageId)) return { ok: false, code: "no-lease", reason: "no lease" };
    const expires = this.leaseMs !== null && w.kind === "act" ? Date.now() + this.leaseMs : null;
    this.opened.set(pageId, {
      pageId,
      kind: w.kind,
      callId: w.callId,
      action: w.action,
      openedAt: 0,
      stillsTaken: 0,
      ...(expires === null ? {} : { expiresAt: expires }),
    });
    return { ok: true };
  }
  /** BU-19: a page the call made shares that call's window while it stands on the page that made it. */
  adopt(pageId: string, madeBy: string, callId: string): BridgeVerdict {
    this.events.push(`adopt ${pageId} ${madeBy}`);
    const making = this.opened.get(madeBy);
    if (making === undefined || making.callId !== callId) {
      return { ok: false, code: "outside-window", reason: "the making call's window is not open" };
    }
    if (!this.leases.has(pageId)) return { ok: false, code: "no-lease", reason: "no lease" };
    this.opened.set(pageId, { ...making, pageId, madeBy });
    return { ok: true };
  }
  closeCall(callId: string): readonly CallWindow[] {
    const out: CallWindow[] = [];
    for (const [pageId, w] of [...this.opened]) {
      if (w.callId !== callId) continue;
      this.events.push(`closeCall ${pageId}`);
      const closed = this.end(pageId, "expired");
      if (closed !== null) out.push(closed);
    }
    return out;
  }
  state(pageId: string): WindowState {
    return {
      leased: this.leases.has(pageId),
      held: this.held.has(pageId),
      window: this.opened.get(pageId) ?? null,
      paused: 0,
      draining: false,
    };
  }
  close(pageId: string, callId: string): CallWindow | null {
    if (this.opened.get(pageId)?.callId !== callId) return null;
    this.events.push(`close ${pageId}`);
    return this.end(pageId, this.expireNext ? "expired" : "call-end");
  }
  hold(pageId: string): { readonly closed: CallWindow | null } {
    this.held.add(pageId);
    this.events.push(`hold ${pageId}`);
    return { closed: this.end(pageId, "hold") };
  }
  putDown(pageId: string): void {
    this.held.delete(pageId);
    this.events.push(`putDown ${pageId}`);
  }
  drain(pageId: string): void {
    this.events.push(`drain ${pageId}`);
  }
  drained(pageId: string): void {
    this.events.push(`drained ${pageId}`);
  }
  history(pageId: string): readonly CallWindow[] {
    return this.closed.filter((w) => w.pageId === pageId);
  }
  private end(pageId: string, closedBy: WindowClosedBy): CallWindow | null {
    const w = this.opened.get(pageId);
    if (w === undefined) return null;
    this.opened.delete(pageId);
    const closed: CallWindow = { ...w, closedAt: 1, closedBy };
    this.closed.push(closed);
    return closed;
  }
}

const ok = (data: unknown): PagesDaemonExchange => ({ ok: true, reply: { success: true, data } });

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function lease(run: string, generation: number): EngineLease {
  const root = `/r/pg-${String(generation).padStart(8, "0")}`;
  return {
    run,
    generation,
    socketPath: `${root}/sock/namespaces/pages/run/0123456789abcdef.sock`,
    surroundings: {
      root,
      socketDir: `${root}/sock`,
      home: `${root}/home`,
      tmp: `${root}/tmp`,
      cwd: `${root}/cwd`,
      session: "0123456789abcdef",
      socketPath: `${root}/sock/namespaces/pages/run/0123456789abcdef.sock`,
    },
  };
}

function harness(
  o: {
    readonly deps?: Partial<PagesBrokerDeps>;
    /** false: the broker is given no disk to read a still's folder and file from */
    readonly stills?: false;
  } = {},
) {
  const events: string[] = [];
  const pages = {
    "page-a": new FakePage(),
    "page-b": new FakePage(),
    "page-c": new FakePage(),
    "page-d": new FakePage(),
    "page-e": new FakePage(),
    "page-f": new FakePage(),
    "page-g": new FakePage(),
  };
  const bindings = new Map<string, PagesBinding>(
    (Object.keys(pages) as PageName[]).map((id) => [
      id,
      { producerEpoch: 1, controlBindingRevision: 1, page: pages[id] },
    ]),
  );
  const parked = new Set<string>();
  // pages custody still holds though no window binds them and they are not at rest (a producer that failed)
  const kept = new Set<string>();
  // a page's class by its profile: own unless a row says otherwise (null: no browser page)
  const classes = new Map<string, PageClass | null>();
  const warned: { event: string; fields: Record<string, number | string> }[] = [];
  const windows = new FakeWindows(events);
  const state = {
    active: TARGET["page-b"] as string,
    raced: false,
    /** the run's engine is no longer on the bridge at the epoch its launch armed */
    offBridge: false,
    refuseGrant: false,
    up: false,
    generation: 0,
    unavailable: null as null | "engine-refused",
    /** the engine's answer to a launch, when a row wants one other than its plain yes */
    launch: null as null | PagesDaemonExchange,
    /** how many of the run's connections the bridge says it told of a page said again */
    told: 0,
    refusals: new Map<string, CallRefusal[]>(),
    reply: (_c: PagesDaemonCommand): PagesDaemonExchange | Promise<PagesDaemonExchange> =>
      ok({ snapshot: "ok" }),
  };
  let keys = 0;
  const bridge = {
    addRun: vi.fn((_run: string) => undefined),
    arm: vi.fn((_run: string) => {
      keys += 1;
      return { url: `ws://127.0.0.1:9/browser/route/key-${keys}`, epoch: keys };
    }),
    raced: vi.fn((_run: string) => state.raced),
    revokeRun: vi.fn(async (_run: string) => undefined),
    grant: vi.fn(async (_run: string, surfaceId: string, _lease: PageLease) =>
      state.refuseGrant
        ? { ok: false as const, refused: "already-granted" }
        : { ok: true as const, targetId: TARGET[surfaceId as PageName] as string },
    ),
    endGrant: vi.fn(async (_run: string, _surfaceId: string) => undefined),
    // a page said to the run's client again (2026-11-24): how many connections a row says were told. None by
    // default: this fake engine lists its active tab alone, and switches to any target it is given
    introduce: vi.fn((_run: string, _surfaceId: string): number => state.told),
    refusals: vi.fn((callId: string): readonly CallRefusal[] => state.refusals.get(callId) ?? []),
  };
  // the run's engine on the bridge (2026-11-24): on it at the epoch asked unless a row takes it off
  const link = { liveAt: vi.fn((_run: string, _epoch: number) => !state.offBridge) };
  const exitListeners = new Set<(run: string, generation: number) => void>();
  const engines = {
    ensure: vi.fn(async (run: string): Promise<EnsureAnswer> => {
      if (state.unavailable !== null) return { ok: false, unavailable: state.unavailable };
      if (!state.up) {
        state.up = true;
        state.generation += 1;
      }
      return { ok: true, engine: lease(run, state.generation) };
    }),
    stop: vi.fn(async (_run: string) => {
      state.up = false;
    }),
    // the engine ends and the run is kept: its next start is the next generation
    replace: vi.fn(async (_run: string) => {
      state.up = false;
    }),
    stopAll: vi.fn(async () => {
      state.up = false;
      return { ended: 1, unended: 0 };
    }),
    stats: () => ({ engines: state.up ? 1 : 0, starts: state.generation, exits: 0 }),
    onExit: vi.fn((listener: (run: string, generation: number) => void) => {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    }),
  } satisfies PagesEnginesPort;
  /** The supervisor's word that the run's engine exited. */
  const exited = (run: string, generation: number): void => {
    state.up = false;
    for (const listener of [...exitListeners]) listener(run, generation);
  };
  const sent: PagesDaemonCommand[] = [];
  const exchange = vi.fn<typeof exchangeDaemon>(async (_path, command) => {
    sent.push(command);
    events.push(`send ${command.action}`);
    if (command.action === "launch") return state.launch ?? ok({ launched: true });
    if (command.action === "tab_list") {
      return ok({ tabs: [{ tabId: "t1", targetId: state.active, active: true }] });
    }
    if (command.action === "tab_switch") {
      state.active = String(command.tabId);
      return ok({});
    }
    return state.reply(command);
  });
  const made = new Set<string>();
  const panes = {
    pageClosed: vi.fn(async (_run: string, _surfaceId: string) => undefined),
    made: vi.fn((_run: string, surfaceId: string) => made.has(surfaceId)),
    runRebound: vi.fn((_from: string, _to: string) => true),
  };
  // custody's half of a run's own panes (EY-1 7b): the pages it makes, in order (none left:
  // no-window), each bound at once unless a row binds it itself (`bind`)
  const custody = {
    next: [] as PageName[],
    room: true,
    bindAtOnce: true,
    refused: null as null | "no-window" | "desk-full" | "run-ended",
  };
  const views = new Map<string, PagesView>();
  const maker = {
    make: vi.fn((_o: PagesMakeOrder): PagesMakeOutcome => {
      if (custody.refused !== null) return { ok: false, refused: custody.refused };
      // custody holds its own desk to its room, after its window (2026-11-24)
      if (!custody.room) return { ok: false, refused: "desk-full" };
      const surfaceId = custody.next.shift();
      if (surfaceId === undefined) return { ok: false, refused: "no-window" };
      made.add(surfaceId);
      if (!custody.bindAtOnce) bindings.delete(surfaceId);
      return { ok: true, surfaceId };
    }),
    addressAllowed: vi.fn((url: string) => url === "about:blank" || url.startsWith("https://")),
    runEnded: vi.fn((_run: string) => undefined),
    named: vi.fn((_run: string, _surfaceId: string) => undefined),
  };
  /** A window binds a made page. */
  const bind = (surfaceId: PageName): void => {
    bindings.set(surfaceId, {
      producerEpoch: 1,
      controlBindingRevision: 1,
      page: pages[surfaceId],
    });
  };
  // a still's disk (2026-11-24): what lstat says of each path, and what opens at each; nothing is read or written
  const disk = {
    entries: new Map<string, StillEntryFacts>(),
    files: new Map<string, { facts: StillFileFacts; head: Uint8Array }>(),
    removed: [] as string[],
  };
  const stills = {
    uid: STILL_UID,
    random: vi.fn((bytes: number) => new Uint8Array(bytes).fill(0xab)),
    lstat: vi.fn(async (path: string) => {
      events.push("lstat");
      return disk.entries.get(path) ?? null;
    }),
    opened: vi.fn(async (path: string, _bytes: number) => disk.files.get(path) ?? null),
    remove: vi.fn(async (path: string) => {
      disk.removed.push(path);
      disk.files.delete(path);
    }),
  };
  const logged: Record<string, number | string>[] = [];
  let calls = 0;
  const broker = new PagesBrokerCore({
    targets: {
      lookup: (surfaceId) => bindings.get(surfaceId) ?? null,
      parked: (surfaceId) => parked.has(surfaceId),
      // a page's state is custody's own: said of a bound page, one at rest and one custody keeps unbound
      describe: (surfaceId) =>
        bindings.has(surfaceId) || parked.has(surfaceId) || kept.has(surfaceId)
          ? { url: `https://${surfaceId}.test/`, title: surfaceId }
          : null,
      pageClass: (surfaceId) => (classes.has(surfaceId) ? (classes.get(surfaceId) ?? null) : "own"),
      view: (surfaceId) => views.get(surfaceId) ?? null,
    },
    bridge,
    link,
    windows,
    engines,
    panes,
    maker,
    ...(o.stills === false ? {} : { stills }),
    madePollMs: 1,
    popupWaitMs: 500,
    exchange,
    newCallId: () => {
      calls += 1;
      return `call-${calls}`;
    },
    log: (_event, fields) => {
      logged.push({ ...fields });
    },
    warn: (event, fields) => {
      warned.push({ event, fields: { ...fields } });
    },
    ...o.deps,
  });
  return {
    broker,
    events,
    pages,
    bindings,
    parked,
    kept,
    classes,
    warned,
    windows,
    state,
    bridge,
    link,
    engines,
    exited,
    panes,
    made,
    sent,
    logged,
    custody,
    views,
    maker,
    bind,
    disk,
    stills,
  };
}

/** The uid a still's folder and file are held to in these rows. */
const STILL_UID = 501;
/** fieldd's own folder for the run's stills, as a call names it, and the name the fake's random bytes mint. */
const STILL_FOLDER = "/data/fieldd/stills/0123abcd";
const STILL_PATH = `${STILL_FOLDER}/still-${"ab".repeat(16)}.png`;
const stillDir = (uid: number, mode: number): StillEntryFacts => ({ kind: "directory", uid, mode });

/** The folder's parts as a good disk has them: root's above, fieldd's own below, the run's folder 0700. */
function goodFolder(h: ReturnType<typeof harness>): void {
  h.disk.entries.set("/data", stillDir(0, 0o755));
  h.disk.entries.set("/data/fieldd", stillDir(STILL_UID, 0o700));
  h.disk.entries.set("/data/fieldd/stills", stillDir(STILL_UID, 0o700));
  h.disk.entries.set(STILL_FOLDER, stillDir(STILL_UID, 0o700));
}

/** A PNG's first bytes for a width and height. */
function pngHead(width: number, height: number): Uint8Array {
  const head = new Uint8Array(STILL_HEAD_BYTES);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(head.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return head;
}

/** The engine's screenshot as the pinned one takes it: a file at the path it was sent, answered by that path. */
function engineWrites(
  h: ReturnType<typeof harness>,
  written: { facts: StillFileFacts; head: Uint8Array } = {
    facts: { kind: "file", uid: STILL_UID, nlink: 1, size: 5000 },
    head: pngHead(1280, 800),
  },
): void {
  h.state.reply = (c) => {
    if (c.action !== "screenshot") return ok({});
    h.disk.files.set(String(c.path), written);
    return ok({ path: c.path });
  };
}

/** A screenshot call on page-a, with the folder fieldd names (none when `folder` is null). */
function still(
  extra: Readonly<Record<string, unknown>> = {},
  folder: string | null = STILL_FOLDER,
): ShellSurfacesControlParams {
  const params = call("page-a", "screenshot", { fullPage: false, annotate: false, ...extra });
  return folder === null ? params : { ...params, folder };
}

const ctx = (ms = 5_000) => ({ signal: new AbortController().signal, deadlineAt: Date.now() + ms });

function call(
  surfaceId: PageName | undefined,
  action: string,
  extra: Readonly<Record<string, unknown>> = {},
  window: "read" | "act" = "read",
  run = "run-1",
): ShellSurfacesControlParams {
  const command = { ...extra, action };
  return surfaceId === undefined ? { run, window, command } : { run, surfaceId, window, command };
}

async function failure(p: Promise<unknown>): Promise<{ kind: string; state: string }> {
  try {
    await p;
  } catch (error) {
    if (error instanceof PagesBrokerError) return { kind: error.kind, state: error.state };
    throw error;
  }
  throw new Error("the call answered; it was to fail");
}

describe("a call, in order", () => {
  it("grants the page before the engine starts, then launches it on a key of its own", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(h.bridge.grant).toHaveBeenCalledTimes(1);
    expect(h.bridge.grant.mock.calls[0]?.[2]).toEqual({
      runKey: "run-1",
      producerEpoch: 1,
      bindingRevision: 1,
    });
    const granted = h.bridge.grant.mock.invocationCallOrder[0] ?? 0;
    expect(granted).toBeLessThan(h.engines.ensure.mock.invocationCallOrder[0] ?? 0);
    const launch = h.sent.filter((c) => c.action === "launch");
    expect(launch).toEqual([
      {
        id: expect.stringMatching(/^r\d+$/u),
        action: "launch",
        cdpUrl: "ws://127.0.0.1:9/browser/route/key-1",
      },
    ]);
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(h.bridge.arm).toHaveBeenCalledTimes(1);
    expect(h.bridge.grant).toHaveBeenCalledTimes(1);
  });

  it("opens the window first, then switches only when another tab is active", async () => {
    const h = harness();
    const answer = await h.broker.control(call("page-a", "snapshot", { interactive: true }), ctx());
    expect(answer).toEqual({ status: "done", output: { success: true, data: { snapshot: "ok" } } });
    const order = [
      "open page-a read",
      "send tab_list",
      "send tab_switch",
      "send snapshot",
      "close page-a",
    ];
    expect(h.events.filter((e) => order.includes(e))).toEqual(order);
    const switched = h.sent.find((c) => c.action === "tab_switch");
    expect(switched).toMatchObject({ tabId: TARGET["page-a"] });
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(h.sent.filter((c) => c.action === "tab_switch")).toHaveLength(1);
    await h.broker.control(call("page-b", "snapshot"), ctx());
    expect(h.sent.filter((c) => c.action === "tab_switch")).toHaveLength(2);
  });

  it("launches the engine inside the call's window: what it sends as it connects has a window to ride", async () => {
    // the first live run (2026-11-24): the pinned engine enables the page and runs a script on it as it
    // connects, and the launch only answers once those have; with no window open the bridge refused both
    const h = harness();
    await h.broker.control(call("page-a", "click", { selector: "@e3" }, "act"), ctx());
    const order = ["open page-a act", "send launch", "send tab_list", "send click", "close page-a"];
    expect(h.events.filter((e) => order.includes(e))).toEqual(order);
    // a launch that fails leaves no window open behind it
    const failing = harness();
    failing.state.launch = { ok: true, reply: { success: false, error: "no" } };
    expect(await failure(failing.broker.control(call("page-a", "snapshot"), ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "engine-starting",
    });
    const left = ["open page-a read", "send launch", "close page-a"];
    expect(failing.events.filter((e) => left.includes(e))).toEqual(left);
    // a window the page refuses starts no engine at all
    const refusing = harness();
    refusing.windows.held.add("page-a");
    expect(await refusing.broker.control(call("page-a", "snapshot"), ctx())).toEqual({
      status: "refused",
      fact: "held",
    });
    expect(refusing.engines.ensure).not.toHaveBeenCalled();
    expect(refusing.sent).toEqual([]);
  });

  it("sends the checked command exactly, under the broker's own id", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "click", { selector: "@e3" }, "act"), ctx());
    const sent = h.sent.find((c) => c.action === "click");
    expect(sent).toEqual({
      action: "click",
      selector: "@e3",
      id: expect.stringMatching(/^r\d+$/u),
    });
    // an id of the caller's is no argument of any action (2026-11-24: it was overwritten; it is refused)
    const mine = call("page-a", "click", { selector: "@e3", id: "mine" }, "act");
    expect(await failure(h.broker.control(mine, ctx()))).toEqual({
      kind: "PRECONDITION_FAILED",
      state: "not-allowed",
    });
  });

  it("keeps the run's calls one at a time", async () => {
    const h = harness();
    const slow = deferred<PagesDaemonExchange>();
    h.state.reply = (c) => (c.action === "wait" ? slow.promise : ok({}));
    const first = h.broker.control(call("page-a", "wait"), ctx());
    await vi.waitFor(() => expect(h.sent.some((c) => c.action === "wait")).toBe(true));
    const second = h.broker.control(call("page-b", "snapshot"), ctx());
    await new Promise((r) => setTimeout(r, 20));
    expect(h.sent.some((c) => c.action === "snapshot")).toBe(false);
    slow.resolve(ok({}));
    await first;
    await second;
    expect(h.sent.some((c) => c.action === "snapshot")).toBe(true);
  });
});

describe("the race", () => {
  it("revokes the route and stops the engine on a spent key, and closes the window the launch rode", async () => {
    const h = harness();
    h.state.raced = true;
    expect(await failure(h.broker.control(call("page-a", "snapshot"), ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "engine-starting",
    });
    expect(h.bridge.revokeRun).toHaveBeenCalledWith("run-1");
    expect(h.engines.stop).toHaveBeenCalledWith("run-1");
    // the launch rides the call's window (the first live run, 2026-11-24): a race closes it, and no command went
    const kept = ["open page-a read", "send launch", "close page-a"];
    expect(h.events.filter((e) => kept.includes(e))).toEqual(kept);
    expect(h.sent.map((c) => c.action)).toEqual(["launch"]);
    expect(h.broker.stats().raced).toBe(1);
    h.state.raced = false;
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(h.bridge.arm).toHaveBeenCalledTimes(2);
  });
});

describe("the person's hand", () => {
  it("answers the call in flight held at once; its command is never sent again", async () => {
    const h = harness();
    const slow = deferred<PagesDaemonExchange>();
    h.state.reply = (c) => (c.action === "click" ? slow.promise : ok({}));
    const first = h.broker.control(call("page-a", "click", {}, "act"), ctx());
    await vi.waitFor(() => expect(h.sent.some((c) => c.action === "click")).toBe(true));
    h.pages["page-a"].hand(true);
    expect(await first).toEqual({ status: "refused", fact: "held" });
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toEqual({
      status: "refused",
      fact: "held",
    });
    h.pages["page-a"].hand(false);
    expect(h.events).toContain("putDown page-a");
    const next = h.broker.control(call("page-a", "snapshot"), ctx());
    await new Promise((r) => setTimeout(r, 20));
    expect(h.sent.some((c) => c.action === "snapshot")).toBe(false);
    slow.resolve(ok({}));
    expect(await next).toMatchObject({ status: "done" });
    expect(h.sent.filter((c) => c.action === "click")).toHaveLength(1);
  });
});

describe("deadlines", () => {
  it("answers TIMEOUT before anything runs when the deadline has passed", async () => {
    const h = harness();
    expect(await failure(h.broker.control(call("page-a", "snapshot"), ctx(-1)))).toEqual({
      kind: "TIMEOUT",
      state: "deadline",
    });
    expect(h.engines.ensure).not.toHaveBeenCalled();
    expect(h.sent).toEqual([]);
  });

  it("answers TIMEOUT at the deadline, and drains the page until the engine answers", async () => {
    const h = harness({ deps: { marginMs: 0 } });
    const slow = deferred<PagesDaemonExchange>();
    h.state.reply = () => slow.promise;
    expect(await failure(h.broker.control(call("page-a", "wait"), ctx(80)))).toEqual({
      kind: "TIMEOUT",
      state: "deadline",
    });
    expect(h.events).toContain("drain page-a");
    expect(h.events).not.toContain("drained page-a");
    slow.resolve(ok({}));
    await vi.waitFor(() => expect(h.events).toContain("drained page-a"));
  });

  it("answers TIMEOUT when fieldd cancels the call, and drains the page", async () => {
    const h = harness();
    const slow = deferred<PagesDaemonExchange>();
    h.state.reply = () => slow.promise;
    const cancel = new AbortController();
    const pending = h.broker.control(call("page-a", "wait"), {
      signal: cancel.signal,
      deadlineAt: Date.now() + 5_000,
    });
    await vi.waitFor(() => expect(h.sent.some((c) => c.action === "wait")).toBe(true));
    cancel.abort();
    expect(await failure(pending)).toEqual({ kind: "TIMEOUT", state: "cancelled" });
    expect(h.events).toContain("drain page-a");
    slow.resolve(ok({}));
  });
});

describe("main's own facts", () => {
  it("answers gone on an epoch or revision move, ends the grant, then grants afresh", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    const page = h.pages["page-a"];
    h.bindings.set("page-a", { producerEpoch: 1, controlBindingRevision: 2, page });
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toEqual({
      status: "refused",
      fact: "gone",
    });
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-a");
    expect(h.events).toContain("unlease page-a");
    expect(page.listeners.size).toBe(0);
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(h.bridge.grant).toHaveBeenCalledTimes(2);
    h.bindings.delete("page-a");
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toEqual({
      status: "refused",
      fact: "gone",
    });
  });

  it("answers parked and held before the engine is asked", async () => {
    const h = harness();
    h.parked.add("page-a");
    h.bindings.delete("page-a");
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toEqual({
      status: "refused",
      fact: "parked",
    });
    h.pages["page-b"].held = true;
    expect(await h.broker.control(call("page-b", "snapshot"), ctx())).toEqual({
      status: "refused",
      fact: "held",
    });
    expect(h.engines.ensure).not.toHaveBeenCalled();
  });

  it("answers by precedence: the window's closer, then the first refusal, then done", async () => {
    const h = harness();
    h.windows.expireNext = true;
    expect(await h.broker.control(call("page-a", "click", {}, "act"), ctx())).toEqual({
      status: "refused",
      fact: "loading",
    });
    h.windows.expireNext = false;
    h.state.refusals.set("call-2", [
      { callId: "call-2", method: "Runtime.evaluate", code: "forbidden" },
      { callId: "call-2", method: "Page.navigate", code: "off-site" },
    ]);
    // (`navigate`: these two said `open`, the row's name and no action of the engine's, off the allow list)
    expect(await h.broker.control(call("page-a", "navigate"), ctx())).toEqual({
      status: "refused",
      fact: "off-site",
    });
    h.state.refusals.set("call-3", [
      { callId: "call-3", method: "Page.navigate", code: "needs-you", need: "sign-in" },
    ]);
    expect(await h.broker.control(call("page-a", "navigate"), ctx())).toEqual({
      status: "refused",
      fact: "needs-you",
      need: "sign-in",
    });
    h.state.refusals.set("call-4", [
      { callId: "call-4", method: "Runtime.evaluate", code: "forbidden" },
    ]);
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toMatchObject({
      status: "done",
    });
  });

  it("refuses an agent's launch, and ends the run on its run-level close", async () => {
    const h = harness();
    const launch = call("page-a", "launch", { cdpUrl: "ws://x" });
    expect(await failure(h.broker.control(launch, ctx()))).toEqual({
      kind: "PRECONDITION_FAILED",
      state: "broker-owned",
    });
    expect(await failure(h.broker.control(call(undefined, "navigate"), ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "no-window",
    });
    expect(h.sent).toEqual([]);
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(await h.broker.control(call(undefined, "close"), ctx())).toEqual({
      status: "done",
      output: { success: true },
      givenBack: ["page-a"],
    });
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-a");
    expect(h.bridge.revokeRun).toHaveBeenCalledWith("run-1");
    expect(h.engines.stop).toHaveBeenCalledWith("run-1");
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-a");
    expect(h.sent.filter((c) => c.action === "close")).toEqual([]);
  });
});

describe("what main answers itself", () => {
  it("lists the run's pages from its grants, with its last call's page, asking the engine nothing", async () => {
    const h = harness();
    expect(await h.broker.control(call(undefined, "tab_list"), ctx())).toEqual({
      status: "done",
      output: { success: true, data: { tabs: [], current: null } },
    });
    await h.broker.control(call("page-a", "snapshot"), ctx());
    await h.broker.control(call("page-b", "snapshot"), ctx());
    const before = h.sent.length;
    expect(await h.broker.control(call(undefined, "tab_list"), ctx())).toEqual({
      status: "done",
      output: {
        success: true,
        data: {
          tabs: [
            { surfaceId: "page-a", url: "https://page-a.test/", title: "page-a" },
            { surfaceId: "page-b", url: "https://page-b.test/", title: "page-b" },
          ],
          current: "page-b",
        },
      },
    });
    expect(h.sent).toHaveLength(before);
  });

  it("ends one page for the run on its page-form close, and asks the engine nothing", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    const before = h.sent.length;
    expect(await h.broker.control(call("page-a", "close"), ctx())).toEqual({
      status: "done",
      output: { success: true },
      givenBack: ["page-a"],
    });
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-a");
    expect(h.events).toContain("unlease page-a");
    expect(h.pages["page-a"].listeners.size).toBe(0);
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-a");
    expect(h.sent).toHaveLength(before);
    expect(h.engines.stop).not.toHaveBeenCalled();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(h.bridge.grant).toHaveBeenCalledTimes(2);
  });

  it("moves a resumed run's pages to its new key, and never merges two live runs", async () => {
    const h = harness();
    const rebind = (to: string, from: unknown) =>
      h.broker.control(call(undefined, "rebind", { from }, "read", to), ctx());
    const refusedRebind = { kind: "PRECONDITION_FAILED", state: "rebind-refused" };
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(await failure(rebind("run-2", "run-9"))).toEqual(refusedRebind);
    expect(await failure(rebind("run-1", "run-1"))).toEqual(refusedRebind);
    expect(await failure(rebind("run-2", 7))).toEqual(refusedRebind);
    await h.broker.control(call("page-b", "snapshot", {}, "read", "run-3"), ctx());
    expect(await failure(rebind("run-3", "run-1"))).toEqual(refusedRebind);
    expect(await rebind("run-2", "run-1")).toEqual({ status: "done", output: { success: true } });
    expect(h.bridge.revokeRun).toHaveBeenCalledWith("run-1");
    expect(h.engines.stop).toHaveBeenCalledWith("run-1");
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-a");
    expect(h.panes.runRebound).toHaveBeenCalledWith("run-1", "run-2");
    expect(h.panes.pageClosed).not.toHaveBeenCalled();
    const listed = await h.broker.control(call(undefined, "tab_list", {}, "read", "run-2"), ctx());
    expect(listed).toMatchObject({
      output: { data: { tabs: [{ surfaceId: "page-a" }], current: "page-a" } },
    });
    const armed = h.bridge.arm.mock.calls.length;
    await h.broker.control(call("page-a", "snapshot", {}, "read", "run-2"), ctx());
    expect(h.bridge.grant).toHaveBeenLastCalledWith("run-2", "page-a", {
      runKey: "run-2",
      producerEpoch: 1,
      bindingRevision: 1,
    });
    expect(h.bridge.arm.mock.calls.length).toBe(armed + 1);
  });

  it("runs a rebind in the old run's turn: after its call in flight, never under it", async () => {
    const h = harness();
    const slow = deferred<PagesDaemonExchange>();
    h.state.reply = (c) => (c.action === "wait" ? slow.promise : ok({}));
    const first = h.broker.control(call("page-a", "wait"), ctx());
    await vi.waitFor(() => expect(h.sent.some((c) => c.action === "wait")).toBe(true));
    const rebind = call(undefined, "rebind", { from: "run-1" }, "read", "run-2");
    const rebound = h.broker.control(rebind, ctx());
    await new Promise((r) => setTimeout(r, 20));
    expect(h.bridge.revokeRun).not.toHaveBeenCalled();
    slow.resolve(ok({}));
    await first;
    expect(await rebound).toEqual({ status: "done", output: { success: true } });
    expect(h.bridge.revokeRun).toHaveBeenCalledWith("run-1");
  });
});

describe("the engine's own failures", () => {
  it("answers UNAVAILABLE with the engine's state, and each exchange failure by kind", async () => {
    const h = harness();
    h.state.unavailable = "engine-refused";
    expect(await failure(h.broker.control(call("page-a", "snapshot"), ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "engine-refused",
    });
    h.state.unavailable = null;
    h.state.reply = () => ({ ok: false, failure: "outcome-unknown" });
    expect(await failure(h.broker.control(call("page-a", "click"), ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "outcome-unknown",
    });
    h.state.reply = () => ok("x".repeat(1024 * 1024));
    expect(await failure(h.broker.control(call("page-a", "snapshot"), ctx()))).toEqual({
      kind: "RESOURCE_EXHAUSTED",
      state: "output-too-large",
    });
  });

  // 2026-11-24, an act the engine may have done: an engine that dies under a command is seen two ways, by its
  // socket closing (the exchange's `outcome-unknown`) and by its exit, in either order. The first is main's word
  // for "the line went out and no whole reply came back", which crosses with no state and is worded as stopped,
  // try again.
  it("an act the engine was handed, whose socket closed before a whole answer, is no-answer; a read and a command that never went keep their words", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    h.state.reply = () => ({ ok: false, failure: "outcome-unknown" });
    const click = call("page-a", "click", { selector: "@e1" }, "act");
    expect(await failure(h.broker.control(click, ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "no-answer",
    });
    // a read changed nothing
    const read = call("page-a", "gettext", { selector: "@e1" });
    expect(await failure(h.broker.control(read, ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "outcome-unknown",
    });
    // the socket refused before the line was written: the engine never saw the act
    h.state.reply = () => ({ ok: false, failure: "not-sent" });
    expect(await failure(h.broker.control(click, ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "not-sent",
    });
  });

  it("an act whose engine's list failed before its own command went keeps the exchange's word, and the command is never sent", async () => {
    const sent: string[] = [];
    const h = harness({
      deps: {
        exchange: async (_path, command) => {
          sent.push(command.action);
          if (command.action === "launch") return ok({ launched: true });
          return { ok: false, failure: "outcome-unknown" };
        },
      },
    });
    const click = call("page-a", "click", { selector: "@e1" }, "act");
    expect(await failure(h.broker.control(click, ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "outcome-unknown",
    });
    expect(sent).toEqual(["launch", "tab_list"]);
  });

  it("logs durations, sizes and states, never a URL or a key", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    const text = JSON.stringify(h.logged);
    expect(h.logged.length).toBeGreaterThan(0);
    expect(text).not.toContain("ws://");
    expect(text).not.toContain("key-");
  });
});

describe("an engine's life", () => {
  it("reaps an idle engine, and the next call launches another with a new key", async () => {
    const h = harness({ deps: { idleReapMs: 20 } });
    await h.broker.control(call("page-a", "snapshot"), ctx());
    await vi.waitFor(() => expect(h.engines.stop).toHaveBeenCalledWith("run-1"));
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(h.bridge.arm).toHaveBeenCalledTimes(2);
  });

  it("counts the idle bound from the engine's last command: calls main answers itself do not push the reap back", async () => {
    // 2026-11-24: the engine counts its own idle time from its last command. Every call's end re-armed main's
    // reap for the whole bound, a call the engine never saw among them, so a run that kept making such calls
    // sent the engine nothing and still held main's reap off until the engine ended itself first.
    vi.useFakeTimers();
    try {
      const h = harness({ deps: { idleReapMs: 1_000 } });
      await h.broker.control(call("page-a", "snapshot"), ctx());
      const sent = h.sent.length;
      for (let i = 0; i < 3; i += 1) {
        await vi.advanceTimersByTimeAsync(400);
        // the page form's close of a page the run does not hold: main answers it, and the engine is sent nothing
        await h.broker.control(call("page-b", "close", {}, "act"), ctx());
      }
      // 1200 ms after the engine's last command, with a call of main's own every 400
      await vi.advanceTimersByTimeAsync(0);
      expect(h.sent).toHaveLength(sent);
      expect(h.engines.stop).toHaveBeenCalledWith("run-1");
      expect(h.logged).toContainEqual({ idleMs: 1_000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a command that reaches the engine starts the count again; a run with no engine launched keeps the whole bound from its last call", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ deps: { idleReapMs: 1_000 } });
      await h.broker.control(call("page-a", "snapshot"), ctx());
      await vi.advanceTimersByTimeAsync(800);
      await h.broker.control(call("page-a", "snapshot"), ctx());
      await vi.advanceTimersByTimeAsync(800);
      expect(h.engines.stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(h.engines.stop).toHaveBeenCalledTimes(1);
      // nothing launched now: the reap's own clock is the run's last call, as before
      await h.broker.control(call("page-b", "close", {}, "act"), ctx());
      await vi.advanceTimersByTimeAsync(900);
      expect(h.engines.stop).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(200);
      expect(h.engines.stop).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops every run and engine at stop, and starts none after", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    await h.broker.stop("quit");
    expect(h.engines.stopAll).toHaveBeenCalledTimes(1);
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-a");
    expect(h.pages["page-a"].listeners.size).toBe(0);
    expect(await failure(h.broker.control(call("page-a", "snapshot"), ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "engine-stopped",
    });
  });
});

describe("a window's deadline, and a refused grant", () => {
  it("closes an act window at its deadline though no further call comes; the call says loading", async () => {
    const h = harness();
    h.windows.leaseMs = 30;
    const slow = deferred<PagesDaemonExchange>();
    h.state.reply = (c) => (c.action === "click" ? slow.promise : ok({}));
    const pending = h.broker.control(call("page-a", "click", {}, "act"), ctx());
    await vi.waitFor(() => expect(h.events).toContain("closeCall page-a"));
    expect(h.windows.opened.has("page-a")).toBe(false);
    slow.resolve(ok({}));
    expect(await pending).toEqual({ status: "refused", fact: "loading" });
  });

  it("answers a grant the bridge refuses PRECONDITION_FAILED, and starts no engine", async () => {
    const h = harness();
    h.state.refuseGrant = true;
    expect(await failure(h.broker.control(call("page-a", "snapshot"), ctx()))).toEqual({
      kind: "PRECONDITION_FAILED",
      state: "grant-refused",
    });
    expect(h.engines.ensure).not.toHaveBeenCalled();
    expect(h.events).not.toContain("lease page-a");
  });
});

describe("giveBack: an agent's close of a page the person handed it (7f)", () => {
  it("gives the page back mid-call: the page stays open, the call answers as its engine did, and names it once", async () => {
    const h = harness();
    const gave: unknown[] = [];
    h.state.reply = (c) => {
      if (c.action === "tab_close") gave.push(h.broker.giveBack("run-1", "page-a"));
      return ok({ closed: true });
    };
    const answer = await h.broker.control(call("page-a", "tab_close", {}, "act"), ctx());
    expect(gave).toEqual([{ ok: true }]);
    expect(answer).toEqual({
      status: "done",
      output: { success: true, data: { closed: true } },
      givenBack: ["page-a"],
    });
    expect(answer).not.toHaveProperty("closed");
    expect(h.windows.closed.find((w) => w.callId === "call-1")?.closedBy).toBe("call-end");
    expect(h.events.indexOf("close page-a")).toBeLessThan(h.events.indexOf("unlease page-a"));
    expect(h.bridge.endGrant).toHaveBeenCalledTimes(1);
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-a");
    expect(h.panes.pageClosed).not.toHaveBeenCalled();
    expect(h.pages["page-a"].listeners.size).toBe(0);
    const next = await h.broker.control(call("page-b", "snapshot"), ctx());
    expect(next).not.toHaveProperty("givenBack");
  });

  it("refuses a second giveBack, and one from a run that holds no grant, not-granted", async () => {
    const h = harness();
    const gave: unknown[] = [];
    h.state.reply = (c) => {
      if (c.action === "tab_close") {
        gave.push(h.broker.giveBack("run-1", "page-a"));
        gave.push(h.broker.giveBack("run-1", "page-a"));
      }
      return ok({});
    };
    await h.broker.control(call("page-a", "tab_close", {}, "act"), ctx());
    expect(gave).toEqual([{ ok: true }, { ok: false, refused: "not-granted" }]);
    expect(h.broker.giveBack("run-1", "page-a")).toEqual({ ok: false, refused: "not-granted" });
    expect(h.broker.giveBack("run-2", "page-b")).toEqual({ ok: false, refused: "not-granted" });
    expect(h.bridge.endGrant).toHaveBeenCalledTimes(1);
  });

  it("refuses held while the person holds the page, and the grant stands", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    h.pages["page-a"].hand(true);
    expect(h.broker.giveBack("run-1", "page-a")).toEqual({ ok: false, refused: "held" });
    h.pages["page-a"].hand(false);
    await Promise.resolve();
    expect(h.bridge.endGrant).not.toHaveBeenCalled();
    expect(h.windows.leases.has("page-a")).toBe(true);
    expect(h.broker.giveBack("run-1", "page-a")).toEqual({ ok: true });
  });

  it("refuses a page the run made, made, and the grant stands", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    h.made.add("page-a");
    expect(h.broker.giveBack("run-1", "page-a")).toEqual({ ok: false, refused: "made" });
    expect(h.panes.made).toHaveBeenCalledWith("run-1", "page-a");
    await Promise.resolve();
    expect(h.bridge.endGrant).not.toHaveBeenCalled();
    expect(h.windows.leases.has("page-a")).toBe(true);
  });

  it("with no call on the page, ends its grant at once, and the run's next answer names it once", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(h.broker.giveBack("run-1", "page-a")).toEqual({ ok: true });
    await vi.waitFor(() => expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-a"));
    expect(h.events).toContain("unlease page-a");
    expect(await h.broker.control(call("page-b", "snapshot"), ctx())).toMatchObject({
      status: "done",
      givenBack: ["page-a"],
    });
    const after = await h.broker.control(call("page-b", "snapshot"), ctx());
    expect(after).not.toHaveProperty("givenBack");
    expect(h.bridge.endGrant).toHaveBeenCalledTimes(1);
  });

  it("answers gone to a call that waited for its turn on a page given back meanwhile", async () => {
    const h = harness();
    const slow = deferred<PagesDaemonExchange>();
    h.state.reply = (c) => {
      if (c.action === "tab_close") {
        h.broker.giveBack("run-1", "page-a");
        return slow.promise;
      }
      return ok({});
    };
    await h.broker.control(call("page-a", "snapshot"), ctx());
    const closing = h.broker.control(call("page-a", "tab_close", {}, "act"), ctx());
    await vi.waitFor(() => expect(h.sent.some((c) => c.action === "tab_close")).toBe(true));
    const waiting = h.broker.control(call("page-a", "snapshot"), ctx());
    slow.resolve(ok({}));
    expect(await closing).toMatchObject({ status: "done", givenBack: ["page-a"] });
    expect(await waiting).toEqual({ status: "refused", fact: "gone" });
  });

  it("carries what a resumed run's old key gave back to its new key's answer", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    h.broker.giveBack("run-1", "page-a");
    await vi.waitFor(() => expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-a"));
    const rebind = call(undefined, "rebind", { from: "run-1" }, "read", "run-2");
    expect(await h.broker.control(rebind, ctx())).toEqual({
      status: "done",
      output: { success: true },
      givenBack: ["page-a"],
    });
  });

  it("names a handed page in givenBack when a close lets it go, and a made pane in closed, never in givenBack", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    await h.broker.control(call("page-b", "snapshot"), ctx());
    h.made.add("page-b");
    const pageClose = await h.broker.control(call("page-b", "close"), ctx());
    expect(pageClose).toEqual({ status: "done", output: { success: true }, closed: ["page-b"] });
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-b");
    await h.broker.control(call("page-b", "snapshot"), ctx());
    const runClose = await h.broker.control(call(undefined, "close"), ctx());
    expect(runClose).toEqual({
      status: "done",
      output: { success: true },
      givenBack: ["page-a"],
      closed: ["page-b"],
    });
  });

  it("names at most PAGES_RUN_PANES_MAX at a run's close, and owes nothing past the run's end", async () => {
    const h = harness();
    const handed = ["page-a", "page-b", "page-c", "page-d", "page-e", "page-f"] as const;
    expect(handed.length).toBeGreaterThan(PAGES_RUN_PANES_MAX);
    for (const page of handed) await h.broker.control(call(page, "snapshot"), ctx());
    const closed = await h.broker.control(call(undefined, "close"), ctx());
    expect(closed).toMatchObject({ givenBack: handed.slice(0, PAGES_RUN_PANES_MAX) });
    const after = await h.broker.control(call(undefined, "tab_list"), ctx());
    expect(after).not.toHaveProperty("givenBack");
  });
});

describe("a signed-in page, before EY-5", () => {
  async function thrown(p: Promise<unknown>): Promise<Record<string, string>> {
    try {
      await p;
    } catch (error) {
      if (error instanceof PagesBrokerError) {
        return { kind: error.kind, state: error.state, message: error.message };
      }
      throw error;
    }
    // answered: a row then fails by its own expectation
    return { answered: "yes" };
  }

  it("is refused first, with one answer bound, held, at rest and unbound, and nothing granted, armed or started", async () => {
    const h = harness();
    h.classes.set("page-a", "signed-in");
    const answers = [await thrown(h.broker.control(call("page-a", "snapshot"), ctx()))];
    h.pages["page-a"].held = true;
    answers.push(await thrown(h.broker.control(call("page-a", "snapshot"), ctx())));
    h.pages["page-a"].held = false;
    h.bindings.delete("page-a");
    h.parked.add("page-a");
    answers.push(await thrown(h.broker.control(call("page-a", "snapshot"), ctx())));
    h.parked.delete("page-a");
    answers.push(await thrown(h.broker.control(call("page-a", "snapshot"), ctx())));
    // and its close, before the close is read
    answers.push(await thrown(h.broker.control(call("page-a", "close"), ctx())));
    // the answers equal one another: no state of the person's page leaks through a difference
    for (const answer of answers) expect(answer).toEqual(answers[0]);
    expect(answers[0]).toEqual({
      kind: "PRECONDITION_FAILED",
      state: "signed-in",
      message: "pages: signed-in",
    });
    expect(h.bridge.addRun).not.toHaveBeenCalled();
    expect(h.bridge.grant).not.toHaveBeenCalled();
    expect(h.bridge.arm).not.toHaveBeenCalled();
    expect(h.engines.ensure).not.toHaveBeenCalled();
  });

  it("writes one warn line with its run and surface, and nothing else", async () => {
    const h = harness();
    h.classes.set("page-c", "signed-in");
    await thrown(h.broker.control(call("page-c", "snapshot", {}, "read", "run-7"), ctx()));
    expect(h.warned).toEqual([
      { event: "pages.broker.signed_in_refused", fields: { run: "run-7", surfaceId: "page-c" } },
    ]);
  });

  it("an own page is granted, and a surface with no browser page falls through to gone", async () => {
    const h = harness();
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toMatchObject({
      status: "done",
    });
    expect(h.bridge.grant).toHaveBeenCalledTimes(1);
    h.classes.set("page-b", null);
    h.bindings.delete("page-b");
    expect(await h.broker.control(call("page-b", "snapshot"), ctx())).toEqual({
      status: "refused",
      fact: "gone",
    });
    expect(h.warned).toEqual([]);
  });
});

describe("a page at rest", () => {
  it("answers parked with no binding and its producer at rest, and gone with no producer", async () => {
    const h = harness();
    h.bindings.delete("page-a");
    h.parked.add("page-a");
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toEqual({
      status: "refused",
      fact: "parked",
    });
    h.bindings.delete("page-b");
    expect(await h.broker.control(call("page-b", "snapshot"), ctx())).toEqual({
      status: "refused",
      fact: "gone",
    });
    expect(h.engines.ensure).not.toHaveBeenCalled();
  });

  it("never parks a bound page, whatever its producer says", async () => {
    const h = harness();
    h.parked.add("page-c");
    expect(await h.broker.control(call("page-c", "snapshot"), ctx())).toMatchObject({
      status: "done",
    });
  });

  it("a page the person rests mid-run answers parked to the next call, and works once woken", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    h.bindings.delete("page-a");
    h.parked.add("page-a");
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toEqual({
      status: "refused",
      fact: "parked",
    });
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-a");
    h.parked.delete("page-a");
    h.bindings.set("page-a", {
      producerEpoch: 2,
      controlBindingRevision: 2,
      page: h.pages["page-a"],
    });
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toMatchObject({
      status: "done",
    });
    expect(h.bridge.grant).toHaveBeenCalledTimes(2);
  });
});

describe("a run's own panes (EY-1 7b, row 4)", () => {
  const OPENER: PagesView = { logicalViewport: { width: 390, height: 844 }, deviceScaleFactor: 3 };

  it("a tab inside an act window: made at its opener's size, waited for, granted, and named in made", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    h.custody.bindAtOnce = false;
    h.views.set("page-a", OPENER);
    let made: unknown;
    h.state.reply = async (c) => {
      if (c.action !== "click") return ok({});
      const answer = h.broker.make({ runKey: "run-1", callId: "call-1", url: "https://e.test/" });
      setTimeout(() => h.bind("page-e"), 5);
      made = await answer;
      return ok({ clicked: true });
    };
    const answer = await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    expect(made).toEqual({ ok: true, pageId: "page-e", targetId: TARGET["page-e"] });
    expect(h.maker.make).toHaveBeenCalledWith({
      run: "run-1",
      url: "https://e.test/",
      by: "tab",
      ...OPENER,
    });
    expect(h.bridge.grant).toHaveBeenCalledWith("run-1", "page-e", expect.anything());
    expect(answer).toEqual({
      status: "done",
      output: { success: true, data: { clicked: true } },
      made: [{ surfaceId: "page-e", url: "https://e.test/", by: "tab" }],
    });
  });

  it("refuses a tab in order: outside an act window, the address, the run's cap, then custody's own (its desk, its window)", async () => {
    const h = harness();
    expect(
      await h.broker.make({ runKey: "run-1", callId: "call-9", url: "https://e.test/" }),
    ).toEqual({ ok: false, refused: "outside-window" });
    h.custody.next.push("page-b", "page-c", "page-d", "page-e", "page-f");
    const answers: unknown[] = [];
    h.state.reply = async (c) => {
      if (c.action !== "click") return ok({});
      const tab = (url: string) => h.broker.make({ runKey: "run-1", callId: "call-1", url });
      answers.push(await tab("javascript:alert(1)"));
      for (let i = 0; i < PAGES_RUN_PANES_MAX; i += 1) {
        answers.push(await tab(`https://t${i}.test/`));
      }
      answers.push(await tab("https://over.test/"));
      h.made.clear();
      h.custody.room = false;
      answers.push(await tab("https://e.test/"));
      h.custody.room = true;
      h.custody.refused = "desk-full";
      answers.push(await tab("https://e.test/"));
      h.custody.refused = "no-window";
      answers.push(await tab("https://e.test/"));
      return ok({});
    };
    await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    expect(answers.map((a) => (a as { refused?: string }).refused ?? "made")).toEqual([
      "address",
      ...Array.from({ length: PAGES_RUN_PANES_MAX }, () => "made"),
      "run-full",
      "desk-full",
      "desk-full",
      "no-window",
    ]);
    // custody is asked only past the broker's own refusals (the address and the run's cap); the desk's room is
    // custody's to refuse (2026-11-24: the broker asked it first, and it is one more asking here)
    expect(h.maker.make).toHaveBeenCalledTimes(PAGES_RUN_PANES_MAX + 3);
  });

  it("custody's word that a made page went ends its wait: a decline is desk-full, the grace, the run's end and a failed page no-window", async () => {
    const h = harness();
    h.custody.bindAtOnce = false;
    h.custody.next.push("page-d", "page-e", "page-f", "page-g");
    const answers: unknown[] = [];
    h.state.reply = async (c) => {
      if (c.action !== "click") return ok({});
      const gone = [
        ["page-d", "declined"],
        ["page-e", "grace"],
        ["page-f", "run-end"],
        // 2026-11-24: to the engine's own client a failed page has no window either (the endpoint has five words)
        ["page-g", "failed"],
      ] as const;
      for (const [page, why] of gone) {
        const answer = h.broker.make({ runKey: "run-1", callId: "call-1", url: "https://e.test/" });
        h.broker.madeGone("run-1", page, why);
        answers.push(await answer);
      }
      return ok({});
    };
    const answer = await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    expect(answers).toEqual([
      { ok: false, refused: "desk-full" },
      { ok: false, refused: "no-window" },
      { ok: false, refused: "no-window" },
      { ok: false, refused: "no-window" },
    ]);
    expect(answer).not.toHaveProperty("made");
    expect(h.bridge.grant).toHaveBeenCalledTimes(1);
  });

  it("a made page no window binds by the call's deadline goes: no-window, and custody closes it", async () => {
    const h = harness();
    h.custody.bindAtOnce = false;
    h.custody.next.push("page-e");
    let made: Promise<unknown> | undefined;
    h.state.reply = (c) => {
      if (c.action === "click") {
        made = h.broker.make({ runKey: "run-1", callId: "call-1", url: "https://e.test/" });
      }
      // the engine never answers: the call ends at its deadline
      return new Promise<never>(() => undefined);
    };
    expect(await failure(h.broker.control(call("page-a", "click", {}, "act"), ctx(700)))).toEqual({
      kind: "TIMEOUT",
      state: "deadline",
    });
    expect(await made).toEqual({ ok: false, refused: "no-window" });
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
  });

  it("the run form's call with no page opens the run a pane at about:blank, a person's new pane's size, and goes on it", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    // before this seam a run-level call with no page threw; the rows read what it gave, either way
    const answer = await h.broker
      .control(call(undefined, "navigate", { url: "https://x.test/" }, "act"), ctx())
      .catch((error: unknown) => error);
    expect(h.maker.make).toHaveBeenCalledWith({
      run: "run-1",
      url: "about:blank",
      by: "open",
      logicalViewport: PAGES_MADE_VIEWPORT,
      deviceScaleFactor: PAGES_MADE_DEVICE_SCALE,
    });
    expect(h.sent.at(-1)).toMatchObject({ action: "navigate", url: "https://x.test/" });
    // the pane is made blank and the engine takes it to the address; the answer names that address (2026-11-24)
    expect(answer).toEqual({
      status: "done",
      output: { success: true, data: { snapshot: "ok" } },
      made: [{ surfaceId: "page-e", url: "https://x.test/", by: "open" }],
    });
    // with no room, or no window, nothing is made and the call says why; a launch is main's own
    h.custody.room = false;
    expect(await failure(h.broker.control(call(undefined, "navigate"), ctx()))).toEqual({
      kind: "RESOURCE_EXHAUSTED",
      state: "desk-full",
    });
    h.custody.room = true;
    expect(await failure(h.broker.control(call(undefined, "navigate"), ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "no-window",
    });
    expect(await failure(h.broker.control(call(undefined, "launch"), ctx()))).toEqual({
      kind: "PRECONDITION_FAILED",
      state: "broker-owned",
    });
    // the open, the one with no room (custody's own refusal since 2026-11-24) and the one with no window
    expect(h.maker.make).toHaveBeenCalledTimes(3);
  });

  it("the client's close of a pane the run made: closed in custody, its grant ended, and named in closed", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    await h.broker.control(call(undefined, "navigate", {}, "act"), ctx()).catch(() => undefined);
    // a page the run did not make is untouched
    await h.broker.closeMade("run-1", "page-a");
    expect(h.panes.pageClosed).not.toHaveBeenCalled();
    await h.broker.closeMade("run-1", "page-e");
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-e");
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
    expect(await h.broker.control(call(undefined, "tab_list"), ctx())).toMatchObject({
      closed: ["page-e"],
    });
  });

  it("the run's end: its made panes are named in closed, and custody ends the run", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    await h.broker.control(call(undefined, "navigate", {}, "act"), ctx()).catch(() => undefined);
    expect(await h.broker.control(call(undefined, "close"), ctx())).toEqual({
      status: "done",
      output: { success: true },
      closed: ["page-e"],
    });
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
    expect(h.maker.runEnded).toHaveBeenCalledWith("run-1");
  });

  it("an act window puts the run's pop-up policy on its page and takes it off at its end; a read puts none", async () => {
    const h = harness();
    const seen: (PagesPopups | null)[] = [];
    h.state.reply = async () => {
      seen.push(h.pages["page-a"].policy);
      return ok({});
    };
    await h.broker.control(call("page-a", "snapshot"), ctx());
    await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    expect(seen[0]).toBeNull();
    expect(seen[1]).not.toBeNull();
    expect(h.pages["page-a"].policy).toBeNull();
  });

  it("a binding the page gets mid-window (a remake) takes the policy again, the old page none, and the window's end takes it off", async () => {
    const h = harness();
    const remade = new FakePage();
    let before: PagesPopups | null = null;
    let during: PagesPopups | null = null;
    let left: unknown = "unread";
    h.state.reply = async (c) => {
      if (c.action !== "click") return ok({});
      before = h.pages["page-a"].policy;
      h.bindings.set("page-a", { producerEpoch: 1, controlBindingRevision: 2, page: remade });
      for (let i = 0; i < 100 && remade.policy === null; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      during = remade.policy;
      left = h.pages["page-a"].policy;
      return ok({});
    };
    await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    expect(before).not.toBeNull();
    expect(during).toBe(before);
    expect(left).toBeNull();
    expect(remade.policy).toBeNull();
  });

  it("a pop-up: allowed, it is the run's own pane at its opener's size, named on an answer; refused, it is counted by why", async () => {
    const h = harness();
    h.custody.next.push("page-b");
    h.views.set("page-a", OPENER);
    const decided: string[] = [];
    h.state.reply = async (c) => {
      const policy = h.pages["page-a"].policy;
      if (c.action !== "click" || policy === null) return ok({});
      decided.push(policy.decide("javascript:alert(1)"));
      for (let i = 0; i < PAGES_RUN_PANES_MAX; i += 1) {
        decided.push(policy.decide(`https://p${i}.test/`));
      }
      decided.push(policy.decide("https://over.test/"));
      policy.open("https://p0.test/");
      return ok({});
    };
    const click = await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    expect(decided).toEqual([
      "deny",
      ...Array.from({ length: PAGES_RUN_PANES_MAX }, () => "allow"),
      "deny",
    ]);
    expect(click).toMatchObject({ capped: { address: 1, runFull: 1 } });
    await vi.waitFor(() =>
      expect(h.bridge.grant).toHaveBeenCalledWith("run-1", "page-b", expect.anything()),
    );
    expect(h.maker.make).toHaveBeenCalledWith({
      run: "run-1",
      url: "https://p0.test/",
      by: "popup",
      ...OPENER,
    });
    const next = await h.broker.control(call("page-a", "snapshot"), ctx());
    expect([...(click.made ?? []), ...(next.made ?? [])]).toEqual([
      { surfaceId: "page-b", url: "https://p0.test/", by: "popup" },
    ]);
    // the four allowed and never opened gave their places back at the window's end; the desk's
    // room is counted too, by custody's word at the make (2026-11-24: the broker asked the desk at the
    // decision, before any window; the pop-up is allowed there now and refused where custody refuses it)
    h.custody.room = false;
    h.state.reply = async (c) => {
      const policy = h.pages["page-a"].policy;
      if (c.action !== "click" || policy === null) return ok({});
      decided.push(policy.decide("https://q.test/"));
      policy.open("https://q.test/");
      return ok({});
    };
    const full = await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    expect(decided.at(-1)).toBe("allow");
    expect(full).toMatchObject({ capped: { deskFull: 1 } });
    expect(h.maker.make).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: "https://q.test/", by: "popup" }),
    );
  });

  it("a hold between a pop-up's allow and its open drops it: nothing is made, and every place is free again", async () => {
    const h = harness();
    h.custody.next.push("page-b");
    const decided: string[] = [];
    h.state.reply = async (c) => {
      const policy = h.pages["page-a"].policy;
      if (c.action !== "click" || policy === null) return ok({});
      decided.push(policy.decide("https://p.test/"));
      h.pages["page-a"].hand(true);
      policy.open("https://p.test/");
      return ok({});
    };
    expect(await h.broker.control(call("page-a", "click", {}, "act"), ctx())).toEqual({
      status: "refused",
      fact: "held",
    });
    expect(decided).toEqual(["allow"]);
    expect(h.maker.make).not.toHaveBeenCalled();
    expect(h.pages["page-a"].policy).toBeNull();
    h.pages["page-a"].hand(false);
    h.state.reply = async (c) => {
      const policy = h.pages["page-a"].policy;
      if (c.action !== "click" || policy === null) return ok({});
      for (let i = 0; i < PAGES_RUN_PANES_MAX; i += 1) {
        decided.push(policy.decide(`https://p${i}.test/`));
      }
      return ok({});
    };
    await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    expect(decided.slice(1)).toEqual(Array.from({ length: PAGES_RUN_PANES_MAX }, () => "allow"));
  });
});

describe("a run's own panes, held to their run (EY-1 7b, row 4)", () => {
  /** An act call on page-a whose page opens one pop-up at `url`, allowed. */
  const opensPopup = (h: ReturnType<typeof harness>, url = "https://p.test/") => {
    h.state.reply = async (c) => {
      const policy = h.pages["page-a"].policy;
      if (c.action === "click" && policy !== null && policy.decide(url) === "allow") {
        policy.open(url);
      }
      return ok({});
    };
  };

  it("the run's end while a pop-up's page is waited for: custody closes it, unnamed, and nothing is granted", async () => {
    const h = harness();
    h.custody.bindAtOnce = false;
    h.custody.next.push("page-e");
    opensPopup(h);
    await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    await vi.waitFor(() => expect(h.maker.make).toHaveBeenCalledTimes(1));
    // the run never saw the page, so its end names only the page it was handed
    expect(await h.broker.control(call(undefined, "close"), ctx())).toEqual({
      status: "done",
      output: { success: true },
      givenBack: ["page-a"],
    });
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
    h.bind("page-e");
    const after = await h.broker.control(call(undefined, "tab_list"), ctx());
    expect(h.bridge.grant).not.toHaveBeenCalledWith("run-1", "page-e", expect.anything());
    expect(after).not.toHaveProperty("made");
    expect(after).not.toHaveProperty("capped");
  });

  it("a rebind while a pop-up's page is waited for: custody closes it as the old run's, unnamed", async () => {
    const h = harness();
    h.custody.bindAtOnce = false;
    h.custody.next.push("page-e");
    opensPopup(h);
    await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    await vi.waitFor(() => expect(h.maker.make).toHaveBeenCalledTimes(1));
    const rebound = await h.broker
      .control(call(undefined, "rebind", { from: "run-1" }, "read", "run-2"), ctx())
      .catch((error: unknown) => error);
    expect(rebound).toEqual({ status: "done", output: { success: true } });
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
    expect(h.panes.runRebound).toHaveBeenCalledWith("run-1", "run-2");
  });

  it("a pop-up waiting for its page is counted once: with three made, two allowed pop-ups are both made", async () => {
    const h = harness();
    h.custody.next.push("page-b", "page-c", "page-d");
    for (let i = 0; i < 3; i += 1) {
      await h.broker.control(call(undefined, "navigate", {}, "act"), ctx()).catch(() => undefined);
    }
    h.custody.bindAtOnce = false;
    h.custody.next.push("page-e", "page-f");
    h.state.reply = async (c) => {
      const policy = h.pages["page-b"].policy;
      if (c.action !== "click" || policy === null) return ok({});
      for (const url of ["https://p1.test/", "https://p2.test/"]) {
        if (policy.decide(url) === "allow") policy.open(url);
      }
      return ok({});
    };
    await h.broker.control(call("page-b", "click", {}, "act"), ctx());
    await vi.waitFor(() => expect(h.maker.make).toHaveBeenCalledTimes(5));
  });

  it("the client's close of the pane its own call holds: the call answers as its engine did, then the pane closes", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    await h.broker.control(call(undefined, "navigate", {}, "act"), ctx()).catch(() => undefined);
    h.state.reply = async (c) => {
      if (c.action === "click") await h.broker.closeMade("run-1", "page-e");
      return ok({ clicked: true });
    };
    expect(await h.broker.control(call("page-e", "click", {}, "act"), ctx())).toEqual({
      status: "done",
      output: { success: true, data: { clicked: true } },
      closed: ["page-e"],
    });
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-e");
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
  });

  it("a cancel while the run form's pane is waited for: the pane closes, and the call answers TIMEOUT cancelled", async () => {
    const h = harness();
    h.custody.bindAtOnce = false;
    h.custody.next.push("page-e");
    const abort = new AbortController();
    const asked = h.broker.control(call(undefined, "navigate", {}, "act"), {
      signal: abort.signal,
      deadlineAt: Date.now() + 5_000,
    });
    await vi.waitFor(() => expect(h.maker.make).toHaveBeenCalledTimes(1));
    abort.abort();
    expect(await failure(asked)).toEqual({ kind: "TIMEOUT", state: "cancelled" });
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
    expect(h.engines.ensure).not.toHaveBeenCalled();
  });

  it("a page that throws on taking the policy: the call fails, the run's next call goes, and the policy is off", async () => {
    const h = harness();
    const faulty = new FakePage();
    faulty.popups = (policy) => {
      faulty.policy = policy;
      if (policy !== null) throw new Error("a page's fault");
    };
    h.bindings.set("page-c", { producerEpoch: 1, controlBindingRevision: 1, page: faulty });
    const failed = await h.broker.control(call("page-c", "click", {}, "act"), ctx()).then(
      () => "answered",
      (error: unknown) => (error instanceof Error ? error.message : "thrown"),
    );
    expect(failed).toBe("a page's fault");
    expect(faulty.policy).toBeNull();
    expect(await h.broker.control(call("page-c", "snapshot"), ctx())).toMatchObject({
      status: "done",
    });
  });

  it("a hold on the page a remake made ends the window's policy there", async () => {
    const h = harness();
    const remade = new FakePage();
    let during: PagesPopups | null = null;
    let after = "";
    h.state.reply = async (c) => {
      if (c.action !== "click") return ok({});
      h.bindings.set("page-a", { producerEpoch: 1, controlBindingRevision: 2, page: remade });
      for (let i = 0; i < 100 && remade.policy === null; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      during = remade.policy;
      remade.hand(true);
      after = during?.decide("https://p.test/") ?? "none";
      return ok({});
    };
    await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    expect(during).not.toBeNull();
    expect(remade.policy).toBeNull();
    expect(after).toBe("deny");
  });

  it("a pop-up custody makes no page for is counted noWindow; one whose make throws is said, and counted nowhere", async () => {
    const h = harness();
    h.custody.refused = "no-window";
    opensPopup(h);
    const first = await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    await vi.waitFor(() => expect(h.maker.make).toHaveBeenCalledTimes(1));
    const second = await h.broker.control(call("page-a", "snapshot"), ctx());
    const fixture: { capped?: unknown } = JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "../../contracts/fixtures/shell-surfaces-control-result.capped-no-window.json",
        ),
        "utf8",
      ),
    );
    expect({ ...first.capped, ...second.capped }).toEqual(fixture.capped);
    // the bridge refuses the pop-up's grant: a fault, not a refusal
    h.custody.refused = null;
    h.custody.next.push("page-b");
    h.state.refuseGrant = true;
    const third = await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    await vi.waitFor(() =>
      expect(h.warned).toContainEqual({
        event: "pages.broker.popup_failed",
        fields: { kind: "PRECONDITION_FAILED" },
      }),
    );
    const fourth = await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(third).not.toHaveProperty("capped");
    expect(fourth).not.toHaveProperty("capped");
  });

  it("a pane custody refuses leaves no run behind: a rebind from that run is refused", async () => {
    const h = harness();
    h.custody.room = false;
    await h.broker
      .control(call(undefined, "navigate", {}, "act", "run-9"), ctx())
      .catch(() => undefined);
    const rebind = call(undefined, "rebind", { from: "run-9" }, "read", "run-10");
    expect(await failure(h.broker.control(rebind, ctx()))).toEqual({
      kind: "PRECONDITION_FAILED",
      state: "rebind-refused",
    });
  });

  it("custody refuses a rebind: the run's made panes close as the old run's, named on the answer, and it is said", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    await h.broker.control(call(undefined, "navigate", {}, "act"), ctx()).catch(() => undefined);
    h.panes.runRebound.mockReturnValueOnce(false);
    const rebound = await h.broker
      .control(call(undefined, "rebind", { from: "run-1" }, "read", "run-2"), ctx())
      .catch((error: unknown) => error);
    expect(rebound).toMatchObject({ closed: ["page-e"] });
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
    expect(h.warned).toContainEqual({
      event: "pages.broker.rebind_refused",
      fields: { run: "run-2" },
    });
    const tabs = await h.broker.control(call(undefined, "tab_list", {}, "read", "run-2"), ctx());
    expect(tabs).toMatchObject({ output: { data: { tabs: [] } } });
  });

  it("a rebind onto its own key is refused before custody is asked: nothing closes, and nothing is said", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    await h.broker.control(call(undefined, "navigate", {}, "act"), ctx()).catch(() => undefined);
    const same = await h.broker
      .control(call(undefined, "rebind", { from: "run-1" }), ctx())
      .catch((error: unknown) => error);
    expect(same).toMatchObject({ kind: "PRECONDITION_FAILED", state: "rebind-refused" });
    expect(h.panes.runRebound).not.toHaveBeenCalled();
    expect(h.panes.pageClosed).not.toHaveBeenCalled();
    expect(h.warned).toEqual([]);
  });
});

describe("a run's own panes, at its edges (EY-1 7b, row 4)", () => {
  it("the run form's open for a run custody has ended says the run's browser has stopped, never that no window is open", async () => {
    // EY-1 (2026-11-24, an ended run's open): custody refuses a make for a run it has ended, and that refusal was
    // answered as no-window, which sends the person after a window that is open
    const h = harness();
    h.custody.refused = "run-ended";
    const open = call(undefined, "navigate", { url: "https://x.test/" }, "act");
    expect(await failure(h.broker.control(open, ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "engine-stopped",
    });
    expect(h.warned).toEqual([
      { event: "pages.broker.run_ended_refused", fields: { run: "run-1" } },
    ]);
    expect(h.sent).toEqual([]);
    expect(h.engines.ensure).not.toHaveBeenCalled();
    // a tab and a pop-up of such a run have the bridge's and the count's own words: no window took the page
    const answers: unknown[] = [];
    h.state.reply = async (c) => {
      if (c.action !== "click") return ok({});
      answers.push(
        await h.broker.make({ runKey: "run-1", callId: "call-1", url: "https://e.test/" }),
      );
      const policy = h.pages["page-a"].policy;
      if (policy?.decide("https://p.test/") === "allow") policy.open("https://p.test/");
      return ok({});
    };
    const click = call("page-a", "click", { selector: "@e1" }, "act");
    const clicked = await h.broker.control(click, ctx());
    expect(answers).toEqual([{ ok: false, refused: "no-window" }]);
    await vi.waitFor(() => expect(h.maker.make).toHaveBeenCalledTimes(3));
    // counted on the run's next answer, whichever that is: the click's own, or the one after
    const listed = await h.broker.control(call(undefined, "tab_list"), ctx());
    expect([clicked, listed].map((answer) => answer.capped).filter(Boolean)).toEqual([
      { noWindow: 1 },
    ]);
  });

  it("a run-form open while the run's end tears down is refused as its browser stopped, and custody is not asked", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    const held = deferred<void>();
    h.engines.stop.mockImplementationOnce(async () => {
      await held.promise;
    });
    const ending = h.broker.control(call(undefined, "close"), ctx());
    await vi.waitFor(() => expect(h.engines.stop).toHaveBeenCalled());
    h.custody.next.push("page-e");
    const open = await h.broker
      .control(call(undefined, "navigate", {}, "act"), ctx())
      .catch((error: unknown) => error);
    expect(open).toMatchObject({ kind: "UNAVAILABLE", state: "engine-stopped" });
    expect(h.maker.make).not.toHaveBeenCalled();
    held.resolve();
    await ending;
  });

  it("a throw on the way out of a call still closes the pane its client closed under it", async () => {
    const h = harness();
    const faulty = new FakePage();
    faulty.popups = (policy) => {
      faulty.policy = policy;
      if (policy === null) return;
      // the client closes the pane, then its page throws on taking the policy
      void h.broker.closeMade("run-1", "page-e");
      throw new Error("a page's fault");
    };
    h.bindings.set("page-e", { producerEpoch: 1, controlBindingRevision: 1, page: faulty });
    h.custody.next.push("page-e");
    const opened = await h.broker.control(call(undefined, "navigate", {}, "act"), ctx()).then(
      () => "answered",
      (error: unknown) => (error instanceof Error ? error.message : "thrown"),
    );
    expect(opened).toBe("a page's fault");
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-e");
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
  });

  it("a remade page already held takes no policy, and one that throws on taking it ends the window's policy", async () => {
    const h = harness();
    const holding = new FakePage();
    holding.held = true;
    let first = null as PagesPopups | null;
    h.state.reply = async (c) => {
      if (c.action !== "click") return ok({});
      first = h.pages["page-a"].policy;
      h.bindings.set("page-a", { producerEpoch: 1, controlBindingRevision: 2, page: holding });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return ok({});
    };
    await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    expect(first).not.toBeNull();
    expect(holding.policy).toBeNull();
    expect(first?.decide("https://p.test/")).toBe("deny");
    const faulty = new FakePage();
    faulty.popups = (policy) => {
      if (policy !== null) throw new Error("a page's fault");
    };
    let second = null as PagesPopups | null;
    h.state.reply = async (c) => {
      if (c.action !== "click") return ok({});
      second = h.pages["page-c"].policy;
      h.bindings.set("page-c", { producerEpoch: 1, controlBindingRevision: 2, page: faulty });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return ok({});
    };
    expect(await h.broker.control(call("page-c", "click", {}, "act"), ctx())).toMatchObject({
      status: "done",
    });
    expect(second).not.toBeNull();
    expect(second?.decide("https://p.test/")).toBe("deny");
  });

  it("an ordinary rebind of a run that made no pane says nothing, though custody, holding no record of it, refuses", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    h.panes.runRebound.mockReturnValueOnce(false);
    const rebind = call(undefined, "rebind", { from: "run-1" }, "read", "run-2");
    expect(await h.broker.control(rebind, ctx())).toEqual({
      status: "done",
      output: { success: true },
    });
    expect(h.warned).toEqual([]);
    const tabs = await h.broker.control(call(undefined, "tab_list", {}, "read", "run-2"), ctx());
    expect(tabs).toMatchObject({ output: { data: { tabs: [{ surfaceId: "page-a" }] } } });
  });
});

describe("the engine's tab list", () => {
  it("names the active tab's target id, or none", () => {
    const tabs = [
      { targetId: "X", active: false },
      { targetId: "Y", active: true },
    ];
    expect(activeTargetOf({ tabs })).toBe("Y");
    expect(activeTargetOf({ tabs: [] })).toBeNull();
    expect(activeTargetOf(null)).toBeNull();
    expect(activeTargetOf({ tabs: "no" })).toBeNull();
  });
});

// EY-1 (S1, 2026-11-24): custody's adopt grace ends a made page nobody adopted. A page its run was told of is the
// run's to use, so the broker says each made pane to custody as an answer names it, and custody holds it for its run.
describe("a made pane the run was told of (EY-1 S1)", () => {
  it("is said to custody as an answer names it: the run form's with its own answer, a pop-up's with the run's next", async () => {
    const h = harness();
    h.custody.next.push("page-e", "page-f");
    const opened = await h.broker.control(
      call(undefined, "navigate", { url: "https://x.test/" }, "act"),
      ctx(),
    );
    expect(opened).toMatchObject({ made: [{ surfaceId: "page-e", by: "open" }] });
    expect(h.maker.named.mock.calls).toEqual([["run-1", "page-e"]]);
    // a pop-up's pane bound after its call answered: custody hears of it with the run's next answer, not before
    h.custody.bindAtOnce = false;
    h.state.reply = async (c) => {
      const policy = h.pages["page-e"].policy;
      if (c.action === "click" && policy !== null && policy.decide("https://p.test/") === "allow") {
        policy.open("https://p.test/");
      }
      return ok({});
    };
    const click = await h.broker.control(call("page-e", "click", {}, "act"), ctx());
    expect(click).not.toHaveProperty("made");
    h.bind("page-f");
    await vi.waitFor(() =>
      expect(h.bridge.grant).toHaveBeenCalledWith("run-1", "page-f", expect.anything()),
    );
    expect(h.maker.named).toHaveBeenCalledTimes(1);
    const next = await h.broker.control(call(undefined, "tab_list"), ctx());
    expect(next).toMatchObject({ made: [{ surfaceId: "page-f", by: "popup" }] });
    expect(h.maker.named.mock.calls).toEqual([
      ["run-1", "page-e"],
      ["run-1", "page-f"],
    ]);
  });

  it("is not said while its call threw: the pane is owed, and said with the answer that names it", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    h.state.unavailable = "engine-refused";
    expect(await failure(h.broker.control(call(undefined, "navigate", {}, "act"), ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "engine-refused",
    });
    expect(h.maker.make).toHaveBeenCalledTimes(1);
    expect(h.maker.named).not.toHaveBeenCalled();
    h.state.unavailable = null;
    const next = await h.broker.control(call(undefined, "tab_list"), ctx());
    expect(next).toMatchObject({ made: [{ surfaceId: "page-e", by: "open" }] });
    expect(h.maker.named.mock.calls).toEqual([["run-1", "page-e"]]);
  });
});

// EY-1 (S1, 2026-11-24): with the start, a pane is granted and owed to its run's next answer before any window has
// it, and custody's grace can end it before that answer comes. The run is never told of a page that is gone: its owed
// word goes with it, and a pop-up's is counted as one no window took in time.
describe("a made pane custody let go before any answer named it (EY-1 S1)", () => {
  /** The fake custody's page is gone, as its grace leaves it: no record, no binding. */
  const graced = (h: ReturnType<typeof harness>, surfaceId: "page-b" | "page-e"): void => {
    h.made.delete(surfaceId);
    h.bindings.delete(surfaceId);
    h.broker.madeGone("run-1", surfaceId, "grace");
  };

  it("the run form's pane whose call threw: never named, said to custody by nobody, and counted nowhere", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    h.state.unavailable = "engine-refused";
    await failure(h.broker.control(call(undefined, "navigate", {}, "act"), ctx()));
    h.state.unavailable = null;
    graced(h, "page-e");
    const next = await h.broker.control(call(undefined, "tab_list"), ctx());
    expect(next).toEqual({
      status: "done",
      output: { success: true, data: { tabs: [], current: null } },
    });
    expect(h.maker.named).not.toHaveBeenCalled();
  });

  it("a pop-up's pane: never named, and counted noWindow on the run's next answer", async () => {
    const h = harness();
    h.custody.next.push("page-b");
    // its page is bound after its call answered, so the pane is owed to the run's next answer
    h.custody.bindAtOnce = false;
    h.state.reply = async (c) => {
      const policy = h.pages["page-a"].policy;
      if (c.action === "click" && policy !== null && policy.decide("https://p.test/") === "allow") {
        policy.open("https://p.test/");
      }
      return ok({});
    };
    const click = await h.broker.control(call("page-a", "click", {}, "act"), ctx());
    expect(click).not.toHaveProperty("made");
    h.bind("page-b");
    await vi.waitFor(() =>
      expect(h.bridge.grant).toHaveBeenCalledWith("run-1", "page-b", expect.anything()),
    );
    // the run made no call for longer than the grace
    graced(h, "page-b");
    h.state.reply = async () => ok({ snapshot: "ok" });
    const next = await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(next).not.toHaveProperty("made");
    expect(next).toMatchObject({ capped: { noWindow: 1 } });
    expect(h.maker.named).not.toHaveBeenCalled();
  });
});

// EY-1 (2026-11-24, the engine off the bridge): the bridge is the wall, so an engine that is no longer on it at the
// epoch its launch armed gets no command and gives no answer. Whatever the engine is joined to instead, the run's
// call answers UNAVAILABLE engine-starting, and the next call starts and launches another.
// Errata (2026-11-24, an act the engine may have done): that word asks for another try, and two rows here held it for
// an act whose own command the engine already had. Such an act answers UNAVAILABLE no-answer: it may have happened.
// A read, and an act whose command never went, keep engine-starting.
describe("the run's engine, off the bridge or gone", () => {
  const launches = (h: ReturnType<typeof harness>) => h.sent.filter((c) => c.action === "launch");
  const starting = { kind: "UNAVAILABLE", state: "engine-starting" };
  const noAnswer = { kind: "UNAVAILABLE", state: "no-answer" };

  it("asks whether the engine is on the bridge, at the epoch its launch armed, before each command it sends", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    // the list, the switch and the command: each asked first
    expect(h.link.liveAt.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(h.link.liveAt.mock.calls.every(([run, epoch]) => run === "run-1" && epoch === 1)).toBe(
      true,
    );
  });

  it("sends nothing to an engine that is off the bridge: the call fails, the route is revoked, the engine replaced, and the next call launches afresh", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    h.sent.length = 0;
    h.state.offBridge = true;
    const fill = call("page-a", "fill", { selector: "@e1", value: "typed" }, "act");
    expect(await failure(h.broker.control(fill, ctx()))).toEqual(starting);
    expect(h.sent).toEqual([]);
    expect(h.windows.opened.size).toBe(0);
    expect(h.bridge.revokeRun).toHaveBeenCalledWith("run-1");
    expect(h.engines.replace).toHaveBeenCalledWith("run-1");
    h.state.offBridge = false;
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toMatchObject({
      status: "done",
    });
    expect(launches(h)).toHaveLength(1);
    expect(h.bridge.arm).toHaveBeenCalledTimes(2);
    expect(h.link.liveAt).toHaveBeenLastCalledWith("run-1", 2);
  });

  it("answers the call in flight at the bridge's word that the run's connection closed: never done, whatever the engine then says, and an act the engine had is no-answer", async () => {
    const h = harness();
    const reply = deferred<PagesDaemonExchange>();
    h.state.reply = (c) => (c.action === "fill" ? reply.promise : ok({}));
    const fill = call("page-a", "fill", { selector: "@e1", value: "typed" }, "act");
    const answer = failure(h.broker.control(fill, ctx()));
    await vi.waitFor(() => expect(h.sent.at(-1)?.action).toBe("fill"));
    h.state.offBridge = true;
    h.broker.bridgeClosed("run-1");
    // the engine had the fill: it may have typed, so the word is never one that asks for it again
    expect(await answer).toEqual(noAnswer);
    expect(h.windows.opened.size).toBe(0);
    expect(h.engines.replace).toHaveBeenCalledWith("run-1");
    expect(h.bridge.revokeRun).toHaveBeenCalledWith("run-1");
    // what the engine answers after is nobody's
    reply.resolve(ok({ from: "elsewhere" }));
    h.state.offBridge = false;
    h.state.reply = () => ok({ snapshot: "ok" });
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toEqual({
      status: "done",
      output: { success: true, data: { snapshot: "ok" } },
    });
    expect(launches(h)).toHaveLength(2);
  });

  it("a connection that closes while the engine's own still stands changes nothing", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    // an older route's socket, closing late
    h.broker.bridgeClosed("run-1");
    h.broker.bridgeClosed("run-9");
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(h.engines.replace).not.toHaveBeenCalled();
    expect(h.bridge.revokeRun).not.toHaveBeenCalled();
    expect(launches(h)).toHaveLength(1);
  });

  it("never answers done with what an engine said after it left the bridge: an act is no-answer, a read engine-starting", async () => {
    const h = harness();
    h.state.reply = (c) => {
      if (c.action === "evaluate") h.state.offBridge = true;
      return ok({ result: "from elsewhere" });
    };
    const evaluate = call("page-a", "evaluate", { script: "1" }, "act");
    expect(await failure(h.broker.control(evaluate, ctx()))).toEqual(noAnswer);
    expect(h.engines.replace).toHaveBeenCalledWith("run-1");
    // the same in a read window: nothing a read asks changes the page, so another try is the right word
    h.state.offBridge = false;
    const read = call("page-a", "evaluate", { script: "1" });
    expect(await failure(h.broker.control(read, ctx()))).toEqual(starting);
  });

  it("a read in flight at the bridge's word that the connection closed still hears engine-starting", async () => {
    const h = harness();
    const reply = deferred<PagesDaemonExchange>();
    h.state.reply = (c) => (c.action === "gettext" ? reply.promise : ok({}));
    const answer = failure(h.broker.control(call("page-a", "gettext", { selector: "@e1" }), ctx()));
    await vi.waitFor(() => expect(h.sent.at(-1)?.action).toBe("gettext"));
    h.state.offBridge = true;
    h.broker.bridgeClosed("run-1");
    expect(await answer).toEqual(starting);
    reply.resolve(ok({}));
  });

  it("an act in flight at its engine's exit is no-answer: the engine had the command, and may have done it", async () => {
    const h = harness();
    const reply = deferred<PagesDaemonExchange>();
    h.state.reply = (c) => (c.action === "click" ? reply.promise : ok({}));
    const click = call("page-a", "click", { selector: "@e1" }, "act");
    const answer = failure(h.broker.control(click, ctx()));
    await vi.waitFor(() => expect(h.sent.at(-1)?.action).toBe("click"));
    h.exited("run-1", 1);
    expect(await answer).toEqual(noAnswer);
    expect(h.windows.opened.size).toBe(0);
    reply.resolve({ ok: false, failure: "outcome-unknown" });
  });

  it("an act whose own command never reached the engine hears engine-starting, and the command is never sent", async () => {
    // the engine's list is slow, and the bridge's word comes while the broker waits for it
    const list = deferred<PagesDaemonExchange>();
    const sent: string[] = [];
    const h = harness({
      deps: {
        exchange: async (_path, command) => {
          sent.push(command.action);
          if (command.action === "launch") return ok({ launched: true });
          if (command.action === "tab_list") return list.promise;
          return ok({});
        },
      },
    });
    const click = call("page-a", "click", { selector: "@e1" }, "act");
    const answer = failure(h.broker.control(click, ctx()));
    await vi.waitFor(() => expect(sent.at(-1)).toBe("tab_list"));
    h.state.offBridge = true;
    h.broker.bridgeClosed("run-1");
    expect(await answer).toEqual(starting);
    list.resolve(ok({ tabs: [{ tabId: "t1", targetId: TARGET["page-a"], active: true }] }));
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toEqual(["launch", "tab_list"]);
  });

  it("an engine's exit answers the call in flight, and the next call launches again though its engine's generation is the old number", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    const reply = deferred<PagesDaemonExchange>();
    h.state.reply = () => reply.promise;
    const answer = failure(h.broker.control(call("page-a", "gettext", { selector: "@e1" }), ctx()));
    await vi.waitFor(() => expect(h.sent.at(-1)?.action).toBe("gettext"));
    h.exited("run-1", 1);
    expect(await answer).toEqual(starting);
    reply.resolve({ ok: false, failure: "outcome-unknown" });
    // the exit is the supervisor's to count: the broker neither stops nor replaces an engine that is gone
    expect(h.engines.stop).not.toHaveBeenCalled();
    expect(h.engines.replace).not.toHaveBeenCalled();
    // another run's exit, and an older generation's, are not this engine's
    h.state.reply = () => ok({});
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(launches(h)).toHaveLength(2);
    h.exited("run-9", 2);
    h.state.up = true;
    h.exited("run-1", 1);
    h.state.up = true;
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(launches(h)).toHaveLength(2);
    // the supervisor's next engine has the number of the one launched before: it is launched all the same
    h.exited("run-1", 2);
    h.state.generation = 1;
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(launches(h)).toHaveLength(3);
    await h.broker.stop("quit");
    expect(h.engines.onExit).toHaveBeenCalledTimes(1);
  });

  it("a launch that fails leaves nothing launched: the next engine is launched though its generation is one launched before", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    // that engine ends unseen, and its successor's launch fails: the broker stops it, and the supervisor forgets
    h.state.up = false;
    h.state.launch = { ok: true, reply: { success: false, error: "no" } };
    expect(await failure(h.broker.control(call("page-a", "snapshot"), ctx()))).toEqual(starting);
    h.state.launch = null;
    h.state.generation = 0;
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(launches(h)).toHaveLength(3);
  });

  it("replaces an engine that leaves PAGES_HUNG_CALLS calls in a row unanswered; an answer between them starts the count again", async () => {
    const h = harness();
    const unanswered = (): PagesDaemonExchange => ({
      ok: false,
      failure: "timeout",
      written: true,
    });
    const timedOut = { kind: "TIMEOUT", state: "deadline" };
    await h.broker.control(call("page-a", "snapshot"), ctx());
    for (let i = 1; i < PAGES_HUNG_CALLS; i += 1) {
      h.state.reply = unanswered;
      expect(await failure(h.broker.control(call("page-a", "snapshot"), ctx()))).toEqual(timedOut);
    }
    h.state.reply = () => ok({});
    await h.broker.control(call("page-a", "snapshot"), ctx());
    h.state.reply = unanswered;
    for (let i = 1; i < PAGES_HUNG_CALLS; i += 1) {
      expect(await failure(h.broker.control(call("page-a", "snapshot"), ctx()))).toEqual(timedOut);
    }
    expect(h.engines.replace).not.toHaveBeenCalled();
    expect(await failure(h.broker.control(call("page-a", "snapshot"), ctx()))).toEqual(timedOut);
    expect(h.engines.replace).toHaveBeenCalledWith("run-1");
    expect(h.bridge.revokeRun).toHaveBeenCalledWith("run-1");
    h.state.reply = () => ok({});
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toMatchObject({
      status: "done",
    });
    expect(launches(h)).toHaveLength(2);
  });
});

// EY-1 (2026-11-24, a tab's window and the run form's tab): BU-19 rules that a page a call makes shares that call's
// window until the call ends. Nothing called the windows' adopt, so a tab its engine made had no window while the
// engine set it up, and every command on it was refused. And the run form's tab_new made a pane to carry the
// engine's own tab_new, which made a second: two panes, and the blank one answered.
describe("a page a call makes shares that call's window; the run form's tab is one pane", () => {
  it("a tab made inside an act window has that call's window before its make answers, and loses it with the call", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    let during: CallWindow | undefined;
    h.state.reply = async (c) => {
      if (c.action !== "click") return ok({});
      await h.broker.make({ runKey: "run-1", callId: "call-1", url: "https://e.test/" });
      during = h.windows.opened.get("page-e");
      return ok({ clicked: true });
    };
    await h.broker.control(call("page-a", "click", { selector: "@e1" }, "act"), ctx());
    expect(during).toMatchObject({
      pageId: "page-e",
      callId: "call-1",
      kind: "act",
      madeBy: "page-a",
    });
    expect(h.events.filter((e) => e.startsWith("adopt"))).toEqual(["adopt page-e page-a"]);
    // the call's end closes every window of the call: the page it was sent on, and the one it made
    expect(h.windows.opened.size).toBe(0);
    expect(h.windows.closed.map((w) => w.pageId).sort()).toEqual(["page-a", "page-e"]);
  });

  it("a pop-up made while its act window stands shares it; one made after the call ended has none, and is the run's all the same", async () => {
    const h = harness();
    h.custody.next.push("page-e", "page-f");
    h.custody.bindAtOnce = false;
    let during: CallWindow | undefined;
    h.state.reply = async (c) => {
      const policy = h.pages["page-a"].policy;
      if (c.action !== "click" || policy === null) return ok({});
      // the first is bound, and made, while the call stands; the second's page comes after it
      for (const url of ["https://p.test/", "https://q.test/"]) {
        if (policy.decide(url) === "allow") policy.open(url);
      }
      h.bind("page-e");
      await vi.waitFor(() => expect(h.windows.leases.has("page-e")).toBe(true));
      during = h.windows.opened.get("page-e");
      return ok({});
    };
    await h.broker.control(call("page-a", "click", { selector: "@e1" }, "act"), ctx());
    expect(during).toMatchObject({ pageId: "page-e", callId: "call-1", madeBy: "page-a" });
    expect(h.windows.opened.size).toBe(0);
    h.bind("page-f");
    await vi.waitFor(() => expect(h.windows.leases.has("page-f")).toBe(true));
    expect(h.events).toContain("adopt page-f page-a");
    expect(h.windows.opened.has("page-f")).toBe(false);
    const next = await h.broker.control(call("page-f", "snapshot"), ctx());
    expect(next).toMatchObject({ status: "done" });
  });

  it("the run form's tab_new makes ONE pane, at its address, by tab, answered by main: the engine is asked nothing", async () => {
    const h = harness();
    h.custody.next.push("page-e", "page-f");
    const tab = (extra: Readonly<Record<string, unknown>>) =>
      h.broker.control(call(undefined, "tab_new", extra, "act"), ctx());
    expect(await tab({ url: "https://x.test/", label: "docs" })).toEqual({
      status: "done",
      output: { success: true },
      made: [{ surfaceId: "page-e", url: "https://x.test/", by: "tab" }],
    });
    expect(h.maker.make).toHaveBeenCalledTimes(1);
    expect(h.maker.make).toHaveBeenCalledWith({
      run: "run-1",
      url: "https://x.test/",
      by: "tab",
      logicalViewport: PAGES_MADE_VIEWPORT,
      deviceScaleFactor: PAGES_MADE_DEVICE_SCALE,
    });
    expect(h.sent).toEqual([]);
    expect(h.engines.ensure).not.toHaveBeenCalled();
    // it is the run's page from here: listed as its current one, and worked by its next call
    expect(await h.broker.control(call(undefined, "tab_list"), ctx())).toMatchObject({
      output: { data: { tabs: [{ surfaceId: "page-e" }], current: "page-e" } },
    });
    // with no address it opens blank
    expect(await tab({})).toMatchObject({
      made: [{ surfaceId: "page-f", url: "about:blank", by: "tab" }],
    });
    expect(h.sent).toEqual([]);
  });

  it("the run form's own pane is the FIRST its answer names, ahead of a pop-up's pane owed from before", async () => {
    // the room reads the first made pane of a run-form open or tab as the page the call made
    for (const action of ["tab_new", "navigate"] as const) {
      const h = harness();
      h.custody.bindAtOnce = false;
      h.custody.next.push("page-e", "page-f");
      h.state.reply = (c) => {
        const policy = h.pages["page-a"].policy;
        if (
          c.action === "click" &&
          policy !== null &&
          policy.decide("https://p.test/") === "allow"
        ) {
          policy.open("https://p.test/");
        }
        return ok({});
      };
      // a pop-up made after its click's answer left: owed to the run's next answer
      await h.broker.control(call("page-a", "click", { selector: "@e1" }, "act"), ctx());
      h.bind("page-e");
      await vi.waitFor(() => expect(h.events).toContain("adopt page-e page-a"));
      h.custody.bindAtOnce = true;
      const by = action === "tab_new" ? "tab" : "open";
      const answer = await h.broker.control(
        call(undefined, action, { url: "https://x.test/" }, "act"),
        ctx(),
      );
      expect(answer.made, action).toEqual([
        { surfaceId: "page-f", url: "https://x.test/", by },
        { surfaceId: "page-e", url: "https://p.test/", by: "popup" },
      ]);
    }
  });

  it("the run form's tab_new is refused by why, and nothing is made: its address, the run's cap, the desk, no window", async () => {
    const h = harness();
    const tab = (url: string) =>
      failure(h.broker.control(call(undefined, "tab_new", { url }, "act"), ctx()));
    expect(await tab("javascript:alert(1)")).toEqual({
      kind: "PRECONDITION_FAILED",
      state: "address",
    });
    h.custody.refused = "desk-full";
    expect(await tab("https://x.test/")).toEqual({
      kind: "RESOURCE_EXHAUSTED",
      state: "desk-full",
    });
    h.custody.refused = "no-window";
    expect(await tab("https://x.test/")).toEqual({ kind: "UNAVAILABLE", state: "no-window" });
    h.custody.refused = null;
    h.custody.next.push("page-b", "page-c", "page-d", "page-e", "page-f");
    for (let i = 0; i < PAGES_RUN_PANES_MAX; i += 1) {
      await h.broker.control(call(undefined, "tab_new", {}, "act"), ctx());
    }
    expect(await tab("https://x.test/")).toEqual({ kind: "RESOURCE_EXHAUSTED", state: "run-full" });
    expect(h.sent).toEqual([]);
  });
});

// EY-1 (2026-11-24, a fieldd that was replaced): a run is of the fieldd that named it, and main ends its runs when a
// fieldd with another boot identity attaches. Custody ends the runs it holds; a run that made no page is the
// broker's alone (its grants, its route, its engine), and nothing ended it until the app quit.
describe("every run the broker holds is ended at once, whoever else held it", () => {
  /** The broker's own end of every run, as main asks it beside custody's. */
  const endEveryRun = (h: ReturnType<typeof harness>, ms = 2_000) =>
    h.broker.endEveryRun(Date.now() + ms);

  it("ends a run that made no page and one that did: grants, route, engine, its made page, custody told; nothing is owed after, and the same run id starts afresh", async () => {
    const h = harness();
    // run-1 works a page it was handed: custody holds no record of the run
    await h.broker.control(call("page-a", "snapshot"), ctx());
    await h.broker.control(call("page-b", "snapshot", {}, "read", "run-2"), ctx());
    h.custody.next.push("page-e");
    await h.broker.control(
      call(undefined, "tab_new", { url: "https://x.test/" }, "act", "run-2"),
      ctx(),
    );
    expect(await endEveryRun(h)).toEqual({ runs: 2, unended: 0 });
    for (const run of ["run-1", "run-2"]) {
      expect(h.bridge.revokeRun).toHaveBeenCalledWith(run);
      expect(h.engines.stop).toHaveBeenCalledWith(run);
      expect(h.maker.runEnded).toHaveBeenCalledWith(run);
    }
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-a");
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-2", "page-b");
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-2", "page-e");
    // the fieldd that would have heard what the runs were owed is gone: a run named again is owed nothing
    expect(await h.broker.control(call(undefined, "tab_list"), ctx())).toEqual({
      status: "done",
      output: { success: true, data: { tabs: [], current: null } },
    });
    // and it is a new run: granted and launched afresh
    const grants = h.bridge.grant.mock.calls.length;
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toMatchObject({
      status: "done",
    });
    expect(h.bridge.grant).toHaveBeenCalledTimes(grants + 1);
    // with no run held there is nothing to end
    const h2 = harness();
    expect(await endEveryRun(h2)).toEqual({ runs: 0, unended: 0 });
  });

  it("a run with a call in flight ends once that call has its answer; one whose turn does not come in time is said unended, and the others still end", async () => {
    const h = harness();
    const slow = deferred<PagesDaemonExchange>();
    h.state.reply = (c) => (c.action === "click" ? slow.promise : ok({}));
    await h.broker.control(call("page-b", "snapshot", {}, "read", "run-2"), ctx());
    const inFlight = h.broker.control(call("page-a", "click", {}, "act"), ctx());
    await vi.waitFor(() => expect(h.sent.at(-1)?.action).toBe("click"));
    // run-1's engine holds a command past the bound: its end is not forced under the call
    expect(await endEveryRun(h, 40)).toEqual({ runs: 2, unended: 1 });
    expect(h.engines.stop).toHaveBeenCalledWith("run-2");
    expect(h.engines.stop).not.toHaveBeenCalledWith("run-1");
    slow.resolve(ok({}));
    await inFlight;
    // asked again once the call has its answer, the run ends
    expect(await endEveryRun(h)).toEqual({ runs: 1, unended: 0 });
    expect(h.engines.stop).toHaveBeenCalledWith("run-1");
  });
});

// EY-1 (2026-11-24, a run's own page that answers parked or gone). Three findings met in one place, the answer a
// call gets when its page has no binding or its lease moved:
// - a made page whose grant ended there was in neither the run's grants nor its moved set, so a rebind closed it as
//   a page still waited for, the run's list left it out, and a run's end did not name it;
// - a made page whose producer is gone for good went on counting against its run, with nothing to end it once
//   fieldd's room forgot it (the room forgets a page at its second gone running);
// - whether a page was the run's own was read from custody's record alone, which custody drops without a word when
//   the window that adopted the page lets it go: such a page was then answered as one a person had handed.
describe("a run's own page that answers parked or gone", () => {
  const tabNew = (h: ReturnType<typeof harness>, run = "run-1") =>
    h.broker.control(call(undefined, "tab_new", { url: "https://x.test/" }, "act", run), ctx());
  const listed = async (h: ReturnType<typeof harness>, run = "run-1") => {
    const answer = await h.broker.control(call(undefined, "tab_list", {}, "read", run), ctx());
    const output = (answer.status === "done" ? answer.output : undefined) as
      | { data?: { tabs?: { surfaceId: string }[] } }
      | undefined;
    return (output?.data?.tabs ?? []).map((tab) => tab.surfaceId);
  };
  const GONE = { status: "refused", fact: "gone" };

  it("a made page at rest is still the run's: its list names it, a rebind carries it, and custody is not asked to close it", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    expect(await tabNew(h)).toMatchObject({ made: [{ surfaceId: "page-e" }] });
    // the desk rests the page: no binding, its producer at rest
    h.bindings.delete("page-e");
    h.parked.add("page-e");
    expect(await h.broker.control(call("page-e", "snapshot"), ctx())).toEqual({
      status: "refused",
      fact: "parked",
    });
    expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-e");
    expect(await listed(h)).toEqual(["page-e"]);
    const rebind = call(undefined, "rebind", { from: "run-1" }, "read", "run-2");
    expect(await h.broker.control(rebind, ctx())).toEqual({
      status: "done",
      output: { success: true },
    });
    expect(h.panes.pageClosed).not.toHaveBeenCalled();
    expect(await listed(h, "run-2")).toEqual(["page-e"]);
    // woken, the new run's first call on it grants it afresh
    h.parked.delete("page-e");
    h.bind("page-e");
    expect(
      await h.broker.control(call("page-e", "snapshot", {}, "read", "run-2"), ctx()),
    ).toMatchObject({ status: "done" });
    expect(h.bridge.grant).toHaveBeenLastCalledWith("run-2", "page-e", expect.anything());
  });

  it("a made page at rest when its run ends is closed and named in closed", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    await tabNew(h);
    h.bindings.delete("page-e");
    h.parked.add("page-e");
    await h.broker.control(call("page-e", "snapshot"), ctx());
    expect(await h.broker.control(call(undefined, "close"), ctx())).toEqual({
      status: "done",
      output: { success: true },
      closed: ["page-e"],
    });
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
  });

  it("a made page whose lease moved (the desk woke it) answers gone once and is kept: listed, then granted afresh", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    await tabNew(h);
    const page = h.pages["page-e"];
    h.bindings.set("page-e", { producerEpoch: 2, controlBindingRevision: 2, page });
    expect(await h.broker.control(call("page-e", "snapshot"), ctx())).toEqual(GONE);
    expect(h.panes.pageClosed).not.toHaveBeenCalled();
    expect(await listed(h)).toEqual(["page-e"]);
    expect(await h.broker.control(call("page-e", "snapshot"), ctx())).toMatchObject({
      status: "done",
    });
  });

  it("a made page with no binding and not at rest is kept at its first gone, and closed for its run at the second running", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    await tabNew(h);
    // its producer failed: custody still holds the page, and no window binds it
    h.bindings.delete("page-e");
    h.kept.add("page-e");
    expect(await h.broker.control(call("page-e", "snapshot"), ctx())).toEqual(GONE);
    expect(h.panes.pageClosed).not.toHaveBeenCalled();
    expect(await listed(h)).toEqual(["page-e"]);
    // the room forgets a page at its second gone running: main closes it then, and says so
    expect(await h.broker.control(call("page-e", "snapshot"), ctx())).toEqual({
      ...GONE,
      closed: ["page-e"],
    });
    expect(h.panes.pageClosed).toHaveBeenCalledTimes(1);
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
    expect(await listed(h)).toEqual([]);
  });

  it("a call that is answered between two gones starts the count again: the page is not closed", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    await tabNew(h);
    h.bindings.delete("page-e");
    h.kept.add("page-e");
    expect(await h.broker.control(call("page-e", "snapshot"), ctx())).toEqual(GONE);
    // the person reloads it: bound again, and the run's call is answered
    h.bind("page-e");
    expect(await h.broker.control(call("page-e", "snapshot"), ctx())).toMatchObject({
      status: "done",
    });
    h.bindings.delete("page-e");
    expect(await h.broker.control(call("page-e", "snapshot"), ctx())).toEqual(GONE);
    expect(h.panes.pageClosed).not.toHaveBeenCalled();
  });

  it("a made page custody no longer holds (the window that adopted it let it go) answers gone and is named closed at once", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    await tabNew(h);
    // custody dropped its record without a word: nothing binds the page, and nothing says whose it was
    h.bindings.delete("page-e");
    h.made.delete("page-e");
    expect(await h.broker.control(call("page-e", "snapshot"), ctx())).toEqual({
      ...GONE,
      closed: ["page-e"],
    });
    expect(await listed(h)).toEqual([]);
  });

  it("the page form's close of a made page custody no longer holds names it in closed, never in givenBack; a client cannot give it back", async () => {
    const h = harness();
    h.custody.next.push("page-e", "page-f");
    await tabNew(h);
    await tabNew(h);
    h.made.delete("page-e");
    h.made.delete("page-f");
    // the engine's client closing the target of a page the run made: never a give-back
    expect(h.broker.giveBack("run-1", "page-e")).toEqual({ ok: false, refused: "made" });
    expect(await h.broker.control(call("page-e", "close", {}, "act"), ctx())).toEqual({
      status: "done",
      output: { success: true },
      closed: ["page-e"],
    });
    // and at the run's end
    expect(await h.broker.control(call(undefined, "close"), ctx())).toEqual({
      status: "done",
      output: { success: true },
      closed: ["page-f"],
    });
  });

  it("a page the run did not make keeps its answers: gone ends its grant and closes nothing, however often", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    h.bindings.delete("page-a");
    for (let i = 0; i < 3; i += 1) {
      expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toEqual(GONE);
    }
    expect(h.panes.pageClosed).not.toHaveBeenCalled();
    expect(await listed(h)).toEqual([]);
  });
});

// EY-1 (2026-11-24, a new page and the engine): the pinned engine keeps a page it is told of only if its first enable
// passes the wall, and its tab_switch to a page it does not hold fails. The rows on the composed plane with the
// engine's attach modelled are test/pages-tab-window.test.ts; these hold the broker's own steps on fake ports.
describe("a page the engine's own list lacks is said to it again inside the call's window", () => {
  it("says it again and lists again, at most PAGES_INTRODUCE_TRIES times, after the window opened and before any switch", async () => {
    const h = harness();
    // one connection of the run listens for targets; this fake engine's list never gains the page
    h.state.told = 1;
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toMatchObject({
      status: "done",
    });
    expect(h.bridge.introduce.mock.calls).toEqual(
      Array.from({ length: PAGES_INTRODUCE_TRIES }, () => ["run-1", "page-a"]),
    );
    expect(h.sent.map((c) => c.action)).toEqual([
      "launch",
      "tab_list",
      ...Array.from({ length: PAGES_INTRODUCE_TRIES }, () => "tab_list"),
      "tab_switch",
      "snapshot",
    ]);
    expect(h.events.indexOf("open page-a read")).toBeLessThan(h.events.indexOf("send tab_list"));
    expect(h.logged).toContainEqual({ tries: PAGES_INTRODUCE_TRIES, held: "no" });
  });

  it("a page said again is waited for before the engine is asked for its list again: its word comes on another socket, and is said once", async () => {
    const h = harness();
    h.state.told = 1;
    // the bridge's word reaches the engine on its own socket a moment after it is said, as a frame does
    h.bridge.introduce.mockImplementation((_run: string, surfaceId: string) => {
      setTimeout(() => {
        h.state.active = TARGET[surfaceId as PageName];
      }, 0);
      return h.state.told;
    });
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toMatchObject({
      status: "done",
    });
    expect(h.bridge.introduce).toHaveBeenCalledTimes(1);
    expect(h.sent.map((c) => c.action)).toEqual(["launch", "tab_list", "tab_list", "snapshot"]);
    expect(h.logged).toContainEqual({ tries: 1, held: "yes" });
  });

  it("a run with no client to tell is not waited for, and a page the engine lists is said to nobody", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(h.bridge.introduce).toHaveBeenCalledTimes(1);
    expect(h.sent.map((c) => c.action)).toEqual(["launch", "tab_list", "tab_switch", "snapshot"]);
    // the engine's active tab is the page now: listed, so nothing is said again
    await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(h.bridge.introduce).toHaveBeenCalledTimes(1);
  });

  it("an engine off the bridge is told nothing: the call answers as one whose engine is gone", async () => {
    const h = harness();
    h.state.told = 1;
    await h.broker.control(call("page-b", "snapshot"), ctx());
    // off the bridge by the time the list came back without the page
    h.link.liveAt.mockImplementation(() => h.sent.at(-1)?.action !== "tab_list");
    expect(await failure(h.broker.control(call("page-a", "snapshot"), ctx()))).toEqual({
      kind: "UNAVAILABLE",
      state: "engine-starting",
    });
    expect(h.bridge.introduce).not.toHaveBeenCalled();
  });

  it("the run form's tab_new, with the run's engine launched, goes on its new pane with one read in the call's own window; its answer is the tab's all the same", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    h.custody.next.push("page-e", "page-f");
    const sent = h.sent.length;
    expect(
      await h.broker.control(call(undefined, "tab_new", { url: "https://x.test/" }, "act"), ctx()),
    ).toEqual({
      status: "done",
      output: { success: true },
      made: [{ surfaceId: "page-e", url: "https://x.test/", by: "tab" }],
    });
    expect(h.sent.slice(sent).map((c) => c.action)).toEqual(["tab_list", "tab_switch", "url"]);
    expect(h.sent.at(-1)).toEqual({ id: expect.any(String), action: "url" });
    // the window is the call's own kind, opened once the page was leased, and closed with the call
    const events = h.events.slice(h.events.indexOf("lease page-e"));
    expect(events.slice(0, 2)).toEqual(["lease page-e", "open page-e act"]);
    expect(h.windows.opened.has("page-e")).toBe(false);
    // the engine's read fails: the pane is made, and the run is told so
    h.state.reply = () => ({ ok: false, failure: "outcome-unknown" });
    expect(
      await h.broker.control(call(undefined, "tab_new", { url: "https://y.test/" }, "act"), ctx()),
    ).toMatchObject({ status: "done", made: [{ surfaceId: "page-f", by: "tab" }] });
  });
});

describe("the run form's tab_new, cancelled while the engine meets its tab", () => {
  it("answers cancelled, and the pane it made stays owed to the run's next answer, as an open's does", async () => {
    const h = harness();
    await h.broker.control(call("page-a", "snapshot"), ctx());
    h.custody.next.push("page-e");
    const slow = deferred<PagesDaemonExchange>();
    h.state.reply = (c) => (c.action === "url" ? slow.promise : ok({}));
    const cancel = new AbortController();
    const pending = failure(
      h.broker.control(call(undefined, "tab_new", { url: "https://x.test/" }, "act"), {
        signal: cancel.signal,
        deadlineAt: Date.now() + 5_000,
      }),
    );
    await vi.waitFor(() => expect(h.sent.at(-1)?.action).toBe("url"));
    // fieldd cancels: its answer would reach nobody, so the pane must not be named on it
    cancel.abort();
    expect(await pending).toEqual({ kind: "TIMEOUT", state: "cancelled" });
    slow.resolve(ok({}));
    expect(h.panes.pageClosed).not.toHaveBeenCalled();
    expect(await h.broker.control(call(undefined, "tab_list"), ctx())).toMatchObject({
      made: [{ surfaceId: "page-e", url: "https://x.test/", by: "tab" }],
    });
  });
});

// EY-1 (2026-11-24, a still's file): an agent's still is a file the engine writes in the folder fieldd names for the
// run, and the answer names the file; its bytes never cross (EL2). Main judges the folder before the engine runs and
// the file after it wrote (core/still-folder.ts). Until this day main read no folder, sent the command as it came, and
// answered no still: the guard had no caller.
describe("a still is a file in the run's folder, judged before and after the write", () => {
  it("judges the folder part by part, mints the name, sends the engine that path with PNG forced, judges the file, and answers it", async () => {
    const h = harness();
    goodFolder(h);
    engineWrites(h);
    const answer = await h.broker.control(
      still({ fullPage: true, format: "jpeg", quality: 40 }),
      ctx(),
    );
    expect(h.sent.find((c) => c.action === "screenshot")).toEqual({
      action: "screenshot",
      fullPage: true,
      annotate: false,
      format: "png",
      path: STILL_PATH,
      id: expect.stringMatching(/^r\d+$/u),
    });
    expect(answer).toEqual({
      status: "done",
      output: { success: true, data: { path: STILL_PATH } },
      still: { path: STILL_PATH, mime: "image/png", width: 1280, height: 800, bytes: 5000 },
    });
    // each part of the folder, then the name itself (free), in order: all before the engine has the command
    expect(h.stills.lstat.mock.calls.map(([path]) => path)).toEqual([
      "/data",
      "/data/fieldd",
      "/data/fieldd/stills",
      STILL_FOLDER,
      STILL_PATH,
    ]);
    const before = h.events.slice(0, h.events.indexOf("send screenshot"));
    expect(before.filter((e) => e === "lstat")).toHaveLength(5);
    expect(before.indexOf("lstat")).toBeLessThan(before.indexOf("lease page-a"));
    expect(h.stills.opened).toHaveBeenCalledWith(STILL_PATH, STILL_HEAD_BYTES);
    expect(h.disk.removed).toEqual([]);
    expect(h.warned).toEqual([]);
  });

  it("refuses a screenshot with no folder, or one main will not take, before the page is granted, a window opens or an engine starts", async () => {
    const refusedFolder = { kind: "PRECONDITION_FAILED", state: "still-folder" };
    const cases: [string, (h: ReturnType<typeof harness>) => ShellSurfacesControlParams][] = [
      ["no-folder", () => still({}, null)],
      ["folder-not-absolute", () => ({ ...still(), folder: "data/stills" })],
      ["folder-bad-part", () => ({ ...still(), folder: "/data/../etc" })],
      // nothing there
      ["folder-not-directory", () => still()],
      [
        "folder-link",
        (h) => {
          goodFolder(h);
          h.disk.entries.set("/data/fieldd", { kind: "link", uid: STILL_UID, mode: 0o777 });
          return still();
        },
      ],
      [
        "folder-shared",
        (h) => {
          goodFolder(h);
          h.disk.entries.set(STILL_FOLDER, stillDir(STILL_UID, 0o755));
          return still();
        },
      ],
      [
        "folder-not-ours",
        (h) => {
          goodFolder(h);
          h.disk.entries.set(STILL_FOLDER, stillDir(STILL_UID + 1, 0o700));
          return still();
        },
      ],
    ];
    for (const [reason, make] of cases) {
      const h = harness();
      engineWrites(h);
      expect(await failure(h.broker.control(make(h), ctx())), reason).toEqual(refusedFolder);
      expect(h.warned, reason).toEqual([
        { event: "pages.broker.still_refused", fields: { run: "run-1", reason } },
      ]);
      expect(h.bridge.grant, reason).not.toHaveBeenCalled();
      expect(h.engines.ensure, reason).not.toHaveBeenCalled();
      expect(
        h.events.filter((e) => e.startsWith("open")),
        reason,
      ).toEqual([]);
      expect(h.sent, reason).toEqual([]);
      // the run's next call goes: the refusal let its turn go
      expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toMatchObject({
        status: "done",
      });
    }
    // a broker with no disk to read takes no still
    const none = harness({ stills: false });
    goodFolder(none);
    expect(await failure(none.broker.control(still(), ctx()))).toEqual(refusedFolder);
    expect(none.sent).toEqual([]);
  });

  it("sends the engine nothing when something already stands at the name it minted", async () => {
    const h = harness();
    goodFolder(h);
    engineWrites(h);
    h.disk.entries.set(STILL_PATH, { kind: "link", uid: STILL_UID, mode: 0o777 });
    expect(await failure(h.broker.control(still(), ctx()))).toEqual({
      kind: "PRECONDITION_FAILED",
      state: "still-folder",
    });
    expect(h.sent.some((c) => c.action === "screenshot")).toBe(false);
    expect(h.warned).toEqual([
      { event: "pages.broker.still_refused", fields: { run: "run-1", reason: "name-taken" } },
    ]);
    expect(h.windows.opened.size).toBe(0);
  });

  it("answers no file for a still it will not take, by why, and removes what was written", async () => {
    const file: StillFileFacts = { kind: "file", uid: STILL_UID, nlink: 1, size: 5000 };
    const png = pngHead(1280, 800);
    const unread = { kind: "UNAVAILABLE", state: "bad-answer" };
    const cases: [string, { facts: StillFileFacts; head: Uint8Array } | null, unknown][] = [
      // nothing opens at the name: no file, or a link there
      ["not-a-file", null, unread],
      ["not-a-file", { facts: { ...file, kind: "other" }, head: png }, unread],
      ["not-ours", { facts: { ...file, uid: STILL_UID + 1 }, head: png }, unread],
      ["linked", { facts: { ...file, nlink: 2 }, head: png }, unread],
      ["not-png", { facts: file, head: new Uint8Array(STILL_HEAD_BYTES) }, unread],
      [
        "too-large",
        { facts: { ...file, size: 64 * 1024 * 1024 + 1 }, head: png },
        { kind: "RESOURCE_EXHAUSTED", state: "output-too-large" },
      ],
    ];
    for (const [reason, written, expected] of cases) {
      const h = harness();
      goodFolder(h);
      h.state.reply = (c) => {
        if (c.action !== "screenshot") return ok({});
        if (written !== null) h.disk.files.set(String(c.path), written);
        return ok({ path: c.path });
      };
      expect(await failure(h.broker.control(still(), ctx())), reason).toEqual(expected);
      expect(h.warned, reason).toEqual([
        { event: "pages.broker.still_refused", fields: { run: "run-1", reason } },
      ]);
      await vi.waitFor(() => expect(h.disk.removed, reason).toEqual([STILL_PATH]));
      expect(h.windows.opened.size, reason).toBe(0);
    }
    // the engine answers another path than the one it was sent: what it wrote there is not read
    const h = harness();
    goodFolder(h);
    h.state.reply = (c) =>
      c.action === "screenshot" ? ok({ path: "/tmp/elsewhere.png" }) : ok({});
    expect(await failure(h.broker.control(still(), ctx()))).toEqual(unread);
    expect(h.warned).toEqual([
      { event: "pages.broker.still_refused", fields: { run: "run-1", reason: "answered-path" } },
    ]);
    expect(h.stills.opened).not.toHaveBeenCalled();
  });

  it("with ifChanged, a page that has not changed answers done with no file, and nothing is read or removed", async () => {
    const h = harness();
    goodFolder(h);
    const unchanged = { changed: false, revision: 2, pixelChangeRatio: 0, threshold: 0 };
    h.state.reply = (c) => (c.action === "screenshot" ? ok(unchanged) : ok({}));
    expect(await h.broker.control(still({ ifChanged: true, threshold: 0 }), ctx())).toEqual({
      status: "done",
      output: { success: true, data: unchanged },
    });
    expect(h.sent.find((c) => c.action === "screenshot")).toMatchObject({
      ifChanged: true,
      path: STILL_PATH,
    });
    expect(h.stills.opened).not.toHaveBeenCalled();
    expect(h.stills.remove).not.toHaveBeenCalled();
    // the engine's own failure passes as it came, with no file
    h.state.reply = (c) =>
      c.action === "screenshot"
        ? { ok: true, reply: { success: false, error: "Element not found" } }
        : ok({});
    expect(await h.broker.control(still({ selector: "@e9" }), ctx())).toEqual({
      status: "done",
      output: { success: false, error: "Element not found" },
    });
  });

  it("a still written under a call that answers held is no agent's: it is removed once the engine has done", async () => {
    const h = harness();
    goodFolder(h);
    const slow = deferred<PagesDaemonExchange>();
    h.state.reply = (c) => {
      if (c.action !== "screenshot") return ok({});
      h.disk.files.set(String(c.path), {
        facts: { kind: "file", uid: STILL_UID, nlink: 1, size: 5000 },
        head: pngHead(1280, 800),
      });
      return slow.promise;
    };
    const pending = h.broker.control(still(), ctx());
    await vi.waitFor(() => expect(h.sent.some((c) => c.action === "screenshot")).toBe(true));
    h.pages["page-a"].hand(true);
    expect(await pending).toEqual({ status: "refused", fact: "held" });
    expect(h.disk.removed).toEqual([]);
    slow.resolve(ok({ path: STILL_PATH }));
    await vi.waitFor(() => expect(h.disk.removed).toEqual([STILL_PATH]));
  });
});

// EY-1 (2026-11-24, the engine's allow list): contracts says main's broker passes PAGES_DAEMON_ACTIONS and the run
// form's own and refuses any other. Until this day it refused only `launch`, and sent every key a command carried.
describe("the engine is sent only what the rows send", () => {
  const notAllowed = { kind: "PRECONDITION_FAILED", state: "not-allowed" };

  it("refuses an action off the list on either form, before the page is granted, a pane is made, a window opens or an engine starts", async () => {
    const cases: [PageName | undefined, string, Readonly<Record<string, unknown>>][] = [
      ["page-a", "stream_enable", {}],
      ["page-a", "connect", { cdpUrl: "ws://127.0.0.1:9222/" }],
      ["page-a", "rebind", { from: "run-0" }],
      [undefined, "record_start", { path: "/tmp/x.webm" }],
      [undefined, "open", {}],
    ];
    for (const [page, action, extra] of cases) {
      const h = harness();
      h.custody.next.push("page-e");
      expect(
        await failure(h.broker.control(call(page, action, extra, "act"), ctx())),
        action,
      ).toEqual(notAllowed);
      expect(h.warned, action).toEqual([
        { event: "pages.broker.command_refused", fields: { run: "run-1", why: "action" } },
      ]);
      expect(h.bridge.grant, action).not.toHaveBeenCalled();
      expect(h.maker.make, action).not.toHaveBeenCalled();
      expect(h.engines.ensure, action).not.toHaveBeenCalled();
      expect(h.events, action).toEqual([]);
      expect(h.sent, action).toEqual([]);
    }
  });

  it("refuses an argument that is not the action's own, the same way, and says which action", async () => {
    const cases: [PageName | undefined, string, Readonly<Record<string, unknown>>][] = [
      ["page-a", "screenshot", { path: "/Users/x/.zshrc" }],
      ["page-a", "screenshot", { screenshotDir: "/tmp" }],
      ["page-a", "read", { url: "http://169.254.169.254/" }],
      ["page-a", "navigate", { url: "https://a.test/", headers: { cookie: "x" } }],
      ["page-a", "click", { selector: "@e1", newTab: true }],
      ["page-a", "click", { selector: "@e1", id: "mine" }],
      ["page-a", "wait", { function: "fetch('/x')" }],
      [undefined, "navigate", { url: "https://a.test/", profile: "Default" }],
      [undefined, "tab_new", { url: "https://a.test/", executablePath: "/bin/sh" }],
    ];
    for (const [page, action, extra] of cases) {
      const h = harness();
      h.custody.next.push("page-e");
      const label = `${action} ${Object.keys(extra).join(",")}`;
      const params =
        action === "screenshot"
          ? { ...call(page, action, extra), folder: STILL_FOLDER }
          : call(page, action, extra, "act");
      expect(await failure(h.broker.control(params, ctx())), label).toEqual(notAllowed);
      expect(h.warned, label).toEqual([
        {
          event: "pages.broker.command_refused",
          fields: { run: "run-1", why: "argument", action },
        },
      ]);
      expect(h.bridge.grant, label).not.toHaveBeenCalled();
      expect(h.maker.make, label).not.toHaveBeenCalled();
      expect(h.engines.ensure, label).not.toHaveBeenCalled();
      expect(h.stills.lstat, label).not.toHaveBeenCalled();
      expect(h.events, label).toEqual([]);
      expect(h.sent, label).toEqual([]);
    }
  });

  it("passes each listed action with its own arguments, and answers the page form's tab_list itself", async () => {
    const h = harness();
    const commands: [string, Readonly<Record<string, unknown>>][] = [
      ["navigate", { url: "https://a.test/" }],
      ["read", { timeout: 1000, filter: "main", outline: true, raw: false }],
      ["snapshot", { compact: true, delta: true, full: true, interactive: true, maxDepth: 3 }],
      ["snapshot", { selector: "@e1", urls: true }],
      ["back", {}],
      ["forward", {}],
      ["reload", {}],
      ["click", { selector: "@e1" }],
      ["fill", { selector: "@e1", value: "x" }],
      ["type", { selector: "@e1", text: "x", delay: 5 }],
      ["press", { key: "Enter" }],
      ["check", { selector: "@e1" }],
      ["uncheck", { selector: "@e1" }],
      ["select", { selector: "@e1", values: ["a"] }],
      ["scroll", { direction: "down", amount: 300, selector: "@e1" }],
      ["wait", { timeout: 10, selector: "@e1", text: "x" }],
      ["waitforloadstate", { state: "load", timeout: 10 }],
      ["gettext", { selector: "@e1" }],
      ["url", {}],
      ["title", {}],
      ["evaluate", { script: "1" }],
    ];
    for (const [action, extra] of commands) {
      const answer = await h.broker.control(call("page-a", action, extra, "act"), ctx());
      expect(answer, action).toMatchObject({ status: "done" });
      expect(h.sent.at(-1), action).toEqual({
        action,
        ...extra,
        id: expect.stringMatching(/^r\d+$/u),
      });
    }
    expect(h.warned).toEqual([]);
    // main's own, on a page as for the run: the run's pages from its grants, and the engine is asked nothing
    const sent = h.sent.length;
    expect(await h.broker.control(call("page-a", "tab_list"), ctx())).toMatchObject({
      status: "done",
      output: { success: true, data: { tabs: [{ surfaceId: "page-a" }], current: "page-a" } },
    });
    expect(h.sent).toHaveLength(sent);
    // the engine's own start is still the broker's alone, by its own word
    expect(await failure(h.broker.control(call("page-a", "launch"), ctx()))).toEqual({
      kind: "PRECONDITION_FAILED",
      state: "broker-owned",
    });
  });
});

// EY-1 (2026-11-24, what a run is owed and why a pane was not made). Four things an answer said that were not so:
// a pane main closed before any answer named it was named in `made` beside `closed`; a made pane custody had let
// go kept its grant, and its close named it in `givenBack` as if a person had handed it; with no product window
// the refusal was the desk's; and an open at an address named its pane at about:blank.
describe("what a run is owed, and why a pane was not made", () => {
  /** A click on page-a whose page opens a pop-up after the click's answer has left: made, granted and owed to
   * the run's next answer, which has not come. */
  const popupAfterItsCall = async (h: ReturnType<typeof harness>): Promise<void> => {
    h.custody.bindAtOnce = false;
    h.custody.next.push("page-e");
    h.state.reply = (c) => {
      const policy = h.pages["page-a"].policy;
      if (c.action === "click" && policy !== null && policy.decide("https://p.test/") === "allow") {
        policy.open("https://p.test/");
      }
      return ok({});
    };
    const click = await h.broker.control(
      call("page-a", "click", { selector: "@e1" }, "act"),
      ctx(),
    );
    expect(click).not.toHaveProperty("made");
    h.state.reply = () => ok({});
    h.bind("page-e");
    await vi.waitFor(() => expect(h.events).toContain("adopt page-e page-a"));
  };

  it("a made pane its client closes before any answer named it is named in neither made nor closed", async () => {
    const h = harness();
    await popupAfterItsCall(h);
    await h.broker.closeMade("run-1", "page-e");
    expect(h.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
    expect(await h.broker.control(call("page-a", "snapshot"), ctx())).toEqual({
      status: "done",
      output: { success: true, data: {} },
    });
    expect(h.maker.named).not.toHaveBeenCalled();
  });

  it("the page form's close and the run's end do the same: a pane never named is not named as it goes", async () => {
    const byPage = harness();
    await popupAfterItsCall(byPage);
    expect(await byPage.broker.control(call("page-e", "close"), ctx())).toEqual({
      status: "done",
      output: { success: true },
    });
    expect(await byPage.broker.control(call("page-a", "snapshot"), ctx())).toEqual({
      status: "done",
      output: { success: true, data: {} },
    });
    const byRun = harness();
    await popupAfterItsCall(byRun);
    expect(await byRun.broker.control(call(undefined, "close"), ctx())).toEqual({
      status: "done",
      output: { success: true },
      givenBack: ["page-a"],
    });
    expect(byRun.panes.pageClosed).toHaveBeenCalledWith("run-1", "page-e");
    // a pane an answer did name is named in closed as before
    const named = harness();
    named.custody.next.push("page-e");
    await named.broker.control(call(undefined, "tab_new", {}, "act"), ctx());
    expect(await named.broker.control(call("page-e", "close"), ctx())).toEqual({
      status: "done",
      output: { success: true },
      closed: ["page-e"],
    });
  });

  it("a made pane custody lets go after it was named: its grant ends there, and its close owes nothing in givenBack", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    await h.broker.control(call(undefined, "tab_new", { url: "https://x.test/" }, "act"), ctx());
    await h.broker.control(call("page-e", "snapshot"), ctx());
    // the desk declined it at its place: custody's record and its page are gone
    h.made.delete("page-e");
    h.bindings.delete("page-e");
    h.broker.madeGone("run-1", "page-e", "declined");
    await vi.waitFor(() => expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-e"));
    expect(h.windows.leases.has("page-e")).toBe(false);
    // fieldd ends the pane it had placed, by the page form's close
    const closed = await h.broker.control(call("page-e", "close"), ctx());
    const ended = await h.broker.control(call(undefined, "close"), ctx());
    expect(closed).toEqual({ status: "done", output: { success: true } });
    expect(ended).toEqual({ status: "done", output: { success: true } });
  });

  it("let go under a call that holds its window: the call answers as its engine did, then the grant ends", async () => {
    const h = harness();
    h.custody.next.push("page-e");
    await h.broker.control(call(undefined, "tab_new", {}, "act"), ctx());
    const slow = deferred<PagesDaemonExchange>();
    h.state.reply = (c) => (c.action === "gettext" ? slow.promise : ok({}));
    const pending = h.broker.control(call("page-e", "gettext", { selector: "@e1" }), ctx());
    await vi.waitFor(() => expect(h.sent.some((c) => c.action === "gettext")).toBe(true));
    h.made.delete("page-e");
    h.broker.madeGone("run-1", "page-e", "declined");
    expect(h.bridge.endGrant).not.toHaveBeenCalledWith("run-1", "page-e");
    slow.resolve(ok({ text: "x" }));
    expect(await pending).toEqual({
      status: "done",
      output: { success: true, data: { text: "x" } },
    });
    await vi.waitFor(() => expect(h.bridge.endGrant).toHaveBeenCalledWith("run-1", "page-e"));
    expect(await h.broker.control(call(undefined, "close"), ctx())).toEqual({
      status: "done",
      output: { success: true },
    });
  });

  it("with no product window the word is custody's no-window, for an open, a tab and a pop-up; a full desk is still the desk's", async () => {
    const h = harness();
    // custody with no window: it has no room either, and says the window first
    h.custody.room = false;
    h.custody.refused = "no-window";
    const noWindow = { kind: "UNAVAILABLE", state: "no-window" };
    const open = () => failure(h.broker.control(call(undefined, "navigate", {}, "act"), ctx()));
    const tabNew = () => failure(h.broker.control(call(undefined, "tab_new", {}, "act"), ctx()));
    expect(await open()).toEqual(noWindow);
    expect(await tabNew()).toEqual(noWindow);
    const tabs: unknown[] = [];
    // the click's own call, in whose window its tab is made: the run's first, then its third
    let callId = "call-1";
    h.state.reply = async (c) => {
      const policy = h.pages["page-a"].policy;
      if (c.action !== "click" || policy === null) return ok({});
      tabs.push(await h.broker.make({ runKey: "run-1", callId, url: "https://e.test/" }));
      if (policy.decide("https://p.test/") === "allow") policy.open("https://p.test/");
      return ok({});
    };
    const click = await h.broker.control(
      call("page-a", "click", { selector: "@e1" }, "act"),
      ctx(),
    );
    await vi.waitFor(() => expect(h.maker.make).toHaveBeenCalledTimes(4));
    const next = await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(tabs).toEqual([{ ok: false, refused: "no-window" }]);
    expect([click, next].map((answer) => answer.capped).filter(Boolean)).toEqual([{ noWindow: 1 }]);
    // a window, and a desk with no room: the desk's word, as custody says it
    h.custody.refused = null;
    const deskFull = { kind: "RESOURCE_EXHAUSTED", state: "desk-full" };
    expect(await open()).toEqual(deskFull);
    expect(await tabNew()).toEqual(deskFull);
    callId = "call-3";
    const again = await h.broker.control(
      call("page-a", "click", { selector: "@e1" }, "act"),
      ctx(),
    );
    await vi.waitFor(() => expect(h.maker.make).toHaveBeenCalledTimes(8));
    const after = await h.broker.control(call("page-a", "snapshot"), ctx());
    expect(tabs.at(-1)).toEqual({ ok: false, refused: "desk-full" });
    expect([again, after].map((answer) => answer.capped).filter(Boolean)).toEqual([
      { deskFull: 1 },
    ]);
  });

  it("the run form's open names its pane at the address it was opened at; with none, or one main makes no page at, about:blank", async () => {
    const h = harness();
    h.custody.next.push("page-e", "page-f", "page-b");
    const open = (extra: Readonly<Record<string, unknown>>) =>
      h.broker.control(call(undefined, "navigate", extra, "act"), ctx());
    expect((await open({ url: "https://x.test/docs?q=1" })).made).toEqual([
      { surfaceId: "page-e", url: "https://x.test/docs?q=1", by: "open" },
    ]);
    // the pane itself is made blank, and the engine takes it there
    expect(h.maker.make).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: "about:blank", by: "open" }),
    );
    expect(h.sent.find((c) => c.action === "navigate")).toMatchObject({
      url: "https://x.test/docs?q=1",
    });
    expect((await open({})).made).toEqual([
      { surfaceId: "page-f", url: "about:blank", by: "open" },
    ]);
    expect((await open({ url: "javascript:alert(1)" })).made).toEqual([
      { surfaceId: "page-b", url: "about:blank", by: "open" },
    ]);
  });
});
