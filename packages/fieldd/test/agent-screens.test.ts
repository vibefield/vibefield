import type { CallerContext } from "@vibefield/contracts";
import { AGENT_FIELD } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { type AgentScreens, createAgentScreens } from "../src/agent-screens";
import { forwardProvenance } from "../src/forward-envelope";
import { RpcCallError } from "../src/native-link";
import { managedSummary as summary } from "./agent-field-summary";
import { floorTerminal, stateOf, type TestMonitor, testMonitor } from "./agent-monitor-fixture";

// PG-3b (PG-D6 (a): unread is the owner's mark and the phone is a screen; J2 (a), James 2026-11-01 03:55Z) — the
// screens a report reaches, on both desktops, over the hosted backend's real ledger (puppeteer-monitor 0.3.2). The
// HOME carries a phone's report only while the phone holds a `{remote, mesh}` board there, and orders what it carries
// for one reader to one owner. The OWNER keys a carried report by `onBehalfOf` under the peer connection that carried
// it (DS-L7 as amended 2026-11-01), so two readers behind one home are two screens and a peer reaches only its own.
// The door between them is simulated as PeerLink carries a call: the home's provenance (`forwardProvenance`) on a
// `peer-fieldd` call to the owner, the params whole, `device` among them (the owner's door strips its own id; its
// screens never read it).

const HOME = "dev-home";
const OWNER = "dev-owner";
const OWNER2 = "dev-owner-2";

const phone = (id = "conn_phone"): CallerContext => ({
  principal: { kind: "tailnet", login: "me@example.com", self: true, tailscaleId: "node-phone" },
  transport: "ws-tailnet",
  receivedAt: 0,
  connection: { id, helloClientKind: "ios" },
});

const windowOn = (id = "conn_window"): CallerContext => ({
  principal: { kind: "local-token", tokenId: "tk_window", scopes: ["agent.observe"] },
  transport: "ws-loopback",
  receivedAt: 0,
  clientKind: "renderer",
  connection: { id, helloClientKind: "renderer" },
});

const pluginOn = (id = "conn_plugin"): CallerContext => ({
  principal: { kind: "plugin", id: "com.example.watcher", scopes: ["agent.observe"] },
  transport: "inproc-port",
  receivedAt: 0,
  clientKind: "plugin-worker",
  connection: { id, helloClientKind: "plugin-worker" },
});

const peer = (connection = "conn_peer_home"): Omit<CallerContext, "onBehalfOf"> => ({
  principal: { kind: "peer-fieldd", deviceId: HOME, tailscaleId: "node-home" },
  transport: "ws-tailnet",
  receivedAt: 0,
  connection: { id: connection, helloClientKind: "peer-fieldd" },
});

const REMOTE_MESH = { projection: "remote", scope: "mesh" } as const;

interface PairOptions {
  latencyMs?: (ids: readonly string[]) => number;
  owner?: TestMonitor;
  /** a second owner desktop, its own backend */
  owner2?: TestMonitor;
  /** the door's verdict before anything reaches the owner (a link down, an owner without 3b) */
  fail?: (device: string, ids: readonly string[]) => Error | undefined;
}

/** Two desktops (three with `owner2`): the home, a phone's door, and the owner, the run's desktop, each with its own
 * backend. `link.connection` is the home's peer connection at the owners: a re-dial is a new one. */
