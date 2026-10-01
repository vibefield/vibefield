// SP-1 (SP-L4) — the whole-value doors a phone can open, on the projection
// helper, over a real daemon: the roster (`device.subscribe`), the artifact
// catalog, the service registry and the profile sets. Each row proves two
// things an existing client depends on:
//   · the WIRE is what it was — the open answers the whole value the one-shot
//     read answers, and every later frame is a `<base>.delta` carrying the
//     whole value again (never a `.snapshot`, never a patch);
//   · the FLOOR holds — a burst of changes inside one window reaches a reader
//     as ONE frame carrying the newest value, where it used to reach it as one
//     frame per change.
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentsProfileSetsListResult,
  ArtifactListResult,
  type DeviceInfo,
  DeviceListResult,
  PRODUCT_API_LIMITS,
  ServicesSnapshot,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FLOOR = PRODUCT_API_LIMITS.STREAM_MIN_INTERVAL_MS;

async function boot(
  configure?: (mock: MockMgmtServer) => void,
  config: Partial<Parameters<typeof bootstrap>[0]> = {},
): Promise<{ daemon: FielddDaemon; mock: MockMgmtServer; rpc: WsRpc }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-sd-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir);
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  configure?.(mock);
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({ ...config, dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, daemon.shellToken, "shell-main");
  return { daemon, mock, rpc };
}

/** every frame this subscription has been sent, in order */
const framesOf = (rpc: WsRpc, subId: string) =>
  rpc.notifications.filter((n) => n.params.subId === subId);

/** wait until the stream has been quiet for two floors */
async function settle(rpc: WsRpc, subId: string): Promise<void> {
  let seen = -1;
  for (;;) {
    const now = framesOf(rpc, subId).length;
    if (now === seen) return;
    seen = now;
    await sleep(FLOOR * 2);
  }
}

/** The floor's own bound on a burst of changes spread over `burstMs`: a window
 * opens at the first change after the last one closed and lasts one floor, and
 * each window sends at most one frame — so at most floor(burst / floor) + 1. A
 * stream with no floor sends one frame per change instead. `slackMs` covers a
 * source that publishes a beat behind the call that changed it. */
const floorBound = (burstMs: number, slackMs = 100): number =>
  Math.floor((burstMs + slackMs) / FLOOR) + 1;

/** wait until a one-shot read answers the same thing for two floors running —
 * so a reader that arrives next sees only the burst the row makes */
async function quiet(read: () => Promise<unknown>): Promise<void> {
  let last = "";
  for (;;) {
    const now = JSON.stringify(await read());
    if (now === last) return;
    last = now;
    await sleep(FLOOR * 2);
  }
}

