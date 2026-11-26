// EY-1 (2026-11-19) — the bridge's socket (EY-S2-01B): it listens on 127.0.0.1 alone; a bare connect claims nothing;
// an upgrade that says an Origin is refused before its key is read; a key claims once and its connection reaches the
// endpoint with the run and the epoch; the frame cap is the CDP frame bound; a binary frame closes the socket; a close
// releases the key's connection; and no line logs a key or a path. Real loopback HTTP, the real keyring, a fake
// WebSocket server.
import { request } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeyring } from "../src/main/pages/core/keys";
import { CDP_FRAME_MAX_BYTES } from "../src/main/pages/core/types";
import type { Endpoint, EndpointConnection } from "../src/main/pages/endpoint/endpoint";
import {
  type BridgeServer,
  createBridgeServer,
  type WsServerLike,
  type WsSocketLike,
} from "../src/main/pages/endpoint/server";

class FakeWs implements WsSocketLike {
  readonly sent: string[] = [];
  readonly closes: { readonly code: number | undefined; readonly reason: string | undefined }[] =
    [];
  onMessage: ((data: unknown, isBinary: boolean) => void) | undefined;
  onClose: (() => void) | undefined;
  send(data: string): void {
    this.sent.push(data);
  }
  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
  }
  on(event: "message", listener: (data: unknown, isBinary: boolean) => void): this;
  on(event: "close", listener: () => void): this;
  on(event: string, listener: (...args: never[]) => void): this {
    if (event === "message")
      this.onMessage = listener as (data: unknown, isBinary: boolean) => void;
    else this.onClose = listener as () => void;
    return this;
  }
}

