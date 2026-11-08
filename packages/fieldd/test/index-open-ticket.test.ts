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
// SP-7b (2026-11-06; `SP-7b-plan.md` 7b-1): this person's phone holds a ticket
// too, by both roads — at its home directly (a self tailnet principal), and
// through its home to another desktop (a self peer daemon's forward naming the
// phone behind it). Either way its set is the owner's index serve on the
// tailnet, which the phone's node dials itself; no answer says
// `direct-plane-unbuilt` any more.
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
import { verifyAuditSegment } from "@vibefield/audit";
import {
  type CallerContext,
  CONTRACTS_VERSION,
  INDEX_TICKET,
  IndexEndpointSet,
  IndexOpenTicket,
  type IndexSessionsResult,
  IndexTicketRoadDetails,
  IndexTicketUnavailableDetails,
  PORTS,
  RemoteIndexEndpointSet,
  type Scope,
  SOCKETS,
} from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import type { WsCtor } from "@vibefield/fieldd-client";
import {
  RosettaClient,
  type SessionSubscriptionHandlers,
  UnauthorizedError,
} from "@vibefield/rosetta-protocol";
import { SCOPE_FILES, SCOPE_READ, verifyGrant } from "@vibefield/rosetta-protocol/grants";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { FakeEgressRoutes } from "../src/egress";
import { bootstrap, type FielddConfig, type FielddDaemon } from "../src/index";
import {
  INDEX_SERVE_ID,
  type IndexTicketAsk,
  IndexTicketMinter,
  indexEndpointsFrom,
  indexServeSpec,
  indexTargetPort,
  indexTicketScopes,
} from "../src/index-serve";
import type { ServeSpec, ServeState } from "../src/mesh-client";
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
    /** DS-7 — the scripted rosettad's timeline rows (FAKE_ROSETTAD_TIMELINE) */
    timeline?: unknown[];
    /** DS-7 — the floor's mesh as this desktop sees it, set before the boot */
    mesh?: (mock: MockMgmtServer) => void;
    /** DS-7 — the rest of the daemon's config (its peer dial, its routes) */
    config?: Partial<FielddConfig>;
  } = {},
): Promise<World> {
  const dataDir = makeDataDir();
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  const sessionsFile = join(dataDir, "sessions.json");
  writeFileSync(sessionsFile, JSON.stringify(SESSIONS));
  const timelineFile = join(dataDir, "timeline.json");
  writeFileSync(timelineFile, JSON.stringify(opts.timeline ?? []));
  const mock = await startMock(dataDir);
  opts.mesh?.(mock);
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
        FAKE_ROSETTAD_TIMELINE: timelineFile,
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
    ...opts.config,
  });
  cleanup.push(() => daemon.stop());
  return { daemon, mock, dataDir, keys, bearers };
}

/** Each test client's socket, so a row can read what a door carried (DS-7). */
const socketOf = new WeakMap<WsRpc, WebSocket>();