describe("SP-1 — the whole-value doors on the projection helper, their wire unchanged", () => {
  it("device.subscribe: the roster whole, as it was; a burst of moves is ONE frame", async () => {
    const { daemon, rpc } = await boot((mock) => {
      mock.meshPeers = [
        {
          id: "node-b",
          deviceId: "dev-b",
          name: "b",
          online: true,
          whois: { login: TEST_LOGIN },
        },
      ];
    });
    await until(() => daemon.devices.list().some((d) => d.deviceId === "dev-b"), 8_000);
    // what dev-b's door last said, scripted (the DS-L8 rows' own seam)
    const doors = new Map<string, "answers" | "silent">([["dev-b", "answers"]]);
    const view = Object.assign(new EventEmitter(), {
      linkState: () => undefined,
      doorState: (id: string) => doors.get(id),
    });
    daemon.devices.attachPeerLink(view);
    view.emit("door-changed", {});
    await until(
      () => daemon.devices.list().find((d) => d.deviceId === "dev-b")?.state === "awake",
      8_000,
    );
    await quiet(() => rpc.call("device.list", {}));

    const sub = (await rpc.call("device.subscribe", {})) as { subId: string; snapshot: unknown };
    const listed = (await rpc.call("device.list", {})) as { devices: DeviceInfo[] };
    // the open answer is the one-shot read, whole
    expect(sub.snapshot).toEqual(listed.devices);
    expect(DeviceListResult.safeParse({ devices: sub.snapshot }).success).toBe(true);

    // eleven moves of dev-b's door inside one window: awake ↔ restarting
    for (let i = 0; i <= 10; i += 1) {
      doors.set("dev-b", i % 2 === 0 ? "silent" : "answers");
      view.emit("door-changed", {});
    }
    await until(() => framesOf(rpc, sub.subId).length > 0, 4_000);
    await settle(rpc, sub.subId);
    const frames = framesOf(rpc, sub.subId);
    expect(frames.map((f) => f.method)).toEqual(["device.delta"]);
    const payload = frames[0]?.params.payload;
    expect(DeviceListResult.safeParse({ devices: payload }).success).toBe(true);
    expect(payload).toEqual(((await rpc.call("device.list", {})) as { devices: unknown }).devices);
    expect((payload as DeviceInfo[]).find((d) => d.deviceId === "dev-b")?.state).toBe("restarting");
  }, 30_000);

  it("services.subscribe: the registry whole, as it was; four providers in one tick are ONE frame", async () => {
    const { daemon, rpc } = await boot();
    const sub = (await rpc.call("services.subscribe", {})) as { subId: string; snapshot: unknown };
    expect(sub.snapshot).toEqual(await rpc.call("services.list", {}));
    expect(ServicesSnapshot.safeParse(sub.snapshot).success).toBe(true);

    for (const id of ["com.example.sd1", "com.example.sd2", "com.example.sd3", "com.example.sd4"])
      daemon.services.register({
        pluginId: id,
        namespace: `x.${id}`,
        declarations: [],
        implemented: [],
        handlers: {
          call: async () => ({}),
          subscribe: async () => () => {},
        },
      });
    await until(() => framesOf(rpc, sub.subId).length > 0, 4_000);
    await settle(rpc, sub.subId);
    const frames = framesOf(rpc, sub.subId);
    expect(frames.map((f) => f.method)).toEqual(["services.delta"]);
    const payload = frames[0]?.params.payload;
    expect(ServicesSnapshot.safeParse(payload).success).toBe(true);
    expect(payload).toEqual(await rpc.call("services.list", {}));
    expect(
      (payload as { providers: Array<{ namespace: string }> }).providers
        .map((p) => p.namespace)
        .filter((ns) => ns.startsWith("x.com.example.sd")),
    ).toHaveLength(4);
  }, 30_000);

  it("artifact.subscribe: the catalog whole, as it was; five renames 30 ms apart are one frame per window", async () => {
    const source = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("ok");
    });
    await new Promise<void>((resolve, reject) => {
      source.once("error", reject);
      source.listen(0, "127.0.0.1", resolve);
    });
    cleanup.push(() => new Promise<void>((resolve) => source.close(() => resolve())));
    const address = source.address();
    if (address === null || typeof address === "string") throw new Error("source did not bind");
    const { rpc } = await boot();
    const artifactId = "01J9ZZZZZZZZZZZZZZZZZZZZZZ";
    await rpc.call("artifact.publish", {
      artifactId,
      title: "first",
      source: { kind: "proxy", port: address.port, scheme: "http" },
    });
    // let the catalog go quiet before the reader arrives
    await quiet(() => rpc.call("artifact.list", {}));

    const sub = (await rpc.call("artifact.subscribe", {})) as { subId: string; snapshot: unknown };
    const listed = (await rpc.call("artifact.list", {})) as { artifacts: unknown[] };
    expect(sub.snapshot).toEqual(listed.artifacts);
    expect(ArtifactListResult.safeParse({ artifacts: sub.snapshot }).success).toBe(true);

    const started = Date.now();
    for (const title of ["second", "third", "fourth", "fifth", "sixth"]) {
      await rpc.call("artifact.update", { artifactId, title });
      await sleep(30);
    }
    const burstMs = Date.now() - started;
    await until(() => framesOf(rpc, sub.subId).length > 0, 4_000);
    await settle(rpc, sub.subId);
    const frames = framesOf(rpc, sub.subId);
    expect(new Set(frames.map((f) => f.method))).toEqual(new Set(["artifact.delta"]));
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames.length, `${frames.length} frames over a ${burstMs} ms burst`).toBeLessThanOrEqual(
      floorBound(burstMs),
    );
    const last = frames.at(-1)?.params.payload;
    expect(ArtifactListResult.safeParse({ artifacts: last }).success).toBe(true);
    expect(last).toEqual(
      ((await rpc.call("artifact.list", {})) as { artifacts: unknown }).artifacts,
    );
    expect((last as Array<{ title?: string }>)[0]?.title).toBe("sixth");
  }, 30_000);

  it("agents.profileSets.subscribe: the sets whole, as they were; five new profiles 30 ms apart are one frame per window", async () => {
    const { rpc } = await boot();
    const sub = (await rpc.call("agents.profileSets.subscribe", {})) as {
      subId: string;
      snapshot: unknown;
    };
    expect(AgentsProfileSetsListResult.safeParse(sub.snapshot).success).toBe(true);
    // what the door published right behind its open (`publish()`), and anything
    // a read finished, before the burst
    await settle(rpc, sub.subId);
    const before = framesOf(rpc, sub.subId).length;

    // the sets' own publisher coalesces at a 16 ms tick, so the changes are
    // spaced past it: each one is its own frame unless a floor holds it
    const started = Date.now();
    for (const label of ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]) {
      await rpc.call("agents.profileSets.create", { label });
      await sleep(30);
    }
    const burstMs = Date.now() - started;
    await until(() => framesOf(rpc, sub.subId).length > before, 4_000);
    await settle(rpc, sub.subId);
    const frames = framesOf(rpc, sub.subId).slice(before);
    expect(new Set(frames.map((f) => f.method))).toEqual(new Set(["agents.profileSets.delta"]));
    expect(frames.length, `${frames.length} frames over a ${burstMs} ms burst`).toBeLessThanOrEqual(
      floorBound(burstMs),
    );
    const last = frames.at(-1)?.params.payload;
    expect(AgentsProfileSetsListResult.safeParse(last).success).toBe(true);
    expect(last).toEqual(await rpc.call("agents.profileSets.list", {}));
    expect((last as { sets: Array<{ label: string }> }).sets.map((set) => set.label)).toEqual(
      expect.arrayContaining(["Alpha", "Beta", "Gamma", "Delta", "Epsilon"]),
    );
  }, 30_000);
});