async function pair(options: PairOptions = {}) {
  const owner = options.owner ?? (await testMonitor({ summaries: [working] }));
  const home = await testMonitor();
  const carried: Array<{ device: string; ids: readonly string[]; windowId: string | undefined }> =
    [];
  const link = { connection: "conn_peer_home" };
  const owners = new Map<string, AgentScreens>();
  const ownerSide = (monitor: TestMonitor): AgentScreens =>
    createAgentScreens({
      monitor: () => monitor.service,
      acknowledges: (ctx) => ctx.principal.kind === "local-token",
      carry: () => Promise.reject(new Error("the owner carries nothing here")),
    });
  owners.set(OWNER, ownerSide(owner));
  if (options.owner2 !== undefined) owners.set(OWNER2, ownerSide(options.owner2));
  /** the door: the home's forward of a call to an owner, as PeerLink carries it (the params whole) */
  const door = async (ctx: CallerContext, device: string, params: unknown): Promise<unknown> => {
    const onBehalfOf = forwardProvenance(ctx, { deviceId: HOME });
    const ids = ((params as { ids?: string[] }).ids ?? []) as readonly string[];
    const wait = options.latencyMs?.(ids) ?? 0;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const failure = options.fail?.(device, ids);
    if (failure !== undefined) throw failure;
    carried.push({ device, ids, windowId: onBehalfOf.windowId });
    const target = owners.get(device);
    if (target === undefined) throw new Error(`no owner ${device}`);
    return target.report({ ...peer(link.connection), onBehalfOf }, params);
  };
  const homeScreens = createAgentScreens({
    monitor: () => home.service,
    acknowledges: (ctx) => ctx.principal.kind === "local-token",
    carry: door,
  });
  const ownerScreens = owners.get(OWNER) as AgentScreens;
  /** a report routed by `device` at the home: its forward hook with the door's carry in hand */
  const routed = (ctx: CallerContext, ids: readonly string[], device = OWNER) =>
    homeScreens.forward(ctx, device, { ids: [...ids], device }, () =>
      door(ctx, device, { ids: [...ids], device }),
    );
  return { owner, home, homeScreens, ownerScreens, owners, door, routed, carried, link };
}

const working = summary({ runtimeRunId: "run-working", status: "working" });
const other = summary({ runtimeRunId: "run-other", status: "working" });

/** a turn on the owner: working, then idle, each at its own time (revisions rise per backend) */
const pushed = new WeakMap<TestMonitor, number>();
function turn(monitor: TestMonitor, base = working): void {
  const state = stateOf(base);
  for (const status of ["working", "idle"] as const) {
    const n = (pushed.get(monitor) ?? 0) + 1;
    pushed.set(monitor, n);
    monitor.clock.advance(60_000);
    monitor.runtime.push({
      ...state,
      revision: state.revision + n,
      status,
      statusSince: new Date(monitor.clock.now()).toISOString(),
    });
  }
}

/** let the carried reports (and the empties a closing board sends) settle */
const settle = async (ms = 0): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const refusal = async (promise: Promise<unknown>): Promise<RpcCallError> => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof RpcCallError)) throw new Error(`expected a refusal, got ${String(error)}`);
  return error;
};

