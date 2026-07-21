// C5 end-to-end (design-04 §3.2 D32 / §6 D35): TWO REAL fieldd daemons (A and
// B), each on its own mock mgmt server, joined by a sidecar-simulating ws-ctor.
// A dials B's product surface through B's tailnet door — the secret route path
// lifted from B's OWN health capability URL — so this exercises PeerLink's real
// dial and B executing under the peer-fieldd principal (the TAILNET preset).
// Covers the forward, the REMOTE scope gate, offline/unreachable honesty,
// one-connection-per-peer, the roster link fold, and idle re-dial.
//
// RECORDED DIVERGENCE from the C5 recipe (both mocks pin device_id "dev-self",
// so A and B necessarily SHARE an identity): a *read* forward THROUGH A's
// product WS with {device:"dev-b"} cannot return B's data — B never recognises
// "dev-b" as itself (its own id is "dev-self"), so B re-routes the call and
// fails its own endpointFor. There is no id that is simultaneously foreign to A
// (so A forwards) and equal to B's own id (so B serves locally) when A and B
// share "dev-self". We therefore drive the read forward at `A.peers.request(...)`
// — the exact object A's `device?` router delegates to — with post-routing
// params (no device key), so B serves locally. The REMOTE scope gate DOES ride
// A's product WS end to end (test 2): the scope check precedes device routing,
// so B refuses mintWindowToken at its gate before any re-route. The A-side
// `device?` routing hop itself is unit-tested in device-routing.test.ts.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACTS_VERSION, type DeviceInfo, type DeviceSlice } from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon, PeerLink } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { helloAs, until, WsRpc } from "./ws-rpc";

const LOGIN = "me@jamesyong42.com";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** A mock mgmt server on <dataDir>/native/run/mgmt.sock, bootstrap-ready. */
async function startMock(dataDir: string): Promise<MockMgmtServer> {
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

function makeDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-c5-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  return dataDir;
}

/** The sidecar-simulating ws-ctor: dials the url UNCHANGED (the secret path is
 * already in it) but injects the WhoIs login header the real sidecar would add.
 * Returns a fresh dial counter so tests can assert one-connection-per-peer. */
function sidecar(): { ctor: WsCtor; dials: () => number } {
  let count = 0;
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      count += 1;
      super(url, { headers: { "Tailscale-User-Login": LOGIN } });
    }
  }
  return { ctor: SidecarSim, dials: () => count };
}

/** B's capability secret = the route path fieldd composes into its own health
 * serve URL (base + /t/<secret>). The serve reconcile is fire-and-forget at
 * bootstrap, so poll until it lands. */
async function capabilitySecret(daemon: FielddDaemon): Promise<string> {
  await until(
    () => daemon.health().mesh.serves.some((s) => s.name === "product" && s.url !== undefined),
    8000,
  );
  const url = daemon.health().mesh.serves.find((s) => s.name === "product")?.url;
  const secret = url?.split("/t/")[1];
  if (secret === undefined || secret.length === 0)
    throw new Error(`no capability secret in serve url: ${url}`);
  return secret;
}

/** A valid peer DeviceSlice whose product endpoint points at a real loopback
 * control port + secret path (the thing PeerLink dials). */
function peerSlice(deviceId: string, endpointUrl: string): DeviceSlice {
  return {
    deviceId,
    name: `device-${deviceId}`,
    platform: "linux",
    headless: false,
    fielddVersion: "0.1.0",
    contractsVersion: CONTRACTS_VERSION,
    capabilities: { terminalHost: false, docHost: true, push: false },
    productEndpoint: { serve: "product", url: endpointUrl },
    bootId: `boot-${deviceId}`,
    publishedAt: Date.now(),
  };
}

async function openRpc(port: number): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

interface Pair {
  A: FielddDaemon;
  B: FielddDaemon;
  mockA: MockMgmtServer;
  mockB: MockMgmtServer;
  /** how many sockets A's PeerLink dialed through the sidecar sim */
  dials: () => number;
  /** B's loopback capability URL (http + /t/<secret>) — what A dials */
  bEndpoint: string;
}

/** Bootstrap two real daemons and wire A→B: extract B's capability secret from
 * B's own health, publish B into A's store as a DISTINCT id ("dev-b"), and wait
 * for A's roster to carry it (so A.peers.endpointFor resolves). */
async function bootPair(): Promise<Pair> {
  // B first — A needs B's capability secret + control port to build the slice.
  const dirB = makeDataDir();
  const mockB = await startMock(dirB);
  const B = await bootstrap({ dataDir: dirB, controlPort: 0, dataPort: 0 });
  cleanup.push(() => B.stop());
  const secret = await capabilitySecret(B);
  const bEndpoint = `http://127.0.0.1:${B.controlPort}/t/${secret}`;

  // A dials peers through the sidecar sim (injected as the peer ws-ctor).
  const { ctor, dials } = sidecar();
  const dirA = makeDataDir();
  const mockA = await startMock(dirA);
  const A = await bootstrap({ dataDir: dirA, controlPort: 0, dataPort: 0, peerWebSocket: ctor });
  cleanup.push(() => A.stop());

  // Publish B into A's store as "dev-b". A DISTINCT id is required: both mocks
  // report device_id "dev-self", so B's real id collides with A's own —
  // "dev-b" makes A treat it as a peer and lets endpointFor find B's loopback.
  await until(() => mockA.storeWrites.length > 0); // A's store sub is live
  mockA.pushStoreDelta({
    kind: "peerUpdated",
    deviceId: "dev-b",
    data: peerSlice("dev-b", bEndpoint),
    version: 1,
  });
  await until(() => A.devices.get("dev-b") !== undefined, 4000);

  return { A, B, mockA, mockB, dials, bEndpoint };
}

