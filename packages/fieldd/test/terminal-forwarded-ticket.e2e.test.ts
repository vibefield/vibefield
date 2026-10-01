// DS-4 end to end (thinking-desktop-sync-plane.md §6.3; design-06 §6): TWO
// REAL fieldd daemons. A window on desktop A asks ITS daemon for a ticket to a
// session that lives on desktop B — `terminal.openTicket {device: "dev-b"}`.
// A forwards the call whole over PeerLink (the sidecar-simulating ws-ctor of
// `peer-link.e2e.test.ts`, which injects the WhoIs login), B serves it as a
// `peer-fieldd` self peer — the self set and its cell's TAILNET doors — and A
// carries those doors onto an egress route of its own (the RemoteCellRewriter
// port, here a fake facade that answers one loopback listener) before its
// window sees them. The grants are B's own: B's cell verifies them whatever
// socket carries them.
//
// What is NOT here, because it does not exist yet: a real egress route (DS-1 —
// the facade and petition T7), and the window dialing the rewritten doors.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTRACTS_VERSION, PORTS, SOCKETS, TerminalOpenTicketResult } from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { egressRouteRewriter } from "../src/remote-cell-rewriter";
import { TERMINAL_SERVE_ID } from "../src/terminal-serve";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productPathSecret, writeLinkFixture } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { desktopSlice, registryPeer } from "./peer-roster";
import { helloAs, until, WsRpc } from "./ws-rpc";

const LOGIN = "me@jamesyong42.com";
const LISTEN = "127.0.0.1:61234";

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* already stopped is fine */
    }
  }
  cleanup = [];
});

function makeDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-ds4-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  writeLinkFixture(dataDir, LOGIN);
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  return dataDir;
}

