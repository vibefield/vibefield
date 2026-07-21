// Track A product surface, against the mock mgmt server (no cargo): run files
// (shell bootstrap contract), window-token minting rules, product-side
// subscriptions, and the health aggregator's honest link-down/up stream.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon, type FielddHealth } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { WsRpc, helloAs, until } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function setup(): Promise<{ dataDir: string; mock: MockMgmtServer; daemon: FielddDaemon }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-prod-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(join(dataDir, "native", "run", "mgmt.sock"));
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0 });
  cleanup.push(() => daemon.stop());
  return { dataDir, mock, daemon };
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

describe("run files (shell bootstrap contract)", () => {
  it("writes a 0600 shell.token + product.json, and removes them on stop", async () => {
    const { dataDir, daemon } = await setup();
    const runDir = join(dataDir, "fieldd", "run");
    const tokenPath = join(runDir, "shell.token");
    const productPath = join(runDir, "product.json");

    expect(readFileSync(tokenPath, "utf8")).toBe(daemon.shellToken);
    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);

    const product = JSON.parse(readFileSync(productPath, "utf8"));
    expect(product.port).toBe(daemon.controlPort);
    expect(product.pid).toBe(process.pid);
    expect(product.bootId).toBe(daemon.bootId);
    expect(Number.isInteger(product.startedAt)).toBe(true);

    await daemon.stop();
    expect(existsSync(tokenPath)).toBe(false);
    expect(existsSync(productPath)).toBe(false);
  });
});

describe("system.mintWindowToken", () => {
  it("shell mints a subset window token that works but cannot mint further", async () => {
    const { daemon } = await setup();
    const shell = await openRpc(daemon.controlPort);
    await helloAs(shell, daemon.shellToken, "shell-main");

    const minted = (await shell.call("system.mintWindowToken", {
      scopes: ["canvas.read"],
      label: "window-1",
    })) as { token: string; scopes: string[] };
    expect(minted.scopes).toEqual(["canvas.read"]);

    // the window token authenticates…
    const win = await openRpc(daemon.controlPort);
    await helloAs(win, minted.token);
    const health = (await win.call("system.health", {})) as FielddHealth;
    expect(health.nativeConnected).toBe(true);

    // …but lacks tokens.mint: the registry scope gate refuses it
    const denied = await win.callErr("system.mintWindowToken", { scopes: [], label: "nope" });
    expect(denied.data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("refuses escalation beyond the caller's own grant and unknown scopes", async () => {
    const { daemon } = await setup();
    // a caller that can mint but holds nothing else
    const narrow = daemon.tokens.mint(["tokens.mint"], "narrow");
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, narrow.token, "shell-main");

    const escalate = await rpc.callErr("system.mintWindowToken", { scopes: ["canvas.read"], label: "w" });
    expect(escalate.data?.kind).toBe("FORBIDDEN_SCOPE");

    const junk = await rpc.callErr("system.mintWindowToken", { scopes: ["not.a.scope"], label: "w" });
    expect(junk.data?.kind).toBe("PRECONDITION_FAILED");

    const malformed = await rpc.callErr("system.mintWindowToken", { label: 42 });
    expect(malformed.data?.kind).toBe("PRECONDITION_FAILED");
  });
});

describe("system.health.subscribe (aggregated stream)", () => {
  it("streams native deltas, link-down flips, link-up recovery — and unsubscribes cleanly", async () => {
    const { mock, daemon } = await setup();
    const rpc = await openRpc(daemon.controlPort);
    await helloAs(rpc, daemon.shellToken, "shell-main");

    const sub = (await rpc.call("system.health.subscribe", {})) as { subId: string; snapshot: FielddHealth };
    expect(sub.snapshot.nativeConnected).toBe(true);
    expect(sub.snapshot.native).toEqual({ n: 0 });

    const payloads = (): FielddHealth[] =>
      rpc.notifications
        .filter((n) => n.method === "system.health.delta" && n.params.subId === sub.subId)
        .map((n) => n.params.payload as FielddHealth);

    // native-plane delta flows through the aggregator
    mock.pushDelta("health.subscribe", { n: 7 });
    await until(() => payloads().some((p) => (p.native as { n?: number } | null)?.n === 7));

    // link down → an honest nativeConnected:false delta, immediately
    mock.killClients();
    await until(() => payloads().some((p) => p.nativeConnected === false));

    // link back (mock still listening) → reconnect + fresh snapshot → true again
    await until(() => {
      const ps = payloads();
      const lastDown = ps.map((p) => p.nativeConnected).lastIndexOf(false);
      return ps.slice(lastDown + 1).some((p) => p.nativeConnected === true);
    }, 6000);

    // unsubscribe stops the stream
    const removed = (await rpc.call("system.unsubscribe", { subId: sub.subId })) as { removed: boolean };
    expect(removed.removed).toBe(true);
    const countAfter = payloads().length;
    mock.pushDelta("health.subscribe", { n: 99 });
    await new Promise((r) => setTimeout(r, 200));
    expect(payloads().length).toBe(countAfter);

    const again = (await rpc.call("system.unsubscribe", { subId: sub.subId })) as { removed: boolean };
    expect(again.removed).toBe(false);
  });
});
