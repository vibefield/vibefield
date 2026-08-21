// THE REAL-CELL CAPTURE HARNESS — boots the real daemon pair, births a real
// session, and records the TRF1 frames the cell actually emits.
//
// The path is the product path, not a shortcut: field-native binds the cell's
// sockets, fieldd mints the ticket through `terminal.connectTicket` (GT-D10's
// sessionless door — the same one the deck redeems), and the session is created
// over the cell's own control socket with `GhostteaAutomationClient`, which is
// what the renderer runtime does. The only thing this harness does that the app
// does not is open the frames socket from Node instead of from the bridge, and
// that is a transport difference, not a product one: the bytes on that socket
// are the cell's, byte for byte.
//
// Why not `terminal.create`: fieldd's create hardcodes 100x30
// (`packages/fieldd/src/terminal-service.ts:71-72,411-412`) and supplies its own
// argv, so a corpus built through it could not vary geometry or run a fixture
// program. `connectTicket` + `client.createSession` gives the harness the
// geometry and the executable while keeping fieldd as the door that mints.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import { LAYOUT, pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { connectFramesSocket, type FramesSocket } from "./frames-client";
import type { Trf1FrameRecord } from "./trf1-container";

/** The cargo artifact for `-p field-native`. */
export function nativeBinPath(root: string, platform: NodeJS.Platform = process.platform): string {
  return join(root, "target", "debug", platform === "win32" ? "field-native.exe" : "field-native");
}

/**
 * A temp data root short enough for what gets bound underneath it.
 *
 * `/tmp` deliberately, NOT `tmpdir()`: macOS hands out a ~50-byte
 * `/var/folders/...` prefix and the cell's endpoints land at
 * `<root>/native/run/termframe.sock`, over the ~104-byte `sun_path` ceiling, so
 * field-native cannot bind at all. This is the same rule
 * `packages/fieldd/test/native-harness.ts` carries, restated here because a
 * tooling package may not import a test-local helper.
 */
export function shortTmpRoot(prefix: string): string {
  return mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", prefix));
}

function nativeEndpoint(dataDir: string, socketFile: string): string {
  return process.platform === "win32"
    ? pipeEndpointFor(dataDir, socketFile)
    : join(dataDir, ...LAYOUT.NATIVE_RUN_DIR, socketFile);
}

/** Wait until an endpoint ACCEPTS a connection — strictly stronger than file
 * presence, which is true between `bind` and `listen`. */
