// IL-D4, IL-D5 (a) (`draft/thinking-inventory-latency.md` §4.3, §5; ruled
// 2026-10-19) — fieldd's view of how old the floor's inventory is. The floor's
// own `staleCells` and its bound ride into `terminal.list` and
// `terminal.roster`, where a stale cell's rows read `unknown` and every row
// stays. fieldd's own half names every cell it knows stale once the observed
// stream has not reached it for the bound (the link out of "up", or the
// floor's tick stopped), each `since` the last delivery; a delivery, or the
// stream's return, ends it. A floor that does not judge (no
// `inventoryBoundMs`) answers as it did before the bound. `staleRefusal` is
// what an acting door answers, WG-D4's held floor first. The doors that need a
// listed session (`terminal.get`, `openTicket`, `renewAttach`) refuse an
// unlisted one with it while any cell is stale, and answer a listed one as
// before.
//
// The unit rows drive TerminalService over a structural link and a scripted
// supervision on a clock moved by hand, so every instant is exact; one row
// lets the service's own timer judge on real time. The daemon rows drive it
// through the mock mgmt server (no cargo), the floor held unresponsive by
// silent pings.
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type NativeLinkState,
  type NativeUnavailableDetails,
  SOCKETS,
  TerminalInventoryStaleDetails,
  TerminalListResult,
  TerminalOpenTicketResult,
  TerminalRenewAttachResult,
  TerminalRosterResult,
  type TerminalRouteSnapshot,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddConfig, type FielddDaemon } from "../src/index";
import { RpcCallError } from "../src/native-link";
import {
  type TerminalInventoryTimings,
  type TerminalLink,
  TerminalService,
  type TerminalSupervision,
} from "../src/terminal-service";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import {
  BOOT,
  CELL_1,
  CELL_2,
  CELL_2_SINCE,
  CLAUDE,
  fixture,
  fixtureRoutes,
  freshFloor,
  ZSH,
} from "./inventory-age-fixture";
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

/** terminal-list.link-silent.json's `since`: the last delivery before the stream stopped */
const DELIVERED_AT = 1792433065000;
const HELD: NativeUnavailableDetails = {
  service: "native",
  state: "unresponsive",
  since: 1792433070000,
  detail: "the control path stopped answering (process alive)",
};

/** A clock moved by hand: the monotonic ms the bound runs on, and its unix
 * twin, which starts at the link-silent fixture's last delivery. */
class Clock {
  mono = 1_000;
  wall = DELIVERED_AT;

  advance(ms: number): void {
    this.mono += ms;
    this.wall += ms;
  }
}

/** The floor's supervision as the terminal service reads it, scripted: a
 * state, a last tick on the clock, and WG-D4's held refusal. Every `move` and
 * `nudge` is a transition, which is a moment the service judges. */
class ScriptedSupervision extends EventEmitter implements TerminalSupervision {
  state: NativeLinkState = "up";
  lastTickAt: number | undefined;
  held: NativeUnavailableDetails | undefined;

  constructor(private readonly clock: Clock) {
    super();
  }

  health(): { state: NativeLinkState; lastTickAgeMs: number | null } {
    return {
      state: this.state,
      lastTickAgeMs: this.lastTickAt === undefined ? null : this.clock.mono - this.lastTickAt,
    };
  }

  doorRefusal(): NativeUnavailableDetails | undefined {
    return this.held;
  }

  move(state: NativeLinkState): void {
    this.state = state;
    this.emit("transition");
  }

  /** a detail change: the state stays, and the service judges again */
  nudge(): void {
    this.emit("transition");
  }
}

/** A TerminalService over a structural link that answers `snapshot` and can
 * deliver more, counting what its inventory listeners hear. With a clock, the
 * bound runs on it; `timings` overrides the bound's numbers. */
