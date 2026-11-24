// VT-2 (track VT, 2026-11-24) — Vitals in Electron main and in its window's preload: the feed main relays while the
// window is open, the shell's roster for fieldd, the preload's one read-only stream, and the menu's item. Driven with
// fake ports and fake doors: nothing here starts Electron.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VITALS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { buildAppMenu, VITALS_ITEM_ID } from "../src/main/app-menu-model";
import {
  VITALS_FEED_RETRY_MS,
  type VitalsFeedPort,
  VitalsFeedSession,
  type VitalsFielddClient,
} from "../src/main/vitals-feed";
import { MainOwnReporter } from "../src/main/vitals-own";
import {
  shellRoster,
  VITALS_ROSTER_SETTLE_MS,
  VitalsRosterReporter,
} from "../src/main/vitals-roster";
import {
  parseVitalsEnvelope,
  VITALS_BRIDGE_BACKLOG_MAX,
  type VitalsBridgeEvent,
  VitalsPreloadBridge,
  type VitalsRendererPort,
} from "../src/vitals/vitals-preload-bridge";

const here = dirname(fileURLToPath(import.meta.url));
const source = (relative: string): string =>
  readFileSync(join(here, "..", "src", relative), "utf8");

const silent = {
  child: () => silent,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  isLevelEnabled: () => false,
};

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
};

class FakePort implements VitalsFeedPort {
  readonly sent: Array<Record<string, unknown>> = [];
  started = false;
  closed = false;
  private closeListener: (() => void) | null = null;
  postMessage(message: string): void {
    if (this.closed) throw new Error("closed");
    this.sent.push(JSON.parse(message) as Record<string, unknown>);
  }
  start(): void {
    this.started = true;
  }
  close(): void {
    this.closed = true;
  }
  on(_event: "close", listener: () => void): void {
    this.closeListener = listener;
  }
  /** the window's document went away */
  hangUp(): void {
    this.closeListener?.();
  }
  kinds(): string[] {
    return this.sent.map((frame) =>
      [frame["kind"], frame["origin"], frame["event"]]
        .filter((part) => part !== undefined)
        .join(":"),
    );
  }
}

class FakeFieldd implements VitalsFielddClient {
  status = "ready";
  refuse = false;
  readonly asked: Array<{ method: string; params: unknown }> = [];
  readonly events = new Map<string, (payload: unknown, kind: "snapshot" | "delta") => void>();
  unsubscribed: string[] = [];
  private statusListeners = new Set<() => void>();
  onStatusChange(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
  async subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }> {
    this.asked.push({ method, params });
    if (this.refuse) throw new Error("METHOD_NOT_FOUND");
    this.events.set(method, onEvent);
    return {
      snapshot: { of: method },
      unsubscribe: () => {
        this.unsubscribed.push(method);
      },
    };
  }
  setStatus(status: string): void {
    this.status = status;
    for (const listener of this.statusListeners) listener();
  }
}

