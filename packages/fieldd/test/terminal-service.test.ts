// TerminalService (NF-3/NF-6): the fieldd seam driven through the mock mgmt
// server (no cargo). Covers the NF-D8 endpoints capture from the hello ack,
// the D6 ticket (endpoints present/absent, both honest), the observed-
// inventory stream into terminal.list/get, the terminal.attach scope gate, the
// terminalHost capability flip, the NF-6 re-arm law (a failed observed
// subscribe neither fatals the boot nor stays dead forever), and the NF-6
// transport-death honesty law (a dead control socket is UNAVAILABLE, never the
// benign already-gone race). The live create/terminate/attach path needs a
// real PTY authority and lives in terminal-seam.test.ts.
import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CONTRACTS_VERSION,
  type DeviceInfo,
  ENV_PREFIXES,
  grantSigningInput,
  isPipeEndpoint,
  LAYOUT,
  METHODS,
  type Scope,
  SHELL_PROVIDER_METHODS,
  type ShellDialogPickFileResult,
  type ShellDialogSaveFileResult,
  ShellProviderCallParams,
  SOCKETS,
  TERMINAL_CONFIG_MAX_BYTES,
  TERMINAL_SCROLLBACK_CLASS_BYTES,
  TerminalBindingsFile,
  TerminalConfigConflict,
  TerminalConfigDocument,
  TerminalConfigExportResult,
  TerminalConfigImportResult,
  TerminalConfigRevealResult,
  TerminalConfigSnapshot,
  TerminalConfigValidation,
  TerminalConfigWriteRefusal,
  TerminalConfigWriteResult,
  TerminalCreateOpenResult,
  type TerminalCreateParams,
  type TerminalCreateResult,
  type TerminalEndpoints,
  type TerminalInfo,
  TerminalOpenTicketResult,
  TerminalRosterResult,
  type TerminalRouteSnapshot,
  TerminalRuntimeSessionsResult,
  type TerminalWorkloadClass,
} from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, NativeLink, RpcCallError } from "../src/index";
import { terminalCreateTarget } from "../src/native-link";
import { TerminalBindingStore } from "../src/terminal-bindings";
import {
  blockingConfigDiagnostics,
  projectConfigSnapshot,
  type TerminalConfigShell,
  type TerminalProfileBinding,
  TerminalService,
  type TerminalServiceOptions,
} from "../src/terminal-service";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productDoorPath } from "./link-fixture";
import { nativeEndpoint, shortTmpRoot } from "./native-harness";
import { helloAs, type RpcErrorShape, until, WsRpc } from "./ws-rpc";

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
  // Ghosttea/TRF1 handles are u64 decimal strings. A mnemonic fake used to be
  // tolerated only because no product boundary exposed the summary.
  handle: "1",
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

/** One loader diagnostic, in the protocol's own shape. */
interface FakeDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  source?: string;
  line?: number;
  key?: string;
}

/** GT-7 — what a fake LOADER says about a text in the overlay's place (every
 * load: the effective one, a dry run, a replace's reload). The default is
 * GT-3's case, now placed where the real loader places a bad line: an unknown
 * key is an error in the overlay itself, at its line. */
type FakeLoader = (contents: string, overlayPath: string) => FakeDiagnostic[];

const unknownKeyLoader: FakeLoader = (contents, overlayPath) =>
  contents.split("\n").flatMap((line, index) =>
    line.startsWith("nonsense-key")
      ? [
          {
            severity: "error" as const,
            code: "unknown-key",
            message: "unknown configuration key",
            source: overlayPath,
            line: index + 1,
            key: "nonsense-key",
          },
        ]
      : [],
  );

/** A revision the way the real floor mints one: a hash of the exact bytes, so
 * two different texts of one length never share it. */
const fakeRevision = (prefix: string, contents: string): string =>
  `${prefix}-${createHash("sha256").update(contents).digest("hex").slice(0, 12)}`;

/** A fake ghosttead control endpoint speaking just enough protocol: LE-u32
 * framing, bare-token auth → "ok", the hello, one create-session, and (GT-3)
 * the config-document trio (GT-7: with the dry run, and every command
 * recorded). Enough to exercise the product plane's
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
 * those before the wire). Default 16 — the 0.10.0 floor.
 * `loader` (GT-7) is what this floor's loader says about a text;
 * `concurrentWrite` lands another writer's text just before the first
 * replace is answered — the race an early revision check cannot close. */
