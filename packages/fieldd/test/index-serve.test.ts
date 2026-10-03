// SP-3 (thinking-sync-planes.md §5.4, §6; design-06 §6, §8) — ROSETTAD'S SERVE,
// the route-per-process driver's second user. Two halves, as TM-2's own file
// has them:
//   · the POLICY, pure — when the serve exists, what it is, and when the set a
//     ticket would name is real;
//   · the WIRING, against the mock floor and the scripted rosettad — that
//     daemon.ts drives it off the supervisor's transitions behind the flag, and
//     that with the flag OFF (the default, until DS-7) nothing happens at all.
//     *AR-8b (2026-10-03): the default is ON — rosettad runs behind a bearer
//     and a grant key now — and OFF is a config's word, still honest; the
//     serve stands only on a generation whose ready line enforces both.*
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PORTS, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, type FielddDaemon } from "../src/index";
import {
  INDEX_SERVE_ID,
  IndexServeDriver,
  indexEndpointsFrom,
  indexPlaneLive,
  indexServeSpec,
  indexTargetPort,
} from "../src/index-serve";
import type { ServeSpec, ServeState } from "../src/mesh-client";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { until } from "./ws-rpc";

const ORIGIN = "http://127.0.0.1:51234";

describe("SP-3 — rosettad's serve, from the readings", () => {
  const ready = { enabled: true, origin: ORIGIN, linkedLogin: TEST_LOGIN };

  it("publishes the whole index listener onto rosettad's loopback port, gated by the login", () => {
    expect(indexServeSpec(ready)).toEqual({
      serveId: INDEX_SERVE_ID,
      name: INDEX_SERVE_ID,
      listenPort: PORTS.INDEX_SERVE,
      target: { kind: "port", port: 51234 },
      tls: false,
      allow: [TEST_LOGIN],
    } satisfies ServeSpec);
  });

  it("AR-8b — the plane stands only on a ready generation that enforces a bearer AND grants", () => {
    const state = {
      phase: "ready" as const,
      origin: ORIGIN,
      detail: null,
      pid: 1,
      protocolVersion: 26,
      announce: null,
      enrollRefusals: [],
      auth: { bearer: true, grants: true, origins: [] },
    };
    expect(indexPlaneLive(state)).toBe(true);
    expect(indexPlaneLive(null)).toBe(false);
    expect(indexPlaneLive({ ...state, phase: "restarting" })).toBe(false);
    expect(indexPlaneLive({ ...state, origin: null })).toBe(false);
    expect(indexPlaneLive({ ...state, auth: null })).toBe(false);
    expect(indexPlaneLive({ ...state, auth: { bearer: true, grants: false, origins: [] } })).toBe(
      false,
    );
    expect(indexPlaneLive({ ...state, auth: { bearer: false, grants: true, origins: [] } })).toBe(
      false,
    );
  });

  it("publishes nothing with the flag off, with no linked login, or with no daemon to aim at", () => {
    expect(indexServeSpec({ ...ready, enabled: false })).toBeNull();
    expect(indexServeSpec({ ...ready, linkedLogin: null })).toBeNull();
    expect(indexServeSpec({ ...ready, origin: null })).toBeNull();
  });

  it("aims only at a literal loopback http origin with a port", () => {
    expect(indexTargetPort(ORIGIN)).toBe(51234);
    for (const origin of [
      null,
      "http://localhost:51234",
      "http://127.0.0.2:51234",
      "https://127.0.0.1:51234",
      "http://127.0.0.1",
      "http://desk.ts.net:51234",
      "not an origin",
    ]) {
      expect(indexTargetPort(origin), String(origin)).toBeUndefined();
    }
  });

  it("names a session's set only off the LIVE serve aimed at the rosettad answering now", () => {
    const live = (over: Partial<ServeState> = {}): ServeState => ({
      ...(indexServeSpec(ready) as ServeSpec),
      status: "active",
      url: "http://desk.tail1234.ts.net:9424",
      ...over,
    });
    expect(indexEndpointsFrom([live()], ORIGIN, "s1")).toEqual({
      sessionUrl: "ws://desk.tail1234.ts.net:9424/ws/sessions/s1",
    });
    // the node has not taken it yet, or reported it failed
    expect(indexEndpointsFrom([live({ status: "pending" })], ORIGIN, "s1")).toBeUndefined();
    expect(indexEndpointsFrom([live({ status: "error" })], ORIGIN, "s1")).toBeUndefined();
    // rosettad restarted on another port and the re-aim has not landed: the
    // serve forwards to a dead port, and a URL into it is nothing to act on
    expect(indexEndpointsFrom([live()], "http://127.0.0.1:51240", "s1")).toBeUndefined();
    // rosettad is down
    expect(indexEndpointsFrom([live()], null, "s1")).toBeUndefined();
    // no index serve at all
    expect(indexEndpointsFrom([], ORIGIN, "s1")).toBeUndefined();
  });

  it("re-aims across a rosettad restart: withdraw while it is down, declare the new port", async () => {
    let origin: string | null = null;
    const declared: Array<ServeSpec | null> = [];
    const driver = new IndexServeDriver({
      enabled: () => true,
      origin: () => origin,
      linkedLogin: () => TEST_LOGIN,
      declare: async (spec) => {
        declared.push(spec);
        return true;
      },
    });
    await driver.refresh(); // F-H1: the first reading is declared, even "nothing"
    origin = ORIGIN;
    await driver.refresh();
    origin = null; // restarting
    await driver.refresh();
    origin = "http://127.0.0.1:51240";
    await driver.refresh();
    await driver.refresh(); // replayed: not news
    expect(declared.map((s) => (s?.target.kind === "port" ? s.target.port : null))).toEqual([
      null,
      51234,
      null,
      51240,
    ]);
  });
});