function unitService(options: {
  snapshot: unknown;
  supervision?: TerminalSupervision;
  clock?: Clock;
  timings?: Partial<TerminalInventoryTimings>;
  routes?: TerminalRouteSnapshot;
}): { service: TerminalService; deliver: (state: unknown) => void; heard: () => number } {
  let push: ((payload: unknown) => void) | undefined;
  const link: TerminalLink = {
    subscribe: async (_method, _params, onEvent) => {
      push = (payload) => onEvent(payload, "delta");
      return { snapshot: options.snapshot };
    },
    terminalEndpoints: undefined,
    terminalRoutes: options.routes,
    on: () => undefined,
  };
  const clock = options.clock;
  const service = new TerminalService({
    link,
    ...(options.supervision === undefined ? {} : { supervision: options.supervision }),
    inventoryTimings: {
      ...(clock === undefined ? {} : { now: () => clock.mono, wallNow: () => clock.wall }),
      ...options.timings,
    },
  });
  cleanup.push(() => service.dispose());
  let heard = 0;
  service.onInventory(() => {
    heard += 1;
  });
  return { service, deliver: (state) => push?.(state), heard: () => heard };
}

/** The answer `terminal.list` gives from this service. */
function listOf(service: TerminalService): TerminalListResult {
  const observation = service.observation();
  return TerminalListResult.parse({
    terminals: service.list(),
    ...(observation === undefined ? {} : { observation }),
  });
}

/** Each roster row's session and health, in order. */
function healthOf(roster: unknown): Array<[string, string]> {
  const items = TerminalRosterResult.parse(roster).items;
  return items.map((item): [string, string] => [item.sessionId, item.health]);
}

describe("the floor's own stale cells, as fieldd reads them (IL-D4, IL-D5 (a))", () => {
  it("list carries the floor's bound and its stale cell; the roster says unknown for that cell's rows alone", async () => {
    const { service } = unitService({ snapshot: fixture("observed-state.stale-cell.json") });
    await service.ensureStarted();

    expect(listOf(service)).toEqual(fixture("terminal-list.stale-cell.json"));
    expect(service.inventoryBoundMs()).toBe(10_000);
    expect(service.staleCells()).toEqual([{ ...CELL_2, since: CELL_2_SINCE }]);
    expect(healthOf(service.roster()), "one stale cell never hides a row").toEqual([
      [ZSH, "live"],
      [CLAUDE, "unknown"],
    ]);
    expect(TerminalRosterResult.parse(service.roster()).observation).toEqual(
      listOf(service).observation,
    );
  });

  it("a door's refusal names the session's own cell for a listed session, every stale cell for an unlisted one", async () => {
    const { service } = unitService({ snapshot: fixture("observed-state.stale-cell.json") });
    await service.ensureStarted();

    expect(service.staleCellsFor(CLAUDE)).toEqual([{ ...CELL_2, since: CELL_2_SINCE }]);
    expect(service.staleCellsFor(ZSH), "a fresh cell's session").toEqual([]);
    expect(service.staleRefusal(ZSH, "terminal.terminate")).toBeUndefined();

    const refusal = service.staleRefusal("unlisted-session", "terminal.get");
    expect(refusal).toBeInstanceOf(RpcCallError);
    expect(
      { kind: refusal?.kind, retryable: refusal?.retryable, details: refusal?.details },
      "the EL9 fixture's shape, word for word",
    ).toEqual(fixture("error-data.terminal-inventory-stale.json"));
    expect(TerminalInventoryStaleDetails.safeParse(refusal?.details).success).toBe(true);
  });

  it("a fresh observation clears the floor's stale cell, and its listeners hear it once", async () => {
    const { service, deliver, heard } = unitService({
      snapshot: fixture("observed-state.stale-cell.json"),
    });
    await service.ensureStarted();
    const before = heard();

    deliver(freshFloor());
    expect(service.staleCells()).toEqual([]);
    expect(service.observation()).toEqual({ bootId: BOOT, generation: 7, boundMs: 10_000 });
    expect(healthOf(service.roster())).toEqual([
      [ZSH, "live"],
      [CLAUDE, "live"],
    ]);
    expect(service.staleRefusal("unlisted-session", "terminal.get")).toBeUndefined();
    expect(heard(), "one delivery, one hearing — never a second for the age").toBe(before + 1);
  });

  it("a floor that does not judge (no inventoryBoundMs) answers as before the bound, whatever its link does", async () => {
    const clock = new Clock();
    const supervision = new ScriptedSupervision(clock);
    const { service, heard } = unitService({
      snapshot: fixture("observed-state.valid.json"),
      supervision,
      clock,
    });
    await service.ensureStarted();
    const before = heard();

    expect(service.observation(), "no bound, no stale cells: the age is unknown").toEqual({
      bootId: BOOT,
      generation: 7,
    });
    expect(service.inventoryBoundMs()).toBeUndefined();

    supervision.move("connecting");
    clock.advance(60_000);
    supervision.nudge();
    expect(service.staleCells()).toEqual([]);
    expect(service.observation()).toEqual({ bootId: BOOT, generation: 7 });
    expect(service.staleRefusal("unlisted-session", "terminal.get")).toBeUndefined();
    expect(healthOf(service.roster())).toEqual([[CLAUDE, "live"]]);
    expect(heard(), "nothing changed, so nothing was re-told").toBe(before);
  });
});