async function open(url: string, headers?: Record<string, string>): Promise<WsRpc> {
  const ws = new WebSocket(url, headers ? { headers } : {});
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  socketOf.set(rpc, ws);
  return rpc;
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

/** SP-7b — the phone's ask as an OUTCOME: a refusal fails the row on its first
 * assertion, with the refusal's own words, rather than throwing past it. */
async function phoneTicket(
  phone: WsRpc,
  ask: { sessionId: string; device?: string },
): Promise<IndexOpenTicket | undefined> {
  let answer: unknown;
  try {
    answer = await phone.call("index.openTicket", ask);
  } catch (error) {
    answer = error instanceof Error ? error.message : error;
  }
  const parsed = IndexOpenTicket.safeParse(answer);
  expect(parsed.success ? "a ticket" : answer).toBe("a ticket");
  return parsed.success ? parsed.data : undefined;
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

  it("SP-7b: the phone at its home (a self tailnet principal) is minted the tailnet set of the live serve beside a read grant that opens its session; a guest is told nothing", async () => {
    const { daemon, mock, keys } = await boot();
    await ready(daemon);
    const origin = (): string | null => daemon.rosettad?.state().origin ?? null;
    await until(
      () => indexEndpointsFrom(daemon.mesh.serves(), origin(), "s1") !== undefined,
      15_000,
    );
    const phone = await tailnetCaller(daemon, mock, TEST_LOGIN);
    const ticket = await phoneTicket(phone, { sessionId: "s1" });
    if (ticket === undefined) return;
    // the set the phone's node dials: the serve's, never the loopback pair
    expect(ticket.endpoints).toEqual(indexEndpointsFrom(daemon.mesh.serves(), origin(), "s1"));
    expect(new URL(RemoteIndexEndpointSet.parse(ticket.endpoints).sessionUrl).port).toBe(
      String(PORTS.INDEX_SERVE),
    );
    // SP-7b's 7b-2a: and the same serve's origin, which the phone's RosettaClient reads the
    // session's pages at
    const set = RemoteIndexEndpointSet.parse(ticket.endpoints);
    const socket = new URL(set.sessionUrl);
    const restOrigin = `${socket.protocol === "wss:" ? "https:" : "http:"}//${socket.host}`;
    expect(set["restUrl"]).toBe(restOrigin);
    expect(IndexEndpointSet.safeParse(ticket.endpoints).success).toBe(false);
    // a read grant for exactly that session, keyed by the phone's own login
    const verdict = verifyGrant(keys.at(-1) as Buffer, ticket.grant, Date.now());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.claims).toMatchObject({ sid: "s1", scope: [SCOPE_READ] });
    expect(verdict.claims.cid).toMatch(/^tailnet:/);
    // the serve carries rosettad's whole listener: the grant opens the session there
    const listener = `${(origin() as string).replace(/^http/, "ws")}/ws/sessions/s1`;
    expect(await dialSession(listener, ticket.grant)).toMatchObject({
      opened: true,
      frame: { frame: "hello" },
    });
    const mints = (await auditRecords(daemon)).filter((r) => r.action === "index.ticket.mint");
    expect(mints.find((r) => r.phase === "outcome")).toMatchObject({
      outcome: "succeeded",
      target: { kind: "index-session", id: "s1" },
      attrs: { scope: [SCOPE_READ] },
    });
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
  const minterOf = (state: RosettadState = live, serves: readonly ServeState[] = []) =>
    new IndexTicketMinter({
      enabled: true,
      supervisor: supervisorOf(state),
      deviceId: () => "dev-a",
      serves: () => serves,
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
      // refused a ticket (the phone holds one since SP-7b) — the rule still says read alone
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

  // DS-7 — another desktop's daemon, forwarding for its window
  const peer = (windowId?: string) =>
    ({
      principal: { kind: "peer-fieldd", deviceId: "dev-b", scopes: ["index.read"] },
      transport: "ws-tailnet",
      receivedAt: 0,
      ...(windowId !== undefined
        ? { onBehalfOf: { clientKind: "renderer", deviceId: "dev-b", windowId } }
        : {}),
    }) as CallerContext;
  const serveOf = (over: Partial<ServeState> = {}): ServeState => ({
    ...(indexServeSpec({
      enabled: true,
      origin: live.origin,
      linkedLogin: TEST_LOGIN,
    }) as ServeSpec),
    status: "active",
    url: "http://desk-a.tail1234.ts.net:9424",
    ...over,
  });

  it("DS-7: another desktop's daemon is minted the tailnet set of the live serve, a read grant keyed by the window behind it", () => {
    const minter = minterOf(live, [serveOf()]);
    const forward = peer("renderer:b:1");
    const ask = minter.check(forward, { sessionId: "s1" });
    expect(ask.scope).toEqual([SCOPE_READ]);
    const ticket = minter.mint(forward, ask);
    expect(RemoteIndexEndpointSet.parse(ticket.endpoints)).toEqual({
      sessionUrl: "ws://desk-a.tail1234.ts.net:9424/ws/sessions/s1",
      restUrl: "http://desk-a.tail1234.ts.net:9424",
    });
    expect(IndexEndpointSet.safeParse(ticket.endpoints).success).toBe(false);
    expect(ticket.device).toBe("dev-a");
    const verdict = verifyGrant(key, ticket.grant, 1_000_000);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.claims).toMatchObject({ sid: "s1", scope: [SCOPE_READ] });
    // DS-4c's key: the forward is the window behind it, not the bare daemon
    expect(verdict.claims.cid).toMatch(/^peer-fieldd:dev-b#/);
    expect(verdict.claims.cid).toContain("renderer%3Ab%3A1");
    const bare = verifyGrant(
      key,
      minter.mint(peer(), minter.check(peer(), { sessionId: "s1" })).grant,
      1_000_000,
    );
    expect(bare.ok && bare.claims.cid).toBe("peer-fieldd:dev-b");
  });

  it("DS-7: with no live serve the forward is told doors_not_published, retryable, naming this desktop — never a set nothing answers", () => {
    for (const [why, serves] of [
      ["no index serve at all", []],
      ["the node has not taken it yet", [serveOf({ status: "pending" })]],
      ["aimed at a rosettad that restarted", [serveOf({ target: { kind: "port", port: 1 } })]],
    ] as const) {
      const minter = minterOf(live, serves);
      const ask = minter.check(peer("w"), { sessionId: "s1" });
      let refusal: unknown;
      try {
        minter.mint(peer("w"), ask);
      } catch (error) {
        refusal = error;
      }
      expect(refusal, why).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
      expect(IndexTicketRoadDetails.parse((refusal as { details: unknown }).details), why).toEqual({
        service: "index",
        state: INDEX_TICKET.STATE_DOORS_NOT_PUBLISHED,
        device: "dev-a",
      });
    }
    // a window here still dials the loopback pair, serve or none
    const local = minterOf(live, []);
    expect(
      IndexEndpointSet.parse(local.mint(ctx, local.check(ctx, { sessionId: "s1" })).endpoints),
    ).toMatchObject({ restUrl: live.origin });
  });

  // SP-7b — this person's phone, asking its home directly
  const phoneOf = (self = true) =>
    ({
      principal: { kind: "tailnet", login: TEST_LOGIN, self, tailscaleId: "node-p" },
      transport: "ws-tailnet",
      receivedAt: 0,
      clientKind: "ios",
    }) as CallerContext;

  it("SP-7b: the phone at its home is minted the tailnet set of the live serve and a read grant keyed by its login and node; with no live serve it is told doors_not_published", () => {
    const minter = minterOf(live, [serveOf()]);
    let asked: unknown;
    try {
      asked = minter.check(phoneOf(), { sessionId: "s1" });
    } catch (error) {
      asked = error;
    }
    expect(asked).toMatchObject({ sessionId: "s1", scope: [SCOPE_READ] });
    const ticket = minter.mint(phoneOf(), asked as IndexTicketAsk);
    expect(RemoteIndexEndpointSet.parse(ticket.endpoints)).toEqual({
      sessionUrl: "ws://desk-a.tail1234.ts.net:9424/ws/sessions/s1",
      restUrl: "http://desk-a.tail1234.ts.net:9424",
    });
    expect(IndexEndpointSet.safeParse(ticket.endpoints).success).toBe(false);
    expect(ticket.device).toBe("dev-a");
    const verdict = verifyGrant(key, ticket.grant, 1_000_000);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.claims).toMatchObject({ sid: "s1", scope: [SCOPE_READ] });
    expect(verdict.claims.cid).toBe(`tailnet:${TEST_LOGIN}#node-p`);
    let refusal: unknown;
    try {
      const none = minterOf(live, []);
      none.mint(phoneOf(), none.check(phoneOf(), { sessionId: "s1" }));
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(IndexTicketRoadDetails.parse((refusal as { details: unknown }).details)).toEqual({
      service: "index",
      state: INDEX_TICKET.STATE_DOORS_NOT_PUBLISHED,
      device: "dev-a",
    });
  });

  it("SP-7b: a tailnet caller who is not this person is refused FORBIDDEN_SCOPE, and no answer names the unbuilt plane", () => {
    let refusal: unknown;
    try {
      minterOf(live, [serveOf()]).check(phoneOf(false), { sessionId: "s1" });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ kind: "FORBIDDEN_SCOPE", retryable: false });
    expect(JSON.stringify(refusal)).not.toContain(INDEX_TICKET.STATE_UNBUILT);
  });
});

// ---------------------------------------------------------------------------
// DS-7 — another desktop's transcript by ticket: two real daemons (the DS-4 e2e
// harness), named as the design names them (`thinking-desktop-sync-plane.md`
// §11: "a transcript on A streams into B's History"). A is the OWNER — its
// scripted rosettad holds the session and its index serve is on the (mock)
// tailnet; B is the WINDOW's desktop — its window asks `{device: A}`, B
// forwards, A mints for B's daemon, and B re-homes A's set onto an egress
// route of its own. The route is the routes port's test double, bound to A's
// rosettad listener: what B's sidecar → A's serve → A's rosettad carries in
// production, the double carries here, byte for byte.

/** The sidecar half of B's dial: a tailnet coordinate for A lands on A's
 * loopback door with the route secret joined, and the WhoIs login plus B's
 * node id are injected — A's roster correlates that node to B's desktop slice,
 * which is what makes the caller a `peer-fieldd` principal (D1). Every socket
 * it opens is kept, so a row can read the peer link's bytes. */
function sidecar(loopback: () => string, opened: WebSocket[]): WsCtor {
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      const target = url.includes("device-a.tailnet.ts.net") ? loopback() : "ws://127.0.0.1:1/";
      super(url.includes(".ts.net") ? target : url, {
        headers: { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": "node-b" },
      });
      opened.push(this);
    }
  }
  return SidecarSim;
}

/** Bytes a client socket has moved both ways, framing included. */
function bytesOf(ws: WebSocket): number {
  const raw = (ws as unknown as { _socket?: { bytesRead: number; bytesWritten: number } })._socket;
  return raw === undefined ? 0 : raw.bytesRead + raw.bytesWritten;
}

/** One agent reply of `size` characters, in rosetta's `TimelineEntry` shape. */
function replyRow(sessionId: string, ordinal: number, size: number): Record<string, unknown> {
  return {
    timeline_id: `${sessionId}-t${ordinal}`,
    session_id: sessionId,
    ordinal,
    group: { id: `turn-${ordinal}`, kind: "agent_cycle", derivation: "native" },
    response: { id: `response-${ordinal}`, derivation: "native" },
    block_index: null,
    native_id: null,
    parent_native_id: null,
    at: 3_600_000 + ordinal * 1_000,
    model: "claude-opus-5",
    effort: null,
    body: {
      type: "agent",
      text: { type: "inline", text: `reply ${ordinal} `.padEnd(size, "·") },
      attachments: [],
      citations: [],
    },
    parent_tool_native_id: null,
    usage: {
      input: null,
      output: null,
      cache_read: null,
      cache_write: null,
      thinking: null,
      cache_write_1h: null,
      web_searches: null,
      service_tier: null,
      route: null,
      billed_pico_usd: null,
      scope: "request",
      requests: null,
    },
    provenance: { agent_version: "2.1.241", src_cursor: 1, src_offset: ordinal },
  };
}

interface Pair {
  /** the owner: its rosettad holds `s1` */
  A: World;
  /** the window's desktop */
  B: World;
  /** B's egress routes (the port's double) */
  routes: FakeEgressRoutes;
  /** the loopback listener B's route to A's index serve answers at */
  listen: string;
  /** every socket B's daemon dialled towards A */
  peerSockets: WebSocket[];
}

async function pair(opts: { timeline?: unknown[] } = {}): Promise<Pair> {
  const A = await boot({
    ...(opts.timeline !== undefined ? { timeline: opts.timeline } : {}),
    mesh: (mock) => {
      mock.meshDeviceId = "dev-a";
      mock.meshPeers = [
        registryPeer({ nodeId: "node-b", deviceId: "dev-b", name: "device-b", login: TEST_LOGIN }),
      ];
      mock.storeSlices = new Map<string, unknown>([["dev-b", desktopSlice("dev-b", "device-b")]]);
    },
  });
  await ready(A.daemon);
  await until(() => A.mock.meshServes.get("product") !== undefined, 15_000);
  // A's index serve is live on the tailnet, aimed at the rosettad answering now
  await until(
    () =>
      indexEndpointsFrom(
        A.daemon.mesh.serves(),
        A.daemon.rosettad?.state().origin ?? null,
        "s1",
      ) !== undefined,
    15_000,
  );
  const aEndpoint = `ws://127.0.0.1:${A.daemon.controlPort}/t/${productPathSecret(A.mock)}`;
  const listen = `127.0.0.1:${indexTargetPort(A.daemon.rosettad?.state().origin ?? null)}`;
  const routes = new FakeEgressRoutes();
  routes.route("dev-a", PORTS.INDEX_SERVE, listen);
  const peerSockets: WebSocket[] = [];
  const B = await boot({
    rosettad: false,
    mesh: (mock) => {
      mock.meshDeviceId = "dev-b";
      mock.meshPeers = [
        {
          id: "node-a",
          deviceId: "dev-a",
          name: "device-a",
          online: true,
          whois: { login: TEST_LOGIN, deviceName: "device-a.tailnet.ts.net" },
        },
      ];
    },
    config: {
      peerWebSocket: sidecar(() => aEndpoint, peerSockets),
      indexEgressRoutes: routes,
    },
  });
  await until(() => B.daemon.devices.get("dev-a") !== undefined, 8_000);
  await until(() => A.daemon.devices.isDocHost("dev-b"), 8_000);
  return { A, B, routes, listen, peerSockets };
}

/** Wait until `read()` has not moved for `quietMs`. */
async function settled(read: () => number, quietMs = 400, ms = 10_000): Promise<number> {
  const started = Date.now();
  let last = read();
  let since = Date.now();
  while (Date.now() - started < ms) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const now = read();
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) return now;
  }
  throw new Error("settled: the reading never stood still");
}

