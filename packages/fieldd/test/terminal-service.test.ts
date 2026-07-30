// TerminalService (NF-3/NF-6): the fieldd seam driven through the mock mgmt
// server (no cargo). Covers the NF-D8 endpoints capture from the hello ack,
// the D6 ticket (endpoints present/absent, both honest), the observed-
// inventory stream into terminal.list/get, the terminal.attach scope gate, the
// terminalHost capability flip, the NF-6 re-arm law (a failed observed
// subscribe neither fatals the boot nor stays dead forever), and the NF-6
// transport-death honesty law (a dead control socket is UNAVAILABLE, never the
// benign already-gone race). The live create/terminate/attach path needs a
// real PTY authority and lives in terminal-seam.test.ts.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DeviceInfo,
  TerminalEndpoints,
  TerminalInfo,
  TerminalTicket,
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
  controlSocket: "/mock/native/run/terminal-control.sock",
  frameSocket: "/mock/native/run/terminal-frame.sock",
  authToken: "mock-per-boot-token",
};

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

    const grant = daemon.tokens.mint(["terminal.attach"], "terminal-test");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, grant.token);

    for (const [method, params] of [
      ["terminal.openTicket", { sessionId: "s1" }],
      ["terminal.create", {}],
      ["terminal.terminate", { sessionId: "s1" }],
    ] as const) {
      const err = await rpc.callErr(method, params);
      expect(err.data?.kind, method).toBe("UNAVAILABLE");
    }
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

  it("a control socket dying mid-terminate is UNAVAILABLE, never 'already gone' (NF-6)", async () => {
    // A fake ghosttead control endpoint speaking just enough protocol:
    // LE-u32 framing, bare-token auth → "ok", answer the hello, then DESTROY
    // the socket on the terminate request — the review's measured hole (a
    // SIGKILLed floor read as {terminated:false} and audited success).
    const dir = mkdtempSync(join("/tmp", "vf-fake-"));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const socketPath = join(dir, "control.sock");
    const packet = (bytes: Buffer): Buffer => {
      const len = Buffer.alloc(4);
      len.writeUInt32LE(bytes.length);
      return Buffer.concat([len, bytes]);
    };
    const server: Server = createServer((sock: Socket) => {
      let buf = Buffer.alloc(0);
      let authed = false;
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
          if (msg.type === "hello") {
            sock.write(
              packet(
                Buffer.from(
                  JSON.stringify({
                    requestId: msg.requestId,
                    type: "hello",
                    protocolMajor: 1,
                    protocolMinor: 7,
                  }),
                ),
              ),
            );
          } else if (msg.type === "terminate") {
            sock.destroy(); // the floor dies mid-call
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    cleanup.push(() => new Promise<void>((r) => server.close(() => r())));

    const endpoints: TerminalEndpoints = {
      controlSocket: socketPath,
      frameSocket: join(dir, "frame.sock"),
      authToken: "fake-token",
    };
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
