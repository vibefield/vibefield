// TerminalService (NF-3/NF-6): the fieldd seam driven through the mock mgmt
// server (no cargo). Covers the NF-D8 endpoints capture from the hello ack,
// the D6 ticket (endpoints present/absent, both honest), the observed-
// inventory stream into terminal.list/get, the terminal.attach scope gate, the
// terminalHost capability flip, the NF-6 re-arm law (a failed observed
// subscribe neither fatals the boot nor stays dead forever), and the NF-6
// transport-death honesty law (a dead control socket is UNAVAILABLE, never the
// benign already-gone race). The live create/terminate/attach path needs a
// real PTY authority and lives in terminal-seam.test.ts.
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type DeviceInfo,
  grantSigningInput,
  isPipeEndpoint,
  METHODS,
  SOCKETS,
  TERMINAL_SCROLLBACK_CLASS_BYTES,
  TerminalConfigDocument,
  TerminalConfigWriteResult,
  TerminalConnectTicketResult,
  TerminalCreateOpenResult,
  type TerminalCreateResult,
  type TerminalEndpoints,
  type TerminalInfo,
  TerminalOpenTicketResult,
  TerminalRosterResult,
  type TerminalRouteSnapshot,
  TerminalTicket,
  type TerminalWorkloadClass,
} from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, NativeLink, RpcCallError } from "../src/index";
import { terminalCreateTarget } from "../src/native-link";
import { TerminalService } from "../src/terminal-service";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint, shortTmpRoot } from "./native-harness";
import { helloAs, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  // reversed + error-isolated: one rejecting cleanup must not leak the rest
  const fns = cleanup.reverse();
  cleanup = [];
  for (const fn of fns) {
    try {
      await fn();
    } catch {
      /* already-stopped daemons and dead sockets are fine */
    }
  }
});

function makeDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-term-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  return dataDir;
}

async function startMock(dataDir: string): Promise<MockMgmtServer> {
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

async function openRpc(port: number): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  cleanup.push(() => ws.close());
  return new WsRpc(ws);
}

const ENDPOINTS = {
  controlSocket: "/mock/native/run/termctl.sock",
  frameSocket: "/mock/native/run/termframe.sock",
  authToken: "mock-per-boot-token",
};

const packet = (bytes: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
};

/** The session shape the 0.8.0 protocol validator accepts. Every field is
 * required (`persistence` and `activity` are the two it back-fills), and an
 * event that fails validation gets the socket DESTROYED rather than an error —
 * which is how GT-0's fake got away with a hello missing `serverBuild`: the
 * connection died, and the only test using it asserted UNAVAILABLE either way. */
const fakeSession = (id: string): Record<string, unknown> => ({
  id,
  handle: `${id}-handle`,
  executable: "/bin/cat",
  cols: 100,
  rows: 30,
  exited: false,
  readWrite: true,
  title: null,
  cwd: null,
  bellCount: 0,
  pid: 4242,
  createdAtMs: 1,
  exitCode: null,
  exitSignal: null,
  requestedTermination: null,
  exitOutcome: null,
  ownerId: "vibefield.fieldd",
});

/** The overlay a fake floor is holding, in the fields the real service's
 * `config-document` carries. GT-3 drives this seam through the SERVICE's own
 * document API rather than through `fs`, so a fake that answers it is what
 * stands in for a floor here. */
interface FakeConfigDocument {
  path: string;
  revision: string;
  exists: boolean;
  contents: string;
}

/** A fake ghosttead control endpoint speaking just enough protocol: LE-u32
 * framing, bare-token auth → "ok", the hello, one create-session, and (GT-3)
 * the config-document trio. Enough to exercise the product plane's
 * create/terminate/config without a real PTY authority (that lives in
 * terminal-seam.test.ts, against the real floor).
 * `dieOnTerminate` destroys the socket mid-call — the NF-6 hole.
 * `noOverlay` refuses the document the way a service with no `with_config_path`
 * does, VERBATIM: the message is the only thing on the wire, and fieldd's
 * classification reads it.
 * `stall` (GT-5b) names command types the floor ACCEPTS and never answers —
 * a wedged service on a healthy socket, which is the state `client.connected`
 * cannot see.
 * `createError` replies to create-session with a verbatim service refusal, so
 * the classification of the floor's own prose can be exercised;
 * `createErrorMeta` rides the G17 structured fields ({stage, code, osError})
 * beside it, the shape a 0.10.0 floor emits.
 * `protocolMinor` reports an older floor on the hello (below 11 = no config
 * documents, below 15 = no per-session scrollback; the pinned CLIENT refuses
 * those before the wire). Default 16 — the 0.10.0 floor. */
