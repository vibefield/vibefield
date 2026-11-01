import {
  AgentReportShownParams,
  type AgentReportShownResult,
  type CallerContext,
  type ForwardedFor,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { AgentMonitorService } from "./agent-monitor";
import { RpcCallError } from "./native-link";

// MV-3a (L5, M20) and PG-3b (PG-D6 (a), J2 (a), James 2026-11-01 03:55Z) — the screens `agent.reportShown` reaches,
// on the desktop a caller holds a board on and on the desktop that owns the row.
//
// A SCREEN is a product connection holding a board that shows the model: `model` (this desktop's windows) or
// `remote` (every other screen, PG-L1). It is opened with the connection's first such board and forgotten with its
// last, and what it reports shown clears the rows' unread marks on this desktop's backend. Q05: forgetting a screen
// keeps the marks (`agent-monitor.ts`). Q06: only this desktop's own window looks for the person, so only its
// screen acknowledges a crashed run's failure.
//
// A READER is a connection holding a `{remote, mesh}` board: it sees other desktops' rows through this one, so its
// reports for them are carried to their owners (the door's `device?` forward). The home carries a report only for a
// reader. It keeps, per reader, the owners it reported to, and when the reader's last mesh board closes (pause,
// re-home, a gap repair's unsubscribe, a lost socket) it sends each of them an empty report. Everything it carries
// for one reader to one owner goes in order, so a re-subscribe's new report never lands before the empty one.
//
// A CARRIED SCREEN is the owner's for a report a peer daemon carried. Every reader behind one home shares that
// home's ONE peer connection here, and a report replaces its screen's whole set, so the owner keys the screen by the
// envelope's `onBehalfOf` {deviceId, windowId} UNDER the peer connection that carried it. That is the restrict-only
// use DS-L7 was amended for (2026-11-01; `contracts/src/forwarding.ts`, F1b's `clientDeviceId` clause is the
// model): the key only splits one peer connection's reports into per-reader sets, never reaches another
// connection's screen and grants nothing. A carried screen acknowledges nothing, opens on its first report, goes on
// an empty one, and goes with its connection.

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
   * (`ProductApi.forwardFor`) — how a closing reader's empty report reaches its owners */
  carry: (ctx: CallerContext, device: string, params: AgentReportShownParams) => Promise<unknown>;
  logger?: Logger;
}

export interface AgentScreens {
  /** A board opened on `ctx`'s connection: its screen and, for `{remote, mesh}`, its reader. The close, or null when
   * the board is no screen. */
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
  /** a product connection closed: the screens peers' reports opened under it go */
  connectionClosed(connectionId: string): void;
  /** what stands (tests read it, as the mesh board's `size`) */
  readonly size: { screens: number; readers: number; carried: number };
}

interface Screen {
  count: number;
  close: () => void;
}

interface Reader {
  count: number;
  /** the reader's context at its first board: the provenance its closing reports are carried with */
  ctx: CallerContext;
  /** the owners it has a standing report on */
  owners: Set<string>;
}

const REPORTED: AgentReportShownResult = { reported: true };

const malformed = (): RpcCallError =>
  new RpcCallError("PRECONDITION_FAILED", "expected { ids: string[], device?: string }", false);

const noScreen = (): RpcCallError =>
  new RpcCallError(
    "PRECONDITION_FAILED",
    'no board is open on this connection — subscribe agent.subscribe {projection: "model"} (a window) or {projection: "remote"} first; the board is the screen',
    false,
    { state: "no-screen" },
  );

const noReader = (): RpcCallError =>
  new RpcCallError(
    "PRECONDITION_FAILED",
    'no mesh board is open on this connection — a report reaches another desktop only through agent.subscribe {projection: "remote", scope: "mesh"}; the board is the screen',
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

/** A carried screen's key: the carrying connection first, so no other connection's key can equal it. */
const carriedKey = (connectionId: string, behalf: ForwardedFor, windowId: string): string =>
  `${connectionId}\u001f${behalf.deviceId}\u001f${windowId}`;

export function createAgentScreens(opts: AgentScreensOptions): AgentScreens {
  const logger = opts.logger ?? createNoopLogger();
  /** connection id → its screen */
  const screens = new Map<string, Screen>();
  /** connection id → its reader */
  const readers = new Map<string, Reader>();
  /** `reader␟owner` → the settled tail of what is being carried for that pair */
  const queues = new Map<string, Promise<void>>();
  /** peer connection id → carried key → its close */
  const carried = new Map<string, Map<string, () => void>>();

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

  const openReader = (ctx: CallerContext): (() => void) | null => {
    const id = ctx.connection?.id;
    if (id === undefined) return null;
    let held = readers.get(id);
    if (held === undefined) {
      held = { count: 0, ctx, owners: new Set() };
      readers.set(id, held);
    }
    const reader = held;
    reader.count += 1;
    return once(() => {
      reader.count -= 1;
      if (reader.count > 0) return;
      readers.delete(id);
      // what it showed is shown no more: each owner it reported to is told so, in order behind its last report
      for (const owner of reader.owners) {
        void inOrder(pairKey(id, owner), () =>
          opts.carry(reader.ctx, owner, { ids: [], device: owner }),
        ).catch((error: unknown) =>
          logger.warn(
            "fieldd.agents.screen_release_failed",
            "A closed reader's empty report did not reach its owner",
            { device: owner, error: error instanceof Error ? error.message : String(error) },
          ),
        );
      }
      reader.owners.clear();
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
      if (ask.projection !== "model" && ask.projection !== "remote") return null;
      const screen = openScreen(ctx);
      const reader = ask.projection === "remote" && ask.scope === "mesh" ? openReader(ctx) : null;
      if (screen === null && reader === null) return null;
      return once(() => {
        reader?.();
        screen?.();
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
        if (ids.length > 0) reader.owners.add(device);
        else reader.owners.delete(device);
        return carry();
      });
    },

    connectionClosed(connectionId) {
      const held = carried.get(connectionId);
      if (held === undefined) return;
      carried.delete(connectionId);
      for (const close of held.values()) close();
    },

    get size() {
      let total = 0;
      for (const held of carried.values()) total += held.size;
      return { screens: screens.size, readers: readers.size, carried: total };
    },
  };
}