async function startMock(dataDir: string): Promise<MockMgmtServer> {
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

/** Desktop B's floor: one keyed cell serving its T1 doors, published on the
 * tailnet (`terminalMesh`), holding the session A's window wants. */
function floorB(mock: MockMgmtServer): void {
  mock.meshDeviceId = "dev-b";
  mock.helloTerminalMesh = true;
  mock.helloTerminal = {
    controlSocket: "/mock/native/run/termctl.1.sock",
    frameSocket: "/mock/native/run/termframe.1.sock",
    authToken: "per-boot-token",
  };
  mock.terminalRoutes = {
    revision: 7,
    cells: [
      {
        cellInstanceId: 1,
        cellBootId: "cell-b",
        pid: 4242,
        endpoints: {
          controlSocket: "/mock/native/run/termctl.1.sock",
          frameSocket: "/mock/native/run/termframe.1.sock",
          authToken: "per-boot-token",
        },
        tokenGeneration: 1,
        grantKey: "5e".repeat(32),
        grantKeyGeneration: 1,
        workloadClass: "interactive",
        role: "class",
        doors: {
          controlUrl: "ws://127.0.0.1:49170/control",
          framesUrl: "ws://127.0.0.1:49170/frames",
        },
      },
    ],
  };
  mock.observedState = {
    generation: 0,
    bootId: "mock-boot-b",
    terminals: [
      {
        sessionId: "pane-b",
        title: "zsh",
        pid: 77,
        cell: { cellInstanceId: 1, cellBootId: "cell-b", workloadClass: "interactive" },
      },
    ],
    workers: [],
  };
}

/** The sidecar half of a dial (peer-link.e2e's sim): a tailnet coordinate for
 * B lands on B's loopback door with the route secret joined, and the WhoIs
 * login the caller cannot forge is injected — with (D1, 2026-10-01) A's node
 * id, which B's roster correlates to A's desktop slice: the peer kind is the
 * transport's to give. */
function sidecar(loopback: () => string): WsCtor {
  class SidecarSim extends WebSocket {
    constructor(url: string) {
      const target = url.includes("device-b.tailnet.ts.net") ? loopback() : "ws://127.0.0.1:1/";
      super(url.includes(".ts.net") ? target : url, {
        headers: { "Tailscale-User-Login": LOGIN, "Tailscale-Node-Id": "node-a" },
      });
    }
  }
  return SidecarSim;
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

async function bootPair(): Promise<{
  A: FielddDaemon;
  B: FielddDaemon;
  routes: Array<{ deviceId: string; target: string }>;
}> {
  const dirB = makeDataDir();
  const mockB = await startMock(dirB);
  floorB(mockB);
  // D1 — B's roster vouches for A as a desktop: its registry row names A's
  // node, its store holds A's slice
  mockB.meshPeers = [
    registryPeer({ nodeId: "node-a", deviceId: "dev-a", name: "device-a", login: LOGIN }),
  ];
  mockB.storeSlices = new Map<string, unknown>([["dev-a", desktopSlice("dev-a", "device-a")]]);
  const B = await bootstrap({ dataDir: dirB, controlPort: 0, dataPort: 0 });
  cleanup.push(() => B.stop());
  // B's doors are only mintable for a remote caller once its terminal serve is
  // live (TM-2) — and its product door once the product serve is declared
  await until(
    () =>
      B.mesh
        .serves()
        .some((s) => (s.serveId ?? s.name) === TERMINAL_SERVE_ID && s.status === "active") &&
      B.health().mesh.serves.some((s) => s.name === "product" && s.url !== undefined),
    8_000,
  );
  const bEndpoint = `ws://127.0.0.1:${B.controlPort}/t/${productPathSecret(mockB)}`;

  const dirA = makeDataDir();
  const mockA = await startMock(dirA);
  mockA.meshDeviceId = "dev-a"; // A's own mesh identity, the one B's roster names
  mockA.meshPeers = [
    {
      id: "node-b",
      deviceId: "dev-b",
      name: "device-b",
      online: true,
      whois: { login: LOGIN, deviceName: "device-b.tailnet.ts.net" },
    },
  ];
  const routes: Array<{ deviceId: string; target: string }> = [];
  const A = await bootstrap({
    dataDir: dirA,
    controlPort: 0,
    dataPort: 0,
    peerWebSocket: sidecar(() => bEndpoint),
    // the fake egress facade: one loopback listener per owner serve
    terminalRemoteCellRewriter: egressRouteRewriter(async (route) => {
      routes.push(route);
      return { listen: LISTEN };
    }),
  });
  cleanup.push(() => A.stop());
  await until(() => A.devices.get("dev-b") !== undefined, 4_000);
  await until(() => B.devices.isDocHost("dev-a"), 4_000);
  return { A, B, routes };
}

describe("DS-4 — a window's ticket to a session on another desktop", () => {
  it("is minted by the OWNER for the forwarding daemon and handed to the window on A's own egress route", async () => {
    const { A, routes } = await bootPair();
    const window = await openRpc(A.controlPort);
    await helloAs(window, A.tokens.mint(["terminal.attach"], "ds4-window").token);

    const ticket = TerminalOpenTicketResult.parse(
      await window.call("terminal.openTicket", { device: "dev-b", sessionId: "pane-b" }),
    );
    // the doors are A's loopback listener, B's cell paths kept…
    expect(ticket.endpoints).toEqual({
      controlUrl: `ws://${LISTEN}/cell/cell-b/control`,
      framesUrl: `ws://${LISTEN}/cell/cell-b/frames`,
    });
    // …because B answered its TAILNET pair, and A asked for one route to it
    expect(routes).toEqual([
      { deviceId: "dev-b", target: `mock.ts.net:${PORTS.TERMINAL_CELLS_SERVE}` },
    ]);
    // the grants are B's: its cell, its route, minted for A's daemon — a self
    // peer FORWARDING FOR A WINDOW (the call carried `onBehalfOf`, DS-2), so
    // the self set (DS-D5, D2), the take included
    expect(ticket.route).toEqual({ cellBootId: "cell-b", routeRevision: 7 });
    expect(ticket.attachGrant.claims.audienceCellBootId).toBe("cell-b");
    expect(ticket.attachGrant.claims.rights).toEqual(["geometry", "input", "read"]);
    // DS-4c — the grants name the WINDOW behind the forward (`onBehalfOf
    // .windowId`; this token names no renderer participant, so it is the
    // product connection's id), not A's daemon alone
    expect(ticket.attachGrant.claims.clientId).toMatch(/^peer-fieldd:dev-a#[^~]+~/);
    expect(ticket.transportGrant.claims.clientId).toBe(ticket.attachGrant.claims.clientId);

    // …so a SECOND window on A attaching the same session of B's is a second
    // client on B's cell — its own connection set, its own attach ledger —
    // where one key per daemon made the two windows supersede each other's legs
    const second = await openRpc(A.controlPort);
    await helloAs(second, A.tokens.mint(["terminal.attach"], "ds4-window-2").token);
    const secondTicket = TerminalOpenTicketResult.parse(
      await second.call("terminal.openTicket", { device: "dev-b", sessionId: "pane-b" }),
    );
    expect(secondTicket.attachGrant.claims.clientId).toMatch(/^peer-fieldd:dev-a#[^~]+~/);
    expect(secondTicket.attachGrant.claims.clientId).not.toBe(ticket.attachGrant.claims.clientId);
    expect(secondTicket.transportGrant.claims.connectionSetId).not.toBe(
      ticket.transportGrant.claims.connectionSetId,
    );
    expect(ticket.attachGrant.claims.grantGeneration).toBe(1);
    expect(secondTicket.attachGrant.claims.grantGeneration).toBe(1);

    // D2 (the landing review, 2026-10-01) — the same door asked by A's daemon
    // on its OWN account (no envelope: nobody behind the call) is a peer daemon
    // acting for no one, and design-06 §6 mints it `[read]`
    const own = TerminalOpenTicketResult.parse(
      await A.peers.request("dev-b", "terminal.openTicket", { sessionId: "pane-b" }),
    );
    expect(own.attachGrant.claims.rights).toEqual(["read"]);
    // …under the daemon's own key, a client apart from every window it carries
    expect(own.attachGrant.claims.clientId).toMatch(/^peer-fieldd:dev-a~/);

    // the take's product door (the phone's, DS-4b) is declared and honest
    const take = await window.callErr("terminal.takeGeometry", { sessionId: "pane-b" });
    expect(take.data?.kind).toBe("UNAVAILABLE");
    expect(take.data?.details).toEqual({ service: "terminal", state: "not_implemented" });
  }, 30_000);

  it("is refused on A for a caller A would mint read-only — before anything reaches B", async () => {
    const { A, routes } = await bootPair();
    const plugin = await openRpc(A.controlPort);
    // a renderer plugin may hold `terminal.attach`; A mints it `["read"]`, and B
    // would mint A's daemon the self set — so A does not carry the mint
    const minted = A.tokens.mint(["terminal.attach"], "ds4-plugin", { pluginId: "ds4-plugin" });
    await plugin.call("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "plugin-worker",
      credential: minted.token,
    });
    const refused = await plugin.callErr("terminal.openTicket", {
      device: "dev-b",
      sessionId: "pane-b",
    });
    // refused by the FORWARDER's guard (its details), not by a scope wall
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
    expect(refused.data?.details).toEqual({ method: "terminal.openTicket", device: "dev-b" });
    expect(routes).toEqual([]);
  }, 30_000);
});
