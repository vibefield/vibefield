// F1b (draft/thinking-freeway.md v0.3 §3, §4.5; FW-D5) end to end: TWO REAL fieldd daemons. The
// phone homes to desktop A and shows a session of desktop B's; the link to B is approved by B, the
// ask riding A's door. The phone calls `freeway.approve {device: "dev-b"}` on A's tailnet door; A
// forwards it whole over PeerLink (the sidecar-simulating ws-ctor of the DS-4 harness, which
// injects A's node id, so B's roster makes A a `peer-fieldd`), naming the phone by the device A's
// roster correlates its node to; B mints under ITS floor's key for the phone's node as B's roster
// knows it, audits the mint as the phone's, and the answer comes back through A. A peer daemon with
// no phone behind it is refused by B; B's own honest states reach the phone verbatim; and an owner
// A cannot reach is A's link's honest state, never a guess.
//
// What is NOT here: the phone dialing B's freeway with the approval (the host's verifier is
// field-native's, pinned by the approval MAC vector both sides read), and the kit's ask through
// its home (`FieldLink.approveFreeway`, the IOS half, owed).
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAuditSegment } from "@vibefield/audit";
import {
  approvalSigningInput,
  CONTRACTS_VERSION,
  FREEWAY_APPROVAL,
  FreewayApproveResult,
  type FreewayState,
  SOCKETS,
} from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productDoorPath, productPathSecret, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* already stopped is fine */
    }
  }
  cleanup = [];
});

const KEY_A = "a1".repeat(32);
const KEY_B = "b2".repeat(32);

/** A floor's freeway, up: its own floor boot and key. */
function upState(floorBootId: string, freewayKeyHex: string): FreewayState {
  return {
    revision: 1,
    up: true,
    floorBootId,
    hostBootId: `hb-${floorBootId}`,
    port: 50_123,
    pathSecret: "ab".repeat(32),
    localSecret: "cd".repeat(32),
    freewayKeyHex,
    keyGeneration: 1,
    links: [],
  };
}