describe("DS-7 — a transcript on A, by ticket, into a window on B", () => {
  it("B's window asks for A's session: A mints for B's daemon from its own rule, B re-homes A's set onto its route to A's index serve — and the grant opens that session through the route, nothing else", async () => {
    const { A, B, routes, listen } = await pair();
    const win = await windowOf(B.daemon, ["index.read"]);
    const ticket = IndexOpenTicket.parse(
      await win.call("index.openTicket", { device: "dev-a", sessionId: "s1" }),
    );
    // the window's set: loopback, at B's route, composed for the asked session
    expect(ticket.device).toBe("dev-a");
    expect(IndexEndpointSet.parse(ticket.endpoints)).toEqual({
      sessionUrl: `ws://${listen}/ws/sessions/s1`,
      restUrl: `http://${listen}`,
    });
    // A's grant, from A's key, read-only, keyed by the window behind B's forward
    const verdict = verifyGrant(A.keys.at(-1) as Buffer, ticket.grant, Date.now());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.claims).toMatchObject({ sid: "s1", scope: [SCOPE_READ] });
    expect(verdict.claims.cid).toBe("peer-fieldd:dev-b#renderer%3Aixt%3Aw1");
    // through the route: the session's socket, on the browser's carrier
    const { sessionUrl, restUrl } = IndexEndpointSet.parse(ticket.endpoints);
    expect(await dialSession(sessionUrl, ticket.grant, "subprotocol")).toMatchObject({
      opened: true,
      frame: { frame: "hello" },
    });
    // and nothing else: another session, a list, the topology stream, a file
    expect(await dialSession(sessionUrl.replace(/s1$/, "s2"), ticket.grant)).toEqual({
      opened: false,
      status: 401,
      reason: "wrong-session",
    });
    expect(await getWith(`${restUrl}/api/sessions`, `Rosetta-Grant ${ticket.grant}`)).toEqual({
      status: 401,
      reason: "wrong-route",
    });
    expect(
      await getWith(
        `${restUrl}/api/sessions/s1/timeline/t1/read/0`,
        `Rosetta-Grant ${ticket.grant}`,
      ),
    ).toEqual({ status: 401, reason: "wrong-scope" });
    // ONE route reference per owner, however many tickets ride it
    await win.call("index.openTicket", { device: "dev-a", sessionId: "s2" });
    expect(routes.refs("dev-a", PORTS.INDEX_SERVE)).toBe(1);
    // A audited the mint, naming the session and what the grant may do; B
    // minted nothing of its own
    const mints = (await auditRecords(A.daemon)).filter((r) => r.action === "index.ticket.mint");
    expect(mints.filter((r) => r.phase === "outcome")).toHaveLength(2);
    expect(mints.find((r) => r.phase === "outcome")).toMatchObject({
      outcome: "succeeded",
      target: { kind: "index-session", id: "s1" },
      attrs: { scope: [SCOPE_READ] },
    });
    expect(JSON.stringify(mints)).not.toContain(ticket.grant);
    expect((await auditRecords(B.daemon)).some((r) => r.action === "index.ticket.mint")).toBe(
      false,
    );
  }, 90_000);

  it("the transcript's bytes ride the ticketed socket: hundreds of KiB arrive through the route while neither door's byte count moves with them (EL2)", async () => {
    const rows = Array.from({ length: 160 }, (_, i) => replyRow("s1", i + 1, 2_048));
    const { B, peerSockets } = await pair({ timeline: rows });
    const win = await windowOf(B.daemon, ["index.read"]);
    const ticket = IndexOpenTicket.parse(
      await win.call("index.openTicket", { device: "dev-a", sessionId: "s1" }),
    );
    const doors = (): number =>
      bytesOf(socketOf.get(win) as WebSocket) +
      peerSockets.reduce((sum, socket) => sum + bytesOf(socket), 0);
    const before = await settled(doors);
    // rosetta's own client over the ticket, counting what its socket carries
    let carried = 0;
    class Counting extends WebSocket {
      constructor(url: string, protocols?: string | string[]) {
        super(url, protocols);
        this.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
          carried += Array.isArray(data)
            ? data.reduce((sum, part) => sum + part.length, 0)
            : data instanceof ArrayBuffer
              ? data.byteLength
              : data.length;
        });
      }
    }
    const client = new RosettaClient({
      baseUrl: IndexEndpointSet.parse(ticket.endpoints).restUrl,
      credential: { kind: "grant", grant: ticket.grant },
      WebSocketImpl: Counting as unknown as typeof globalThis.WebSocket,
      fetchFn: fetch.bind(globalThis),
    });
    const entries = await new Promise<number>((resolve, reject) => {
      const subscription = client.subscribeSession("s1", {
        onChange: (current) => {
          if (current.length >= rows.length) {
            subscription.close();
            resolve(current.length);
          }
        },
        onError: (error) => {
          subscription.close();
          reject(new Error(`${error.code}: ${error.message}`));
        },
      });
      cleanup.push(() => subscription.close());
    });
    const after = doors();
    expect(entries).toBe(rows.length);
    expect(carried).toBeGreaterThan(rows.length * 2_048);
    // the doors carried the ask and the answer before the stream, and nothing
    // the size of the stream during it (a keepalive or a digest at most)
    expect(after - before).toBeLessThan(4_096);
    console.log(
      `DS7_BYTES ${JSON.stringify({ transcript: carried, doorsDuringStream: after - before, entries })}`,
    );
  }, 90_000);

  it("an ask without the right is refused on B before anything is carried: a plugin holding index.read, a window without it", async () => {
    const { A, B, routes } = await pair();
    const plugin = await tokenOf(B.daemon, ["index.read"], "ds7-plugin");
    const refused = await plugin.callErr("index.openTicket", { device: "dev-a", sessionId: "s1" });
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(refused.data?.details).toMatchObject({ principal: "plugin", device: "dev-a" });
    const reader = await windowOf(B.daemon, ["doc.read"], "w2");
    const scope = await reader.callErr("index.openTicket", { device: "dev-a", sessionId: "s1" });
    expect(scope.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(scope.data?.details).toEqual({ required: "index.read" });
    // (SP-7b: the phone through B is carried — its own describe below)
    // none of them reached A or took a route
    expect((await auditRecords(A.daemon)).some((r) => r.action === "index.ticket.mint")).toBe(
      false,
    );
    expect(routes.asked).toEqual([]);
  }, 90_000);

  it("no road: B's route to A is gone — egress_unavailable naming A, retryable, and the route's reference went back with A", async () => {
    const { B, routes } = await pair();
    const win = await windowOf(B.daemon, ["index.read"]);
    await win.call("index.openTicket", { device: "dev-a", sessionId: "s1" });
    expect(routes.refs("dev-a", PORTS.INDEX_SERVE)).toBe(1);
    routes.drop("dev-a", PORTS.INDEX_SERVE, "peer-left");
    expect(routes.refs("dev-a", PORTS.INDEX_SERVE)).toBe(0);
    const err = await win.callErr("index.openTicket", { device: "dev-a", sessionId: "s1" });
    expect(err.data).toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(IndexTicketRoadDetails.parse(err.data?.details)).toEqual({
      service: "index",
      state: INDEX_TICKET.STATE_EGRESS_UNAVAILABLE,
      device: "dev-a",
    });
  }, 90_000);
});

