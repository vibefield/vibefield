// SP-3 / AR-8b — `index.openTicket`, the direct plane's door. SP-3 declared it
// answering UNAVAILABLE {service: "index", state: "direct-plane-unbuilt"};
// AR-8b (thinking-ar-history-room.md §3) gives it its handler, for a window on
// THIS desktop: the loopback set (rosetta's session socket and the daemon's
// origin) beside an RO-10 grant for exactly that session, minted with the key
// the current rosettad generation verifies (rosetta docs/AUTH.md). The rows,
// against the scripted rosettad (which checks credentials as the pin's daemon
// does): who gets a ticket and who is refused, what the grant opens and what it
// never opens, that every ask is a fresh grant, that expiry is honoured, that
// the plane's off path is honest, and that a daemon restarted mid-ticket is
// re-ticketed on the next ask. The last block runs the same seam against the
// REAL rosettad (opt-in via FIELDD_ROSETTAD_BIN), over rosetta's own client.
// RO-13 (2026-10-04): the desktop window's grant carries `files` beside
// `read` and reads its session's recorded files; every other holder's carries
// `read` alone and is `wrong-scope` there — against both daemons.
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RosettaClient,
  type SessionSubscriptionHandlers,
  UnauthorizedError,
} from "@rosetta/protocol";
import { SCOPE_FILES, SCOPE_READ, verifyGrant } from "@rosetta/protocol/grants";
import { verifyAuditSegment } from "@vibefield/audit";
import {
  type CallerContext,
  CONTRACTS_VERSION,
  INDEX_TICKET,
  IndexEndpointSet,
  IndexOpenTicket,
  type IndexSessionsResult,
  IndexTicketUnavailableDetails,
  type Scope,
  SOCKETS,
} from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { INDEX_SERVE_ID, IndexTicketMinter, indexTicketScopes } from "../src/index-serve";
import type { RosettadState } from "../src/rosettad-supervisor";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productDoorPath, productPathSecret, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { helloAs, type RpcErrorShape, until, WsRpc } from "./ws-rpc";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, "fixtures", "fake-rosettad.mjs");

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

