// @vitest-environment node
/**
 * AR-8c — THE WITNESS (thinking-ar-history-room.md §6, the AR-8c row): a REAL
 * session streams through the History room's ports while fieldd's door carries
 * none of it. A real fieldd behind a mock floor, the REAL rosettad (opt-in via
 * FIELDD_ROSETTAD_BIN, the rows fieldd's own suite runs the same way), rosetta's
 * ground-truth claude transcript seeded into an empty home — nothing of the
 * developer's is read — and THIS package's adapters (`history/doors.ts`) over a
 * real FielddClient holding a window's token, exactly as `HistoryView` builds
 * them in the renderer. It lives beside the renderer's tests rather than in
 * fieldd's because what it witnesses is the renderer's adapter: field-app
 * already boots a real fieldd in its suite (`live-push`, `doc-manager`), and so
 * the cache that decides whether this row runs again follows both packages.
 *
 * What it asserts, and how:
 *  - the catalog lane: the session reaches the room's meta through the index
 *    doors (`index.projects`/`index.sessions`, the pings), as rosetta's row;
 *  - the body lane: `sessions.open` asks `index.openTicket`, rosetta's own
 *    client dials rosettad with the grant, and a `subscribeSession` snapshot
 *    arrives carrying the transcript's own words;
 *  - EL2: every call the adapters made of fieldd is a catalog door or the
 *    ticket — none is a transcript read — and no frame fieldd sent this window
 *    carries a byte of the transcript's text.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MetaState, TimelineEntry } from "@rosetta/protocol";
import { IndexSessionsResult, IndexStatus, LAYOUT, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { bootstrap, type FielddDaemon } from "@vibefield/fieldd";
import { MockMgmtServer } from "@vibefield/fieldd/testing";
import { FielddClient, type WsLike } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import { type HistoryDoorClient, historyPortsOver } from "../src/history/doors";

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_BIN = process.env["FIELDD_ROSETTAD_BIN"];
/** rosetta's ground truth, read from the checkout dedicated to the pin. */
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
/** words only the transcript's BODY carries (the agent's reply) — never a
 * catalog column, so they may cross no door of fieldd's */
const BODY_WORDS = "deterministic scripted response";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* already gone */
    }
  }
  cleanup = [];
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T | null> | T | null, label: string, ms: number): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await Promise.resolve(read()).catch(() => null);
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label}`);
    await sleep(150);
  }
}

/** Every frame fieldd sends the window, kept as it arrived: the door's bytes. */
const received: string[] = [];
class RecordingSocket implements WsLike {
  private readonly socket: WebSocket;
  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => received.push(String(event.data)));
  }
  get readyState(): number {
    return this.socket.readyState;
  }
  send(data: string): void {
    this.socket.send(data);
  }
  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }
  addEventListener(type: "open" | "message" | "close" | "error", fn: (ev: unknown) => void): void {
    this.socket.addEventListener(type, fn as EventListener);
  }
}

async function realDesktop(): Promise<{ daemon: FielddDaemon; window: FielddClient }> {
  // a SHORT root: the mock floor's socket must fit macOS's 104-byte sun_path
  const dataDir = mkdtempSync(join(tmpdir(), "vf-hxw-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  cpSync(GROUNDTRUTH, join(home, ".claude"), { recursive: true });
  const mock = new MockMgmtServer(
    process.platform === "win32"
      ? pipeEndpointFor(dataDir, SOCKETS.MGMT)
      : join(dataDir, ...LAYOUT.MGMT_SOCKET),
  );
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    allowedOrigins: ["file://", "vibefield-app://shell"],
    rosettadBin: REAL_BIN as string,
    rosettadHome: home,
  });
  cleanup.push(() => daemon.stop());
  const url = `ws://127.0.0.1:${daemon.controlPort}`;
  // the shell mints the window's token, as main does per webContents generation
  const shell = new FielddClient({ url, token: daemon.shellToken, clientKind: "shell-main" });
  shell.connect();
  cleanup.push(() => shell.close());
  const minted = (await shell.request("system.mintWindowToken", {
    scopes: ["index.read", "index.search", "index.manage"],
    label: "window-history-witness",
    rendererParticipant: {
      participantId: "renderer:hxw:1",
      incarnation: "renderer:hxw:1:document-1",
    },
  })) as { token: string };
  const window = new FielddClient({
    url,
    token: minted.token,
    clientKind: "renderer",
    webSocket: RecordingSocket,
  });
  window.connect();
  cleanup.push(() => window.close());
  await until(() => (daemon.health().rosettad.phase === "ready" ? true : null), "rosettad ready", 30_000);
  await until(
    async () =>
      IndexStatus.parse(await window.request("index.status", {})).phase === "awaiting_consent"
        ? true
        : null,
    "the index awaiting consent",
    30_000,
  );
  await window.request("index.enroll", { kinds: ["claude-code"] });
  return { daemon, window };
}

