// DeviceService (C4, design-04 D31): the real daemon driven through the mock
// mgmt server (no cargo, no tailnet). Covers publish-on-boot + slice shape,
// device.list over the product WS with the scope gate, peer slices fused from
// the store stream, the tolerant malformed-slice drop, device.subscribe
// streaming, meshless identity stability across a restart, and device.get.
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  type DeviceInfo,
  type DeviceListResult,
  PEER_FIELDD_SCOPES,
  PORTS,
  SOCKETS,
  TAILNET_SCOPES,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productPathSecret } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice } from "./peer-roster";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A mock mgmt server listening on <dataDir>/native/run/mgmt.sock, ready to be
 * bootstrapped against. Configure it (e.g. meshUnavailable) BEFORE bootstrap. */
async function startMock(dataDir: string): Promise<MockMgmtServer> {
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

function makeDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-dev-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  return dataDir;
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

async function listVia(rpc: WsRpc): Promise<DeviceInfo[]> {
  const r = (await rpc.call("device.list", {})) as DeviceListResult;
  return r.devices;
}

/** Poll device.list until the predicate holds (device.list is a plain call, so
 * roster changes are observed by re-listing rather than a stream). */
async function pollDevices(
  rpc: WsRpc,
  pred: (d: DeviceInfo[]) => boolean,
  ms = 4000,
): Promise<DeviceInfo[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const d = await listVia(rpc);
    if (pred(d)) return d;
    if (Date.now() > deadline) throw new Error("pollDevices: timeout");
    await sleep(25);
  }
}

/** F-H2 — the capabilities this device most recently reported.
 *
 * UA-P-0e (D2): read from the SELF ROW of `device.list`, not from the
 * `field.devices.v1` slice, because there is no slice — the bus reaches every
 * VibeField node on the tailnet and cannot be told to reach only this account's,
 * so nothing content-bearing rides it. The capability is the same fact; where a
 * remote reader gets it is the peer's own door. */
const selfCapabilities = async (rpc: WsRpc): Promise<DeviceInfo["capabilities"]> =>
  (await listVia(rpc)).find((d) => d.self)?.capabilities;

/** UA-P-0e — one app peer as the TAILNET's registry reports it. `login` is the
 * control plane's WhoIs answer about the peer, not a claim by it, and it is the
 * whole of what decides whether the peer is in this account's roster. */
function tailnetPeer(over: {
  id: string;
  deviceId?: string;
  login?: string;
  name?: string;
  online?: boolean;
  lastSeen?: number;
  deviceName?: string;
}): unknown {
  return {
    id: over.id,
    ...(over.deviceId !== undefined ? { deviceId: over.deviceId } : {}),
    name: over.name ?? over.id,
    online: over.online ?? true,
    ...(over.lastSeen !== undefined ? { lastSeen: over.lastSeen } : {}),
    ...(over.login !== undefined
      ? {
          whois: {
            login: over.login,
            ...(over.deviceName !== undefined ? { deviceName: over.deviceName } : {}),
          },
        }
      : {}),
  };
}

/** The account every row below is scoped to, and a link.json that says so. */
const ACCOUNT = "james@github";
function linkTo(dataDir: string, login: string = ACCOUNT): void {
  mkdirSync(join(dataDir, "fieldd"), { recursive: true });
  writeFileSync(
    join(dataDir, "fieldd", "link.json"),
    JSON.stringify({ login, tailnet: "tail1234.ts.net", linkedAt: "2026-09-14T00:00:00.000Z" }),
  );
}

/** A floor route snapshot with one cell whose T1 doors are up, or none. */
function routeSnapshot(revision: number, port?: number): unknown {
  return {
    revision,
    cells:
      port === undefined
        ? []
        : [
            {
              cellInstanceId: 1,
              cellBootId: "cb-1",
              pid: 4242,
              endpoints: {
                controlSocket: "/mock/native/run/termctl.1.sock",
                frameSocket: "/mock/native/run/termframe.1.sock",
                authToken: "per-boot-token",
              },
              tokenGeneration: 1,
              doors: {
                controlUrl: `ws://127.0.0.1:${port}/control`,
                framesUrl: `ws://127.0.0.1:${port}/frames`,
              },
            },
          ],
  };
}

