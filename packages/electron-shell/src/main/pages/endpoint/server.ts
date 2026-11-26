// EY-1 (2026-11-19) — THE BRIDGE'S SOCKET (track EY; EY-S2-01B). The run endpoint listens on 127.0.0.1 alone, on a
// port the system gives, and a connection reaches the endpoint only through a WebSocket upgrade whose one-use key the
// keyring claims (`/browser/<routeId>/<key>`, core/keys.ts): the first upgrade that presents a live key spends it, and
// every later one is refused. A bare TCP connect that never upgrades claims nothing, and a plain request is answered
// 404.
//
// AN UPGRADE CARRYING AN `Origin` IS REFUSED BEFORE ITS KEY IS READ. A page in any browser on this machine can dial
// ws://127.0.0.1; a browser always says the page's Origin, and the engine, a client of its own, says none. So no page
// can hold a socket here, even one that learned the port and the key.
//
// The socket's frame cap is the CDP frame bound (maxPayload), set where the socket is made. A binary frame closes the
// connection (1003); a text frame goes to the endpoint whole. A connection's close tells the endpoint and releases the
// key's connection. No line logs a key or a path: refusals are counted by their reason's word.
//
// The WebSocket server is handed in (`ws`'s WebSocketServer in noServer mode), so this module holds the handshake's
// order and nothing of the protocol's framing.

import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { CDP_FRAME_MAX_BYTES, type Keyring } from "../core/types";
import type { Endpoint } from "./endpoint";

/** The bridge listens here and nowhere else. */
export const BRIDGE_HOST = "127.0.0.1";

/** One accepted socket, as `ws` gives it. */
export interface WsSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: unknown, isBinary: boolean) => void): unknown;
  on(event: "close", listener: () => void): unknown;
}

/** `ws`'s WebSocketServer in noServer mode: it finishes a handshake this module has admitted. */
export interface WsServerLike {
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    done: (ws: WsSocketLike) => void,
  ): void;
  close(): void;
}

export interface BridgeServerDeps {
  readonly keyring: Keyring;
  readonly endpoint: Endpoint;
  /** makes the WebSocket server; the frame cap is set here, at the socket */
  readonly makeWss: (o: { readonly noServer: true; readonly maxPayload: number }) => WsServerLike;
  /** counts and words only: never a key, a path or a frame */
  readonly log: (line: { readonly event: string; readonly [k: string]: unknown }) => void;
}

export interface BridgeServer {
  listen(): Promise<{ readonly host: string; readonly port: number }>;
  close(): Promise<void>;
  /** a revoked route: the run's live sockets are closed (1008), no other run's */
  closeRun(runKey: string): void;
}

const STATUS_TEXT = { 400: "Bad Request", 403: "Forbidden" } as const;

function textOf(data: unknown): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return String(data);
}

export function createBridgeServer(deps: BridgeServerDeps): BridgeServer {
  const wss = deps.makeWss({ noServer: true, maxPayload: CDP_FRAME_MAX_BYTES });
  let connections = 0;
  /** the upgraded sockets: no longer the HTTP server's, so its close does not end them; this module's close does */
  const live = new Set<Duplex>();
  /** the accepted sockets by the run whose key they spent */
  const byRun = new Map<string, Set<WsSocketLike>>();
  const http = createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });

  const refuse = (socket: Duplex, status: 400 | 403, why: string): void => {
    deps.log({ event: "desktop.pages.bridge_upgrade_refused", why });
    if (socket.destroyed) return;
    socket.once("finish", () => socket.destroy());
    socket.end(
      `HTTP/1.1 ${status} ${STATUS_TEXT[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  };

  http.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    // a page in a browser says its Origin; the engine says none
    if (req.headers.origin !== undefined) {
      refuse(socket, 403, "origin");
      return;
    }
    if ((req.headers.upgrade ?? "").toLowerCase() !== "websocket") {
      refuse(socket, 400, "not-websocket");
      return;
    }
    connections += 1;
    const connId = `vf-conn-${connections}`;
    const claim = deps.keyring.claim(req.url ?? "", connId);
    if (!claim.ok) {
      refuse(socket, 403, claim.verdict.code);
      return;
    }
    live.add(socket);
    // the key is spent at the claim; a handshake the WebSocket server aborts (a bad key or version) never reaches the
    // callback, so its claim is released when its socket closes
    let upgraded = false;
    socket.once("close", () => {
      live.delete(socket);
      if (!upgraded) deps.keyring.released(connId);
    });
    wss.handleUpgrade(req, socket, head, (ws) => {
      upgraded = true;
      // the route is the run's: the broker adds a run's route under the run's key
      const client = deps.endpoint.connect(claim.routeKey, claim.epoch, {
        send: (frame) => ws.send(frame),
        close: (code, reason) => ws.close(code, reason),
      });
      deps.log({ event: "desktop.pages.bridge_connected", epoch: claim.epoch });
      const runs = byRun.get(claim.routeKey) ?? new Set<WsSocketLike>();
      runs.add(ws);
      byRun.set(claim.routeKey, runs);
      // Frames are not awaited one by one, and order still holds: each frame's handler runs synchronously up to its
      // first await, which for a page command is its session's send, so commands reach Chromium in the order they
      // came. A command that awaits first (an attach, an auto-attach) answers before the client can name what it made.
      ws.on("message", (data: unknown, isBinary: boolean) => {
        if (isBinary) {
          ws.close(1003, "text frames only");
          return;
        }
        client.message(textOf(data)).catch(() => {
          deps.log({ event: "desktop.pages.bridge_frame_failed" });
          ws.close(1011, "the bridge failed");
        });
      });
      ws.on("close", () => {
        runs.delete(ws);
        client.closed();
        deps.keyring.released(connId);
        deps.log({ event: "desktop.pages.bridge_closed", epoch: claim.epoch });
      });
    });
  });

  return {
    listen: () =>
      new Promise((resolve, reject) => {
        http.once("error", reject);
        http.listen(0, BRIDGE_HOST, () => {
          http.off("error", reject);
          const address = http.address() as AddressInfo;
          resolve({ host: address.address, port: address.port });
        });
      }),
    close: () =>
      new Promise((resolve) => {
        wss.close();
        http.close(() => resolve());
        http.closeAllConnections();
        for (const socket of live) socket.destroy();
      }),
    closeRun: (runKey) => {
      for (const ws of byRun.get(runKey) ?? []) ws.close(1008, "the route was revoked");
    },
  };
}
