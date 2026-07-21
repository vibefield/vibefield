// Scripted mgmt-channel mock (exported at @vibefield/fieldd/testing): lets
// fieldd's own concurrency regressions AND fieldd-client integration tests run
// the full product spine without a cargo build. Speaks just enough of the mgmt
// protocol: hello, *.subscribe → {subId, snapshot}, everything else → {}.
import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";

export class MockMgmtServer {
  server: Server | null = null;
  sockets = new Set<Socket>();
  connections = 0;
  failNextHello = false;
  /** when set, subscribe responses are followed by a delta IN THE SAME write */
  deltaInSameChunk = false;
  /** when set, every native.mesh.* call answers UNAVAILABLE (node not up) */
  meshUnavailable = false;
  /** scripted node-side serve state (C2 reconcile tests) */
  meshServes = new Map<string, { name: string; url: string }>();
  meshAddCalls = 0;
  meshRemoveCalls = 0;
  /** simulate serves living in the node: a dropped daemon loses them */
  clearServesOnDisconnect = false;
  private nextSub = 1;
  private issued: Array<{ sock: Socket; subId: string; method: string }> = [];

  constructor(public readonly socketPath: string) {}

  async start(): Promise<void> {
    rmSync(this.socketPath, { force: true });
    this.server = createServer((sock) => this.onConn(sock));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.socketPath, resolve);
    });
  }

  private onConn(sock: Socket): void {
    this.connections += 1;
    this.sockets.add(sock);
    sock.on("close", () => {
      this.sockets.delete(sock);
      this.issued = this.issued.filter((e) => e.sock !== sock);
      if (this.clearServesOnDisconnect) this.meshServes.clear();
    });
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.trim()) this.onLine(sock, JSON.parse(line));
      }
    });
    sock.on("error", () => {});
  }

  private onLine(sock: Socket, msg: { id: number; method: string; params?: Record<string, unknown> }): void {
    if (msg.method.startsWith("native.mesh.")) {
      this.onMesh(sock, msg);
      return;
    }
    if (msg.method === "native.lifecycle.hello") {
      if (this.failNextHello) {
        this.failNextHello = false;
        sock.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: -32001, message: "nope", data: { kind: "UNAUTHORIZED", retryable: false } },
          }) + "\n",
        );
        sock.end();
        return;
      }
      sock.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { contractsVersion: "0.1.0", serverKind: "field-native", grantedScopes: [] },
        }) + "\n",
      );
      return;
    }
    if (msg.method.endsWith(".subscribe")) {
      const subId = `s${this.nextSub++}`;
      this.issued.push({ sock, subId, method: msg.method });
      const resp = JSON.stringify({
        jsonrpc: "2.0",
        id: msg.id,
        result: { subId, snapshot: { n: 0 } },
      });
      if (this.deltaInSameChunk) {
        const delta = JSON.stringify({
          jsonrpc: "2.0",
          method: msg.method.replace(/\.subscribe$/, ".delta"),
          params: { subId, payload: { n: 1 } },
        });
        sock.write(`${resp}\n${delta}\n`); // ONE write, one chunk — the race repro
      } else {
        sock.write(resp + "\n");
      }
      return;
    }
    sock.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\n");
  }

  private onMesh(sock: Socket, msg: { id: number; method: string; params?: Record<string, unknown> }): void {
    const reply = (body: object) => sock.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...body }) + "\n");
    if (this.meshUnavailable) {
      reply({
        error: {
          code: -32006,
          message: "mesh node not up",
          data: { kind: "UNAVAILABLE", retryable: true, details: { service: "mesh-gateway", state: "starting" } },
        },
      });
      return;
    }
    const p = msg.params ?? {};
    switch (msg.method) {
      case "native.mesh.serve.list":
        reply({ result: { serves: [...this.meshServes.values()] } });
        return;
      case "native.mesh.serve.add": {
        this.meshAddCalls += 1;
        const name = String(p["name"]);
        const entry = { name, url: `https://mock.ts.net/${name}` };
        this.meshServes.set(name, entry);
        reply({ result: { ...p, url: entry.url } });
        return;
      }
      case "native.mesh.serve.remove": {
        this.meshRemoveCalls += 1;
        this.meshServes.delete(String(p["name"]));
        reply({ result: { removed: true } });
        return;
      }
      case "native.mesh.store.open":
        reply({ result: { storeId: p["storeId"], slices: { "dev-self": { data: { hello: 1 }, version: 1 } } } });
        return;
      default:
        reply({ result: {} });
    }
  }

  /** Push a delta on every live subscription whose method ends with the suffix. */
  pushDelta(methodSuffix: string, payload: unknown): void {
    for (const e of this.issued) {
      if (!e.method.endsWith(methodSuffix) || e.sock.destroyed) continue;
      e.sock.write(
        JSON.stringify({
          jsonrpc: "2.0",
          method: e.method.replace(/\.subscribe$/, ".delta"),
          params: { subId: e.subId, payload },
        }) + "\n",
      );
    }
  }

  killClients(): void {
    for (const s of this.sockets) s.destroy();
  }

  async stop(): Promise<void> {
    this.killClients();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server = null;
  }
}