describe("DeviceService — publish + identity", () => {
  it("UA-P-4: publishes the device slice again, and NO ROUTE SECRET rides it", async () => {
    // THE FLIP BACK. UA-P-0e stopped this publish because the bus reached every
    // VibeField node on the tailnet; RFC 025 gates the node on the account's
    // login, so the bus's audience IS the account and the slice goes out again
    // (the citations are in mesh-bus.ts).
    //
    // What does NOT come back is the secret. D7 moved the route secret to the
    // sidecar's target path and that ruling is untouched by the gate: a slice
    // may name where a door IS, never how to open it. This row proves it
    // against the PUBLISHED BYTES rather than against the shape we meant to
    // publish — the secret is read from the same serve declaration the real
    // sidecar is configured from, then hunted in what actually went on the wire.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    const self = (await pollDevices(rpc, (d) => d.some((x) => x.self))).find(
      (x) => x.self,
    ) as DeviceInfo;
    // deviceId came from store.get (no deviceId) — the node's mesh identity (D30)
    expect(self.deviceId).toBe("dev-self");
    expect(self.capabilities).toEqual({
      terminalHost: false,
      // TM-2 (MF-1l) — the REMOTE half of the terminal question, and a floor
      // that said nothing is a no
      terminalMesh: false,
      docHost: true,
      push: false,
    });
    expect(self.bootId).toBe(daemon.bootId);
    expect(self.productEndpoint?.serve).toBe("product");

    // the slice really went out, and it is this device's own row
    await until(() => mock.storeWrites.length > 0, 8000);
    const slice = mock.storeWrites.at(-1) as Record<string, unknown>;
    expect(slice["deviceId"]).toBe("dev-self");
    expect(slice["bootId"]).toBe(daemon.bootId);
    expect(slice["platform"]).toBe(process.platform);
    expect((slice["capabilities"] as Record<string, unknown>)["docHost"]).toBe(true);

    // THE PROOF. Every byte fieldd has written to the bus, searched for the
    // route secret and for the capability-path shape that used to carry it.
    // `productPathSecret` reads it off the serve declaration the daemon sent
    // its floor, so this compares the wire against the REAL secret rather than
    // against a value this test made up.
    await until(() => daemon.health().mesh.serves.some((x) => x.name === "product"), 8000);
    const secret = productPathSecret(mock);
    expect(secret.length).toBeGreaterThan(0);
    const published = JSON.stringify(mock.storeWrites);
    expect(published).not.toContain(secret);
    expect(published).not.toContain("/t/");
    // THE POSITIVE CONTROL: the secret really is live on this daemon — declared
    // to the floor, which is the one place it is allowed to be. Without this the
    // two absences above could be a test that searched for a value nothing ever
    // held.
    expect(JSON.stringify(mock.meshAddParams)).toContain(secret);
    // and the endpoint that DID ride it is a locator: scheme, host, port, no path
    const endpoint = slice["productEndpoint"] as { url?: string } | undefined;
    if (endpoint?.url !== undefined) {
      expect(new URL(endpoint.url).pathname).toBe("/");
    }
  });

  it("terminalMesh is true only while a remote reader could really attach (F-H2)", async () => {
    // The field promises "this device's terminal doors are PUBLISHED ON THE
    // TAILNET — the fact a REMOTE reader needs" (contracts/devices.ts). It used
    // to answer with the floor's own `terminalMesh` word, which knows nothing
    // of fieldd's three gates: that boolean is TRUE for the whole of this test,
    // and the truthful answer still moves when the last cell goes. (The other
    // half — a floor shouting yes at an UNLINKED daemon that publishes nothing
    // — is the no-login row in terminal-serve.test.ts.)
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    mock.helloTerminalMesh = true;
    mock.helloTerminal = {
      controlSocket: "/mock/native/run/termctl.1.sock",
      frameSocket: "/mock/native/run/termframe.1.sock",
      authToken: "per-boot-token",
    };
    mock.terminalRoutes = routeSnapshot(1, 51001);

    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    // linked, a floor that publishes, one routable cell: the serve is up and
    // the capability says a remote reader can attach
    await pollDevices(rpc, (d) => d.find((x) => x.self)?.capabilities?.terminalMesh === true);
    expect((await selfCapabilities(rpc))?.terminalHost).toBe(true);

    // the last cell exits. The floor's word has not moved — it is still true —
    // but the listener is withdrawn, so the promise is withdrawn with it.
    mock.pushRoutesDelta(routeSnapshot(2));
    await pollDevices(rpc, (d) => d.find((x) => x.self)?.capabilities?.terminalMesh === false);
    // …and `terminalHost` goes with it, which is NOT this change's doing:
    // `NativeLink.terminalEndpoints` is DERIVED from the route snapshot's
    // cells, so a floor with no cells reports no endpoints. Recorded here
    // rather than asserted the other way, because the first draft of this row
    // assumed the local fact was independent and it is not.
    expect((await selfCapabilities(rpc))?.terminalHost).toBe(false);
  });

  it("device.list returns the online self row; workspace.read gates the surface", async () => {
    const dataDir = makeDataDir();
    await startMock(dataDir);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    const devices = await pollDevices(rpc, (d) => d.some((x) => x.self));
    const self = devices.find((x) => x.self) as DeviceInfo;
    expect(self.self).toBe(true);
    expect(self.online).toBe(true);

    // a token WITHOUT workspace.read is refused by the registry scope gate
    const narrow = daemon.tokens.mint(["doc.read"], "narrow");
    const weak = await openRpc(daemon.controlPort);
    await helloAs(weak, narrow.token);
    const denied = await weak.callErr("device.list", {});
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("keeps a stable meshless local device-id across a daemon restart", async () => {
    const dataDir = makeDataDir();

    const mock1 = await startMock(dataDir);
    mock1.meshUnavailable = true; // solo operation from the first boot
    const daemon1 = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    const rpc1 = await openRpc(daemon1.controlPort);
    await helloAs(rpc1, daemon1.shellToken, "shell-main");
    const first = await pollDevices(rpc1, (d) => d.some((x) => x.self));
    const selfId = (first.find((x) => x.self) as DeviceInfo).deviceId;
    expect(selfId.startsWith("local-")).toBe(true);
    await daemon1.stop();
    await mock1.stop();

    // same dataDir, mesh still down → the persisted fieldd/device-id must win
    const mock2 = await startMock(dataDir);
    mock2.meshUnavailable = true;
    const daemon2 = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon2.stop());
    const rpc2 = await openRpc(daemon2.controlPort);
    await helloAs(rpc2, daemon2.shellToken, "shell-main");
    const second = await pollDevices(rpc2, (d) => d.some((x) => x.self));
    expect((second.find((x) => x.self) as DeviceInfo).deviceId).toBe(selfId);
  });
});

