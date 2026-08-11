// DeviceService (C4, design-04 D31): the real daemon driven through the mock
// mgmt server (no cargo, no tailnet). Covers publish-on-boot + slice shape,
// device.list over the product WS with the scope gate, peer slices fused from
// the store stream, the tolerant malformed-slice drop, device.subscribe
// streaming, meshless identity stability across a restart, and device.get.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  type DeviceInfo,
  type DeviceListResult,
  DeviceSlice,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
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

/** A valid peer DeviceSlice for scripting store deltas. */
function peerSlice(over: Partial<DeviceSlice> = {}): DeviceSlice {
  return {
    deviceId: "dev-peer",
    name: "peerbox",
    platform: "linux",
    headless: false,
    fielddVersion: "0.1.0",
    contractsVersion: CONTRACTS_VERSION,
    capabilities: { terminalHost: false, docHost: true, push: false },
    bootId: "boot-peer",
    publishedAt: 1_700_000_000_000,
    ...over,
  };
}

describe("DeviceService — publish + identity", () => {
  it("publishes a valid self-slice on boot with the mesh identity dev-self", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    await until(() => mock.storeWrites.length > 0);
    const parsed = DeviceSlice.safeParse(mock.storeWrites[0]);
    expect(parsed.success).toBe(true);
    const slice = parsed.data as DeviceSlice;
    // deviceId came from store.get (no deviceId) — the node's mesh identity (D30)
    expect(slice.deviceId).toBe("dev-self");
    expect(slice.capabilities).toEqual({ terminalHost: false, docHost: true, push: false });
    expect(slice.bootId).toBe(daemon.bootId);
    expect(slice.productEndpoint?.serve).toBe("product");
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

describe("DeviceService — roster fusion", () => {
  it("fuses a peer slice from the store stream (offline without a tailnet entry)", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    await until(() => mock.storeWrites.length > 0); // publish ran ⇒ store sub is live

    const slice = peerSlice({ publishedAt: 1_700_000_123_456 });
    mock.pushStoreDelta({ kind: "peerUpdated", deviceId: "dev-peer", data: slice, version: 1 });
    const two = await pollDevices(rpc, (d) => d.length === 2);
    const peer = two.find((x) => x.deviceId === "dev-peer") as DeviceInfo;
    expect(peer.self).toBe(false);
    expect(peer.online).toBe(false); // no tailnet peer entry backs it
    expect(peer.lastSeenAt).toBe(slice.publishedAt); // freshest honest fact = publishedAt

    mock.pushStoreDelta({ kind: "peerRemoved", deviceId: "dev-peer" });
    await pollDevices(rpc, (d) => d.length === 1);
  });

  it("fuses tailnet liveness through the registry correlation, never the ULID (T1 §6)", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    // Both keyspaces present and DIFFERENT, exactly as truffle guarantees
    // (Peer.device_id never equals tailscale_id): the join must travel
    // slice ULID → PeerInfo.deviceId → tailscale id, or it lands on nothing —
    // which is the bug this test exists to keep dead.
    mock.meshPeers = [
      {
        id: "nodeid-peer",
        deviceId: "dev-peer",
        online: true,
        lastSeen: 1_700_000_200_000,
        whois: { login: "me@example.com", deviceName: "PEER.TAILNET.TS.NET." },
      },
      { id: "nodeid-loner", online: true }, // no published ULID — stays uncorrelated
    ];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    await until(() => mock.storeWrites.length > 0); // publish ran ⇒ peers were refreshed

    const slice = peerSlice({ publishedAt: 1_700_000_123_456 });
    mock.pushStoreDelta({ kind: "peerUpdated", deviceId: "dev-peer", data: slice, version: 1 });
    const roster = await pollDevices(rpc, (d) => d.some((x) => x.deviceId === "dev-peer"));
    const peer = roster.find((x) => x.deviceId === "dev-peer") as DeviceInfo;
    expect(peer.online).toBe(true); // the join hit — a live tailnet peer reads online
    expect(peer.tailscaleId).toBe("nodeid-peer"); // the dial keyspace, exposed for liveness consumers
    expect(peer.tailnetDnsName).toBe("peer.tailnet.ts.net"); // transport-derived, canonical
    expect(peer.lastSeenAt).toBe(1_700_000_200_000); // liveness lastSeen beats publishedAt
  });

  it("drops a malformed peer slice and stays alive (tolerant reader)", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    await until(() => mock.storeWrites.length > 0);
    const before = await listVia(rpc);

    mock.pushStoreDelta({
      kind: "peerUpdated",
      deviceId: "dev-bad",
      data: { not: "a device slice" },
      version: 1,
    });
    await sleep(150);
    const after = await listVia(rpc);
    expect(after.length).toBe(before.length);
    expect(after.some((d) => d.deviceId === "dev-bad")).toBe(false);
    // the daemon is unharmed — the product surface still answers
    const health = (await rpc.call("system.health", {})) as { nativeConnected: boolean };
    expect(health.nativeConnected).toBe(true);
  });

  it("binds a slice to its store owner and strips peer-authored trust fields", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.meshPeers = [
      {
        id: "nodeid-peer",
        deviceId: "dev-peer",
        online: true,
        // Deliberately no WhoIs DNS name: the slice may not fill this blank.
      },
    ];
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    await until(() => mock.storeWrites.length > 0);

    mock.pushStoreDelta({
      kind: "peerUpdated",
      deviceId: "dev-owner",
      data: peerSlice({ deviceId: "dev-claim" }),
      version: 1,
    });
    mock.pushStoreDelta({
      kind: "peerUpdated",
      deviceId: "dev-peer",
      data: {
        ...peerSlice(),
        tailnetDnsName: "evil.example.com",
        tailscaleId: "attacker-node",
        link: "connected",
      },
      version: 2,
    });

    const roster = await pollDevices(rpc, (devices) =>
      devices.some((device) => device.deviceId === "dev-peer"),
    );
    expect(roster.some((device) => device.deviceId === "dev-owner")).toBe(false);
    expect(roster.some((device) => device.deviceId === "dev-claim")).toBe(false);
    const peer = roster.find((device) => device.deviceId === "dev-peer")!;
    expect(peer.tailscaleId).toBe("nodeid-peer");
    expect(peer.tailnetDnsName).toBeUndefined();
    expect(peer.link).toBeUndefined();
    expect(JSON.stringify(peer)).not.toContain("evil.example.com");
    expect(JSON.stringify(peer)).not.toContain("attacker-node");
  });

  it("streams device.delta over the product WS when a peer joins", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");
    await until(() => mock.storeWrites.length > 0);

    const sub = (await rpc.call("device.subscribe", {})) as {
      subId: string;
      snapshot: DeviceInfo[];
    };
    expect(sub.snapshot.some((d) => d.self)).toBe(true);

    const slice = peerSlice({ deviceId: "dev-peer2", name: "peer2" });
    mock.pushStoreDelta({ kind: "peerUpdated", deviceId: "dev-peer2", data: slice, version: 1 });

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