describe("PG-3b — the phone is a screen, through the home", () => {
  it("PG-3b — a tailnet caller with a {remote, mesh} board reports a peer's row, and the owner's row stays unread:false across going idle", async () => {
    const { owner, homeScreens, routed, carried } = await pair();
    const id = owner.row("run-working").id;
    // a turn that ends while no screen shows it is the owner's mark
    turn(owner);
    expect(owner.row("run-working")).toMatchObject({ status: "idle", unread: true });
    homeScreens.openBoard(phone(), REMOTE_MESH);
    expect(await routed(phone(), [id])).toEqual({ reported: true });
    // carried for the phone behind its home: the owner reads the reader's window
    expect(carried).toEqual([{ device: OWNER, ids: [id], windowId: "conn_phone" }]);
    expect(owner.row("run-working").unread).toBe(false);
    // the phone shows it: turns that end now stay read
    turn(owner);
    expect(owner.row("run-working")).toMatchObject({ status: "idle", unread: false });
    turn(owner);
    expect(owner.row("run-working").unread).toBe(false);
  });

  it("PG-3b — refused with no board: no {remote, mesh} board on the connection, nothing is carried", async () => {
    const { homeScreens, routed, carried } = await pair();
    const none = await refusal(routed(phone(), ["run-working"]));
    expect(none.kind).toBe("PRECONDITION_FAILED");
    expect(none.details).toEqual({ state: "no-screen" });
    // a board that shows this desktop's rows alone, or no model, does not carry a report elsewhere
    const local = homeScreens.openBoard(phone(), { projection: "remote", scope: "local" });
    const field = homeScreens.openBoard(phone(), { projection: "field", scope: "mesh" });
    expect(field).toBeNull();
    expect((await refusal(routed(phone(), ["run-working"]))).details).toEqual({
      state: "no-screen",
    });
    expect(carried).toEqual([]);
    // …though the local remote board is this desktop's screen (its own rows, reported unrouted)
    expect(homeScreens.report(phone(), { ids: [] })).toEqual({ reported: true });
    local?.();
    expect(() => homeScreens.report(phone(), { ids: [] })).toThrow(RpcCallError);
    // a malformed report is refused before anything is carried
    homeScreens.openBoard(phone(), REMOTE_MESH);
    const malformed = await refusal(
      homeScreens.forward(phone(), OWNER, { ids: [""] }, () => Promise.resolve({})),
    );
    expect(malformed.kind).toBe("PRECONDITION_FAILED");
    expect(carried).toEqual([]);
  });

  it("PG-3b — two readers behind one home do not overwrite each other", async () => {
    const owner = await testMonitor({ summaries: [working, other] });
    const { homeScreens, routed, ownerScreens } = await pair({ owner });
    const shown = owner.row("run-working").id;
    homeScreens.openBoard(phone("conn_phone"), REMOTE_MESH);
    homeScreens.openBoard(phone("conn_ipad"), REMOTE_MESH);
    await routed(phone("conn_phone"), [shown]);
    // the iPad's card shows another row, then nothing: the phone's report stands
    await routed(phone("conn_ipad"), [owner.row("run-other").id]);
    await routed(phone("conn_ipad"), []);
    expect(ownerScreens.size.carried).toBe(1);
    turn(owner);
    expect(owner.row("run-working").unread).toBe(false);
    turn(owner, other);
    expect(owner.row("run-other").unread).toBe(true);
  });

  it("PG-3b — the board closes and the mark returns: the home sends an empty report to each owner it reported to", async () => {
    const { owner, homeScreens, ownerScreens, routed, carried } = await pair();
    const id = owner.row("run-working").id;
    const close = homeScreens.openBoard(phone(), REMOTE_MESH);
    await routed(phone(), [id]);
    expect(ownerScreens.size.carried).toBe(1);
    close?.();
    await settle();
    expect(carried.at(-1)).toEqual({ device: OWNER, ids: [], windowId: "conn_phone" });
    expect(ownerScreens.size.carried).toBe(0);
    expect(homeScreens.size.readers).toBe(0);
    turn(owner);
    expect(owner.row("run-working").unread).toBe(true);
    // and a report after the close is refused: the board is the screen
    expect((await refusal(routed(phone(), [id]))).details).toEqual({ state: "no-screen" });
  });

  it("PG-3b — a same-connection re-subscribe keeps the screen: the empty report lands strictly before the new one", async () => {
    // the empty is slow on the wire and the new report fast: without the home's order the empty would land last
    const { owner, homeScreens, routed, carried } = await pair({
      latencyMs: (ids) => (ids.length === 0 ? 40 : 0),
    });
    const id = owner.row("run-working").id;
    const first = homeScreens.openBoard(phone(), REMOTE_MESH);
    await routed(phone(), [id]);
    // a gap repair: unsubscribe, subscribe again, report again, on the same connection, at once
    first?.();
    homeScreens.openBoard(phone(), REMOTE_MESH);
    const again = routed(phone(), [id]);
    expect(await again).toEqual({ reported: true });
    await settle(60);
    expect(carried.map((entry) => entry.ids)).toEqual([[id], [], [id]]);
    turn(owner);
    expect(owner.row("run-working").unread).toBe(false);
  });

  it("PG-3b — a forwarded report acknowledges nothing (Q06): a crashed run stays on the owner's board", async () => {
    const live = summary({ runtimeRunId: "run-crashed", status: "working" });
    const owner = await testMonitor({
      summaries: [live],
      terminals: [floorTerminal({ sessionId: "run-crashed-pty", cwd: "/repo" }), floorTerminal()],
    });
    const { homeScreens, routed } = await pair({ owner });
    expect(owner.row("run-crashed").id).toBe("run-crashed-pty");
    const dead = crashed(live);
    owner.fold.publish([dead]);
    owner.runtime.push(stateOf(dead));
    expect(owner.row("run-crashed")).toMatchObject({ alive: false, wait: { kind: "failure" } });
    homeScreens.openBoard(phone(), REMOTE_MESH);
    await routed(phone(), ["run-crashed-pty"]);
    await Promise.resolve();
    // shown on the phone, through its home: cleared of its mark, and not acknowledged
    expect(owner.runtime.acknowledged).toEqual([]);
    expect(owner.row("run-crashed")).toMatchObject({ alive: false, wait: { kind: "failure" } });
  });

  it("PG-3b — the owner forgets a peer connection's screens when it closes, and a peer reaches only its own", async () => {
    const { owner, homeScreens, ownerScreens, routed } = await pair();
    const id = owner.row("run-working").id;
    homeScreens.openBoard(phone(), REMOTE_MESH);
    await routed(phone(), [id]);
    // another peer connection naming the SAME reader: its key is its own connection's, so the phone's stands
    const sameReader = forwardProvenance(phone(), { deviceId: HOME });
    expect(
      ownerScreens.report({ ...peer("conn_peer_other"), onBehalfOf: sameReader }, { ids: [] }),
    ).toEqual({
      reported: true,
    });
    turn(owner);
    expect(owner.row("run-working").unread).toBe(false);
    // the carrying connection closes: its screens go with it
    ownerScreens.connectionClosed("conn_peer_other");
    expect(ownerScreens.size.carried).toBe(1);
    ownerScreens.connectionClosed("conn_peer_home");
    expect(ownerScreens.size.carried).toBe(0);
    turn(owner);
    expect(owner.row("run-working").unread).toBe(true);
  });

  it("PG-3b — a carried report names its reader: no windowId, no screen", async () => {
    const { ownerScreens } = await pair();
    const unnamed = { clientKind: "ios", deviceId: HOME };
    let thrown: unknown;
    try {
      ownerScreens.report({ ...peer(), onBehalfOf: unnamed }, { ids: ["run-working"] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RpcCallError);
    expect((thrown as RpcCallError).details).toMatchObject({ state: "no-screen" });
    expect(ownerScreens.size.carried).toBe(0);
  });

  it("the connection-bound screens stand: a model board is a window's screen, a remote board a phone's, a field board nobody's", async () => {
    const { homeScreens } = await pair();
    expect(() => homeScreens.report(windowOn(), { ids: [] })).toThrow(RpcCallError);
    const model = homeScreens.openBoard(windowOn(), { projection: "model", scope: "local" });
    const mesh = homeScreens.openBoard(windowOn(), { projection: "model", scope: "mesh" });
    expect(homeScreens.report(windowOn(), { ids: ["pane-1"] })).toEqual({ reported: true });
    // two boards share the connection's one screen: it goes with the last
    model?.();
    expect(homeScreens.report(windowOn(), { ids: [] })).toEqual({ reported: true });
    mesh?.();
    expect(() => homeScreens.report(windowOn(), { ids: [] })).toThrow(RpcCallError);
    expect(homeScreens.openBoard(phone(), { projection: "field", scope: "local" })).toBeNull();
    expect(() => homeScreens.report(phone(), { ids: [] })).toThrow(RpcCallError);
    homeScreens.openBoard(phone(), { projection: "remote", scope: "local" });
    expect(homeScreens.report(phone(), { ids: [] })).toEqual({ reported: true });
  });

  it("PG-3b — a plugin holding {remote, mesh} is no screen and no reader: refused by report and by forward, the owner's mark kept", async () => {
    const { owner, homeScreens, routed, carried } = await pair();
    const id = owner.row("run-working").id;
    expect(homeScreens.openBoard(pluginOn(), REMOTE_MESH)).toBeNull();
    expect(homeScreens.openBoard(pluginOn(), { projection: "model", scope: "local" })).toBeNull();
    expect(homeScreens.size).toMatchObject({ screens: 0, readers: 0 });
    expect(() => homeScreens.report(pluginOn(), { ids: [id] })).toThrow(RpcCallError);
    expect((await refusal(routed(pluginOn(), [id]))).details).toEqual({ state: "no-screen" });
    expect(carried).toEqual([]);
    turn(owner);
    expect(owner.row("run-working").unread).toBe(true);
    // a window's remote board reads the peers and is no screen either; its model board is
    expect(homeScreens.openBoard(windowOn(), REMOTE_MESH)).toBeNull();
    expect((await refusal(routed(windowOn(), [id]))).details).toEqual({ state: "no-screen" });
  });

  it("PG-3b — one peer connection opens at most CARRIED_SCREENS_PER_PEER carried screens; past it, refused carried-cap", async () => {
    const { ownerScreens } = await pair();
    const reader = (n: number) => forwardProvenance(phone(`conn_reader_${n}`), { deviceId: HOME });
    for (let n = 0; n < AGENT_FIELD.CARRIED_SCREENS_PER_PEER; n += 1)
      ownerScreens.report({ ...peer(), onBehalfOf: reader(n) }, { ids: ["run-working"] });
    expect(ownerScreens.size.carried).toBe(AGENT_FIELD.CARRIED_SCREENS_PER_PEER);
    let thrown: unknown;
    try {
      ownerScreens.report({ ...peer(), onBehalfOf: reader(999) }, { ids: ["run-working"] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RpcCallError);
    expect((thrown as RpcCallError).details).toEqual({ state: "no-screen", reason: "carried-cap" });
    // the screens already open stand and still take reports; another peer connection has its own bound
    expect(ownerScreens.report({ ...peer(), onBehalfOf: reader(0) }, { ids: [] })).toEqual({
      reported: true,
    });
    expect(
      ownerScreens.report({ ...peer("conn_peer_other"), onBehalfOf: reader(999) }, { ids: ["x"] }),
    ).toEqual({ reported: true });
  });

  it("PG-3b — the carrying connection's last remote board on the owner closes: its carried screens go with it", async () => {
    const { owner, ownerScreens, homeScreens, routed } = await pair();
    const id = owner.row("run-working").id;
    // the home's hub upstream: the peer connection's remote board on the owner (no screen, by kind)
    const upstream = ownerScreens.openBoard(peer(), { projection: "remote", scope: "local" });
    const second = ownerScreens.openBoard(peer(), { projection: "remote", scope: "local" });
    homeScreens.openBoard(phone(), REMOTE_MESH);
    await routed(phone(), [id]);
    expect(ownerScreens.size).toMatchObject({ screens: 0, carried: 1 });
    upstream?.();
    expect(ownerScreens.size.carried).toBe(1);
    second?.();
    expect(ownerScreens.size.carried).toBe(0);
    turn(owner);
    expect(owner.row("run-working").unread).toBe(true);
  });

  it("PG-3b — the home's owner set changes only once a carry is known to land", async () => {
    const refused = new RpcCallError(
      "FORBIDDEN_SCOPE",
      "agent.reportShown is local to its device; it does not federate",
      false,
      { method: "agent.reportShown", locality: "local" },
    );
    const lost = new RpcCallError("UNAVAILABLE", "peer unreachable", true, {
      service: "peer-link",
      device: OWNER,
      state: "unreachable",
    });
    let verdict: Error | undefined;
    const { homeScreens, routed, carried } = await pair({
      fail: () => {
        const once = verdict;
        verdict = undefined;
        return once;
      },
    });
    const close = homeScreens.openBoard(phone(), REMOTE_MESH);
    // an owner that refused (nothing stands there): no empty is owed it at the close
    verdict = refused;
    await refusal(routed(phone(), ["run-a"]));
    expect(homeScreens.size.owners).toBe(0);
    // a carry whose outcome is unknown may have landed: the owner is kept, and owed the empty
    verdict = lost;
    await refusal(routed(phone(), ["run-a"]));
    expect(homeScreens.size.owners).toBe(1);
    // the phone's own empty that fails keeps the owner too, so the close sends another
    await routed(phone(), ["run-a"]);
    verdict = lost;
    await refusal(routed(phone(), []));
    expect(homeScreens.size.owners).toBe(1);
    // and one that lands drops it
    await routed(phone(), []);
    expect(homeScreens.size.owners).toBe(0);
    await routed(phone(), ["run-a"]);
    const before = carried.length;
    close?.();
    await settle();
    expect(carried.slice(before)).toEqual([{ device: OWNER, ids: [], windowId: "conn_phone" }]);
  });

  it("PG-3b — a report queued behind a carry whose board closed while it waited is refused", async () => {
    const { owner, homeScreens, routed } = await pair({
      latencyMs: (ids) => (ids.includes("slow") ? 40 : 0),
    });
    const id = owner.row("run-working").id;
    const close = homeScreens.openBoard(phone(), REMOTE_MESH);
    const first = routed(phone(), ["slow"]);
    const queued = refusal(routed(phone(), [id]));
    // the slow carry is on the wire (its board was open when it began); the board closes behind it
    await settle(5);
    close?.();
    expect(await first).toEqual({ reported: true });
    expect((await queued).details).toEqual({ state: "no-screen" });
  });

  it("PG-3b — a closing reader sends the empty to EACH owner it reported to", async () => {
    const owner2 = await testMonitor({ summaries: [other] });
    const { homeScreens, owners, routed, carried } = await pair({ owner2 });
    const close = homeScreens.openBoard(phone(), REMOTE_MESH);
    await routed(phone(), ["run-working"], OWNER);
    await routed(phone(), ["run-other"], OWNER2);
    expect(owners.get(OWNER2)?.size.carried).toBe(1);
    close?.();
    await settle();
    expect(
      carried
        .filter((entry) => entry.ids.length === 0)
        .map((entry) => entry.device)
        .sort(),
    ).toEqual([OWNER, OWNER2].sort());
    expect(owners.get(OWNER)?.size.carried).toBe(0);
    expect(owners.get(OWNER2)?.size.carried).toBe(0);
  });

  it("PG-3b — the owner restarts or its link re-dials: the home re-carries the open card's report, and the mark stays clear", async () => {
    const { owner, homeScreens, ownerScreens, routed, carried, link } = await pair();
    const id = owner.row("run-working").id;
    homeScreens.openBoard(phone(), REMOTE_MESH);
    homeScreens.openBoard(phone("conn_ipad"), REMOTE_MESH);
    await routed(phone(), [id]);
    // the iPad showed something of this owner, then nothing: it has no report to replay
    await routed(phone("conn_ipad"), ["run-other"]);
    await routed(phone("conn_ipad"), []);
    // the home's peer connection drops: the owner forgets every screen under it
    ownerScreens.connectionClosed(link.connection);
    expect(ownerScreens.size.carried).toBe(0);
    // re-dialled: a new connection, and the link answers again
    link.connection = "conn_peer_home_2";
    const before = carried.length;
    homeScreens.linkReady(OWNER);
    await settle();
    expect(carried.slice(before)).toEqual([{ device: OWNER, ids: [id], windowId: "conn_phone" }]);
    expect(ownerScreens.size.carried).toBe(1);
    turn(owner);
    expect(owner.row("run-working").unread).toBe(false);
    // another device's link answering re-carries nothing; neither does a closed reader's
    homeScreens.linkReady("dev-elsewhere");
    await settle();
    expect(carried.length).toBe(before + 1);
  });

  // the fold check (2026-11-01) — what the replay carries is what the phone shows NOW
  it("PG-3b — after a failed empty, a re-dial carries nothing non-empty: the phone said it shows nothing", async () => {
    const lost = new RpcCallError("UNAVAILABLE", "peer unreachable", true, {
      service: "peer-link",
      device: OWNER,
      state: "unreachable",
    });
    let verdict: Error | undefined;
    const { homeScreens, routed, carried } = await pair({
      fail: () => {
        const once = verdict;
        verdict = undefined;
        return once;
      },
    });
    homeScreens.openBoard(phone(), REMOTE_MESH);
    await routed(phone(), ["run-x"]);
    verdict = lost;
    await refusal(routed(phone(), []));
    // still owed the close's empty, and nothing to replay
    expect(homeScreens.size.owners).toBe(1);
    const before = carried.length;
    homeScreens.linkReady(OWNER);
    await settle();
    expect(carried.slice(before).filter((entry) => entry.ids.length > 0)).toEqual([]);
  });

  it("PG-3b — a re-dial while a report is in flight replays that report, not the one before it", async () => {
    const { homeScreens, routed, carried } = await pair({
      latencyMs: (ids) => (ids.includes("run-y") ? 40 : 0),
    });
    homeScreens.openBoard(phone(), REMOTE_MESH);
    await routed(phone(), ["run-x"]);
    const inFlight = routed(phone(), ["run-y"]);
    await settle(5);
    homeScreens.linkReady(OWNER);
    expect(await inFlight).toEqual({ reported: true });
    await settle(60);
    expect(carried.map((entry) => entry.ids)).toEqual([["run-x"], ["run-y"], ["run-y"]]);
  });

  // the fold2 check [0] — a replay runs only where the owner already forgot the screen, so `shown` is the phone's
  // latest ask whatever became of its carry, except when the owner itself refused it for good
  it("PG-3b — the owner's own lasting refusal is undone in the replay: the re-dial carries the last report that stood", async () => {
    const capped = new RpcCallError(
      "PRECONDITION_FAILED",
      "this peer connection carries 64 readers' screens already",
      false,
      { state: "no-screen", reason: "carried-cap" },
    );
    const without3b = new RpcCallError(
      "FORBIDDEN_SCOPE",
      "agent.reportShown is local to its device; it does not federate",
      false,
      { method: "agent.reportShown", locality: "local" },
    );
    for (const lasting of [capped, without3b]) {
      let verdict: Error | undefined;
      const { homeScreens, routed, carried } = await pair({
        fail: () => {
          const once = verdict;
          verdict = undefined;
          return once;
        },
      });
      homeScreens.openBoard(phone(), REMOTE_MESH);
      await routed(phone(), ["run-x"]);
      verdict = lasting;
      await refusal(routed(phone(), ["run-z"]));
      const before = carried.length;
      homeScreens.linkReady(OWNER);
      await settle();
      expect(
        carried.slice(before).map((entry) => entry.ids),
        lasting.kind,
      ).toEqual([["run-x"]]);
    }
  });

  it("PG-3b — a report that never left (the link offline) stays the phone's ask: the re-dial carries it, not the one before", async () => {
    const offline = new RpcCallError("UNAVAILABLE", "no endpoint for the peer", true, {
      service: "peer-link",
      device: OWNER,
      state: "offline",
    });
    let verdict: Error | undefined;
    const { homeScreens, routed, carried } = await pair({
      fail: () => {
        const once = verdict;
        verdict = undefined;
        return once;
      },
    });
    homeScreens.openBoard(phone(), REMOTE_MESH);
    await routed(phone(), ["run-x"]);
    verdict = offline;
    await refusal(routed(phone(), ["run-y"]));
    // never sent: the owner is not owed an empty for it (it stood there before, so it stays owed)
    expect(homeScreens.size.owners).toBe(1);
    const before = carried.length;
    homeScreens.linkReady(OWNER);
    await settle();
    expect(carried.slice(before).map((entry) => entry.ids)).toEqual([["run-y"]]);
  });

  it("PG-3b — the owner's upstream comes back on the same connection (a hub resync): the replay puts the carried screen back", async () => {
    const { owner, ownerScreens, homeScreens, routed } = await pair();
    const id = owner.row("run-working").id;
    const first = ownerScreens.openBoard(peer(), { projection: "remote", scope: "local" });
    const second = ownerScreens.openBoard(peer(), { projection: "remote", scope: "local" });
    homeScreens.openBoard(phone(), REMOTE_MESH);
    await routed(phone(), [id]);
    first?.();
    second?.();
    expect(ownerScreens.size.carried).toBe(0);
    // the hub re-attaches on the same peer connection: no re-dial, the upstream's return is the cue
    ownerScreens.openBoard(peer(), { projection: "remote", scope: "local" });
    homeScreens.linkReady(OWNER);
    await settle();
    expect(ownerScreens.size.carried).toBe(1);
    turn(owner);
    expect(owner.row("run-working").unread).toBe(false);
  });
});

/** the runtime's failure on a run whose PTY died (agent-monitor.test.ts's `crashed`) */
function crashed(base: ReturnType<typeof summary>): ReturnType<typeof summary> {
  const monitor = base.monitor;
  if (monitor === undefined) throw new Error("a crash needs a mirror");
  const at = "2026-09-13T10:05:05.000Z";
  return {
    ...base,
    status: "blocked",
    continuation: { persisted: true, resumable: true, exited: true },
    monitor: {
      ...monitor,
      revision: monitor.revision + 1,
      status: "blocked",
      statusSince: at,
      alive: false,
      blockers: [
        {
          id: "run:runtime",
          kind: "failure",
          since: at,
          detail: "Run failed: signal",
          failure: { code: "signal", recoverable: false },
        },
      ],
    },
  };
}