function feed(options: { client?: FakeFieldd | null; shellLogs?: boolean } = {}) {
  const port = new FakePort();
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let hear: ((client: VitalsFielddClient | null) => void) | null = null;
  let stoppedHearing = 0;
  let shellDisposed = 0;
  let shellEmit: ((payload: unknown, kind: "snapshot" | "delta") => void) | null = null;
  const session = new VitalsFeedSession(port, {
    onFieldd: (listener) => {
      hear = listener;
      listener(options.client === undefined ? null : options.client);
      return () => {
        stoppedHearing += 1;
      };
    },
    ...(options.shellLogs === false
      ? {}
      : {
          shellLogs: {
            subscribe: async (_query, emit) => {
              shellEmit = emit;
              return {
                snapshot: { of: "shell" },
                dispose: () => {
                  shellDisposed += 1;
                },
              };
            },
          },
        }),
    logger: silent,
    now: () => 1_000_000,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return {
    port,
    session,
    timers,
    setClient: (client: VitalsFielddClient | null) => hear?.(client),
    shellEmit: (payload: unknown) => shellEmit?.(payload, "delta"),
    counts: () => ({ stoppedHearing, shellDisposed }),
  };
}

describe("VT-2 — the feed main relays while the Vitals window is open", () => {
  it("hands down fieldd's vitals and both log doors, snapshot first, and asks the page for nothing", async () => {
    const client = new FakeFieldd();
    const { port, session, shellEmit } = feed({ client });
    session.start();
    await settle();
    expect(port.started).toBe(true);
    expect(port.kinds().sort()).toEqual(
      ["logs:fieldd:snapshot", "logs:shell:snapshot", "vitals:snapshot"].sort(),
    );
    expect(port.sent.every((frame) => frame["v"] === 1)).toBe(true);
    expect(client.asked.map((ask) => ask.method)).toEqual([
      "vitals.subscribe",
      "diagnostics.subscribe",
    ]);
    // the daemons' lines from fieldd, the last five minutes, a bounded count
    expect(client.asked[1]?.params).toEqual({
      sources: ["system/fieldd", "system/field-native"],
      minLevel: "info",
      sinceTime: 1_000_000 - 5 * 60_000,
      limit: 500,
    });
    client.events.get("vitals.subscribe")?.({ sample: 1 }, "delta");
    client.events.get("diagnostics.subscribe")?.({ records: [] }, "delta");
    shellEmit({ records: [] });
    expect(port.kinds().slice(-3)).toEqual([
      "vitals:delta",
      "logs:fieldd:delta",
      "logs:shell:delta",
    ]);
    expect(port.sent.at(-3)?.["payload"]).toEqual({ sample: 1 });
  });

  it("says the door is shut while there is no fieldd, and reads the next one when it is attached", async () => {
    const { port, session, setClient } = feed({ client: null, shellLogs: false });
    session.start();
    await settle();
    expect(port.kinds()).toEqual(["vitals:down", "logs:fieldd:down"]);
    const first = new FakeFieldd();
    setClient(first);
    await settle();
    expect(port.kinds().slice(-2)).toEqual(["vitals:snapshot", "logs:fieldd:snapshot"]);
    // a daemon bounce hands main a new client: the old one is let go, and a late event from it is dropped
    const second = new FakeFieldd();
    const stale = first.events.get("vitals.subscribe");
    setClient(second);
    await settle();
    expect(first.unsubscribed.sort()).toEqual(["diagnostics.subscribe", "vitals.subscribe"]);
    const before = port.sent.length;
    stale?.({ sample: "from the old daemon" }, "delta");
    expect(port.sent).toHaveLength(before);
    expect(second.asked).toHaveLength(2);
  });

  it("says the door is shut when the client loses its socket, once, and not when it returns", async () => {
    const client = new FakeFieldd();
    const { port, session } = feed({ client, shellLogs: false });
    session.start();
    await settle();
    const before = port.sent.length;
    client.setStatus("reconnecting");
    client.setStatus("connecting");
    expect(port.kinds().slice(before)).toEqual(["vitals:down", "logs:fieldd:down"]);
    client.setStatus("ready");
    expect(port.sent).toHaveLength(before + 2); // the client replays its own subscriptions, each with a snapshot
    client.events.get("vitals.subscribe")?.({ of: "replayed" }, "snapshot");
    expect(port.kinds().at(-1)).toBe("vitals:snapshot");
  });

  it("asks a refusing fieldd again after a wait, while the window is open, and never after it closed", async () => {
    const client = new FakeFieldd();
    client.refuse = true;
    const { port, session, timers } = feed({ client, shellLogs: false });
    session.start();
    await settle();
    expect(port.kinds()).toEqual(["vitals:down", "logs:fieldd:down"]);
    expect(timers.map((timer) => timer.ms)).toEqual([VITALS_FEED_RETRY_MS]);
    client.refuse = false;
    timers[0]?.fn();
    await settle();
    expect(port.kinds().slice(-2)).toEqual(["vitals:snapshot", "logs:fieldd:snapshot"]);
    // closed: nothing more is asked or sent
    session.close();
    const asked = client.asked.length;
    timers[0]?.fn();
    await settle();
    expect(client.asked).toHaveLength(asked);
  });

  it("lets go of every door when the window's document goes away", async () => {
    const client = new FakeFieldd();
    const { port, session, counts } = feed({ client });
    session.start();
    await settle();
    port.hangUp();
    expect(port.closed).toBe(true);
    expect(client.unsubscribed.sort()).toEqual(["diagnostics.subscribe", "vitals.subscribe"]);
    expect(counts()).toEqual({ stoppedHearing: 1, shellDisposed: 1 });
    const sent = port.sent.length;
    client.events.get("vitals.subscribe")?.({ sample: 2 }, "delta");
    expect(port.sent).toHaveLength(sent);
  });
});

describe("VT-2 — the shell's roster", () => {
  const metrics = [
    { pid: 500, type: "Tab" },
    { pid: 100, type: "Browser" },
    { pid: 300, type: "GPU" },
    { pid: 400, type: "Utility", name: "Network Service" },
    { pid: 410, type: "Utility", serviceName: "audio.mojom.AudioService" },
    { pid: 600, type: "Tab" },
    { pid: 700, type: "Tab" },
    { pid: 800, type: "Zygote" },
    { pid: 100, type: "Browser" },
    { pid: 0, type: "Tab" },
  ];

  it("names each process by what main knows of it, in pid order, and never guesses a renderer to be the desk", () => {
    expect(
      shellRoster(metrics, [
        { pid: 500, role: "window" },
        { pid: 600, role: "vitals-window" },
      ]),
    ).toEqual([
      { pid: 100, role: "main" },
      { pid: 300, role: "gpu" },
      { pid: 400, role: "utility", label: "Network Service" },
      { pid: 410, role: "utility", label: "audio.mojom.AudioService" },
      { pid: 500, role: "window" },
      { pid: 600, role: "vitals-window" },
      { pid: 700, role: "other" },
      { pid: 800, role: "utility", label: "Zygote" },
    ]);
  });

  it("carries nothing but a pid, a role and Chromium's own name for a helper, within the contract's bounds", () => {
    const long = "x".repeat(400);
    const rows = shellRoster(
      Array.from({ length: 300 }, (_, index) => ({ pid: index + 1, type: "Utility", name: long })),
      [],
    );
    expect(rows).toHaveLength(VITALS.ROSTER_MAX);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["label", "pid", "role"]);
      expect(row.label?.length).toBe(VITALS.LABEL_MAX);
    }
  });

  function reporter(rows: () => Array<{ pid: number; role: string }>) {
    const timers: Array<() => void> = [];
    const sent: unknown[] = [];
    let refuse = false;
    let hasClient = true;
    const instance = new VitalsRosterReporter({
      read: rows,
      client: () =>
        hasClient
          ? {
              request: async (method, params) => {
                if (refuse) throw new Error("no such method");
                sent.push({ method, params });
                return { accepted: 1 };
              },
            }
          : null,
      logger: silent,
      setTimer: (fn, ms) => {
        expect(ms).toBe(VITALS_ROSTER_SETTLE_MS);
        timers.push(fn);
        return timers.length;
      },
      clearTimer: () => undefined,
    });
    const fire = async (): Promise<void> => {
      const due = timers.splice(0);
      for (const fn of due) fn();
      await settle();
    };
    return {
      instance,
      timers,
      sent,
      fire,
      refuse: (next: boolean) => {
        refuse = next;
      },
      client: (next: boolean) => {
        hasClient = next;
      },
    };
  }

  it("folds a burst of process events into one report, and sends nothing when the list did not change", async () => {
    let rows = [{ pid: 100, role: "main" }];
    const r = reporter(() => rows);
    r.instance.poke();
    r.instance.poke();
    r.instance.poke();
    expect(r.timers).toHaveLength(1);
    await r.fire();
    expect(r.sent).toEqual([
      { method: "vitals.roster.set", params: { processes: [{ pid: 100, role: "main" }] } },
    ]);
    r.instance.poke();
    await r.fire();
    expect(r.sent).toHaveLength(1);
    rows = [
      { pid: 100, role: "main" },
      { pid: 500, role: "window" },
    ];
    r.instance.poke();
    await r.fire();
    expect(r.sent).toHaveLength(2);
    // never on a timer of its own: with no event there is nothing waiting
    expect(r.timers).toHaveLength(0);
  });

  it("tells a newly attached fieldd the whole list again, and asks a refusing one again only at the next event", async () => {
    const r = reporter(() => [{ pid: 100, role: "main" }]);
    r.instance.poke();
    await r.fire();
    expect(r.sent).toHaveLength(1);
    r.instance.fresh();
    await r.fire();
    expect(r.sent).toHaveLength(2);
    r.refuse(true);
    r.instance.fresh();
    await r.fire();
    expect(r.sent).toHaveLength(2);
    expect(r.timers).toHaveLength(0); // no retry timer
    r.refuse(false);
    r.instance.poke();
    await r.fire();
    expect(r.sent).toHaveLength(3);
    // with no fieldd there is nobody to tell
    r.client(false);
    r.instance.fresh();
    await r.fire();
    expect(r.sent).toHaveLength(3);
    r.instance.dispose();
    r.instance.poke();
    expect(r.timers).toHaveLength(0);
  });
});

