// DS-2 (2026-09-30) — the facts ground, witnessed between TWO REAL daemons
// over loopback (the PeerLink e2e's harness, with one difference that removes
// its recorded divergence: each mock pins its OWN mesh identity, "dev-a" and
// "dev-b", so a window on A can route `{device: "dev-b"}` and B serves it as
// itself). The sidecar sim plays B's sidecar: it forwards A's dial to B's
// loopback door with the route secret and injects A's WhoIs login AND node id,
// which B correlates to "dev-a" through its own roster.
//
// The witnesses (thinking-desktop-sync-plane.md §11, DS-2): a forwarded act is
// audited with BOTH names (the calling node and the window behind it); a
// forward cut mid-flight reads "outcome unknown" and its retry applies once; a
// window carrying the envelope is refused; the locality wall still refuses
// guests and still keeps a `local` method on its device.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACTS_VERSION, SOCKETS } from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { verifyAuditSegment } from "../src/audit-service";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productPathSecret, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

const LOGIN = "me@jamesyong42.com";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

async function startMock(dataDir: string, deviceId: string): Promise<MockMgmtServer> {
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.meshDeviceId = deviceId; // this daemon's OWN mesh identity (D30)
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

function makeDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-ds2-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  writeLinkFixture(dataDir, LOGIN); // one person's two desktops (D35)
  return dataDir;
}

/** B's sidecar, simulated: A's dial to B's derived coordinate lands on B's
 * loopback door with the route secret, carrying A's login and A's NODE id. The
 * sockets are kept so a test can cut one mid-flight. */
function sidecar(loopback: () => string): { ctor: WsCtor; sockets: WebSocket[] } {
  const sockets: WebSocket[] = [];
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      const target = url.includes("device-b.tailnet.ts.net") ? loopback() : "ws://127.0.0.1:1/";
      super(url.includes(".ts.net") ? target : url, {
        headers: { "Tailscale-User-Login": LOGIN, "Tailscale-Node-Id": "node-a" },
      });
      sockets.push(this);
    }
  }
  return { ctor: SidecarSim, sockets };
}

async function openRpc(url: string, headers?: Record<string, string>): Promise<WsRpc> {
  const ws = new WebSocket(url, headers !== undefined ? { headers } : {});
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

interface Pair {
  A: FielddDaemon;
  B: FielddDaemon;
  sockets: WebSocket[];
  bDoor: string;
  /** B's interrupts, as its runtime saw them; `hold` parks the next ones */
  interrupts: () => number;
  hold: () => () => void;
}

async function bootPair(): Promise<Pair> {
  const dirB = makeDataDir();
  const mockB = await startMock(dirB, "dev-b");
  // B's roster lists A, so B can correlate the node id A's sidecar names
  mockB.meshPeers = [
    {
      id: "node-a",
      deviceId: "dev-a",
      name: "device-a",
      online: true,
      whois: { login: LOGIN, deviceName: "device-a.tailnet.ts.net" },
    },
  ];
  const B = await bootstrap({ dataDir: dirB, controlPort: 0, dataPort: 0 });
  cleanup.push(() => B.stop());
  await until(
    () => B.health().mesh.serves.some((s) => s.name === "product" && s.url !== undefined),
    8000,
  );
  const bDoor = `ws://127.0.0.1:${B.controlPort}/t/${productPathSecret(mockB)}`;

  const { ctor, sockets } = sidecar(() => bDoor);
  const dirA = makeDataDir();
  const mockA = await startMock(dirA, "dev-a");
  mockA.meshPeers = [
    {
      id: "node-b",
      deviceId: "dev-b",
      name: "device-b",
      online: true,
      whois: { login: LOGIN, deviceName: "device-b.tailnet.ts.net" },
    },
  ];
  const A = await bootstrap({ dataDir: dirA, controlPort: 0, dataPort: 0, peerWebSocket: ctor });
  cleanup.push(() => A.stop());

  await until(() => A.devices.currentDeviceId() === "dev-a", 8000);
  await until(() => B.devices.currentDeviceId() === "dev-b", 8000);
  await until(() => A.devices.get("dev-b") !== undefined, 8000);
  await until(() => B.devices.deviceIdByNodeId("node-a") === "dev-a", 8000);

  // B's runtime, scripted: count the interrupts that really ran; park them on
  // demand so a test can cut the forward while one is in flight
  let count = 0;
  let gate: Promise<void> | null = null;
  (B.agents as unknown as { interrupt: (p: unknown) => Promise<unknown> }).interrupt = async () => {
    count += 1;
    if (gate !== null) await gate;
    return { accepted: true };
  };
  return {
    A,
    B,
    sockets,
    bDoor,
    interrupts: () => count,
    hold: () => {
      let release: () => void = () => {};
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        gate = null;
        release();
      };
    },
  };
}

async function auditRecords(daemon: FielddDaemon): Promise<AuditRecordV1[]> {
  const out: AuditRecordV1[] = [];
  for (const name of readdirSync(daemon.audit.root)
    .filter((n) => n.endsWith(".jsonl"))
    .sort()) {
    const verified = await verifyAuditSegment(join(daemon.audit.root, name));
    out.push(...verified.records);
  }
  return out;
}

async function windowOn(daemon: FielddDaemon): Promise<WsRpc> {
  const rpc = await openRpc(`ws://127.0.0.1:${daemon.controlPort}`);
  await helloAs(rpc, daemon.shellToken, "shell-main");
  return rpc;
}