// UA-P-0e (D2) — THE ROSTER IS THE SELF-PEER SET, and UA-P-4 did not change
// that. The bus is on again and scoped (RFC 025), so peer slices arrive once
// more — but a slice DESCRIBES a member, it does not make one. Membership comes
// from the TAILNET'S OWN REGISTRY filtered to this account's login, which is
// what these rows are about, and a slice naming a device the registry does not
// list is dropped at the fusion point with a log.
//
// The question they ask is the one UA-P-0e made central and the gate did not
// retire: WHOSE peer is this? Answering it here as well as at the transport is
// defence in depth — RFC 025 §3.5 binds a slice to its sender, and one bug
// upstream should not be able to conjure a device into somebody's roster.
describe("DeviceService — the self-peer set", () => {
  it("lists ONLY peers whose WhoIs login is this account's", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    mock.meshPeers = [
      tailnetPeer({ id: "node-mine", deviceId: "dev-mine", login: ACCOUNT, name: "my laptop" }),
      // a colleague's VibeField on the same tailnet. It carries the app's
      // hostname prefix, it is in truffle's registry, and before this ruling it
      // was drawn exactly like the user's own device.
      tailnetPeer({
        id: "node-theirs",
        deviceId: "dev-theirs",
        login: "colleague@corp.example",
        name: "their laptop",
      }),
      // and a peer the tailnet will not name: no login to compare, so not
      // this account's. Absent, never assumed.
      tailnetPeer({ id: "node-anon", deviceId: "dev-anon", name: "who?" }),
    ];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");

    const roster = await pollDevices(rpc, (d) => d.some((x) => x.deviceId === "dev-mine"));
    expect(roster.map((d) => d.deviceId).sort()).toEqual(["dev-mine", "dev-self"]);
    expect(roster.find((d) => d.deviceId === "dev-theirs")).toBeUndefined();
    expect(roster.find((d) => d.deviceId === "dev-anon")).toBeUndefined();
    // and no trace of the foreign peer anywhere in the answer
    expect(JSON.stringify(roster)).not.toContain("colleague@corp.example");
    expect(JSON.stringify(roster)).not.toContain("their laptop");
  });

  it("UA-P-4: a slice DESCRIBES a registry member, and never ADDS one", async () => {
    // THE REGISTRY IS THE AUTHORITY. RFC 025 binds a slice to its sender's
    // authenticated device id, so a slice for a device the tailnet does not
    // list for this account should not arrive — this row is the defence in
    // depth behind that, and it is cheap: one map lookup at the fusion point.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    mock.meshPeers = [
      tailnetPeer({
        id: "node-mine",
        deviceId: "dev-mine",
        login: ACCOUNT,
        name: "my laptop",
        deviceName: "my-laptop.tail1234.ts.net",
      }),
    ];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    await pollDevices(rpc, (d) => d.some((x) => x.deviceId === "dev-mine"));

    const slice = (deviceId: string, name: string) => ({
      deviceId,
      name,
      platform: "linux",
      headless: false,
      fielddVersion: "0.1.0",
      contractsVersion: CONTRACTS_VERSION,
      capabilities: { terminalHost: true, docHost: true, push: false },
      bootId: `boot-${deviceId}`,
      publishedAt: 1,
    });

    // (1) a LISTED member's slice DESCRIBES it: the claims a device makes about
    // itself reach its row, which is the whole point of the bus coming back
    mock.pushStoreDelta({
      kind: "peerUpdated",
      deviceId: "dev-mine",
      data: slice("dev-mine", "my laptop"),
      version: 1,
    });
    const described = await pollDevices(
      rpc,
      (d) => d.find((x) => x.deviceId === "dev-mine")?.platform === "linux",
    );
    expect(described.find((x) => x.deviceId === "dev-mine")).toMatchObject({
      platform: "linux",
      bootId: "boot-dev-mine",
      capabilities: { terminalHost: true },
    });

    // (2) an UNLISTED device's slice adds NOTHING, however well-formed. This
    // one parses, fits every limit, and names a plausible device; the tailnet
    // simply does not say it is this account's.
    mock.pushStoreDelta({
      kind: "peerUpdated",
      deviceId: "dev-ghost",
      data: slice("dev-ghost", "ghost laptop"),
      version: 1,
    });
    await sleep(300);
    const after = await listVia(rpc);
    expect(after.find((x) => x.deviceId === "dev-ghost")).toBeUndefined();
    expect(JSON.stringify(after)).not.toContain("ghost laptop");
    // the CONTROL: the listed member is still described, so (2) is a drop and
    // not a store leg that stopped working
    expect(after.find((x) => x.deviceId === "dev-mine")?.platform).toBe("linux");
  });

  it("an UNLINKED desktop has no account, so it has no peers", async () => {
    // The same posture the door and the serve take: with no captured login
    // there is nothing to compare a WhoIs answer against, so the honest roster
    // is this device alone — not "everyone on the tailnet" by default.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.meshPeers = [tailnetPeer({ id: "node-mine", deviceId: "dev-mine", login: ACCOUNT })];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    const roster = await pollDevices(rpc, (d) => d.some((x) => x.self));
    await sleep(200);
    expect((await listVia(rpc)).map((d) => d.deviceId)).toEqual(["dev-self"]);
    expect(roster.every((d) => d.self)).toBe(true);
  });

  it("carries liveness, the dial id and the MagicDNS name — and NOT what the peer never said", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    mock.meshPeers = [
      tailnetPeer({
        id: "node-peer",
        deviceId: "dev-peer",
        login: ACCOUNT,
        name: "peerbox",
        online: true,
        lastSeen: 1_700_000_200_000,
        deviceName: "PEER.TAILNET.TS.NET.",
      }),
    ];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    const roster = await pollDevices(rpc, (d) => d.some((x) => x.deviceId === "dev-peer"));
    const peer = roster.find((d) => d.deviceId === "dev-peer") as DeviceInfo;

    expect(peer.self).toBe(false);
    expect(peer.name).toBe("peerbox");
    expect(peer.online).toBe(true);
    expect(peer.lastSeenAt).toBe(1_700_000_200_000);
    // the DIAL keyspace, never mixed with the roster ULID (T1 §6)
    expect(peer.tailscaleId).toBe("node-peer");
    expect(peer.tailnetDnsName).toBe("peer.tailnet.ts.net"); // transport-derived, canonical

    // and the honest absences: a peer's OS, its versions, what it can host and
    // when it last published are claims it has not made through a door that
    // checked who it is. Absent, not guessed — which is the tolerant-reader law
    // applied to ourselves.
    expect(peer.platform).toBeUndefined();
    expect(peer.fielddVersion).toBeUndefined();
    expect(peer.contractsVersion).toBeUndefined();
    expect(peer.capabilities).toBeUndefined();
    expect(peer.bootId).toBeUndefined();
    expect(peer.publishedAt).toBeUndefined();
    // the CONTROL: SELF still carries every one of them — it is this process
    const self = roster.find((d) => d.self) as DeviceInfo;
    expect(self.platform).toBe(process.platform);
    expect(self.capabilities).toBeDefined();
    expect(self.bootId).toBe(daemon.bootId);
  });

  it("the door coordinate is DERIVED from MagicDNS and the registry port, never published", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    mock.meshPeers = [
      tailnetPeer({
        id: "node-peer",
        deviceId: "dev-peer",
        login: ACCOUNT,
        deviceName: "peer.tailnet.ts.net",
      }),
      // a self peer the tailnet has not named a host for: a door with no host
      // is not a door, so the locator is absent rather than invented
      tailnetPeer({ id: "node-hostless", deviceId: "dev-hostless", login: ACCOUNT }),
    ];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    const roster = await pollDevices(rpc, (d) => d.some((x) => x.deviceId === "dev-peer"));

    const peer = roster.find((d) => d.deviceId === "dev-peer") as DeviceInfo;
    expect(peer.productEndpoint?.url).toBe(
      `http://peer.tailnet.ts.net:${PORTS.FIELDD_PRODUCT_SERVE}`,
    );
    // UA-P-0d: a coordinate carries no key — the route secret is the sidecar's
    // target path, so there is nothing in this string to protect
    expect(peer.productEndpoint?.url).not.toContain("/t/");

    const hostless = roster.find((d) => d.deviceId === "dev-hostless") as DeviceInfo;
    expect(hostless.productEndpoint?.url).toBeUndefined();
    expect(hostless.productEndpoint?.serve).toBe("product");
  });

  it("a peer leaving the account's set leaves the roster", async () => {
    // The set is rebuilt whole on every peer refresh, so "no longer mine" and
    // "no longer here" are the same event — there is no retained slice to age
    // out and no last-known-safe row to keep drawing.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    mock.meshPeers = [tailnetPeer({ id: "node-peer", deviceId: "dev-peer", login: ACCOUNT })];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    await pollDevices(rpc, (d) => d.some((x) => x.deviceId === "dev-peer"));

    // the tailnet re-reports it under a DIFFERENT login (a device handed over,
    // a tag applied): it is not this account's any more
    mock.meshPeers = [
      tailnetPeer({ id: "node-peer", deviceId: "dev-peer", login: "someone-else@corp.example" }),
    ];
    mock.pushPeersDelta({ kind: "peerUpdated", peer: mock.meshPeers[0] });
    await pollDevices(rpc, (d) => !d.some((x) => x.deviceId === "dev-peer"));
  });

  it("streams device.delta over the product WS when a self peer joins", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    const sub = (await rpc.call("device.subscribe", {})) as {
      subId: string;
      snapshot: DeviceInfo[];
    };
    expect(sub.snapshot.some((d) => d.self)).toBe(true);

    const joined = tailnetPeer({
      id: "node-peer2",
      deviceId: "dev-peer2",
      login: ACCOUNT,
      name: "peer2",
    });
    mock.meshPeers = [joined];
    mock.pushPeersDelta({ kind: "peerUpdated", peer: joined });

    await until(() =>
      rpc.notifications.some(
        (n) =>
          n.method === "device.delta" &&
          n.params.subId === sub.subId &&
          Array.isArray(n.params.payload) &&
          (n.params.payload as DeviceInfo[]).some((d) => d.deviceId === "dev-peer2"),
      ),
    );
  });

  it("device.get returns a known row and NOT_FOUND for an unknown id", async () => {
    const dataDir = makeDataDir();
    await startMock(dataDir);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    const devices = await pollDevices(rpc, (d) => d.some((x) => x.self));
    const selfId = (devices.find((x) => x.self) as DeviceInfo).deviceId;

    const got = (await rpc.call("device.get", { deviceId: selfId })) as DeviceInfo;
    expect(got.deviceId).toBe(selfId);

    const missing = await rpc.callErr("device.get", { deviceId: "no-such-device" });
    expect(missing.data?.kind).toBe("NOT_FOUND");
  });
});

