import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  PORTS,
  RemoteCellEndpointSet,
  SOCKETS,
  TerminalOpenTicketResult,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { TERMINAL_SERVE_ID } from "../src/terminal-serve";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { productDoorPath } from "./link-fixture";
import { nativeEndpoint } from "./native-harness";
import { WsRpc } from "./ws-rpc";

// TM-2 (thinking-terminal-mesh-cells.md §3 T, TM-D3) — THE REMOTE TICKET.
//
// The door a phone reaches is the product door over the sidecar's proxy, and
// what it asks for is a ticket. This file drives the REAL path: a real daemon,
// the real tailnet door (secret path + the sidecar's injected identity header,
// which is what makes a caller `self`), the real serve driver, the real mint.
// Nothing here constructs a principal by hand — the one thing worth proving is
// that a caller who arrives the way the phone arrives is told to dial an
// address it can actually reach.

const LOGIN = "me@jamesyong42.com";
const GUEST_LOGIN = "someone-else@example.com";
const KEY_I = { grantKey: "5e".repeat(32), grantKeyGeneration: 1 };
const CELL_DOOR = 49_159;

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

async function poll<T>(fn: () => T | undefined, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`poll timed out after ${ms}ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const routes = (revision: number) => ({
  revision,
  cells: [
    {
      cellInstanceId: 1,
      cellBootId: "cell-i",
      pid: 4242,
      endpoints: {
        controlSocket: "/mock/native/run/termctl.1.sock",
        frameSocket: "/mock/native/run/termframe.1.sock",
        authToken: "per-boot-token",
      },
      tokenGeneration: 1,
      ...KEY_I,
      workloadClass: "interactive",
      role: "class",
      doors: {
        controlUrl: `ws://127.0.0.1:${CELL_DOOR}/control`,
        framesUrl: `ws://127.0.0.1:${CELL_DOOR}/frames`,
      },
    },
  ],
});

async function boot(opts: { terminalMesh?: boolean; login?: string | null } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-tm-ticket-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const login = opts.login === undefined ? LOGIN : opts.login;
  if (login !== null) {
    mkdirSync(join(dataDir, "fieldd"), { recursive: true });
    writeFileSync(
      join(dataDir, "fieldd", "link.json"),
      JSON.stringify({ login, tailnet: "tail1234.ts.net", linkedAt: "2026-09-14T00:00:00.000Z" }),
    );
  }
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  mock.helloTerminalMesh = opts.terminalMesh ?? true;
  mock.helloTerminal = {
    controlSocket: "/mock/native/run/termctl.1.sock",
    frameSocket: "/mock/native/run/termframe.1.sock",
    authToken: "per-boot-token",
  };
  mock.terminalRoutes = routes(3);
  mock.observedState = {
    generation: 0,
    bootId: "mock-boot",
    terminals: [
      {
        sessionId: "pane-1",
        title: "zsh",
        pid: 77,
        cell: { cellInstanceId: 1, cellBootId: "cell-i", workloadClass: "interactive" },
      },
    ],
    workers: [],
  };
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
  cleanup.push(() => daemon.stop());
  return { daemon, mock, dataDir };
}

/** The product door's capability URL, exactly as the phone reads it out of
 * `field.devices.v1` — and the only place this test can learn the path secret,
 * which is minted per boot and never leaves the daemon otherwise. */
/** UA-P-0d — the path a sidecar-proxied caller ARRIVES ON at fieldd's control
 * port, which is no longer the path it DIALS: the public prefix is `/` and the
 * sidecar adds the secret on forward. A test that plays the sidecar has to add
 * it itself, from the floor's own copy of the route config. */
function productPath(daemon: FielddDaemon, mock: MockMgmtServer): string {
  const url = daemon.health().mesh.serves.find((s) => s.name === "product")?.url;
  if (url === undefined) throw new Error("the product serve has no URL yet");
  return productDoorPath(mock);
}

/** Dial the product door the way the SIDECAR would: the secret path plus the
 * identity headers it injects and a caller cannot forge (they are stripped on
 * the ordinary door — `tailnet-door.test.ts` owns that row). */
