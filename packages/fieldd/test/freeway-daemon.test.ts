// F1 (draft/thinking-freeway.md v0.3 §3, §4.3) — fieldd's freeway half on a booted daemon over the
// scripted floor: the roster's declaration reaches the floor; the host's serve stands on its own
// port behind the linked login only while the floor says the host is up; a restarted fieldd leaves
// that serve where it stands, so every phone link on it survives (FW-L10, F1's exit "fieldd
// restarted mid-session leaves the terminal live"); the phone's approval is minted under the
// floor's key, audited, and refused to a desktop's node and while the host is down; each join and
// leave the host reports is an audit row, and what the floor could not hold is said; an unlink
// revokes every link.
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
  type FreewayDeclareParams,
  type FreewayState,
  PORTS,
  SOCKETS,
} from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const KEY = "ef".repeat(32);
const SECRET = "ab".repeat(32);

function upState(over: Partial<FreewayState> = {}): FreewayState {
  return {
    revision: 1,
    up: true,
    floorBootId: "fb-floor",
    hostBootId: "hb-1",
    port: 50_123,
    pathSecret: SECRET,
    localSecret: "cd".repeat(32),
    freewayKeyHex: KEY,
    keyGeneration: 1,
    links: [],
    ...over,
  };
}

function downState(revision: number): FreewayState {
  return { revision, up: false, floorBootId: "fb-floor", links: [] };
}

/** This desktop (`dev-desk`), the person's phone and their other desktop, as the floor's mesh
 * names them; the other desktop's slice is what says `docHost`. */
