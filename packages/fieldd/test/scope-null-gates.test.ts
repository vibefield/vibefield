// D36 (2026-10-01) — the scope-null product subscriptions, at the door. A
// `scope: null` row passes every hello'd principal through the registry's gate
// — a phone included — and only its HANDLER can narrow it; SP-1's census
// (contracts registry.test.ts) names the three and the gate each one has. This
// file proves those gates against the real daemon the way each caller arrives.
//
// The finding it closes (DS wave 2, 02:15 (3)): `system.health.subscribe` is
// `local` by locality, yet a phone could open it — D36's door wall refuses a
// `local` method to a PEER DAEMON only, and the health stream had no gate of
// its own. It streams this desktop's whole judgment of its planes (the floor,
// rosettad's phase, the doc host, plugins, logging) to whoever holds it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACTS_VERSION, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { helloAs, until, WsRpc } from "./ws-rpc";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* an already-stopped daemon is fine */
    }
  }
  cleanup = [];
});

async function boot(): Promise<{ daemon: FielddDaemon; mock: MockMgmtServer }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-scope-null-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  writeLinkFixture(dataDir, TEST_LOGIN);
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  // D1 — the roster vouches for a peer desktop, so a hello from its node is
  // minted `peer-fieldd` (the transport's fact, never the claim's)
  mock.meshPeers = [
    registryPeer({ nodeId: "node-c", deviceId: "dev-c", name: "device-c", login: TEST_LOGIN }),
  ];
  mock.storeSlices = new Map<string, unknown>([["dev-c", desktopSlice("dev-c", "device-c")]]);
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  await until(() => mock.meshServes.get("product") !== undefined, 15_000);
  return { daemon, mock };
}

async function open(url: string, headers?: Record<string, string>): Promise<WsRpc> {
  const ws = new WebSocket(url, headers ? { headers } : {});
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

/** The door the way the SIDECAR delivers a tailnet caller: the route secret
 * joined, the WhoIs login (and, for a desktop, its node id) injected. */
async function tailnet(
  daemon: FielddDaemon,
  mock: MockMgmtServer,
  headers: Record<string, string>,
  clientKind: string,
): Promise<WsRpc> {
  const rpc = await open(`ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mock)}`, headers);
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind,
    ...(clientKind === "peer-fieldd" ? { deviceId: "dev-c" } : {}),
  });
  return rpc;
}

const phone = (daemon: FielddDaemon, mock: MockMgmtServer) =>
  tailnet(daemon, mock, { "Tailscale-User-Login": TEST_LOGIN }, "ios");

describe("D36 — system.health.subscribe streams to this device's own principals only", () => {
  it("the phone (a self tailnet principal) is refused, by name of the law", async () => {
    const { daemon, mock } = await boot();
    const rpc = await phone(daemon, mock);
    const refused = await rpc.callErr("system.health.subscribe", {});
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(refused.data?.retryable).toBe(false);
    expect(refused.message).toMatch(/D36/);
    expect(refused.data?.details).toEqual({ method: "system.health.subscribe" });
  }, 30_000);

  it("a guest and a peer daemon are refused too (the door's own walls; the gate is their suspenders)", async () => {
    const { daemon, mock } = await boot();
    const guest = await tailnet(
      daemon,
      mock,
      { "Tailscale-User-Login": "else@example.com" },
      "ios",
    );
    expect((await guest.callErr("system.health.subscribe", {})).data?.kind).toBe("FORBIDDEN_SCOPE");
    await until(() => daemon.devices.isDocHost("dev-c"), 8_000);
    const peer = await tailnet(
      daemon,
      mock,
      { "Tailscale-User-Login": TEST_LOGIN, "Tailscale-Node-Id": "node-c" },
      "peer-fieldd",
    );
    expect((await peer.callErr("system.health.subscribe", {})).data?.kind).toBe("FORBIDDEN_SCOPE");
  }, 30_000);

  it("a window and the shell get the stream, as they always did", async () => {
    const { daemon } = await boot();
    const win = await open(`ws://127.0.0.1:${daemon.controlPort}`);
    // a window holding no scope at all: the stream is scope-null, the gate is
    // WHO the caller is, never what it was granted
    await helloAs(win, daemon.tokens.mint([], "health-window").token);
    const sub = (await win.call("system.health.subscribe", {})) as {
      subId: string;
      snapshot: { fieldd: { state: string } };
    };
    expect(sub.snapshot.fieldd.state).toBe("up");
    const shell = await open(`ws://127.0.0.1:${daemon.controlPort}`);
    await helloAs(shell, daemon.shellToken, "shell-main");
    const shellSub = (await shell.call("system.health.subscribe", {})) as {
      snapshot: { fieldd: { state: string } };
    };
    expect(shellSub.snapshot.fieldd.state).toBe("up");
  }, 30_000);
});

describe("SP-1's census of scope-null subscriptions holds at the door", () => {
  it("the phone is refused every one of the three", async () => {
    const { daemon, mock } = await boot();
    const rpc = await phone(daemon, mock);
    for (const method of [
      "system.health.subscribe",
      "storage.settings.subscribe",
      "process.subscribe",
    ]) {
      const refused = await rpc.callErr(method, {});
      expect(refused.data?.kind, method).toBe("FORBIDDEN_SCOPE");
    }
  }, 30_000);
});