async function dialAsTailnet(
  daemon: FielddDaemon,
  mock: MockMgmtServer,
  login: string,
): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}${productPath(daemon, mock)}`, {
    headers: { "Tailscale-User-Login": login },
  });
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await rpc.call("system.hello", {
    contractsVersion: CONTRACTS_VERSION,
    minCompatible: CONTRACTS_VERSION,
    clientKind: "ios",
  });
  return rpc;
}

/** Wait until the terminal serve is live, which is what makes a remote ticket
 * mintable at all. */
async function serving(daemon: FielddDaemon): Promise<void> {
  await poll(() =>
    daemon.mesh
      .serves()
      .find((s) => (s.serveId ?? s.name) === TERMINAL_SERVE_ID && s.status === "active"),
  );
}

describe("TM-2 — a self peer is told to dial the tailnet, a window the loopback", () => {
  it("answers the self peer with the cell's tailnet doors and [input, read]", async () => {
    const { daemon, mock } = await boot();
    await serving(daemon);
    const rpc = await dialAsTailnet(daemon, mock, LOGIN);

    const ticket = TerminalOpenTicketResult.parse(
      await rpc.call("terminal.openTicket", { sessionId: "pane-1" }),
    );
    // the door set is the REMOTE shape, and it validates as one
    expect(RemoteCellEndpointSet.safeParse(ticket.endpoints).success).toBe(true);
    expect(ticket.endpoints).toEqual({
      controlUrl: `ws://mock.ts.net:${PORTS.TERMINAL_CELLS_SERVE}/cell/cell-i/control`,
      framesUrl: `ws://mock.ts.net:${PORTS.TERMINAL_CELLS_SERVE}/cell/cell-i/frames`,
    });
    // …and nothing about the loopback door leaked into it
    expect(JSON.stringify(ticket.endpoints)).not.toContain("127.0.0.1");
    expect(JSON.stringify(ticket.endpoints)).not.toContain(String(CELL_DOOR));

    // TM-D3: read and TYPE, and no geometry — a phone must not resize the
    // desktop's own pane under the person sitting at it
    expect(ticket.attachGrant.claims.rights).toEqual(["input", "read"]);
    // the grants are minted exactly as for a window: same audience, same key
    expect(ticket.route).toEqual({ cellBootId: "cell-i", routeRevision: 3 });
    expect(ticket.attachGrant.claims.audienceCellBootId).toBe("cell-i");
    expect(ticket.transportGrant.protected.kid).toEqual({
      cellBootId: "cell-i",
      keyGeneration: 1,
    });
    expect(ticket.transportGrant.claims.allowedChannels).toEqual(["control", "frames"]);
    // §5.1: the clientId is derived from the VERIFIED login, so two remote
    // clients never share a connection set or an attach ledger — scoped to this
    // fieldd boot's epoch (TP-R21: the row below)
    const clientId = ticket.attachGrant.claims.clientId;
    expect(clientId.startsWith(`tailnet:${LOGIN}~`)).toBe(true);
    expect(ticket.transportGrant.claims.clientId).toBe(clientId);
    expect(ticket.transportGrant.claims.connectionSetId).toBe(`${clientId}@cell-i`);
  });

  // TP-R21 (the 2026-09-24 terminal audit) — the cells outlive fieldd and keep
  // each connection set's high-water, while fieldd's generation counters restart
  // at 1. The phone's identity (`tailnet:<login>`) is the same before and after
  // a restart, so if its connection set were too, its first ticket from the new
  // fieldd would sit below the cell's high-water: GRANT_GENERATION_ROLLBACK,
  // retryable false. Two daemons on ONE root, against ONE floor.
  it("hands the same phone a NEW client after a fieldd restart, so no old high-water applies", async () => {
    const { daemon, mock, dataDir } = await boot();
    await serving(daemon);
    const before = TerminalOpenTicketResult.parse(
      await (await dialAsTailnet(daemon, mock, LOGIN)).call("terminal.openTicket", {
        sessionId: "pane-1",
      }),
    );
    await daemon.stop();

    const next = await bootstrap({ dataDir, controlPort: 0, dataPort: 0 });
    cleanup.push(() => next.stop());
    await serving(next);
    const after = TerminalOpenTicketResult.parse(
      await (await dialAsTailnet(next, mock, LOGIN)).call("terminal.openTicket", {
        sessionId: "pane-1",
      }),
    );
    // the new fieldd's counter DID restart — the fix is not a counter
    expect(after.transportGrant.claims.transportGrantGeneration).toBe(1);
    expect(after.transportGrant.claims.clientId.startsWith(`tailnet:${LOGIN}~`)).toBe(true);
    expect(after.transportGrant.claims.clientId).not.toBe(before.transportGrant.claims.clientId);
    expect(after.transportGrant.claims.connectionSetId).not.toBe(
      before.transportGrant.claims.connectionSetId,
    );
    expect(after.attachGrant.claims.clientId).not.toBe(before.attachGrant.claims.clientId);
  }, 30_000); // two daemon boots and two serve waits

  it("leaves a WINDOW's ticket byte-for-byte what it was", async () => {
    const { daemon } = await boot();
    await serving(daemon);
    const grant = daemon.tokens.mint(["terminal.attach"], "tm-2-window");
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const rpc = new WsRpc(ws);
    await rpc.call("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "renderer",
      credential: grant.token,
    });

    const ticket = TerminalOpenTicketResult.parse(
      await rpc.call("terminal.openTicket", { sessionId: "pane-1" }),
    );
    expect(ticket.endpoints).toEqual({
      controlUrl: `ws://127.0.0.1:${CELL_DOOR}/control`,
      framesUrl: `ws://127.0.0.1:${CELL_DOOR}/frames`,
    });
    expect(ticket.attachGrant.claims.rights).toEqual(["geometry", "input", "read"]);
    expect(ticket.attachGrant.claims.clientId).toMatch(/^local-token:/);
  });

  it("a GUEST never reaches the mint at all — the scope wall, unmoved", async () => {
    // a WhoIs-verified peer whose login does NOT match link.json gets the empty
    // guest preset, and `terminal.openTicket` declares no guestOk
    const { daemon, mock } = await boot();
    await serving(daemon);
    const rpc = await dialAsTailnet(daemon, mock, GUEST_LOGIN);
    const refused = await rpc.callErr("terminal.openTicket", { sessionId: "pane-1" });
    expect(refused.data?.kind).toBe("FORBIDDEN_SCOPE");
  });
});

