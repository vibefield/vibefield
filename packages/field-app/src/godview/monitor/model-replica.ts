import { AgentModelMeshFrame, AgentModelMeshOpen } from "@vibefield/contracts";
import { createMonitorReplica, type MonitorReplica } from "@vibefield/puppeteer-monitor/replica";
import type { FrameScheduler } from "@vibefield/puppeteer-view-sdk/model";
import { useEffect, useState } from "react";
import type { ChromeFacts } from "./chrome-facts";
import { modelBoardFailure } from "./doors";
import { type HeldModelRow, type ModelBoardDevice, ModelBoardFold } from "./model-board";
import type { ModelBoardPort } from "./remote-door";

/**
 * MV-3a (MV-D18, PF6, M3, M23) — THE WINDOW ADAPTER: the one door, folded into
 * ONE model chain, fed to the window's replica.
 *
 * While Godview is open the window holds one subscription,
 * `agent.subscribe {projection: "model", scope: "mesh"}` (PF6: opened with the
 * feed, closed with it). fieldd answers this desktop's model board — every run
 * whole, every bare terminal — and every other self desktop's desk cut beside
 * it, each on its owner's chain. `ModelBoardFold` joins them into one chain of
 * `MonitorModelChange`s, and the replica (`@vibefield/puppeteer-monitor/replica`)
 * applies them with structural sharing. Nothing here derives a business fact:
 * the rows are the backend's, the replica joins what only this window knows.
 *
 * Gaps heal by asking again (M23): a delta the fold cannot follow, a frame that
 * does not parse, a replay the daemon refused after a reconnect, or the
 * replica's own `onGap` — each re-subscribes, and the fresh open replaces
 * everything. A refusal no second ask changes stays as the honest reason; one
 * that may heal is asked again on the mesh reader's backoff (S4).
 *
 * The screen (L5, M20): the model board IS this connection's screen, so a
 * report of what the active pane shows (`reportShown`) is sent while the board
 * is open and sent again after every re-open — the daemon forgets the screen
 * with the board.
 *
 * MV-3b: the board arrives through the door's model PORT (`remote-door.ts`
 * `ModelBoardPort` — the two verbs, never a client), `GodviewAgentsProvider`
 * mounts the hook below, and `GodviewMonitor` draws the replica. The fold's
 * held rows (`held`, `heldRows`) are the window's own joins: the pane a model id
 * stands for, the run a model id was dealt to.
 *
 * MV-3d (M35, M19) — THE SPLIT: each of this desktop's run rows goes two ways
 * as it lands. Its model row goes to the replica, as above; the row whole, with
 * the chrome's facts it carries (`local`), goes to `chrome` — the window's store
 * for the deck's pane frames, the find sheet and the AR-7 marker. Those read
 * nothing else now: the fold's `full` board is not asked while Godview is open,
 * and the one subscription below is the window's only one (PF6 unchanged).
 */

export type MonitorFeedState =
  | { state: "no-door" }
  | { state: "connecting" }
  | { state: "live"; here: string | undefined }
  | { state: "unavailable"; reason: string; retryable: boolean };

export interface GodviewMonitorFeed {
  readonly replica: MonitorReplica;
  state(): MonitorFeedState;
  /** every desktop the board lists, with its standing (DS-L8) */
  devices(): readonly ModelBoardDevice[];
  /** the answering desktop, once the board has answered (fieldd lists itself first) */
  here(): string | undefined;
  /** a row the fold holds, by model id, hidden or shown, with its board row */
  held(id: string): HeldModelRow | undefined;
  /** every row the fold holds, this desktop's first */
  heldRows(): readonly HeldModelRow[];
  /** hears state and device changes (the replica has its own subscribe) */
  subscribe(listener: () => void): () => void;
  /** L5 — the rows the active pane shows, by model id; re-sent after a re-open */
  reportShown(ids: readonly string[]): void;
  /** MV-3d — this desktop's runs as the chrome reads them (never the views') */
  readonly chrome: ChromeFacts;
  dispose(): void;
}

export interface CreateGodviewMonitorFeedOptions {
  board: ModelBoardPort;
  /** the host's ONE frame scheduler (M7); the replica's default frame otherwise */
  scheduler?: FrameScheduler | undefined;
  /** test seams for the re-ask backoff */
  retryMinMs?: number | undefined;
  retryMaxMs?: number | undefined;
  onError?: ((error: unknown) => void) | undefined;
}

/** S4 — the re-ask backoff after a failure that may heal: 250 ms, doubling,
 * capped at 8 s; reset by the next board that answers. The mesh reader's
 * numbers (DS-3), kept to the digit. */
export const MESH_RETRY_MIN_MS = 250;
export const MESH_RETRY_MAX_MS = 8_000;

export function meshRetryDelay(failures: number): number {
  return Math.min(MESH_RETRY_MIN_MS * 2 ** failures, MESH_RETRY_MAX_MS);
}