// SP-7b (2026-11-06; `SP-7b-plan.md` 7b-1) — the phone through its home. B is
// the phone's home and carries its ask whole; A mints for B's forward from its
// own rule, keyed by the phone behind it; B passes A's tailnet set back as A
// answered it, because the phone's node dials A's serve itself (no route here).
describe("SP-7b — a transcript on A, by ticket, for the phone whose home is B", () => {
  it("the phone asks B for A's session: A mints for B's forward keyed by the phone behind it, B passes A's tailnet set back untouched and takes no route — and the grant opens that session", async () => {
    const { A, B, routes, listen } = await pair();
    const phone = await tailnetCaller(B.daemon, B.mock, TEST_LOGIN);
    const ticket = await phoneTicket(phone, { device: "dev-a", sessionId: "s1" });
    if (ticket === undefined) return;
    // A's own set, as A answered it: the serve's tailnet coordinate
    expect(ticket.device).toBe("dev-a");
    const aOrigin = A.daemon.rosettad?.state().origin ?? null;
    expect(ticket.endpoints).toEqual(indexEndpointsFrom(A.daemon.mesh.serves(), aOrigin, "s1"));
    expect(IndexEndpointSet.safeParse(ticket.endpoints).success).toBe(false);
    // SP-7b's 7b-2a: and A's serve's origin beside the socket, carried through B untouched,
    // which the phone's RosettaClient reads the session's pages at
    const set = RemoteIndexEndpointSet.parse(ticket.endpoints);
    const socket = new URL(set.sessionUrl);
    const restOrigin = `${socket.protocol === "wss:" ? "https:" : "http:"}//${socket.host}`;
    expect(set["restUrl"]).toBe(restOrigin);
    // A's grant, read-only, keyed by the phone behind B's forward (not B alone)
    const verdict = verifyGrant(A.keys.at(-1) as Buffer, ticket.grant, Date.now());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.claims).toMatchObject({ sid: "s1", scope: [SCOPE_READ] });
    expect(verdict.claims.cid).toMatch(/^peer-fieldd:dev-b#/);
    // B took no route for it, and holds none
    expect(routes.asked).toEqual([]);
    expect(routes.refs("dev-a", PORTS.INDEX_SERVE)).toBe(0);
    // A's serve carries its rosettad's whole listener: the grant opens the session there
    expect(await dialSession(`ws://${listen}/ws/sessions/s1`, ticket.grant)).toMatchObject({
      opened: true,
      frame: { frame: "hello" },
    });
    // A audited the mint; B minted nothing of its own
    const mints = (await auditRecords(A.daemon)).filter((r) => r.action === "index.ticket.mint");
    expect(mints.find((r) => r.phase === "outcome")).toMatchObject({
      outcome: "succeeded",
      target: { kind: "index-session", id: "s1" },
      attrs: { scope: [SCOPE_READ] },
    });
    expect((await auditRecords(B.daemon)).some((r) => r.action === "index.ticket.mint")).toBe(
      false,
    );
  }, 90_000);
});