async function world(state: FreewayState): Promise<{ dataDir: string; mock: MockMgmtServer }> {
  // a SHORT root: the mock mgmt socket must fit macOS's 104-byte sun_path
  const dataDir = mkdtempSync(join(tmpdir(), "vf-fw-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir, TEST_LOGIN);
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  mock.meshDeviceId = "dev-desk";
  mock.meshPeers = [
    registryPeer({ nodeId: "node-phone", deviceId: "dev-phone", name: "phone", login: TEST_LOGIN }),
    registryPeer({
      nodeId: "node-desk-b",
      deviceId: "dev-desk-b",
      name: "desk-b",
      login: TEST_LOGIN,
    }),
  ];
  mock.storeSlices = new Map<string, unknown>([
    ["dev-desk-b", desktopSlice("dev-desk-b", "desk-b")],
  ]);
  mock.freewayState = state;
  return { dataDir, mock };
}

async function boot(dataDir: string): Promise<FielddDaemon> {
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return daemon;
}

/** The product door the way the SIDECAR delivers a caller from `node`. */
async function fromNode(daemon: FielddDaemon, mock: MockMgmtServer, node: string): Promise<WsRpc> {
  await until(() => mock.meshServes.get("product") !== undefined, 15_000, "the product serve");
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`, {
    headers: { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": node },
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

async function shellOf(daemon: FielddDaemon): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, daemon.shellToken, "shell-main");
  return rpc;
}

/** The records `read` answers, once it answers any — the ledger is written after the effect, so a
 * row the floor sent is read until it lands, within `ms`. */
async function eventually<T>(read: () => Promise<T[]>, label: string, ms = 15_000): Promise<T[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = await read();
    if (found.length > 0) return found;
    if (Date.now() > deadline) throw new Error(`eventually: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function auditRecords(daemon: FielddDaemon): Promise<AuditRecordV1[]> {
  const out: AuditRecordV1[] = [];
  for (const name of readdirSync(daemon.audit.root)
    .filter((n) => n.endsWith(".jsonl"))
    .sort()) {
    out.push(...(await verifyAuditSegment(join(daemon.audit.root, name))).records);
  }
  return out;
}

const freewayAdds = (mock: MockMgmtServer) =>
  mock.meshAddParams.filter((params) => params["serveId"] === "freeway");

function admits(declaration: unknown, deviceId: string, role: "desktop" | "phone"): boolean {
  const admit = (declaration as FreewayDeclareParams).admit ?? [];
  return admit.some((row) => row.deviceId === deviceId && row.role === role);
}

describe("F1 — fieldd's freeway half on a booted daemon", () => {
  it("declares the roster to the floor, and serves the host on its own port only while it is up", async () => {
    const { dataDir, mock } = await world(downState(1));
    await boot(dataDir);
    await until(
      () => {
        const last = mock.freewayDeclarations.at(-1);
        return admits(last, "dev-phone", "phone") && admits(last, "dev-desk-b", "desktop");
      },
      15_000,
      "the roster's declaration",
    );
    expect(mock.freewayDeclarations.at(-1)).toMatchObject({
      deviceId: "dev-desk",
      doors: {},
      exposure: { terminals: true },
    });
    // the host down: the floor-held listener is no one's to dial
    expect(mock.meshServes.get("freeway")).toBeUndefined();
    mock.pushDelta("native.freeway.state.subscribe", upState({ revision: 2 }));
    await until(() => mock.meshServes.get("freeway") !== undefined, 15_000, "the freeway serve");
    expect(freewayAdds(mock)).toEqual([
      {
        serveId: "freeway",
        name: "freeway",
        listenPort: PORTS.FREEWAY_SERVE,
        target: { kind: "port", port: 50_123 },
        tls: false,
        allow: [TEST_LOGIN],
        pathSecret: SECRET,
        secretDoor: "freeway",
      },
    ]);
    // the host gone again: its serve is withdrawn
    mock.pushDelta("native.freeway.state.subscribe", downState(3));
    await until(() => mock.meshServes.get("freeway") === undefined, 15_000, "the withdrawal");
  }, 60_000);

  it("a restarted fieldd leaves the floor's serve standing — no removal, no second add (FW-L10)", async () => {
    const { dataDir, mock } = await world(upState());
    const first = await boot(dataDir);
    await until(() => mock.meshServes.get("freeway") !== undefined, 15_000, "the first serve");
    expect(freewayAdds(mock)).toHaveLength(1);
    await first.stop();
    const second = await boot(dataDir);
    await until(
      () => second.mesh.serves().some((s) => s.serveId === "freeway" && s.status === "active"),
      15_000,
      "the successor adopting the serve",
    );
    expect(mock.meshRemovedServeIds).not.toContain("freeway");
    expect(freewayAdds(mock)).toHaveLength(1);
  }, 60_000);

  it("approves the phone under the floor's key, audited without a secret; refuses a desktop's node and a host that is down", async () => {
    const { dataDir, mock } = await world(upState());
    const daemon = await boot(dataDir);
    await until(() => daemon.devices.get("dev-phone") !== undefined, 15_000, "the phone's row");
    await until(() => daemon.devices.isDocHost("dev-desk-b"), 15_000, "the desktop's slice");
    const phone = await fromNode(daemon, mock, "node-phone");
    const approved = FreewayApproveResult.parse(await phone.call("freeway.approve", {}));
    const { approval } = approved;
    expect(approval.claims).toMatchObject({
      audienceFloorBootId: "fb-floor",
      clientId: `freeway:${TEST_LOGIN}#node-phone`,
      principal: { kind: "tailnet", login: TEST_LOGIN, tailscaleId: "node-phone" },
      rights: ["geometry", "input", "read"],
    });
    expect(approval.protected.kid).toEqual({ floorBootId: "fb-floor", keyGeneration: 1 });
    const mac = createHmac("sha256", Buffer.from(KEY, "hex"))
      .update(approvalSigningInput(approval.protected, approval.claims), "utf8")
      .digest("base64url");
    expect(approval.mac).toBe(mac);

    const mints = (await auditRecords(daemon)).filter((r) => r.action === "freeway.approval.mint");
    expect(mints.map((record) => record.phase)).toEqual(["attempt", "outcome"]);
    expect(mints[1]).toMatchObject({
      outcome: "succeeded",
      target: { kind: "device", id: "dev-phone" },
    });
    const said = JSON.stringify(mints);
    for (const secret of [KEY, approval.mac, approval.claims.nonce])
      expect(said).not.toContain(secret);

    const desktop = await fromNode(daemon, mock, "node-desk-b");
    expect((await desktop.callErr("freeway.approve", {})).data?.kind).toBe("FORBIDDEN_SCOPE");

    mock.pushDelta("native.freeway.state.subscribe", downState(2));
    await until(() => mock.meshServes.get("freeway") === undefined, 15_000, "the withdrawal");
    const down = await phone.callErr("freeway.approve", {});
    expect(down.data).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: FREEWAY_APPROVAL.SERVICE, state: FREEWAY_APPROVAL.STATE_DOWN },
    });
  }, 60_000);

  it("audits each join and leave the host reports, in order, and says what the floor could not hold", async () => {
    const { dataDir, mock } = await world(upState());
    const row = (kind: "joined" | "left", at: number, cursor: number) => ({
      kind,
      clientId: `freeway:${TEST_LOGIN}#node-phone~hb-1`,
      sessionId: "term-1",
      rights: ["geometry", "input", "read"],
      at,
      cursor,
    });
    // what the floor held while no fieldd listened, and how much it could not
    mock.freewayJoins = { floorBootId: "fb-floor", rows: [row("joined", 10, 1)], dropped: 2 };
    const daemon = await boot(dataDir);
    const outcomes = async (action: string) =>
      (await auditRecords(daemon)).filter((r) => r.action === action && r.phase === "outcome");
    const lost = await eventually(() => outcomes("freeway.joins.lost"), "the lost row");
    const [joined] = await outcomes("freeway.session.join");
    expect(joined).toMatchObject({
      outcome: "succeeded",
      target: { kind: "terminal", id: "term-1" },
      attrs: { clientId: `freeway:${TEST_LOGIN}#node-phone~hb-1`, at: 10, cursor: 1 },
    });
    expect(lost[0]).toMatchObject({
      outcome: "failed",
      reasonCode: "BACKLOG_FULL",
      target: { kind: "freeway", id: "fb-floor" },
      attrs: { dropped: 2, malformed: 0 },
    });
    // written, then acknowledged: the floor may let the row go
    await until(() => mock.freewayJoinAcks.length === 1, 15_000, "the acknowledgment");
    expect(mock.freewayJoinAcks).toEqual([1]);
    mock.pushDelta("native.freeway.joins.subscribe", {
      floorBootId: "fb-floor",
      rows: [row("left", 20, 2)],
      dropped: 2,
    });
    const left = await eventually(() => outcomes("freeway.session.leave"), "the leave row");
    expect(left[0]).toMatchObject({
      target: { kind: "terminal", id: "term-1" },
      attrs: { at: 20 },
    });
    await until(() => mock.freewayJoinAcks.length === 2, 15_000, "the second acknowledgment");
    expect(mock.freewayJoinAcks).toEqual([1, 2]);
    // the total did not grow: no second lost row
    expect(await outcomes("freeway.joins.lost")).toHaveLength(1);
  }, 60_000);

  it("an unlink revokes every freeway link, and the serve goes with the login", async () => {
    const { dataDir, mock } = await world(upState());
    const daemon = await boot(dataDir);
    await until(() => mock.meshServes.get("freeway") !== undefined, 15_000, "the freeway serve");
    expect(mock.freewayRevokes).toEqual([]);
    const shell = await shellOf(daemon);
    await shell.call("user.link.unlink", {});
    await until(() => mock.freewayRevokes.length === 1, 15_000, "the revoke");
    expect(mock.freewayRevokes[0]).toEqual({});
    expect(mock.meshServes.get("freeway")).toBeUndefined();
  }, 60_000);
});
