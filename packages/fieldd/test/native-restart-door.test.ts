// WG-D4/WG-D5 through the daemon (draft/thinking-floor-wedge.md §11), against
// the mock mgmt server (no cargo): `system.native.restart` is the person's
// consented act under the window-held `agents.manage`, refused where this
// fieldd cannot act and on a floor that is answering; the health block is the
// contract's `NativeLinkHealth`; and while the floor is held unresponsive the
// doors that ride its mgmt path answer UNAVAILABLE {service: "native", state:
// "unresponsive"} at once. The supervisor's own rows (the ladder, the drain,
// the held state, the consent's match against the census) are
// native-supervisor.test.ts.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeLinkHealth, type Scope, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  const fns = cleanup.reverse();
  cleanup = [];
  for (const fn of fns) {
    try {
      await fn();
    } catch {
      /* already stopped */
    }
  }
});

/** Is a process alive? Signal 0 asks the kernel without delivering anything. */
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** A process that stands in for a floor this fieldd spawned: a pid it holds
 * kill authority over, and nothing a stray signal could hurt. */
function standIn(): number {
  const child: ChildProcess = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"], {
    stdio: "ignore",
  });
  cleanup.push(() => {
    child.kill("SIGKILL");
  });
  return child.pid as number;
}

async function setup(
  config: { nativePid?: number } = {},
): Promise<{ mock: MockMgmtServer; daemon: FielddDaemon }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-native-restart-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    dataPort: 0,
    ...(config.nativePid !== undefined
      ? { nativePid: config.nativePid, nativeSpawner: () => undefined }
      : {}),
  });
  cleanup.push(() => daemon.stop());
  return { mock, daemon };
}

async function connect(daemon: FielddDaemon, scopes: Scope[]): Promise<WsRpc> {
  const grant = daemon.tokens.mint(scopes, "wg-d5");
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, grant.token);
  return rpc;
}

describe("system.native.restart — the person's consented restart (WG-D5)", () => {
  it("rides agents.manage: a token without it is refused, and a call that names no sessions is no consent", async () => {
    const { daemon } = await setup();
    const attach = await connect(daemon, ["terminal.attach"]);
    expect((await attach.callErr("system.native.restart", { sessions: [] })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );

    const window = await connect(daemon, ["agents.manage"]);
    const unnamed = await window.callErr("system.native.restart", {});
    expect(unnamed.data?.kind).toBe("PRECONDITION_FAILED");
    expect(unnamed.message).toContain("sessions");
    expect(daemon.health().nativeLink.state).toBe("up");
  });

  it("a floor this fieldd adopted and that stated no pid: no kill authority, restart it outside VibeField", async () => {
    const { mock, daemon } = await setup();
    const window = await connect(daemon, ["agents.manage"]);
    const refused = await window.callErr("system.native.restart", { sessions: [] });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(refused.message).toBe(
      "no kill authority over this floor — restart it outside VibeField",
    );
    expect(mock.sockets.size, "the floor was left as it was").toBeGreaterThan(0);
    expect(daemon.health().nativeLink).toMatchObject({ state: "up", pid: null });
  });

  it("a floor this fieldd can act on that is answering is not restarted: PRECONDITION_FAILED {state}, and nothing is signalled", async () => {
    const pid = standIn();
    const { daemon } = await setup({ nativePid: pid });
    const window = await connect(daemon, ["agents.manage"]);
    const refused = await window.callErr("system.native.restart", { sessions: [] });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(refused.message).toContain("the floor is answering");
    expect(refused.data?.details).toMatchObject({ state: "up" });
    expect(alive(pid)).toBe(true);
    expect(daemon.health().nativeLink).toMatchObject({ state: "up", pid });
  });
});

describe("the native link's health block and its doors (WG-D1, WG-D4)", () => {
  it("health carries the contract's block; while the floor is held unresponsive its doors answer at once", async () => {
    const { mock, daemon } = await setup();
    expect(NativeLinkHealth.parse(daemon.health().nativeLink).state).toBe("up");

    mock.silentMethods.add("native.lifecycle.ping"); // the control path stops answering
    await until(() => daemon.health().nativeLink.state === "unresponsive", 5_000, "held");
    const held = NativeLinkHealth.parse(daemon.health().nativeLink);
    expect(held.detail).toContain("control path");
    expect(held.requestsTimedOut).toBeGreaterThanOrEqual(2);

    const before = mock.requestLog.length;
    await expect(daemon.native.request("native.mesh.peers.list", {})).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: "native", state: "unresponsive" },
    });
    expect(
      mock.requestLog.slice(before).some((r) => r.method === "native.mesh.peers.list"),
      "a refused door's call is never sent",
    ).toBe(false);

    mock.silentMethods.delete("native.lifecycle.ping");
    await until(() => daemon.health().nativeLink.state === "up", 5_000, "answering again");
    await expect(daemon.native.request("native.mesh.peers.list", {})).resolves.toBeDefined();
  });
});