describe("VT-3b — main says its own loop, only while the Vitals window is open", () => {
  function reporter(measured = true) {
    // the main thread's CPU time and a monotonic clock, both in microseconds, moved by the test
    let cpuUs = 0;
    let atUs = 0;
    const timers: Array<{ fn: () => void; ms: number }> = [];
    let cleared = 0;
    const sent: Array<{ method: string; params: unknown }> = [];
    let hasClient = true;
    let settleRequest: (() => void) | null = null;
    let hold = false;
    const instance = new MainOwnReporter({
      client: () =>
        hasClient
          ? {
              request: (method, params) => {
                sent.push({ method, params });
                return hold
                  ? new Promise<void>((resolve) => {
                      settleRequest = resolve;
                    })
                  : Promise.resolve({ accepted: true });
              },
            }
          : null,
      logger: silent,
      threadCpu: measured ? () => ({ user: cpuUs * 0.75, system: cpuUs * 0.25 }) : null,
      clockUs: () => atUs,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: () => {
        cleared += 1;
      },
    });
    return {
      instance,
      timers,
      sent,
      cleared: () => cleared,
      /** a span of `wallMs` in which main's thread ran for `busyMs` */
      spend: (wallMs: number, busyMs: number) => {
        atUs += wallMs * 1_000;
        cpuUs += busyMs * 1_000;
      },
      tick: () => timers.at(-1)?.fn(),
      client: (next: boolean) => {
        hasClient = next;
      },
      holdRequests: (next: boolean) => {
        hold = next;
      },
      settleRequest: () => settleRequest?.(),
    };
  }

  it("is not running until started, and starts one timer at the census's own interval", () => {
    const own = reporter();
    expect(own.instance.running).toBe(false);
    expect(own.timers).toHaveLength(0);
    own.instance.start();
    own.instance.start();
    expect(own.instance.running).toBe(true);
    expect(own.timers.map((timer) => timer.ms)).toEqual([VITALS.SAMPLE_INTERVAL_MS]);
  });

  it("says the share of the second its own thread was running, one report a tick, to the report door", async () => {
    const own = reporter();
    own.spend(10_000, 9_000); // before the window opened: never counted
    own.instance.start();
    own.spend(1_000, 100);
    own.tick();
    await settle();
    own.spend(1_000, 750);
    own.tick();
    await settle();
    expect(own.sent).toEqual([
      { method: "vitals.own.report", params: { own: { loopBusy: 0.1 } } },
      { method: "vitals.own.report", params: { own: { loopBusy: 0.75 } } },
    ]);
  });

  it("says nothing at all where the runtime cannot read its thread's time: never a zero", () => {
    const own = reporter(false);
    own.instance.start();
    expect(own.instance.running).toBe(false);
    expect(own.timers).toHaveLength(0);
    expect(own.sent).toHaveLength(0);
  });

  it("does not read the loop's own counters, which stand still in Electron's main process", () => {
    // measured 2026-11-24 on Electron 43.1.1: eventLoopUtilization read 0 through idle and held seconds alike
    const own = source("main/vitals-own.ts");
    expect(own).not.toContain("performance.eventLoopUtilization(");
    expect(own).toContain("threadCpuUsage");
  });

  it("leaves an interval open while nobody can be told, and the next fold covers it", async () => {
    const own = reporter();
    own.instance.start();
    own.client(false);
    own.spend(1_000, 1_000);
    own.tick();
    expect(own.sent).toHaveLength(0);
    own.client(true);
    own.spend(1_000, 0);
    own.tick();
    await settle();
    expect(own.sent).toEqual([{ method: "vitals.own.report", params: { own: { loopBusy: 0.5 } } }]);
  });

  it("never stacks reports: with one on its way the tick sends none", async () => {
    const own = reporter();
    own.instance.start();
    own.holdRequests(true);
    own.spend(1_000, 500);
    own.tick();
    own.spend(1_000, 500);
    own.tick();
    expect(own.sent).toHaveLength(1);
    own.settleRequest();
    await settle();
    own.holdRequests(false);
    own.spend(1_000, 0);
    own.tick();
    await settle();
    // the held interval and the next, folded: 500 of 2,000 busy
    expect(own.sent.at(-1)?.params).toEqual({ own: { loopBusy: 0.25 } });
  });

  it("stops with the window: the timer is cleared, and a later tick says nothing", () => {
    const own = reporter();
    own.instance.start();
    own.instance.stop();
    own.instance.stop();
    expect(own.instance.running).toBe(false);
    expect(own.cleared()).toBe(1);
    own.spend(1_000, 1_000);
    own.tick();
    expect(own.sent).toHaveLength(0);
  });

  it("is started and stopped by the window alone: no other event of main's runs it", () => {
    const composed = source("main/vitals.ts");
    const changed = composed.slice(
      composed.indexOf("onChanged: () => {"),
      composed.indexOf("quit: opts.quit,"),
    );
    expect(changed).toContain("if (windowHost.rendererPid() === null) own.stop();");
    expect(changed).toContain("else own.start();");
    expect(composed.match(/own\.start\(\)/g)).toHaveLength(1);
    // and leaving stops it
    expect(composed.slice(composed.indexOf("dispose: () => {"))).toContain("own.stop();");
  });
});