describe("TM-2 — doors_not_published is its own honest state", () => {
  it("refuses the remote ticket when the floor keeps its doors off the tailnet", async () => {
    const { daemon, mock } = await boot({ terminalMesh: false });
    // the product door still comes up; the terminal listener never does
    await poll(() => daemon.health().mesh.serves.find((s) => s.name === "product")?.url);
    const rpc = await dialAsTailnet(daemon, mock, LOGIN);
    const refused = await rpc.callErr("terminal.openTicket", { sessionId: "pane-1" });
    expect(refused.data?.kind).toBe("UNAVAILABLE");
    expect(refused.data?.details).toEqual({ service: "terminal", state: "doors_not_published" });
    expect(refused.data?.retryable).toBe(true);
  });

  it("UA-P-0a — an UNLINKED desktop has no product door on the tailnet at all", async () => {
    // WHAT THIS ROW USED TO BE, and why it changed. E-F6 asked what a tailnet
    // caller on an unlinked desktop is handed, because that desktop granted
    // `TAILNET_SCOPES` to any WhoIs-verified login and left `self` ABSENT
    // rather than false; the answer had to stop being the cell's own 127.0.0.1
    // pair (a phone would dial ITS OWN loopback and the face would say
    // `failed`) and become `device_not_linked`.
    //
    // James then ruled the question away: the posture derives from the link, so
    // an unlinked desktop is OFFLINE — it declares no product serve, which
    // means there is no capability URL, no path for a phone to dial, and no
    // tailnet caller to answer. The refusal moved one layer out, from the
    // ticket's shape to the door's existence, and that is what this row now
    // witnesses. (`device_not_linked` survives in `doorsFor` as a belt behind
    // that closed door — a principal it can no longer receive.)
    const { daemon } = await boot({ login: null });
    // the FLOOR is fully willing — its doors are published and its routes are
    // live — so nothing here is a coincidence of an unready fixture
    await poll(() => (daemon.health().nativeConnected ? true : undefined));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(daemon.health().mesh.serves.find((s) => s.name === "product")).toBeUndefined();
    expect(daemon.health().mesh.serves.some((s) => s.url !== undefined)).toBe(false);
  });

  it("E-F6 — WHO IS ADMITTED locally is unchanged: the same unlinked desktop still mints for a window", async () => {
    // UA-P-0a closed the TAILNET side of the unlinked posture and nothing else:
    // a local window on a desktop with no account is the ordinary first-run
    // case, and it keeps working exactly as it did
    const { daemon } = await boot({ login: null });
    const grant = daemon.tokens.mint(["terminal.attach"], "ef6-local");
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const rpc = new WsRpc(ws);
    await rpc.call("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "renderer",
      credential: grant.token,
    });
    const ticket = TerminalOpenTicketResult.parse(
      await rpc.call("terminal.openTicket", { sessionId: "pane-1" }),
    );
    expect(ticket.endpoints.controlUrl).toBe(`ws://127.0.0.1:${CELL_DOOR}/control`);
  });

  it("the SAME floor still mints a window's loopback ticket — the states are about REACH", async () => {
    // the distinction the new state word exists for: `transport_not_landed`
    // means this cell serves no doors at all; `doors_not_published` means the
    // doors are fine and this device is not carrying them onto the tailnet
    const { daemon } = await boot({ terminalMesh: false });
    const grant = daemon.tokens.mint(["terminal.attach"], "tm-2-local");
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    cleanup.push(() => ws.close());
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const rpc = new WsRpc(ws);
    await rpc.call("system.hello", {
      contractsVersion: CONTRACTS_VERSION,
      minCompatible: CONTRACTS_VERSION,
      clientKind: "renderer",
      credential: grant.token,
    });
    const ticket = TerminalOpenTicketResult.parse(
      await rpc.call("terminal.openTicket", { sessionId: "pane-1" }),
    );
    expect(ticket.endpoints.controlUrl).toBe(`ws://127.0.0.1:${CELL_DOOR}/control`);
  });
});
