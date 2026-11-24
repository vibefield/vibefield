// VT-4b (track VT, 2026-11-24; VT-D11 A) — incidents in Electron main: what main alone sees die or stop responding,
// said to fieldd; and the Vitals window's one ask, an incident to open, which main reads for it and hands down the
// feed. Driven with fake contents, ports and clients: nothing here starts Electron.

import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VITALS } from "@vibefield/contracts";
import { VitalsIncidentReportParams } from "@vibefield/contracts/vitals";
import { describe, expect, it } from "vitest";
import {
  type VitalsFeedPort,
  VitalsFeedSession,
  type VitalsFielddClient,
} from "../src/main/vitals-feed";
import {
  type IncidentContents,
  readIncidentAsk,
  SHELL_INCIDENTS_HELD_MAX,
  type ShellIncidentClient,
  ShellIncidentReporter,
  VitalsIncidentAsks,
} from "../src/main/vitals-incidents";
import {
  parseVitalsEnvelope,
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

const T0 = 1_795_478_530_000;
const ID = "mwtxk4b4-0a1b2c3d";

class Client implements ShellIncidentClient {
  readonly sent: Array<{ method: string; params: unknown }> = [];
  refuse = false;
  async request(method: string, params?: unknown): Promise<unknown> {
    this.sent.push({ method, params });
    if (this.refuse) throw new Error("METHOD_NOT_FOUND");
    return { accepted: true };
  }
}

function reporter(client: Client | null = new Client()) {
  let current = client;
  const incidents = new ShellIncidentReporter({
    client: () => current,
    logger: silent,
    now: () => T0,
    pid: 3900,
  });
  return {
    incidents,
    setClient: (next: Client | null) => {
      current = next;
    },
    reports: () => (client?.sent ?? []).map((sent) => sent.params),
  };
}

class Contents extends EventEmitter {}

describe("VT-4b — what main reports", () => {
  it("says a Chromium child gone by the roster's role, with Chromium's reason, and never a clean exit", () => {
    const { incidents, reports } = reporter();
    incidents.childGone({ type: "GPU", reason: "crashed", exitCode: 11 });
    incidents.childGone({
      type: "Utility",
      reason: "oom",
      exitCode: 0,
      name: "Network Service",
    });
    incidents.childGone({ type: "Utility", reason: "clean-exit", exitCode: 0 });
    expect(reports()).toEqual([
      { kind: "exit", role: "gpu", at: T0, detail: { reason: "crashed", code: 11 } },
      {
        kind: "exit",
        role: "utility",
        label: "Network Service",
        at: T0,
        detail: { reason: "oom", code: 0 },
      },
    ]);
    for (const report of reports())
      expect(VitalsIncidentReportParams.safeParse(report).success).toBe(true);
  });

  it("says a page's process gone and its not responding by the role and pid it last had", () => {
    const { incidents, reports } = reporter();
    const contents = new Contents();
    let pid: number | null = 4133;
    incidents.watchContents(contents as unknown as IncidentContents, () => ({
      role: "window",
      pid,
    }));
    contents.emit("unresponsive");
    contents.emit("responsive");
    // a crashed page has no pid to read: the last one is said
    pid = null;
    contents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 139 });
    contents.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 });
    expect(reports()).toEqual([
      { kind: "unresponsive", role: "window", pid: 4133, at: T0 },
      { kind: "responsive", role: "window", pid: 4133, at: T0 },
      { kind: "exit", role: "window", pid: 4133, at: T0, detail: { reason: "crashed", code: 139 } },
    ]);
    // a page heard twice is said once
    incidents.watchContents(contents as unknown as IncidentContents, () => ({
      role: "window",
      pid,
    }));
    contents.emit("unresponsive");
    expect(reports()).toHaveLength(4);
  });

  it("says main's own error nobody caught, bounded, and nothing of its stack", () => {
    const { incidents, reports } = reporter();
    const error = new TypeError(`cannot read a thing${" at all".repeat(80)}`);
    error.stack = "TypeError: x\n    at /a/folder/main.js:1:1";
    incidents.mainError(error);
    incidents.mainError("a string thrown");
    const [first, second] = reports() as Array<{ detail: { errorName: string; message: string } }>;
    expect(first).toMatchObject({ kind: "error", role: "main", pid: 3900 });
    expect(first?.detail.errorName).toBe("TypeError");
    expect(first?.detail.message.length).toBeLessThanOrEqual(VITALS.INCIDENT_MESSAGE_MAX);
    expect(JSON.stringify(reports())).not.toContain("/a/folder");
    expect(second?.detail).toEqual({ errorName: "Error", message: "a string thrown" });
  });

  it("hears main's errors from the runtime's monitor, and lets go", () => {
    const { incidents, reports } = reporter();
    const runtime = new EventEmitter();
    const stop = incidents.listen(
      runtime as unknown as Parameters<ShellIncidentReporter["listen"]>[0],
    );
    runtime.emit("uncaughtExceptionMonitor", new Error("one"));
    stop();
    runtime.emit("uncaughtExceptionMonitor", new Error("two"));
    expect(reports()).toHaveLength(1);
  });

  it("holds what comes with no fieldd, a few at most, and says it when one is attached", () => {
    const later = new Client();
    const { incidents, setClient } = reporter(null);
    for (let n = 0; n < SHELL_INCIDENTS_HELD_MAX + 3; n++)
      incidents.childGone({ type: "GPU", reason: "crashed", exitCode: n });
    setClient(later);
    incidents.flush();
    expect(later.sent).toHaveLength(SHELL_INCIDENTS_HELD_MAX);
    // the newest are kept
    const newest = later.sent[later.sent.length - 1];
    expect((newest as { params: { detail: { code: number } } }).params.detail.code).toBe(
      SHELL_INCIDENTS_HELD_MAX + 2,
    );
  });

  it("says nothing once the app is quitting: what ends then was asked to", () => {
    const { incidents, reports } = reporter();
    incidents.leave();
    incidents.childGone({ type: "GPU", reason: "killed", exitCode: 9 });
    incidents.mainError(new Error("late"));
    expect(reports()).toEqual([]);
  });

  it("is mounted by Vitals' own composition: every page, every child, main's errors, and the quit", () => {
    const composed = source("main/vitals.ts");
    expect(composed).toContain("incidents.watchContents(contents, nameOf(contents));");
    expect(composed).toContain('app.on("child-process-gone", onChildGone);');
    expect(composed).toContain('app.on("will-quit", leaving);');
    expect(composed).toContain("incidents.listen(process)");
    expect(composed).toContain("if (client !== null) incidents.flush();");
    const dispose = composed.slice(composed.indexOf("dispose: () => {"));
    expect(dispose).toContain('app.off("child-process-gone", onChildGone);');
    expect(dispose).toContain("stopHearingMain();");
  });
});

