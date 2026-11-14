// F1 (draft/thinking-freeway.md v0.3 §3, §4.3) — fieldd's freeway half on a booted daemon over the
// scripted floor: the roster's declaration reaches the floor; the host's serve stands on its own
// port behind the linked login only while the floor says the host is up; a restarted fieldd leaves
// that serve where it stands, so every phone link on it survives (FW-L10, F1's exit "fieldd
// restarted mid-session leaves the terminal live"); the phone's approval is minted under the
// floor's key, audited, and refused to a desktop's node and while the host is down; each join and
// leave the host reports is an audit row, and what the floor could not hold is said; an unlink
// revokes every link; and Remove for a phone (item 406) revokes that phone's alone.
import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyAuditSegment } from "@vibefield/audit";
import {
  approvalSigningInput,
  CONTRACTS_VERSION,
  DEVICE_REFUSALS,
  DeviceRemoveResult,
  DOC_SYNC_RECORD,
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
import { bootstrap, DocumentService, type FielddDaemon } from "../src/index";
import { systemAccount, systemDocId } from "../src/library-doc";
import { SettingsDocService } from "../src/settings-doc";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { helloAs, type RpcErrorShape, until, WsRpc } from "./ws-rpc";

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

/** The product door the way the SIDECAR delivers a caller from `node`, whose hello says `kind`. */
async function fromNode(
  daemon: FielddDaemon,
  mock: MockMgmtServer,
  node: string,
  kind = "ios",
): Promise<WsRpc> {
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
    clientKind: kind,
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

  // Item 406 (VF-PM's rulings of 2026-11-14, Q-PM2) — only a phone's hello carries an approval
  // (FW-D6: a desktop's carries none), so the node fieldd mints one for is positively a phone, and
  // the account's known phones remember it: its row carries the fact Remove is offered on.
  it("406 — the node an approval is minted for is remembered as a phone; a desktop's node never is", async () => {
    const { dataDir, mock } = await world(upState());
    const daemon = await boot(dataDir);
    await until(() => daemon.devices.get("dev-phone") !== undefined, 15_000, "the phone's row");
    await until(() => daemon.devices.isDocHost("dev-desk-b"), 15_000, "the desktop's slice");
    // a hello that does not say "ios", so the approval alone is the evidence: the desktop a phone
    // reaches through its home sees no hello of the phone's at all (F1b), only the approval
    const phone = await fromNode(daemon, mock, "node-phone", "debug");
    FreewayApproveResult.parse(await phone.call("freeway.approve", {}));
    await until(
      () => daemon.devices.get("dev-phone")?.phone?.via === "freeway",
      15_000,
      "the phone remembered",
    );
    // a desktop's node: its hello says "ios" and its approval is refused, and neither makes it one
    const desktop = await fromNode(daemon, mock, "node-desk-b");
    expect((await desktop.callErr("freeway.approve", {})).data?.kind).toBe("FORBIDDEN_SCOPE");
    expect([...(await daemon.settingsDoc.knownPhones()).keys()]).toEqual(["dev-phone"]);
    expect(daemon.devices.get("dev-desk-b")?.phone).toBeUndefined();
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

// Item 406 (track WI's Desktop slice; WI-W5b A; VF-PM's rulings of 2026-11-14 04:49Z) — Remove for
// a phone on a booted daemon, kill-matrix style: the act is a desktop caller's and a known phone's
// alone; it closes what the phone holds here (its product socket, its freeway client by the exact
// id the host keys it by), audits the device and never its name, and the phone that dials back is
// told the typed word whatever it carries. A peer daemon forwarding FOR the removed phone is
// refused without retry, `freeway.approve` included. A second desktop, the refusal merged into its settings
// document, sweeps the same and audits it as its own. The order of the sweep's steps is
// device-removal.test.ts's; the door's unit rows are tailnet-door.test.ts's.
describe("406 — Remove for a phone, on a booted daemon", () => {
  const NAME = "pocket-7q";
  const SETTINGS_ID = systemDocId("settings", systemAccount(TEST_LOGIN, undefined));
  const removedWord = {
    kind: "UNAUTHORIZED",
    retryable: false,
    details: { reason: DEVICE_REFUSALS.REASON_REMOVED },
  };

  /** The world, its phone named as a person names one (the audit must never say it). */
  async function phoneWorld(): Promise<{ dataDir: string; mock: MockMgmtServer }> {
    const made = await world(upState());
    made.mock.meshPeers = [
      registryPeer({ nodeId: "node-phone", deviceId: "dev-phone", name: NAME, login: TEST_LOGIN }),
      registryPeer({
        nodeId: "node-desk-b",
        deviceId: "dev-desk-b",
        name: "desk-b",
        login: TEST_LOGIN,
      }),
    ];
    return made;
  }

  /** Booted, with the phone's row, the other desktop's slice and the floor's freeway read. */
  async function booted(dataDir: string, mock: MockMgmtServer): Promise<FielddDaemon> {
    const daemon = await boot(dataDir);
    await until(() => daemon.devices.get("dev-phone") !== undefined, 15_000, "the phone's row");
    await until(() => daemon.devices.isDocHost("dev-desk-b"), 15_000, "the desktop's slice");
    await until(() => mock.meshServes.get("freeway") !== undefined, 15_000, "the freeway serve");
    return daemon;
  }

  /** The phone's product hello ("ios"), which makes it a KNOWN phone (S2), and its socket. */
  async function knownPhone(daemon: FielddDaemon, mock: MockMgmtServer): Promise<WsRpc> {
    const phone = await fromNode(daemon, mock, "node-phone");
    await until(() => daemon.devices.get("dev-phone")?.phone !== undefined, 15_000, "the fact");
    return phone;
  }

  /** A loopback caller holding `token`, its hello saying `kind`. */
  async function local(daemon: FielddDaemon, token: string, kind: string): Promise<WsRpc> {
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const rpc = new WsRpc(ws);
    await helloAs(rpc, token, kind);
    return rpc;
  }

  /** `node` dialling the door again, with `credential` or none: what its hello is answered, once
   * the door has closed. */
  async function helloRefused(
    daemon: FielddDaemon,
    mock: MockMgmtServer,
    node: string,
    credential?: string,
  ): Promise<RpcErrorShape> {
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`, {
      headers: { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": node },
    });
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const rpc = new WsRpc(ws);
    const refused = await rpc.callErr("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "ios",
      ...(credential !== undefined ? { credential } : {}),
    });
    await until(() => rpc.closed, 15_000, "the door closing");
    return refused;
  }

  /** `to` reconnects to `from`: the doc-sync VERSION exchange against `to`'s own host, as
   * device-service.test.ts drives it. True when something crossed. */
  async function exchange(from: DocumentService, to: DocumentService): Promise<boolean> {
    const theirs = await to.hostVersion(SETTINGS_ID);
    const answer = theirs === null ? null : await from.hostAnswer(SETTINGS_ID, theirs);
    if (answer === null || answer.update === null) return false;
    const outcome = await to.applyRemoteRecord(SETTINGS_ID, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: answer.meta,
      payload: answer.update,
    });
    return outcome.applied;
  }

  it("is a desktop caller's alone, and a known phone's alone: a phone, a plugin and a copied token are refused; this desktop, a desktop and a device never seen as a phone are refused; nothing is written", async () => {
    const { dataDir, mock } = await phoneWorld();
    const daemon = await booted(dataDir, mock);
    // the phone itself, its hello saying no "ios" (so it never becomes a known phone here): no
    // tailnet grant holds settings.manage
    const phone = await fromNode(daemon, mock, "node-phone", "debug");
    const asPhone = await phone.callErr("device.remove", { deviceId: "dev-phone" });
    expect(asPhone.data?.kind).toBe("FORBIDDEN_SCOPE");
    // a plugin, and a window's token copied into another client, each holding the scope
    const pluginToken = daemon.tokens.mint(["settings.manage"], "a plugin", {
      pluginId: "p.copied",
    });
    const copied = daemon.tokens.mint(["settings.manage"], "copied");
    for (const caller of [
      await local(daemon, pluginToken.token, "plugin-worker"),
      await local(daemon, copied.token, "debug"),
    ]) {
      const refused = await caller.callErr("device.remove", { deviceId: "dev-phone" });
      expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
      expect(refused.message).toContain("trusted desktop caller");
    }
    // a window passes the gate, and Remove refuses anything but a device known to be a phone
    const window = await local(daemon, copied.token, "renderer");
    const kindOf = async (deviceId: unknown) =>
      (await window.callErr("device.remove", { deviceId })).data?.kind;
    expect(await kindOf(daemon.devices.currentDeviceId())).toBe("PRECONDITION_FAILED");
    expect(await kindOf("dev-desk-b")).toBe("PRECONDITION_FAILED");
    expect(await kindOf("dev-phone")).toBe("PRECONDITION_FAILED");
    expect(await kindOf("dev-nobody")).toBe("NOT_FOUND");
    expect(await kindOf(7)).toBe("PRECONDITION_FAILED");
    expect(await daemon.settingsDoc.refusals()).toEqual({
      deviceIds: new Set(),
      nodeIds: new Set(),
    });
    expect(daemon.devices.get("dev-phone")).toBeDefined();
    expect(phone.closed).toBe(false);
  }, 60_000);

  it("closes a connected phone here, sends its exact freeway client, audits the device and never its name; its next hello hears the word whatever it carries; a second Remove answers removed false", async () => {
    const { dataDir, mock } = await phoneWorld();
    const daemon = await booted(dataDir, mock);
    const phone = await knownPhone(daemon, mock);
    const shell = await shellOf(daemon);
    const removed = DeviceRemoveResult.parse(
      await shell.call("device.remove", { deviceId: "dev-phone" }),
    );
    // its one product socket here (the scripted host closes no link)
    expect(removed).toEqual({ removed: true, closed: 1 });
    await until(() => phone.closed, 15_000, "the phone's socket");
    expect(mock.freewayRevokes).toContainEqual({
      clientId: `freeway:${TEST_LOGIN}#node-phone~hb-1`,
    });
    // forgotten, its record with it, and never admitted to the freeway again
    expect(daemon.devices.get("dev-phone")).toBeUndefined();
    expect(await daemon.settingsDoc.refusals()).toEqual({
      deviceIds: new Set(["dev-phone"]),
      nodeIds: new Set(["node-phone"]),
    });
    expect((await daemon.settingsDoc.knownPhones()).has("dev-phone")).toBe(false);
    await until(
      () => !admits(mock.freewayDeclarations.at(-1), "dev-phone", "phone"),
      15_000,
      "the declaration without it",
    );
    const rows = (await auditRecords(daemon)).filter((r) => r.action === "device.remove");
    expect(rows.map((record) => record.phase)).toEqual(["attempt", "outcome"]);
    expect(rows[1]).toMatchObject({
      outcome: "succeeded",
      target: { kind: "device", id: "dev-phone" },
      actor: { kind: "shell-main" },
      attrs: { closed: 1 },
    });
    expect(JSON.stringify(rows)).not.toContain(NAME);
    // dialling back: the word, then the close — with no credential, or a verified token
    const token = daemon.tokens.mint(["workspace.read"], "copied").token;
    for (const credential of [undefined, token]) {
      const refused = await helloRefused(daemon, mock, "node-phone", credential);
      expect(refused.data, String(credential !== undefined)).toEqual(removedWord);
    }
    // Remove again: declarative — nothing written, nothing audited
    expect(await shell.call("device.remove", { deviceId: "dev-phone" })).toEqual({
      removed: false,
      closed: 0,
    });
    const after = (await auditRecords(daemon)).filter((r) => r.action === "device.remove");
    expect(after).toHaveLength(2);
  }, 60_000);

  it("after Remove, a peer daemon's forward FOR the phone is refused without retry, `freeway.approve`'s too; before it both were served, and its forwards for a window still are", async () => {
    const { dataDir, mock } = await phoneWorld();
    const daemon = await booted(dataDir, mock);
    await knownPhone(daemon, mock);
    // the phone's home, the other desktop, forwarding for it (F1b)
    const home = await fromNode(daemon, mock, "node-desk-b", "peer-fieldd");
    const forPhone = {
      forward: {
        onBehalfOf: { clientKind: "ios", deviceId: "dev-desk-b", clientDeviceId: "dev-phone" },
      },
    };
    await home.call("device.list", forPhone);
    FreewayApproveResult.parse(await home.call("freeway.approve", forPhone));
    const shell = await shellOf(daemon);
    await shell.call("device.remove", { deviceId: "dev-phone" });

    for (const method of ["device.list", "freeway.approve"]) {
      const refused = await home.callErr(method, forPhone);
      // never `uncorrelated`, retryable: the home would ask again and again
      expect(refused.data, method).toEqual(removedWord);
    }
    const forWindow = {
      forward: { onBehalfOf: { clientKind: "renderer", deviceId: "dev-desk-b", windowId: "w-1" } },
    };
    await home.call("device.list", forWindow);
    expect(home.closed).toBe(false);
    // the one approval is the one minted before Remove
    const mints = (await auditRecords(daemon)).filter(
      (r) => r.action === "freeway.approval.mint" && r.phase === "outcome",
    );
    expect(mints).toHaveLength(1);
  }, 60_000);

  it("a second desktop refuses after the merge: the phone's socket closes there, its exact freeway client is revoked, the sweep is audited as that desktop's own, and its next hello hears the word", async () => {
    const { dataDir, mock } = await phoneWorld();
    const daemon = await booted(dataDir, mock);
    const phone = await fromNode(daemon, mock, "node-phone");

    // the desktop where the person pressed Remove: its settings document on its own disk and host,
    // registered as its mountSystemDocs registers it
    const peerDir = mkdtempSync(join(tmpdir(), "vf-fw-peer-"));
    cleanup.push(() => rmSync(peerDir, { recursive: true, force: true }));
    const peer = new SettingsDocService({ dataDir: peerDir });
    cleanup.push(() => peer.dispose());
    const peerDocs = new DocumentService({ dataDir: peerDir });
    cleanup.push(() => peerDocs.dispose());
    peerDocs.registerSystemDoc(SETTINGS_ID, "Settings", peer.hostDoc(), peer.hostOwner());
    const wrote = await peer.refuseDevice("remove", "dev-phone", ["node-phone"], "dev-desk-b");
    expect(wrote).toEqual({ wrote: true });

    expect(await exchange(peerDocs, daemon.docs), "the refusal crossed").toBe(true);
    await until(() => phone.closed, 15_000, "the phone's socket");
    expect(mock.freewayRevokes).toContainEqual({
      clientId: `freeway:${TEST_LOGIN}#node-phone~hb-1`,
    });
    expect(daemon.devices.get("dev-phone")).toBeUndefined();
    const outcomes = await eventually(
      async () =>
        (await auditRecords(daemon)).filter(
          (r) => r.action === "device.remove" && r.phase === "outcome",
        ),
      "the sweep's row",
    );
    expect(outcomes[0]).toMatchObject({
      outcome: "succeeded",
      target: { kind: "device", id: "dev-phone" },
      actor: { kind: "system", id: "fieldd" },
      attrs: { closed: 1 },
    });
    const refused = await helloRefused(daemon, mock, "node-phone");
    expect(refused.data).toEqual(removedWord);
  }, 60_000);

  // S3's fold (VF-PM's ruling of 2026-11-14 06:18Z, (5b)) — a refusal that stood before this boot:
  // merged, then the daemon stopped before its sweep (a crash, or a same-uid kill). field-native
  // outlived it, so its freeway host may still hold the phone's keyrings. After the roster's first
  // pass the boot sweep revokes the phone's client by its exact id, writes no audit row, and any
  // line it says is its code and its counts alone. The door refuses the phone from its first hello.
  it("a refusal standing at boot is swept after the roster's first pass: its exact freeway client revoked, no audit row, and its line carries its code and counts alone", async () => {
    const { dataDir, mock } = await phoneWorld();
    mock.freewayRevokeCloses = 1;
    const before = new SettingsDocService({ dataDir });
    await before.refuseDevice("remove", "dev-phone", ["node-phone"], "dev-desk-b");
    await before.dispose();
    const daemon = await boot(dataDir);
    const clientId = `freeway:${TEST_LOGIN}#node-phone~hb-1`;
    const asked = (params: unknown) => (params as { clientId?: unknown } | null)?.clientId;
    await until(
      () => mock.freewayRevokes.some((params) => asked(params) === clientId),
      15_000,
      "the boot sweep's revoke",
    );
    expect((await auditRecords(daemon)).filter((r) => r.action === "device.remove")).toEqual([]);
    await until(() => mock.meshServes.get("product") !== undefined, 15_000, "the product serve");
    expect(await helloRefused(daemon, mock, "node-phone")).toMatchObject({ data: removedWord });
    // whichever line the sweep said (the host's count reaches it only once the floor has named
    // its host), it is the code and two counts, and nothing that names the phone or the account
    const file = join(dataDir, "logs", "system", "fieldd.ndjson");
    const lines = existsSync(file)
      ? readFileSync(file, "utf8")
          .split("\n")
          .filter((line) => line.includes("fieldd.devices.removal_swept_at_boot"))
      : [];
    for (const line of lines) {
      const record = JSON.parse(line) as { attrs?: Record<string, unknown> };
      expect(Object.keys(record.attrs ?? {}).sort()).toEqual(["connections", "links"]);
      for (const named of [TEST_LOGIN, "node-phone", "dev-phone", NAME, "freeway:", "ts.net"])
        expect(line).not.toContain(named);
    }
  }, 60_000);
});