interface Docs {
  docs: Array<{ name: string; docId: string }>;
}

describe("PeerLink e2e — two real daemons over the tailnet door", () => {
  it("refuses renderer document persistence at B's remote boundary", async () => {
    const { A, B } = await bootPair();

    // seed a doc on B directly (B's own product WS, its shell token)
    const rpcB = await openRpc(B.controlPort);
    await helloAs(rpcB, B.shellToken, "shell-main");
    await rpcB.call("doc.create", { name: "b-doc" });

    const rpcA = await openRpc(A.controlPort);
    await helloAs(rpcA, A.shellToken, "shell-main");
    const readDenied = await rpcA.callErr("doc.list", { device: "dev-b" });
    const writeDenied = await rpcA.callErr("doc.create", {
      device: "dev-b",
      name: "from-a",
    });
    expect(readDenied.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(writeDenied.data?.kind).toBe("FORBIDDEN_SCOPE");

    const afterB = (await rpcB.call("doc.list", {})) as Docs;
    expect(afterB.docs.map((doc) => doc.name)).toEqual(["b-doc"]);
  }, 30_000);

  it("the REMOTE end enforces the peer preset: mintWindowToken is refused at B", async () => {
    const { A } = await bootPair();
    const rpcA = await openRpc(A.controlPort);
    await helloAs(rpcA, A.shellToken, "shell-main"); // all scopes, incl tokens.mint

    // A's LOCAL check passes (shell has tokens.mint); the call forwards to B,
    // whose peer principal (TAILNET preset) lacks tokens.mint. This proves the
    // REMOTE gate: the scope check precedes device routing, so B refuses before
    // any re-route.
    const err = await rpcA.callErr("system.mintWindowToken", {
      device: "dev-b",
      scopes: [],
      label: "x",
    });
    expect(err.data?.kind).toBe("FORBIDDEN_SCOPE");
  }, 30_000);

  it("no endpoint → UNAVAILABLE {state:'offline'}", async () => {
    const { A } = await bootPair();
    const rpcA = await openRpc(A.controlPort);
    await helloAs(rpcA, A.shellToken, "shell-main");

    const err = await rpcA.callErr("doc.list", { device: "dev-unknown" });
    expect(err.data?.kind).toBe("UNAVAILABLE");
    expect(err.data?.details).toEqual({ device: "dev-unknown", state: "offline" });
  }, 30_000);

  it("a dead endpoint → UNAVAILABLE {state:'unreachable'} within the per-call deadline", async () => {
    const { A, mockA } = await bootPair();
    // a slice whose capability URL points at a CLOSED port (refused fast)
    mockA.pushStoreDelta({
      kind: "peerUpdated",
      deviceId: "dev-dead",
      data: peerSlice("dev-dead", "http://127.0.0.1:1/t/x"),
      version: 1,
    });
    await until(() => A.devices.get("dev-dead") !== undefined, 4000);

    const rpcA = await openRpc(A.controlPort);
    await helloAs(rpcA, A.shellToken, "shell-main");
    const started = Date.now();
    const err = await rpcA.callErr("doc.list", { device: "dev-dead" });
    expect(err.data?.kind).toBe("UNAVAILABLE");
    expect((err.data?.details as { state?: string } | undefined)?.state).toBe("unreachable");
    expect(Date.now() - started).toBeLessThan(15_000); // the 8s per-call deadline
  }, 30_000);

  it("one outbound connection per peer: two forwards reuse a single socket", async () => {
    const { A, dials } = await bootPair();
    await A.peers.request("dev-b", "doc.list", {});
    await A.peers.request("dev-b", "doc.list", {});
    expect(A.peers.linkState("dev-b")).toBe("connected");
    expect(dials()).toBe(1);
  }, 30_000);

  it("the roster folds link:'connected' for a dialed peer, never for self", async () => {
    const { A } = await bootPair();
    await A.peers.request("dev-b", "doc.list", {}); // establish the link

    const rpcA = await openRpc(A.controlPort);
    await helloAs(rpcA, A.shellToken, "shell-main");
    const list = (await rpcA.call("device.list", {})) as { devices: DeviceInfo[] };
    expect(list.devices.find((d) => d.deviceId === "dev-b")?.link).toBe("connected");
    expect(list.devices.find((d) => d.self)?.link).toBeUndefined();
  }, 30_000);

  it("an idle link is swept closed and the next call re-dials", async () => {
    const { bEndpoint } = await bootPair(); // reuse B (the pair's dial target)
    const { ctor, dials } = sidecar();
    const link = new PeerLink({
      ownDeviceId: () => "dev-a",
      endpointFor: () => bEndpoint,
      webSocket: ctor,
      idleCloseMs: 60, // sweeper runs every min(60, 60_000) = 60ms
    });
    cleanup.push(() => link.dispose());

    await link.request("dev-b", "doc.list", {});
    expect(dials()).toBe(1);
    expect(link.linkState("dev-b")).toBe("connected");

    // the sweeper closes the idle link; linkState goes undefined
    await until(() => link.linkState("dev-b") === undefined, 3000);

    await link.request("dev-b", "doc.list", {});
    expect(dials()).toBe(2); // re-dialed a fresh socket
  }, 30_000);
});