describe("VT-2 — the Vitals window's preload", () => {
  class FakeRendererPort implements VitalsRendererPort {
    started = false;
    closed = false;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    start(): void {
      this.started = true;
    }
    close(): void {
      this.closed = true;
    }
    say(message: unknown): void {
      this.onmessage?.({ data: typeof message === "string" ? message : JSON.stringify(message) });
    }
  }

  it("reads an envelope's shape and nothing past it", () => {
    expect(
      parseVitalsEnvelope(JSON.stringify({ v: 1, kind: "vitals", event: "delta", payload: 7 })),
    ).toEqual({
      kind: "vitals",
      event: "delta",
      payload: 7,
    });
    expect(
      parseVitalsEnvelope(JSON.stringify({ v: 1, kind: "logs", origin: "shell", event: "down" })),
    ).toEqual({ kind: "logs", origin: "shell", event: "down" });
    for (const bad of [
      7,
      "not json",
      "[]",
      JSON.stringify({ v: 2, kind: "vitals", event: "delta" }),
      JSON.stringify({ v: 1, kind: "terminal", event: "delta" }),
      JSON.stringify({ v: 1, kind: "vitals", event: "write" }),
      JSON.stringify({ v: 1, kind: "logs", event: "delta" }),
      JSON.stringify({ v: 1, kind: "logs", origin: "elsewhere", event: "delta" }),
    ]) {
      expect(parseVitalsEnvelope(bad), String(bad)).toBeNull();
    }
  });

  it("keeps what arrived before the page listened, the first snapshot always", () => {
    const bridge = new VitalsPreloadBridge();
    const port = new FakeRendererPort();
    bridge.attach(port);
    expect(port.started).toBe(true);
    port.say({ v: 1, kind: "vitals", event: "snapshot", payload: "first" });
    for (let n = 0; n < VITALS_BRIDGE_BACKLOG_MAX + 40; n++) {
      port.say({ v: 1, kind: "vitals", event: "delta", payload: n });
    }
    port.say("garbage");
    const heard: VitalsBridgeEvent[] = [];
    const stop = bridge.subscribe((event) => heard.push(event));
    expect(heard).toHaveLength(VITALS_BRIDGE_BACKLOG_MAX);
    expect(heard[0]).toEqual({ kind: "vitals", event: "snapshot", payload: "first" });
    expect(heard.at(-1)?.payload).toBe(VITALS_BRIDGE_BACKLOG_MAX + 39);
    port.say({ v: 1, kind: "logs", origin: "fieldd", event: "down" });
    expect(heard.at(-1)).toEqual({ kind: "logs", origin: "fieldd", event: "down" });
    stop();
    // a new document generation's port replaces the last
    const next = new FakeRendererPort();
    bridge.attach(next);
    expect(port.closed).toBe(true);
  });

  it("exposes one function and nothing the page can send with", () => {
    const preload = source("vitals/vitals-preload.ts");
    const exposed = preload.slice(preload.indexOf("exposeInMainWorld"));
    expect(exposed).toContain('"vibefieldVitals"');
    expect(exposed.match(/^\s+\w+:/gm)).toHaveLength(1);
    expect(exposed).not.toContain("ipcRenderer");
    expect(exposed).not.toContain("postMessage");
    expect(preload).not.toMatch(/ipcRenderer\.(send|invoke|sendSync|postMessage)/);
    // the bridge holds no way back either
    const bridge = source("vitals/vitals-preload-bridge.ts");
    expect(bridge).not.toContain("postMessage");
    // the channel is contracts' own name for it (wall R6: no channel string is written outside contracts)
    expect(preload).toContain("ipcRenderer.on(VITALS_PORT_CHANNEL,");
    expect(source("main/vitals-window.ts")).toContain(
      "postMessage(VITALS_PORT_CHANNEL, null, [port2])",
    );
  });

  it("stands on the hardened window policy, as a host window with no product door", () => {
    const windows = source("main/windows.ts");
    const factory = windows.slice(windows.indexOf("export function createVitalsWindow"));
    expect(factory.slice(0, factory.indexOf("\n}\n"))).toContain(
      "assertSecurePreferences(webPreferences(opts.preloadPath))",
    );
    const host = source("main/vitals-window.ts");
    expect(host).toContain("installNavigationPolicy(next, opts.mode)");
    expect(host).toContain("opts.adopt(next)");
    const index = source("main/index.ts");
    expect(index).toContain(
      "adoptHostAuxiliary: (hostWindow) => registry.adoptHostAuxiliary(hostWindow)",
    );
    // a quit closes it before it asks the desk's window to close, so nothing waits on it
    const quit = index.slice(index.indexOf("onQuitRequested: () => {"));
    expect(quit.indexOf("vitals?.closeWindow()")).toBeLessThan(
      quit.indexOf("registry.beginShutdown()"),
    );
  });
});