async function startFakeFloor(
  opts: {
    dieOnTerminate?: boolean;
    noOverlay?: boolean;
    stall?: readonly string[];
    createError?: string;
    createErrorMeta?: { stage?: string; code?: string; osError?: number };
    /** MF-2c — what the automation arms answer instead of a result. The floor
     * resolves the session out of its registry FIRST, so both automation
     * messages fail with the same words when it is gone. */
    automationError?: string;
    protocolMinor?: number;
    loader?: FakeLoader;
    concurrentWrite?: string;
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
  /** GT-7 — every command this floor was sent, in order (the auth packet is
   * not a command) */
  commands: () => string[];
  /** AR-S4c — the floor's own exit fact for one session, to every connected client */
  exit: (sessionId: string) => void;
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
  const loader = opts.loader ?? unknownKeyLoader;
  // The effective configuration is LOADED, and kept: the text it was loaded
  // from and what the loader said then. A replace reloads it; nothing else
  // does, because the real floor watches no files — its `get-config` is a
  // snapshot as old as the last reload, and so is this one.
  let effectiveContents = "";
  let effectiveDiagnostics = loader(effectiveContents, document.path);
  let pendingConcurrentWrite = opts.concurrentWrite;
  const commands: string[] = [];
  /** the sessions THIS floor created — what its terminate recognizes */
  const born = new Set<string>();
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
        commands.push(String(msg.type));
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
          else {
            born.add(createdSessionId);
            reply({ type: "session-created", session: fakeSession(createdSessionId) });
          }
        } else if (
          (msg.type === "get-automation-state" || msg.type === "automation-input") &&
          opts.automationError !== undefined
        ) {
          reply({ type: "error", message: opts.automationError });
        } else if (msg.type === "get-automation-state") {
          reply({ type: "automation-state", sessionId: msg.sessionId, humanInputEpoch: 1 });
        } else if (msg.type === "automation-input") {
          // `reason` must be present and null: the protocol validator rejects
          // an absent one and the CLIENT destroys the socket over an invalid
          // event, which reads as "the floor died" rather than as a bad fake.
          reply({
            type: "automation-input-result",
            sessionId: msg.sessionId,
            accepted: true,
            humanInputEpoch: 1,
            inputSequence: 1,
            reason: null,
          });
        } else if (msg.type === "list-sessions") {
          reply({ type: "sessions", sessions: [fakeSession(createdSessionId)] });
        } else if (msg.type === "terminate" && opts.dieOnTerminate === true) {
          sock.destroy(); // the floor dies mid-call
        } else if (msg.type === "terminate") {
          // the real floor's answer for a session it never held (service.rs
          // `terminate` bails "unknown session"), so a misrouted terminate
          // reads here exactly as it does against a real cell
          if (born.has(String(msg.sessionId))) reply({ type: "ok" });
          else reply({ type: "error", message: "unknown session" });
        } else if (msg.type === "get-config") {
          reply({ type: "config", config: fakeConfig(configRevision, effectiveDiagnostics) });
        } else if (msg.type === "get-config-document") {
          if (opts.noOverlay === true) reply({ type: "error", message: NO_OVERLAY_MESSAGE });
          else reply({ type: "config-document", document: { schemaVersion: 1, ...document } });
        } else if (msg.type === "validate-config-document") {
          // The real floor loads the candidate in the overlay's place and
          // answers the revision the candidate WOULD have — not the saved one.
          if (opts.noOverlay === true) reply({ type: "error", message: NO_OVERLAY_MESSAGE });
          else
            reply({
              type: "config-document-validation",
              documentRevision: fakeRevision("rev", msg.contents),
              config: fakeConfig(
                msg.contents === effectiveContents
                  ? configRevision
                  : fakeRevision("config", msg.contents),
                loader(msg.contents, document.path),
              ),
            });
        } else if (msg.type === "replace-config-document") {
          if (pendingConcurrentWrite !== undefined) {
            // another writer wins the race to the file
            document.contents = pendingConcurrentWrite;
            document.revision = fakeRevision("rev", pendingConcurrentWrite);
            document.exists = true;
            pendingConcurrentWrite = undefined;
          }
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
            if (msg.contents !== effectiveContents)
              configRevision = fakeRevision("config", msg.contents);
            effectiveContents = msg.contents;
            effectiveDiagnostics = loader(msg.contents, document.path);
            document.contents = msg.contents;
            document.revision = fakeRevision("rev", msg.contents);
            document.exists = true;
            reply({
              type: "config-document-updated",
              document: { schemaVersion: 1, ...document },
              config: fakeConfig(configRevision, effectiveDiagnostics),
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
    commands: () => [...commands],
    exit: (sessionId: string): void => {
      const event = {
        requestId: 0,
        type: "session-exited",
        sessionId,
        exitCode: 0,
        exitSignal: null,
        requestedTermination: null,
        exitOutcome: "completed",
      };
      for (const sock of live) sock.write(packet(Buffer.from(JSON.stringify(event))));
    },
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
 * the case the panel has to show. Since GT-7 the diagnostics are the fake
 * LOADER's (`FakeLoader`), and they decide which saves are refused too. The
 * palette sits in both of its homes, as 0.11.1 sends it. */
const fakeConfig = (
  revision: string,
  diagnostics: FakeDiagnostic[] = [],
): Record<string, unknown> => ({
  schemaVersion: 1,
  revision,
  compatibility: { ghosttyVersion: "1.0.0", ghosttyCommit: "deadbeef", knownKeyCount: 1 },
  sources: [{ path: "/fake/config.ghostty", kind: "ghosttea-overlay" }],
  diagnostics,
  configuredKeys: [],
  terminal: {
    scrollbackBytes: 1024,
    foreground: [255, 255, 255],
    background: [0, 0, 0],
    cursor: [255, 255, 255],
    palette: [{ index: 1, color: [215, 0, 0] }],
  },
  renderer: {
    foreground: [255, 255, 255],
    background: [0, 0, 0],
    cursor: [255, 255, 255],
    selectionBackground: [255, 255, 255],
    selectionForeground: [0, 0, 0],
    palette: [{ index: 1, color: [215, 0, 0] }],
    fontSize: 13,
    fontFamilies: [],
    paddingX: [2, 2],
    paddingY: [2, 2],
    postProcess: "none",
    customShaderPaths: [],
  },
  workspace: {
    keybindings: [{ trigger: "super+k", action: "clear_screen" }],
    clearKeybindings: false,
  },
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

    // TP-S3e: a mirror-only floor mints no grants — the door refuses honestly
    // instead of handing out the UDS trio it used to
    const refused = await rpc.callErr("terminal.openTicket", { sessionId: "s1" });
    expect(refused.data?.kind).toBe("UNAVAILABLE");
    expect((refused.data?.details as { state?: string } | undefined)?.state).toBe(
      "grants_not_landed",
    );

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
      ["terminal.create", {}],
      ["terminal.terminate", { sessionId: "s1" }],
      ["terminal.config.read", {}],
      ["terminal.config.write", { text: "", revision: "rev" }],
      ["terminal.config.validate", { text: "" }],
      ["terminal.config.reveal", {}],
    ] as const) {
      const err = await rpc.callErr(method, params);
      expect(err.data?.kind, method).toBe("UNAVAILABLE");
    }
  });

  it("terminal.connectTicket is GONE (TP-S3e) — the retired door refuses and mints nothing", async () => {
    // GT-D10's sessionless mint fed the bridge; with the bridge retired the
    // method is UNREGISTERED. This row is the falsifiable half of "the old
    // door gone": re-registering it turns this red.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS;
    mock.observedState = observed([]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "terminal-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const err = await rpc.callErr("terminal.connectTicket", {});
    expect(err.data?.kind).toBe("NOT_FOUND");

    const list = (await rpc.call("terminal.list", {})) as { terminals: TerminalInfo[] };
    expect(list.terminals, "the refusal created nothing").toEqual([]);
    const records = (await readAuditRecords(dataDir)).filter((r) =>
      r.action.startsWith("terminal."),
    );
    expect(records, "a retired door writes no mint records").toEqual([]);
  });

  it("reads the floor's OWN already-gone words as the typed refusal, in both spellings", async () => {
    // MF-2c — the automation path's refusal was UNREACHABLE. The floor resolves
    // the session out of its registry before it steers anything, and that arm
    // says "unknown or remote session" (ghosttea 0.11.1 service.rs:3218 for the
    // epoch read, :3234 for the input itself) while `terminate` says "unknown
    // session" (:3124). fieldd matched only the second, so a stop aimed at a
    // session that had just left answered INTERNAL, retryable — the phone's
    // stop button on the benign race. Both spellings are fed here, from the
    // floor side of a real socket, so an upstream rewording reds this row
    // rather than silently restoring the INTERNAL.
    for (const message of ["unknown or remote session", "unknown session"]) {
      const floor = await startFakeFloor({ automationError: message });
      const service = new TerminalService({
        link: {
          subscribe: async () => ({ snapshot: {} }),
          terminalEndpoints: floor.endpoints,
          on: () => undefined,
        },
      });
      cleanup.push(() => service.dispose());
      // interrupt is the phone's stop button; paste and text share the helper,
      // so one of each proves the classifier and not one call site
      expect(await service.automate("gone-session", { kind: "interrupt" }), message).toEqual({
        accepted: false,
        reason: "unknown-session",
      });
      expect(await service.automate("gone-session", { kind: "text", text: "y" }), message).toEqual({
        accepted: false,
        reason: "unknown-session",
      });
    }
  });

  it("still steers a session the floor DOES hold (the control)", async () => {
    const floor = await startFakeFloor();
    const service = new TerminalService({
      link: {
        subscribe: async () => ({ snapshot: {} }),
        terminalEndpoints: floor.endpoints,
        on: () => undefined,
      },
    });
    cleanup.push(() => service.dispose());
    expect(await service.automate(floor.createdSessionId, { kind: "interrupt" })).toEqual({
      accepted: true,
    });
  });

  it("gates every terminal.* method on its declared scope", async () => {
    // This test used to be NAMED for every method and exercise exactly one
    // (`terminal.list`), so a new terminal door could ship ungated and stay
    // green here — and `contracts/test/registry.test.ts` explicitly permits
    // `scope: null`, so it passed there too. Both halves are closed now: the
    // expected map must EXHAUST the registry (a new method with no entry fails
    // before anything is called), and every declared method is actually
    // refused for a principal that holds none of the scopes.
    const EXPECTED_SCOPE: Record<string, string> = {
      "terminal.list": "terminal.attach",
      "terminal.sessions": "terminal.attach",
      "terminal.get": "terminal.attach",
      "terminal.openTicket": "terminal.attach",
      "terminal.create": "terminal.attach",
      "terminal.terminate": "terminal.attach",
      "terminal.renewAttach": "terminal.attach",
      "terminal.roster": "terminal.attach",
      "terminal.config.read": "settings.manage",
      "terminal.config.write": "settings.manage",
      "terminal.config.validate": "settings.manage",
      "terminal.config.import": "settings.manage",
      "terminal.config.export": "settings.manage",
      "terminal.config.reveal": "settings.manage",
      // GT-8a: its own scope, the window's alone — never plugin-eligible shell.open
      "terminal.link.open": "terminal.link",
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

    // holds none of terminal.attach, settings.manage and terminal.link
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
    const doorsG = {
      controlUrl: "ws://127.0.0.1:50015/control",
      framesUrl: "ws://127.0.0.1:50015/frames",
    };
    mock.terminalRoutes = keyedRoutes(1, [
      {
        cellInstanceId: 1,
        cellBootId: "cell-g1",
        endpoints: floor.endpoints,
        workloadClass: "interactive",
        role: "class",
        grantKey: KEY_I,
        doors: doorsG,
      },
    ]);
    mock.observedState = observed([]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "terminal-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const created = TerminalCreateOpenResult.parse(await rpc.call("terminal.create", {}));
    expect(created.sessionId).toBe(floor.createdSessionId);
    expect(created.session).toMatchObject({ id: floor.createdSessionId, handle: "1" });
    expect(created.endpoints).toEqual(doorsG);

    // the pre-GT-1 path is still honestly observed-gated for THIS session
    const raced = await rpc.callErr("terminal.openTicket", { sessionId: created.sessionId });
    expect(raced.data?.kind).toBe("NOT_FOUND");

    // Once observation admits it, G23's separate transport inventory returns
    // the same real engine identity — never a roster-shaped fabrication.
    mock.pushObserved(observed([{ sessionId: created.sessionId }]));
    await poll(async () => {
      const listed = (await rpc.call("terminal.list", {})) as { terminals: TerminalInfo[] };
      return listed.terminals.some((terminal) => terminal.sessionId === created.sessionId)
        ? true
        : undefined;
    });
    const sessions = TerminalRuntimeSessionsResult.parse(await rpc.call("terminal.sessions", {}));
    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.sessions[0]).toMatchObject({ id: created.sessionId, handle: "1" });

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

  it("an error of the text's own is refused before the disk; an inherited one lands with ok:false (GT-3 → GT-7)", async () => {
    // This row's meaning MOVED at GT-7, deliberately. GT-3 wrote whatever it
    // was given and let the reload speak: an unknown key landed on disk and
    // came back `ok: false`, "a verdict the user has to see". GT-7 adopts
    // ghosttea desktop's save rule — an error in THIS document blocks — so that
    // same text is now refused before the replace and the file never moves.
    // `ok: false` survives with a narrower meaning: the loader still has
    // errors, and none of them are the text's (an INHERITED one, from the
    // user's own Ghostty file, which must not make our file read-only).
    const inherited: FakeDiagnostic = {
      severity: "error",
      code: "invalid-value",
      message: "invalid value for `font-size`",
      source: "/Users/me/.config/ghostty/config",
      line: 3,
      key: "font-size",
    };
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const floor = await startFakeFloor({
      loader: (contents, overlayPath) => [inherited, ...unknownKeyLoader(contents, overlayPath)],
    });
    mock.helloTerminal = floor.endpoints;
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["settings.manage"], "settings-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const before = TerminalConfigDocument.parse(await rpc.call("terminal.config.read", {}));
    const refused = await rpc.callErr("terminal.config.write", {
      text: "nonsense-key = 1\n",
      revision: before.revision,
    });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    const refusal = TerminalConfigWriteRefusal.parse(refused.data?.details);
    expect(refusal.reason).toBe("blocking-errors");
    expect(refusal.blocking.map((diagnostic) => [diagnostic.code, diagnostic.line])).toEqual([
      ["unknown-key", 1],
    ]);
    expect(floor.document.exists, "nothing reached the disk").toBe(false);
    expect(floor.commands()).not.toContain("replace-config-document");

    const written = TerminalConfigWriteResult.parse(
      await rpc.call("terminal.config.write", {
        text: "font-size = 14\n",
        revision: before.revision,
      }),
    );
    expect(written.ok, "the loader still reports an error").toBe(false);
    expect(written.document.exists, "and the text landed").toBe(true);
    expect(written.diagnostics).toEqual([inherited]);
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
      // GT-7: a dry run reads whatever layers the text names, and the file
      // actions open native dialogs — the same power, the same gate
      ["terminal.config.validate", { text: "" }],
      ["terminal.config.import", {}],
      ["terminal.config.export", { text: "" }],
      ["terminal.config.reveal", {}],
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
    mock.terminalRoutes = keyedRoutes(1, [
      {
        cellInstanceId: 1,
        cellBootId: "cell-live",
        endpoints: paperEndpoints("live"),
        workloadClass: "interactive",
        role: "class",
        grantKey: KEY_I,
        doors: {
          controlUrl: "ws://127.0.0.1:50001/control",
          framesUrl: "ws://127.0.0.1:50001/frames",
        },
      },
    ]);
    mock.observedState = observed([
      { sessionId: "s1", cell: cellTag(1, "cell-live", "interactive") },
    ]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "stale-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    // a live floor mints the ROUTED ticket, as it should
    const live = (await rpc.call("terminal.openTicket", { sessionId: "s1" })) as {
      endpoints: { controlUrl: string };
    };
    expect(live.endpoints.controlUrl).toBe("ws://127.0.0.1:50001/control");

    // the floor dies and does not come back (stop() closes the listener too,
    // so the reconnect cannot re-learn endpoints — a SIGKILLed field-native)
    await mock.stop();

    const refused = await poll(async () => {
      const err = await rpc.callErr("terminal.openTicket", { sessionId: "s1" });
      return err.data?.kind === "UNAVAILABLE" ? err : undefined;
    });
    expect((refused.data?.details as { state?: string } | undefined)?.state).toBe("absent");

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
    mock.terminalRoutes = keyedRoutes(1, [
      {
        cellInstanceId: 1,
        cellBootId: "cell-g2",
        endpoints: floor.endpoints,
        workloadClass: "interactive",
        role: "class",
        grantKey: KEY_I,
        doors: {
          controlUrl: "ws://127.0.0.1:50016/control",
          framesUrl: "ws://127.0.0.1:50016/frames",
        },
      },
    ]);
    mock.observedState = observed([]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "create-order-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);
    const created = TerminalCreateOpenResult.parse(await rpc.call("terminal.create", {}));

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
    expect(self?.capabilities?.terminalHost).toBe(true);
  });
});

/** GT-7 — a service on one fake floor (or none), with main's file doors when
 * the row gives it some: the rows that read the service's own answers, with
 * no daemon between. */
function configService(
  floor: { endpoints: TerminalEndpoints } | undefined,
  shell: TerminalConfigShell | null = null,
): TerminalService {
  const service = new TerminalService({
    link: {
      subscribe: async () => ({ snapshot: {} }),
      terminalEndpoints: floor?.endpoints,
      on: () => undefined,
    },
    shell: () => shell,
  });
  cleanup.push(() => service.dispose());
  return service;
}

/** GT-7 — main's file doors as a script: each dialog answers what the row says
 * (a cancel, unless told otherwise), and every call is kept. */
function scriptedShell(
  script: { pick?: ShellDialogPickFileResult; save?: ShellDialogSaveFileResult } = {},
): { shell: TerminalConfigShell; calls: Array<{ door: string; params: unknown }> } {
  const calls: Array<{ door: string; params: unknown }> = [];
  return {
    calls,
    shell: {
      pickFile: async (params) => {
        calls.push({ door: "pickFile", params });
        return script.pick ?? { canceled: true };
      },
      saveFile: async (params) => {
        calls.push({ door: "saveFile", params });
        return script.save ?? { canceled: true };
      },
      revealPath: async (params) => {
        calls.push({ door: "revealPath", params });
        return { revealed: true };
      },
    },
  };
}

/** The refusal a call settles with — a failed row if it resolved instead. */
async function refusalOf(promise: Promise<unknown>): Promise<RpcCallError> {
  const outcome = await promise.then(
    (value: unknown) => ({ settled: "resolved" as const, value }),
    (error: unknown) => ({ settled: "rejected" as const, error }),
  );
  if (outcome.settled === "resolved") {
    throw new Error(`expected a refusal, got ${JSON.stringify(outcome.value)}`);
  }
  expect(outcome.error).toBeInstanceOf(RpcCallError);
  return outcome.error as RpcCallError;
}

/** Every `shell.provider.call` a fake Electron main has been sent. */
function providerCalls(shell: WsRpc): ShellProviderCallParams[] {
  return shell.notifications
    .filter((notification) => notification.method === "shell.provider.call")
    .map((notification) => ShellProviderCallParams.parse(notification.params));
}

/** Answer the `index`th provider call once it arrives, the way main does. */
async function answerCall(
  shell: WsRpc,
  index: number,
  result: unknown,
): Promise<ShellProviderCallParams> {
  await until(() => providerCalls(shell).length > index);
  const call = providerCalls(shell)[index];
  if (call === undefined) throw new Error(`provider call ${index} never arrived`);
  await shell.call("shell.provider.resolve", { callId: call.callId, outcome: { result } });
  return call;
}

const OVERLAY = "/Users/me/Library/Application Support/VibeField/native/config.ghostty";
const USER_GHOSTTY = "/Users/me/.config/ghostty/config";

describe("GT-7 — Settings → Terminal's config document", () => {
  it("projects ghosttea's snapshot field by field, and an absent palette is an empty one", () => {
    const snapshot: Parameters<typeof projectConfigSnapshot>[0] = {
      schemaVersion: 1,
      revision: "effective-7",
      compatibility: { ghosttyVersion: "1.3.1", ghosttyCommit: "332b2ae", knownKeyCount: 202 },
      sources: [
        { path: USER_GHOSTTY, kind: "ghostty-default" },
        { path: "/Users/me/.config/ghostty/extra", kind: "included" },
        { path: OVERLAY, kind: "ghosttea-overlay" },
      ],
      diagnostics: [
        {
          severity: "info",
          code: "recognized-not-applied",
          message: "Ghostty key `window-padding-balance` is recognized but not applied yet",
          key: "window-padding-balance",
        },
        {
          severity: "error",
          code: "invalid-color",
          message: "invalid color `#12`",
          source: OVERLAY,
          line: 4,
          key: "background",
        },
      ],
      configuredKeys: [
        { key: "background", support: "applied", occurrences: 1 },
        { key: "font-family", support: "parsed", occurrences: 2 },
        { key: "window-padding-balance", support: "unsupported", occurrences: 1 },
      ],
      terminal: {
        scrollbackBytes: 10_000_000,
        foreground: [255, 255, 255],
        background: [16, 24, 32],
        cursor: [255, 255, 255],
        palette: [{ index: 0, color: [1, 2, 3] }],
      },
      renderer: {
        foreground: [255, 255, 255],
        background: [16, 24, 32],
        cursor: [255, 255, 255],
        cursorText: [240, 224, 208],
        selectionBackground: [255, 255, 255],
        selectionForeground: [0, 0, 0],
        palette: [
          { index: 1, color: [215, 0, 0] },
          { index: 15, color: [253, 252, 251] },
        ],
        backgroundOpacity: 0.72,
        fontSize: 13,
        fontFamilies: ["Berkeley Mono", "Menlo"],
        paddingX: [2, 2],
        paddingY: [2, 2],
        postProcess: "none",
        customShaderPaths: [],
      },
      workspace: {
        keybindings: [{ trigger: "super+k", action: "clear_screen" }],
        clearKeybindings: true,
      },
    };
    const projected = projectConfigSnapshot(snapshot);
    expect(projected).toEqual({
      revision: "effective-7",
      ghosttyVersion: "1.3.1",
      knownKeyCount: 202,
      sources: snapshot.sources,
      diagnostics: snapshot.diagnostics,
      configuredKeys: snapshot.configuredKeys,
      keybindings: [{ trigger: "super+k", action: "clear_screen" }],
      clearKeybindings: true,
      scrollbackBytes: 10_000_000,
      // the renderer's home is read first; each channel is two hex digits
      palette: [
        { index: 1, color: "#d70000" },
        { index: 15, color: "#fdfcfb" },
      ],
      fontSize: 13,
      fontFamilies: ["Berkeley Mono", "Menlo"],
    });
    // a floor older than the key (0.11.1) says nothing about link-url, and the
    // projection says nothing either — never a guessed `true`
    expect("linkUrl" in projected).toBe(false);
    expect(TerminalConfigSnapshot.parse(projected)).toEqual(projected);

    // GT-8a — a floor that applies link-url (0.12.0) sends `renderer.linkUrl`:
    // a boolean or nothing reaches the contract. (Built beside the literal,
    // which keeps the older floor's shape.)
    const linksOff = { ...snapshot.renderer, linkUrl: false };
    const withLinks = projectConfigSnapshot({ ...snapshot, renderer: linksOff });
    expect(withLinks.linkUrl).toBe(false);
    // exactly the contract's fields: what nobody here reads (the commit, the
    // cursor text, the opacity, the schema version) never reaches the wire
    expect(Object.keys(withLinks).sort()).toEqual(Object.keys(TerminalConfigSnapshot.shape).sort());
    expect(TerminalConfigSnapshot.parse(withLinks)).toEqual(withLinks);
    const linksOn = { ...snapshot.renderer, linkUrl: true };
    expect(projectConfigSnapshot({ ...snapshot, renderer: linksOn }).linkUrl).toBe(true);
    // anything but a boolean is a field this build does not understand (cast
    // through unknown: no pinned type, before or after the key, allows it)
    const linksGarbled = { ...snapshot.renderer, linkUrl: "no" } as unknown as typeof linksOff;
    expect("linkUrl" in projectConfigSnapshot({ ...snapshot, renderer: linksGarbled })).toBe(false);

    // a floor that sends one home or neither: the other, then Ghostty's defaults
    const { palette: _renderer, ...rendererWithout } = snapshot.renderer;
    const { palette: _terminal, ...terminalWithout } = snapshot.terminal;
    expect(projectConfigSnapshot({ ...snapshot, renderer: rendererWithout }).palette).toEqual([
      { index: 0, color: "#010203" },
    ]);
    expect(
      projectConfigSnapshot({ ...snapshot, renderer: rendererWithout, terminal: terminalWithout })
        .palette,
    ).toEqual([]);
  });

  it("blocks every error of the document's own, and an inherited one only when it is NEW — one for one", () => {
    const own = {
      severity: "error",
      code: "invalid-color",
      message: "invalid color `#12`",
      source: OVERLAY,
      line: 4,
      key: "background",
    };
    const unplaced = { severity: "error", code: "io", message: "the loader could not place this" };
    const warning = {
      severity: "warning",
      code: "deprecated",
      message: "old key",
      source: OVERLAY,
    };
    const inherited = {
      severity: "error",
      code: "unknown-key",
      message: "unknown key `foo`",
      source: USER_GHOSTTY,
      line: 7,
      key: "foo",
    };

    // the document's own errors block whatever the baseline holds — its path,
    // or no source at all; a warning never blocks
    expect(blockingConfigDiagnostics([own, unplaced], [own, unplaced, warning], OVERLAY)).toEqual([
      own,
      unplaced,
    ]);
    // spelled with a `..`, the document is still the document
    const aliased = { ...own, source: OVERLAY.replace("/native/", "/native/../native/") };
    expect(blockingConfigDiagnostics([aliased], [aliased], OVERLAY)).toEqual([aliased]);
    // an inherited error the saved text already has does not block …
    expect(blockingConfigDiagnostics([inherited], [inherited], OVERLAY)).toEqual([]);
    // … one the candidate brings does …
    expect(blockingConfigDiagnostics([], [inherited], OVERLAY)).toEqual([inherited]);
    // … and so does a second occurrence: matched one for one, never by kind
    expect(blockingConfigDiagnostics([inherited], [inherited, inherited], OVERLAY)).toEqual([
      inherited,
    ]);
    // the identity is the whole diagnostic: the same words on another line are another error
    const moved = { ...inherited, line: 8 };
    expect(blockingConfigDiagnostics([inherited], [moved], OVERLAY)).toEqual([moved]);
  });

  it("read carries the loader's snapshot; validate dry-runs against the SAVED revision; write answers the reload's", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const floor = await startFakeFloor();
    mock.helloTerminal = floor.endpoints;
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const grant = daemon.tokens.mint(["settings.manage"], "settings-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const read = TerminalConfigDocument.parse(await rpc.call("terminal.config.read", {}));
    const effective = TerminalConfigSnapshot.parse(read.config);
    expect(effective.revision, "the cell's EFFECTIVE configuration").toBe(floor.configRevision());
    expect(effective.palette).toEqual([{ index: 1, color: "#d70000" }]);
    expect(effective.keybindings).toEqual([{ trigger: "super+k", action: "clear_screen" }]);

    const text = "font-size = 14\nnonsense-key = 1\n";
    const validation = TerminalConfigValidation.parse(
      await rpc.call("terminal.config.validate", { text }),
    );
    expect(validation.includesAllowed).toBe(true);
    // the saved document's revision: the floor answers the revision the
    // CANDIDATE would have, which is a different fact and is not forwarded
    expect(validation.documentRevision).toBe(read.revision);
    expect(validation.documentRevision).not.toBe(fakeRevision("rev", text));
    expect(validation.blocking.map((diagnostic) => [diagnostic.code, diagnostic.line])).toEqual([
      ["unknown-key", 2],
    ]);
    expect(validation.config?.diagnostics).toEqual(validation.blocking);
    expect(floor.document.exists, "a dry run writes nothing").toBe(false);
    expect(floor.commands()).not.toContain("replace-config-document");

    const written = TerminalConfigWriteResult.parse(
      await rpc.call("terminal.config.write", {
        text: "font-size = 14\n",
        revision: read.revision,
      }),
    );
    expect(written.ok).toBe(true);
    expect(written.effectiveChanged).toBe(true);
    expect(TerminalConfigSnapshot.parse(written.config).revision, "the reload's own").toBe(
      floor.configRevision(),
    );
    expect(written.config?.revision).not.toBe(effective.revision);
  });

  it("refuses a restructured include queue WITHOUT running the loader — a dry run is no file-read door", async () => {
    const floor = await startFakeFloor();
    // Includes are edited in the file itself, so the saved document gets its
    // queue the way a user's own editor would give it one: on disk.
    const saved = "config-file = ?themes/night.conf\nfont-size = 13\n";
    Object.assign(floor.document, { contents: saved, revision: "rev-with-include", exists: true });
    const service = configService(floor);

    for (const text of [
      "config-file = /etc/passwd\nfont-size = 13\n", // another path
      "config-file = themes/night.conf\nfont-size = 13\n", // the same one, no longer optional
      "config-file = ?themes/night.conf\nconfig-file = ?other.conf\n", // one more
    ]) {
      const refused = await service.validateConfig(text);
      expect(refused, text).toEqual({
        documentRevision: "rev-with-include",
        includesAllowed: false,
        blocking: [],
      });
      expect(refused, "a refused text is not loaded, so there is no snapshot").not.toHaveProperty(
        "config",
      );
    }
    expect(floor.commands(), "the loader never ran").not.toContain("validate-config-document");

    // the write re-checks the rule and refuses before anything else
    const write = await refusalOf(
      service.writeConfig("config-file = /etc/passwd\n", "rev-with-include"),
    );
    expect(write.kind).toBe("PRECONDITION_FAILED");
    expect(TerminalConfigWriteRefusal.parse(write.details)).toEqual({
      reason: "includes-changed",
      blocking: [],
    });
    expect(floor.document.contents).toBe(saved);
    expect(floor.commands()).not.toContain("validate-config-document");
    expect(floor.commands()).not.toContain("replace-config-document");

    // keeping the queue exactly, or clearing it, is allowed — and only then does the loader run
    for (const text of ["config-file = ?themes/night.conf\nfont-size = 14\n", "font-size = 14\n"]) {
      expect((await service.validateConfig(text)).includesAllowed, text).toBe(true);
    }
    expect(floor.commands()).toContain("validate-config-document");
  });

  it("names what blocks a save: the text's own errors, and an inherited one only when the text brings it", async () => {
    const inherited: FakeDiagnostic = {
      severity: "error",
      code: "invalid-value",
      message: "invalid value for `font-size`",
      source: USER_GHOSTTY,
      line: 3,
      key: "font-size",
    };
    const themeError: FakeDiagnostic = {
      severity: "error",
      code: "invalid-color",
      message: "invalid color `#zz`",
      source: "/Users/me/.config/ghostty/themes/broken",
      line: 2,
      key: "background",
    };
    const floor = await startFakeFloor({
      loader: (contents, overlayPath) => [
        inherited,
        // a theme is read from ANOTHER file: its errors are inherited by
        // source, and new by occurrence when the text is what names it
        ...(contents.includes("theme = broken") ? [themeError] : []),
        // a theme pointed at the user's own file reads that file twice: the
        // SAME error, one more occurrence
        ...(contents.includes(`theme = ${USER_GHOSTTY}`) ? [inherited] : []),
        ...unknownKeyLoader(contents, overlayPath),
      ],
    });
    const service = configService(floor);

    const inheritedOnly = await service.validateConfig("font-size = 14\n");
    expect(inheritedOnly.blocking, "the user's own Ghostty mistake does not block").toEqual([]);
    expect(inheritedOnly.config?.diagnostics).toEqual([inherited]);
    expect(
      (await service.validateConfig("nonsense-key = 1\n")).blocking.map((d) => d.code),
      "the text's own error does",
    ).toEqual(["unknown-key"]);
    expect((await service.validateConfig("theme = broken\n")).blocking).toEqual([themeError]);
    expect((await service.validateConfig(`theme = ${USER_GHOSTTY}\n`)).blocking).toEqual([
      inherited,
    ]);

    // the write re-checks it, and the refusal carries the list
    const refused = await refusalOf(service.writeConfig("theme = broken\n", "rev-empty"));
    expect(refused.kind).toBe("PRECONDITION_FAILED");
    expect(TerminalConfigWriteRefusal.parse(refused.details)).toEqual({
      reason: "blocking-errors",
      blocking: [themeError],
    });
    expect(floor.document.exists).toBe(false);
    expect(floor.commands()).not.toContain("replace-config-document");
  });

  it("measures inherited errors against a FRESH load of the saved text, never the cell's last reload", async () => {
    // The cell's snapshot (`get-config`) is as old as its last reload, and the
    // floor watches no files. The user breaks their own Ghostty file AFTER the
    // cell loaded: every fresh load now carries that error and the snapshot
    // does not. Measured against the snapshot, every save would block on a
    // mistake in a file VibeField does not own — the outcome the rule exists
    // to prevent. The baseline is a dry run of the saved text instead.
    let userFileBroken = false;
    const inherited: FakeDiagnostic = {
      severity: "error",
      code: "unknown-key",
      message: "unknown configuration key `fnot-size`",
      source: USER_GHOSTTY,
      line: 9,
      key: "fnot-size",
    };
    const floor = await startFakeFloor({
      loader: (contents, overlayPath) => [
        ...(userFileBroken ? [inherited] : []),
        ...unknownKeyLoader(contents, overlayPath),
      ],
    });
    const service = configService(floor);
    expect(
      (await service.readConfig()).config?.diagnostics,
      "the cell loaded a clean file",
    ).toEqual([]);

    userFileBroken = true;
    const validation = await service.validateConfig("font-size = 14\n");
    expect(validation.config?.diagnostics, "a dry run reads the file as it is now").toEqual([
      inherited,
    ]);
    expect(validation.blocking).toEqual([]);
    const written = await service.writeConfig("font-size = 14\n", "rev-empty");
    expect(written.ok, "it landed, and the loader's complaint is still shown").toBe(false);
    expect(written.diagnostics).toEqual([inherited]);
  });

  it("refuses a text over the loader's limit in UTF-8 bytes, before any round trip", async () => {
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
    const seen = floor.commands().length;

    // 16,385 four-byte characters: 65,540 bytes, and only 32,770 UTF-16 units
    const text = "🌱".repeat(TERMINAL_CONFIG_MAX_BYTES / 4 + 1);
    for (const [method, params] of [
      ["terminal.config.validate", { text }],
      ["terminal.config.write", { text, revision: before.revision }],
    ] as const) {
      const err = await rpc.callErr(method, params);
      expect(err.data?.kind, method).toBe("PRECONDITION_FAILED");
      expect(err.data?.details, "not a TerminalConfigWriteRefusal").toBeUndefined();
    }
    expect(floor.commands().length, "refused before the floor").toBe(seen);
    expect(floor.document.exists).toBe(false);
  });

  it("a stale write's CONFLICT carries the document as it now stands — caught early, and from the floor's race", async () => {
    const floor = await startFakeFloor();
    const service = configService(floor);
    await service.writeConfig("font-size = 13\n", "rev-empty");
    const dryRuns = () =>
      floor.commands().filter((command) => command === "validate-config-document").length;
    const before = dryRuns();
    const early = await refusalOf(service.writeConfig("font-size = 99\n", "rev-empty"));
    expect(early.kind).toBe("CONFLICT");
    expect(TerminalConfigConflict.parse(early.details).current).toEqual({
      path: floor.document.path,
      text: "font-size = 13\n",
      revision: fakeRevision("rev", "font-size = 13\n"),
      exists: true,
    });
    expect(dryRuns(), "a stale base is refused before the loader runs").toBe(before);
    expect(floor.document.contents).toBe("font-size = 13\n");

    // the race: another writer lands between fieldd's check and the replace;
    // the floor's own recheck refuses and names the text that won
    const racing = await startFakeFloor({ concurrentWrite: "font-size = 20\n" });
    const raced = await refusalOf(
      configService(racing).writeConfig("font-size = 14\n", "rev-empty"),
    );
    expect(raced.kind).toBe("CONFLICT");
    expect(TerminalConfigConflict.parse(raced.details).current.text).toBe("font-size = 20\n");
    expect(racing.document.contents, "the winner survived").toBe("font-size = 20\n");
  });

  it("imports a picked file as a draft, and refuses whatever is not a small UTF-8 regular file", async () => {
    const dir = makeDataDir();
    const file = join(dir, "picked.ghostty");
    // a leading byte-order mark is the encoding's marker, not the draft's text
    writeFileSync(file, "﻿font-size = 14\n");
    const picked = scriptedShell({ pick: { canceled: false, path: file } });
    expect(
      TerminalConfigImportResult.parse(await configService(undefined, picked.shell).importConfig()),
    ).toEqual({ status: "imported", path: file, text: "font-size = 14\n" });
    expect(picked.calls).toEqual([
      { door: "pickFile", params: { purpose: "terminal.config.import" } },
    ]);
    expect(await configService(undefined, scriptedShell().shell).importConfig()).toEqual({
      status: "cancelled",
    });

    const oversize = join(dir, "big.ghostty");
    writeFileSync(oversize, "#".repeat(TERMINAL_CONFIG_MAX_BYTES + 1));
    const latin1 = join(dir, "latin1.ghostty");
    writeFileSync(latin1, Buffer.from([0x66, 0x6f, 0xe9, 0x0a])); // "foé\n", not UTF-8
    const folder = join(dir, "a-folder");
    mkdirSync(folder);
    for (const [path, reason] of [
      [oversize, /at most 65536/],
      [latin1, /not UTF-8 text/],
      [folder, /not a regular file/],
      [join(dir, "gone.ghostty"), /no longer exists/],
    ] as const) {
      const shell = scriptedShell({ pick: { canceled: false, path } }).shell;
      const error = await refusalOf(configService(undefined, shell).importConfig());
      expect(error.kind, path).toBe("PRECONDITION_FAILED");
      expect(error.message, path).toMatch(reason);
      expect(error.message, "a refusal never quotes the user's path").not.toContain(dir);
    }
  });

  it.skipIf(process.platform === "win32")(
    "refuses a picked named pipe at once rather than waiting for a writer",
    async () => {
      const dir = makeDataDir();
      const fifo = join(dir, "pipe");
      execFileSync("mkfifo", [fifo]);
      const shell = scriptedShell({ pick: { canceled: false, path: fifo } }).shell;
      const error = await refusalOf(configService(undefined, shell).importConfig());
      expect(error.kind).toBe("PRECONDITION_FAILED");
      expect(error.message).toMatch(/not a regular file/);
    },
  );

  it("exports atomically where the save dialog says, and refuses before the dialog what could never come back", async () => {
    const dir = makeDataDir();
    const target = join(dir, "exported.ghostty");
    writeFileSync(target, "# an older export\n");
    const text = "# 🌱 exported\nfont-size = 14\n";
    const saved = scriptedShell({ save: { canceled: false, path: target } });
    expect(
      TerminalConfigExportResult.parse(
        await configService(undefined, saved.shell).exportConfig(text),
      ),
    ).toEqual({ status: "exported", path: target, bytes: Buffer.byteLength(text, "utf8") });
    expect(saved.calls).toEqual([
      {
        door: "saveFile",
        params: { purpose: "terminal.config.export", defaultName: "config.ghostty" },
      },
    ]);
    expect(readFileSync(target, "utf8"), "the older file replaced whole").toBe(text);
    expect(readdirSync(dir), "no temp file left behind").toEqual(["exported.ghostty"]);

    expect(await configService(undefined, scriptedShell().shell).exportConfig(text)).toEqual({
      status: "cancelled",
    });

    const tooBig = scriptedShell({ save: { canceled: false, path: target } });
    const oversize = await refusalOf(
      configService(undefined, tooBig.shell).exportConfig(
        "#".repeat(TERMINAL_CONFIG_MAX_BYTES + 1),
      ),
    );
    expect(oversize.kind).toBe("PRECONDITION_FAILED");
    expect(tooBig.calls, "no dialog for a text that could never be imported back").toEqual([]);

    const gone = join(dir, "gone", "config.ghostty");
    const vanished = await refusalOf(
      configService(
        undefined,
        scriptedShell({ save: { canceled: false, path: gone } }).shell,
      ).exportConfig(text),
    );
    expect(vanished.kind).toBe("PRECONDITION_FAILED");
    expect(vanished.message).toMatch(/no longer exists/);
    expect(readFileSync(target, "utf8")).toBe(text);
    expect(readdirSync(dir), "nothing left behind by a refusal").toEqual(["exported.ghostty"]);
  });

  it("reveals the overlay the floor names — its folder until the first save", async () => {
    const floor = await startFakeFloor();
    const revealed = scriptedShell();
    const service = configService(floor, revealed.shell);
    const folder = dirname(floor.document.path);
    expect(TerminalConfigRevealResult.parse(await service.revealConfig())).toEqual({
      revealed: true,
      path: folder,
    });
    await service.writeConfig("font-size = 13\n", "rev-empty");
    expect(await service.revealConfig()).toEqual({ revealed: true, path: floor.document.path });
    expect(revealed.calls).toEqual([
      { door: "revealPath", params: { path: folder } },
      { door: "revealPath", params: { path: floor.document.path } },
    ]);
  });

  it("without a shell provider the file actions are UNAVAILABLE in the broker's own words", async () => {
    const floor = await startFakeFloor();
    const service = configService(floor, null);
    for (const action of [
      () => service.importConfig(),
      () => service.exportConfig("font-size = 13\n"),
      () => service.revealConfig(),
    ]) {
      const error = await refusalOf(action());
      expect(error.kind).toBe("UNAVAILABLE");
      expect(error.details).toEqual({ service: "shell", state: "unavailable" });
    }
    expect(floor.commands(), "no floor round trip behind a door that is not there").toEqual([]);
  });

  it("reaches Electron main's dialogs through the broker, and audits an export by size alone", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const floor = await startFakeFloor();
    mock.helloTerminal = floor.endpoints;
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    const grant = daemon.tokens.mint(["settings.manage"], "settings-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    // before main registers, the doors are not there — the broker says so
    const early = await rpc.callErr("terminal.config.import", {});
    expect(early.data?.kind).toBe("UNAVAILABLE");
    expect(early.data?.details).toMatchObject({ service: "shell", state: "unavailable" });

    const shell = await openRpc(daemon.controlPort);
    await helloAs(shell, daemon.shellToken, "shell-main");
    await shell.call("shell.provider.register", { methods: [...SHELL_PROVIDER_METHODS] });

    const files = makeDataDir();
    const picked = join(files, "picked.ghostty");
    writeFileSync(picked, "font-size = 15\n");
    const imported = rpc.call("terminal.config.import", {});
    expect(await answerCall(shell, 0, { canceled: false, path: picked })).toMatchObject({
      method: "shell.dialog.pickFile",
      params: { purpose: "terminal.config.import" },
      // an internal door: main sees fieldd, never the renderer that asked
      caller: { clientKind: "fieldd" },
      deadlineAt: Number.MAX_SAFE_INTEGER,
    });
    expect(TerminalConfigImportResult.parse(await imported)).toEqual({
      status: "imported",
      path: picked,
      text: "font-size = 15\n",
    });

    const secret = "# private-marker-8d1f\nfont-size = 16\n";
    const bytes = Buffer.byteLength(secret, "utf8");
    const target = join(files, "exported.ghostty");
    const exported = rpc.call("terminal.config.export", { text: secret });
    expect(await answerCall(shell, 1, { canceled: false, path: target })).toMatchObject({
      method: "shell.dialog.saveFile",
      params: { purpose: "terminal.config.export", defaultName: "config.ghostty" },
    });
    expect(TerminalConfigExportResult.parse(await exported)).toEqual({
      status: "exported",
      path: target,
      bytes,
    });
    expect(readFileSync(target, "utf8")).toBe(secret);
    const cancelled = rpc.call("terminal.config.export", { text: secret });
    await answerCall(shell, 2, { canceled: true });
    expect(await cancelled).toEqual({ status: "cancelled" });

    const revealing = rpc.call("terminal.config.reveal", {});
    expect(await answerCall(shell, 3, { revealed: true })).toMatchObject({
      method: "shell.revealPath",
      params: { path: dirname(floor.document.path) },
    });
    expect(TerminalConfigRevealResult.parse(await revealing)).toEqual({
      revealed: true,
      path: dirname(floor.document.path),
    });

    // export is the one act here: audited by size, never by contents or path;
    // import, validate and reveal write nothing anywhere and are not audited
    const records = (await readAuditRecords(dataDir)).filter((record) =>
      record.action.startsWith("terminal.config."),
    );
    expect(records).toMatchObject([
      { action: "terminal.config.export", phase: "attempt", attrs: { bytes } },
      {
        action: "terminal.config.export",
        phase: "outcome",
        outcome: "succeeded",
        attrs: { bytes },
      },
      { action: "terminal.config.export", phase: "attempt", attrs: { bytes } },
      { action: "terminal.config.export", phase: "outcome", outcome: "cancelled" },
    ]);
    const persisted = readdirSync(join(dataDir, "audit"))
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => readFileSync(join(dataDir, "audit", name), "utf8"))
      .join("\n");
    expect(persisted).not.toContain("private-marker-8d1f");
    expect(persisted).not.toContain("exported.ghostty");
    expect(persisted).not.toContain("picked.ghostty");
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
  it("keeps a LEGACY floor's endpoints when its routes subscribe answers the unrevised snapshot (MF-2i)", async () => {
    // QA 2026-09-13, finding 2 — A FLOOR THAT NO LONGER EXISTS, scripted here
    // because the plane outlives fieldd and this reader still has to survive
    // meeting one.
    //
    // ERRATA (2026-09-14): the paragraph below stood in the PRESENT tense and
    // is true of no floor now. It said that with `FIELD_NATIVE_MESH=1
    // FIELD_NATIVE_TERMINAL_MESH=1` the floor KEEPS a legacy in-process serve.
    // TM-1 deleted that serve outright — `services/terminal_mesh.rs` is gone,
    // cells run unconditionally, and the flag answers only "are this floor's
    // terminal doors published on the tailnet" (`config.rs`'s `MeshPlan`, which
    // carries the same correction). A flagged floor today has REAL route rows
    // and says so on the hello's `terminalMesh`.
    //
    // AS IT WAS: the floor kept that serve, so its route snapshot never left
    // `{revision: 0, cells: []}` and the hello's LEGACY mirror was the only
    // reading it had. The hello withheld the unrevised snapshot; the routes
    // subscription answered it anyway — and resolving an empty cell list to
    // "no endpoints" threw the mirror away one message after the ack vouched
    // for it. `device.list` said `terminalHost: false`, Godview said the deck
    // could not reach fieldd, and an authenticated `terminal.create` answered
    // "the terminal floor is not available" on a floor that was serving PTYs
    // the whole time.
    //
    // WHAT SURVIVES is the rule, and it is the reader's: the floor withholds an
    // unrevised snapshot on BOTH surfaces (field-native's `disclosed_routes` —
    // `revision > 0`, applied to the subscribe payload and every delta). This
    // row scripts a floor that PREDATES that rule, because a plane adopted by
    // design (GT-2d) may be older than the daemon that adopts it, so fieldd
    // carries the same rule on its own side. That is what this proves.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const floor = await startFakeFloor();
    mock.helloTerminal = floor.endpoints;
    mock.routesSubscribeSnapshot = { revision: 0, cells: [] };
    mock.observedState = observed([]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    // Assert AFTER the subscription has landed, or this row only ever tests the
    // hello — which was never the broken half.
    await poll(async () =>
      mock.subscriptionRequests.includes("native.lifecycle.terminal.routes.subscribe")
        ? true
        : undefined,
    );
    expect(daemon.native.terminalEndpoints, "the hello-vouched mirror survives").toEqual(
      floor.endpoints,
    );
    expect(
      daemon.native.terminalRoutes,
      "an unrevised snapshot is never a reading",
    ).toBeUndefined();

    const grant = daemon.tokens.mint(["terminal.attach", "workspace.read"], "mf2i-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const devices = (await rpc.call("device.list", {})) as { devices: DeviceInfo[] };
    expect(
      devices.devices.find((d) => d.self)?.capabilities?.terminalHost,
      "the device still hosts terminals",
    ).toBe(true);

    // And the deck's door opens. A mirror-only floor mints no GRANT (TP-S3e),
    // so the create may still refuse at the ticket — what it must never be is
    // the absent-floor refusal, and the session must reach the floor's wire.
    let refusal: RpcErrorShape | undefined;
    try {
      await rpc.call("terminal.create", {});
    } catch (error) {
      refusal = (error as { rpc?: RpcErrorShape }).rpc;
    }
    expect(refusal?.message, "the floor is right there").not.toBe(
      "the terminal floor is not available",
    );
    expect(
      (refusal?.data?.details as { state?: string } | undefined)?.state,
      "nothing about this floor is absent",
    ).not.toBe("absent");
    expect(floor.createOptions(), "the create reached the floor's own socket").toBeDefined();
  });

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

  it("a pre-TC-S2 floor (legacy mirror only) refuses honestly since TP-S3e", async () => {
    // The compatibility promise DIED with the bridge, deliberately: a floor
    // that sends only `terminal` (no routes, no grant key, no doors) cannot
    // serve a routed ticket, and the door says so instead of minting the
    // legacy trio it used to.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS; // and no terminalRoutes: a pre-TC-S2 floor
    mock.observedState = observed([{ sessionId: "s1" }]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const grant = daemon.tokens.mint(["terminal.attach"], "legacy-mirror-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    const refusedLegacy = await rpc.callErr("terminal.openTicket", { sessionId: "s1" });
    expect(refusedLegacy.data?.kind).toBe("UNAVAILABLE");
    expect((refusedLegacy.data?.details as { state?: string } | undefined)?.state).toBe(
      "grants_not_landed",
    );
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

  it("dials a session it just birthed at the cell that took it, before any inventory places it", async () => {
    // GT-8's gate found it (2026-09-25): the observed inventory lists a birth
    // one reconcile tick later, and in that window an unplaced session read as
    // the INTERACTIVE cell's. An agent session terminated that fast was dialed
    // at a cell that never held it, which answered "unknown session", and the
    // terminate reported `terminated: false` for a PTY that went on running.
    // This service never subscribes, so no inventory ever places the session:
    // the birth is the only thing that knows where it lives.
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
    expect(born.cellBootId).toBe("cell-a");
    await expect(
      service.automate(born.sessionId, { kind: "text", text: "echo placed" }),
    ).resolves.toMatchObject({ accepted: true });
    await expect(service.terminate(born.sessionId)).resolves.toEqual({ terminated: true });
    expect(agent.commands()).toEqual(expect.arrayContaining(["automation-input", "terminate"]));
    expect(interactive.connections(), "the interactive cell was never dialed").toBe(0);
  });

  it("closes a session born and ended inside one reconcile tick at the cell that held it", async () => {
    // AR-S4c found it (2026-09-26): an exited agent pane stays on its cell
    // until closed (MF-1g), and an exit listener is what closes it — a login
    // pane's, a server sign-in's. The birth used to be forgotten AT the exit,
    // so a pane that ended before any inventory placed it was closed at the
    // interactive cell ("unknown session") and its husk stood for good.
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
    const closed = new Promise<{ terminated: boolean }>((resolve, reject) => {
      service.onSessionExited((event) => {
        service.terminate(event.sessionId).then(resolve, reject);
      });
    });
    agent.exit(born.sessionId);
    await expect(closed).resolves.toEqual({ terminated: true });
    expect(agent.commands()).toContain("terminate");
    expect(interactive.connections(), "the interactive cell was never dialed").toBe(0);
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
    const doorsI = {
      controlUrl: "ws://127.0.0.1:50011/control",
      framesUrl: "ws://127.0.0.1:50011/frames",
    };
    const doorsA = {
      controlUrl: "ws://127.0.0.1:50012/control",
      framesUrl: "ws://127.0.0.1:50012/frames",
    };
    mock.terminalRoutes = keyedRoutes(1, [
      {
        cellInstanceId: 1,
        cellBootId: "cell-i",
        endpoints: paperEndpoints("interactive"),
        workloadClass: "interactive",
        role: "class",
        grantKey: KEY_I,
        doors: doorsI,
      },
      {
        cellInstanceId: 2,
        cellBootId: "cell-a",
        endpoints: paperEndpoints("agent"),
        workloadClass: "agent",
        role: "class",
        grantKey: KEY_A,
        doors: doorsA,
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

    // TP-S3e: "which cell answered" is assertable as the DOORS on the routed
    // ticket — each session's ticket names its own cell's endpoints and boot id
    const pane = (await rpc.call("terminal.openTicket", { sessionId: "pane-1" })) as {
      route: { cellBootId: string };
      endpoints: { controlUrl: string };
    };
    const agent = (await rpc.call("terminal.openTicket", { sessionId: "agent-1" })) as {
      route: { cellBootId: string };
      endpoints: { controlUrl: string };
    };
    expect(pane.route.cellBootId).toBe("cell-i");
    expect(pane.endpoints).toEqual(doorsI);
    expect(agent.route.cellBootId).toBe("cell-a");
    expect(agent.endpoints).toEqual(doorsA);
  });

  it("a session whose cell is gone is cell_gone, never another cell's socket", async () => {
    // The beat between a cell's death and the observed stream repairing the
    // inventory: fieldd still holds a row for a session whose cell has left the
    // snapshot. Minting the surviving cell's coordinates there would hand out a
    // credential for a socket that never had this session; refusing is the
    // honest state, and retryable because the inventory is about to say so.
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    const doorsLive = {
      controlUrl: "ws://127.0.0.1:50013/control",
      framesUrl: "ws://127.0.0.1:50013/frames",
    };
    mock.terminalRoutes = keyedRoutes(4, [
      {
        cellInstanceId: 1,
        cellBootId: "cell-i",
        endpoints: paperEndpoints("interactive"),
        workloadClass: "interactive",
        role: "class",
        grantKey: KEY_I,
        doors: doorsLive,
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
    const pane = (await rpc.call("terminal.openTicket", { sessionId: "pane-1" })) as {
      endpoints: { controlUrl: string };
    };
    expect(pane.endpoints).toEqual(doorsLive);
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
// (terminal-pipeline-v3 §5.1, rollout §15 row S1): the route + grants ride beside the
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
    doors?: { controlUrl: string; framesUrl: string };
  }>,
): TerminalRouteSnapshot {
  const snapshot = classRoutes(revision, cells);
  return {
    ...snapshot,
    cells: snapshot.cells.map((row, i) => {
      const key = cells[i]?.grantKey;
      const doors = cells[i]?.doors;
      return {
        ...row,
        ...(key === undefined ? {} : { grantKey: key, grantKeyGeneration: 1 }),
        ...(doors === undefined ? {} : { doors }),
      };
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
      // TP-S3e: every serving cell has its doors — a doorless keyed cell is
      // UNAVAILABLE at the mint now, so both fixture cells carry theirs.
      doors: {
        controlUrl: "ws://127.0.0.1:49159/control",
        framesUrl: "ws://127.0.0.1:49159/frames",
      },
    },
    {
      cellInstanceId: 2,
      cellBootId: "cell-a",
      endpoints: paperEndpoints("agent"),
      workloadClass: "agent",
      role: "class",
      grantKey: KEY_A,
      doors: {
        controlUrl: "ws://127.0.0.1:49160/control",
        framesUrl: "ws://127.0.0.1:49160/frames",
      },
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
  it("mints the routed ticket — doors + grants signed by the session's OWN cell key", async () => {
    const { rpc } = await keyedDaemon();
    const raw = await rpc.call("terminal.openTicket", { sessionId: "pane-1" });
    const pane = TerminalOpenTicketResult.parse(raw);
    // TP-S3e: no legacy trio anywhere on the answer
    expect("controlSocket" in (raw as Record<string, unknown>)).toBe(false);
    expect("token" in (raw as Record<string, unknown>)).toBe(false);
    // the routed ticket, bound and signed
    expect(pane.route).toEqual({ cellBootId: "cell-i", routeRevision: 3 });
    expect(pane.endpoints).toEqual({
      controlUrl: "ws://127.0.0.1:49159/control",
      framesUrl: "ws://127.0.0.1:49159/frames",
    });
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
    expect(agent.route.cellBootId).toBe("cell-a");
    // a cell's doors ride its ticket, verbatim
    expect(agent.endpoints).toEqual({
      controlUrl: "ws://127.0.0.1:49160/control",
      framesUrl: "ws://127.0.0.1:49160/frames",
    });
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
    const doorsF = {
      controlUrl: "ws://127.0.0.1:50014/control",
      framesUrl: "ws://127.0.0.1:50014/frames",
    };
    mock.terminalRoutes = keyedRoutes(9, [
      {
        cellInstanceId: 1,
        cellBootId: "cell-f",
        endpoints: floor.endpoints,
        workloadClass: "interactive",
        role: "class",
        grantKey: KEY_I,
        doors: doorsF,
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
    expect("ticket" in created, "the legacy nested ticket retired at TP-S3e").toBe(false);
    expect(created.endpoints).toEqual(doorsF);
    expect(created.route).toEqual({ cellBootId: "cell-f", routeRevision: 9 });
    expect(created.attachGrant.claims.sessionId).toBe(floor.createdSessionId);
    expect(verifies(KEY_I, created.attachGrant)).toBe(true);
    expect(verifies(KEY_I, created.transportGrant)).toBe(true);
  });

  // TM-2 (TM-D3) — `terminal.create` shares `ticketFor` with `openTicket`, so
  // the door shape is chosen in ONE place. This row is what proves the sharing
  // is real rather than asserted: the birth path is a different function with
  // its own cell lookup, and it is the one a phone uses to start a session.
  it("create answers a SELF peer with the tailnet doors and a self peer's rights", async () => {
    const dataDir = makeDataDir();
    mkdirSync(join(dataDir, "fieldd"), { recursive: true });
    writeFileSync(
      join(dataDir, "fieldd", "link.json"),
      JSON.stringify({
        login: "me@jamesyong42.com",
        tailnet: "tail1234.ts.net",
        linkedAt: "2026-09-14T00:00:00.000Z",
      }),
    );
    const mock = await startMock(dataDir);
    mock.helloTerminalMesh = true;
    const floor = await startFakeFloor();
    mock.terminalRoutes = keyedRoutes(9, [
      {
        cellInstanceId: 1,
        cellBootId: "cell-f",
        endpoints: floor.endpoints,
        workloadClass: "interactive",
        role: "class",
        grantKey: KEY_I,
        doors: {
          controlUrl: "ws://127.0.0.1:50014/control",
          framesUrl: "ws://127.0.0.1:50014/frames",
        },
      },
    ]);
    mock.observedState = observed([]);
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());
    // wait for the terminal listener the routes ride
    const deadline = Date.now() + 5_000;
    while (
      !daemon.mesh
        .serves()
        .some((s) => (s.serveId ?? s.name) === "terminal" && s.status === "active")
    ) {
      if (Date.now() > deadline) throw new Error("the terminal serve never came up");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // dial the product door the way the sidecar DELIVERS a phone, which after
    // UA-P-0d is not the way the phone dials: the phone asks for the bare root
    // and the sidecar adds the secret on forward, so a test playing the sidecar
    // adds it from the floor's own copy of the route config. Plus the injected
    // identity header that makes the caller `self`.
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`, {
      headers: { "Tailscale-User-Login": "me@jamesyong42.com" },
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

    const created = TerminalCreateOpenResult.parse(await rpc.call("terminal.create", {}));
    expect(created.sessionId).toBe(floor.createdSessionId);
    expect(created.endpoints).toEqual({
      controlUrl: "ws://mock.ts.net:9422/cell/cell-f/control",
      framesUrl: "ws://mock.ts.net:9422/cell/cell-f/frames",
    });
    expect(created.attachGrant.claims.rights).toEqual(["input", "read"]);
    // the grants are the cell's own, exactly as for a window
    expect(created.route).toEqual({ cellBootId: "cell-f", routeRevision: 9 });
    expect(verifies(KEY_I, created.attachGrant)).toBe(true);
    expect(verifies(KEY_I, created.transportGrant)).toBe(true);
  });

  it("a keyless floor answers UNAVAILABLE — the legacy-alone trio retired at TP-S3e", async () => {
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

    const refusal = await rpc.callErr("terminal.openTicket", { sessionId: "s1" });
    expect(refusal.data?.kind).toBe("UNAVAILABLE");
    expect((refusal.data?.details as { state?: string } | undefined)?.state).toBe(
      "grants_not_landed",
    ); // no half ticket, and no legacy trio either — the honest state
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

/** AR-7d — the kit's zsh answer, spelled as the floor must receive it. The
 * values are the fake's: nothing on this floor runs a shell (the real zsh
 * rows are terminal-shell-integration.test.ts). */
const INTEGRATION = {
  ZDOTDIR: "/shims/zsh",
  PUPPETEER_ORIGINAL_ZDOTDIR: "",
  PUPPETEER_SHIM_DIR: "/shims/bin",
};

/** A service over the fake floor alone, the G16 row's shape. */
function fakeFloorService(
  floor: { endpoints: TerminalEndpoints },
  opts: Omit<TerminalServiceOptions, "link"> = {},
): TerminalService {
  const service = new TerminalService({
    link: {
      subscribe: async () => ({ snapshot: {} }),
      terminalEndpoints: floor.endpoints,
      on: () => undefined,
    },
    ...opts,
  });
  cleanup.push(() => service.dispose());
  return service;
}

/** Absolute programs that EXIST — all the create/spawn pre-flight asks — named
 * like a shell, like a program that is not one, and like an agent. Empty
 * files: this floor runs nothing. */
function programs(): { zsh: string; bash: string; cat: string; agent: string } {
  const bin = join(makeDataDir(), "bin");
  mkdirSync(bin);
  const at = (name: string): string => {
    const path = join(bin, name);
    writeFileSync(path, "");
    return path;
  };
  return { zsh: at("zsh"), bash: at("bash"), cat: at("cat"), agent: at("agent") };
}

/** A daemon over the mock mgmt server whose one keyed cell is the fake floor
 * (the GT-5b row's composition), with the AR-7d and SB-2 seams as given. The
 * window it answers holds `terminal.attach` alone; `rpcWith` opens another
 * holding exactly the scopes it is given. */
async function daemonOverFakeFloor(
  terminalShellIntegration?: (shell: string) => Record<string, string> | undefined,
  terminalProfileBinding?: (profileSet: string) => Promise<TerminalProfileBinding>,
) {
  const dataDir = makeDataDir();
  const mock = await startMock(dataDir);
  const floor = await startFakeFloor();
  mock.terminalRoutes = keyedRoutes(1, [
    {
      cellInstanceId: 1,
      cellBootId: "cell-ar7d",
      endpoints: floor.endpoints,
      workloadClass: "interactive",
      role: "class",
      grantKey: KEY_I,
      doors: {
        controlUrl: "ws://127.0.0.1:50017/control",
        framesUrl: "ws://127.0.0.1:50017/frames",
      },
    },
  ]);
  mock.observedState = observed([]);
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    ...(terminalShellIntegration === undefined ? {} : { terminalShellIntegration }),
    ...(terminalProfileBinding === undefined ? {} : { terminalProfileBinding }),
  });
  cleanup.push(() => daemon.stop());
  const rpcWith = async (scopes: Scope[]): Promise<WsRpc> => {
    const grant = daemon.tokens.mint(scopes, "ar7d-daemon");
    const opened = await openRpc(daemon.controlPort);
    await helloAs(opened, grant.token);
    return opened;
  };
  const rpc = await rpcWith(["terminal.attach"]);
  const createRecords = async () =>
    (await readAuditRecords(dataDir)).filter((r) => r.action === "terminal.session.create");
  const createOutcomes = async () =>
    (await createRecords()).filter((r) => r.phase === "outcome").map((r) => r.attrs);
  return { dataDir, mock, floor, daemon, rpc, rpcWith, createRecords, createOutcomes };
}

describe("AR-7d — a free shell is born integrated (the fake floor)", () => {
  it("the integration's variables reach the floor for the default login shell and for an explicit zsh", async () => {
    const floor = await startFakeFloor();
    const { zsh } = programs();
    const asked: string[] = [];
    const service = fakeFloorService(floor, {
      defaultShell: () => "/bin/zsh",
      shellIntegration: (shell) => {
        asked.push(shell);
        return INTEGRATION;
      },
    });
    const byDefault = await service.create({});
    expect(floor.createOptions()?.["executable"]).toBe("/bin/zsh");
    expect(floor.createOptions()?.["args"]).toEqual(["-l"]);
    expect(floor.createOptions()?.["environment"]).toStrictEqual({
      mode: "inherit",
      overrides: INTEGRATION,
    });
    expect(byDefault.integrated).toBe(true);
    const byName = await service.create({ shell: zsh });
    expect(floor.createOptions()?.["executable"]).toBe(zsh);
    expect(floor.createOptions()?.["args"]).toEqual([]);
    expect(floor.createOptions()?.["environment"]).toStrictEqual({
      mode: "inherit",
      overrides: INTEGRATION,
    });
    expect(byName.integrated).toBe(true);
    // asked once per birth, with the executable being born
    expect(asked).toEqual(["/bin/zsh", zsh]);

    // AR7-D3 (RULED 2026-09-28): zsh ONLY. A default login shell that is not zsh
    // is born plain, honestly — `integrated: false`, the integration never asked
    // — and so is an explicit bash: the kit could only send a PATH once for
    // them, which a profile that prepends the real binary undoes while the
    // ledger would still say "integrated". The rows that pinned "asked whatever
    // its name" pinned the defect.
    const other = fakeFloorService(floor, {
      defaultShell: () => "/opt/shells/nu",
      shellIntegration: (shell) => {
        asked.push(shell);
        return INTEGRATION;
      },
    });
    expect((await other.create({})).integrated).toBe(false);
    expect(floor.createOptions()?.["environment"]).toStrictEqual({ mode: "inherit" });
    const { bash } = programs();
    expect((await other.create({ shell: bash })).integrated).toBe(false);
    expect(floor.createOptions()?.["executable"]).toBe(bash);
    expect(floor.createOptions()?.["environment"]).toStrictEqual({ mode: "inherit" });
    expect(asked).toEqual(["/bin/zsh", zsh]);
  });

  it("an explicit program that is not a shell gets nothing, and the integration is never asked", async () => {
    const floor = await startFakeFloor();
    const { cat } = programs();
    const asked: string[] = [];
    const service = fakeFloorService(floor, {
      shellIntegration: (shell) => {
        asked.push(shell);
        return INTEGRATION;
      },
    });
    const born = await service.create({ shell: cat });
    expect(floor.createOptions()?.["executable"]).toBe(cat);
    expect(floor.createOptions()?.["environment"]).toStrictEqual({ mode: "inherit" });
    expect(born.integrated).toBe(false);
    expect(asked).toEqual([]);
  });

  it("no integration — absent, or answering undefined — is the bare inherit mode, byte for byte", async () => {
    const floor = await startFakeFloor();
    const bare = fakeFloorService(floor, { defaultShell: () => "/bin/zsh" });
    expect((await bare.create({})).integrated).toBe(false);
    // the exact bytes every shell was born with before AR-7d
    expect(floor.createOptions()?.["environment"]).toStrictEqual({ mode: "inherit" });
    expect(JSON.stringify(floor.createOptions()?.["environment"])).toBe('{"mode":"inherit"}');

    // read at EACH birth: undefined until what answers it is up (the daemon
    // builds the gateway late in its boot), then the integration
    let answer: Record<string, string> | undefined;
    const late = fakeFloorService(floor, {
      defaultShell: () => "/bin/zsh",
      shellIntegration: () => answer,
    });
    expect((await late.create({})).integrated).toBe(false);
    expect(JSON.stringify(floor.createOptions()?.["environment"])).toBe('{"mode":"inherit"}');
    answer = INTEGRATION;
    expect((await late.create({})).integrated).toBe(true);
    expect(floor.createOptions()?.["environment"]).toStrictEqual({
      mode: "inherit",
      overrides: INTEGRATION,
    });
  });

  it("a variable in a daemon's own class is dropped and named in the log — never its value (EL7)", async () => {
    const floor = await startFakeFloor();
    const logs: CapturedLog[] = [];
    const reserved = Object.fromEntries(
      ENV_PREFIXES.map((prefix) => [`${prefix}PROBE`, "a-daemon-secret"]),
    );
    const service = fakeFloorService(floor, {
      defaultShell: () => "/bin/zsh",
      logger: captureLogger(logs),
      shellIntegration: () => ({ ...INTEGRATION, ...reserved }),
    });
    expect((await service.create({})).integrated).toBe(true);
    expect(floor.createOptions()?.["environment"]).toStrictEqual({
      mode: "inherit",
      overrides: INTEGRATION,
    });
    const dropped = logs.filter(
      (log) => log.event === "fieldd.terminal.shell_integration_reserved",
    );
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.attrs?.["dropped"]).toEqual(Object.keys(reserved));
    expect(JSON.stringify(logs)).not.toContain("a-daemon-secret");

    // an answer of nothing but reserved names adds nothing at all
    const only = fakeFloorService(floor, {
      defaultShell: () => "/bin/zsh",
      shellIntegration: () => reserved,
    });
    expect((await only.create({})).integrated).toBe(false);
    expect(JSON.stringify(floor.createOptions()?.["environment"])).toBe('{"mode":"inherit"}');
  });

  it("an agent's spawn is untouched: its CLEAN environment carries none of the integration", async () => {
    const floor = await startFakeFloor();
    const { agent } = programs();
    const asked: string[] = [];
    const service = fakeFloorService(floor, {
      shellIntegration: (shell) => {
        asked.push(shell);
        return INTEGRATION;
      },
    });
    const variables = { HOME: "/home/agent", TERM: "xterm-256color" };
    await service.spawn({ command: agent, args: ["--flag"], cwd: dirname(agent), variables });
    expect(floor.createOptions()?.["executable"]).toBe(agent);
    expect(floor.createOptions()?.["environment"]).toStrictEqual({ mode: "clean", variables });
    expect(asked).toEqual([]);
  });

  it("the daemon's seam reaches the floor, and the create's audit outcome says `integrated` — a fact, never the variables", async () => {
    const { cat } = programs();
    const asked: string[] = [];
    const { dataDir, floor, rpc, createOutcomes } = await daemonOverFakeFloor((shell) => {
      asked.push(shell);
      return INTEGRATION;
    });
    const shell = TerminalCreateOpenResult.parse(await rpc.call("terminal.create", {}));
    expect(floor.createOptions()?.["environment"]).toStrictEqual({
      mode: "inherit",
      overrides: INTEGRATION,
    });
    const program = TerminalCreateOpenResult.parse(
      await rpc.call("terminal.create", { shell: cat }),
    );
    expect(floor.createOptions()?.["environment"]).toStrictEqual({ mode: "inherit" });
    // asked for the default login shell's birth only
    expect(asked).toHaveLength(1);
    expect(await createOutcomes()).toEqual([
      { sessionId: shell.sessionId, integrated: true, bound: false },
      { sessionId: program.sessionId, integrated: false, bound: false },
    ]);
    const ledger = JSON.stringify(await readAuditRecords(dataDir));
    for (const value of Object.values(INTEGRATION).filter((v) => v !== "")) {
      expect(ledger).not.toContain(value);
    }
  });

  it("a daemon with nothing to answer the seam — the gateway not yet up — births a shell exactly as before", async () => {
    const { floor, rpc, createOutcomes } = await daemonOverFakeFloor();
    const shell = TerminalCreateOpenResult.parse(await rpc.call("terminal.create", {}));
    expect(JSON.stringify(floor.createOptions()?.["environment"])).toBe('{"mode":"inherit"}');
    expect(await createOutcomes()).toEqual([
      { sessionId: shell.sessionId, integrated: false, bound: false },
    ]);
  });
});

/** SB-2 — a profile's binding as a runtime answers it. The NAMES are the fake's
 * own — VibeField spells no vendor's variable, in a test either (AR-L1) — and
 * the values say where they came from, so a row can look for them anywhere. */
const BINDING = {
  VF_PROBE_ROOT: "/profiles/work/probe-0001",
  VF_PROBE_MODE: "managed-probe-value",
};

/** A binding seam that answers from `answers` (an unknown set otherwise) and
 * remembers every set it was asked for. */
function bindingSeam(answers: Record<string, TerminalProfileBinding>): {
  asked: string[];
  profileBinding: (profileSet: string) => Promise<TerminalProfileBinding>;
} {
  const asked: string[] = [];
  return {
    asked,
    profileBinding: async (profileSet) => {
      asked.push(profileSet);
      return answers[profileSet] ?? { state: "unknown" };
    },
  };
}

const WORK: TerminalProfileBinding = { state: "bound", label: "Work", variables: BINDING };

describe("SB-2 — a shell born under its profile (AR-7g, the fake floor)", () => {
  it("a bound birth: the binding's variables reach the floor beneath the integration's, and the answer says bound and which set — the binding asked once", async () => {
    const floor = await startFakeFloor();
    const seam = bindingSeam({ work: WORK });
    const service = fakeFloorService(floor, {
      defaultShell: () => "/bin/zsh",
      shellIntegration: () => INTEGRATION,
      profileBinding: seam.profileBinding,
    });
    const born = await service.create({ profileSet: "work" });
    expect(floor.createOptions()?.["environment"]).toStrictEqual({
      mode: "inherit",
      overrides: { ...BINDING, ...INTEGRATION },
    });
    expect(born).toMatchObject({ integrated: true, bound: true, profileSet: "work" });
    expect(seam.asked).toEqual(["work"]);

    // an unbound birth never asks, and carries nothing of it
    const plain = await service.create({});
    expect(plain.bound).toBe(false);
    expect(plain).not.toHaveProperty("profileSet");
    expect(floor.createOptions()?.["environment"]).toStrictEqual({
      mode: "inherit",
      overrides: INTEGRATION,
    });
    expect(seam.asked).toEqual(["work"]);
  });

  it("the binding is the caller's ask whatever the executable: a shell the integration skips and a program that is no shell are born bound", async () => {
    const floor = await startFakeFloor();
    const { bash, cat } = programs();
    const seam = bindingSeam({ work: WORK });
    const service = fakeFloorService(floor, {
      shellIntegration: () => INTEGRATION,
      profileBinding: seam.profileBinding,
    });
    for (const shell of [bash, cat]) {
      const born = await service.create({ shell, profileSet: "work" });
      expect(floor.createOptions()?.["executable"]).toBe(shell);
      expect(floor.createOptions()?.["environment"]).toStrictEqual({
        mode: "inherit",
        overrides: BINDING,
      });
      expect(born).toMatchObject({ integrated: false, bound: true, profileSet: "work" });
    }
    expect(seam.asked).toEqual(["work", "work"]);
  });

  it("the native set binds nothing and is still a bound birth — the bare inherit mode, byte for byte, or the integration alone", async () => {
    const floor = await startFakeFloor();
    const { bash, zsh } = programs();
    const service = fakeFloorService(floor, {
      shellIntegration: () => INTEGRATION,
      profileBinding: bindingSeam({
        native: { state: "bound", label: "This Mac", variables: {} },
      }).profileBinding,
    });
    const plain = await service.create({ shell: bash, profileSet: "native" });
    expect(JSON.stringify(floor.createOptions()?.["environment"])).toBe('{"mode":"inherit"}');
    expect(plain).toMatchObject({ integrated: false, bound: true, profileSet: "native" });
    const integrated = await service.create({ shell: zsh, profileSet: "native" });
    expect(floor.createOptions()?.["environment"]).toStrictEqual({
      mode: "inherit",
      overrides: INTEGRATION,
    });
    expect(integrated).toMatchObject({ integrated: true, bound: true, profileSet: "native" });
  });

  it("on a name both set, the integration wins — counted in the log; no name or value of the binding's is written", async () => {
    const floor = await startFakeFloor();
    const logs: CapturedLog[] = [];
    const service = fakeFloorService(floor, {
      defaultShell: () => "/bin/zsh",
      logger: captureLogger(logs),
      shellIntegration: () => INTEGRATION,
      profileBinding: bindingSeam({
        work: {
          state: "bound",
          label: "Work",
          variables: { ...BINDING, ZDOTDIR: "/profiles/work/zdotdir-probe" },
        },
      }).profileBinding,
    });
    expect((await service.create({ profileSet: "work" })).bound).toBe(true);
    expect(floor.createOptions()?.["environment"]).toStrictEqual({
      mode: "inherit",
      overrides: { ...BINDING, ...INTEGRATION },
    });
    const shadowed = logs.filter((log) => log.event === "fieldd.terminal.profile_binding_shadowed");
    expect(shadowed).toHaveLength(1);
    expect(shadowed[0]?.attrs).toEqual({ shadowed: 1 });
    const written = JSON.stringify(logs);
    for (const text of [...Object.keys(BINDING), ...Object.values(BINDING)])
      expect(written).not.toContain(text);
    expect(written).not.toContain("zdotdir-probe");
  });

  it("the fence (EL7): a variable in a daemon's own classes is dropped from the binding and COUNTED — never named, never its value", async () => {
    const floor = await startFakeFloor();
    const { bash } = programs();
    const logs: CapturedLog[] = [];
    const reserved = Object.fromEntries(
      ENV_PREFIXES.map((prefix) => [`${prefix}PROBE`, "a-daemon-secret"]),
    );
    const service = fakeFloorService(floor, {
      logger: captureLogger(logs),
      profileBinding: bindingSeam({
        work: { state: "bound", label: "Work", variables: { ...BINDING, ...reserved } },
        reserved: { state: "bound", label: "Reserved", variables: reserved },
      }).profileBinding,
    });
    expect((await service.create({ shell: bash, profileSet: "work" })).bound).toBe(true);
    expect(floor.createOptions()?.["environment"]).toStrictEqual({
      mode: "inherit",
      overrides: BINDING,
    });
    const dropped = logs.filter((log) => log.event === "fieldd.terminal.profile_binding_reserved");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.attrs).toEqual({ profileSet: "work", dropped: ENV_PREFIXES.length });
    const written = JSON.stringify(logs);
    expect(written).not.toContain("a-daemon-secret");
    for (const name of Object.keys(reserved)) expect(written).not.toContain(name);

    // a binding of nothing but reserved names adds nothing, and the birth is still bound
    const only = await service.create({ shell: bash, profileSet: "reserved" });
    expect(JSON.stringify(floor.createOptions()?.["environment"])).toBe('{"mode":"inherit"}');
    expect(only).toMatchObject({ bound: true, profileSet: "reserved" });
  });

  it("refusals reach no floor — a set that is gone, a runtime that cannot answer (said, thrown or absent), a binding that cannot be made — each in fieldd's words, never an unbound shell", async () => {
    const floor = await startFakeFloor();
    const service = fakeFloorService(floor, {
      defaultShell: () => "/bin/zsh",
      shellIntegration: () => INTEGRATION,
      profileBinding: async (profileSet) => {
        if (profileSet === "busy") return { state: "unavailable", reason: "runtime disposed" };
        if (profileSet === "throws") throw new Error("the registry could not be read");
        if (profileSet === "broken")
          return { state: "failed", label: "Work", reason: "binds scripted more than once" };
        return { state: "unknown" };
      },
    });
    const refusal = async (params: TerminalCreateParams): Promise<RpcCallError> => {
      const error = await service.create(params).then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
      if (!(error instanceof RpcCallError)) throw new Error("expected a typed refusal");
      return error;
    };
    const gone = await refusal({ profileSet: "gone" });
    expect([gone.kind, gone.message, gone.retryable]).toEqual([
      "NOT_FOUND",
      "that profile no longer exists",
      false,
    ]);
    expect(gone.details).toEqual({ set: "gone" });
    for (const profileSet of ["busy", "throws"]) {
      const unavailable = await refusal({ profileSet });
      expect([unavailable.kind, unavailable.retryable]).toEqual(["UNAVAILABLE", true]);
      expect(unavailable.details).toEqual({
        service: "agents",
        state: "runtime-unavailable",
        set: profileSet,
      });
    }
    const broken = await refusal({ profileSet: "broken" });
    expect([broken.kind, broken.message]).toEqual([
      "PRECONDITION_FAILED",
      "Work could not be bound: binds scripted more than once",
    ]);
    // nothing reached the floor: no birth, and not even a control connection
    expect(floor.createOptions()).toBeUndefined();
    expect(floor.connections()).toBe(0);

    // no runtime composed at all: the same honest UNAVAILABLE
    const bare = fakeFloorService(floor, { defaultShell: () => "/bin/zsh" });
    const none = await bare.create({ profileSet: "work" }).catch((thrown: unknown) => thrown);
    expect(none).toBeInstanceOf(RpcCallError);
    expect((none as RpcCallError).kind).toBe("UNAVAILABLE");
    expect(floor.createOptions()).toBeUndefined();
    expect(floor.connections()).toBe(0);
  });

  it("through the daemon: a bound birth needs agent.spawn too — refused FORBIDDEN_SCOPE before the binding is asked, a recorded attempt naming the set; with it the shell is bound and the ledger says the set and `bound`, never a variable", async () => {
    const { cat } = programs();
    const seam = bindingSeam({ work: WORK });
    const { dataDir, floor, rpc, rpcWith, createRecords, createOutcomes } =
      await daemonOverFakeFloor(undefined, seam.profileBinding);
    // terminal.attach alone: the door's own scope, and not enough for a bound birth
    const refused = await rpc.callErr("terminal.create", { shell: cat, profileSet: "work" });
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(refused.data?.details).toEqual({ required: "agent.spawn" });
    expect(seam.asked).toEqual([]);
    expect(floor.createOptions()).toBeUndefined();
    // the attempt names the set asked for (the shell path is the ledger's own
    // alias of it: temp directories are written as `<temp>`)
    const attempt = (await createRecords()).find((r) => r.phase === "attempt");
    expect(Object.keys(attempt?.attrs ?? {}).sort()).toEqual(["profileSet", "shell"]);
    expect(attempt?.attrs?.["profileSet"]).toBe("work");
    const failed = (await createRecords()).find((r) => r.phase === "outcome");
    expect(failed?.outcome).toBe("failed");
    // …and the same window may still open an unbound shell
    const unbound = TerminalCreateOpenResult.parse(
      await rpc.call("terminal.create", { shell: cat }),
    );
    expect(JSON.stringify(floor.createOptions()?.["environment"])).toBe('{"mode":"inherit"}');

    const spawner = await rpcWith(["terminal.attach", "agent.spawn"]);
    const bound = TerminalCreateOpenResult.parse(
      await spawner.call("terminal.create", { shell: cat, profileSet: "work" }),
    );
    expect(seam.asked).toEqual(["work"]);
    expect(floor.createOptions()?.["environment"]).toStrictEqual({
      mode: "inherit",
      overrides: BINDING,
    });
    const outcomes = await createOutcomes();
    expect(outcomes.at(-2)).toEqual({
      sessionId: unbound.sessionId,
      integrated: false,
      bound: false,
    });
    expect(outcomes.at(-1)).toEqual({ sessionId: bound.sessionId, integrated: false, bound: true });
    const ledger = JSON.stringify(await readAuditRecords(dataDir));
    for (const text of [...Object.keys(BINDING), ...Object.values(BINDING)])
      expect(ledger).not.toContain(text);
  });

  it("through the daemon, the production wiring: the agent runtime's own registry answers — a set it never made is NOT_FOUND, This Mac is a bound birth that binds nothing", async () => {
    const { cat } = programs();
    const { floor, rpcWith, createOutcomes } = await daemonOverFakeFloor();
    const spawner = await rpcWith(["terminal.attach", "agent.spawn"]);
    const gone = await spawner.callErr("terminal.create", { shell: cat, profileSet: "never-made" });
    expect(gone.data?.kind).toBe("NOT_FOUND");
    expect(gone.message).toBe("that profile no longer exists");
    expect(floor.createOptions()).toBeUndefined();
    const native = TerminalCreateOpenResult.parse(
      await spawner.call("terminal.create", { shell: cat, profileSet: "native" }),
    );
    expect(JSON.stringify(floor.createOptions()?.["environment"])).toBe('{"mode":"inherit"}');
    expect((await createOutcomes()).at(-1)).toEqual({
      sessionId: native.sessionId,
      integrated: false,
      bound: true,
    });
  });
});

/** A service over the fake floor whose link serves an inventory the row
 * publishes — the first reading at subscribe, each later one as the floor's
 * news. */
function inventoriedService(
  floor: { endpoints: TerminalEndpoints },
  rows: Array<Record<string, unknown>>,
  opts: Omit<TerminalServiceOptions, "link"> = {},
): { service: TerminalService; publish: (rows: Array<Record<string, unknown>>) => void } {
  let current = observed(rows);
  let emit: ((payload: unknown, kind: "snapshot" | "delta") => void) | undefined;
  const service = new TerminalService({
    link: {
      subscribe: async (_method, _params, onEvent) => {
        emit = onEvent;
        return { snapshot: current };
      },
      terminalEndpoints: floor.endpoints,
      on: () => undefined,
    },
    ...opts,
  });
  cleanup.push(() => service.dispose());
  return {
    service,
    publish: (next) => {
      current = observed(next);
      emit?.(current, "delta");
    },
  };
}

describe("SB-2 — fieldd's record of a bound shell: the answer, the roster, a restart (the fake floor)", () => {
  it("the create's answer and the roster say the set; a new service over the same record (fieldd restarted) still says it while the floor lists the session; the record ends when the floor stops listing it", async () => {
    const floor = await startFakeFloor();
    const { cat } = programs();
    const file = join(makeDataDir(), ...LAYOUT.TERMINAL_BINDINGS_FILE);
    const first = inventoriedService(floor, [], {
      profileBinding: bindingSeam({ work: WORK }).profileBinding,
      bindings: new TerminalBindingStore({ file }),
    });
    await first.service.ensureStarted();
    const born = await first.service.create({ shell: cat, profileSet: "work" });
    expect(born.profileSet).toBe("work");
    expect(first.service.profileSetOf(born.sessionId)).toBe("work");
    first.publish([
      { sessionId: born.sessionId, pid: 42 },
      { sessionId: "not-ours", pid: 43 },
    ]);
    const roster = TerminalRosterResult.parse(first.service.roster());
    expect(roster.items.map((item) => [item.sessionId, item.profileSet])).toEqual([
      [born.sessionId, "work"],
      ["not-ours", undefined],
    ]);

    // fieldd restarts; the floor — and the shell — did not
    const second = inventoriedService(floor, [{ sessionId: born.sessionId, pid: 42 }], {
      bindings: new TerminalBindingStore({ file }),
    });
    await second.service.ensureStarted();
    expect(second.service.roster().items[0]?.profileSet).toBe("work");
    expect(second.service.profileSetOf(born.sessionId)).toBe("work");
    // the shell ends: the floor stops listing it, and the record lets it go
    second.publish([]);
    expect(second.service.profileSetOf(born.sessionId)).toBeUndefined();
    expect(TerminalBindingsFile.parse(JSON.parse(readFileSync(file, "utf8"))).bindings).toEqual([]);
  });

  it("a bound shell that ends before any inventory lists it: the floor's exit ends the wait, and the next inventory ends its record", async () => {
    const floor = await startFakeFloor();
    const { cat } = programs();
    const { service, publish } = inventoriedService(floor, [], {
      profileBinding: bindingSeam({ work: WORK }).profileBinding,
    });
    await service.ensureStarted();
    const born = await service.create({ shell: cat, profileSet: "work" });
    // an inventory that predates the birth: the birth is inside its window
    publish([]);
    expect(service.profileSetOf(born.sessionId)).toBe("work");
    const exited = new Promise<void>((resolve) => {
      service.onSessionExited(() => resolve());
    });
    floor.exit(born.sessionId);
    await exited;
    publish([]);
    expect(service.profileSetOf(born.sessionId)).toBeUndefined();
  });

  it("through the daemon: the create's answer names the set, the roster says it once the floor lists the session, and the record on disk holds the session and the set — never a variable", async () => {
    const { cat } = programs();
    const { dataDir, mock, rpc, rpcWith } = await daemonOverFakeFloor(
      undefined,
      bindingSeam({ work: WORK }).profileBinding,
    );
    const spawner = await rpcWith(["terminal.attach", "agent.spawn"]);
    const bound = TerminalCreateOpenResult.parse(
      await spawner.call("terminal.create", { shell: cat, profileSet: "work" }),
    );
    expect(bound.profileSet).toBe("work");
    const unbound = TerminalCreateOpenResult.parse(
      await rpc.call("terminal.create", { shell: cat }),
    );
    expect(unbound).not.toHaveProperty("profileSet");
    mock.pushObserved(observed([{ sessionId: bound.sessionId, pid: 42 }]));
    // the daemon applies the floor's news on its own time: ask until it has
    let row: TerminalRosterResult["items"][number] | undefined;
    for (let tries = 0; row === undefined && tries < 200; tries += 1) {
      const roster = TerminalRosterResult.parse(await rpc.call("terminal.roster", {}));
      row = roster.items.find((item) => item.sessionId === bound.sessionId);
      if (row === undefined) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(row?.profileSet).toBe("work");
    const text = readFileSync(join(dataDir, ...LAYOUT.TERMINAL_BINDINGS_FILE), "utf8");
    expect(
      TerminalBindingsFile.parse(JSON.parse(text)).bindings.map((binding) => [
        binding.sessionId,
        binding.profileSet,
      ]),
    ).toEqual([[bound.sessionId, "work"]]);
    for (const secret of [...Object.keys(BINDING), ...Object.values(BINDING)])
      expect(text).not.toContain(secret);
  });
});