describe("fieldd's own half: the stream that stops reaching fieldd (IL-D4 §4.3)", () => {
  it("the link out of up for the bound names every cell fieldd knows stale, since the last delivery", async () => {
    const clock = new Clock();
    const supervision = new ScriptedSupervision(clock);
    const { service, heard } = unitService({ snapshot: freshFloor(), supervision, clock });
    await service.ensureStarted();
    expect(service.observation()).toEqual({ bootId: BOOT, generation: 7, boundMs: 10_000 });
    const before = heard();

    clock.advance(1_000);
    supervision.move("connecting"); // the stream stops here
    clock.advance(9_999);
    supervision.nudge();
    expect(service.staleCells(), "short of the bound").toEqual([]);
    expect(heard(), "no change, no re-telling").toBe(before);

    clock.advance(1);
    supervision.nudge();
    expect(listOf(service), "the link-silent fixture: every cell, one since").toEqual(
      fixture("terminal-list.link-silent.json"),
    );
    expect(heard(), "the transition re-tells the rows, once").toBe(before + 1);
    expect(healthOf(service.roster())).toEqual([
      [ZSH, "unknown"],
      [CLAUDE, "unknown"],
    ]);

    // an unlisted session names every stale cell; a listed one, its own
    const unlisted = service.staleRefusal("unlisted-session", "agent.resume");
    expect(TerminalInventoryStaleDetails.parse(unlisted?.details).cells).toEqual([
      { ...CELL_1, since: DELIVERED_AT },
      { ...CELL_2, since: DELIVERED_AT },
    ]);
    const listed = service.staleRefusal(ZSH, "terminal.terminate");
    expect(TerminalInventoryStaleDetails.parse(listed?.details).cells).toEqual([
      { ...CELL_1, since: DELIVERED_AT },
    ]);
  });

  it("while the floor is held unresponsive, a stale door's refusal is WG-D4's {native, unresponsive}", async () => {
    const clock = new Clock();
    const supervision = new ScriptedSupervision(clock);
    const { service } = unitService({ snapshot: freshFloor(), supervision, clock });
    await service.ensureStarted();

    supervision.held = HELD;
    supervision.move("unresponsive");
    expect(
      service.staleRefusal("unlisted-session", "terminal.get"),
      "held, but short of the bound: nothing stale, so the door acts",
    ).toBeUndefined();

    clock.advance(10_000);
    supervision.nudge();
    const refusal = service.staleRefusal("unlisted-session", "terminal.get");
    expect(refusal?.kind).toBe("UNAVAILABLE");
    expect(refusal?.retryable).toBe(true);
    expect(refusal?.details, "the worse and truer story wins").toEqual(HELD);

    supervision.held = undefined; // the redialled hello answered: no longer held
    supervision.nudge();
    const stale = service.staleRefusal("unlisted-session", "terminal.get");
    expect(TerminalInventoryStaleDetails.safeParse(stale?.details).success).toBe(true);
  });

  it("a delivery ends it at once and restarts the clock; the link back up ends it with no delivery at all", async () => {
    const clock = new Clock();
    const supervision = new ScriptedSupervision(clock);
    const { service, deliver, heard } = unitService({ snapshot: freshFloor(), supervision, clock });
    await service.ensureStarted();

    supervision.move("unresponsive"); // a reader wedge: notifications still flow
    clock.advance(10_000);
    supervision.nudge();
    expect(service.staleCells()).toHaveLength(2);

    const before = heard();
    clock.advance(500);
    const redelivered = clock.wall;
    deliver(freshFloor());
    expect(service.staleCells(), "a delivery proves the stream").toEqual([]);
    expect(heard(), "the delivery's own hearing, and no second").toBe(before + 1);

    clock.advance(9_999);
    supervision.nudge();
    expect(service.staleCells(), "the bound counts from the delivery").toEqual([]);
    clock.advance(1);
    supervision.nudge();
    expect(service.staleCells()).toEqual([
      { ...CELL_1, since: redelivered },
      { ...CELL_2, since: redelivered },
    ]);

    supervision.move("up"); // no tick was ever seen: the state decides alone
    expect(service.staleCells(), "the stream reaches fieldd again").toEqual([]);
    expect(service.observation()).toEqual({ bootId: BOOT, generation: 7, boundMs: 10_000 });
  });

  it("a floor tick gone stale under an up link is the stream stopping; a tick that resumes ends it", async () => {
    const clock = new Clock();
    const supervision = new ScriptedSupervision(clock);
    supervision.lastTickAt = clock.mono;
    const { service } = unitService({ snapshot: freshFloor(), supervision, clock });
    await service.ensureStarted();

    clock.advance(2_000);
    supervision.lastTickAt = clock.mono; // the floor's last tick
    clock.advance(9_999);
    supervision.nudge();
    expect(service.staleCells(), "the tick stopped, but the bound has not run").toEqual([]);

    clock.advance(1);
    supervision.nudge();
    expect(service.staleCells()).toEqual([
      { ...CELL_1, since: DELIVERED_AT },
      { ...CELL_2, since: DELIVERED_AT },
    ]);

    supervision.lastTickAt = clock.mono; // it ticks again
    supervision.nudge();
    expect(service.staleCells()).toEqual([]);
  });

  it("a cell the floor already named keeps its own, older since; a cell with no rows is still named", async () => {
    const clock = new Clock();
    clock.wall = CELL_2_SINCE + 10_500; // delivered after the floor judged cell 2
    const delivered = clock.wall;
    const supervision = new ScriptedSupervision(clock);
    const third = { cellInstanceId: 3, cellBootId: "01JCELLBOOT0000000000000003" };
    const endpoints = {
      controlSocket: "/tmp/c3.sock",
      frameSocket: "/tmp/f3.sock",
      authToken: "t3",
    };
    const { service } = unitService({
      snapshot: fixture("observed-state.stale-cell.json"),
      supervision,
      clock,
      routes: {
        revision: 4,
        cells: [{ ...third, pid: 4003, endpoints, tokenGeneration: 1, workloadClass: "agent" }],
      },
    });
    await service.ensureStarted();

    supervision.move("respawning");
    clock.advance(10_000);
    supervision.nudge();
    expect(service.staleCells(), "its age never moves back when the stream stops").toEqual([
      { ...CELL_1, since: delivered },
      { ...CELL_2, since: CELL_2_SINCE },
      { ...third, since: delivered },
    ]);
  });

  it("with no event after the link drops, the service's own timer judges it stale at the bound", async () => {
    const supervision = new ScriptedSupervision(new Clock()); // no tick: its clock is never read
    const { service, heard } = unitService({
      snapshot: freshFloor(),
      supervision,
      timings: { staleMs: 60, sampleMs: 10 },
    });
    await service.ensureStarted();
    const before = heard();

    supervision.move("gone");
    expect(service.staleCells()).toEqual([]);
    await until(() => service.staleCells().length === 2, 3_000, "stale by the timer alone");
    expect(heard(), "the timer's transition re-tells the rows").toBe(before + 1);
  });
});