describe.skipIf(
  REAL_BIN === undefined || REAL_BIN === "" || !existsSync(REAL_BIN) || !existsSync(GROUNDTRUTH),
)("AR-8c — a real session streams in the room's ports; fieldd's door carries none of it", () => {
  it("the catalog lists it over the index doors, the ticket's grant streams its body from rosettad, and no fieldd frame holds a byte of it", async () => {
    const { window } = await realDesktop();
    const sid = await until(
      async () =>
        IndexSessionsResult.parse(
          await window.request("index.sessions", { nativeSessionIds: [FIXTURE_NATIVE_ID] }),
        ).rows[0]?.sessionId ?? null,
      "the ground truth indexed",
      90_000,
    );

    // The adapters, over the window's client, every call logged.
    const doorCalls: string[] = [];
    const door: HistoryDoorClient = {
      request: (method, params) => {
        doorCalls.push(method);
        return window.request(method, params);
      },
      subscribe: (method, params, onFrame, opts) => {
        doorCalls.push(method);
        return window.subscribe(method, params, (payload, kind) => onFrame(payload, kind), opts);
      },
      get status() {
        return window.status;
      },
      onStatusChange: (listener) => window.onStatusChange(listener),
    };
    const ports = historyPortsOver(door, { platform: process.platform });
    cleanup.push(() => ports.dispose());

    // the catalog lane: the session reaches the room's meta, as rosetta's row
    let meta: MetaState | null = null;
    const feed = ports.catalog.subscribeMeta({ onChange: (state) => (meta = state) });
    cleanup.push(() => feed.close());
    const row = await until(
      () =>
        (meta as MetaState | null)?.sessions.find(
          (session) => session.native_session_id === FIXTURE_NATIVE_ID,
        ) ?? null,
      "the session in the room's meta",
      30_000,
    );
    expect(row.id).toBe(sid);
    expect(row.runtime_id).toBe("claude-code");
    const status = await ports.catalog.status();
    expect(status.ingest?.phase).toBeDefined();

    // the body lane: a ticket, rosetta's client, the session's own stream
    const bytesBefore = received.reduce((sum, frame) => sum + frame.length, 0);
    const client = await ports.sessions.open(sid);
    let entries: TimelineEntry[] = [];
    let snapshot = false;
    const stream = client.subscribeSession(sid, {
      onSnapshot: () => {
        snapshot = true;
      },
      onChange: (rows) => {
        entries = rows;
      },
    });
    cleanup.push(() => stream.close());
    await until(
      () => (snapshot && JSON.stringify(entries).includes(BODY_WORDS) ? true : null),
      "the transcript's snapshot over the ticket",
      30_000,
    );
    const bytesAfter = received.reduce((sum, frame) => sum + frame.length, 0);

    // EL2: fieldd answered lists, facts and a ticket — never a transcript read…
    const asked = new Set(doorCalls);
    expect([...asked].sort()).toEqual(
      expect.arrayContaining(["index.changes.subscribe", "index.openTicket", "index.sessions"]),
    );
    for (const method of asked) {
      expect(method).toMatch(
        /^index\.(changes\.subscribe|projects|sessions|status|openTicket|project|projectDay)$/,
      );
    }
    // …and no frame fieldd sent this window carries a byte of the body
    expect(received.some((frame) => frame.includes(BODY_WORDS))).toBe(false);
    console.log(
      `AR8C_WITNESS ${JSON.stringify({
        sessionId: sid,
        entries: entries.length,
        doorCalls: [...asked].sort(),
        fielddBytesWhileStreaming: bytesAfter - bytesBefore,
        fielddFrames: received.length,
      })}`,
    );
    ports.sessions.close(sid);
  }, 180_000);
});