describe("VT-4a — the Vitals window's own page does not die silently", () => {
  it("says its page process's end in main's log, with the reason and the exit code", () => {
    const host = source("main/vitals-window.ts");
    const gone = host.slice(host.indexOf('next.webContents.on("render-process-gone"'));
    const handler = gone.slice(0, gone.indexOf("installNavigationPolicy("));
    expect(handler).toContain('"desktop.vitals.window_process_gone"');
    expect(handler).toContain("reason: details.reason");
    expect(handler).toContain("exitCode: details.exitCode");
    // and it still lets go of the feed and tells the roster
    expect(handler).toContain("closeFeed();");
    expect(handler).toContain("opts.onChanged();");
  });
});

describe("VT-2 — the Window menu's Vitals", () => {
  const state = { view: "canvas", deck: "away" } as unknown as Parameters<typeof buildAppMenu>[1];
  const find = (
    items: ReturnType<typeof buildAppMenu>,
  ): { label?: string; accelerator?: string; enabled?: boolean; click?: unknown } | undefined => {
    for (const item of items) {
      for (const child of item.submenu ?? []) if (child.id === VITALS_ITEM_ID) return child;
    }
    return undefined;
  };

  it.each(["darwin", "other"] as const)(
    "stands in the Window menu with its key (%s)",
    (platform) => {
      const openVitals = (): void => undefined;
      const menu = buildAppMenu(platform, state, { openVitals });
      const windowMenu = menu.find((item) => item.label === "Window");
      expect(windowMenu?.submenu?.some((item) => item.id === VITALS_ITEM_ID)).toBe(true);
      const item = find(menu);
      expect(item?.label).toBe("Vitals");
      expect(item?.accelerator).toBe("Alt+CommandOrControl+V");
      expect(item?.enabled).toBe(true);
      expect(item?.click).toBe(openVitals);
    },
  );

  it("stays, disabled, where nothing can open it", () => {
    const item = find(buildAppMenu("darwin", state, {}));
    expect(item?.label).toBe("Vitals");
    expect(item?.enabled).toBe(false);
    expect(item?.click).toBeUndefined();
  });
});