describe("DS-2 — forwarding between two real daemons", () => {
  it("a forwarded act is authorized as the peer daemon and audited with BOTH names: the calling node and the window behind it", async () => {
    const { A, B, interrupts } = await bootPair();
    const win = await windowOn(A);
    const answer = await win.call("agent.interrupt", { device: "dev-b", runtimeRunId: "run-1" });
    expect(answer).toEqual({ accepted: true });
    expect(interrupts()).toBe(1); // it ran on B, the run's owner

    const attempts = (await auditRecords(B)).filter(
      (r) => r.action === "agent.session.interrupt" && r.phase === "attempt",
    );
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.actor).toMatchObject({
      // authorized as: the peer daemon, its id transport-derived from the node
      kind: "peer-fieldd",
      id: "dev-a",
      nodeId: "node-a",
      // recorded as: the window on A it acted for
      onBehalfOf: {
        clientKind: "shell-main",
        deviceId: "dev-a",
        windowId: expect.stringMatching(/^conn_/),
      },
    });
    expect(attempts[0]?.transportProvenance).toBe("ws-tailnet");
    // A forwarded; it did not act, so it wrote no interrupt of its own
    expect(
      (await auditRecords(A)).filter((r) => r.action === "agent.session.interrupt"),
    ).toHaveLength(0);
  }, 40_000);

  it("a forward cut mid-flight reads outcome-unknown, and its retry with the same key applies once", async () => {
    const { A, sockets, interrupts, hold } = await bootPair();
    const win = await windowOn(A);
    const release = hold();
    const pending = win.callErr("agent.interrupt", { device: "dev-b", runtimeRunId: "run-1" });
    await until(() => interrupts() === 1, 8000); // it reached B and is running
    for (const socket of sockets) socket.terminate(); // the link is cut mid-flight

    const lost = await pending;
    expect(lost.data?.kind).toBe("UNAVAILABLE");
    const details = lost.data?.details as { state: string; device: string; idempotencyKey: string };
    expect(details).toMatchObject({ device: "dev-b", state: "outcome-unknown" });
    const key = details.idempotencyKey;
    expect(key).toMatch(/^fk_/);
    // never success, never a plain failure: the receipt door says so
    expect(await win.call("forward.receipt", { idempotencyKey: key })).toMatchObject({
      idempotencyKey: key,
      method: "agent.interrupt",
      device: "dev-b",
      state: "outcome-unknown",
    });

    release(); // B finishes the act the cut hid from A
    await new Promise((resolve) => setTimeout(resolve, 100));

    // the retry is the same call carrying the same key: B answers it from its
    // receipt, so the interrupt that already ran is not run again
    const retried = await win.call("agent.interrupt", {
      device: "dev-b",
      runtimeRunId: "run-1",
      forward: { idempotencyKey: key },
    });
    expect(retried).toEqual({ accepted: true });
    expect(interrupts()).toBe(1);
    expect(await win.call("forward.receipt", { idempotencyKey: key })).toMatchObject({
      state: "applied",
    });

    // a NEW act is a new key and runs again
    await win.call("agent.interrupt", { device: "dev-b", runtimeRunId: "run-1" });
    expect(interrupts()).toBe(2);
  }, 40_000);

  it("a window carrying who it is for is refused on both desktops; nothing runs", async () => {
    const { A, B, interrupts } = await bootPair();
    const behalf = { clientKind: "renderer", deviceId: "dev-z", windowId: "forged" };
    const onA = await windowOn(A);
    const routed = await onA.callErr("agent.interrupt", {
      device: "dev-b",
      runtimeRunId: "run-1",
      forward: { onBehalfOf: behalf },
    });
    expect(routed.data?.kind).toBe("PRECONDITION_FAILED");
    expect(routed.data?.details).toMatchObject({ reason: "forwarding envelope from a non-peer" });
    const onB = await windowOn(B);
    const direct = await onB.callErr("agent.interrupt", {
      runtimeRunId: "run-1",
      forward: { onBehalfOf: behalf, idempotencyKey: "fk_forged_key_01" },
    });
    expect(direct.data?.kind).toBe("PRECONDITION_FAILED");
    expect(interrupts()).toBe(0);
  }, 40_000);

  it("the wall still refuses guests everywhere, and a `local` method still stays on its device", async () => {
    const { A, bDoor, interrupts } = await bootPair();
    // a tailnet stranger on B's door: a guest, refused every reclassified door
    const guest = await openRpc(bDoor, { "Tailscale-User-Login": "stranger@example.com" });
    await guest.call("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "ios",
    });
    for (const [method, params] of [
      ["agent.interrupt", { runtimeRunId: "run-1" }],
      ["agent.spawn", { provider: "scripted" }],
      ["agent.list", {}],
      ["index.status", {}],
      ["index.search", { q: "x" }],
    ] as const) {
      const refused = await guest.callErr(method, params);
      expect(refused.data?.kind, method).toBe("FORBIDDEN_SCOPE");
      expect(refused.message, method).toBe("guest access: method not available");
    }
    expect(interrupts()).toBe(0);

    // a LOCAL method refuses a foreign device before the forwarder…
    const win = await windowOn(A);
    const routed = await win.callErr("agents.profiles.list", { device: "dev-b" });
    expect(routed.data?.kind).toBe("PRECONDITION_FAILED");
    expect(routed.data?.details).toMatchObject({ locality: "local" });
    // …and a peer daemon calling one is refused at the owner
    await expect(A.peers.request("dev-b", "agents.profiles.list", {})).rejects.toMatchObject({
      kind: "FORBIDDEN_SCOPE",
      details: { locality: "local" },
    });
  }, 40_000);
});
