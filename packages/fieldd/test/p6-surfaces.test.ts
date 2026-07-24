import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { helloAs, WsRpc } from "./ws-rpc";

// PLUG-P6 — the HANDLER caller matrix for the new product surfaces (the
// services themselves are unit-proven; this is the daemon's gate law):
// endpoint registration is a plugin surface, MCP server policy is a local
// plugins.manage surface, and the read folds answer to workspace.read.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function setup(): Promise<{ daemon: FielddDaemon }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-p6-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0 });
  cleanup.push(() => daemon.stop());
  return { daemon };
}

async function openRpc(port: number): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

describe("P6 product surfaces — the caller matrix", () => {
  it("endpoint/process surfaces refuse non-plugin principals; reads answer", async () => {
    const { daemon } = await setup();
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");

    // §17.3/§17.1 — plugin-principal surfaces: the SHELL (full scopes) is
    // still not a plugin; the handler refuses before any service logic
    const reg = await rpc.callErr("services.registerEndpoint", {
      serviceId: "x.some.plugin.api",
      endpoint: { protocol: "http", port: 8080 },
      health: { path: "/health", intervalMs: 5000 },
      expose: { app: true, mesh: false, mcp: false },
    });
    expect(reg.data?.kind).toBe("FORBIDDEN_SCOPE");
    const spawn = await rpc.callErr("process.spawn", {
      executable: "/bin/sh",
      args: ["-c", "true"],
      restart: "never",
    });
    expect(spawn.data?.kind).toBe("FORBIDDEN_SCOPE");

    // the plugins.manage READ views answer honestly empty
    expect(await rpc.call("services.health", {})).toMatchObject({ endpoints: [] });
    expect(await rpc.call("process.stat", {})).toEqual({ processes: [] });

    // §17.4 — user MCP server policy is a local plugins.manage surface
    const added = (await rpc.call("mcp.servers.add", {
      id: "demo",
      transport: { kind: "http", url: "http://127.0.0.1:9/mcp" },
    })) as { serverKey: string; state: string };
    expect(added.serverKey).toBe("user/demo");
    expect(added.state).toBe("stopped");
    const listed = (await rpc.call("mcp.servers.list", {})) as { servers: unknown[] };
    expect(listed.servers).toHaveLength(1);
    expect(await rpc.call("mcp.tools.list", {})).toEqual({ tools: [] });
    await rpc.call("mcp.servers.remove", { serverKey: "user/demo" });

    // a renderer-grade token (no plugins.manage) cannot set MCP server policy
    const grant = daemon.tokens.mint(["canvas.read", "mcp.consume"], "window");
    const rpc2 = await openRpc(daemon.controlPort);
    await helloAs(rpc2, grant.token, "renderer");
    const denied = await rpc2.callErr("mcp.servers.add", {
      id: "sneaky",
      transport: { kind: "http", url: "http://127.0.0.1:9/mcp" },
    });
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");
    // but mcp.consume reads pass the scope gate
    expect(await rpc2.call("mcp.tools.list", {})).toEqual({ tools: [] });
  });
});
