import {
  AGENT_FIELD,
  AgentReportShownParams,
  type AgentReportShownResult,
  type CallerContext,
  type ForwardedFor,
  SCREEN_BOARDS,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { AgentMonitorService } from "./agent-monitor";
import { RpcCallError } from "./native-link";

// MV-3a (L5, M20) and PG-3b (PG-D6 (a), J2 (a), James 2026-11-01 03:55Z) — the screens `agent.reportShown` reaches,
// on the desktop a caller holds a board on and on the desktop that owns the row.
//
// A SCREEN is a product connection holding a board that shows the model, BY ITS PRINCIPAL'S KIND
// (`SCREEN_BOARDS`, contracts, beside MONITOR_AUDIENCE; the 3b review [0]): a `model` board for this desktop's own
// windows and shell, a `remote` board for the phone. It is opened with the connection's first such board and
// forgotten with its last, and what it reports shown clears the rows' unread marks on this desktop's backend. A
// plugin, a guest, an agent's MCP session or a peer daemon holding a board is no screen: clearing a mark is a
// mutation of the owner's ledger, granted by kind and narrowly. Q05: forgetting a screen keeps the marks
// (`agent-monitor.ts`). Q06: only this desktop's own window looks for the person, so only its screen acknowledges a
// crashed run's failure.
//
// A READER is a phone's connection (`SCREEN_BOARDS[kind].reader`) holding a `{remote, mesh}` board: it sees other
// desktops' rows through this one, so its reports for them are carried to their owners (the door's `device?`
// forward, through `ProductApi.wrapForward`). The home carries a report only for a reader. Per reader it keeps:
//  · `owners`: the owners it may have a standing report on. A non-empty report adds its owner BEFORE the carry,
//    so a close that follows an in-flight report still sends the owner its empty. The add is undone when the carry
//    is refused with a verdict that proves nothing stands there (`notDelivered`: the owner's own refusal, or the
//    link's "never sent"). An empty report removes its owner only AFTER its carry lands, so a failed empty leaves the
//    owner owed the close's (the 3b review [2], [12]).
//  · `shown`: what the phone shows of each owner NOW. A non-empty report sets it when its carry begins, and a
//    not-delivered verdict puts back what stood. An empty report clears it before its carry, whatever the outcome
//    (the fold check [0], [1]). The home carries it again when the way to that owner comes back (`linkReady`):
//    the peer link answers a new dial, or the mesh board's upstream to that owner re-attaches on the same link after
//    a resync (`MeshBoard`'s `onUpstreamReady`, the fold check [2]). In both cases the owner forgot the carried
//    screen (with the old connection, or with its last `remote` board), and the phone's board at the home never
//    closed, so the phone re-sends nothing ([13]). The replay reads `shown` inside its queued task, so a report
//    still in flight is the one replayed. A duplicate is harmless, since a report replaces its screen's set.
// When the reader's last mesh board closes (pause, re-home, a gap repair's unsubscribe, a lost socket), it sends
// each owner in `owners` an empty report. Everything carried for one reader to one owner goes in order (`inOrder`),
// so a re-subscribe's new report never lands before the empty one, and a report whose board closed while it waited
// is refused.
//
// A CARRIED SCREEN is the owner's for a report a peer daemon carried. Every reader behind one home shares that
// home's ONE peer connection here, and a report replaces its screen's whole set, so the owner keys the screen by the
// envelope's `onBehalfOf` {deviceId, windowId} UNDER the peer connection that carried it. That is the restrict-only
// use DS-L7 was amended for (2026-11-01; `contracts/src/forwarding.ts`, F1b's `clientDeviceId` clause is the
// model): the key only splits one peer connection's reports into per-reader sets, never reaches another
// connection's screen and grants nothing. A carried screen acknowledges nothing, opens on its first report, and goes
// on an empty one.
// Decision 1 (PG-3b; kept by the lead's ruling on the 3b review [1]): a carried report needs NO board on the
// carrying connection. The home's hub upstream (that connection's `remote` board here) may still be attaching when
// the phone's first report arrives, and a refusal then would be recorded by the phone's sender once per device
// (PG-3e). Bounded instead:
//  · by count: at most `AGENT_FIELD.CARRIED_SCREENS_PER_PEER` per peer connection, the next refused
//    `{state: "no-screen", reason: "carried-cap"}`;
//  · by the upstream: when the carrying connection's last `remote` board here closes (the home's hub upstream going
//    away), its carried screens go, so a failed empty cannot outlive the upstream it rode beside. A hub that only
//    resyncs re-attaches on the same connection, and the home's replay at that re-attach puts its readers' screens
//    back;
//  · by the connection: they go when it closes (`connectionClosed`).
// The 3b review [3] (a renderer's provenance windowId is its participant, not its connection) is answered by the kind
// gate: only a phone is a reader, and a phone's windowId is its connection id.
//
// Q-P6's constraint (the 3b review [15]), for when a desktop window may report peer rows through this door: a
// renderer's `onBehalfOf.windowId` is its `participantId`, stable across a reload's new connection, while the home's
// readers and order are keyed by connection id. Before a renderer becomes a reader, key the home's reader, its chain
// and its replay by the same windowId the owner keys by (with a refcount across connections), or carry a
// per-connection id as the windowId of carried reports. Otherwise an old connection's late empty can land after the
// new connection's first report and clear its screen.

/** What a board asks, as far as screens care. */
export interface ScreenBoardAsk {
  projection: string;
  scope: string;
}

export interface AgentScreensOptions {
  /** the backend beside the runtime; null until it is built (no screen opens before it) */
  monitor: () => AgentMonitorService | null;
  /** Q06 — does this caller look for the person (the daemon's `ownWindow`)? */
  acknowledges: (ctx: CallerContext) => boolean;
  /** the door's forward of a read for `ctx` to `device`, with this daemon's provenance for it
   * (`ProductApi.forwardFor`): a closing reader's empty report, a re-dial's replay */
  carry: (ctx: CallerContext, device: string, params: AgentReportShownParams) => Promise<unknown>;
  logger?: Logger;
}

export interface AgentScreens {
  /** A board opened on `ctx`'s connection: its screen and, for a phone's `{remote, mesh}`, its reader; on an owner,
   * a peer's `remote` board bounds the screens it carries. The close, or null when the board is none of these. */
  openBoard(ctx: CallerContext, ask: ScreenBoardAsk): (() => void) | null;
  /** `agent.reportShown` served here: the connection's screen, or a carried one for a peer's forward. */
  report(ctx: CallerContext, params: unknown): AgentReportShownResult;
  /** `agent.reportShown` routed to another desktop: the home's check and order around the door's carry. */
  forward(
    ctx: CallerContext,
    device: string,
    params: unknown,
    carry: () => Promise<unknown>,
  ): Promise<unknown>;
  /** the way to `device` is back (its peer link answered a dial, or the mesh board's upstream to it re-attached):
   * carry each reader's current report to it again */
  linkReady(device: string): void;
  /** a product connection closed: the screens peers' reports opened under it go */
  connectionClosed(connectionId: string): void;
  /** what stands (tests read it, as the mesh board's `size`) */
  readonly size: { screens: number; readers: number; owners: number; carried: number };
}

interface Counted {
  count: number;
  close: () => void;
}

interface Reader {
  count: number;
  /** the reader's context at its first board: the provenance its closing and replayed reports are carried with */
  ctx: CallerContext;
  /** the owners it may have a standing report on */
  owners: Set<string>;
  /** the last non-empty ids that landed, per owner */
  shown: Map<string, readonly string[]>;
}

const REPORTED: AgentReportShownResult = { reported: true };

const malformed = (): RpcCallError =>
  new RpcCallError("PRECONDITION_FAILED", "expected { ids: string[], device?: string }", false);

const noScreen = (): RpcCallError =>
  new RpcCallError(
    "PRECONDITION_FAILED",
    'no board is open on this connection — subscribe agent.subscribe {projection: "model"} (a window) or {projection: "remote"} (a phone) first; the board is the screen',
    false,
    { state: "no-screen" },
  );

const noReader = (): RpcCallError =>
  new RpcCallError(
    "PRECONDITION_FAILED",
    'no mesh board is open on this connection — a phone\'s report reaches another desktop only through agent.subscribe {projection: "remote", scope: "mesh"}; the board is the screen',
    false,
    { state: "no-screen" },
  );

const unnamedReader = (): RpcCallError =>
  new RpcCallError(
    "PRECONDITION_FAILED",
    "a carried report names the reader it is for (onBehalfOf.windowId); the owner keys its screen by it",
    false,
    { state: "no-screen" },
  );

/** Not transient (the fold check [3]): the owner's bound, not a missing board. A sender records it once per device,
 * as it does a `locality: "local"` refusal, and does not retry it on every open. */
const carriedCap = (): RpcCallError =>
  new RpcCallError(
    "PRECONDITION_FAILED",
    `this peer connection carries ${AGENT_FIELD.CARRIED_SCREENS_PER_PEER} readers' screens already; an empty report from one frees its place`,
    false,
    { state: "no-screen", reason: "carried-cap" },
  );

/** A carry's refusal that proves no screen stands on the owner for it: the owner's own answer (any refusal it
 * sent), or a forward that never left (no endpoint, routing not armed, the link disposed). A transport verdict on a
 * call that may have left (`unreachable`, a deadline) proves nothing, so the owner stays owed its empty. */
function notDelivered(error: unknown): boolean {
  if (!(error instanceof RpcCallError)) return false;
  if (error.kind !== "UNAVAILABLE") return true;
  const state = (error.details as { state?: unknown } | undefined)?.state;
  return state === "offline" || state === "starting" || state === "disposed";
}

/** A carried screen's key: the carrying connection first, so no other connection's key can equal it. */
const carriedKey = (connectionId: string, behalf: ForwardedFor, windowId: string): string =>
  `${connectionId}\u001f${behalf.deviceId}\u001f${windowId}`;

export function createAgentScreens(opts: AgentScreensOptions): AgentScreens {
  const logger = opts.logger ?? createNoopLogger();
  /** connection id → its screen */
  const screens = new Map<string, Counted>();
  /** connection id → its reader */
  const readers = new Map<string, Reader>();
  /** `reader␟owner` → the settled tail of what is being carried for that pair */
  const queues = new Map<string, Promise<void>>();
  /** peer connection id → carried key → its close */
  const carried = new Map<string, Map<string, () => void>>();
  /** peer connection id → how many `remote` boards it holds here (the home's hub upstream) */
  const upstreams = new Map<string, number>();

  const once = (fn: () => void): (() => void) => {
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      fn();
    };
  };

  const openScreen = (ctx: CallerContext): (() => void) | null => {
    const service = opts.monitor();
    const id = ctx.connection?.id;
    if (service === null || id === undefined) return null;
    let held = screens.get(id);
    if (held === undefined) {
      held = { count: 0, close: service.openScreen(id, { acknowledges: opts.acknowledges(ctx) }) };
      screens.set(id, held);
    }
    const screen = held;
    screen.count += 1;
    return once(() => {
      screen.count -= 1;
      if (screen.count > 0) return;
      screens.delete(id);
      screen.close();
    });
  };

  /** Carry `task` for one reader to one owner after everything before it for that pair has settled. */
  const inOrder = <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = queues.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return result;
  };
  const pairKey = (readerId: string, owner: string): string => `${readerId}\u001f${owner}`;

  /** a carry the home makes of its own accord, logged, never thrown: a close's empty, or a replay of what the reader
   * shows NOW, read inside the queued task (the fold check [1]: a report still in flight when the link re-dials is
   * the one replayed, and a reader gone by then replays nothing) */
  const carryQuietly = (
    readerId: string,
    reader: Reader,
    owner: string,
    why: "release" | "replay",
  ): void => {
    void inOrder(pairKey(readerId, owner), async () => {
      if (why === "release") return opts.carry(reader.ctx, owner, { ids: [], device: owner });
      if (readers.get(readerId) !== reader) return undefined;
      const ids = reader.shown.get(owner);
      if (ids === undefined) return undefined;
      return opts.carry(reader.ctx, owner, { ids: [...ids], device: owner });
    }).catch((error: unknown) =>
      why === "release"
        ? // the 3b review [12]: not retried. Until the carrying connection or its upstream closes on the owner,
          // the owner's carried screen for this reader stands, and those rows earn no unread mark there
          logger.warn(
            "fieldd.agents.screen_release_failed",
            "A closed reader's empty report did not reach its owner; its screen there stands until that connection or its upstream closes",
            { device: owner, error: error instanceof Error ? error.message : String(error) },
          )
        : logger.warn(
            "fieldd.agents.screen_replay_failed",
            "A reader's report was not carried again after the link to its owner re-dialled",
            { device: owner, error: error instanceof Error ? error.message : String(error) },
          ),
    );
  };

  const openReader = (ctx: CallerContext): (() => void) | null => {
    const id = ctx.connection?.id;
    if (id === undefined) return null;
    let held = readers.get(id);
    if (held === undefined) {
      held = { count: 0, ctx, owners: new Set(), shown: new Map() };
      readers.set(id, held);
    }
    const reader = held;
    reader.count += 1;
    return once(() => {
      reader.count -= 1;
      if (reader.count > 0) return;
      readers.delete(id);
      // what it showed is shown no more: each owner it may have reported to is told so, in order behind its last
      for (const owner of reader.owners) carryQuietly(id, reader, owner, "release");
      reader.owners.clear();
      reader.shown.clear();
    });
  };

  const dropCarried = (connectionId: string): void => {
    const held = carried.get(connectionId);
    if (held === undefined) return;
    carried.delete(connectionId);
    for (const close of held.values()) close();
  };

  /** a peer connection's `remote` board on this owner (the home's hub upstream): after its last closes, the screens
   * that connection carried go */
  const openUpstream = (ctx: CallerContext): (() => void) | null => {
    const id = ctx.connection?.id;
    if (id === undefined) return null;
    upstreams.set(id, (upstreams.get(id) ?? 0) + 1);
    return once(() => {
      const left = (upstreams.get(id) ?? 1) - 1;
      if (left > 0) {
        upstreams.set(id, left);
        return;
      }
      upstreams.delete(id);
      dropCarried(id);
    });
  };

  const reportCarried = (
    service: AgentMonitorService | null,
    ctx: CallerContext,
    behalf: ForwardedFor,
    ids: readonly string[],
  ): AgentReportShownResult => {
    const connectionId = ctx.connection?.id;
    if (service === null || connectionId === undefined) throw noScreen();
    if (behalf.windowId === undefined) throw unnamedReader();
    const key = carriedKey(connectionId, behalf, behalf.windowId);
    const held = carried.get(connectionId);
    const close = held?.get(key);
    if (ids.length === 0) {
      // the reader shows nothing of ours: its screen goes (the ledger's union reads the same either way)
      if (held !== undefined && close !== undefined) {
        held.delete(key);
        if (held.size === 0) carried.delete(connectionId);
        close();
      }
      return REPORTED;
    }
    if (close === undefined) {
      if ((held?.size ?? 0) >= AGENT_FIELD.CARRIED_SCREENS_PER_PEER) throw carriedCap();
      const opened = service.openScreen(key, { acknowledges: false });
      const map = held ?? new Map<string, () => void>();
      map.set(key, opened);
      carried.set(connectionId, map);
    }
    service.reportShown(key, ids);
    return REPORTED;
  };

  return {
    openBoard(ctx, ask) {
      const boards = SCREEN_BOARDS[ctx.principal.kind];
      const isScreen =
        (ask.projection === "model" && boards.model) ||
        (ask.projection === "remote" && boards.remote);
      const screen = isScreen ? openScreen(ctx) : null;
      const reader =
        ask.projection === "remote" && ask.scope === "mesh" && boards.reader
          ? openReader(ctx)
          : null;
      // on an owner, the home's hub upstream: what bounds the screens that connection carries
      const upstream =
        ask.projection === "remote" && ctx.principal.kind === "peer-fieldd"
          ? openUpstream(ctx)
          : null;
      if (screen === null && reader === null && upstream === null) return null;
      return once(() => {
        reader?.();
        screen?.();
        upstream?.();
      });
    },

    report(ctx, params) {
      const parsed = AgentReportShownParams.safeParse(params ?? {});
      if (!parsed.success) throw malformed();
      const service = opts.monitor();
      // DS-L7 as amended — a peer daemon's forward for a reader behind it is that reader's screen here
      const behalf = ctx.principal.kind === "peer-fieldd" ? ctx.onBehalfOf : undefined;
      if (behalf !== undefined) return reportCarried(service, ctx, behalf, parsed.data.ids);
      const screenId = ctx.connection?.id;
      if (
        service === null ||
        screenId === undefined ||
        !service.reportShown(screenId, parsed.data.ids)
      )
        throw noScreen();
      return REPORTED;
    },

    async forward(ctx, device, params, carry) {
      const parsed = AgentReportShownParams.safeParse(params ?? {});
      if (!parsed.success) throw malformed();
      const id = ctx.connection?.id;
      const reader = id === undefined ? undefined : readers.get(id);
      if (id === undefined || reader === undefined) throw noReader();
      const ids = parsed.data.ids;
      return inOrder(pairKey(id, device), async () => {
        // the board may have closed while an earlier carry for this pair was on the wire
        if (readers.get(id) !== reader) throw noReader();
        if (ids.length === 0) {
          // the phone shows nothing of this owner, whatever the carry's outcome: nothing is replayed
          reader.shown.delete(device);
          const result = await carry();
          // landed: nothing is owed it
          reader.owners.delete(device);
          return result;
        }
        // what the phone shows now, from the moment it is carried: a replay queued behind this carry reads it
        const added = !reader.owners.has(device);
        const before = reader.shown.get(device);
        reader.owners.add(device);
        reader.shown.set(device, ids);
        try {
          return await carry();
        } catch (error) {
          if (notDelivered(error)) {
            if (added) reader.owners.delete(device);
            if (before === undefined) reader.shown.delete(device);
            else reader.shown.set(device, before);
          }
          throw error;
        }
      });
    },

    linkReady(device) {
      for (const [id, reader] of readers)
        if (reader.shown.has(device)) carryQuietly(id, reader, device, "replay");
    },

    connectionClosed(connectionId) {
      upstreams.delete(connectionId);
      dropCarried(connectionId);
    },

    get size() {
      let total = 0;
      for (const held of carried.values()) total += held.size;
      let owners = 0;
      for (const reader of readers.values()) owners += reader.owners.size;
      return { screens: screens.size, readers: readers.size, owners, carried: total };
    },
  };
}