// SP-1 — the index rows' floors are FLOORS at the door. They were defaults a
// caller could undercut to the schema's 16 ms; the registry now declares them
// (`methods.ts`), so the door serves a faster ask at the floor.
describe("SP-1 — index.changes.subscribe serves a faster ask at its floor", () => {
  it("two catalog moves 50 ms apart reach a 16 ms asker one floor apart", async () => {
    const floorMs = 1_000;
    const { daemon, rpc } = await boot(undefined, { indexMesh: { changesMinIntervalMs: floorMs } });
    const sub = (await rpc.call("index.changes.subscribe", { minIntervalMs: 16 })) as {
      subId: string;
      snapshot: unknown;
    };
    expect(sub.snapshot).toMatchObject({ snapshot: { rows: [] } });
    // this desktop's catalog moving, as its follower says it (the one listener)
    const move = () => daemon.indexCatalog.emit("phase", daemon.indexCatalog.phase);
    move();
    await until(() => framesOf(rpc, sub.subId).length === 1, 4_000);
    await sleep(50);
    move();
    await until(() => framesOf(rpc, sub.subId).length === 2, floorMs * 4);
    const [first, second] = framesOf(rpc, sub.subId);
    expect(first?.method).toBe("index.changes.delta");
    expect(second?.method).toBe("index.changes.delta");
    const spacing = (second?.receivedAt ?? 0) - (first?.receivedAt ?? 0);
    expect(
      spacing,
      `frames ${spacing} ms apart under a ${floorMs} ms floor`,
    ).toBeGreaterThanOrEqual(floorMs * 0.6);
    // the frames are the rows pings they were: empty rows, a chained revision
    expect(second?.params.payload).toMatchObject({ upserts: [], removed: [] });
    const since = (second?.params.payload as { since?: number } | undefined)?.since;
    const revision = (first?.params.payload as { revision?: number } | undefined)?.revision;
    expect(since).toBeDefined();
    expect(since).toBe(revision);
  }, 30_000);
});
