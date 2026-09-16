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
import {
  CONTRACTS_VERSION,
  type DeviceInfo,
  type DeviceSlice,
  SOCKETS,
} from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon, PeerLink } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productPathSecret, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
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
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

function makeDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-c5-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  // UA-P-0a — both daemons are the SAME account, which is what D35 federation
  // means: a person's own devices. Before the posture derived from the link,
  // neither had one and the door handed the preset to anyone; now an unlinked
  // desktop declares no serve and mints a guest, so the fixture has to say who
  // these two are.
  writeLinkFixture(dataDir, LOGIN);
  return dataDir;
}

/** The sidecar-simulating ws-ctor, which after UA-P-0d and UA-P-0e plays BOTH
 * halves of what the real sidecar does to a dial:
 *
 *  1. It TERMINATES the tailnet coordinate and forwards to the target's
 *     loopback address WITH the route secret joined onto the path (UA-P-0d:
 *     the secret is the target's path now, added on forward, so the caller
 *     never holds it). A's roster hands PeerLink `https://<magicdns>:<the
 *     registry's product serve port>` — a derived locator with no secret in it
 *     — and that is exactly the string a phone would dial.
 *  2. It injects the WhoIs login header, which a caller cannot forge.
 *
 * The sim used to dial the URL unchanged, because the secret was already in it
 * — which was the defect D7 closed. Returns a dial counter so tests can assert
 * one-connection-per-peer. */
function sidecar(loopback: () => string): { ctor: WsCtor; dials: () => number } {
  let count = 0;
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      count += 1;
      // A coordinate this sim has no door behind — the roster's other rows —
      // resolves to a closed port, which is what an unreachable peer really is.
      const target = url.includes("device-b.tailnet.ts.net") ? loopback() : "ws://127.0.0.1:1/";
      const forwarded = url.startsWith("wss://") || url.startsWith("https://") ? target : url;
      super(forwarded, { headers: { "Tailscale-User-Login": LOGIN } });
    }
  }
  return { ctor: SidecarSim, dials: () => count };
}

/** B's capability secret = the route path fieldd composes into its own health
 * serve URL (base + /t/<secret>). The serve reconcile is fire-and-forget at
 * bootstrap, so poll until it lands. */
/** UA-P-0d — the secret is no longer IN the capability URL (that is what D7
 * changed), so this reads it the way the sidecar does: off the `serve.add`
 * the daemon sent to its floor. The dial below then plays the sidecar. */