export function createGodviewMonitorFeed(
  opts: CreateGodviewMonitorFeedOptions,
): GodviewMonitorFeed {
  // MV-3c — the same object unless the lab replays (`godviewReplay=1`)
  const replica = createMonitorReplica({
    ...(opts.scheduler !== undefined ? { scheduler: opts.scheduler } : {}),
    ...(opts.onError !== undefined ? { onListenerError: opts.onError } : {}),
  });
  const fold = new ModelBoardFold();
  const listeners = new Set<() => void>();
  const chromeListeners = new Set<() => void>();
  /** the runs the chrome's listeners last heard of */
  let chromeRuns = fold.runs();
  const retryMin = opts.retryMinMs ?? MESH_RETRY_MIN_MS;
  const retryMax = opts.retryMaxMs ?? MESH_RETRY_MAX_MS;
  let state: MonitorFeedState = { state: "connecting" };
  let disposed = false;
  let generation = 0;
  let unsubscribe: (() => void) | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let lastReport: readonly string[] | null = null;

  const publish = (next: MonitorFeedState): void => {
    state = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        opts.onError?.(error);
      }
    }
  };

  /** MV-3d — the chrome hears this desktop's runs move, and nothing else: a
   * frame that touched only peers or terminals keeps the array it had. */
  const chromeMoved = (): void => {
    const next = fold.runs();
    if (next === chromeRuns) return;
    chromeRuns = next;
    for (const listener of [...chromeListeners]) {
      try {
        listener();
      } catch (error) {
        opts.onError?.(error);
      }
    }
  };

  const sendReport = (): void => {
    if (lastReport === null || state.state !== "live") return;
    void opts.board.reportShown([...lastReport]).catch((error) => {
      // a board that closed under the report: the next open re-sends it
      opts.onError?.(error);
    });
  };

  /** Ask again, once: frames still in flight on the old subscription are
   * ignored from here, and the fresh open replaces the copy (M23). */
  const reopen = (): void => {
    if (disposed) return;
    unsubscribe?.();
    unsubscribe = null;
    open();
  };

  const scheduleRetry = (): void => {
    if (disposed || retry !== null) return;
    const delay = Math.min(meshRetryDelay(failures), retryMax);
    failures += 1;
    retry = setTimeout(
      () => {
        retry = null;
        open();
      },
      Math.max(delay, retryMin),
    );
  };

  const open = (): void => {
    if (disposed) return;
    const mine = ++generation;
    const live = (): boolean => !disposed && mine === generation;
    const deliverOpen = (payload: unknown): void => {
      const parsed = AgentModelMeshOpen.safeParse(payload);
      if (!parsed.success) {
        publish({
          state: "unavailable",
          reason: `the model board answered an unreadable board: ${parsed.error.issues[0]?.message ?? "invalid"}`,
          retryable: false, // another build's board: asking again reads the same
        });
        return;
      }
      failures = 0;
      replica.apply(fold.open(parsed.data));
      chromeMoved();
      publish({ state: "live", here: fold.here });
      sendReport();
    };
    const deliverFrame = (payload: unknown): void => {
      const parsed = AgentModelMeshFrame.safeParse(payload);
      if (!parsed.success) {
        // a frame the fold cannot read is one its copy cannot follow: a gap
        reopen();
        return;
      }
      const change = fold.frame(parsed.data);
      if (change === "gap") {
        reopen();
        return;
      }
      chromeMoved();
      if ("state" in parsed.data) {
        publish(state); // the devices moved
        return;
      }
      if (change !== null && !replica.apply(change)) reopen();
    };
    void opts.board
      .subscribe(
        (payload, kind) => {
          if (!live()) return;
          if (kind === "snapshot") deliverOpen(payload);
          else deliverFrame(payload);
        },
        {
          onReplayFailed: (cause) => {
            if (!live()) return;
            const failure = modelBoardFailure(cause);
            publish({ state: "unavailable", reason: failure.reason, retryable: failure.retryable });
            unsubscribe = null;
            if (failure.retryable) scheduleRetry();
          },
        },
      )
      .then((subscription) => {
        if (!live()) {
          subscription.unsubscribe();
          return;
        }
        unsubscribe = subscription.unsubscribe;
        deliverOpen(subscription.snapshot);
      })
      .catch((cause: unknown) => {
        if (!live()) return;
        const failure = modelBoardFailure(cause);
        publish({ state: "unavailable", reason: failure.reason, retryable: failure.retryable });
        if (failure.retryable) scheduleRetry();
      });
  };

  const offGap = replica.onGap(() => reopen());
  open();

  return {
    replica,
    state: () => state,
    devices: () => fold.devices(),
    here: () => fold.here,
    held: (id) => fold.held(id),
    heldRows: () => fold.heldRows(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reportShown(ids) {
      lastReport = [...ids];
      sendReport();
    },
    chrome: {
      runs: () => fold.runs(),
      subscribe(listener) {
        chromeListeners.add(listener);
        return () => chromeListeners.delete(listener);
      },
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      if (retry !== null) clearTimeout(retry);
      retry = null;
      offGap();
      unsubscribe?.();
      unsubscribe = null;
      listeners.clear();
      chromeListeners.clear();
      replica.dispose();
    },
  };
}

/**
 * The feed while a door with a model board is held and Godview is open (PF6):
 * one subscription per window — since MV-3d the window's only one — opened on
 * mount and closed on unmount. Null without a board or while not subscribed.
 */
export function useMonitorReplica(
  board: ModelBoardPort | null,
  options: { subscribed?: boolean; scheduler?: FrameScheduler | undefined } = {},
): { feed: GodviewMonitorFeed | null; state: MonitorFeedState } {
  const subscribed = options.subscribed ?? true;
  const scheduler = options.scheduler;
  const [feed, setFeed] = useState<GodviewMonitorFeed | null>(null);
  const [state, setState] = useState<MonitorFeedState>({ state: "no-door" });
  useEffect(() => {
    if (board === null || !subscribed) {
      setFeed(null);
      setState({ state: "no-door" });
      return;
    }
    const created = createGodviewMonitorFeed({
      board,
      ...(scheduler !== undefined ? { scheduler } : {}),
    });
    setFeed(created);
    setState(created.state());
    const off = created.subscribe(() => setState(created.state()));
    return () => {
      off();
      created.dispose();
    };
  }, [board, subscribed, scheduler]);
  return { feed, state };
}
