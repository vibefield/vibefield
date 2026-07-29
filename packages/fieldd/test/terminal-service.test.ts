// TerminalService (NF-3): the fieldd seam driven through the mock mgmt server
// (no cargo). Covers the NF-D8 endpoints capture from the hello ack, the D6
// ticket (endpoints present/absent, both honest), the observed-inventory
// stream into terminal.list/get, the terminal.attach scope gate, and the
// terminalHost capability flip. The live create/terminate/attach path needs a
// real PTY authority and lives in terminal-seam.test.ts.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceInfo, TerminalInfo, TerminalTicket } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { helloAs, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
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