function makeDataDir(): string {
  // a SHORT root: the mock mgmt socket must fit macOS's 104-byte sun_path
  const dataDir = mkdtempSync(join(tmpdir(), "vf-ixt-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir, TEST_LOGIN);
  return dataDir;
}

async function startMock(dataDir: string): Promise<MockMgmtServer> {
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

const SESSIONS = [
  {
    id: "s1",
    native_session_id: "nat-1",
    runtime_id: "rt1",
    project_id: "p1",
    cwd: "/w/one",
    parent_session_id: null,
    delegation: null,
    root_session_id: "s1",
    role: "main",
    title: "First",
    summary: null,
    started_at: 10_000,
    updated_at: 20_000,
    activity: { first_at: 11_000, last_at: 19_000 },
    stream_state: "indexed",
  },
  {
    id: "s2",
    native_session_id: "nat-2",
    runtime_id: "rt1",
    project_id: "p1",
    cwd: "/w/one",
    parent_session_id: null,
    delegation: null,
    root_session_id: "s2",
    role: "main",
    title: "Second",
    summary: null,
    started_at: 10_000,
    updated_at: 21_000,
    activity: null,
    stream_state: "indexed",
  },
];

interface World {
  daemon: FielddDaemon;
  mock: MockMgmtServer;
  dataDir: string;
  /** every grant key the supervisor handed a generation, read at its spawn */
  keys: Buffer[];
  /** every bearer, the same way */
  bearers: string[];
}

async function boot(
  opts: {
    indexDirectPlane?: boolean;
    indexTicketTtlMs?: number;
    rosettad?: boolean;
    mode?: string;
  } = {},
): Promise<World> {
  const dataDir = makeDataDir();
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  const sessionsFile = join(dataDir, "sessions.json");
  writeFileSync(sessionsFile, JSON.stringify(SESSIONS));
  const mock = await startMock(dataDir);
  const keys: Buffer[] = [];
  const bearers: string[] = [];
  const fakeRosettad = ((_bin: string, args: readonly string[], options: object) => {
    // the files exist only between the write and the daemon's ready line —
    // the spawn is where a test can read what the generation was handed
    keys.push(readFileSync(args[args.indexOf("--grant-key-file") + 1] as string));
    bearers.push(readFileSync(args[args.indexOf("--token-file") + 1] as string, "latin1"));
    return spawn(process.execPath, [FAKE, ...args], {
      ...options,
      env: {
        ...process.env,
        FAKE_ROSETTAD_MODE: opts.mode ?? "ok",
        FAKE_ROSETTAD_SESSIONS: sessionsFile,
      },
    });
  }) as unknown as typeof spawn;
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    allowedOrigins: ["file://", "vibefield-app://shell"],
    ...(opts.rosettad === false
      ? {}
      : { rosettadBin: "/stand-in/rosettad", rosettadSpawn: fakeRosettad, rosettadHome: home }),
    ...(opts.indexDirectPlane !== undefined ? { indexDirectPlane: opts.indexDirectPlane } : {}),
    ...(opts.indexTicketTtlMs !== undefined ? { indexTicketTtlMs: opts.indexTicketTtlMs } : {}),
  });
  cleanup.push(() => daemon.stop());
  return { daemon, mock, dataDir, keys, bearers };
}

async function open(url: string, headers?: Record<string, string>): Promise<WsRpc> {
  const ws = new WebSocket(url, headers ? { headers } : {});
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

/** A renderer window on this desktop holding exactly `scopes` — the shell
 * mints it with a participant, as main does per webContents generation. */
async function windowOf(daemon: FielddDaemon, scopes: Scope[], suffix = "w1"): Promise<WsRpc> {
  const shell = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(shell, daemon.shellToken, "shell-main");
  const minted = (await shell.call("system.mintWindowToken", {
    scopes,
    label: `window-${suffix}`,
    rendererParticipant: {
      participantId: `renderer:ixt:${suffix}`,
      incarnation: `renderer:ixt:${suffix}:document-1`,
    },
  })) as { token: string };
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(rpc, minted.token);
  return rpc;
}

/** A plain token on this desktop (no participant): `local-token:<id>`. */
async function tokenOf(daemon: FielddDaemon, scopes: Scope[], pluginId?: string): Promise<WsRpc> {
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(
    rpc,
    daemon.tokens.mint(scopes, pluginId ?? "ixt-token", pluginId ? { pluginId } : undefined).token,
  );
  return rpc;
}

/** The product door the way the SIDECAR delivers a tailnet caller. */
async function tailnetCaller(
  daemon: FielddDaemon,
  mock: MockMgmtServer,
  login: string,
): Promise<WsRpc> {
  await until(() => mock.meshServes.get("product") !== undefined, 15_000);
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`, {
    "Tailscale-User-Login": login,
  });
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind: "ios",
  });
  return rpc;
}

async function ready(daemon: FielddDaemon): Promise<void> {
  await until(() => daemon.health().rosettad.phase === "ready", 10_000);
}

async function ticketFor(rpc: WsRpc, sessionId: string): Promise<IndexOpenTicket> {
  return IndexOpenTicket.parse(await rpc.call("index.openTicket", { sessionId }));
}

/** Dial a session socket with a grant on one of its two carriers: the
 * `Authorization` header (a native client) or the subprotocol pair (a
 * browser, which cannot set headers). Resolves with the first frame, or with
 * the refusal's status and rosetta's reason header. */
function dialSession(
  url: string,
  grant: string | null,
  carrier: "header" | "subprotocol" = "header",
): Promise<{ opened: true; frame: unknown } | { opened: false; status: number; reason: string }> {
  const ws =
    grant === null
      ? new WebSocket(url)
      : carrier === "header"
        ? new WebSocket(url, { headers: { authorization: `Rosetta-Grant ${grant}` } })
        : new WebSocket(url, ["rosetta", `rosetta.grant.${grant}`]);
  cleanup.push(() => ws.terminate());
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      resolve({ opened: true, frame: JSON.parse(String(data)) });
      ws.close();
    });
    ws.once("unexpected-response", (_req, res) => {
      resolve({
        opened: false,
        status: res.statusCode ?? 0,
        reason: String(res.headers["x-rosetta-auth"] ?? ""),
      });
      ws.terminate();
    });
    ws.once("error", (error) => {
      if (!/Unexpected server response/.test(String(error))) reject(error);
    });
  });
}

const getWith = async (
  url: string,
  authorization?: string,
): Promise<{ status: number; reason: string | null }> => {
  const response = await fetch(url, authorization ? { headers: { authorization } } : {});
  await response.body?.cancel();
  return { status: response.status, reason: response.headers.get("x-rosetta-auth") };
};

async function auditRecords(daemon: FielddDaemon): Promise<AuditRecordV1[]> {
  const out: AuditRecordV1[] = [];
  for (const name of readdirSync(daemon.audit.root)
    .filter((n) => n.endsWith(".jsonl"))
    .sort()) {
    out.push(...(await verifyAuditSegment(join(daemon.audit.root, name))).records);
  }
  return out;
}

/** a capability refusal, whoever asks and by whatever road */
function expectRefusal(err: RpcErrorShape, state: string): void {
  expect(err.data?.kind).toBe("UNAVAILABLE");
  expect(err.data?.retryable).toBe(false);
  expect(IndexTicketUnavailableDetails.parse(err.data?.details)).toMatchObject({
    service: INDEX_TICKET.SERVICE,
    state,
  });
}

describe("AR-8b — index.openTicket mints for a window on this desktop", () => {
  it("a window holding index.read gets the loopback pair beside a grant for exactly that session, TTL ahead — and the mint is audited", async () => {
    const { daemon, keys } = await boot();
    await ready(daemon);
    const win = await windowOf(daemon, ["index.read"]);
    const before = Date.now();
    const ticket = await ticketFor(win, "s1");
    const origin = daemon.rosettad?.state().origin as string;
    expect(IndexEndpointSet.parse(ticket.endpoints)).toEqual({
      sessionUrl: `${origin.replace(/^http/, "ws")}/ws/sessions/s1`,
      restUrl: origin,
    });
    expect(ticket.device).toBe(daemon.devices.currentDeviceId());
    // the grant verifies under the key THIS generation was handed, and says
    // what the door promised: the session, this window, the expiry — and, the
    // desktop window being the one principal that holds it, read AND files
    // (RO-13); the control: not the read-only scope every other holder gets
    const verdict = verifyGrant(keys.at(-1) as Buffer, ticket.grant, Date.now());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.claims).toEqual({
      cid: "win:renderer:ixt:w1#renderer:ixt:w1:document-1",
      exp: ticket.expiresAt,
      scope: [SCOPE_READ, SCOPE_FILES],
      sid: "s1",
      v: 1,
    });
    expect(verdict.claims.scope).not.toEqual([SCOPE_READ]);
    expect(ticket.expiresAt).toBeGreaterThanOrEqual(before + INDEX_TICKET.TTL_MS);
    expect(ticket.expiresAt).toBeLessThanOrEqual(Date.now() + INDEX_TICKET.TTL_MS);
    // D6: a ticket is a grant, and its mint is an audited act — naming the
    // session and the expiry, never the grant
    const mints = (await auditRecords(daemon)).filter((r) => r.action === "index.ticket.mint");
    expect(mints.map((r) => r.phase)).toEqual(["attempt", "outcome"]);
    expect(mints[1]).toMatchObject({
      outcome: "succeeded",
      target: { kind: "index-session", id: "s1" },
      // RO-13: the record says what the grant may do
      attrs: { expiresAt: ticket.expiresAt, scope: [SCOPE_READ, SCOPE_FILES] },
    });
    expect(JSON.stringify(mints)).not.toContain(ticket.grant);
  }, 30_000);

  it("the grant opens the session's socket — on either carrier — and its header row, and NOTHING else: another session, the lists, search, /ws/meta", async () => {
    const { daemon } = await boot();
    await ready(daemon);
    const win = await windowOf(daemon, ["index.read"]);
    const ticket = await ticketFor(win, "s1");
    const { sessionUrl, restUrl } = IndexEndpointSet.parse(ticket.endpoints);
    // the session's own socket: a native client's header and a browser's pair
    for (const carrier of ["header", "subprotocol"] as const) {
      const dialed = await dialSession(sessionUrl, ticket.grant, carrier);
      expect(dialed, carrier).toMatchObject({ opened: true, frame: { frame: "hello" } });
    }
    expect(await getWith(`${restUrl}/api/sessions/s1`, `Rosetta-Grant ${ticket.grant}`)).toEqual({
      status: 200,
      reason: null,
    });
    // never another session — on the socket or the page
    expect(await dialSession(sessionUrl.replace(/s1$/, "s2"), ticket.grant)).toEqual({
      opened: false,
      status: 401,
      reason: "wrong-session",
    });
    expect(await getWith(`${restUrl}/api/sessions/s2`, `Rosetta-Grant ${ticket.grant}`)).toEqual({
      status: 401,
      reason: "wrong-session",
    });
    // never the lists, search, or the topology stream (AUTH.md §5.4)
    for (const path of ["/api/sessions", "/api/search?q=x", "/api/projects", "/api/status"]) {
      expect(await getWith(`${restUrl}${path}`, `Rosetta-Grant ${ticket.grant}`), path).toEqual({
        status: 401,
        reason: "wrong-route",
      });
    }
    expect(await dialSession(`${sessionUrl.split("/ws/")[0]}/ws/meta`, ticket.grant)).toEqual({
      opened: false,
      status: 401,
      reason: "wrong-route",
    });
    // and the origin alone — the old secret — opens nothing at all (EL7)
    expect(await dialSession(sessionUrl, null)).toEqual({
      opened: false,
      status: 401,
      reason: "missing",
    });
  }, 30_000);

  it("a plugin holding index.read is refused — a ticket opens a transcript; so is an ask without index.read", async () => {
    const { daemon, keys } = await boot();
    await ready(daemon);
    const plugin = await tokenOf(daemon, ["index.read"], "ixt-plugin");
    const refused = await plugin.callErr("index.openTicket", { sessionId: "s1" });
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(refused.data?.details).toMatchObject({ principal: "plugin" });
    // the scope gate comes first, for everyone
    const reader = await windowOf(daemon, ["doc.read"], "w2");
    const scope = await reader.callErr("index.openTicket", { sessionId: "s1" });
    expect(scope.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(scope.data?.details).toEqual({ required: "index.read" });
    // nothing was minted for either
    expect((await auditRecords(daemon)).some((r) => r.action === "index.ticket.mint")).toBe(false);
    // a malformed ask is the caller's to fix
    const win = await windowOf(daemon, ["index.read"], "w3");
    expect((await win.callErr("index.openTicket", {})).data?.kind).toBe("PRECONDITION_FAILED");
    // a plain local token is this desktop's own principal, and is served —
    // with `read` alone: it is not the desktop window (RO-13)
    const token = await tokenOf(daemon, ["index.read"]);
    const plain = IndexOpenTicket.parse(await token.call("index.openTicket", { sessionId: "s1" }));
    expect(plain.grant).toMatch(/\./);
    const verdict = verifyGrant(keys.at(-1) as Buffer, plain.grant, Date.now());
    expect(verdict.ok && verdict.claims.scope).toEqual([SCOPE_READ]);
  }, 30_000);

  it("every ask is a fresh grant: a second ticket for the same session is a new grant with a later exp", async () => {
    const { daemon, keys } = await boot();
    await ready(daemon);
    const win = await windowOf(daemon, ["index.read"]);
    const [a, b] = await Promise.all([ticketFor(win, "s1"), ticketFor(win, "s1")]);
    expect(a.grant).not.toBe(b.grant);
    expect(a.expiresAt).not.toBe(b.expiresAt);
    for (const ticket of [a, b])
      expect(verifyGrant(keys.at(-1) as Buffer, ticket.grant, Date.now()).ok).toBe(true);
  }, 30_000);

  it("expiry is honoured: a grant past its exp is refused at the upgrade, and asking again opens the session", async () => {
    const { daemon } = await boot({ indexTicketTtlMs: 300 });
    await ready(daemon);
    const win = await windowOf(daemon, ["index.read"]);
    const ticket = await ticketFor(win, "s1");
    const { sessionUrl } = IndexEndpointSet.parse(ticket.endpoints);
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, ticket.expiresAt - Date.now()) + 50),
    );
    expect(await dialSession(sessionUrl, ticket.grant)).toEqual({
      opened: false,
      status: 401,
      reason: "expired",
    });
    const renewed = await ticketFor(win, "s1");
    expect(await dialSession(sessionUrl, renewed.grant)).toMatchObject({ opened: true });
  }, 30_000);

  it("the kill matrix: a daemon restarted mid-ticket — the old grant opens nothing on the new generation, the next ask is re-ticketed", async () => {
    const { daemon, keys } = await boot();
    await ready(daemon);
    const win = await windowOf(daemon, ["index.read"]);
    const before = await ticketFor(win, "s1");
    expect(
      await dialSession(IndexEndpointSet.parse(before.endpoints).sessionUrl, before.grant),
    ).toMatchObject({ opened: true });
    const firstPid = daemon.health().rosettad.pid;
    await daemon.rosettad?.requestRestart();
    await until(
      () => daemon.health().rosettad.phase === "ready" && daemon.health().rosettad.pid !== firstPid,
      10_000,
    );
    expect(keys).toHaveLength(2);
    const after = await ticketFor(win, "s1");
    const now = IndexEndpointSet.parse(after.endpoints);
    expect(now.restUrl).not.toBe(IndexEndpointSet.parse(before.endpoints).restUrl);
    // the old grant, presented to the generation answering now: a new key
    expect(await dialSession(now.sessionUrl, before.grant)).toEqual({
      opened: false,
      status: 401,
      reason: "bad-signature",
    });
    expect(verifyGrant(keys[1] as Buffer, after.grant, Date.now()).ok).toBe(true);
    expect(await dialSession(now.sessionUrl, after.grant)).toMatchObject({ opened: true });
  }, 40_000);

  it("never names the bearer or the key — a ticket carries a grant minted with the key, nothing more", async () => {
    const { daemon, keys, bearers } = await boot();
    await ready(daemon);
    const win = await windowOf(daemon, ["index.read"]);
    const ticket = await ticketFor(win, "s1");
    const serialized = JSON.stringify(ticket);
    expect(serialized).not.toContain(bearers.at(-1) as string);
    expect(serialized).not.toContain((keys.at(-1) as Buffer).toString("base64url"));
    expect(serialized).not.toContain((keys.at(-1) as Buffer).toString("base64"));
    expect(Object.keys(ticket).sort()).toEqual(["device", "endpoints", "expiresAt", "grant"]);
  }, 30_000);
});

describe("RO-13 — the recorded-file read is the desktop window's alone", () => {
  it("the window's grant passes the file route's check (the scripted index records no file: rosetta's 404); a plain token's grant is wrong-scope there and still reads the session; another session's file is wrong-session; the audit names each mint's scopes", async () => {
    const { daemon } = await boot();
    await ready(daemon);
    const win = await windowOf(daemon, ["index.read"]);
    const ticket = await ticketFor(win, "s1");
    const { restUrl } = IndexEndpointSet.parse(ticket.endpoints);
    const file = (sid: string) => `${restUrl}/api/sessions/${sid}/timeline/t1/read/0`;
    // past the credential: the daemon's own answer for a target it never recorded
    expect(await getWith(file("s1"), `Rosetta-Grant ${ticket.grant}`)).toEqual({
      status: 404,
      reason: null,
    });
    expect(await getWith(file("s2"), `Rosetta-Grant ${ticket.grant}`)).toEqual({
      status: 401,
      reason: "wrong-session",
    });
    // a principal that is not the desktop window: read alone
    const token = await tokenOf(daemon, ["index.read"]);
    const plain = IndexOpenTicket.parse(await token.call("index.openTicket", { sessionId: "s1" }));
    expect(await getWith(file("s1"), `Rosetta-Grant ${plain.grant}`)).toEqual({
      status: 401,
      reason: "wrong-scope",
    });
    expect(await getWith(`${restUrl}/api/sessions/s1`, `Rosetta-Grant ${plain.grant}`)).toEqual({
      status: 200,
      reason: null,
    });
    // the record of each mint says what its grant may do, never the grant
    const outcomes = (await auditRecords(daemon)).filter(
      (r) => r.action === "index.ticket.mint" && r.phase === "outcome",
    );
    expect(outcomes.map((r) => (r.attrs as { scope?: unknown } | undefined)?.scope)).toEqual([
      [SCOPE_READ, SCOPE_FILES],
      [SCOPE_READ],
    ]);
    expect(JSON.stringify(outcomes)).not.toContain(plain.grant);
  }, 30_000);
});

describe("AR-8b — the honest refusals", () => {
  it("the plane switched off answers direct-plane-off, retryable false — and no serve is asked for", async () => {
    const { daemon, mock } = await boot({ indexDirectPlane: false });
    await ready(daemon);
    const win = await windowOf(daemon, ["index.read"]);
    expectRefusal(
      await win.callErr("index.openTicket", { sessionId: "s1" }),
      INDEX_TICKET.STATE_OFF,
    );
    expect(mock.meshServes.has(INDEX_SERVE_ID)).toBe(false);
  }, 30_000);

  it("no daemon ready answers the index's phase: unconfigured (not retryable), starting (retryable)", async () => {
    const none = await boot({ rosettad: false });
    const win = await windowOf(none.daemon, ["index.read"]);
    const unconfigured = await win.callErr("index.openTicket", { sessionId: "s1" });
    expect(unconfigured.data).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: false,
      details: { service: "index", state: "unconfigured" },
    });
    const silent = await boot({ mode: "silent" });
    const w2 = await windowOf(silent.daemon, ["index.read"], "w2");
    const starting = await w2.callErr("index.openTicket", { sessionId: "s1" });
    expect(starting.data).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "index", state: "starting" },
    });
  }, 30_000);

  it("the phone (a self tailnet principal) is told the plane is unbuilt for it; a guest is told nothing", async () => {
    const { daemon, mock } = await boot();
    await ready(daemon);
    const phone = await tailnetCaller(daemon, mock, TEST_LOGIN);
    expectRefusal(
      await phone.callErr("index.openTicket", { sessionId: "s1" }),
      INDEX_TICKET.STATE_UNBUILT,
    );
    const guest = await tailnetCaller(daemon, mock, "someone-else@example.com");
    const refused = await guest.callErr("index.openTicket", { sessionId: "s1" });
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
  }, 30_000);
});

// The minter alone — the rule without a daemon around it, on a clock that
// does not move, so "two asks in one millisecond" is a fact and not a race.
describe("AR-8b — IndexTicketMinter, the rule alone", () => {
  const key = Uint8Array.from({ length: 32 }, (_, i) => i);
  const live: RosettadState = {
    phase: "ready",
    origin: "http://127.0.0.1:52811",
    detail: null,
    pid: 1,
    protocolVersion: 26,
    announce: null,
    enrollRefusals: [],
    auth: { bearer: true, grants: true, origins: [] },
  };
  const supervisorOf = (state: RosettadState) => ({
    health: () => ({
      phase: state.phase,
      detail: state.detail,
      pid: state.pid,
      protocolVersion: state.protocolVersion,
    }),
    state: () => state,
    credentials: () => ({ authorization: "Bearer test", token: "test", grantKey: key }),
  });
  const minterOf = (state: RosettadState = live) =>
    new IndexTicketMinter({
      enabled: true,
      supervisor: supervisorOf(state),
      deviceId: () => "dev-a",
      now: () => 1_000_000,
    });
  const ctx = {
    principal: { kind: "local-token", tokenId: "tk_000000000001", scopes: ["index.read"] },
    transport: "ws-loopback",
    receivedAt: 0,
  } as CallerContext;

  it("two asks in one millisecond are two grants: exp only ever moves forward", () => {
    const minter = minterOf();
    const a = minter.mint(ctx, minter.check(ctx, { sessionId: "s1" }));
    const b = minter.mint(ctx, minter.check(ctx, { sessionId: "s1" }));
    expect(a.expiresAt).toBe(1_000_000 + INDEX_TICKET.TTL_MS);
    expect(b.expiresAt).toBe(a.expiresAt + 1);
    expect(a.grant).not.toBe(b.grant);
    for (const ticket of [a, b]) {
      const verdict = verifyGrant(key, ticket.grant, 1_000_000);
      expect(verdict.ok && verdict.claims.cid).toBe("local-token:tk_000000000001");
    }
  });

  it("a session id that is not text, or too long for a grant, is the caller's to fix; an unsafe one is audited by its digest", () => {
    const minter = minterOf();
    expect(() => minter.check(ctx, { sessionId: "\ud800" })).toThrow(/not Unicode text/);
    expect(() => minter.mint(ctx, minter.check(ctx, { sessionId: "x".repeat(4_000) }))).toThrow(
      /too long/,
    );
    expect(minter.check(ctx, { sessionId: "s1" }).auditId).toBe("s1");
    expect(minter.check(ctx, { sessionId: "s\u0001" }).auditId).toMatch(/^sha256:[0-9a-f]{32}$/);
    expect(minter.check(ctx, { sessionId: "s".repeat(300) }).auditId).toMatch(/^sha256:/);
  });

  it("RO-13: the desktop window's grant carries read and files, every other holder's read alone — the rule outlives today's refusals", () => {
    const window = {
      principal: {
        kind: "local-token",
        tokenId: "tk_000000000002",
        scopes: ["index.read"],
        rendererParticipant: {
          participantId: "renderer:unit:1",
          incarnation: "renderer:unit:1:document-1",
        },
      },
      transport: "ws-loopback",
      receivedAt: 0,
      clientKind: "renderer",
    } as CallerContext;
    expect(indexTicketScopes(window)).toEqual([SCOPE_READ, SCOPE_FILES]);
    const readOnly: Array<[string, CallerContext]> = [
      // the window's own bearer, over another door or claiming another kind
      ["the window's bearer on the tailnet door", { ...window, transport: "ws-tailnet" }],
      ["the window's bearer with another client kind", { ...window, clientKind: "debug" }],
      ["the window's bearer with no client kind", { ...window, clientKind: undefined } as never],
      ["a plain local token", ctx],
      [
        "the shell",
        {
          principal: { kind: "shell-main", tokenId: "tk_000000000003", scopes: ["index.read"] },
          transport: "ws-loopback",
          receivedAt: 0,
          clientKind: "shell-main",
        },
      ],
      // refused a ticket today — the rule still says read alone
      [
        "a plugin",
        {
          principal: { kind: "plugin", id: "p", scopes: ["index.read"] },
          transport: "inproc-port",
          receivedAt: 0,
        },
      ],
      [
        "an MCP agent",
        {
          principal: { kind: "mcp-agent", sessionId: "m", scopes: ["index.read"] },
          transport: "mcp",
          receivedAt: 0,
        },
      ],
      [
        "the phone",
        {
          principal: { kind: "tailnet", login: "me@example.com", self: true },
          transport: "ws-tailnet",
          receivedAt: 0,
          clientKind: "ios",
        },
      ],
      [
        "a guest",
        {
          principal: { kind: "tailnet-guest", login: "them@example.com" },
          transport: "ws-tailnet",
          receivedAt: 0,
        },
      ],
      [
        "another desktop's daemon",
        {
          principal: { kind: "peer-fieldd", deviceId: "dev-b" },
          transport: "ws-tailnet",
          receivedAt: 0,
        },
      ],
    ];
    for (const [who, caller] of readOnly)
      expect(indexTicketScopes(caller), who).toEqual([SCOPE_READ]);
    // the mint carries what the rule said, and the ask carries it to the audit
    const minter = minterOf();
    const ask = minter.check(window, { sessionId: "s1" });
    expect(ask.scope).toEqual([SCOPE_READ, SCOPE_FILES]);
    const windowGrant = verifyGrant(key, minter.mint(window, ask).grant, 1_000_000);
    expect(windowGrant.ok && windowGrant.claims.scope).toEqual([SCOPE_READ, SCOPE_FILES]);
    const plainGrant = verifyGrant(
      key,
      minter.mint(ctx, minter.check(ctx, { sessionId: "s1" })).grant,
      1_000_000,
    );
    expect(plainGrant.ok && plainGrant.claims.scope).toEqual([SCOPE_READ]);
  });

  it("a generation that does not enforce access is the plane OFF — never a grant it would not check", () => {
    const minter = minterOf({ ...live, auth: { bearer: true, grants: false, origins: [] } });
    let refusal: unknown;
    try {
      minter.check(ctx, { sessionId: "s1" });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: false,
      details: { service: "index", state: INDEX_TICKET.STATE_OFF },
    });
  });
});

// ---------------------------------------------------------------------------
// A peer daemon's forward of it: two real daemons (the DS-4 e2e harness).

/** The sidecar half of A's dial: a tailnet coordinate for B lands on B's
 * loopback door with the route secret joined, and the WhoIs login plus A's
 * node id are injected — B's roster correlates that node to A's desktop slice,
 * which is what makes the caller a `peer-fieldd` principal (D1). */
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

describe("SP-3 — index.openTicket through a peer daemon's forward", () => {
  it("A's window asks for a session on B: A forwards it keyed, B answers from its own door — the remote half is DS-7's", async () => {
    const dirB = makeDataDir();
    const mockB = await startMock(dirB);
    mockB.meshDeviceId = "dev-b";
    mockB.meshPeers = [
      registryPeer({ nodeId: "node-a", deviceId: "dev-a", name: "device-a", login: TEST_LOGIN }),
    ];
    mockB.storeSlices = new Map<string, unknown>([["dev-a", desktopSlice("dev-a", "device-a")]]);
    const B = await bootstrap({ dataDir: dirB, controlPort: 0, dataPort: 0 });
    cleanup.push(() => B.stop());
    await until(() => mockB.meshServes.get("product") !== undefined, 15_000);
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
    ];
    const A = await bootstrap({
      dataDir: dirA,
      controlPort: 0,
      dataPort: 0,
      peerWebSocket: sidecar(() => bEndpoint),
    });
    cleanup.push(() => A.stop());
    await until(() => A.devices.get("dev-b") !== undefined, 8_000);
    await until(() => B.devices.isDocHost("dev-a"), 8_000);

    const win = await windowOf(A, ["index.read"]);
    const err = await win.callErr("index.openTicket", { device: "dev-b", sessionId: "s1" });
    // B's own answer, untouched by the hop: a forward that never reached B
    // reads `peer-link`/`mesh` states, never the index's
    expectRefusal(err, INDEX_TICKET.STATE_UNBUILT);
    expect(err.message).toMatch(/another desktop/);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The REAL rosettad (`pnpm siblings:build`; FIELDD_ROSETTAD_BIN), over rosetta's
// own ground-truth transcript seeded into an empty home (nothing of the
// developer's is ever read), read from the checkout dedicated to the pin
// (`../rosetta-pin`, W-D10) — and dialled with rosetta's OWN TypeScript client
// holding the grant as its `credential`, the way the History room will.

const REAL_BIN = process.env["FIELDD_ROSETTAD_BIN"];
const GROUNDTRUTH = join(
  HERE,
  "..",
  "..",
  "..",
  "..",
  "rosetta-pin",
  "groundtruth",
  "claude-code",
  "fixtures",
  "2.1.241",
  "basic-chat",
  "claude-config",
);
/** the one session that transcript records */
const FIXTURE_NATIVE_ID = "665e3e71-7c12-4810-925a-e8b92cb6f29d";

async function untilAsync(fn: () => Promise<boolean>, ms: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await fn().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`untilAsync: condition not met within ${ms}ms`);
}

/** A real daemon behind fieldd, the ground truth indexed, and its session id. */
async function realWorld(): Promise<{ daemon: FielddDaemon; win: WsRpc; sid: string }> {
  const dataDir = makeDataDir();
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  cpSync(GROUNDTRUTH, join(home, ".claude"), { recursive: true });
  await startMock(dataDir);
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    allowedOrigins: ["file://", "vibefield-app://shell"],
    rosettadBin: REAL_BIN as string,
    rosettadHome: home,
  });
  cleanup.push(() => daemon.stop());
  await until(() => daemon.health().rosettad.phase === "ready", 30_000);
  const win = await windowOf(daemon, ["index.read", "index.search", "index.manage"], "real");
  await untilAsync(async () => (await daemon.index.status()).phase === "awaiting_consent", 30_000);
  await win.call("index.enroll", { kinds: ["claude-code"] });
  let sid = "";
  await untilAsync(async () => {
    const found = (await win.call("index.sessions", {
      nativeSessionIds: [FIXTURE_NATIVE_ID],
    })) as IndexSessionsResult;
    sid = found.rows[0]?.sessionId ?? "";
    return sid !== "";
  }, 90_000);
  return { daemon, win, sid };
}

/** rosetta's own client over a ticket: the origin, and the grant as the credential. */
function clientFor(ticket: IndexOpenTicket): RosettaClient {
  return new RosettaClient({
    baseUrl: IndexEndpointSet.parse(ticket.endpoints).restUrl,
    credential: { kind: "grant", grant: ticket.grant },
    WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
    fetchFn: fetch.bind(globalThis),
  });
}

/** Subscribe to one session with rosetta's client; resolves on the first
 * snapshot (the state machine's own), rejects on an error. */
function firstSnapshot(client: RosettaClient, sid: string): Promise<{ close: () => void }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const handlers: SessionSubscriptionHandlers = {
      onSnapshot: () => {
        if (settled) return;
        settled = true;
        resolve({ close: () => subscription.close() });
      },
      onError: (error) => {
        if (settled) return;
        settled = true;
        subscription.close();
        reject(new Error(`${error.code}: ${error.message}`));
      },
    };
    const subscription = client.subscribeSession(sid, handlers);
    cleanup.push(() => subscription.close());
  });
}

/** The id of the first row a session's stream delivers, through rosetta's
 * client — a real timeline id of the ground truth. */
function firstTimelineId(client: RosettaClient, sid: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const subscription = client.subscribeSession(sid, {
      onChange: (rows) => {
        const id = rows[0]?.timeline_id;
        if (settled || id === undefined) return;
        settled = true;
        subscription.close();
        resolve(id);
      },
      onError: (error) => {
        if (settled) return;
        settled = true;
        subscription.close();
        reject(new Error(`${error.code}: ${error.message}`));
      },
    });
    cleanup.push(() => subscription.close());
  });
}

describe.skipIf(
  REAL_BIN === undefined || REAL_BIN === "" || !existsSync(REAL_BIN) || !existsSync(GROUNDTRUTH),
)("AR-8b — the direct plane against the REAL rosettad (opt-in via FIELDD_ROSETTAD_BIN)", () => {
  it("the daemon runs behind the three flags; fieldd's reads carry the bearer; the origin alone opens nothing", async () => {
    const { daemon, win, sid } = await realWorld();
    const state = daemon.rosettad?.state();
    expect(state?.auth).toEqual({ bearer: true, grants: true, origins: ["vibefield-app://shell"] });
    // fieldd's own reads went through with its bearer (the session list above,
    // the header door here)
    expect(
      ((await win.call("index.session", { sessionId: sid })) as { session: { sessionId: string } })
        .session.sessionId,
    ).toBe(sid);
    expect(await getWith(`${state?.origin}/api/status`)).toEqual({
      status: 401,
      reason: "missing",
    });
  }, 180_000);

  it("a minted grant opens /ws/sessions/{sid} through rosetta's client, and is refused on another sid, on /api/sessions and on /ws/meta", async () => {
    const { win, sid } = await realWorld();
    const ticket = await ticketFor(win, sid);
    const { restUrl, sessionUrl } = IndexEndpointSet.parse(ticket.endpoints);
    // rosetta's own client, holding the grant: the header row and the live stream
    const client = clientFor(ticket);
    const header = await client.session(sid);
    expect(header.session.id).toBe(sid);
    const stream = await firstSnapshot(client, sid);
    stream.close();
    // never another session, never a list, never the topology stream
    await expect(client.session("not-this-session")).rejects.toBeInstanceOf(UnauthorizedError);
    expect(
      await getWith(`${restUrl}/api/sessions/not-this-session`, `Rosetta-Grant ${ticket.grant}`),
    ).toEqual({ status: 401, reason: "wrong-session" });
    expect(await getWith(`${restUrl}/api/sessions`, `Rosetta-Grant ${ticket.grant}`)).toEqual({
      status: 401,
      reason: "wrong-route",
    });
    expect(
      await dialSession(sessionUrl.replace(/\/ws\/sessions\/.*$/, "/ws/meta"), ticket.grant),
    ).toEqual({ opened: false, status: 401, reason: "wrong-route" });
    expect(
      await dialSession(sessionUrl.replace(/[^/]+$/, "not-this-session"), ticket.grant),
    ).toEqual({ opened: false, status: 401, reason: "wrong-session" });
  }, 180_000);

  it("RO-13: the window's grant reaches the recorded-file read — rosetta's own not_found for a row that names no file, never wrong-scope — and a plain token's grant is wrong-scope there", async () => {
    const { daemon, win, sid } = await realWorld();
    const ticket = await ticketFor(win, sid);
    const { restUrl } = IndexEndpointSet.parse(ticket.endpoints);
    const client = clientFor(ticket);
    const timelineId = await firstTimelineId(client, sid);
    // the window's grant, through rosetta's own client as the room asks it: past
    // the credential check, the daemon's honest answer — the ground truth's
    // first row is a prompt, which names no file
    const windowRead = await client.readFileTarget(sid, timelineId, 0).then(
      () => null,
      (error: unknown) => error,
    );
    expect(windowRead).not.toBeInstanceOf(UnauthorizedError);
    expect(windowRead).toMatchObject({ status: 404, code: "not_found" });
    // a principal that is not the desktop window holds read alone: refused there…
    const token = await tokenOf(daemon, ["index.read"]);
    const plain = IndexOpenTicket.parse(await token.call("index.openTicket", { sessionId: sid }));
    const session = `${restUrl}/api/sessions/${encodeURIComponent(sid)}`;
    const plainRead = await getWith(
      `${session}/timeline/${encodeURIComponent(timelineId)}/read/0`,
      `Rosetta-Grant ${plain.grant}`,
    );
    expect(plainRead).toEqual({ status: 401, reason: "wrong-scope" });
    // …and still reading the session's history
    expect(await getWith(session, `Rosetta-Grant ${plain.grant}`)).toEqual({
      status: 200,
      reason: null,
    });
    const answered = windowRead as { status: number; code: string | null; message: string };
    console.log(
      `RO13_REAL ${JSON.stringify({
        timelineId,
        window: { status: answered.status, code: answered.code, message: answered.message },
        plain: plainRead,
      })}`,
    );
  }, 180_000);

  it("the kill matrix: the daemon restarted mid-stream — the old grant is refused by the new generation, the next ask is re-ticketed and streams", async () => {
    const { daemon, win, sid } = await realWorld();
    const before = await ticketFor(win, sid);
    const live = await firstSnapshot(clientFor(before), sid);
    const firstPid = daemon.health().rosettad.pid;
    await win.call("system.index.restart", {}).catch(() => undefined);
    if (daemon.health().rosettad.pid === firstPid) await daemon.rosettad?.requestRestart();
    await until(
      () => daemon.health().rosettad.phase === "ready" && daemon.health().rosettad.pid !== firstPid,
      60_000,
    );
    live.close();
    const after = await ticketFor(win, sid);
    const now = IndexEndpointSet.parse(after.endpoints);
    // the old grant at the generation answering now: another key
    expect(
      await getWith(
        `${now.restUrl}/api/sessions/${encodeURIComponent(sid)}`,
        `Rosetta-Grant ${before.grant}`,
      ),
    ).toEqual({ status: 401, reason: "bad-signature" });
    // re-ticketed: the stream opens again
    const again = await firstSnapshot(clientFor(after), sid);
    again.close();
  }, 240_000);
});