// ---------------------------------------------------------------------------
// The wiring: daemon.ts drives it off the supervisor, behind the flag.

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-rosettad.mjs");
const fakeRosettad = ((_bin: string, args: readonly string[], options: object) =>
  spawn(process.execPath, [FAKE, ...args], {
    ...options,
    env: { ...process.env, FAKE_ROSETTAD_MODE: "ok" },
  })) as unknown as typeof spawn;

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* an already-stopped daemon is fine */
    }
  }
  cleanup = [];
});

async function boot(opts: { indexDirectPlane?: boolean }) {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-index-serve-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir); // a linked desktop: the login gate is open
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    rosettadBin: "/stand-in/rosettad",
    rosettadSpawn: fakeRosettad,
    rosettadHome: home, // an EMPTY home: nothing of the developer's is read
    ...(opts.indexDirectPlane !== undefined ? { indexDirectPlane: opts.indexDirectPlane } : {}),
  });
  cleanup.push(() => daemon.stop());
  return { daemon, mock };
}

/** Every serve.add that declared rosettad's listener, in order. */
const indexAdds = (mock: MockMgmtServer) =>
  mock.meshAddParams.filter((p) => p["serveId"] === INDEX_SERVE_ID);

/** rosettad's loopback port while it is ready. */
const rosettadPort = (daemon: FielddDaemon): number | undefined =>
  indexTargetPort(daemon.rosettad?.state().origin ?? null);

describe("SP-3 — daemon.ts drives rosettad's serve behind `indexDirectPlane`", () => {
  it("flag on: publishes the index listener onto the ready daemon, and answers a session's set off it", async () => {
    const { daemon, mock } = await boot({ indexDirectPlane: true });
    await until(() => indexAdds(mock).length > 0, 15_000);
    const port = rosettadPort(daemon);
    expect(port).toBeTypeOf("number");
    const [add] = indexAdds(mock);
    expect(add).toMatchObject({
      serveId: INDEX_SERVE_ID,
      name: INDEX_SERVE_ID,
      listenPort: PORTS.INDEX_SERVE,
      target: { kind: "port", port },
      tls: false,
      allow: [TEST_LOGIN],
    });
    // the product door's provenance proof is the product door's alone
    expect(add).not.toHaveProperty("pathSecret");
    expect(add).not.toHaveProperty("routes");
    // …beside the product door, on a listener of its own
    expect(mock.meshServes.get("product")?.listenPort).toBe(PORTS.FIELDD_PRODUCT_SERVE);
    expect(mock.meshServes.get(INDEX_SERVE_ID)?.listenPort).toBe(PORTS.INDEX_SERVE);

    await until(
      () =>
        indexEndpointsFrom(daemon.mesh.serves(), daemon.rosettad?.state().origin ?? null, "s1") !==
        undefined,
      8_000,
    );
    expect(
      indexEndpointsFrom(daemon.mesh.serves(), daemon.rosettad?.state().origin ?? null, "s1"),
    ).toEqual({ sessionUrl: `ws://mock.ts.net:${PORTS.INDEX_SERVE}/ws/sessions/s1` });
  }, 30_000);

  it("flag on: a rosettad restart withdraws the serve and re-aims it at the new generation", async () => {
    const { daemon, mock } = await boot({ indexDirectPlane: true });
    await until(() => indexAdds(mock).length === 1, 15_000);
    const removedBefore = mock.meshRemovedServeIds.filter((id) => id === INDEX_SERVE_ID).length;
    await daemon.rosettad?.requestRestart();
    await until(() => indexAdds(mock).length === 2, 15_000);
    const port = rosettadPort(daemon);
    expect(indexAdds(mock)[1]?.["target"]).toEqual({ kind: "port", port });
    // truffle has no update: the old listener came down first
    expect(mock.meshRemovedServeIds.filter((id) => id === INDEX_SERVE_ID).length).toBeGreaterThan(
      removedBefore,
    );
    // and the product door was not bounced by it
    expect(mock.meshServes.get("product")?.listenPort).toBe(PORTS.FIELDD_PRODUCT_SERVE);
  }, 30_000);

  it("AR-8b — the default is ON: a credentialed daemon's listener is published with no flag set", async () => {
    const { daemon, mock } = await boot({});
    await until(() => indexAdds(mock).length > 0, 15_000);
    expect(daemon.rosettad?.state().auth).toMatchObject({ bearer: true, grants: true });
    expect(indexAdds(mock)[0]?.["target"]).toEqual({ kind: "port", port: rosettadPort(daemon) });
  }, 30_000);

  it("flag OFF by config (the honest off path): nothing is published, nothing is even asked", async () => {
    const { daemon, mock } = await boot({ indexDirectPlane: false });
    // the daemon got all the way: its door is declared and rosettad is ready
    await until(() => mock.meshServes.get("product") !== undefined, 15_000);
    await until(() => daemon.health().rosettad.phase === "ready", 15_000);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(indexAdds(mock)).toEqual([]);
    expect(mock.meshRemovedServeIds).not.toContain(INDEX_SERVE_ID);
    expect(mock.meshServes.has(INDEX_SERVE_ID)).toBe(false);
  }, 30_000);
});