/** A daemon over the mock floor, which answers `observedState` and, when
 * given, publishes `routes`; and a connection that holds `terminal.attach`. */
async function daemonOn(
  observedState: unknown,
  config: Pick<FielddConfig, "terminalInventoryTimings"> = {},
  routes?: TerminalRouteSnapshot,
): Promise<{ mock: MockMgmtServer; daemon: FielddDaemon; rpc: WsRpc }> {
  const dataDir = mkdtempSync(join(tmpdir(), "vf-inventory-age-"));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.observedState = observedState;
  if (routes !== undefined) mock.terminalRoutes = routes;
  await mock.start();
  cleanup.push(() => mock.stop());
  const daemon = await bootstrap({ dataDir, controlPort: 0, dataPort: 0, ...config });
  cleanup.push(() => daemon.stop());
  const grant = daemon.tokens.mint(["terminal.attach"], "inventory-age");
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const rpc = new WsRpc(ws);
  await helloAs(rpc, grant.token);
  return { mock, daemon, rpc };
}

describe("the reads through the daemon (IL-D4, IL-D5 (a); the mock floor)", () => {
  it("terminal.list carries the floor's stale cell and terminal.roster says unknown for its rows", async () => {
    const { rpc } = await daemonOn(fixture("observed-state.stale-cell.json"));
    const list = TerminalListResult.parse(await rpc.call("terminal.list", {}));
    expect(list).toEqual(fixture("terminal-list.stale-cell.json"));
    const roster = await rpc.call("terminal.roster", {});
    expect(healthOf(roster)).toEqual([
      [ZSH, "live"],
      [CLAUDE, "unknown"],
    ]);
    expect(TerminalRosterResult.parse(roster).observation).toEqual(list.observation);
  });

  it("a floor held unresponsive past the bound: every cell stale on list and roster; answering again ends it", async () => {
    const booted = Date.now();
    const { mock, daemon, rpc } = await daemonOn(freshFloor(), {
      terminalInventoryTimings: { staleMs: 300, sampleMs: 25 },
    });
    let list = TerminalListResult.parse(await rpc.call("terminal.list", {}));
    expect(list.observation).toEqual({ bootId: BOOT, generation: 7, boundMs: 10_000 });

    mock.silentMethods.add("native.lifecycle.ping"); // the control path stops answering
    await until(() => daemon.health().nativeLink.state === "unresponsive", 5_000, "held");
    await until(() => daemon.terminals.staleCells().length === 2, 5_000, "past the bound");
    list = TerminalListResult.parse(await rpc.call("terminal.list", {}));
    expect(
      list.terminals.map((row) => row.sessionId),
      "every row stays",
    ).toEqual([ZSH, CLAUDE]);
    const stale = list.observation?.staleCells ?? [];
    expect(stale.map((entry) => entry.cellInstanceId)).toEqual([1, 2]);
    const since = stale[0]?.since ?? 0;
    const oneSince = stale.every((entry) => entry.since === since);
    expect(oneSince, "one since: the last delivery").toBe(true);
    expect(since).toBeGreaterThanOrEqual(booted);
    expect(since).toBeLessThanOrEqual(Date.now());
    expect(healthOf(await rpc.call("terminal.roster", {}))).toEqual([
      [ZSH, "unknown"],
      [CLAUDE, "unknown"],
    ]);

    mock.silentMethods.delete("native.lifecycle.ping");
    await until(() => daemon.health().nativeLink.state === "up", 5_000, "answering again");
    list = TerminalListResult.parse(await rpc.call("terminal.list", {}));
    expect(list.observation).toEqual({ bootId: BOOT, generation: 7, boundMs: 10_000 });
    expect(healthOf(await rpc.call("terminal.roster", {}))).toEqual([
      [ZSH, "live"],
      [CLAUDE, "live"],
    ]);
  });

  it("an older floor's list carries no age, and its floor held past the bound changes nothing", async () => {
    const { mock, daemon, rpc } = await daemonOn(fixture("observed-state.valid.json"), {
      terminalInventoryTimings: { staleMs: 100, sampleMs: 25 },
    });
    mock.silentMethods.add("native.lifecycle.ping");
    await until(() => daemon.health().nativeLink.state === "unresponsive", 5_000, "held");
    await new Promise((resolve) => setTimeout(resolve, 400)); // the bound, four times over

    const list = TerminalListResult.parse(await rpc.call("terminal.list", {}));
    expect(list.observation).toEqual({ bootId: BOOT, generation: 7 });
    expect(daemon.terminals.staleCells()).toEqual([]);
    expect(healthOf(await rpc.call("terminal.roster", {}))).toEqual([[CLAUDE, "live"]]);
  });
});

