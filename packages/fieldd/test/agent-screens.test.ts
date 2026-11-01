import type { CallerContext } from "@vibefield/contracts";
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
// The door between them is simulated as fieldd's is: the home's provenance (`forwardProvenance`) on a `peer-fieldd`
// call to the owner, its `device` stripped there.

const HOME = "dev-home";
const OWNER = "dev-owner";

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

const peer = (connection = "conn_peer_home"): Omit<CallerContext, "onBehalfOf"> => ({
  principal: { kind: "peer-fieldd", deviceId: HOME, tailscaleId: "node-home" },
  transport: "ws-tailnet",
  receivedAt: 0,
  connection: { id: connection, helloClientKind: "peer-fieldd" },
});

const REMOTE_MESH = { projection: "remote", scope: "mesh" } as const;

/** Two desktops: the home (a phone's door) and the owner (the run's desktop), each with its own backend. */
async function pair(
  options: { latencyMs?: (ids: readonly string[]) => number; owner?: TestMonitor } = {},
) {
  const owner = options.owner ?? (await testMonitor({ summaries: [working] }));
  const home = await testMonitor();
  const carried: Array<{ device: string; ids: readonly string[]; windowId: string | undefined }> =
    [];
  let ownerScreens: AgentScreens | null = null;
  /** the door: the home's forward of a call to the owner, as PeerLink carries it */
  const door = async (ctx: CallerContext, device: string, params: unknown): Promise<unknown> => {
    const onBehalfOf = forwardProvenance(ctx, { deviceId: HOME });
    const { device: _routed, ...rest } = params as Record<string, unknown>;
    const ids = (rest["ids"] as string[] | undefined) ?? [];
    const wait = options.latencyMs?.(ids) ?? 0;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    carried.push({ device, ids, windowId: onBehalfOf.windowId });
    if (ownerScreens === null) throw new Error("the owner is not up");
    return ownerScreens.report({ ...peer(), onBehalfOf }, rest);
  };
  const homeScreens = createAgentScreens({
    monitor: () => home.service,
    acknowledges: (ctx) => ctx.principal.kind === "local-token",
    carry: door,
  });
  ownerScreens = createAgentScreens({
    monitor: () => owner.service,
    acknowledges: (ctx) => ctx.principal.kind === "local-token",
    carry: () => Promise.reject(new Error("the owner carries nothing here")),
  });
  const ownerSide: AgentScreens = ownerScreens;
  /** a report routed by `device` at the home: its forward hook with the door's carry in hand */
  const routed = (ctx: CallerContext, ids: readonly string[]) =>
    homeScreens.forward(ctx, OWNER, { ids: [...ids], device: OWNER }, () =>
      door(ctx, OWNER, { ids: [...ids], device: OWNER }),
    );
  return { owner, home, homeScreens, ownerScreens: ownerSide, door, routed, carried };
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
