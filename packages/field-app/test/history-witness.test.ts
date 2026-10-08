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
 *    carries a byte of the transcript's text;
 *  - RO-13 (2026-10-04): the window's grant reaches the session's recorded-file
 *    read through the room's port — rosettad answers past its credential check
 *    with its own not_found (the ground truth's first row is a prompt, which
 *    names no file), never `wrong-scope`, and never the room's refusal words.
 *
 * The second desktop's home is SYNTHESIZED (build-hf.md L4, 2026-10-08): a
 * Claude-format transcript VibeField writes for its own test, its shape cribbed
 * from rosetta's tests (`crates/pipeline/tests/recorded_tool_images.rs`), so
 * the rows can witness what no ground truth records:
 *  - D1: a prompt's image reaches the room as an optimized member the asset
 *    source ADDRESSES by rosettad's own route, and its renditions' bytes are
 *    read under the window's grant — the route that refuses a bare fetch.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AssetRef,
  type AttachmentRef,
  type MetaState,
  type TimelineEntry,
  UnauthorizedError,
} from "@rosetta/protocol";
import {
  IndexEndpointSet,
  IndexOpenTicket,
  IndexSessionsResult,
  IndexStatus,
  LAYOUT,
  pipeEndpointFor,
  SOCKETS,
} from "@vibefield/contracts";
import { bootstrap, type FielddDaemon } from "@vibefield/fieldd";
import { MockMgmtServer } from "@vibefield/fieldd/testing";
import { FielddClient, type WsLike } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import { type HistoryDoorClient, historyPortsOver } from "../src/history/doors";
import { FILE_TARGET_REFUSAL } from "../src/history/session-port";

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
async function until<T>(
  read: () => Promise<T | null> | T | null,
  label: string,
  ms: number,
): Promise<T> {
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

/** The home rosettad indexes: rosetta's ground truth, or a seed of this
 * file's own (`seed(home, dataDir)`). */
type HomeSeed = (home: string, dataDir: string) => void;

const groundTruth: HomeSeed = (home) => {
  cpSync(GROUNDTRUTH, join(home, ".claude"), { recursive: true });
};

async function realDesktop(
  seed: HomeSeed = groundTruth,
): Promise<{ daemon: FielddDaemon; window: FielddClient }> {
  // a SHORT root: the mock floor's socket must fit macOS's 104-byte sun_path
  const dataDir = mkdtempSync(join(tmpdir(), "vf-hxw-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  seed(home, dataDir);
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
  await until(
    () => (daemon.health().rosettad.phase === "ready" ? true : null),
    "rosettad ready",
    30_000,
  );
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

/** The adapters' door over the window's client, every call logged. */
function loggedDoor(window: FielddClient, calls: string[]): HistoryDoorClient {
  return {
    request: (method, params) => {
      calls.push(method);
      return window.request(method, params);
    },
    subscribe: (method, params, onFrame, opts) => {
      calls.push(method);
      return window.subscribe(method, params, (payload, kind) => onFrame(payload, kind), opts);
    },
    get status() {
      return window.status;
    },
    onStatusChange: (listener) => window.onStatusChange(listener),
  };
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
    const ports = historyPortsOver(loggedDoor(window, doorCalls), { platform: process.platform });
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

    // RO-13: a recorded file, read the way the room reads one — through the
    // session port, with the window's grant, straight to rosettad
    const firstRow = entries[0]?.timeline_id;
    expect(firstRow).toBeDefined();
    const fileRead = await client.readFileTarget(sid, firstRow as string, 0).then(
      () => null,
      (error: unknown) => error,
    );
    expect(fileRead).not.toBeInstanceOf(UnauthorizedError);
    expect(fileRead).toMatchObject({ status: 404, code: "not_found" });
    expect((fileRead as Error).message).not.toBe(FILE_TARGET_REFUSAL);

    // EL2: no frame fieldd sent this window carries a byte of the body…
    expect(received.some((frame) => frame.includes(BODY_WORDS))).toBe(false);
    // …because fieldd answered lists, facts and a ticket — never a transcript read
    const asked = new Set(doorCalls);
    expect([...asked].sort()).toEqual(
      expect.arrayContaining(["index.changes.subscribe", "index.openTicket", "index.sessions"]),
    );
    for (const method of asked) {
      expect(method).toMatch(
        /^index\.(changes\.subscribe|projects|sessions|status|openTicket|project|projectDay)$/,
      );
    }
    console.log(
      `AR8C_WITNESS ${JSON.stringify({
        sessionId: sid,
        entries: entries.length,
        doorCalls: [...asked].sort(),
        fielddBytesWhileStreaming: bytesAfter - bytesBefore,
        fielddFrames: received.length,
      })}`,
    );
    const answered = fileRead as { status: number; code: string | null; message: string };
    console.log(
      `RO13_WITNESS ${JSON.stringify({
        timelineId: firstRow,
        status: answered.status,
        code: answered.code,
        message: answered.message,
      })}`,
    );
    ports.sessions.close(sid);
  }, 180_000);
});

/* ── a synthesized home (build-hf.md L4) ──────────────────────────────────── */

/** A 1×1 PNG — rosetta's own tool-image fixture (`recorded_tool_images.rs`). */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
/** the synthesized session's native id */
const SYNTH_NATIVE_ID = "5c0f9a1e-0b7d-4c1a-9e2f-7a3b8c9d0e1f";

/** One record of the synthesized session in Claude's transcript envelope (the
 * keys rosetta's ground truth writes, `tool-use/…/13f3a252….jsonl`). */
function claudeRecord(cwd: string, at: number, record: Record<string, unknown>): string {
  return JSON.stringify({
    isSidechain: false,
    userType: "external",
    entrypoint: "sdk-cli",
    cwd,
    sessionId: SYNTH_NATIVE_ID,
    version: "2.1.241",
    gitBranch: "HEAD",
    timestamp: new Date(at).toISOString(),
    ...record,
  });
}

/** An assistant turn's message, as the ground truth's mock model writes one. */
function assistantMessage(id: string, content: unknown[]): Record<string, unknown> {
  return {
    id,
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 16,
      output_tokens: 8,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

/** A prompt that carries an image, and its reply — NOW-relative, so no
 * horizon ever ages it out. */
const synthesized: HomeSeed = (home, dataDir) => {
  const cwd = join(dataDir, "project");
  mkdirSync(cwd, { recursive: true });
  const dir = join(home, ".claude", "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
  mkdirSync(dir, { recursive: true });
  const at = Date.now() - 120_000;
  const rows = [
    claudeRecord(cwd, at, {
      parentUuid: null,
      type: "user",
      uuid: "6b1c2d3e-0000-4000-8000-000000000001",
      message: {
        role: "user",
        content: [
          { type: "text", text: "What is in this picture?" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
        ],
      },
    }),
    claudeRecord(cwd, at + 1_000, {
      parentUuid: "6b1c2d3e-0000-4000-8000-000000000001",
      type: "assistant",
      uuid: "6b1c2d3e-0000-4000-8000-000000000002",
      message: assistantMessage("msg_hxs_0001", [
        { type: "text", text: "One pixel, and nothing else." },
      ]),
    }),
  ];
  writeFileSync(join(dir, `${SYNTH_NATIVE_ID}.jsonl`), `${rows.join("\n")}\n`);
};

/** The first stored image a session's rows carry. */
function storedImageOf(entries: readonly TimelineEntry[]): AssetRef | null {
  for (const entry of entries) {
    const attachments = (entry.body as { attachments?: AttachmentRef[] }).attachments ?? [];
    for (const attachment of attachments) {
      if (attachment.kind === "image" && attachment.source.type === "asset")
        return attachment.source.asset;
    }
  }
  return null;
}

describe.skipIf(REAL_BIN === undefined || REAL_BIN === "" || !existsSync(REAL_BIN))(
  "AR-8 — a synthesized history through the room's ports (L4)",
  () => {
    it("D1: a prompt's image is addressed by rosettad's own route, and its renditions' bytes are read under the window's grant", async () => {
      const { window } = await realDesktop(synthesized);
      const sid = await until(
        async () =>
          IndexSessionsResult.parse(
            await window.request("index.sessions", { nativeSessionIds: [SYNTH_NATIVE_ID] }),
          ).rows[0]?.sessionId ?? null,
        "the synthesized session indexed",
        90_000,
      );
      const doorCalls: string[] = [];
      const blobs: Blob[] = [];
      const ports = historyPortsOver(loggedDoor(window, doorCalls), {
        platform: process.platform,
        assets: {
          createObjectURL: (blob) => {
            blobs.push(blob);
            return `blob:hxs/${blobs.length}`;
          },
          revokeObjectURL: () => undefined,
        },
      });
      cleanup.push(() => ports.dispose());
      const client = await ports.sessions.open(sid);
      let entries: TimelineEntry[] = [];
      const stream = client.subscribeSession(sid, {
        onChange: (rows) => {
          entries = rows;
        },
      });
      cleanup.push(() => stream.close());
      const asset = await until(
        () => storedImageOf(entries),
        "the prompt's image in the session's rows",
        30_000,
      );

      // the member rosetta's room opens: an optimized WebP and its four
      // renditions, on rosettad's own content-addressed route
      expect(asset.media_type).toBe("image/webp");
      expect(asset.url).toBe(`/api/assets/${asset.digest}.webp`);
      expect(Object.keys(asset.image_variants ?? {}).sort()).toEqual([
        "preview",
        "rail",
        "tile",
        "tile2x",
      ]);
      // D1: the room's gate is answered — it was null, so the room asked for no
      // rendition and said "Image data was not recorded"
      expect(ports.assets.attachmentAssetUrl(asset)).toBe(asset.url);
      for (const variant of ["tile", "full"] as const) {
        expect(await ports.assets.imageAssetUrl(asset, variant)).toMatch(/^blob:hxs\/\d+$/);
      }
      expect(blobs).toHaveLength(2);
      for (const blob of blobs) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        expect(blob.type).toBe("image/webp");
        expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
        expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WEBP");
      }
      // the route refuses a read that carries no credential: those bytes rode
      // the grant
      const ticket = IndexOpenTicket.parse(
        await window.request("index.openTicket", { sessionId: sid }),
      );
      // a window's ticket names the loopback pair
      const { restUrl } = IndexEndpointSet.parse(ticket.endpoints);
      const bare = await fetch(new URL(asset.url, restUrl));
      expect(bare.status).toBe(401);
      // EL2: fieldd answered the ticket — no asset byte was asked of it
      expect([...new Set(doorCalls)]).toEqual(["index.openTicket"]);
      console.log(
        `D1_WITNESS ${JSON.stringify({
          sessionId: sid,
          digest: asset.digest,
          renditionBytes: blobs.map((blob) => blob.size),
          bareRead: bare.status,
          doorCalls: [...new Set(doorCalls)],
        })}`,
      );
      ports.sessions.close(sid);
    }, 180_000);
  },
);