export async function waitForEndpoint(endpoint: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = createConnection(endpoint);
      const done = (value: boolean): void => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(value);
      };
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`endpoint never accepted: ${endpoint}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export interface RunningFloor {
  readonly dataDir: string;
  readonly child: ChildProcess;
  stop(): void;
}

/** Spawn field-native on a private data root and wait for its mgmt endpoint. */
export async function startNativeFloor(root: string): Promise<RunningFloor> {
  const dataDir = shortTmpRoot("vf-tperf-");
  const child = spawn(nativeBinPath(root), [], {
    env: {
      ...process.env,
      FIELD_NATIVE_DATA_DIR: dataDir,
      FIELD_LOG_DIR: join(dataDir, "logs"),
      FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
    },
    stdio: "ignore",
  });
  await waitForEndpoint(nativeEndpoint(dataDir, SOCKETS.MGMT), 20_000);
  return {
    dataDir,
    child,
    stop(): void {
      child.kill("SIGKILL");
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** The recorder's single view. One view is exactly right: the corpus wants the
 * cell's once-per-session encode (TP-L-B'), and a second view would change
 * nothing about the frames while adding a second geometry claimant. */
const VIEW_ID = "terminal-perf-recorder";

export interface SessionSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cols: number;
  readonly rows: number;
  readonly cwd?: string;
}

export interface CaptureResult {
  readonly frames: Trf1FrameRecord[];
  /** Non-frame JSON the daemon sent. A `frame-gap` here means the recording has
   * a HOLE, and the manifest must say so rather than quietly ship it. */
  readonly messages: Record<string, unknown>[];
  readonly sessionId: string;
  readonly exited: boolean;
}

export interface CaptureOptions {
  readonly ticket: { controlSocket: string; frameSocket: string; token: string };
  readonly session: SessionSpec;
  /** Sent to the pty after the session is born, e.g. the keys that drive vim. */
  readonly drive?: (client: GhostteaAutomationClient, sessionId: string) => Promise<void>;
  /** How long to record after the driving finishes (or the program exits). */
  readonly settleMs?: number;
  /** Hard ceiling on the recording. */
  readonly timeoutMs?: number;
  readonly clientBuild?: string;
}

/**
 * Record one session's frame stream.
 *
 * Ordering is load-bearing: the frames socket is connected and SUBSCRIBED before
 * the session exists, so no frame of the session's life is missed. Subscribing
 * to a handle that has not been minted yet is the same call the runtime makes
 * when a pane mounts ahead of its session — the subscription is a set, re-sent
 * whole (`ghosttea-react/dist/runtime.js:462-471`), so the harness simply
 * re-sends it once the handle is known.
 */
export async function captureSession(options: CaptureOptions): Promise<CaptureResult> {
  const { ticket, session } = options;
  const settleMs = options.settleMs ?? 1_500;
  const timeoutMs = options.timeoutMs ?? 120_000;

  const frames: Trf1FrameRecord[] = [];
  const messages: Record<string, unknown>[] = [];
  const errors: Error[] = [];
  let firstFrameAtUs: number | null = null;

  let socket: FramesSocket | undefined;
  const client = new GhostteaAutomationClient(
    { controlSocket: ticket.controlSocket, authToken: ticket.token },
    { clientBuild: options.clientBuild ?? "vibefield-terminal-perf" },
  );

  try {
    socket = await connectFramesSocket(ticket.frameSocket, ticket.token, {
      onFrame(bytes, receivedAtUs) {
        firstFrameAtUs ??= receivedAtUs;
        frames.push({ offsetUs: receivedAtUs - firstFrameAtUs, bytes });
      },
      onMessage(message) {
        messages.push(message);
      },
      onError(error) {
        errors.push(error);
      },
    });

    await client.connect();
    const summary = await client.createSession({
      executable: session.executable,
      args: [...session.args],
      ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
      environment: { mode: "inherit" },
      cols: session.cols,
      rows: session.rows,
      persistence: "terminate-with-app",
      programKind: "application",
      ownerId: "vibefield-terminal-perf",
    });

    socket.subscribe([summary.handle]);

    // THE STEP THAT IS NOT OPTIONAL, and the one nothing in the TS packages
    // hints at: a frames SUBSCRIPTION does not make a cell render. The session's
    // model is only refreshed — and `TerminalEffect::FrameReady` only published
    // — while `session.has_active_views()` holds
    // (ghosttea-0.10.1/src/session.rs:1630,1690). Views are created by an
    // `attach-session` control command (`service.rs:2482` -> `attach_view`), and
    // the renderer runtime issues exactly this after its subscription resolves
    // (`ghosttea-react/dist/runtime.js:826-831`). Without it the socket
    // authenticates, the subscribe is ACKED, and zero frames ever arrive —
    // which is precisely what the first capture run recorded.
    const attached = await client.request({
      type: "attach-session",
      sessionId: summary.id,
      viewId: VIEW_ID,
    });
    if (attached.type !== "view-attached") {
      throw new Error(`the cell refused the view attachment: ${JSON.stringify(attached)}`);
    }

    if (options.drive) await options.drive(client, summary.id);

    let exited = false;
    try {
      await client.waitForExit(summary.id, timeoutMs);
      exited = true;
    } catch {
      // A program that outlives the budget (`top`, a shell) is normal for a
      // corpus entry: it is terminated below and the recording is whatever it
      // produced, which the manifest reports as `exited: false`.
    }

    // Record past the end: the cell coalesces, so the frame carrying the last
    // damage can arrive after the process is gone.
    await new Promise((resolve) => setTimeout(resolve, settleMs));

    if (!exited) {
      try {
        await client.terminate(summary.id, "application");
      } catch {
        /* already gone is the normal race */
      }
    }

    if (errors.length > 0) throw errors[0];
    return { frames, messages, sessionId: summary.id, exited };
  } finally {
    socket?.close();
    client.dispose();
  }
}