async function startFakeFloor(
  opts: {
    dieOnTerminate?: boolean;
    noOverlay?: boolean;
    stall?: readonly string[];
    createError?: string;
    createErrorMeta?: { stage?: string; code?: string; osError?: number };
    protocolMinor?: number;
  } = {},
): Promise<{
  endpoints: TerminalEndpoints;
  createdSessionId: string;
  document: FakeConfigDocument;
  /** what the effective config reports; a write bumps it iff the text changed */
  configRevision: () => string;
  /** how many control connections this floor has accepted */
  connections: () => number;
  /** the options of the last create-session that REACHED this floor —
   * undefined when the pinned client refused before the wire (G16) */
  createOptions: () => Record<string, unknown> | undefined;
}> {
  // The root is the harness's (short on unix for the sun_path budget, tmpdir()
  // on win32 where no /tmp exists), and the fake binds the endpoint the real
  // floor would: `native/run/termctl.sock` under it on unix — the run dir is
  // ours to make, nothing spawned field-native here — or a root-scoped pipe
  // name on win32, which `net.Server.listen` needs instead of any path.
  const dir = shortTmpRoot("vf-fake-");
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const controlEndpoint = nativeEndpoint(dir, SOCKETS.TERMINAL_CONTROL);
  if (!isPipeEndpoint(controlEndpoint)) {
    mkdirSync(dirname(controlEndpoint), { recursive: true });
  }
  const createdSessionId = "fake-session-1";
  const live = new Set<Socket>();
  const document: FakeConfigDocument = {
    path: join(dir, "config.ghostty"),
    revision: "rev-empty",
    exists: false,
    contents: "",
  };
  let configRevision = "config-0";
  let lastCreateOptions: Record<string, unknown> | undefined;
  let connections = 0;
  const stall = new Set(opts.stall ?? []);
  const server: Server = createServer((sock: Socket) => {
    let buf = Buffer.alloc(0);
    let authed = false;
    connections += 1;
    live.add(sock);
    sock.on("close", () => live.delete(sock));
    sock.on("error", () => undefined);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (buf.length < 4 + len) return;
        const body = buf.subarray(4, 4 + len);
        buf = buf.subarray(4 + len);
        if (!authed) {
          authed = true;
          sock.write(packet(Buffer.from("ok")));
          continue;
        }
        const msg = JSON.parse(body.toString("utf8"));
        const reply = (payload: Record<string, unknown>): void => {
          sock.write(packet(Buffer.from(JSON.stringify({ requestId: msg.requestId, ...payload }))));
        };
        // A wedged service: the request is accepted, the socket stays up, and
        // no answer ever comes. `hello` is never stallable — the client's
        // connect budget would fire instead of its request budget, and the
        // state under test is a CONNECTED floor that has stopped answering.
        if (msg.type !== "hello" && stall.has(msg.type)) continue;
        if (msg.type === "hello") {
          reply({
            type: "hello",
            protocolMajor: 1,
            protocolMinor: opts.protocolMinor ?? 16,
            serverBuild: "vibefield-fake-floor",
          });
        } else if (msg.type === "create-session") {
          lastCreateOptions = msg.options as Record<string, unknown>;
          if (opts.createError !== undefined)
            reply({ type: "error", message: opts.createError, ...opts.createErrorMeta });
          else reply({ type: "session-created", session: fakeSession(createdSessionId) });
        } else if (msg.type === "terminate" && opts.dieOnTerminate === true) {
          sock.destroy(); // the floor dies mid-call
        } else if (msg.type === "get-config") {
          reply({ type: "config", config: fakeConfig(configRevision) });
        } else if (msg.type === "get-config-document") {
          if (opts.noOverlay === true) reply({ type: "error", message: NO_OVERLAY_MESSAGE });
          else reply({ type: "config-document", document: { schemaVersion: 1, ...document } });
        } else if (msg.type === "replace-config-document") {
          if (opts.noOverlay === true) {
            reply({ type: "error", message: NO_OVERLAY_MESSAGE });
          } else if (msg.expectedRevision !== document.revision) {
            // The real service answers a conflict with the CURRENT document, so
            // an editor can show what it is about to overwrite.
            reply({
              type: "config-document-conflict",
              document: { schemaVersion: 1, ...document },
            });
          } else {
            // The real replace_document writes, then reloads, in one operation:
            // the effective revision moves iff the text actually did.
            if (msg.contents !== document.contents)
              configRevision = `config-${msg.contents.length}`;
            document.contents = msg.contents;
            document.revision = `rev-${msg.contents.length}`;
            document.exists = true;
            reply({
              type: "config-document-updated",
              document: { schemaVersion: 1, ...document },
              config: fakeConfig(configRevision, msg.contents),
            });
          }
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(controlEndpoint, resolve));
  cleanup.push(
    () =>
      new Promise<void>((r) => {
        // close() waits out live connections; a client that forgot to hang up
        // must fail its own test, not stall the suite for the hook timeout.
        for (const sock of live) sock.destroy();
        server.close(() => r());
      }),
  );
  return {
    endpoints: {
      controlSocket: controlEndpoint,
      // never bound by this fake — the frame plane belongs to a real floor, and
      // this only has to be the endpoint a ticket would carry
      frameSocket: nativeEndpoint(dir, SOCKETS.TERMINAL_FRAME),
      authToken: "fake-token",
    },
    createdSessionId,
    document,
    configRevision: () => configRevision,
    connections: () => connections,
    createOptions: () => lastCreateOptions,
  };
}

/** The service's refusal when nothing pointed it at an overlay, verbatim from
 * the pinned crate (`ConfigDocumentError::Unavailable`). Copied deliberately:
 * fieldd classifies this state by MESSAGE, and a fake that paraphrased it would
 * make the classification test pass while production kept getting INTERNAL. */
const NO_OVERLAY_MESSAGE = "configuration document is unavailable without an explicit overlay";

/** A WHOLE `ConfigSnapshot`, not the two fields fieldd reads.
 *
 * The 0.8.0 client validates every server event and DESTROYS the socket on a
 * malformed one rather than rejecting the call — so a stub carrying only
 * `revision` and `diagnostics` does not fail an assertion, it kills the
 * connection and every config test reads "the floor died". That is GT-0's
 * finding number 6 arriving a second time, and it is why this is spelled out.
 *
 * The parts that MEAN something here: `revision` is what fieldd compares to
 * derive `effectiveChanged`, and `diagnostics` severities decide `ok` — an
 * unknown key earns a diagnostic and NOT a refusal in Ghostty syntax, which is
 * the case the panel has to show. */
const fakeConfig = (revision: string, contents = ""): Record<string, unknown> => ({
  schemaVersion: 1,
  revision,
  compatibility: { ghosttyVersion: "1.0.0", ghosttyCommit: "deadbeef", knownKeyCount: 1 },
  sources: [{ path: "/fake/config.ghostty", kind: "ghosttea-overlay" }],
  diagnostics: contents.includes("nonsense-key")
    ? [{ severity: "error", code: "unknown-key", message: "unknown configuration key" }]
    : [],
  configuredKeys: [],
  terminal: {
    scrollbackBytes: 1024,
    foreground: [255, 255, 255],
    background: [0, 0, 0],
    cursor: [255, 255, 255],
  },
  renderer: {
    foreground: [255, 255, 255],
    background: [0, 0, 0],
    cursor: [255, 255, 255],
    selectionBackground: [255, 255, 255],
    selectionForeground: [0, 0, 0],
    fontSize: 13,
    fontFamilies: [],
    paddingX: [2, 2],
    paddingY: [2, 2],
    postProcess: "none",
    customShaderPaths: [],
  },
  workspace: { keybindings: [], clearKeybindings: false },
});

interface AuditRecord {
  action: string;
  phase: "attempt" | "outcome";
  outcome?: string;
  target?: { kind: string; id: string };
  attrs?: Record<string, unknown>;
}

/** Poll until `fn` answers something, or fail the test. */
async function poll<T>(fn: () => Promise<T | undefined>, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("poll timed out");
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Every audited record the daemon wrote, in order. */
async function readAuditRecords(dataDir: string): Promise<AuditRecord[]> {
  const root = join(dataDir, "audit");
  const records: AuditRecord[] = [];
  for (const name of readdirSync(root).sort()) {
    if (!name.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(root, name), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      records.push(JSON.parse(line) as AuditRecord);
    }
  }
  return records;
}

/** Every audited action the daemon recorded, in order. */
async function readAuditActions(dataDir: string): Promise<string[]> {
  return (await readAuditRecords(dataDir)).map((record) => record.action);
}

const observed = (terminals: Array<Record<string, unknown>>) => ({
  generation: 0,
  bootId: "mock-boot",
  terminals,
  workers: [],
});

/** TC-D15 — a one-cell route snapshot around a floor's real endpoints, so a
 * replacement in a test moves the dial coordinates the way a respawned cell
 * does (per-instance socket names; a restart is never a rebind). */
function cellRoutes(
  revision: number,
  cellBootId: string,
  endpoints: TerminalEndpoints,
): TerminalRouteSnapshot {
  return {
    revision,
    cells: [
      {
        cellInstanceId: revision,
        cellBootId,
        pid: 4000 + revision,
        endpoints,
        tokenGeneration: revision,
      },
    ],
  };
}

/** TC-S3 — a K-cell snapshot: one row per cell, each with its own class, role
 * and coordinates. The pid/tokenGeneration filler is the floor's, uninteresting
 * here; what the rows under test read is `cellInstanceId` (the solo ordering),
 * `cellBootId` (THE identity) and the class/role pair. */
function classRoutes(
  revision: number,
  cells: Array<{
    cellInstanceId: number;
    cellBootId: string;
    endpoints: TerminalEndpoints;
    workloadClass?: TerminalWorkloadClass;
    role?: "class" | "solo";
  }>,
): TerminalRouteSnapshot {
  return {
    revision,
    cells: cells.map((cell) => ({
      cellInstanceId: cell.cellInstanceId,
      cellBootId: cell.cellBootId,
      pid: 4000 + cell.cellInstanceId,
      endpoints: cell.endpoints,
      tokenGeneration: revision,
      ...(cell.workloadClass === undefined ? {} : { workloadClass: cell.workloadClass }),
      ...(cell.role === undefined ? {} : { role: cell.role }),
    })),
  };
}

/** TC-S3 — the inventory's `cell` tag, the join between an observed session and
 * a route row. Deliberately without endpoints: the tag names PLACEMENT, the
 * snapshot owns coordinates. */
function cellTag(
  cellInstanceId: number,
  cellBootId: string,
  workloadClass: TerminalWorkloadClass,
  role: "class" | "solo" = "class",
): Record<string, unknown> {
  return { cellInstanceId, cellBootId, workloadClass, role };
}

/** Fake endpoints for a cell that is only ever TICKETED, never dialed — the
 * mint rows need coordinates to tell cells apart, not a floor to talk to. */
function paperEndpoints(name: string): TerminalEndpoints {
  return {
    controlSocket: `/mock/native/run/termctl.${name}.sock`,
    frameSocket: `/mock/native/run/termframe.${name}.sock`,
    authToken: `${name}-token`,
  };
}

/** The ticket those paper endpoints mint to (D6 — the ticket IS the cell's
 * endpoints, so "which cell answered" is assertable as a whole shape). */
function paperTicket(name: string): TerminalTicket {
  const endpoints = paperEndpoints(name);
  return {
    controlSocket: endpoints.controlSocket,
    frameSocket: endpoints.frameSocket,
    token: endpoints.authToken,
  };
}

/** A structural link whose routes can MOVE, for the rows that drive placement
 * without a daemon. The legacy mirror is derived by the link's OWN helper
 * rather than re-implemented here: a fake that derived it differently could
 * make a routing row pass against a link that would never publish that reading
 * (native-link.test.ts pins the derivation itself). */
function routedLink(initial: TerminalRouteSnapshot): {
  link: ConstructorParameters<typeof TerminalService>[0]["link"];
  move: (next: TerminalRouteSnapshot) => void;
} {
  const listeners: Array<() => void> = [];
  let snapshot = initial;
  return {
    link: {
      subscribe: async () => ({ snapshot: observed([]) }),
      get terminalEndpoints() {
        return terminalCreateTarget(snapshot, "interactive")?.endpoints;
      },
      get terminalRoutes() {
        return snapshot;
      },
      on: (_event: "terminal-endpoints", fn: () => void) => listeners.push(fn),
    },
    move: (next: TerminalRouteSnapshot) => {
      snapshot = next;
      for (const fn of listeners) fn();
    },
  };
}

/** A NativeLink paired with the mock, for the rows that drive TerminalService
 * through the REAL link rather than a structural fake — the route stream only
 * exists on that path. The route subscription is armed just AFTER the dial (the
 * instant the daemon arms its observed one), so this waits for it: a delta
 * pushed before the subscribe lands would go nowhere. */
async function connectedLink(dataDir: string, mock: MockMgmtServer): Promise<NativeLink> {
  const link = new NativeLink({
    socketPath: nativeEndpoint(dataDir, SOCKETS.MGMT),
    pairingFile: join(dataDir, "native", "pairing"),
    bootId: "terminal-routes-test",
  });
  cleanup.push(() => link.close());
  await link.connect();
  await poll(async () =>
    mock.subscriptionRequests.includes("native.lifecycle.terminal.routes.subscribe")
      ? true
      : undefined,
  );
  return link;
}

interface CapturedLog {
  event: string;
  message: string;
  attrs?: LogFields | undefined;
}

/** The house capture logger (link-service.test.ts's shape), kept whole here
 * because the TC-S2 receipt is asserted on its MESSAGE as well as its attrs. */
function captureLogger(events: CapturedLog[]): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: (event, message, attrs) => events.push({ event, message, attrs }),
    debug: (event, message, attrs) => events.push({ event, message, attrs }),
    info: (event, message, attrs) => events.push({ event, message, attrs }),
    warn: (event, message, attrs) => events.push({ event, message, attrs }),
    error: (event, message, _error, attrs) => events.push({ event, message, attrs }),
    fatal: (event, message, _error, attrs) => events.push({ event, message, attrs }),
    isLevelEnabled: () => true,
  };
  return logger;
}

describe("TerminalService (NF-3, mock native)", () => {
  it("captures hello endpoints, mints tickets, and refuses honestly without them", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS;
    mock.observedState = observed([{ sessionId: "s1", pid: 42, title: "cat" }]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "terminal-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    // inventory from the observed snapshot
    const list = (await rpc.call("terminal.list", {})) as { terminals: TerminalInfo[] };
    expect(list.terminals.map((t) => t.sessionId)).toEqual(["s1"]);
    const got = (await rpc.call("terminal.get", { sessionId: "s1" })) as TerminalInfo;
    expect(got.pid).toBe(42);

    // D6: the ticket IS the endpoints
    const ticket = (await rpc.call("terminal.openTicket", { sessionId: "s1" })) as TerminalTicket;
    expect(ticket).toMatchObject({
      controlSocket: ENDPOINTS.controlSocket,
      frameSocket: ENDPOINTS.frameSocket,
      token: ENDPOINTS.authToken,
    });

    // unknown session refuses before any credential is exposed
    const missing = await rpc.callErr("terminal.openTicket", { sessionId: "ghost" });
    expect(missing.data?.kind).toBe("NOT_FOUND");
    const gone = await rpc.callErr("terminal.get", { sessionId: "ghost" });
    expect(gone.data?.kind).toBe("NOT_FOUND");
  });

  it("streams observed deltas into the inventory", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS;
    mock.observedState = observed([]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "terminal-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    let list = (await rpc.call("terminal.list", {})) as { terminals: TerminalInfo[] };
    expect(list.terminals).toEqual([]);

    mock.pushObserved(observed([{ sessionId: "a" }, { sessionId: "b" }]));
    let settled = false;
    for (let i = 0; i < 40 && !settled; i++) {
      list = (await rpc.call("terminal.list", {})) as { terminals: TerminalInfo[] };
      settled = list.terminals.length === 2;
      if (!settled) await new Promise((r) => setTimeout(r, 100));
    }
    expect(settled).toBe(true);
    expect(list.terminals.map((t) => t.sessionId).sort()).toEqual(["a", "b"]);
  });

  it("refuses ticket/create/terminate honestly when the floor is absent", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    // no helloTerminal: a pre-NF-2 native / degraded unit
    mock.observedState = observed([{ sessionId: "s1" }]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach", "settings.manage"], "terminal-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    for (const [method, params] of [
      ["terminal.openTicket", { sessionId: "s1" }],
      ["terminal.connectTicket", {}],
      ["terminal.create", {}],
      ["terminal.terminate", { sessionId: "s1" }],
      ["terminal.config.read", {}],
      ["terminal.config.write", { text: "", revision: "rev" }],
    ] as const) {
      const err = await rpc.callErr(method, params);
      expect(err.data?.kind, method).toBe("UNAVAILABLE");
    }
  });

  it("terminal.connectTicket mints for a connection, with no session on the floor (GT-D10)", async () => {
    // The deck's door. It used to be `terminal.create`: opening the Godview
    // spawned a shell so that a ticket could ride the answer, which is how
    // fieldd became a second session authority in front of the workspace. This
    // asks for the connection and nothing else — so the floor here is EMPTY,
    // and it must still be empty afterwards.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS;
    mock.observedState = observed([]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "terminal-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    // Parsed against the contract, not merely shaped like it.
    const minted = TerminalConnectTicketResult.parse(await rpc.call("terminal.connectTicket", {}));
    expect(minted.ticket).toMatchObject({
      controlSocket: ENDPOINTS.controlSocket,
      frameSocket: ENDPOINTS.frameSocket,
      token: ENDPOINTS.authToken,
    });

    const list = (await rpc.call("terminal.list", {})) as { terminals: TerminalInfo[] };
    expect(list.terminals, "a connection mint must not have created anything").toEqual([]);

    // Still a privilege grant, so still on the record — attempt before effect,
    // like every other mint — and recorded as what it IS: a ticket for the
    // connection, not for some session id this call never had.
    const records = (await readAuditRecords(dataDir)).filter((r) =>
      r.action.startsWith("terminal."),
    );
    expect(records.map((r) => `${r.action}:${r.phase}`)).toEqual([
      "terminal.ticket.mint:attempt",
      "terminal.ticket.mint:outcome",
    ]);
    for (const record of records) {
      expect(record.target).toEqual({ kind: "terminal", id: "connection" });
    }
    expect(records[1]?.outcome).toBe("succeeded");
  });

  it("gates every terminal.* method on its declared scope", async () => {
    // This test used to be NAMED for every method and exercise exactly one
    // (`terminal.list`), so a new terminal door could ship ungated and stay
    // green here — and `contracts/test/registry.test.ts` explicitly permits
    // `scope: null`, so it passed there too. Both halves are closed now: the
    // expected map must EXHAUST the registry (a new method with no entry fails
    // before anything is called), and every declared method is actually
    // refused for a principal that holds neither scope.
    const EXPECTED_SCOPE: Record<string, string> = {
      "terminal.list": "terminal.attach",
      "terminal.get": "terminal.attach",
      "terminal.openTicket": "terminal.attach",
      "terminal.connectTicket": "terminal.attach",
      "terminal.create": "terminal.attach",
      "terminal.terminate": "terminal.attach",
      "terminal.renewAttach": "terminal.attach",
      "terminal.roster": "terminal.attach",
      "terminal.config.read": "settings.manage",
      "terminal.config.write": "settings.manage",
    };
    const declared = METHODS.filter(
      (m) => m.surface === "product" && m.method.startsWith("terminal."),
    );
    expect(
      declared.map((m) => m.method).sort(),
      "a new terminal.* method must state its scope here",
    ).toEqual(Object.keys(EXPECTED_SCOPE).sort());
    for (const def of declared) {
      expect(def.scope, def.method).toBe(EXPECTED_SCOPE[def.method]);
    }

    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS;
    mock.observedState = observed([{ sessionId: "s1" }]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    // holds NEITHER terminal.attach nor settings.manage
    const narrow = daemon.tokens.mint(["doc.read"], "narrow");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, narrow.token);
    for (const def of declared) {
      // the scope check runs before params parsing, so `{}` reaches it from
      // every door (product-api.ts: find def → check scope → dispatch)
      const err = await rpc.callErr(def.method, {});
      expect(err.data?.kind, def.method).toBe("FORBIDDEN_SCOPE");
      expect((err.data?.details as { required?: string } | undefined)?.required, def.method).toBe(
        EXPECTED_SCOPE[def.method],
      );
    }
  });

  it("a failed observed subscribe neither fatals the boot nor stays dead (NF-6 re-arm)", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS;
    // first attempt refused — the OLD code either killed the boot (connected)
    // or silently deleted the subscription forever (link blip)
    mock.rejectedSubscriptions.add("native.lifecycle.observed.subscribe");
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "rearm-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    // GT-5b: an UNARMED inventory refuses. It used to answer `[]` — a
    // well-formed lie meaning "this floor holds no sessions", which is the
    // answer the Godview's restore reads as "every saved pane is dead" and
    // offers to start clean from. This is the two-plane case exactly: the
    // daemon is alive, the subscribe was refused, and fieldd has observed
    // NOTHING about a field-native that may be holding live sessions.
    const unobserved = await rpc.callErr("terminal.list", {});
    expect(unobserved.data?.kind).toBe("UNAVAILABLE");
    expect((unobserved.data?.details as { state?: string } | undefined)?.state).toBe("unobserved");
    const unobservedGet = await rpc.callErr("terminal.get", { sessionId: "anything" });
    expect(unobservedGet.data?.kind, "get refuses on the same grounds").toBe("UNAVAILABLE");

    // the refusal clears and a reconnect fires the "connected" re-arm
    mock.rejectedSubscriptions.clear();
    mock.observedState = observed([{ sessionId: "reborn" }]);
    mock.killClients();

    let list: { terminals: TerminalInfo[]; observation?: { bootId: string } } | undefined;
    let settled = false;
    for (let i = 0; i < 60 && !settled; i++) {
      list = (await rpc.call("terminal.list", {}).catch(() => undefined)) as typeof list;
      settled = list?.terminals.length === 1;
      if (!settled) await new Promise((r) => setTimeout(r, 100));
    }
    expect(settled).toBe(true);
    expect(list?.terminals[0]?.sessionId).toBe("reborn");
    // and the answer names the observation it came from, which is what lets a
    // holder of an old list tell a changed floor from a different one
    expect(list?.observation?.bootId).toBe("mock-boot");
  });

  it("terminal.create answers WITH a ticket, for a session the inventory has not seen (GT-1)", async () => {
    // The race GT-0 measured, reproduced deliberately: the observed inventory
    // is EMPTY, so openTicket refuses the very session create just made. create
    // does not consult the inventory — it knows the session — so its ticket is
    // usable in the same breath. That asymmetry IS the contract.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const floor = await startFakeFloor();
    mock.helloTerminal = floor.endpoints;
    mock.observedState = observed([]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "terminal-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const created = (await rpc.call("terminal.create", {})) as TerminalCreateResult;
    expect(created.sessionId).toBe(floor.createdSessionId);
    expect(created.ticket).toMatchObject({
      controlSocket: floor.endpoints.controlSocket,
      frameSocket: floor.endpoints.frameSocket,
      token: floor.endpoints.authToken,
    });

    // the pre-GT-1 path is still honestly observed-gated for THIS session
    const raced = await rpc.callErr("terminal.openTicket", { sessionId: created.sessionId });
    expect(raced.data?.kind).toBe("NOT_FOUND");

    // both grants are on the record: the spawn and the credential it handed out
    const actions = (await readAuditActions(dataDir)).filter((a) => a.startsWith("terminal."));
    expect(actions).toContain("terminal.session.create");
    expect(actions).toContain("terminal.ticket.mint");
  });

  it("a control socket dying mid-terminate is UNAVAILABLE, never 'already gone' (NF-6)", async () => {
    // The same fake floor, told to die on the terminate request — the review's
    // measured hole (a SIGKILLed floor read as {terminated:false} and audited
    // success).
    const floor = await startFakeFloor({ dieOnTerminate: true });
    const endpoints: TerminalEndpoints = floor.endpoints;
    const service = new TerminalService({
      link: {
        subscribe: async () => ({ snapshot: {} }),
        terminalEndpoints: endpoints,
        on: () => undefined,
      },
    });
    cleanup.push(() => service.dispose());

    const failure = await service.terminate("some-live-session").then(
      (r) => ({ kind: "result" as const, r }),
      (e) => ({ kind: "error" as const, e }),
    );
    // the OLD code returned {terminated:false} here — the benign-race lie
    expect(failure.kind).toBe("error");
    if (failure.kind === "error") {
      expect(failure.e).toBeInstanceOf(RpcCallError);
      expect((failure.e as RpcCallError).kind).toBe("UNAVAILABLE");
    }
  });

  it("reads and writes config.ghostty through the floor's own document door (GT-3)", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const floor = await startFakeFloor();
    mock.helloTerminal = floor.endpoints;
    mock.observedState = observed([]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["settings.manage"], "settings-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    // A file that does not exist yet reads as an empty document with a path —
    // there is nothing to create, and the panel can show the user the file they
    // are about to write.
    const before = TerminalConfigDocument.parse(await rpc.call("terminal.config.read", {}));
    expect(before.exists).toBe(false);
    expect(before.text).toBe("");
    expect(before.path.endsWith("config.ghostty")).toBe(true);

    const written = TerminalConfigWriteResult.parse(
      await rpc.call("terminal.config.write", {
        text: "# vibefield\nfont-size = 13\n",
        revision: before.revision,
      }),
    );
    expect(written.ok, "a config the loader accepted").toBe(true);
    expect(written.effectiveChanged, "the reload moved the effective config").toBe(true);
    expect(written.document.exists).toBe(true);
    expect(written.document.text).toBe("# vibefield\nfont-size = 13\n");
    expect(floor.document.contents, "the floor holds what was written").toBe(
      "# vibefield\nfont-size = 13\n",
    );

    // The revision the write answered is the one the next write must carry.
    const again = TerminalConfigWriteResult.parse(
      await rpc.call("terminal.config.write", {
        text: "# vibefield\nfont-size = 13\n",
        revision: written.document.revision,
      }),
    );
    expect(again.ok).toBe(true);
    expect(again.effectiveChanged, "rewriting identical text changes nothing").toBe(false);

    // Auditing: the write is an act, the read is not. The record carries the
    // SHAPE of the edit and never the file's contents.
    const records = (await readAuditRecords(dataDir)).filter(
      (record) => record.action === "terminal.config.write",
    );
    expect(records.map((record) => record.phase)).toEqual([
      "attempt",
      "outcome",
      "attempt",
      "outcome",
    ]);
    for (const record of records) {
      expect(record.target).toEqual({ kind: "terminal", id: "config" });
    }
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("font-size");
  });

  it("a write the loader refuses is honest, not a failed call (GT-3)", async () => {
    // Ghostty syntax is permissive: an unknown key is a DIAGNOSTIC and the file
    // still loads. The bytes reached the disk and the floor reloaded, so this
    // is not an error — it is a verdict the user has to see.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const floor = await startFakeFloor();
    mock.helloTerminal = floor.endpoints;
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["settings.manage"], "settings-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const before = TerminalConfigDocument.parse(await rpc.call("terminal.config.read", {}));
    const written = TerminalConfigWriteResult.parse(
      await rpc.call("terminal.config.write", {
        text: "nonsense-key = 1\n",
        revision: before.revision,
      }),
    );
    expect(written.ok).toBe(false);
    expect(written.document.exists, "it still landed").toBe(true);
    expect(written.diagnostics[0]?.message).toBe("unknown configuration key");
  });

  it("a stale revision is a CONFLICT, never a silent clobber (GT-3)", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const floor = await startFakeFloor();
    mock.helloTerminal = floor.endpoints;
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["settings.manage"], "settings-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const before = TerminalConfigDocument.parse(await rpc.call("terminal.config.read", {}));
    await rpc.call("terminal.config.write", {
      text: "font-size = 13\n",
      revision: before.revision,
    });
    // The same revision a second time: this editor is holding a stale read.
    const err = await rpc.callErr("terminal.config.write", {
      text: "font-size = 99\n",
      revision: before.revision,
    });
    expect(err.data?.kind).toBe("CONFLICT");
    expect(floor.document.contents, "the newer file survived").toBe("font-size = 13\n");
  });

  it("a floor with no app overlay says so, and is not an INTERNAL (GT-3)", async () => {
    // A pre-GT-3 field-native, or any floor whose service was never pointed at
    // our file. The service is alive and answering — it simply has no document
    // to edit — so this is a degraded SERVICE state with its own name.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const floor = await startFakeFloor({ noOverlay: true });
    mock.helloTerminal = floor.endpoints;
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["settings.manage"], "settings-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const err = await rpc.callErr("terminal.config.read", {});
    expect(err.data?.kind).toBe("UNAVAILABLE");
    expect((err.data?.details as { state?: string } | undefined)?.state).toBe("no-overlay");
  });

  it("gates the config surface on settings.manage, not terminal.attach (GT-3)", async () => {
    // Attaching to a terminal and rewriting the configuration every terminal on
    // the device loads are different powers.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS;
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const attacher = daemon.tokens.mint(["terminal.attach"], "deck");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, attacher.token);
    for (const [method, params] of [
      ["terminal.config.read", {}],
      ["terminal.config.write", { text: "", revision: "r" }],
    ] as const) {
      const err = await rpc.callErr(method, params);
      expect(err.data?.kind, method).toBe("FORBIDDEN_SCOPE");
    }
  });

  it("stops minting once the floor that said hello is gone (GT-5b)", async () => {
    // THE stale-credential hole. `terminalEndpoints` was assigned on the
    // pairing hello and cleared nowhere, so a floor that died AFTER saying
    // hello kept every ticket door open: sockets that no longer exist plus a
    // dead boot's token, handed out and AUDITED AS A SUCCESSFUL GRANT. No test
    // covered floor-died-after-hello anywhere — the kill matrix SIGKILLed the
    // floor and re-checked only `create`.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS;
    mock.observedState = observed([{ sessionId: "s1" }]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "stale-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    // a live floor mints, as it should
    const live = TerminalConnectTicketResult.parse(await rpc.call("terminal.connectTicket", {}));
    expect(live.ticket.token).toBe(ENDPOINTS.authToken);

    // the floor dies and does not come back (stop() closes the listener too,
    // so the reconnect cannot re-learn endpoints — a SIGKILLed field-native)
    await mock.stop();

    const refused = await poll(async () => {
      const err = await rpc.callErr("terminal.connectTicket", {});
      return err.data?.kind === "UNAVAILABLE" ? err : undefined;
    });
    expect((refused.data?.details as { state?: string } | undefined)?.state).toBe("absent");
    const openRefused = await rpc.callErr("terminal.openTicket", { sessionId: "s1" });
    expect(openRefused.data?.kind, "the session-scoped door refuses too").toBe("UNAVAILABLE");

    // the audit says a mint was ATTEMPTED and FAILED — not that a credential
    // was granted, which is what the record used to claim for a dead floor
    const mints = (await readAuditRecords(dataDir)).filter(
      (r) => r.action === "terminal.ticket.mint",
    );
    expect(mints.filter((r) => r.phase === "outcome").map((r) => r.outcome)).toContain("failed");
    expect(
      mints.filter((r) => r.phase === "outcome" && r.outcome === "succeeded"),
      "exactly the one mint made while the floor was alive",
    ).toHaveLength(1);

    // and the source the terminalHost capability is computed from is honest
    // too (`daemon.ts` reads exactly this for D31). Asserted at the source
    // rather than through `device.list`: the PUBLISHED slice is refreshed by
    // DeviceService.sync, whose first act is a mesh round trip over the mgmt
    // link — which is down, by construction, in precisely this scenario — so
    // the roster keeps the last published capability until the link returns.
    // That staleness is a separate, pre-existing gap and not this fix's.
    expect(daemon.native.terminalEndpoints).toBeUndefined();
  }, 30_000);

  it("audits a born session before asking for its credential (GT-5b)", async () => {
    // The mint used to run INSIDE the create's audited effect, so a mint that
    // threw made the outer record say `session.create → failed` for a PTY that
    // exists — and named no session, so the birth was unrecoverable from the
    // log. Ordering is the fix: the birth is recorded with its id first.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const floor = await startFakeFloor();
    mock.helloTerminal = floor.endpoints;
    mock.observedState = observed([]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "create-order-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);
    const created = (await rpc.call("terminal.create", {})) as TerminalCreateResult;

    const records = (await readAuditRecords(dataDir)).filter((r) =>
      r.action.startsWith("terminal."),
    );
    expect(records.map((r) => `${r.action}:${r.phase}`)).toEqual([
      "terminal.session.create:attempt",
      "terminal.session.create:outcome",
      "terminal.ticket.mint:attempt",
      "terminal.ticket.mint:outcome",
    ]);
    // the create's OWN outcome names the session, before any credential is
    // asked for — the record stands on its own if the mint never lands
    expect(records[1]?.attrs?.["sessionId"]).toBe(created.sessionId);
    expect(records[2]?.target).toEqual({ kind: "terminal", id: created.sessionId });
  });

  it("a wedged floor is UNAVAILABLE unresponsive, never INTERNAL (GT-5b)", async () => {
    // `client.connected` is `authenticated && socket !== undefined`, and a
    // request timeout leaves both untouched — so this used to answer INTERNAL,
    // retryable, for a floor that had stopped answering. For create it is
    // worse than a misnomer: the PTY may have been born and merely replied
    // late, so retrying orphans the first one.
    const floor = await startFakeFloor({ stall: ["create-session", "terminate"] });
    const service = new TerminalService({
      link: {
        subscribe: async () => ({ snapshot: {} }),
        terminalEndpoints: floor.endpoints,
        on: () => undefined,
      },
      requestTimeoutMs: 300,
    });
    cleanup.push(() => service.dispose());

    for (const [what, call] of [
      ["create", () => service.create({})],
      ["terminate", () => service.terminate("s1")],
    ] as const) {
      const error = await call().then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error, what).toBeInstanceOf(RpcCallError);
      expect((error as RpcCallError).kind, what).toBe("UNAVAILABLE");
      expect((error as RpcCallError).details, what).toMatchObject({ state: "unresponsive" });
    }
  }, 20_000);

  it("classifies the floor's spawn refusal and nothing else as the caller's (GT-5b)", async () => {
    // The old test was an unanchored /spawn/i over free prose. The floor has a
    // SECOND spawn-bearing refusal — `session spawn task stopped`, its blocking
    // task falling over — and that is the floor failing, not the caller: it was
    // being answered PRECONDITION_FAILED, non-retryable, telling the caller to
    // fix input it had got right.
    // Since G17 these bare messages are the ABSENT-METADATA fallback: a
    // pre-0.10.0 floor, or a refusal upstream never typed. The typed rows
    // live in the G17 tests below.
    for (const [message, kind, retryable] of [
      ["failed to spawn PTY command", "PRECONDITION_FAILED", false],
      ["session spawn task stopped", "INTERNAL", true],
    ] as const) {
      const floor = await startFakeFloor({ createError: message });
      const service = new TerminalService({
        link: {
          subscribe: async () => ({ snapshot: {} }),
          terminalEndpoints: floor.endpoints,
          on: () => undefined,
        },
      });
      cleanup.push(() => service.dispose());
      const error = (await service.create({}).then(
        () => undefined,
        (e: unknown) => e,
      )) as RpcCallError | undefined;
      expect(error?.kind, message).toBe(kind);
      expect(error?.retryable, message).toBe(retryable);
    }
  });

  it("maps a declared workloadClass through the contracts table to the floor's cap (G16)", async () => {
    // TC-D6(c) ENFORCED: the values asserted are the genned registry's, not
    // literals — the same authority field-native reads. An UNDECLARED class
    // sends nothing: the floor's global default governs, byte-identical to a
    // pre-G16 create, because inventing a class would fake a policy the
    // caller never declared.
    const floor = await startFakeFloor();
    const service = new TerminalService({
      link: {
        subscribe: async () => ({ snapshot: {} }),
        terminalEndpoints: floor.endpoints,
        on: () => undefined,
      },
    });
    cleanup.push(() => service.dispose());
    await service.create({ workloadClass: "agent" });
    expect(floor.createOptions()?.["scrollbackBytes"]).toBe(TERMINAL_SCROLLBACK_CLASS_BYTES.AGENT);
    await service.create({ workloadClass: "interactive" });
    expect(floor.createOptions()?.["scrollbackBytes"]).toBe(
      TERMINAL_SCROLLBACK_CLASS_BYTES.INTERACTIVE,
    );
    await service.create({});
    expect(floor.createOptions()).not.toHaveProperty("scrollbackBytes");
  });

  it("refuses to pretend a pre-1.15 floor enforces a cap (G16)", async () => {
    // The silent-ignore trap the petition named: an older daemon drops
    // unknown JSON fields, so a classed create against it would report a cap
    // nothing enforces. The pinned client refuses BEFORE the wire; fieldd
    // classifies that refusal like any other capability floor — unsupported,
    // non-retryable (no amount of retrying teaches an old floor a new field).
    const floor = await startFakeFloor({ protocolMinor: 14 });
    const service = new TerminalService({
      link: {
        subscribe: async () => ({ snapshot: {} }),
        terminalEndpoints: floor.endpoints,
        on: () => undefined,
      },
    });
    cleanup.push(() => service.dispose());
    const error = (await service.create({ workloadClass: "agent" }).then(
      () => undefined,
      (e: unknown) => e,
    )) as RpcCallError | undefined;
    expect(error?.kind).toBe("UNAVAILABLE");
    expect(error?.details).toMatchObject({ state: "unsupported" });
    expect(error?.retryable).toBe(false);
    expect(floor.createOptions(), "refused before the wire").toBeUndefined();
    // an UNCLASSED create keeps working against the same old floor — the
    // G16 acceptance's compatibility half
    const created = await service.create({});
    expect(created.sessionId).toBe(floor.createdSessionId);
  });

  it("classifies typed spawn refusals by code, never by string (G17)", async () => {
    // All four rows carry the SAME byte-identical message — the string that
    // used to be the whole wire. What separates them now is upstream's stable
    // `code`, typed at the failure site. The unknown-code row is the honesty
    // fence: upstream's vocabulary can grow, and a code this seam does not
    // know must refuse the caller's-input claim rather than guess blame.
    for (const [meta, kind, state, retryable] of [
      [
        { stage: "spawn", code: "file-descriptor-exhausted", osError: 24 },
        "RESOURCE_EXHAUSTED",
        "fd_pressure",
        false,
      ],
      [{ stage: "spawn", code: "executable-not-found", osError: 2 }, "NOT_FOUND", undefined, false],
      [
        { stage: "spawn", code: "permission-denied", osError: 13 },
        "PRECONDITION_FAILED",
        undefined,
        false,
      ],
      [{ stage: "spawn", code: "resource-exhausted", osError: 12 }, "INTERNAL", undefined, true],
    ] as const) {
      const floor = await startFakeFloor({
        createError: "failed to spawn PTY command",
        createErrorMeta: meta,
      });
      const service = new TerminalService({
        link: {
          subscribe: async () => ({ snapshot: {} }),
          terminalEndpoints: floor.endpoints,
          on: () => undefined,
        },
      });
      cleanup.push(() => service.dispose());
      const error = (await service.create({}).then(
        () => undefined,
        (e: unknown) => e,
      )) as RpcCallError | undefined;
      expect(error?.kind, meta.code).toBe(kind);
      if (state !== undefined) expect(error?.details, meta.code).toMatchObject({ state });
      expect(error?.retryable, meta.code).toBe(retryable);
    }
  });

  it("stage fences the openpty errno read — spawn prose cannot borrow it (G17)", async () => {
    // portable-pty still stringifies the errno inside openpty() (the
    // petition's negotiated exception), so that stage classifies by message —
    // but ONLY under its own stage. The same errno prose arriving under
    // stage:"spawn" with no typed code must not read as openpty pressure.
    const errnoProse =
      'failed to openpty: Os { code: 24, kind: Uncategorized, message: "Too many open files" }';
    for (const [stage, kind, state] of [
      ["openpty", "RESOURCE_EXHAUSTED", "fd_pressure"],
      ["spawn", "INTERNAL", undefined],
    ] as const) {
      const floor = await startFakeFloor({
        createError: errnoProse,
        createErrorMeta: { stage },
      });
      const service = new TerminalService({
        link: {
          subscribe: async () => ({ snapshot: {} }),
          terminalEndpoints: floor.endpoints,
          on: () => undefined,
        },
      });
      cleanup.push(() => service.dispose());
      const error = (await service.create({}).then(
        () => undefined,
        (e: unknown) => e,
      )) as RpcCallError | undefined;
      expect(error?.kind, stage).toBe(kind);
      if (state !== undefined) expect(error?.details, stage).toMatchObject({ state });
    }
  });

  it("a create during the cell's birth waits for the endpoints, never refuses early (TC-S2)", async () => {
    // The engine is being spawned: endpoints are ABSENT at call time and land
    // moments later (the routes delta after the cell's hello). The create must
    // ride the birth wait onto the fresh endpoints — an UNAVAILABLE here would
    // teach every fresh boot's first create to fail.
    const floor = await startFakeFloor();
    let endpoints: TerminalEndpoints | undefined;
    const listeners: Array<() => void> = [];
    const service = new TerminalService({
      link: {
        subscribe: async () => ({ snapshot: {} }),
        get terminalEndpoints() {
          return endpoints;
        },
        // The evidence the wait keys on: the floor SPEAKS routes (an empty
        // pre-first-cell snapshot), so absence means "coming", not "never".
        terminalRoutes: { revision: 1, cells: [] },
        on: (_event: "terminal-endpoints", fn: () => void) => listeners.push(fn),
      },
    });
    cleanup.push(() => service.dispose());
    const create = service.create({});
    // the birth: endpoints arrive 50ms after the call
    await new Promise((r) => setTimeout(r, 50));
    endpoints = floor.endpoints;
    for (const fn of listeners) fn();
    const created = await create;
    expect(created.sessionId).toBe(floor.createdSessionId);
  });

  it("a floor too old for config documents says unsupported, not INTERNAL (GT-5b)", async () => {
    // Distinct from `no-overlay`: that is the SERVICE refusing a document it
    // was never pointed at, and this is the pinned CLIENT refusing to ask a
    // daemon below protocol 1.11 at all. The comment on the classifier already
    // promised honesty for "an older field-native"; only the other shape was
    // matched, so this one landed as a bug in us.
    const floor = await startFakeFloor({ protocolMinor: 10 });
    const service = new TerminalService({
      link: {
        subscribe: async () => ({ snapshot: {} }),
        terminalEndpoints: floor.endpoints,
        on: () => undefined,
      },
    });
    cleanup.push(() => service.dispose());
    const error = (await service.readConfig().then(
      () => undefined,
      (e: unknown) => e,
    )) as RpcCallError | undefined;
    expect(error?.kind).toBe("UNAVAILABLE");
    expect(error?.details).toMatchObject({ state: "unsupported" });
    expect(error?.retryable, "no amount of asking teaches an old daemon a new command").toBe(false);
  });

  it("builds one control client for concurrent callers (GT-5b)", async () => {
    // No in-flight guard, two concurrent calls each built AND connected a
    // client; the loser was never disposed, because its close handler checks
    // `this.client === client`, and it stayed authenticated on the floor's
    // control socket until the process exited. `ensureStarted` has exactly this
    // guard; this path did not.
    const floor = await startFakeFloor();
    const service = new TerminalService({
      link: {
        subscribe: async () => ({ snapshot: {} }),
        terminalEndpoints: floor.endpoints,
        on: () => undefined,
      },
    });
    cleanup.push(() => service.dispose());

    await Promise.all([
      service.readConfig(),
      service.readConfig(),
      service.readConfig(),
      service.readConfig(),
    ]);
    expect(floor.connections()).toBe(1);
  });

  it("a write that cannot read first fails as a WRITE (GT-5b)", async () => {
    // The pre-read is an implementation detail of the write. Reporting
    // "config read failed" told an editor that its read had failed when
    // nothing it did was a read.
    const floor = await startFakeFloor({ stall: ["get-config"] });
    const service = new TerminalService({
      link: {
        subscribe: async () => ({ snapshot: {} }),
        terminalEndpoints: floor.endpoints,
        on: () => undefined,
      },
      requestTimeoutMs: 300,
    });
    cleanup.push(() => service.dispose());
    const error = (await service.writeConfig("x", "rev-empty").then(
      () => undefined,
      (e: unknown) => e,
    )) as RpcCallError | undefined;
    expect(error?.message, "the operation named is the one the caller asked for").not.toContain(
      "config read",
    );
    // this particular stall is also a timeout, so it classifies as one
    expect(error?.kind).toBe("UNAVAILABLE");
    expect(error?.details).toMatchObject({ state: "unresponsive" });
  }, 20_000);

  it("audits config bytes as BYTES, not UTF-16 code units (GT-5b)", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const floor = await startFakeFloor();
    mock.helloTerminal = floor.endpoints;
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["settings.manage"], "bytes-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);
    const before = TerminalConfigDocument.parse(await rpc.call("terminal.config.read", {}));
    // one 4-byte character: `.length` counts it as 2
    const text = "# 🌱\n";
    await rpc.call("terminal.config.write", { text, revision: before.revision });

    const attempt = (await readAuditRecords(dataDir)).find(
      (r) => r.action === "terminal.config.write" && r.phase === "attempt",
    );
    expect(attempt?.attrs?.["bytes"]).toBe(Buffer.byteLength(text, "utf8"));
    expect(attempt?.attrs?.["bytes"]).not.toBe(text.length);
  });

  it("flips the terminalHost capability with the hello (D31 honesty)", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS;
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["workspace.read"], "roster");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);
    const res = (await rpc.call("device.list", {})) as { devices: DeviceInfo[] };
    const self = res.devices.find((d) => d.self);
    expect(self?.capabilities.terminalHost).toBe(true);
  });
});