// UA-P-0f (D5) — the OUTBOUND half, at the daemon. `meshPeers` in daemon.ts is
// the ONE peer source doc-sync and presence fan out over, so narrowing it there
// narrows both and there is no second list a caller could reach past.
describe("UA-P-0f — the fan-out reaches only this account's desktops", () => {
  it("opens a doc-sync lane to a self peer and none to a foreign one", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    mock.meshPeers = [
      tailnetPeer({ id: "node-mine", deviceId: "dev-mine", login: ACCOUNT, name: "mine" }),
      tailnetPeer({
        id: "node-theirs",
        deviceId: "dev-theirs",
        login: "colleague@corp.example",
        name: "theirs",
      }),
    ];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    await pollDevices(rpc, (d) => d.some((x) => x.deviceId === "dev-mine"));

    // `selfSyncPeers()` IS the list — `meshPeers` in daemon.ts returns it
    // unchanged, and doc-sync and presence are both constructed with that one
    // closure. The foreign desktop is on the same tailnet, in the same registry
    // and carrying the same app hostname prefix; what keeps it out is its login.
    const fanOut = daemon.devices.selfSyncPeers();
    expect(fanOut.map((p) => p.id)).toEqual(["node-mine"]);
    // liveness rides along in the DIAL keyspace, which is the keyspace a lane
    // is opened in (T1 §6 — never the roster ULID)
    expect(fanOut[0]?.online).toBe(true);

    // and the same set answers the per-lane inbound question both services ask
    expect(daemon.devices.isSelfPeer("node-mine")).toBe(true);
    expect(daemon.devices.isSelfPeer("node-theirs")).toBe(false);
  });

  it("an UNLINKED desktop fans out to nobody", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.meshPeers = [
      tailnetPeer({ id: "node-mine", deviceId: "dev-mine", login: ACCOUNT, name: "mine" }),
    ];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    await pollDevices(rpc, (d) => d.some((x) => x.self));
    await sleep(200);
    // no captured login, so no peer can be compared to one — and a document
    // reaches nobody rather than everybody
    expect(daemon.devices.selfSyncPeers()).toEqual([]);
    expect(daemon.devices.isSelfPeer("node-mine")).toBe(false);
  });
});