/** The three doors that need a listed session, each asked for `sessionId`. */
function doorCalls(sessionId: string): Array<[string, Record<string, unknown>]> {
  return [
    ["terminal.get", { sessionId }],
    ["terminal.openTicket", { sessionId }],
    ["terminal.renewAttach", { sessionId, expectGeneration: 0, requestId: `renew-${sessionId}` }],
  ];
}

describe("the doors that need a listed session (IL-D5 (a); the mock floor)", () => {
  it("an unlisted session while a cell is stale is not known yet: get, openTicket and renewAttach refuse it retryably", async () => {
    const { rpc } = await daemonOn(fixture("observed-state.stale-cell.json"), {}, fixtureRoutes());
    for (const [method, params] of doorCalls("unlisted-session")) {
      const err = await rpc.callErr(method, params);
      expect(
        { kind: err.data?.kind, retryable: err.data?.retryable, details: err.data?.details },
        `${method}: every stale cell, in the EL9 fixture's words — never NOT_FOUND`,
      ).toEqual(fixture("error-data.terminal-inventory-stale.json"));
      expect(TerminalInventoryStaleDetails.safeParse(err.data?.details).success, method).toBe(true);
    }
  });

  it("a listed session is answered and minted as before, its cell stale or not", async () => {
    const { rpc } = await daemonOn(fixture("observed-state.stale-cell.json"), {}, fixtureRoutes());
    const rows = fixture("observed-state.stale-cell.json")["terminals"] as unknown[];
    expect(
      await rpc.call("terminal.get", { sessionId: CLAUDE }),
      "cell 2 is stale, and its row is still the row",
    ).toEqual(rows[1]);
    expect(await rpc.call("terminal.get", { sessionId: ZSH })).toEqual(rows[0]);

    for (const [sessionId, cell] of [
      [CLAUDE, CELL_2],
      [ZSH, CELL_1],
    ] as const) {
      const ticket = TerminalOpenTicketResult.parse(
        await rpc.call("terminal.openTicket", { sessionId }),
      );
      expect(ticket.route.cellBootId, "minted from the session's own cell").toBe(cell.cellBootId);
      expect(ticket.attachGrant.claims.grantGeneration).toBe(1);
      const renewed = TerminalRenewAttachResult.parse(
        await rpc.call("terminal.renewAttach", {
          sessionId,
          expectGeneration: 1,
          requestId: `renew-${sessionId}`,
        }),
      );
      expect(renewed.attachGrant.claims.grantGeneration).toBe(2);
    }
  });

  it("with every cell fresh, and on a floor that does not judge, an unlisted session is no such terminal, as before", async () => {
    for (const floor of [freshFloor(), fixture("observed-state.valid.json")]) {
      const { rpc } = await daemonOn(floor, {}, fixtureRoutes());
      for (const [method, params] of doorCalls("unlisted-session")) {
        const err = await rpc.callErr(method, params);
        expect(err.data?.kind, method).toBe("NOT_FOUND");
        expect(err.data?.retryable, method).toBe(false);
      }
    }
  });

  it("held unresponsive past the bound, the refusal is WG-D4's {native, unresponsive}; answering again, no such terminal", async () => {
    const { mock, daemon, rpc } = await daemonOn(
      freshFloor(),
      { terminalInventoryTimings: { staleMs: 300, sampleMs: 25 } },
      fixtureRoutes(),
    );
    mock.silentMethods.add("native.lifecycle.ping"); // the control path stops answering
    await until(() => daemon.health().nativeLink.state === "unresponsive", 5_000, "held");
    await until(() => daemon.terminals.staleCells().length === 2, 5_000, "past the bound");

    for (const [method, params] of doorCalls("unlisted-session")) {
      const err = await rpc.callErr(method, params);
      expect(err.data?.kind, method).toBe("UNAVAILABLE");
      expect(err.data?.retryable, method).toBe(true);
      expect(err.data?.details, `${method}: the worse and truer story wins`).toMatchObject({
        service: "native",
        state: "unresponsive",
      });
    }
    expect(
      await rpc.call("terminal.get", { sessionId: ZSH }),
      "a listed session still reads",
    ).toMatchObject({ sessionId: ZSH });

    mock.silentMethods.delete("native.lifecycle.ping");
    await until(() => daemon.health().nativeLink.state === "up", 5_000, "answering again");
    await until(() => daemon.terminals.staleCells().length === 0, 5_000, "the stream again");
    const gone = await rpc.callErr("terminal.get", { sessionId: "unlisted-session" });
    expect(gone.data?.kind).toBe("NOT_FOUND");
    expect(gone.data?.retryable).toBe(false);
  });
});
