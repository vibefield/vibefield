import { once } from "node:events";
import { lstat, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { serveWebSocketSession } from "@vibecook/mille/node";
import { PORTS, WORKSPACE_LIMITS, WorkspaceGitOpen } from "@vibefield/contracts";
import { type WebSocket, WebSocketServer } from "ws";
import { isWithin } from "../paths";
import type { AttachEndReason, AttachEvent, AttachRegistration } from "../protocol";
import { type Engines, WorkerFailure } from "./engine";
import { answerGitRequest, createGitService } from "./git";

/** Resolve a requested descendant without walking/hydrating a whole mille tree. */
export async function resolveConfined(
  root: string,
  segments: readonly string[],
  file = false,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolvePath(root, segments, file),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new WorkerFailure("busy", "This folder is not answering yet")),
          WORKSPACE_LIMITS.READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePath(
  root: string,
  segments: readonly string[],
  file: boolean,
): Promise<string> {
  try {
    const base = await realpath(root);
    let target = base;
    for (const segment of segments) {
      if (!segment || segment === "." || segment === ".." || /[\\/\0]/.test(segment))
        throw new WorkerFailure("invalid", "invalid relative path");
      target = join(target, segment);
      if ((await lstat(target)).isSymbolicLink())
        throw new WorkerFailure("not-found", "no entry at that path");
    }
    const resolved = await realpath(target);
    if (!isWithin(base, resolved, process.platform))
      throw new WorkerFailure("not-found", "no entry at that path");
    if (!file && !(await stat(resolved)).isDirectory())
      throw new WorkerFailure("not-a-directory", "that path is not a folder");
    return resolved;
  } catch (error) {
    if (error instanceof WorkerFailure) throw error;
    throw new WorkerFailure("not-found", "the folder or entry is no longer available");
  }
}

/** What an attached tree session may do: read-only (FS-D5), every bound
 * named rather than left to mille's defaults — the viewport cap too (R6): a
 * larger request is clamped and the client told `VIEWPORT_CLAMPED`. */
export const TREE_SESSION_POLICY = {
  access: "read-only",
  allowSearch: true,
  maxFileBytes: WORKSPACE_LIMITS.MAX_FILE_BYTES,
  maxViewportRows: WORKSPACE_LIMITS.MAX_VIEWPORT_ROWS,
} as const;

type Leg = "tree" | "git";
type Pair = AttachRegistration & {
  stopped: boolean;
  sockets: Set<WebSocket>;
  /** the legs serving: redeemed, and the engine (tree) or `ready` (git) given */
  live: Set<Leg>;
  /** R1 (2026-10-07): armed only until both legs are live. The expiry bounds
   * REDEMPTION — a pair not established by `expiresAt` is dropped, both legs
   * together — and nothing time-based ends an established session. */
  timer: NodeJS.Timeout | null;
};
type Credential = { pair: Pair; leg: Leg };

const sessionOf = (pair: Pair) => ({
  attachId: pair.attachId,
  rootId: pair.rootId,
  clientId: pair.clientId,
});

/** Secrets remain in this process and its private control pipe, never URLs or logs. */
export class WorkspaceListener {
  readonly #server: WebSocketServer;
  readonly #engines: Engines;
  /** R6 — an attachment established or ended, for fieldd's ledger */
  readonly #onSession: (event: AttachEvent) => void;
  readonly #credentials = new Map<string, Credential>();
  readonly #pairs = new Set<Pair>();
  #stopped = false;
  #rootTimer: NodeJS.Timeout | null = null;
  #checkingRoots = false;

  private constructor(
    server: WebSocketServer,
    engines: Engines,
    onSession: (event: AttachEvent) => void,
  ) {
    this.#server = server;
    this.#engines = engines;
    this.#onSession = onSession;
    server.on("connection", (socket, request) => this.#connect(socket, request.url));
    server.on("error", () => {
      void this.close();
    });
  }

  static async start(
    engines: Engines,
    onSession: (event: AttachEvent) => void = () => {},
  ): Promise<WorkspaceListener> {
    const server = new WebSocketServer({
      host: "127.0.0.1",
      port: PORTS.WORKSPACE_SERVE,
      // Read-only clients send commands, never file bodies.
      maxPayload: WORKSPACE_LIMITS.GIT_REQUEST_BYTES,
      perMessageDeflate: false,
    });
    const listener = new WorkspaceListener(server, engines, onSession);
    await once(server, "listening");
    return listener;
  }

  get port(): number {
    const address = this.#server.address();
    if (typeof address === "string" || address === null)
      throw new Error("files listener is not ready");
    return address.port;
  }

  register(ask: AttachRegistration): void {
    if (this.#stopped || ask.expiresAt <= Date.now())
      throw new WorkerFailure("invalid", "ticket expired");
    const pairs = [...this.#pairs];
    if (
      this.#credentials.size + 2 > WORKSPACE_LIMITS.TICKETS_MAX ||
      pairs.filter((p) => p.clientId === ask.clientId).length >=
        WORKSPACE_LIMITS.SESSIONS_PER_CLIENT ||
      pairs.filter((p) => p.rootId === ask.rootId).length >= WORKSPACE_LIMITS.SESSIONS_PER_EXPORT
    )
      throw new WorkerFailure("busy", "the files service has no session slot available");
    if (
      this.#credentials.has(ask.ticket) ||
      this.#credentials.has(ask.gitTicket) ||
      ask.ticket === ask.gitTicket
    )
      throw new WorkerFailure("invalid", "duplicate ticket");
    const pair: Pair = {
      ...ask,
      stopped: false,
      sockets: new Set(),
      live: new Set(),
      timer: setTimeout(() => this.#revoke(pair, "unredeemed"), ask.expiresAt - Date.now()),
    };
    pair.timer?.unref();
    this.#pairs.add(pair);
    if (this.#rootTimer === null) {
      this.#rootTimer = setInterval(
        () => void this.#checkRoots(),
        WORKSPACE_LIMITS.ATTACHED_ROOT_CHECK_MS,
      );
      this.#rootTimer.unref();
    }
    this.#credentials.set(ask.ticket, { pair, leg: "tree" });
    this.#credentials.set(ask.gitTicket, { pair, leg: "git" });
  }

  // A port-only client may never ask a row door again. Root disappearance or
  // replacement must still close its grant without needing a roots subscriber.
  async #checkRoots(): Promise<void> {
    if (this.#checkingRoots || this.#stopped) return;
    this.#checkingRoots = true;
    try {
      const byPath = new Map<string, Pair[]>();
      for (const pair of this.#pairs) {
        const pairs = byPath.get(pair.rootPath) ?? [];
        pairs.push(pair);
        byPath.set(pair.rootPath, pairs);
      }
      await Promise.all(
        [...byPath].map(async ([path, pairs]) => {
          try {
            if ((await resolveConfined(path, [])) === path) return;
          } catch {
            /* a missing, replaced or unreadable root withdraws its grant */
          }
          for (const pair of pairs) this.#revoke(pair, "root-lost");
        }),
      );
    } finally {
      this.#checkingRoots = false;
    }
  }

  closeTicket(clientId: string, ticket: string): boolean {
    for (const pair of this.#pairs) {
      if (pair.clientId === clientId && pair.ticket === ticket) {
        this.#revoke(pair, "closed");
        return true;
      }
    }
    return false;
  }

  revokeClient(clientId: string): void {
    for (const pair of this.#pairs)
      if (pair.clientId === clientId) this.#revoke(pair, "principal-revoked");
  }

  retainRoots(ids: readonly string[]): void {
    const keep = new Set(ids);
    for (const pair of this.#pairs)
      if (!keep.has(pair.rootId)) this.#revoke(pair, "root-withdrawn");
  }

  /** A leg began serving; with both, the session is established and its
   * ticket's expiry no longer applies (R1). */
  #live(pair: Pair, leg: Leg): void {
    if (pair.stopped || pair.live.has(leg)) return;
    pair.live.add(leg);
    if (pair.live.size < 2) return;
    if (pair.timer !== null) clearTimeout(pair.timer);
    pair.timer = null;
    this.#onSession({ event: "established", ...sessionOf(pair) });
  }

  /** End a pair, both legs together. The first cause is the one recorded; an
   * established session's end is told to fieldd (R6). */
  #revoke(pair: Pair, reason: AttachEndReason | "unredeemed"): void {
    if (pair.stopped) return;
    pair.stopped = true;
    if (pair.timer !== null) clearTimeout(pair.timer);
    pair.timer = null;
    this.#credentials.delete(pair.ticket);
    this.#credentials.delete(pair.gitTicket);
    this.#pairs.delete(pair);
    if (this.#pairs.size === 0 && this.#rootTimer !== null) {
      clearInterval(this.#rootTimer);
      this.#rootTimer = null;
    }
    for (const socket of pair.sockets) socket.terminate();
    pair.sockets.clear();
    if (pair.live.size === 2 && reason !== "unredeemed")
      this.#onSession({ event: "ended", reason, ...sessionOf(pair) });
  }

  #take(
    credential: string | undefined,
    rootId: string,
    leg: Credential["leg"],
    socket: WebSocket,
  ): Pair | null {
    if (this.#stopped || credential === undefined) return null;
    const entry = this.#credentials.get(credential);
    if (
      !entry ||
      entry.leg !== leg ||
      entry.pair.rootId !== rootId ||
      entry.pair.stopped ||
      entry.pair.expiresAt <= Date.now()
    )
      return null;
    // Consume before awaiting host acquisition; concurrent replays cannot win.
    this.#credentials.delete(credential);
    entry.pair.sockets.add(socket);
    socket.once("close", () => this.#revoke(entry.pair, "leg-closed"));
    return entry.pair;
  }

  #connect(socket: WebSocket, url: string | undefined): void {
    socket.on("error", () => socket.terminate());
    if (
      this.#stopped ||
      this.#server.clients.size > WORKSPACE_LIMITS.SOCKETS_MAX ||
      (url !== "/tree" && url !== "/git")
    ) {
      socket.terminate();
      return;
    }
    const timeout = setTimeout(() => socket.terminate(), WORKSPACE_LIMITS.ATTACH_TIMEOUT_MS);
    timeout.unref();
    socket.once("close", () => clearTimeout(timeout));
    if (url === "/tree") {
      let release: (() => void) | undefined;
      const session = serveWebSocketSession(socket, {
        authorize: async (context) => {
          const pair = this.#take(context.credential, context.exportId, "tree", socket);
          if (pair === null || context.requestedAccess !== "read-only") return null;
          const held = await this.#engines.attach(pair.rootPath);
          if (pair.stopped || socket.readyState !== 1) {
            held.release();
            return null;
          }
          release = held.release;
          clearTimeout(timeout);
          this.#live(pair, "tree");
          return {
            host: held.host,
            peerId: pair.clientId,
            policy: TREE_SESSION_POLICY,
          };
        },
        openTimeoutMs: WORKSPACE_LIMITS.ATTACH_TIMEOUT_MS,
      });
      void session.closed.then(() => {
        clearTimeout(timeout);
        release?.();
      });
      return;
    }
    let pair: Pair | null = null;
    let inFlight = 0;
    socket.on("message", (data, binary) => {
      if (binary) {
        socket.terminate();
        return;
      }
      let value: unknown;
      try {
        value = JSON.parse(data.toString());
      } catch {
        socket.terminate();
        return;
      }
      if (pair === null) {
        const open = WorkspaceGitOpen.safeParse(value);
        if (!open.success) {
          socket.terminate();
          return;
        }
        pair = this.#take(open.data.credential, open.data.rootId, "git", socket);
        if (pair === null) {
          socket.terminate();
          return;
        }
        clearTimeout(timeout);
        socket.send(JSON.stringify({ type: "ready" }));
        this.#live(pair, "git");
        return;
      }
      const active = pair;
      if (active.stopped || ++inFlight > WORKSPACE_LIMITS.GIT_REQUESTS_IN_FLIGHT) {
        socket.terminate();
        return;
      }
      void resolveConfined(active.rootPath, [])
        .then((root) => {
          if (root !== active.rootPath) throw new Error("root changed");
          return answerGitRequest(createGitService(root), value);
        })
        .then(
          (answer) => {
            if (socket.readyState !== 1 || active.stopped) return;
            const encoded = JSON.stringify(answer);
            if (
              socket.bufferedAmount + Buffer.byteLength(encoded) >
              WORKSPACE_LIMITS.SOCKET_BUFFER_BYTES
            ) {
              socket.terminate();
              return;
            }
            socket.send(encoded);
          },
          () => socket.terminate(),
        )
        .finally(() => {
          inFlight -= 1;
        });
    });
  }

  async close(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    for (const pair of this.#pairs) this.#revoke(pair, "worker-stopped");
    for (const socket of this.#server.clients) socket.terminate();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }
}