function harness(o: { readonly abort?: boolean } = {}) {
  const made: { readonly noServer: true; readonly maxPayload: number }[] = [];
  const sockets: FakeWs[] = [];
  const wss: WsServerLike = {
    handleUpgrade: (_req, socket, _head, done) => {
      if (o.abort === true) {
        // as ws aborts a handshake it cannot finish: an answer, the socket ended, no callback
        socket.once("finish", () => socket.destroy());
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
      const ws = new FakeWs();
      sockets.push(ws);
      done(ws);
    },
    close: () => {},
  };
  const urls: string[] = [];
  const keyring = createKeyring({ deliver: (_route, url) => url !== null && urls.push(url) });
  const claim = vi.spyOn(keyring, "claim");
  const released = vi.spyOn(keyring, "released");
  const clients: { runKey: string; epoch: number; conn: EndpointConnection }[] = [];
  const message = vi.fn(async (_frame: string) => {});
  const closed = vi.fn();
  const endpoint: Endpoint = {
    grant: () => ({ ok: true }),
    ungrant: () => {},
    connect: (runKey, epoch, conn) => {
      clients.push({ runKey, epoch, conn });
      return { message, closed };
    },
    hold: async () => {},
    putDown: async () => {},
    announce: () => 0,
  };
  const log = vi.fn();
  const server = createBridgeServer({
    keyring,
    endpoint,
    makeWss: (o) => {
      made.push(o);
      return wss;
    },
    log,
  });
  return { server, keyring, claim, released, urls, made, sockets, clients, message, closed, log };
}

let open: BridgeServer | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

/** an upgrade request: "upgraded", the refusal's status, or "error" */
function upgrade(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<string | number> {
  return new Promise((resolve) => {
    const req = request({
      host: "127.0.0.1",
      port,
      path,
      agent: false,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...headers,
      },
    });
    req.on("upgrade", (_res, socket) => {
      socket.destroy();
      resolve("upgraded");
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", () => resolve("error"));
    req.end();
  });
}

async function armed(h: ReturnType<typeof harness>) {
  const { host, port } = await h.server.listen();
  open = h.server;
  // the keyring needs a port: a server that gave none still gets a route, so each row reads the server's answer
  h.keyring.addRoute({ routeKey: "run-1", port: Math.max(port, 1) });
  const { epoch } = h.keyring.arm("run-1");
  const url = h.urls.at(-1) ?? "";
  const path = url === "" ? "" : new URL(url).pathname;
  return { host, port, epoch, path };
}

describe("the bridge's socket (EY-1 1d)", () => {
  it("listens on 127.0.0.1 alone, on a port the system gives", async () => {
    const h = harness();
    const { host, port } = await h.server.listen();
    open = h.server;
    expect(host).toBe("127.0.0.1");
    expect(port).toBeGreaterThan(0);
  });

  it("claims nothing for a bare connect that never upgrades, or a plain request", async () => {
    const h = harness();
    const { port, path } = await armed(h);
    await new Promise<void>((resolve) => {
      const s = connect(port, "127.0.0.1");
      s.on("connect", () => setTimeout(() => s.end(), 50));
      s.on("close", () => resolve());
      s.on("error", () => resolve());
    });
    const plain = await new Promise<number | string>((resolve) => {
      const req = request({ host: "127.0.0.1", port, path, agent: false }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", () => resolve("error"));
      req.end();
    });
    expect(plain).toBe(404);
    expect(h.claim).not.toHaveBeenCalled();
    expect(await upgrade(port, path)).toBe("upgraded");
  });

  it("refuses an upgrade that says an Origin before its key is read", async () => {
    const h = harness();
    const { port, path } = await armed(h);
    expect(await upgrade(port, path, { Origin: "https://a.test" })).toBe(403);
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.clients).toHaveLength(0);
    expect(h.keyring.ledger("run-1").map((row) => row.state)).toEqual(["unspent"]);
  });

  it("claims a key once: the first upgrade reaches the endpoint with the run and the epoch, a second is refused", async () => {
    const h = harness();
    const { port, path, epoch } = await armed(h);
    expect(await upgrade(port, path)).toBe("upgraded");
    expect(await upgrade(port, path)).toBe(403);
    expect(h.clients.map((c) => [c.runKey, c.epoch])).toEqual([["run-1", epoch]]);
    expect(h.claim).toHaveBeenCalledTimes(2);
  });

  it("releases a claimed key whose handshake the WebSocket server aborts", async () => {
    const h = harness({ abort: true });
    const { port, path } = await armed(h);
    expect(await upgrade(port, path)).toBe(400);
    await vi.waitFor(() => expect(h.released).toHaveBeenCalledTimes(1));
    expect(h.keyring.liveConnections("run-1")).toEqual([]);
    expect(h.clients).toHaveLength(0);
  });

  it("refuses an unknown key and connects nothing", async () => {
    const h = harness();
    const { port } = await armed(h);
    expect(await upgrade(port, `/browser/${"0".repeat(32)}/${"1".repeat(64)}`)).toBe(403);
    expect(h.clients).toHaveLength(0);
  });

  it("caps a frame at the socket at the CDP frame bound", () => {
    const h = harness();
    expect(h.made).toEqual([{ noServer: true, maxPayload: CDP_FRAME_MAX_BYTES }]);
  });

  it("hands a text frame to the endpoint whole, closes on a binary frame, and releases the key's connection at the close", async () => {
    const h = harness();
    const { port, path } = await armed(h);
    expect(await upgrade(port, path)).toBe("upgraded");
    expect(h.sockets).toHaveLength(1);
    const ws = h.sockets[0];
    ws?.onMessage?.(Buffer.from('{"id":1,"method":"Browser.getVersion"}'), false);
    expect(h.message).toHaveBeenCalledWith('{"id":1,"method":"Browser.getVersion"}');
    ws?.onMessage?.(Buffer.from([1, 2, 3]), true);
    expect(ws?.closes).toEqual([{ code: 1003, reason: "text frames only" }]);
    ws?.onClose?.();
    expect(h.closed).toHaveBeenCalledTimes(1);
    expect(h.released).toHaveBeenCalledTimes(1);
    expect(h.keyring.ledger("run-1")[0]?.releasedAt).toBeTypeOf("number");
  });

  it("closes a revoked run's sockets (1008) and no other run's", async () => {
    const h = harness();
    const { port, path } = await armed(h);
    h.keyring.addRoute({ routeKey: "run-2", port: Math.max(port, 1) });
    h.keyring.arm("run-2");
    const other = h.urls.at(-1) ?? "";
    expect(await upgrade(port, path)).toBe("upgraded");
    expect(await upgrade(port, other === "" ? "" : new URL(other).pathname)).toBe("upgraded");
    h.server.closeRun("run-1");
    expect(h.sockets.map((ws) => ws.closes)).toEqual([
      [{ code: 1008, reason: "the route was revoked" }],
      [],
    ]);
  });

  it("logs refusals by their word, never a key or a path", async () => {
    const h = harness();
    const { port, path } = await armed(h);
    await upgrade(port, path, { Origin: "https://a.test" });
    await upgrade(port, `/browser/${"0".repeat(32)}/${"1".repeat(64)}`);
    const said = JSON.stringify(h.log.mock.calls);
    expect(
      h.log.mock.calls.filter(([l]) => l.event === "desktop.pages.bridge_upgrade_refused"),
    ).toHaveLength(2);
    expect(said).not.toContain(path.split("/").at(-1) ?? "");
    expect(said).not.toContain("/browser/");
  });
});