function makeDataDir(): string {
  // a SHORT root: the mock mgmt socket must fit macOS's 104-byte sun_path
  const dataDir = mkdtempSync(join(tmpdir(), "vf-f1b-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  writeLinkFixture(dataDir, TEST_LOGIN);
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  return dataDir;
}

async function startMock(dataDir: string): Promise<MockMgmtServer> {
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

/** The sidecar half of A's dial to B (the DS-4 harness's): B's tailnet coordinate lands on B's
 * loopback door with the route secret joined, and the WhoIs login and A's NODE id are injected —
 * which B's roster correlates to A's desktop slice, so B makes A a `peer-fieldd`. */
function sidecar(loopback: () => string): WsCtor {
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      const target = url.includes("device-b.tailnet.ts.net") ? loopback() : "ws://127.0.0.1:1/";
      super(url.includes(".ts.net") ? target : url, {
        headers: { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": "node-a" },
      });
    }
  }
  return SidecarSim;
}

/** Desktop A (the phone's home) and desktop B (the owner of the session the phone opens), each on
 * its own scripted floor with its own freeway up; both rosters know the phone by its node. */
async function bootPair(): Promise<{
  A: FielddDaemon;
  B: FielddDaemon;
  mockA: MockMgmtServer;
  mockB: MockMgmtServer;
}> {
  const phone = registryPeer({
    nodeId: "node-phone",
    deviceId: "dev-phone",
    name: "phone",
    login: TEST_LOGIN,
  });
  const dirB = makeDataDir();
  const mockB = await startMock(dirB);
  mockB.meshDeviceId = "dev-b";
  mockB.meshPeers = [
    registryPeer({ nodeId: "node-a", deviceId: "dev-a", name: "device-a", login: TEST_LOGIN }),
    phone,
  ];
  mockB.storeSlices = new Map<string, unknown>([["dev-a", desktopSlice("dev-a", "device-a")]]);
  mockB.freewayState = upState("fb-b", KEY_B);
  const B = await bootstrap({ dataDir: dirB, controlPort: 0, dataPort: 0 });
  cleanup.push(() => B.stop());
  await until(() => mockB.meshServes.get("product") !== undefined, 15_000, "B's product serve");
  const bEndpoint = `ws://127.0.0.1:${B.controlPort}/t/${productPathSecret(mockB)}`;

  const dirA = makeDataDir();
  const mockA = await startMock(dirA);
  mockA.meshDeviceId = "dev-a";
  mockA.meshPeers = [
    {
      id: "node-b",
      deviceId: "dev-b",
      name: "device-b",
      online: true,
      whois: { login: TEST_LOGIN, deviceName: "device-b.tailnet.ts.net" },
    },
    phone,
  ];
  mockA.freewayState = upState("fb-a", KEY_A);
  const A = await bootstrap({
    dataDir: dirA,
    controlPort: 0,
    dataPort: 0,
    peerWebSocket: sidecar(() => bEndpoint),
  });
  cleanup.push(() => A.stop());
  await until(() => A.devices.get("dev-b") !== undefined, 15_000, "B in A's roster");
  await until(() => A.devices.get("dev-phone") !== undefined, 15_000, "the phone in A's roster");
  await until(() => B.devices.isDocHost("dev-a"), 15_000, "A as a desktop in B's roster");
  await until(() => B.devices.get("dev-phone") !== undefined, 15_000, "the phone in B's roster");
  return { A, B, mockA, mockB };
}

/** The phone on A's product door, the way A's sidecar delivers it: the login and its node. */
async function phoneOn(daemon: FielddDaemon, mock: MockMgmtServer): Promise<WsRpc> {
  await until(() => mock.meshServes.get("product") !== undefined, 15_000, "the product serve");
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`, {
    headers: { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": "node-phone" },
  });
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind: "ios",
  });
  return rpc;
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

async function mints(daemon: FielddDaemon): Promise<AuditRecordV1[]> {
  const out: AuditRecordV1[] = [];
  for (const name of readdirSync(daemon.audit.root)
    .filter((n) => n.endsWith(".jsonl"))
    .sort()) {
    out.push(...(await verifyAuditSegment(join(daemon.audit.root, name))).records);
  }
  return out.filter((record) => record.action === "freeway.approval.mint");
}

const macUnder = (keyHex: string, approval: FreewayApproveResult["approval"]): string =>
  createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(approvalSigningInput(approval.protected, approval.claims), "utf8")
    .digest("base64url");

describe("F1b — the phone's approval for another desktop, asked through its home", () => {
  it("is minted by THAT desktop for the phone's node under its own key, audited there as the phone's, and handed back through the home", async () => {
    const { A, B, mockA } = await bootPair();
    const phone = await phoneOn(A, mockA);

    const forwarded = FreewayApproveResult.parse(
      await phone.call("freeway.approve", { device: "dev-b" }),
    );
    const { approval } = forwarded;
    // B's floor boot and key, the phone's node as B's roster knows it, the self set
    expect(approval.protected.kid).toEqual({ floorBootId: "fb-b", keyGeneration: 1 });
    expect(approval.claims).toMatchObject({
      audienceFloorBootId: "fb-b",
      clientId: `freeway:${TEST_LOGIN}#node-phone`,
      principal: { kind: "tailnet", login: TEST_LOGIN, tailscaleId: "node-phone" },
      rights: ["geometry", "input", "read"],
    });
    expect(approval.mac).toBe(macUnder(KEY_B, approval));
    expect(approval.mac).not.toBe(macUnder(KEY_A, approval));

    // B audited the mint — target the phone, actor A's daemon recorded as acting for the phone —
    // with no key, MAC or nonce in the ledger; A minted nothing
    const atB = await mints(B);
    expect(atB.map((record) => record.phase)).toEqual(["attempt", "outcome"]);
    expect(atB[1]).toMatchObject({
      outcome: "succeeded",
      target: { kind: "device", id: "dev-phone" },
      actor: {
        kind: "peer-fieldd",
        id: "dev-a",
        nodeId: "node-a",
        onBehalfOf: { clientKind: "ios", deviceId: "dev-a", clientDeviceId: "dev-phone" },
      },
    });
    const said = JSON.stringify(atB);
    for (const secret of [KEY_B, approval.mac, approval.claims.nonce])
      expect(said).not.toContain(secret);
    expect(await mints(A)).toEqual([]);

    // the same phone's ask of its home alone is the home's own approval
    const home = FreewayApproveResult.parse(await phone.call("freeway.approve", {}));
    expect(home.approval.claims.audienceFloorBootId).toBe("fb-a");
    expect(home.approval.mac).toBe(macUnder(KEY_A, home.approval));
  }, 60_000);

  it("is refused by the owner when no phone stands behind the peer — a window on the home, the home's daemon on its own account", async () => {
    const { A, B } = await bootPair();
    const window = await openRpc(A.controlPort);
    await helloAs(window, A.tokens.mint(["terminal.attach"], "f1b-window").token);
    const fromWindow = await window.callErr("freeway.approve", { device: "dev-b" });
    expect(fromWindow.data).toMatchObject({
      kind: "FORBIDDEN_SCOPE",
      retryable: false,
      details: { method: "freeway.approve", principal: "peer-fieldd" },
    });
    await expect(A.peers.request("dev-b", "freeway.approve", {})).rejects.toMatchObject({
      kind: "FORBIDDEN_SCOPE",
    });
    // refused before anything is minted or audited
    expect(await mints(B)).toEqual([]);
  }, 60_000);

  it("hears the owner's own honest state verbatim — its freeway host down", async () => {
    const { A, mockA, mockB } = await bootPair();
    const phone = await phoneOn(A, mockA);
    mockB.pushDelta("native.freeway.state.subscribe", {
      revision: 2,
      up: false,
      floorBootId: "fb-b",
      links: [],
    });
    await until(() => mockB.meshServes.get("freeway") === undefined, 15_000, "B's withdrawal");
    const down = await phone.callErr("freeway.approve", { device: "dev-b" });
    expect(down.data).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: FREEWAY_APPROVAL.SERVICE, state: FREEWAY_APPROVAL.STATE_DOWN },
    });
  }, 60_000);

  it("an owner the home cannot reach is the home's link's honest state, never a guess", async () => {
    const { A, B, mockA } = await bootPair();
    const phone = await phoneOn(A, mockA);
    await B.stop();
    const unreachable = await phone.callErr("freeway.approve", { device: "dev-b" });
    expect(unreachable.data).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "peer-link", device: "dev-b", state: "unreachable" },
    });
  }, 60_000);
});
