// NativeLink concurrency regressions, reproduced deterministically against a
// scripted mock mgmt server (review findings 2026-07-21):
// - a delta arriving in the SAME socket chunk as the subscribe response;
// - exactly-one reconnect after connection loss (no duplicate timers);
// - a hello failure during reconnect still converges to a single live dial.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NativeLink } from "../src/native-link";

class MockMgmtServer {
  server: Server | null = null;
  sockets = new Set<Socket>();
  connections = 0;
  failNextHello = false;
  /** when set, subscribe responses are followed by a delta IN THE SAME write */
  deltaInSameChunk = false;
  private nextSub = 1;

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
    sock.on("close", () => this.sockets.delete(sock));
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

  private onLine(sock: Socket, msg: { id: number; method: string }): void {
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

  killClients(): void {
    for (const s of this.sockets) s.destroy();
  }
  async stop(): Promise<void> {
    this.killClients();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
    this.server = null;
  }
}

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function setup(): Promise<{ mock: MockMgmtServer; link: NativeLink }> {
  const dir = mkdtempSync(join(tmpdir(), "vf-mock-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const pairingFile = join(dir, "pairing");
  writeFileSync(pairingFile, "ab".repeat(32));
  const socketPath = join(dir, "mgmt.sock");
  const mock = new MockMgmtServer(socketPath);
  await mock.start();
  cleanup.push(() => mock.stop());
  const link = new NativeLink({ socketPath, pairingFile, bootId: "test-boot" });
  cleanup.push(() => link.close());
  return { mock, link };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("NativeLink concurrency", () => {
  it("delivers a delta that arrives in the same chunk as the subscribe response", async () => {
    const { mock, link } = await setup();
    mock.deltaInSameChunk = true;
    await link.connect();
    const deltas: unknown[] = [];
    const { snapshot } = await link.subscribe("x.y.subscribe", {}, (p, kind) => {
      if (kind === "delta") deltas.push(p);
    });
    expect(snapshot).toEqual({ n: 0 });
    await sleep(50);
    expect(deltas).toEqual([{ n: 1 }]); // pre-fix: dropped (route installed after await)
  });

  it("reconnects exactly once after connection loss and replays the subscription", async () => {
    const { mock, link } = await setup();
    await link.connect();
    const snapshots: unknown[] = [];
    await link.subscribe("x.y.subscribe", {}, (p, kind) => {
      if (kind === "snapshot") snapshots.push(p);
    });
    expect(mock.connections).toBe(1);

    mock.killClients();
    await sleep(900); // first backoff is 500ms
    expect(link.connected).toBe(true);
    expect(mock.connections).toBe(2); // exactly one reconnect
    expect(snapshots).toEqual([{ n: 0 }]); // fresh snapshot on reconnect (P5)

    await sleep(400);
    expect(mock.connections).toBe(2); // and it stays that way — no duplicate timers
  });

  it("a hello failure during reconnect converges to a single live connection", async () => {
    const { mock, link } = await setup();
    await link.connect();
    expect(mock.connections).toBe(1);

    mock.failNextHello = true; // the first reconnect attempt will be rejected at hello
    mock.killClients();

    await sleep(2500); // 500ms → failed hello → 1000ms → success
    expect(link.connected).toBe(true);
    expect(mock.connections).toBe(3); // initial + rejected + successful — sequential, never parallel

    await sleep(400);
    expect(mock.connections).toBe(3);
  });
});