// DS-L8 (2026-09-30) — asleep is a state, not an absence. The roster tells
// `awake`, `restarting` (the node on the tailnet, its daemon silent),
// `asleep` and `incompatible` apart, ADDITIVE beside `online`, from the
// tailnet's liveness and what each peer's door last said (PeerLink.doorState —
// scripted here; its own rows are peer-door.test.ts, the two-daemon witness is
// the PeerLink e2e).
describe("DS-L8 — the roster's states", () => {
  it("tells awake, restarting, asleep and incompatible apart beside online, and a move wakes device.subscribe", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    mock.meshPeers = [
      tailnetPeer({ id: "node-up", deviceId: "dev-up", login: ACCOUNT, name: "up" }),
      tailnetPeer({ id: "node-quiet", deviceId: "dev-quiet", login: ACCOUNT, name: "quiet" }),
      tailnetPeer({
        id: "node-off",
        deviceId: "dev-off",
        login: ACCOUNT,
        name: "off",
        online: false,
      }),
      tailnetPeer({ id: "node-skew", deviceId: "dev-skew", login: ACCOUNT, name: "skew" }),
    ];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    await pollDevices(rpc, (d) => d.some((x) => x.deviceId === "dev-skew"));

    // what each door last said: the off peer's door was silent too — the
    // tailnet saying it is not online outranks that
    const doors = new Map<string, "answers" | "silent" | "incompatible">([
      ["dev-quiet", "silent"],
      ["dev-off", "silent"],
      ["dev-skew", "incompatible"],
    ]);
    const view = Object.assign(new EventEmitter(), {
      linkState: (id: string) => (doors.get(id) === "incompatible" ? "incompatible" : undefined),
      doorState: (id: string) => doors.get(id),
    }) as EventEmitter & {
      linkState(id: string): "incompatible" | undefined;
      doorState(id: string): "answers" | "silent" | "incompatible" | undefined;
    };
    daemon.devices.attachPeerLink(view);
    view.emit("door-changed", {});

    const roster = await pollDevices(
      rpc,
      (d) => d.find((x) => x.deviceId === "dev-quiet")?.state === "restarting",
    );
    const row = (id: string) => roster.find((d) => d.deviceId === id) as DeviceInfo;
    expect(roster.find((d) => d.self)?.state).toBe("awake");
    expect(row("dev-up")).toMatchObject({ state: "awake", online: true }); // never dialled ≠ silent
    expect(row("dev-quiet")).toMatchObject({ state: "restarting", online: true });
    expect(row("dev-off")).toMatchObject({ state: "asleep", online: false });
    expect(row("dev-skew")).toMatchObject({ state: "incompatible", online: true });

    // the daemon comes back: its door answers, and the move wakes a subscriber
    // although `online` never changed
    const sub = (await rpc.call("device.subscribe", {})) as { subId: string };
    doors.set("dev-quiet", "answers");
    view.emit("door-changed", {});
    await until(() =>
      rpc.notifications.some(
        (n) =>
          n.method === "device.delta" &&
          n.params.subId === sub.subId &&
          Array.isArray(n.params.payload) &&
          (n.params.payload as DeviceInfo[]).some(
            (d) => d.deviceId === "dev-quiet" && d.state === "awake",
          ),
      ),
    );
  });

  // S6 (the landing review, 2026-10-01) — DS-L9 says another contracts major
  // is `incompatible` and NOT ASKED. The roster read only door and link pins,
  // so a peer publishing another major read `awake` until a forward to it was
  // refused; its slice already said so.
  it("a peer whose slice publishes another contracts major reads incompatible before anything is asked of it", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    mock.meshPeers = [
      tailnetPeer({ id: "node-next", deviceId: "dev-next", login: ACCOUNT, name: "next" }),
      tailnetPeer({ id: "node-same", deviceId: "dev-same", login: ACCOUNT, name: "same" }),
    ];
    const slice = (deviceId: string, contractsVersion: string) => ({
      deviceId,
      name: deviceId,
      platform: "darwin",
      headless: false,
      fielddVersion: "0.1.0",
      contractsVersion,
      capabilities: { terminalHost: true, docHost: true, push: false },
      bootId: `boot-${deviceId}`,
      publishedAt: Date.now(),
    });
    const [ours] = CONTRACTS_VERSION.split(".");
    mock.storeSlices.set("dev-next", slice("dev-next", `${Number(ours) + 1}.0.0`));
    mock.storeSlices.set("dev-same", slice("dev-same", `${ours}.99.0`));
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    const roster = await pollDevices(rpc, (d) =>
      d.some((x) => x.deviceId === "dev-next" && x.contractsVersion !== undefined),
    );
    const row = (id: string) => roster.find((d) => d.deviceId === id) as DeviceInfo;
    // online, never dialled, no pin — and still not asked: its slice says why
    expect(row("dev-next")).toMatchObject({ state: "incompatible", online: true });
    expect(row("dev-next").link).toBeUndefined();
    // another MINOR is the same major: awake
    expect(row("dev-same")).toMatchObject({ state: "awake", online: true });
  });

  // S6 (the landing review, 2026-10-01) — the silent mark survived a node's
  // offline/online cycle, so a desktop that slept and woke read `restarting`
  // until some call to it happened to succeed. The roster is what sees the
  // flip, and clears the mark on it (PeerLink.clearSilent — its own row is in
  // peer-door.test.ts).
  it("a node that sleeps and wakes forgets its door's silence: restarting → asleep → awake", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    const quiet = (online: boolean) =>
      tailnetPeer({
        id: "node-quiet",
        deviceId: "dev-quiet",
        login: ACCOUNT,
        name: "quiet",
        online,
      });
    mock.meshPeers = [quiet(true)];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    await pollDevices(rpc, (d) => d.some((x) => x.deviceId === "dev-quiet"));

    // what PeerLink holds, scripted: the door went silent on a call
    const silent = new Set<string>(["dev-quiet"]);
    const cleared: string[] = [];
    const view = Object.assign(new EventEmitter(), {
      linkState: (_id: string) => undefined,
      doorState: (id: string) => (silent.has(id) ? ("silent" as const) : undefined),
      clearSilent: (id: string) => {
        cleared.push(id);
        if (silent.delete(id)) view.emit("door-changed", { deviceId: id });
      },
    });
    daemon.devices.attachPeerLink(view);
    view.emit("door-changed", {});
    await pollDevices(
      rpc,
      (d) => d.find((x) => x.deviceId === "dev-quiet")?.state === "restarting",
    );

    // it sleeps: the tailnet says so, and asleep outranks the silence
    mock.meshPeers = [quiet(false)];
    mock.pushPeersDelta({ kind: "peerUpdated" });
    await pollDevices(rpc, (d) => d.find((x) => x.deviceId === "dev-quiet")?.state === "asleep");
    expect(cleared).toEqual(["dev-quiet"]);

    // it wakes: no call has succeeded, and it is awake — not restarting
    mock.meshPeers = [quiet(true)];
    mock.pushPeersDelta({ kind: "peerUpdated" });
    const woke = await pollDevices(
      rpc,
      (d) => d.find((x) => x.deviceId === "dev-quiet")?.online === true,
    );
    expect(woke.find((x) => x.deviceId === "dev-quiet")?.state).toBe("awake");
    expect(cleared).toEqual(["dev-quiet", "dev-quiet"]);
  });
});

