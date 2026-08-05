// TerminalService (NF-3/NF-6): the fieldd seam driven through the mock mgmt
// server (no cargo). Covers the NF-D8 endpoints capture from the hello ack,
// the D6 ticket (endpoints present/absent, both honest), the observed-
// inventory stream into terminal.list/get, the terminal.attach scope gate, the
// terminalHost capability flip, the NF-6 re-arm law (a failed observed
// subscribe neither fatals the boot nor stays dead forever), and the NF-6
// transport-death honesty law (a dead control socket is UNAVAILABLE, never the
// benign already-gone race). The live create/terminate/attach path needs a
// real PTY authority and lives in terminal-seam.test.ts.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DeviceInfo,
  TerminalConfigDocument,
  TerminalConfigWriteResult,
  TerminalConnectTicketResult,
  type TerminalCreateResult,
  type TerminalEndpoints,
  type TerminalInfo,
  type TerminalTicket,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, RpcCallError } from "../src/index";
import { TerminalService } from "../src/terminal-service";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
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
  const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
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
 * classification reads it. */
async function startFakeFloor(
  opts: { dieOnTerminate?: boolean; noOverlay?: boolean } = {},
): Promise<{
  endpoints: TerminalEndpoints;
  createdSessionId: string;
  document: FakeConfigDocument;
  /** what the effective config reports; a write bumps it iff the text changed */
  configRevision: () => string;
}> {
  const dir = mkdtempSync(join("/tmp", "vf-fake-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const socketPath = join(dir, "control.sock");
  const createdSessionId = "fake-session-1";
  const live = new Set<Socket>();
  const document: FakeConfigDocument = {
    path: join(dir, "config.ghostty"),
    revision: "rev-empty",
    exists: false,
    contents: "",
  };
  let configRevision = "config-0";
  const server: Server = createServer((sock: Socket) => {
    let buf = Buffer.alloc(0);
    let authed = false;
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
        if (msg.type === "hello") {
          reply({
            type: "hello",
            protocolMajor: 1,
            protocolMinor: 12,
            serverBuild: "vibefield-fake-floor",
          });
        } else if (msg.type === "create-session") {
          reply({ type: "session-created", session: fakeSession(createdSessionId) });
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
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
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
      controlSocket: socketPath,
      frameSocket: join(dir, "frame.sock"),
      authToken: "fake-token",
    },
    createdSessionId,
    document,
    configRevision: () => configRevision,
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

  it("gates every terminal.* method on terminal.attach", async () => {
    const dataDir = makeDataDir();
    const mock = await startMock(dataDir);
    mock.helloTerminal = ENDPOINTS;
    const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => daemon.stop());

    const narrow = daemon.tokens.mint(["doc.read"], "narrow");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, narrow.token);
    const err = await rpc.callErr("terminal.list", {});
    expect(err.data?.kind).toBe("FORBIDDEN_SCOPE");
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
    let list = (await rpc.call("terminal.list", {})) as { terminals: TerminalInfo[] };
    expect(list.terminals).toEqual([]); // honest empty, not a dead daemon

    // the refusal clears and a reconnect fires the "connected" re-arm
    mock.rejectedSubscriptions.clear();
    mock.observedState = observed([{ sessionId: "reborn" }]);
    mock.killClients();

    let settled = false;
    for (let i = 0; i < 60 && !settled; i++) {
      list = (await rpc.call("terminal.list", {})) as { terminals: TerminalInfo[] };
      settled = list.terminals.length === 1;
      if (!settled) await new Promise((r) => setTimeout(r, 100));
    }
    expect(settled).toBe(true);
    expect(list.terminals[0]?.sessionId).toBe("reborn");
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