describe("VT-4b — the window's one ask", () => {
  it("reads an incident's id and nothing else", () => {
    expect(readIncidentAsk(JSON.stringify({ v: 1, kind: "incident", id: ID }))).toBe(ID);
    for (const bad of [
      7,
      "nope",
      JSON.stringify({ v: 2, kind: "incident", id: ID }),
      JSON.stringify({ v: 1, kind: "vitals", id: ID }),
      JSON.stringify({ v: 1, kind: "incident", id: "../../etc/passwd" }),
      JSON.stringify({ v: 1, kind: "incident", id: { toString: ID } }),
      JSON.stringify({ v: 1, kind: "incident", id: ID, pad: "x".repeat(300) }),
    ])
      expect(readIncidentAsk(bad), String(bad)).toBeNull();
  });

  it("reads one at a time, the newest ask winning, and says down when fieldd cannot answer", async () => {
    const posted: Array<Record<string, unknown>> = [];
    const asked: string[] = [];
    let answer: ((value: unknown) => void) | null = null;
    const asks = new VitalsIncidentAsks(
      (id) => {
        asked.push(id);
        if (id.endsWith("ffffffff")) return Promise.reject(new Error("NOT_FOUND"));
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
      (message) => posted.push(message),
    );
    const ask = (id: string) => JSON.stringify({ v: 1, kind: "incident", id });
    asks.hear(ask("a-00000001"));
    asks.hear(ask("b-00000002"));
    asks.hear(ask("c-00000003"));
    expect(asked).toEqual(["a-00000001"]);
    (answer as unknown as (value: unknown) => void)({ id: "a-00000001" });
    await settle();
    // the one in between was dropped for the newest
    expect(asked).toEqual(["a-00000001", "c-00000003"]);
    (answer as unknown as (value: unknown) => void)({ id: "c-00000003" });
    await settle();
    asks.hear(ask("d-ffffffff"));
    await settle();
    expect(posted).toEqual([
      { kind: "incident", event: "snapshot", payload: { id: "a-00000001" } },
      { kind: "incident", event: "snapshot", payload: { id: "c-00000003" } },
      { kind: "incident", event: "down", id: "d-ffffffff" },
    ]);
  });

  it("is relayed by the feed: the window's ask reaches fieldd's door, and the answer comes down the port", async () => {
    class AskingPort implements VitalsFeedPort {
      readonly sent: Array<Record<string, unknown>> = [];
      private readonly listeners = new Map<string, (event?: { data: unknown }) => void>();
      postMessage(message: string): void {
        this.sent.push(JSON.parse(message) as Record<string, unknown>);
      }
      start(): void {}
      close(): void {}
      on(event: "close" | "message", listener: (event?: { data: unknown }) => void): void {
        this.listeners.set(event, listener);
      }
      ask(data: unknown): void {
        this.listeners.get("message")?.({ data });
      }
    }
    const requests: Array<{ method: string; params: unknown }> = [];
    const client: VitalsFielddClient = {
      status: "ready",
      onStatusChange: () => () => undefined,
      subscribe: async () => ({ snapshot: {}, unsubscribe: () => undefined }),
      request: async (method, params) => {
        requests.push({ method, params });
        return { id: ID, whole: true };
      },
    };
    const port = new AskingPort();
    const session = new VitalsFeedSession(port, {
      onFieldd: (listener) => {
        listener(client);
        return () => undefined;
      },
      logger: silent,
      now: () => T0,
    });
    session.start();
    await settle();
    port.ask(JSON.stringify({ v: 1, kind: "incident", id: ID }));
    port.ask(JSON.stringify({ v: 1, kind: "terminal.write", id: ID }));
    await settle();
    expect(requests).toEqual([{ method: "vitals.incidents.get", params: { id: ID } }]);
    expect(port.sent.at(-1)).toEqual({
      v: 1,
      kind: "incident",
      event: "snapshot",
      payload: { id: ID, whole: true },
    });
    session.close();
  });
});

describe("VT-4b — the window's preload carries the ask and its answer", () => {
  class Port implements VitalsRendererPort {
    readonly posted: string[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    start(): void {}
    close(): void {}
    postMessage(message: string): void {
      this.posted.push(message);
    }
  }

  it("sends an incident's id, and nothing that is not one", () => {
    const bridge = new VitalsPreloadBridge();
    const port = new Port();
    bridge.attach(port);
    bridge.openIncident(ID);
    for (const bad of ["../x", 7, { id: ID }, `${ID}\n`]) bridge.openIncident(bad);
    expect(port.posted).toEqual([JSON.stringify({ v: 1, kind: "incident", id: ID })]);
  });

  it("hands the page one incident whole, or the id main could not read", () => {
    expect(
      parseVitalsEnvelope(
        JSON.stringify({ v: 1, kind: "incident", event: "snapshot", payload: { id: ID } }),
      ),
    ).toEqual({ kind: "incident", event: "snapshot", payload: { id: ID } });
    expect(
      parseVitalsEnvelope(JSON.stringify({ v: 1, kind: "incident", event: "down", id: ID })),
    ).toEqual({ kind: "incident", event: "down", id: ID });
    expect(
      parseVitalsEnvelope(JSON.stringify({ v: 1, kind: "incident", event: "delta", payload: 1 })),
    ).toBeNull();
  });
});