// D1 (2026-10-01, the DS wave 1 review) — the tailnet door's second fact for
// minting `peer-fieldd`, beside the node correlation: does the ROSTER row say
// this device hosts documents (`capabilities.docHost` — a desktop)? Read off
// the roster, so it keeps the roster's law: the registry vouches for the peer,
// its slice says what it is, and a device with no slice says nothing.
describe("D1 — isDocHost reads the roster row", () => {
  it("a self peer's desktop slice says yes; a phone's slice, a slice-less peer, an unlisted slice and this device say no", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    mock.meshPeers = [
      tailnetPeer({ id: "node-desk", deviceId: "dev-desk", login: ACCOUNT, name: "desk" }),
      tailnetPeer({ id: "node-phone", deviceId: "dev-phone", login: ACCOUNT, name: "phone" }),
      tailnetPeer({ id: "node-bare", deviceId: "dev-bare", login: ACCOUNT, name: "bare" }),
    ];
    mock.storeSlices.set("dev-desk", desktopSlice("dev-desk"));
    mock.storeSlices.set("dev-phone", {
      ...desktopSlice("dev-phone"),
      platform: "ios",
      capabilities: { terminalHost: false, docHost: false, push: true },
    });
    // a desktop slice no registry row vouches for: dropped from the roster
    mock.storeSlices.set("dev-stranger", desktopSlice("dev-stranger"));
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    await until(() => daemon.devices.get("dev-desk")?.capabilities !== undefined, 8000);

    expect(daemon.devices.deviceIdByNodeId("node-desk")).toBe("dev-desk");
    expect(daemon.devices.isDocHost("dev-desk")).toBe(true);
    expect(daemon.devices.isDocHost("dev-phone")).toBe(false);
    // listed, no slice yet: a device that has not said what it is is no desktop
    expect(daemon.devices.isDocHost("dev-bare")).toBe(false);
    expect(daemon.devices.isDocHost("dev-stranger")).toBe(false);
    expect(daemon.devices.isDocHost("dev-nobody")).toBe(false);
    // self publishes `docHost: true` and is still no peer of itself
    expect(daemon.devices.get(daemon.devices.currentDeviceId())?.capabilities?.docHost).toBe(true);
    expect(daemon.devices.isDocHost(daemon.devices.currentDeviceId())).toBe(false);
  }, 30_000);

  it("a desktop that dialled before its slice arrived is asked to hello again once the roster has it — and is the peer then", async () => {
    // a PeerLink re-dials within a second of this daemon's restart, often
    // before the roster has the dialler's slice; the principal is fixed at
    // hello, so the daemon's roster moves close the demoted connection
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    linkTo(dataDir);
    mock.meshPeers = [
      tailnetPeer({ id: "node-desk", deviceId: "dev-desk", login: ACCOUNT, name: "desk" }),
    ];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    await until(
      () => daemon.health().mesh.serves.some((x) => x.name === "product" && x.url !== undefined),
      8000,
    );
    await until(() => daemon.devices.deviceIdByNodeId("node-desk") === "dev-desk", 8000);
    const door = `ws://127.0.0.1:${daemon.controlPort}/t/${productPathSecret(mock)}`;
    const headers = { "Tailscale-User-Login": ACCOUNT, "Tailscale-Node-Id": "node-desk" };
    const hello = {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "peer-fieldd",
      deviceId: "dev-desk",
    };
    const dialDoor = async (): Promise<WebSocket> => {
      const ws = new WebSocket(door, { headers });
      cleanup.push(() => ws.close());
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
      });
      return ws;
    };

    const early = await dialDoor();
    const first = (await new WsRpc(early).call("system.hello", hello)) as {
      grantedScopes: string[];
    };
    expect(first.grantedScopes).toEqual([...TAILNET_SCOPES]); // no slice yet: no desktop
    const closed = new Promise<number>((resolve) => early.once("close", (code) => resolve(code)));
    mock.pushStoreDelta({
      kind: "peerUpdated",
      deviceId: "dev-desk",
      data: desktopSlice("dev-desk"),
      version: 1,
    });
    expect(await closed).toBe(1012);

    const again = (await new WsRpc(await dialDoor()).call("system.hello", hello)) as {
      grantedScopes: string[];
    };
    expect(again.grantedScopes).toEqual([...PEER_FIELDD_SCOPES]);
  }, 30_000);
});