describe("DS-7 — A asleep", () => {
  it("B's window hears the peer link's honest UNAVAILABLE naming A, and no route is asked for", async () => {
    const routes = new FakeEgressRoutes();
    routes.route("dev-a", PORTS.INDEX_SERVE, "127.0.0.1:9");
    const B = await boot({
      rosettad: false,
      mesh: (mock) => {
        mock.meshDeviceId = "dev-b";
        mock.meshPeers = [
          {
            id: "node-a",
            deviceId: "dev-a",
            name: "device-a",
            online: false,
            whois: { login: TEST_LOGIN, deviceName: "device-a.tailnet.ts.net" },
          },
        ];
      },
      config: { indexEgressRoutes: routes },
    });
    await until(() => B.daemon.devices.get("dev-a") !== undefined, 8_000);
    const win = await windowOf(B.daemon, ["index.read"]);
    // B's roster already says A is asleep (DS-L8)…
    expect(B.daemon.devices.get("dev-a")).toMatchObject({ online: false, state: "asleep" });
    const err = await win.callErr("index.openTicket", { device: "dev-a", sessionId: "s1" });
    // …and the door's answer to the forward is the peer link's own, once its
    // dial gives up: the desktop named, retryable, nothing minted, no route.
    // (PeerLink dials a desktop the roster calls asleep — every forwarded call
    // does, today; History's window says "asleep" at once off the listing's
    // sources and never asks, `session-port.ts`.)
    expect(err.data).toEqual({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "peer-link", device: "dev-a", state: "unreachable" },
    });
    expect(routes.asked).toEqual([]);
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
async function realWorld(
  mesh?: (mock: MockMgmtServer) => void,
): Promise<{ daemon: FielddDaemon; win: WsRpc; sid: string; mock: MockMgmtServer }> {
  const dataDir = makeDataDir();
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  cpSync(GROUNDTRUTH, join(home, ".claude"), { recursive: true });
  const mock = await startMock(dataDir);
  mesh?.(mock);
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
  return { daemon, win, sid, mock };
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

  it("DS-7: a window on another desktop streams the REAL transcript through its route, by the owner's grant — rosetta's own client, and neither door carries it", async () => {
    // A, the owner: the real rosettad over the ground truth, on the (mock) tailnet
    const A = await realWorld((mock) => {
      mock.meshDeviceId = "dev-a";
      mock.meshPeers = [
        registryPeer({ nodeId: "node-b", deviceId: "dev-b", name: "device-b", login: TEST_LOGIN }),
      ];
      mock.storeSlices = new Map<string, unknown>([["dev-b", desktopSlice("dev-b", "device-b")]]);
    });
    await until(() => A.mock.meshServes.get("product") !== undefined, 15_000);
    const origin = A.daemon.rosettad?.state().origin ?? null;
    await until(
      () => indexEndpointsFrom(A.daemon.mesh.serves(), origin, A.sid) !== undefined,
      15_000,
    );
    // B, the window's desktop: its route to A's index serve, its dial to A's door
    const routes = new FakeEgressRoutes();
    const listen = `127.0.0.1:${indexTargetPort(origin)}`;
    routes.route("dev-a", PORTS.INDEX_SERVE, listen);
    const peerSockets: WebSocket[] = [];
    const aEndpoint = `ws://127.0.0.1:${A.daemon.controlPort}/t/${productPathSecret(A.mock)}`;
    const B = await boot({
      rosettad: false,
      mesh: (mock) => {
        mock.meshDeviceId = "dev-b";
        mock.meshPeers = [
          {
            id: "node-a",
            deviceId: "dev-a",
            name: "device-a",
            online: true,
            whois: { login: TEST_LOGIN, deviceName: "device-a.tailnet.ts.net" },
          },
        ];
      },
      config: { peerWebSocket: sidecar(() => aEndpoint, peerSockets), indexEgressRoutes: routes },
    });
    await until(() => B.daemon.devices.get("dev-a") !== undefined, 8_000);
    await until(() => A.daemon.devices.isDocHost("dev-b"), 8_000);
    const win = await windowOf(B.daemon, ["index.read"], "real-b");
    const ticket = IndexOpenTicket.parse(
      await win.call("index.openTicket", { device: "dev-a", sessionId: A.sid }),
    );
    expect(IndexEndpointSet.parse(ticket.endpoints).restUrl).toBe(`http://${listen}`);
    const doors = (): number =>
      bytesOf(socketOf.get(win) as WebSocket) +
      peerSockets.reduce((sum, socket) => sum + bytesOf(socket), 0);
    const before = await settled(doors);
    // rosetta's own client, holding A's grant: the header row and the live stream
    const client = clientFor(ticket);
    expect((await client.session(A.sid)).session.id).toBe(A.sid);
    const timelineId = await firstTimelineId(client, A.sid);
    expect(timelineId).not.toBe("");
    const stream = await firstSnapshot(client, A.sid);
    stream.close();
    expect(doors() - before).toBeLessThan(4_096);
    // the forwarded grant is read alone: the recorded-file read is refused
    expect(
      await getWith(
        `${IndexEndpointSet.parse(ticket.endpoints).restUrl}/api/sessions/${encodeURIComponent(A.sid)}/timeline/${encodeURIComponent(timelineId)}/read/0`,
        `Rosetta-Grant ${ticket.grant}`,
      ),
    ).toEqual({ status: 401, reason: "wrong-scope" });
  }, 240_000);
});