describe("GT-2d — the adopted floor is named in health", () => {
  it("carries the hello ack's build through to system.health", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloNativeBuild = "field-native/0.1.0+dev-4f3a91c07b2e5d68a1c40b93";
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    expect(daemon.native.nativeBuild).toBe("field-native/0.1.0+dev-4f3a91c07b2e5d68a1c40b93");
    expect(daemon.health().nativeBuild).toBe("field-native/0.1.0+dev-4f3a91c07b2e5d68a1c40b93");
  });

  it("reports a floor that did not say as null, never as a guess", async () => {
    const dataDir = makeDataDir();
    await startMock(dataDir); // a pre-GT-2d native: the ack has no build label
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const health = daemon.health();
    expect(health.nativeConnected).toBe(true);
    expect(health.nativeBuild).toBeNull();
  });
});

describe("TC-D15 — the routes consumer (TC-S2)", () => {
  it("names every session a replaced engine took, with the S2 ceiling stated", async () => {
    // The receipt exists because this is the ONE moment the loss is knowable:
    // the observed stream repairs the inventory a beat later, and no snapshot
    // after that can say WHICH sessions the replacement took. It is a log and
    // not an audit record deliberately — the audit surface is caller-scoped and
    // this is the floor's news, arriving on an event with no caller behind it.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.terminalRoutes = cellRoutes(1, "cell-a", ENDPOINTS);
    mock.observedState = observed([{ sessionId: "s1" }, { sessionId: "s2" }]);
    const link = await connectedLink(dataDir, mock);
    const logs: CapturedLog[] = [];
    const service = new TerminalService({ link, logger: captureLogger(logs) });
    cleanup.push(() => service.dispose());
    await service.ensureStarted();
    expect(service.list().map((t) => t.sessionId)).toEqual(["s1", "s2"]);

    mock.pushRoutesDelta(cellRoutes(2, "cell-b", { ...ENDPOINTS, authToken: "cell-b-token" }));
    const receipt = await poll(async () =>
      logs.find((entry) => entry.event === "fieldd.terminal.cell_replaced"),
    );

    expect(receipt.attrs?.["lostSessionIds"], "every session, named").toEqual(["s1", "s2"]);
    // TC-S3 flipped the SUBJECT of the receipt from the replacement to the cell
    // that vanished: with K cells a change is a diff and there is no single
    // "replacement" to name, while the loss is always some particular row's.
    // A pre-TC-S3 floor's single class-less cell is still counted whole — its
    // inventory carries no `cell` tag to join on.
    expect(receipt.attrs?.["cellBootId"], "the cell that died, not the one that took over").toBe(
      "cell-a",
    );
    expect(receipt.attrs?.["revision"]).toBe(2);
    expect(receipt.message).toContain("a terminal-engine crash loses only its class");
  });

  it("stays silent when there is nothing it can honestly claim was lost", async () => {
    // Two silences, both load-bearing. An EMPTY inventory lost nothing. And an
    // ABSENT reading — the link down, or a floor that never speaks routes — is
    // not evidence of loss at all: a dead mgmt connection kills no PTYs.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.terminalRoutes = cellRoutes(1, "cell-a", ENDPOINTS);
    mock.observedState = observed([]);
    const link = await connectedLink(dataDir, mock);
    const logs: CapturedLog[] = [];
    const service = new TerminalService({ link, logger: captureLogger(logs) });
    cleanup.push(() => service.dispose());
    await service.ensureStarted();

    mock.pushRoutesDelta(cellRoutes(2, "cell-b", ENDPOINTS));
    await poll(async () =>
      link.terminalRoutes?.cells[0]?.cellBootId === "cell-b" ? true : undefined,
    );
    expect(logs.filter((entry) => entry.event === "fieldd.terminal.cell_replaced")).toEqual([]);

    // and the link dropping — the floor's coordinates gone, not replaced —
    // stays silent too, with two sessions in the inventory this time
    mock.pushObserved(observed([{ sessionId: "s1" }, { sessionId: "s2" }]));
    await poll(async () => (service.list().length === 2 ? true : undefined));
    mock.killClients();
    await new Promise((r) => setTimeout(r, 200));
    expect(logs.filter((entry) => entry.event === "fieldd.terminal.cell_replaced")).toEqual([]);
  }, 20_000);

  it("the next create dials the replacement cell, never the dead one", async () => {
    // The consumer half of the drop: TerminalService caches one control client
    // per floor, and a route change invalidates it wholesale. Both fakes mint
    // the same `fake-token`, which makes this row sharper than production —
    // a real replacement rotates the token, so here the IDENTITY change alone
    // has to be what forces the redial.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const cellA = await startFakeFloor();
    const cellB = await startFakeFloor();
    mock.terminalRoutes = cellRoutes(1, "cell-a", cellA.endpoints);
    mock.observedState = observed([]);
    const link = await connectedLink(dataDir, mock);
    const service = new TerminalService({ link });
    cleanup.push(() => service.dispose());

    await service.create({});
    expect(cellA.connections()).toBe(1);

    mock.pushRoutesDelta(cellRoutes(2, "cell-b", cellB.endpoints));
    await poll(async () =>
      link.terminalEndpoints?.controlSocket === cellB.endpoints.controlSocket ? true : undefined,
    );
    await service.create({});
    expect(cellB.connections(), "the live cell answered").toBe(1);
    expect(cellA.connections(), "the dead cell is never dialed again").toBe(1);
  });

  it("a floor with NO cell up refuses create honestly — a known state, not a blank", async () => {
    // Empty `cells` is a reading: the floor is paired and answering, and it has
    // no engine right now. The product door must refuse UNAVAILABLE/absent
    // rather than pretend to a floor, and the daemon must still be able to say
    // which revision it is refusing from.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.terminalRoutes = { revision: 3, cells: [] };
    mock.observedState = observed([]);
    // Empty cells IS the birth-window shape (TC-S2's wait applies) — the row
    // asserts the EVENTUAL honest refusal, on a test-sized budget.
    const daemon = await bootstrap({
      dataDir,
      controlPort: 0,
      dataPort: 0,
      terminalBirthWaitMs: 100,
    });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "empty-cells-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const err = await rpc.callErr("terminal.create", {});
    expect(err.data?.kind).toBe("UNAVAILABLE");
    expect((err.data?.details as { state?: string } | undefined)?.state).toBe("absent");
    expect(daemon.native.terminalEndpoints).toBeUndefined();
    expect(daemon.native.terminalRoutes?.revision, "the floor's own word for it").toBe(3);
  });

  it("keeps the pre-TC-S2 floor's endpoints working from the legacy mirror", async () => {
    // The compatibility floor, asserted at the product door rather than at the
    // link: a floor that sends only `terminal` must mint tickets exactly as it
    // did before routes existed.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS; // and no terminalRoutes: a pre-TC-S2 floor
    mock.observedState = observed([{ sessionId: "s1" }]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "legacy-mirror-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const ticket = (await rpc.call("terminal.openTicket", { sessionId: "s1" })) as TerminalTicket;
    expect(ticket.token).toBe(ENDPOINTS.authToken);
    expect(
      daemon.native.terminalRoutes,
      "it never claimed a snapshot it did not get",
    ).toBeUndefined();
  });
});

describe("TC-S3 — class cells (K=2) and solo isolation", () => {
  it("routes create by workload class, and answers with the cell that took it", async () => {
    // The placement half of TC-D4: the class picks the CELL, so an agent birth
    // cannot land in the pane deck's engine and take it down with it.
    const interactive = await startFakeFloor();
    const agent = await startFakeFloor();
    const routed = routedLink(
      classRoutes(1, [
        {
          cellInstanceId: 1,
          cellBootId: "cell-i",
          endpoints: interactive.endpoints,
          workloadClass: "interactive",
          role: "class",
        },
        {
          cellInstanceId: 2,
          cellBootId: "cell-a",
          endpoints: agent.endpoints,
          workloadClass: "agent",
          role: "class",
        },
      ]),
    );
    const service = new TerminalService({ link: routed.link });
    cleanup.push(() => service.dispose());

    const born = await service.create({ workloadClass: "agent" });
    expect(born.cellBootId, "the cell that took it, for the daemon's nested mint").toBe("cell-a");
    expect(agent.connections()).toBe(1);
    expect(interactive.connections(), "the interactive cell was never dialed").toBe(0);
    // the class still selects the scrollback cap it selected before TC-S3 —
    // placement is the NEW meaning of the field, not a replacement for the old
    expect(agent.createOptions()?.["scrollbackBytes"]).toBe(TERMINAL_SCROLLBACK_CLASS_BYTES.AGENT);

    // and the routing default is the contract's tolerant-reader default: an
    // undeclared class is interactive, so an unchanged caller lands where it
    // always did
    const plain = await service.create({});
    expect(plain.cellBootId).toBe("cell-i");
    expect(interactive.connections()).toBe(1);
    expect(agent.connections(), "one connection per cell, both still live").toBe(1);
  });

  it("targets the class row, else the NEWEST solo cell", async () => {
    // Spawn isolation (TC-D4): the floor spawns a fresh empty solo the moment
    // the previous one takes a session, so the HIGHEST instance is the empty
    // one. There is no agent CLASS row here — that is the state a recurring
    // poison workload puts the floor in, and every agent birth is isolated.
    // The rows are listed newest-first so array order cannot explain the pick.
    const filled = await startFakeFloor();
    const empty = await startFakeFloor();
    const interactive = await startFakeFloor();
    const routed = routedLink(
      classRoutes(9, [
        {
          cellInstanceId: 7,
          cellBootId: "solo-7",
          endpoints: empty.endpoints,
          workloadClass: "agent",
          role: "solo",
        },
        {
          cellInstanceId: 5,
          cellBootId: "solo-5",
          endpoints: filled.endpoints,
          workloadClass: "agent",
          role: "solo",
        },
        {
          cellInstanceId: 1,
          cellBootId: "cell-i",
          endpoints: interactive.endpoints,
          workloadClass: "interactive",
          role: "class",
        },
      ]),
    );
    const service = new TerminalService({ link: routed.link });
    cleanup.push(() => service.dispose());

    const born = await service.create({ workloadClass: "agent" });
    expect(born.cellBootId).toBe("solo-7");
    expect(empty.connections()).toBe(1);
    expect(filled.connections(), "a filled solo cell is never a create target again").toBe(0);
    expect(interactive.connections(), "and an agent birth never crosses into the deck").toBe(0);
  });

  it("mints a session's ticket from ITS cell, never from the create target", async () => {
    // The routing half a create-target rule cannot answer: an EXISTING session
    // lives where it was born, and the inventory's `cell` tag is the only join
    // that says where. A ticket from the wrong cell is a credential for a
    // socket that has never heard of the session.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.terminalRoutes = classRoutes(1, [
      {
        cellInstanceId: 1,
        cellBootId: "cell-i",
        endpoints: paperEndpoints("interactive"),
        workloadClass: "interactive",
        role: "class",
      },
      {
        cellInstanceId: 2,
        cellBootId: "cell-a",
        endpoints: paperEndpoints("agent"),
        workloadClass: "agent",
        role: "class",
      },
    ]);
    mock.observedState = observed([
      { sessionId: "pane-1", cell: cellTag(1, "cell-i", "interactive") },
      { sessionId: "agent-1", cell: cellTag(2, "cell-a", "agent") },
    ]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "cell-ticket-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const pane = (await rpc.call("terminal.openTicket", { sessionId: "pane-1" })) as TerminalTicket;
    const agent = (await rpc.call("terminal.openTicket", {
      sessionId: "agent-1",
    })) as TerminalTicket;
    expect(pane).toMatchObject(paperTicket("interactive"));
    expect(agent).toMatchObject(paperTicket("agent"));

    // and the SESSIONLESS mint stays the deck's door: the interactive cell
    const connect = TerminalConnectTicketResult.parse(await rpc.call("terminal.connectTicket", {}));
    expect(connect.ticket).toMatchObject(paperTicket("interactive"));
  });

  it("a session whose cell is gone is cell_gone, never another cell's socket", async () => {
    // The beat between a cell's death and the observed stream repairing the
    // inventory: fieldd still holds a row for a session whose cell has left the
    // snapshot. Minting the surviving cell's coordinates there would hand out a
    // credential for a socket that never had this session; refusing is the
    // honest state, and retryable because the inventory is about to say so.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.terminalRoutes = classRoutes(4, [
      {
        cellInstanceId: 1,
        cellBootId: "cell-i",
        endpoints: paperEndpoints("interactive"),
        workloadClass: "interactive",
        role: "class",
      },
    ]);
    mock.observedState = observed([
      { sessionId: "pane-1", cell: cellTag(1, "cell-i", "interactive") },
      { sessionId: "agent-1", cell: cellTag(2, "cell-a", "agent") },
    ]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "cell-gone-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const err = await rpc.callErr("terminal.openTicket", { sessionId: "agent-1" });
    expect(err.data?.kind).toBe("UNAVAILABLE");
    expect((err.data?.details as { state?: string } | undefined)?.state).toBe("cell_gone");
    expect(err.data?.retryable, "the inventory is a beat behind, not wrong forever").toBe(true);
    // the LIVE cell's session is unaffected — the refusal is this cell's, not the floor's
    const pane = (await rpc.call("terminal.openTicket", { sessionId: "pane-1" })) as TerminalTicket;
    expect(pane).toMatchObject(paperTicket("interactive"));
  });

  it("counts the blast per cell: the receipt names only the dead cell's sessions", async () => {
    // "A terminal-engine crash loses only its class", made countable. Before
    // TC-S3 any route change counted EVERY session as lost, which was true of a
    // one-cell floor and is a lie about a K=2 one: the interactive panes are
    // still running while the agent cell is respawning.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const cells = (revision: number, agentBootId: string): TerminalRouteSnapshot =>
      classRoutes(revision, [
        {
          cellInstanceId: 1,
          cellBootId: "cell-i",
          endpoints: paperEndpoints("interactive"),
          workloadClass: "interactive",
          role: "class",
        },
        {
          cellInstanceId: revision + 1,
          cellBootId: agentBootId,
          endpoints: paperEndpoints(agentBootId),
          workloadClass: "agent",
          role: "class",
        },
      ]);
    mock.terminalRoutes = cells(1, "cell-a");
    mock.observedState = observed([
      { sessionId: "pane-1", cell: cellTag(1, "cell-i", "interactive") },
      { sessionId: "agent-1", cell: cellTag(2, "cell-a", "agent") },
      { sessionId: "agent-2", cell: cellTag(2, "cell-a", "agent") },
    ]);
    const link = await connectedLink(dataDir, mock);
    const logs: CapturedLog[] = [];
    const service = new TerminalService({ link, logger: captureLogger(logs) });
    cleanup.push(() => service.dispose());
    await service.ensureStarted();
    expect(service.list()).toHaveLength(3);

    mock.pushRoutesDelta(cells(2, "cell-a2"));
    const receipts = await poll(async () => {
      const found = logs.filter((entry) => entry.event === "fieldd.terminal.cell_replaced");
      return found.length > 0 ? found : undefined;
    });

    expect(receipts, "one receipt, for the one cell that died").toHaveLength(1);
    expect(
      receipts[0]?.attrs?.["lostSessionIds"],
      "the agent cell's sessions, and only those",
    ).toEqual(["agent-1", "agent-2"]);
    expect(receipts[0]?.attrs?.["lostSessions"]).toBe(2);
    expect(receipts[0]?.attrs?.["cellBootId"]).toBe("cell-a");
    expect(receipts[0]?.attrs?.["workloadClass"]).toBe("agent");
    expect(receipts[0]?.attrs?.["role"]).toBe("class");
    expect(receipts[0]?.attrs?.["revision"]).toBe(2);
  });

  it("a cell that vanishes with no replacement is still counted", async () => {
    // The death and the respawn are two readings, and the first one is where
    // the loss is knowable: the floor drops the row the moment the cell dies
    // and publishes the replacement a beat later. Counting only replacements
    // would make the receipt depend on how fast the supervisor is.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const interactiveRow = {
      cellInstanceId: 1,
      cellBootId: "cell-i",
      endpoints: paperEndpoints("interactive"),
      workloadClass: "interactive" as const,
      role: "class" as const,
    };
    mock.terminalRoutes = classRoutes(1, [
      interactiveRow,
      {
        cellInstanceId: 2,
        cellBootId: "cell-a",
        endpoints: paperEndpoints("agent"),
        workloadClass: "agent",
        role: "class",
      },
    ]);
    mock.observedState = observed([
      { sessionId: "pane-1", cell: cellTag(1, "cell-i", "interactive") },
      { sessionId: "agent-1", cell: cellTag(2, "cell-a", "agent") },
    ]);
    const link = await connectedLink(dataDir, mock);
    const logs: CapturedLog[] = [];
    const service = new TerminalService({ link, logger: captureLogger(logs) });
    cleanup.push(() => service.dispose());
    await service.ensureStarted();

    mock.pushRoutesDelta(classRoutes(2, [interactiveRow]));
    const receipt = await poll(async () =>
      logs.find((entry) => entry.event === "fieldd.terminal.cell_replaced"),
    );
    expect(receipt.attrs?.["cellBootId"]).toBe("cell-a");
    expect(receipt.attrs?.["lostSessionIds"]).toEqual(["agent-1"]);
  });

  it("drops the dead cell's control client and keeps the live cell's", async () => {
    // The connection half of the same law (GT-5b per cell). A wholesale drop
    // would make fieldd's own control connections the blast radius the cells
    // exist to bound: the interactive cell is up, authenticated, and holding
    // live sessions while the agent cell is being replaced.
    const interactive = await startFakeFloor();
    const agentOld = await startFakeFloor();
    const agentNew = await startFakeFloor();
    const cells = (revision: number, agent: { bootId: string; endpoints: TerminalEndpoints }) =>
      classRoutes(revision, [
        {
          cellInstanceId: 1,
          cellBootId: "cell-i",
          endpoints: interactive.endpoints,
          workloadClass: "interactive",
          role: "class",
        },
        {
          cellInstanceId: revision + 1,
          cellBootId: agent.bootId,
          endpoints: agent.endpoints,
          workloadClass: "agent",
          role: "class",
        },
      ]);
    const routed = routedLink(cells(1, { bootId: "cell-a", endpoints: agentOld.endpoints }));
    const service = new TerminalService({ link: routed.link });
    cleanup.push(() => service.dispose());

    await service.create({});
    await service.create({ workloadClass: "agent" });
    expect([interactive.connections(), agentOld.connections()]).toEqual([1, 1]);

    routed.move(cells(2, { bootId: "cell-a2", endpoints: agentNew.endpoints }));
    await service.create({ workloadClass: "agent" });
    await service.create({});

    expect(agentNew.connections(), "the replacement answered").toBe(1);
    expect(agentOld.connections(), "the dead cell is never dialed again").toBe(1);
    expect(interactive.connections(), "the survivor kept the connection it had").toBe(1);
  });

  it("a pre-TC-S3 floor routes every class to its single cell", async () => {
    // The compatibility floor for placement: a snapshot whose rows declare no
    // class is a floor that has one cell for everything, and a declared class
    // must not turn that into a refusal.
    const floor = await startFakeFloor();
    const routed = routedLink(cellRoutes(1, "cell-only", floor.endpoints));
    const service = new TerminalService({ link: routed.link });
    cleanup.push(() => service.dispose());

    expect((await service.create({ workloadClass: "agent" })).cellBootId).toBe("cell-only");
    expect((await service.create({ workloadClass: "interactive" })).cellBootId).toBe("cell-only");
    expect((await service.create({})).cellBootId).toBe("cell-only");
    expect(floor.connections(), "one cell, one control connection").toBe(1);
  });

  it("a class with no cell of its own lands on the interactive one after the birth budget", async () => {
    // A floor that publishes an interactive cell and no agent one: the class
    // waits out the birth budget for its OWN cell (someone else's news is not
    // the arrival this caller is waiting for), then lands honestly rather than
    // refusing a floor that can host the session. Class is a placement hint and
    // a policy selector, never a permanent failure domain (TC-D4).
    const interactive = await startFakeFloor();
    const routed = routedLink(
      classRoutes(1, [
        {
          cellInstanceId: 1,
          cellBootId: "cell-i",
          endpoints: interactive.endpoints,
          workloadClass: "interactive",
          role: "class",
        },
      ]),
    );
    const service = new TerminalService({ link: routed.link, birthWaitMs: 100 });
    cleanup.push(() => service.dispose());

    const started = Date.now();
    const born = await service.create({ workloadClass: "agent" });
    expect(born.cellBootId).toBe("cell-i");
    expect(
      Date.now() - started,
      "it waited for the agent cell before falling back",
    ).toBeGreaterThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// TP-S1 — the session-addressed grant model over the product API
// (terminal-pipeline-v3 §5.1, §15 row S1): the route + grants ride beside the
// legacy ticket when the cell carries a grant key, bound to the CALLER's
// principal and signed with THAT cell's key; renewAttach is a CAS; the roster
// carries no placement; a keyless floor stays the legacy trio and says so.

const KEY_I = "5e".repeat(32);
const KEY_A = "a1".repeat(32);

function keyedRoutes(
  revision: number,
  cells: Array<{
    cellInstanceId: number;
    cellBootId: string;
    endpoints: TerminalEndpoints;
    workloadClass?: TerminalWorkloadClass;
    role?: "class" | "solo";
    grantKey?: string;
  }>,
): TerminalRouteSnapshot {
  const snapshot = classRoutes(revision, cells);
  return {
    ...snapshot,
    cells: snapshot.cells.map((row, i) => {
      const key = cells[i]?.grantKey;
      return key === undefined ? row : { ...row, grantKey: key, grantKeyGeneration: 1 };
    }),
  };
}

/** The cell's verification, replayed here: HMAC-SHA256 over the contracts'
 * canonical signing input with the route row's key. */
function verifies(
  keyHex: string,
  grant: { protected: unknown; claims: unknown; mac: string },
): boolean {
  const mac = createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(grantSigningInput(grant.protected as never, grant.claims), "utf8")
    .digest("base64url");
  return mac === grant.mac;
}

async function keyedDaemon() {
  const dataDir = makeDataDir();
  const mock = await startMock(dataDir);
  mock.terminalRoutes = keyedRoutes(3, [
    {
      cellInstanceId: 1,
      cellBootId: "cell-i",
      endpoints: paperEndpoints("interactive"),
      workloadClass: "interactive",
      role: "class",
      grantKey: KEY_I,
    },
    {
      cellInstanceId: 2,
      cellBootId: "cell-a",
      endpoints: paperEndpoints("agent"),
      workloadClass: "agent",
      role: "class",
      grantKey: KEY_A,
    },
  ]);
  mock.observedState = observed([
    { sessionId: "pane-1", title: "zsh", cell: cellTag(1, "cell-i", "interactive") },
    { sessionId: "agent-1", cell: cellTag(2, "cell-a", "agent") },
  ]);
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  const grant = daemon.tokens.mint(["terminal.attach"], "tp-s1-test");
  const rpc = await openRpc(daemon.controlPort);
  await helloAs(rpc, grant.token);
  return { dataDir, mock, daemon, rpc, grant };
}

describe("TP-S1 — the session-addressed grant model", () => {
  it("mints the route + grants beside the legacy trio, signed by the session's OWN cell key", async () => {
    const { rpc } = await keyedDaemon();
    const pane = TerminalOpenTicketResult.parse(
      await rpc.call("terminal.openTicket", { sessionId: "pane-1" }),
    );
    // the legacy trio is untouched — the bridge keeps dialing it until S3e
    expect(pane).toMatchObject(paperTicket("interactive"));
    // the v2 half, bound and signed
    expect(pane.route).toEqual({ cellBootId: "cell-i", routeRevision: 3 });
    expect(pane.endpoints).toBeUndefined(); // no T1 doors before S3a
    expect(verifies(KEY_I, pane.transportGrant)).toBe(true);
    expect(verifies(KEY_I, pane.attachGrant)).toBe(true);
    expect(verifies(KEY_A, pane.attachGrant)).toBe(false);
    expect(pane.transportGrant.protected.kid).toEqual({ cellBootId: "cell-i", keyGeneration: 1 });
    expect(pane.transportGrant.claims).toMatchObject({
      audienceCellBootId: "cell-i",
      allowedChannels: ["control", "frames"],
      transportGrantGeneration: 1,
    });
    expect(pane.transportGrant.claims.clientId).toMatch(/^local-token:/);
    expect(pane.attachGrant.claims).toMatchObject({
      audienceCellBootId: "cell-i",
      sessionId: "pane-1",
      routeRevision: 3,
      grantGeneration: 1,
      rights: ["geometry", "input", "read"],
    });
    expect(pane.attachGrant.claims.clientId).toBe(pane.transportGrant.claims.clientId);
    // the agent session's ticket comes from ITS cell and ITS key
    const agent = TerminalOpenTicketResult.parse(
      await rpc.call("terminal.openTicket", { sessionId: "agent-1" }),
    );
    expect(agent).toMatchObject(paperTicket("agent"));
    expect(agent.route.cellBootId).toBe("cell-a");
    expect(verifies(KEY_A, agent.attachGrant)).toBe(true);
    expect(verifies(KEY_I, agent.attachGrant)).toBe(false);
    expect(agent.transportGrant.claims.connectionSetId).not.toBe(
      pane.transportGrant.claims.connectionSetId,
    );
    // generations are per {client, cell} and per {client, session}: both start at 1 here
    expect(agent.transportGrant.claims.transportGrantGeneration).toBe(1);
    expect(agent.attachGrant.claims.grantGeneration).toBe(1);
  });

  it("every openTicket carries a FRESH transport grant; the connection set is stable; generations climb", async () => {
    const { rpc } = await keyedDaemon();
    const first = TerminalOpenTicketResult.parse(
      await rpc.call("terminal.openTicket", { sessionId: "pane-1" }),
    );
    const second = TerminalOpenTicketResult.parse(
      await rpc.call("terminal.openTicket", { sessionId: "pane-1" }),
    );
    expect(second.transportGrant.claims.connectionSetId).toBe(
      first.transportGrant.claims.connectionSetId,
    );
    expect(second.transportGrant.claims.transportGrantGeneration).toBe(2);
    expect(second.transportGrant.claims.nonce).not.toBe(first.transportGrant.claims.nonce);
    expect(second.attachGrant.claims.grantGeneration).toBe(2);
    expect(second.transportGrant.mac).not.toBe(first.transportGrant.mac);
  });

  it("renewAttach is a CAS on the held generation and idempotent by requestId", async () => {
    const { rpc, dataDir } = await keyedDaemon();
    const opened = TerminalOpenTicketResult.parse(
      await rpc.call("terminal.openTicket", { sessionId: "pane-1" }),
    );
    expect(opened.attachGrant.claims.grantGeneration).toBe(1);
    const renewed = (await rpc.call("terminal.renewAttach", {
      sessionId: "pane-1",
      expectGeneration: 1,
      requestId: "r-1",
    })) as { attachGrant: typeof opened.attachGrant };
    expect(renewed.attachGrant.claims.grantGeneration).toBe(2);
    expect(renewed.attachGrant.claims.clientId).toBe(opened.attachGrant.claims.clientId);
    expect(verifies(KEY_I, renewed.attachGrant)).toBe(true);
    const retried = (await rpc.call("terminal.renewAttach", {
      sessionId: "pane-1",
      expectGeneration: 1,
      requestId: "r-1",
    })) as { attachGrant: typeof opened.attachGrant };
    expect(retried.attachGrant.mac).toBe(renewed.attachGrant.mac);
    const stale = await rpc.callErr("terminal.renewAttach", {
      sessionId: "pane-1",
      expectGeneration: 1,
      requestId: "r-2",
    });
    expect(stale.data?.kind).toBe("CONFLICT");
    const ghost = await rpc.callErr("terminal.renewAttach", {
      sessionId: "ghost",
      expectGeneration: 0,
      requestId: "r-3",
    });
    expect(ghost.data?.kind).toBe("NOT_FOUND");
    const malformed = await rpc.callErr("terminal.renewAttach", { sessionId: "pane-1" });
    expect(malformed.data?.kind).toBe("PRECONDITION_FAILED");
    // every renewal is on the record beside the mints
    const actions = (await readAuditActions(dataDir)).filter((a) => a.startsWith("terminal."));
    expect(actions).toContain("terminal.attach.renew");
    expect(actions).toContain("terminal.ticket.mint");
  });

  it("create answers with the spread route + grants for the cell the session landed on", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const floor = await startFakeFloor();
    mock.terminalRoutes = keyedRoutes(9, [
      {
        cellInstanceId: 1,
        cellBootId: "cell-f",
        endpoints: floor.endpoints,
        workloadClass: "interactive",
        role: "class",
        grantKey: KEY_I,
      },
    ]);
    mock.observedState = observed([]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const grant = daemon.tokens.mint(["terminal.attach"], "tp-s1-create");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const created = TerminalCreateOpenResult.parse(await rpc.call("terminal.create", {}));
    expect(created.sessionId).toBe(floor.createdSessionId);
    expect(created.ticket).toMatchObject({
      controlSocket: floor.endpoints.controlSocket,
      frameSocket: floor.endpoints.frameSocket,
      token: floor.endpoints.authToken,
    });
    expect(created.route).toEqual({ cellBootId: "cell-f", routeRevision: 9 });
    expect(created.attachGrant.claims.sessionId).toBe(floor.createdSessionId);
    expect(verifies(KEY_I, created.attachGrant)).toBe(true);
    expect(verifies(KEY_I, created.transportGrant)).toBe(true);
  });

  it("a keyless floor answers the legacy trio ALONE and says grants are not landed", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.terminalRoutes = cellRoutes(1, "cell-old", paperEndpoints("old"));
    mock.observedState = observed([
      { sessionId: "s1", cell: cellTag(1, "cell-old", "interactive") },
    ]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const grant = daemon.tokens.mint(["terminal.attach"], "tp-s1-legacy");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const answer = await rpc.call("terminal.openTicket", { sessionId: "s1" });
    expect(TerminalOpenTicketResult.safeParse(answer).success).toBe(false);
    expect(TerminalTicket.safeParse(answer).success).toBe(true);
    expect(answer).toEqual(paperTicket("old")); // no half ticket — no route, no grants
    const renew = await rpc.callErr("terminal.renewAttach", {
      sessionId: "s1",
      expectGeneration: 0,
      requestId: "r-1",
    });
    expect(renew.data?.kind).toBe("UNAVAILABLE");
    expect((renew.data?.details as { state?: string } | undefined)?.state).toBe(
      "grants_not_landed",
    );
  });

  it("the roster projects id/class/health/title and NEVER placement; unobserved refuses", async () => {
    const { rpc } = await keyedDaemon();
    const roster = TerminalRosterResult.parse(await rpc.call("terminal.roster", {}));
    expect(roster.items).toEqual([
      { sessionId: "pane-1", workloadClass: "interactive", health: "live", title: "zsh" },
      { sessionId: "agent-1", workloadClass: "agent", health: "live" },
    ]);
    for (const item of roster.items) {
      expect("cell" in item).toBe(false);
      expect("cellBootId" in item).toBe(false);
    }
    expect(roster.observation).toBeDefined();
    // the transport-facing inventory still carries the cell tag — two projections
    const list = (await rpc.call("terminal.list", {})) as { terminals: TerminalInfo[] };
    expect(list.terminals[0]?.cell?.cellBootId).toBe("cell-i");

    // before the first observation the roster refuses exactly like list
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS;
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const grant = daemon.tokens.mint(["terminal.attach"], "tp-s1-unobserved");
    const cold = await openRpc(daemon.controlPort);
    await helloAs(cold, grant.token);
    const unobserved = await cold.callErr("terminal.roster", {});
    expect(unobserved.data?.kind).toBe("UNAVAILABLE");
    expect((unobserved.data?.details as { state?: string } | undefined)?.state).toBe("unobserved");
  });
});