async function capabilitySecret(daemon: FielddDaemon, mock: MockMgmtServer): Promise<string> {
  await until(
    () => daemon.health().mesh.serves.some((s) => s.name === "product" && s.url !== undefined),
    8000,
  );
  return productPathSecret(mock);
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
  // B first — A needs B's loopback door (port + route secret) to play B's
  // sidecar for it.
  const dirB = makeDataDir();
  const mockB = await startMock(dirB);
  const B = await bootstrap({ dataDir: dirB, controlPort: 0, dataPort: 0 });
  cleanup.push(() => B.stop());
  const secret = await capabilitySecret(B, mockB);
  const bEndpoint = `ws://127.0.0.1:${B.controlPort}/t/${secret}`;

  // A dials peers through the sidecar sim, which resolves A's derived tailnet
  // coordinate to B's real loopback door (UA-P-0d).
  const { ctor, dials } = sidecar(() => bEndpoint);
  const dirA = makeDataDir();
  const mockA = await startMock(dirA);
  // UA-P-0e — B reaches A's roster the way every peer does now: through the
  // TAILNET'S OWN REGISTRY, with the control plane's WhoIs saying B belongs to
  // this account. It used to reach it as a published SLICE naming its own URL,
  // which was a redirect primitive — a spoofed slice could name any endpoint
  // and `endpointFor` would dial it. A DISTINCT device id is still required:
  // both mocks report `dev-self`, so B's real id would collide with A's own.
  mockA.meshPeers = [
    {
      id: "node-b",
      deviceId: "dev-b",
      name: "device-b",
      online: true,
      whois: { login: LOGIN, deviceName: "device-b.tailnet.ts.net" },
    },
  ];
  const A = await bootstrap({ dataDir: dirA, controlPort: 0, dataPort: 0, peerWebSocket: ctor });
  cleanup.push(() => A.stop());

  await until(() => A.devices.get("dev-b") !== undefined, 4000);
  // the coordinate A will dial is DERIVED, and carries no secret
  const locator = A.devices.get("dev-b")?.productEndpoint?.url;
  if (locator === undefined || locator.includes("/t/"))
    throw new Error(`A's locator for B is not a secret-free derivation: ${locator}`);

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

  it("the REMOTE end enforces the peer preset: a federating method the preset lacks is refused at B — and a LOCAL method never leaves A (D36, AR-4b)", async () => {
    const { A } = await bootPair();
    const rpcA = await openRpc(A.controlPort);
    await helloAs(rpcA, A.shellToken, "shell-main"); // all scopes

    // A local-only method (D36) is refused at A BEFORE any re-route, whatever
    // A's own scopes say: it is this device's, and B would refuse it anyway.
    const local = await rpcA.callErr("system.mintWindowToken", {
      device: "dev-b",
      scopes: [],
      label: "x",
    });
    expect(local.data?.kind).toBe("PRECONDITION_FAILED");
    expect(local.data?.details).toMatchObject({
      method: "system.mintWindowToken",
      locality: "local",
    });
    // A federating method whose scope the peer preset LACKS: A's local check
    // passes (the shell holds settings.manage), the call forwards whole to B,
    // whose peer principal (TAILNET preset) has no settings.manage. This proves
    // the REMOTE gate: B's scope check precedes its own routing and execution.
    const remote = await rpcA.callErr("storage.appPreferences.set", {
      device: "dev-b",
      preferences: {},
    });
    expect(remote.data?.kind).toBe("FORBIDDEN_SCOPE");
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
    // UA-P-0e — a SELF peer whose derived coordinate the sidecar sim cannot
    // reach. It used to be a slice naming a closed port; a peer cannot name its
    // own endpoint any more, so the unreachability is in the dial, which is
    // exactly where a real one would be.
    mockA.meshPeers = [
      ...mockA.meshPeers,
      {
        id: "node-dead",
        deviceId: "dev-dead",
        name: "dead",
        online: true,
        whois: { login: LOGIN, deviceName: "dead.tailnet.ts.net" },
      },
    ];
    mockA.pushPeersDelta({ kind: "peerUpdated" });
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
    await A.peers.request("dev-b", "device.list", {});
    await A.peers.request("dev-b", "device.list", {});
    expect(A.peers.linkState("dev-b")).toBe("connected");
    expect(dials()).toBe(1);
  }, 30_000);

  it("the roster folds link:'connected' for a dialed peer, never for self", async () => {
    const { A } = await bootPair();
    await A.peers.request("dev-b", "device.list", {}); // establish the link

    const rpcA = await openRpc(A.controlPort);
    await helloAs(rpcA, A.shellToken, "shell-main");
    const list = (await rpcA.call("device.list", {})) as { devices: DeviceInfo[] };
    expect(list.devices.find((d) => d.deviceId === "dev-b")?.link).toBe("connected");
    expect(list.devices.find((d) => d.self)?.link).toBeUndefined();
  }, 30_000);

  it("C6-5: device.subscribe federates — B's snapshot, a live delta, quiet after dispose", async () => {
    // The D35 demonstration: A's federated proxy stands a subscription on B's
    // product surface (under the peer-fieldd principal), relays B's roster
    // snapshot, hears B's roster CHANGE as a delta, and goes quiet on dispose.
    // Params are post-routing ({} — no device key) for the C5 recorded
    // divergence: both mocks pin "dev-self", so B must serve locally.
    const { A, mockB } = await bootPair();
    const events: Array<{ payload: unknown; kind: "snapshot" | "delta" | undefined }> = [];
    const sub = await A.federatedSubs.attach("dev-b", "device.subscribe", {}, (payload, kind) =>
      events.push({ payload, kind }),
    );
    const roster = sub.snapshot as DeviceInfo[];
    expect(roster.some((d) => d.self)).toBe(true); // B's own row, through A

    // B's roster changes (a self peer appears on B's tailnet) → a delta reaches
    // A. UA-P-0e: B's roster is the peer registry now, not its store.
    mockB.meshPeers = [
      {
        id: "node-x",
        deviceId: "dev-x",
        name: "x",
        online: true,
        whois: { login: LOGIN, deviceName: "x.tailnet.ts.net" },
      },
    ];
    mockB.pushPeersDelta({ kind: "peerUpdated" });
    await until(
      () =>
        events.some((e) =>
          (e.payload as DeviceInfo[] | undefined)?.some?.((d) => d.deviceId === "dev-x"),
        ),
      8000,
    );

    sub.dispose();
    const heard = events.length;
    mockB.meshPeers = [
      ...mockB.meshPeers,
      {
        id: "node-y",
        deviceId: "dev-y",
        name: "y",
        online: true,
        whois: { login: LOGIN, deviceName: "y.tailnet.ts.net" },
      },
    ];
    mockB.pushPeersDelta({ kind: "peerUpdated" });
    await new Promise((r) => setTimeout(r, 300));
    expect(events.length).toBe(heard); // disposed means disposed
  }, 30_000);

  it("C6-5: the REMOTE gate holds for subscriptions — a non-tailnet topic is refused by B", async () => {
    // doc.read is deliberately outside TAILNET_SCOPES (D32): B refuses the
    // peer principal at ITS gate, and the refusal is the caller's answer.
    const { A } = await bootPair();
    await expect(
      A.federatedSubs.attach("dev-b", "doc.sync.subscribe", {}, () => {}),
    ).rejects.toMatchObject({ kind: "FORBIDDEN_SCOPE" });
  }, 30_000);

  it("C6-5: a standing subscription PINS the link against the idle sweep", async () => {
    const { bEndpoint } = await bootPair();
    // this row drives PeerLink directly with B's loopback door, so the sim has
    // no coordinate to resolve — it only injects the identity header
    const { ctor } = sidecar(() => bEndpoint);
    const link = new PeerLink({
      ownDeviceId: () => "dev-a",
      endpointFor: () => bEndpoint,
      webSocket: ctor,
      idleCloseMs: 60,
    });
    cleanup.push(() => link.dispose());

    const sub = await link.subscribe(
      "dev-b",
      "device.subscribe",
      {},
      () => {},
      () => {},
    );
    await new Promise((r) => setTimeout(r, 250)); // several sweep periods
    expect(link.linkState("dev-b")).toBe("connected"); // pinned: quiet ≠ unused

    sub.unsubscribe();
    await until(() => link.linkState("dev-b") === undefined, 3000); // unpinned ⇒ swept
  }, 30_000);

  it("an idle link is swept closed and the next call re-dials", async () => {
    const { bEndpoint } = await bootPair(); // reuse B (the pair's dial target)
    const { ctor, dials } = sidecar(() => bEndpoint);
    const link = new PeerLink({
      ownDeviceId: () => "dev-a",
      endpointFor: () => bEndpoint,
      webSocket: ctor,
      idleCloseMs: 60, // sweeper runs every min(60, 60_000) = 60ms
    });
    cleanup.push(() => link.dispose());

    await link.request("dev-b", "device.list", {});
    expect(dials()).toBe(1);
    expect(link.linkState("dev-b")).toBe("connected");

    // the sweeper closes the idle link; linkState goes undefined
    await until(() => link.linkState("dev-b") === undefined, 3000);

    await link.request("dev-b", "device.list", {});
    expect(dials()).toBe(2); // re-dialed a fresh socket
  }, 30_000);
});
