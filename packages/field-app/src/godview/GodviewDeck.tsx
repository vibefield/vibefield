import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import { CELL_WIDTH, GhostteaProvider, LINE_HEIGHT, ORIGIN_X } from "@vibecook/ghosttea-react";
import {
  GhostteaWorkspace,
  type GhostteaWorkspaceContext,
  type GhostteaWorkspacePlatform,
} from "@vibecook/ghosttea-react/workspace";
import {
  ChromeBoundary,
  DECK_FRAMED_CLASS,
  type DeckFrameSlotProps,
  DeckFrames,
  dealPaneColours,
  EMPTY_PANE_COLOUR_LEDGER,
  PaneFrame,
  type PaneFrameVerbs,
  paneColours,
  UnusedPaneSessions,
  useCompletedAgentPanes,
  useDeckZoom,
  useMonitorPalette,
  zoomLayoutApplied,
} from "@vibecook/puppeteer-views";
import { AgentInterruptResult, AgentSpawnResult, type DeviceInfo } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import {
  type ComponentProps,
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  emitGodviewColdOpenMarker,
  emitGodviewDeckMarker,
  emitGodviewDirectTerminalMarker,
} from "../development-console";
import { type LinePane, publishGodviewLineDoor } from "../frame/line-door";
import { requestView } from "../frame/view-state";
import { getHost } from "../host";
import { getRendererLogger } from "../logging";
import {
  adoptCreatedTerminal,
  adoptRemoteTerminalSession,
  createTerminalSession,
  openDormantTransport,
  readRemoteTerminalSession,
  refreshTerminalRoster,
  remoteTerminalDeviceFlipped,
  retryTerminalPool,
  type TerminalFault,
  type TerminalFaultPlane,
  terminalPoolSnapshot,
  terminalSessionProfileSet,
  terminalSessionSummary,
  terminalShellBirth,
  terminateTerminalSession,
  useTerminalPool,
  useTerminalPoolOpen,
  useTerminalSessionViews,
} from "../terminal/pool";
import { afterNextFrame, godviewColdOpen } from "./cold-open";
import { deckThemeNameForMode, useDeckAppearance } from "./deck-appearance";
import { bornInThisView, GodviewDeckLaunchers, recordBornShell } from "./deck-launchers";
import {
  paneCwd,
  paneProfileSet,
  type RestoreQuestion,
  readDeviceHost,
  rememberDeviceHost,
  restoreQuestion,
  restoreSentence,
  savedPaneSessionIds,
} from "./deck-restore";
import { godviewTerminalEffects, godviewTerminalTheme, terminalGround } from "./deck-theme";
import type { GodviewTheme } from "./GodviewTuningPanel";
import { linePanesOf, newTerminalOutcome, pasteIntoPane } from "./line-panes";
import type { MonitorFloorRecord } from "./monitor/agents";
import { RosterFlips, teeDevicesPort } from "./monitor/devices";
import {
  devicesPortOver,
  historyPortOver,
  modelBoardOver,
  profileSetsPortOver,
  usagePortOver,
} from "./monitor/doors";
import { useDeckAgentFacts } from "./monitor/GodviewAgentsProvider";
import { instrumentDevicesPort } from "./monitor/perf/door-instruments";

import type {
  LocalMountOptions,
  LocalMountOutcome,
  MonitorDoor,
  RemoteAttachOutcome,
  RemoteAttachRequest,
} from "./monitor/remote-door";
import type { MonitorPaneFacts } from "./monitor/useMonitorAgents";
import { type DeckSession, describePane, type PaneFace } from "./pane-faces";
import { RemotePaneState } from "./RemotePaneState";
import "@vibecook/ghosttea-react/styles.css";
import "@vibecook/ghosttea-react/workspace.css";

// The pane deck (GT-D3/D5/D10) — the spike's proven dance, become product.
//
// ONE session authority (GT-D10). `GhostteaWorkspace` owns every pane birth:
// it claims on mount, creates its first pane itself, and splits and rehydrates
// through its OWN doors — exactly as ghosttea desktop and the chopsticks
// godview run it. This deck supplies the two things those doors need and
// cannot know (the connection, and the user's shell) and then gets out of the
// way. It was not always so: GT-1/2 had the deck create sessions out-of-band
// through `terminal.create` and coax the workspace into showing them, and
// every trick that made that work — the adopt sweep, the split interception,
// a `/bin/sh` hardcode — was compensation for being a second authority. James
// saw the result as an `sh-3.2$` prompt.
//
// Control rides fieldd, the one product door (D27). With TP's direct-door flag,
// fieldd mints per-session routed tickets and G23 dials the cell's T1 doors;
// with the rollback flag off, the legacy connection ticket still reaches main,
// which posts the bridge's two MessagePorts. Terminal bytes never touch
// JSON-RPC (EL2). The shell supervises no ghosttead: field-native embeds that
// floor and outlives us. fieldd stands beside the byte flow as policy client —
// it mints, audits, and exposes exact session summaries; the native plane keeps
// what the workspace creates alive (GT-D11).
//
// Nothing here is mounted until the overlay has been opened once — a user who
// never presses ⌘G opens no terminal socket and spawns no shell (and, on the
// rollback path, forks no bridge).
//
// TP-S0b — THE DECK NO LONGER OWNS A RUNTIME. It was the runtime's owner because
// it was the only consumer; that made a window-scoped resource live and die with
// one React subtree, and put the recovery ladder in a component that unmounts.
// The window-level pool (`src/terminal/pool`) owns the runtime, the transport
// table, the demand ledger and the ladder; this deck CLAIMS the pool, reads what
// it holds, declares demand for the sessions its panes show, and releases that
// demand when they go. Everything below the acquisition is unchanged — the
// restore gate, the pane faces, the door, the persisted layout are all still the
// deck's, because they are about a deck and not about a window.

/** The deck's own localStorage namespace, in the vf- prefix the renderer's
 * other keys use. Deliberately NOT the app's IPC channel namespace, which wall
 * R6 reserves for contracts — GT-0 caught a storage key squatting there, and
 * R6 catches this comment too if it spells the prefix out. */
const DECK_STORAGE_KEY = "vf-godview-deck-v1";

/**
 * DS-4 — THE DECK TAKES ON FOCUS. DS-D5, ruled 2026-09-30 with James's note:
 * "the latest focused pane takes full control include resizing, LWW. no matter
 * it is local pane, remote desktop pane or mobile pane" (TPv3 §6 amended the
 * same day). The lease stays explicit (TP-D2) and the policy sits in the host:
 * when a controller pane gains focus, it TAKES the seat — `ClaimGeometry` on an
 * empty seat, else one `TransferGeometry` to itself, which the cell authorizes on
 * the pane's own `geometry` right (field-native `activation.rs`). A mirror is
 * `controlsResize:false` and never takes.
 *
 * The deck asks for it with ghosttea's workspace prop `takeGeometryOnFocus`
 * (gt-take, `feat/geometry-take` `a24a28d`): each SURFACE takes on its own focus,
 * because it owns the three facts a take needs — its view id, its grid, and
 * whether its input has focus. The pinned workspace (ghosttea `8a0930e`)
 * predates the prop and ignores it, so it rides through a cast until the pin
 * moves; that move is the one-line cleanup.
 *
 * NO FALLBACK until then. A deck-side road that re-sent the controller's
 * `claimResizeControl` on every focus edge was built and retired in DS-4: on the
 * pinned runtime a surface's mount claim followed by its focus claim is exactly
 * the overlapping-claims case gt-take fixed upstream (`5c9b533` — the pinned
 * runtime re-sends no grid after a refused overlap, so a pane can stay at its
 * first size), and a refused release loses the reply correlation every later
 * claim depends on (`aa4f762`). The take waits for the runtime that fixes both.
 */
const TAKE_GEOMETRY_ON_FOCUS = { takeGeometryOnFocus: true } as unknown as Partial<
  ComponentProps<typeof GhostteaWorkspace>
>;

/** The terminal's cell grid, in ghosttea's own fixed metrics: the pitch the
 * launch draws its dots on (QL-2, `pane-launcher.css` "the launch"), so the
 * dots sit one per cell rather than on a copied number. */
const TERMINAL_CELL_STYLE = {
  "--vf-terminal-cell-width": `${CELL_WIDTH}px`,
  "--vf-terminal-cell-height": `${LINE_HEIGHT}px`,
  "--vf-terminal-cell-origin": `${ORIGIN_X}px`,
} as const;

// The deck used to carry a SPAWN_COLS/SPAWN_ROWS pair here, because
// `runtime.createSession` takes a geometry and a pane being rehydrated has no
// cols to inherit. `terminal.create` takes none (`contracts/src/terminal.ts:107`)
// — the floor picks, and the first resize from the mounted surface corrects it,
// which is what the old comment said was happening anyway. One fewer renderer
// guess about a PTY.

/** The fault face's headline, per plane. The plane split itself (GT-5c) moved to
 * the pool with the acquisition that produces it — `transport` is the path to
 * the floor, `fieldd` is the CONTROL plane alone — and what stays here is what
 * the deck says about it. */
function deckFaultHeadline(plane: TerminalFaultPlane): string {
  return plane === "fieldd"
    ? "the deck could not reach fieldd"
    : "the deck could not reach its shell";
}

/** The line under it: what this means for the sessions, stated rather than
 * implied. DESIGN.md §9 — an error says what happened and what to do next. */
function deckFaultConsequence(plane: TerminalFaultPlane): string {
  return plane === "fieldd"
    ? "your shells are still running — field-native outlives fieldd, and the deck rejoins them when the control plane answers"
    : "the sessions are unreachable from here until the bridge is back";
}

/** SB-3 — a birth the door asked for, on its way to the `createSplitSession`
 * override: the Agent Profile it is born under (undefined: unbound, as the
 * door's plain create always was), and fieldd's words when it was refused —
 * ghosttea swallows the override's throw, so they come back this way. */
interface PendingBirth {
  readonly profileSet: string | undefined;
  refusal?: string;
}

/** SB-3 — how long a BOUND relaunch waits before asking again, when fieldd
 * refused it for now: 250 ms doubling, ~7.75 s of waiting, about 10 s with the
 * asks. Then the drop policy stands. */
const RELAUNCH_RETRY_MS: readonly number[] = [250, 500, 1_000, 2_000, 4_000];

/** fieldd refused, and said to ask again: its UNAVAILABLE answer marked
 * `retryable` (SB-2's "Agent Profiles cannot be read right now" — its agent
 * runtime not answering yet, which is the relaunch's startup race). An answer,
 * so it carries the wire's numeric code; a request that never reached fieldd
 * carries none and is not this. */
function refusedForNow(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const refusal = cause as { kind?: unknown; retryable?: unknown; code?: unknown };
  return (
    refusal.kind === "UNAVAILABLE" && refusal.retryable === true && typeof refusal.code === "number"
  );
}

/** The workspace publishes its context to its sidebar and nowhere else, so the
 * sidebar slot is how an embedder observes and drives panes. It renders
 * nothing: this deck's chrome is the overlay's, not a second sidebar. */
function ContextProbe({
  workspace,
  publish,
}: {
  workspace: GhostteaWorkspaceContext;
  publish: (workspace: GhostteaWorkspaceContext) => void;
}): null {
  useEffect(() => publish(workspace), [workspace, publish]);
  return null;
}

/** Poll a predicate across event-loop turns until it holds or `ms` elapse —
 * the workspace commits its state in effects, so a mount or an activation is
 * observable only a turn later. Returns whether it held. */
async function settled(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return true;
}

/**
 * A refusal fieldd expressed by THROWING, told apart from a daemon that could
 * not be answered at all (GT-6 review).
 *
 * `agent.interrupt` refuses a run that has ended or one it does not know with
 * an `RpcCallError` rather than with `{accepted: false}` — the union's second
 * arm is reserved for the floor's own refusal — and the renderer sees that as a
 * rejected promise carrying `kind` and `details`. Read structurally rather than
 * with `instanceof`: the deck holds its client through a door, and a wrapper
 * that re-threw a plain object would still be telling the truth about a state.
 * Returns fieldd's own word for the state, so the log says `not-alive` rather
 * than a sentence this file invented.
 */
function interruptRefusal(cause: unknown): string | undefined {
  const error = cause as { kind?: unknown; details?: { state?: unknown } } | null;
  const kind = error?.kind;
  if (kind !== "PRECONDITION_FAILED" && kind !== "NOT_FOUND") return undefined;
  const state = error?.details?.state;
  return typeof state === "string" && state !== "" ? state : kind;
}

export interface GodviewDeckProps {
  /** PF6: false silences every pane. The deck stays MOUNTED — that is what
   * makes reopening instant and the layout survive — and ghosttea turns the
   * prop into `TerminalSurface visible={false}` → `runtime.setVisible(...,
   * false)` → the render worker's `occluded` set, which drops those surfaces
   * from every flush and cancels their cursor-blink timers. Bytes still arrive
   * and are decoded, which is why the screen is current the instant it comes
   * back; what stops is all render and GPU work. */
  active: boolean;
  /** The reference app's local light/dark mode. It changes terminal colors but
   * never the renderer-owned alpha in the appearance store. */
  theme?: GodviewTheme;
  /** GT-3f's residual: the lab could not say which renderer was drawing,
   * because only the deck's runtime knows. Reported when the worker announces
   * it, so the readout shows a measured backend and never a guessed one. */
  onRendererBackend?: (backend: string) => void;
  /**
   * THE DOOR (GT-D17), published upward.
   *
   * The monitor is a sibling of this deck, not a child, and it needs to reach
   * the mesh and the active pane — both of which exist only in here. What
   * crosses the boundary is a two-verb object built where the runtime already
   * is; the runtime itself never leaves this file, and no view ever sees
   * either. Null while there is nothing to open (no transport yet).
   */
  onRemoteDoor?: (door: MonitorDoor | null) => void;
  /** The deck's pane facts, for a monitor that must say which of its rows are
   * actually showing somewhere. Read-only in both directions of meaning: the
   * monitor never drives panes with them. */
  onPanes?: (facts: MonitorPaneFacts) => void;
}

export function GodviewDeck({
  active,
  theme: godviewTheme = "light",
  onRendererBackend,
  onRemoteDoor,
  onPanes,
}: GodviewDeckProps): ReactElement | null {
  const fieldd = useFielddClient();
  /** THE POOL (TP-S0b), claimed and read.
   *
   * `useTerminalPoolOpen` is the claim — idempotent, and with no teardown,
   * because a deck unmounting must not close the window's transport. Everything
   * this component used to hold in React state now comes off the snapshot: the
   * runtime (one per window, never per deck), the shell policy main answered the
   * connect with, the fault and its plane, and the generation a replaced runtime
   * bumps. The cold-open trace goes with the claim so the pool stamps `ticket`
   * and `connected` wherever the acquisition actually happens — the prewarm's
   * copy of those stamps was the reason the trace had to be a module singleton
   * in the first place. */
  const pool = useTerminalPool();
  /** The saved layout's session ids, read SYNCHRONOUSLY at first render.
   *
   * They are the transport's opening move (TP-S1): a window rejoins one of the
   * sessions it was showing rather than asking for a sessionless connection, so
   * the pool needs them before its first mint — which means before any effect
   * that awaits the floor. localStorage is the only source that can answer that
   * early, and it is the same document the workspace restores from. */
  const savedPanes = useMemo(() => {
    try {
      return savedPaneSessionIds(localStorage.getItem(DECK_STORAGE_KEY));
    } catch {
      return []; // a page with no storage has no layout, which is an answer
    }
  }, []);
  useTerminalPoolOpen(fieldd, { rejoin: savedPanes, trace: godviewColdOpen });
  const { runtime, shell, generation, warm } = pool;
  const error: TerminalFault | null = pool.fault;
  // A runtime replacement loses its input history; keep earlier shells conservatively.
  const unusedPanes = useMemo(() => new UnusedPaneSessions<SessionSummary>(), [runtime]);
  /** Published by the sidebar probe. Read only to REPORT what the deck holds
   * (the marker below); the deck does not drive panes through it any more —
   * that was the adopt sweep GT-2e deleted. */
  const [workspace, setWorkspace] = useState<GhostteaWorkspaceContext>();
  /** The same context, reachable WITHOUT a render (GT-D17). The door is built
   * once per runtime and lives longer than any one context object — ghosttea
   * publishes a fresh one on every pane change — so an attach reads the current
   * one at call time instead of closing over whichever existed at build time. */
  const workspaceRef = useRef<GhostteaWorkspaceContext>(undefined);
  const [terminalVisualIds, setTerminalVisualIds] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const transferBubble = useCallback((previous: string, next: string): void => {
    setTerminalVisualIds((current) =>
      new Map(current).set(next, current.get(previous) ?? previous),
    );
  }, []);
  /** AR-4b — the door's mounts, one at a time (see `mountLocal`). */
  const mountQueue = useRef<Promise<unknown>>(Promise.resolve());
  /** The deck's own wrapper — the element pane zoom writes its phase onto. It
   * has to be the deck's rather than the stage's: the stage is shared with the
   * monitor and the tuning panel, and a zoom is about the panes. */
  const zoomHostRef = useRef<HTMLDivElement>(null);
  /** One ledger for the deck's lifetime, including while the monitor is closed.
   * A colour belongs to a PANE, even when two panes show the same session.
   * Frames, terminal decoration and the Swarm all consume this same map. */
  const paneLedger = useRef(EMPTY_PANE_COLOUR_LEDGER);
  const palette = useMonitorPalette();
  const paneIdsKey = (workspace?.panes ?? []).map((pane) => pane.id).join("\0");
  const framePaneColors = useMemo(() => {
    paneLedger.current = dealPaneColours(
      paneLedger.current,
      paneIdsKey === "" ? [] : paneIdsKey.split("\0"),
    );
    return paneColours(paneLedger.current, palette.tint);
  }, [paneIdsKey, palette.tint]);
  /** Local replica id → the PEER it came from. The deck is the only place that
   * knows a pane is a peer's, and it knows it exactly once — at the attach that
   * made it — so this is where locality is recorded rather than inferred later
   * from a path (GT-5c, the 2026-08-06 erratum). It is read by `paneMeta`, so a
   * ref so recording an origin does not reinitialize the workspace. */
  const remoteDevices = useRef(new Map<string, string>());
  /** DS-4e — the roster as the deck last READ it, off the monitor's one
   * subscription (the door's devices port, teed): each desktop's name, for a
   * remote pane's honest state, and each row's standing, whose flip is the one
   * signal a pane waiting on that desktop asks again on. Refs: the reads come
   * through a port the door memo hands out, and must not rebuild it. */
  const rosterNames = useRef(new Map<string, string>());
  const rosterFlips = useRef(new RosterFlips());
  const observeRoster = useCallback((devices: readonly DeviceInfo[]): void => {
    for (const device of devices) rosterNames.current.set(device.deviceId, device.name);
    for (const flipped of rosterFlips.current.observe(devices)) {
      remoteTerminalDeviceFlipped(flipped);
    }
  }, []);
  /** Session id → the folder this deck BORN it in (PU-14b's `fallbackCwd`).
   *
   * A pane's badge is a folder name, and a freshly split shell has no cwd to
   * take one from: the floor reports what OSC 7 announced, and a shell that has
   * not drawn its first prompt has announced nothing — so the badge read
   * `terminal` for the beat before the prompt landed. The deck is the one place
   * that knows the answer, because the deck is what asked for the split. A ref
   * because it must not re-run the workspace's
   * initialization, and the mount that follows a birth re-renders anyway. */
  const bornCwd = useRef(new Map<string, string>());
  /** GT-3, the restore gate. `null` while the question is still being asked of
   * the floor; a question object while the user is being asked; `"go"` once the
   * deck may mount — with rehydration armed or not, per `rehydrate`. */
  const [consent, setConsent] = useState<RestoreQuestion | "go" | null>(null);
  /** Whether `onRehydratePane` is armed. False is not a bug state: a user who
   * chose to start clean has no layout left to rehydrate, and a deck with no
   * dead panes never had anything to ask about. */
  const [rehydrate, setRehydrate] = useState(false);

  const publish = useCallback((next: GhostteaWorkspaceContext) => {
    workspaceRef.current = next;
    setWorkspace(next);
  }, []);
  /** GT-2b: a failed deck must offer its own way back. The pool replaces the
   * transport — a fresh runtime with a fresh ports wait, and the connect asked
   * again — which is the same path `bridge-up` takes, available to a human when
   * no bridge-up is coming (a bridge that never built, a ladder that spent
   * itself). The button is the deck's; the ladder is not. */
  const retry = useCallback(() => retryTerminalPool(savedPanes), [savedPanes]);

  /** The user said restore. Rehydration is armed and the workspace mounts;
   * dead panes come back through `onRehydratePane` below. */
  const acceptRestore = useCallback(() => {
    setRehydrate(true);
    setConsent("go");
  }, []);

  /** The user said start clean. The saved layout is REMOVED rather than
   * ignored: leaving it would mean the next open asks the same question about
   * the same dead panes, and an answer that does not stick is not an answer.
   * Nothing on the floor is touched — the live sessions this drops go on
   * running, which is the close-detaches law (GT-D5) applied to a whole deck. */
  const startClean = useCallback(() => {
    try {
      localStorage.removeItem(DECK_STORAGE_KEY);
    } catch (cause) {
      getRendererLogger()
        .child({ component: "godview" })
        .error(
          "renderer.godview.layout_clear_failed",
          "The saved deck layout could not be cleared",
          cause,
        );
    }
    setRehydrate(false);
    setConsent("go");
  }, []);

  // The viewer's own appearance (GT-D12), read from the store Settings writes.
  // Recomputed when it moves and ONLY then: `theme` is not among the
  // workspace's initialization deps (`storageKey ∥ defaultShell ∥
  // claimExistingSessions ∥ initialCwd ∥ runtime`), so a new theme re-renders
  // the panes without re-initializing the deck — an appearance change applies
  // to an open deck with no remount, no reclaim, and no new pane.
  const appearance = useDeckAppearance();
  const terminalTheme = useMemo(
    () => godviewTerminalTheme(appearance, godviewTheme),
    [appearance, godviewTheme],
  );
  // Memoized on the STORED selection, so the object handed over is the same one
  // until the viewer actually changes something. 0.9.1 canonicalizes equal
  // effect objects behind `workspaceEffectsKey` and would forgive a fresh one
  // each render, but leaning on that would be asking a library to clean up
  // after a prop this component controls completely.
  const terminalEffects = useMemo(() => godviewTerminalEffects(appearance), [appearance]);
  const activeThemeName = deckThemeNameForMode(appearance, godviewTheme);
  /** Stable by construction: `sidebar` is a component TYPE, and a fresh arrow
   * on every render would remount the probe — and re-run its publish — forever. */
  const Sidebar = useMemo(
    () =>
      function GodviewContextProbe({
        workspace: context,
      }: {
        workspace: GhostteaWorkspaceContext;
      }) {
        return <ContextProbe workspace={context} publish={publish} />;
      },
    [publish],
  );

  // THE RESTORE GATE (GT-3, GT-D8 as amended). Runs ONCE per deck mount, and
  // finishes BEFORE the workspace is allowed to mount.
  //
  // It has to happen here and not inside `onRehydratePane`, because by the time
  // the workspace asks about a dead pane it has already committed to restoring
  // the layout — and the question a user needs answered is about the whole
  // deck, once, before anything spawns: "these N panes are coming back, K of
  // them as new shells". Asking per pane would be K prompts for one decision.
  //
  // Once per MOUNT and deliberately not per generation, which the connect above
  // does run per generation: a recovery rebuilds the bridge, and the bridge has
  // nothing to do with what the last session left behind. Re-running it would
  // re-ask a question the user already answered, and — measured, in the smoke —
  // blank the consent face mid-decision, because a bridge-up arrives moments
  // after the deck comes up and the gate's first act is to have no answer yet.
  //
  // Silence is the common case and is deliberate: with the floor outliving the
  // shell, most reopens find every saved session still alive, and a prompt that
  // appears when nothing is at stake trains people to dismiss the one that
  // matters. No layout, or a layout this reader cannot make sense of, is also
  // silent — GT-D8's malformed-manifest rule is "start clean", not "explain".
  //
  // A floor that cannot be asked mounts too, unarmed: a roster this window
  // cannot read means the deck is about to have bigger problems than a prompt,
  // and guessing that every saved pane is dead would be the one answer certain
  // to be wrong.
  //
  // TP-S1 — THE ROSTER, NOT THE INVENTORY. This read was `terminal.list`, which
  // is the TRANSPORT-facing projection: it carries the cell tag the routed
  // transport consumes, and a UI that read it was handling placement it is not
  // allowed to see (TP-L-C). `terminal.roster` is the other projection of the
  // same fold (TP-D4) — ids, class, health, provenance, and a contract that
  // REFUSES a placement key at parse. The pool performs the read because the
  // pool holds the client; what arrives here is already placement-free.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (savedPanes.length === 0) {
        if (!cancelled) setConsent("go");
        return;
      }
      const sessions = await refreshTerminalRoster(godviewColdOpen);
      if (cancelled) return;
      // `unread`/`unavailable`/`unobserved` all mean the same thing to this
      // gate: no trustworthy list of what is alive, so ask nothing and mount.
      // Only an OBSERVED roster can say a saved pane is dead.
      if (terminalPoolSnapshot().rosterState !== "observed") {
        getRendererLogger()
          .child({ component: "godview" })
          .info(
            "renderer.godview.restore_roster_unreadable",
            "The roster could not be read for the restore check; mounting without it",
            { state: terminalPoolSnapshot().rosterState },
          );
        setConsent("go");
        return;
      }
      const saved = savedPanes;
      const live = sessions
        .filter((session) => session.health !== "exited")
        .map((session) => session.sessionId);
      const question = restoreQuestion(saved, live);
      // Everything alive ⇒ nothing to consent to. The panes rejoin by id
      // inside the workspace's own initialization, exactly as they did before
      // this gate existed.
      if (question.dead === 0) {
        setConsent("go");
        return;
      }
      setConsent(question);
    })();
    return () => {
      cancelled = true;
    };
  }, [savedPanes]);

  // THE COLD-OPEN TRACE (GT-3p). Four stations are stamped from here; the other
  // three belong to owners that ran before this component existed (the prewarm)
  // or to the browser (the presented frame).
  //
  // `consent` is stamped only when the gate OPENS, never when it starts asking:
  // the interval while a person reads a question is their time, not the deck's,
  // and folding it into a cold-open number would make the number a measure of
  // how fast James reads.
  useEffect(() => {
    if (consent === "go") godviewColdOpen.mark("consent");
  }, [consent]);

  // THE FIRST CONNECTION, when there is nothing to rejoin (TP-S1).
  //
  // The pool opens by rejoining a saved pane. When none of them answers a ticket
  // it rests in `dormant` — no bridge, no socket — which is the honest state for
  // a window with nothing to show, and the reason the sessionless
  // `connectTicket` could be retired rather than replaced.
  //
  // Getting out of it takes two tries, in this order, and the order is the whole
  // point:
  //
  //   1. OPEN ON A SESSION THAT ALREADY EXISTS. The floor may hold sessions this
  //      deck never saved — an agent's, another window's, one from before a
  //      layout was cleared — and the workspace is about to CLAIM them
  //      (`claimExistingSessions`). Creating first would spawn a shell nobody
  //      asked for and leave the deck showing N+1 panes where N were wanted.
  //   2. ONLY THEN CREATE ONE. A birth is meaningful (GT-D14), so it happens
  //      after consent has resolved and never at idle.
  //
  // Runs after the gate, so "start clean" and "restore" both reach it having
  // already decided what the saved layout means.
  const firstConnection = useRef(false);
  useEffect(() => {
    if (consent !== "go" || pool.phase !== "dormant" || firstConnection.current) return;
    // On G23 the static shell policy is available while the pool is dormant,
    // so the workspace can mount and make its own empty-layout birth through
    // the routed host's `createSession` product adapter. Pre-creating here
    // would race fieldd's deliberately lagging observed inventory and could
    // leave Ghosttea seeing an empty `terminal.sessions` result forever.
    if (shell !== null) return;
    firstConnection.current = true;
    void (async () => {
      // The roster may be unread here: the restore gate only asks for it when
      // there IS a saved layout, and this path is reached with none. Asking now
      // is what keeps step 1 honest — without it a first run would create a
      // shell beside every session the workspace is about to claim, and show
      // N+1 panes where N were wanted.
      const sessions =
        terminalPoolSnapshot().rosterState === "unread"
          ? await refreshTerminalRoster(godviewColdOpen)
          : pool.roster;
      const alive = sessions
        .filter((session) => session.health !== "exited")
        .map((session) => session.sessionId);
      if (await openDormantTransport(alive, godviewColdOpen)) return;
      try {
        // The deck's opening shell: a refusal here leaves nothing else to draw,
        // so it faults the pool (SB-3 keeps that for the opening birth alone).
        await createTerminalSession({ workloadClass: "interactive" }, godviewColdOpen, {
          opening: true,
        });
      } catch (cause) {
        // The pool has already published the fault and the deck is already
        // drawing its face; this only says so in the log with the deck's voice.
        getRendererLogger()
          .child({ component: "godview" })
          .error(
            "renderer.godview.first_session_failed",
            "The deck could not open its first session",
            cause,
          );
      }
    })();
  }, [consent, pool.phase, pool.roster, shell]);

  // The render backend announcing itself IS device-ready: the worker posts
  // `renderer-status` from `createRenderer`, after the adapter, the device and
  // the pipelines exist. On a warm open the prewarm already stamped this and the
  // mark is idempotent, so the listener costs nothing and stays honest if the
  // prewarm was off, failed, or fell back to Canvas2D.
  useEffect(() => {
    if (runtime === null) return;
    const onStatus = (): void => {
      godviewColdOpen.mark("device");
      onRendererBackend?.(runtime.rendererBackend);
    };
    runtime.addEventListener("renderer-status", onStatus);
    // A runtime inherited from the prewarm already announced its backend before
    // this deck existed, so the event is not coming a second time — the current
    // value is read directly instead of waiting for news that already happened.
    if (runtime.rendererBackend !== "starting") onRendererBackend?.(runtime.rendererBackend);
    return () => runtime.removeEventListener("renderer-status", onStatus);
  }, [runtime, onRendererBackend]);

  // G23's own end-to-end observation for the direct-path smoke. A mounted pane
  // is not proof of display: this event reaches `presentationReady` only after
  // the routed frames worker applies a scene and its lease agrees with the cell.
  useEffect(() => {
    if (runtime === null) return;
    const emitCurrent = (
      sessionId: string,
      current: {
        activationId: string;
        phase: string;
        presentationReady: boolean;
        inputAllowed: boolean;
        unavailableReason?: string;
        controlAttached?: boolean;
        framesAttached?: boolean;
        framesOutcome?: { kind?: string };
        framesState?: { state?: string };
      },
      protocolReason?: string,
    ): void => {
      emitGodviewDirectTerminalMarker({
        sessionId,
        activationId: current.activationId,
        phase: current.phase,
        presentationReady: current.presentationReady,
        inputAllowed: current.inputAllowed,
        ...(typeof current.unavailableReason === "string"
          ? { unavailableReason: current.unavailableReason }
          : {}),
        ...(typeof current.controlAttached === "boolean"
          ? { controlAttached: current.controlAttached }
          : {}),
        ...(typeof current.framesAttached === "boolean"
          ? { framesAttached: current.framesAttached }
          : {}),
        ...(typeof current.framesOutcome?.kind === "string"
          ? { framesOutcome: current.framesOutcome.kind }
          : {}),
        ...(typeof current.framesState?.state === "string"
          ? { framesState: current.framesState.state }
          : {}),
        ...(protocolReason === undefined ? {} : { protocolReason }),
      });
    };
    const onRoutedState: EventListener = (event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as {
        sessionId?: unknown;
        current?: {
          activationId?: unknown;
          phase?: unknown;
          presentationReady?: unknown;
          inputAllowed?: unknown;
          unavailableReason?: unknown;
          controlAttached?: unknown;
          framesAttached?: unknown;
          framesOutcome?: { kind?: unknown };
          framesState?: { state?: unknown };
        };
      };
      const current = detail?.current;
      if (
        typeof detail?.sessionId !== "string" ||
        typeof current?.activationId !== "string" ||
        typeof current.phase !== "string" ||
        typeof current.presentationReady !== "boolean" ||
        typeof current.inputAllowed !== "boolean"
      ) {
        return;
      }
      emitCurrent(detail.sessionId, current as Parameters<typeof emitCurrent>[1]);
    };
    const onRoutedProtocolError: EventListener = (event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as { sessionId?: unknown; reason?: unknown };
      if (typeof detail?.sessionId !== "string" || typeof detail.reason !== "string") return;
      const current = runtime.routedActivation(detail.sessionId);
      if (current === undefined) return;
      emitCurrent(detail.sessionId, current, detail.reason);
    };
    runtime.addEventListener("routed-activation-state", onRoutedState);
    runtime.addEventListener("routed-protocol-error", onRoutedProtocolError);
    return () => {
      runtime.removeEventListener("routed-activation-state", onRoutedState);
      runtime.removeEventListener("routed-protocol-error", onRoutedProtocolError);
    };
  }, [runtime]);

  // The last two stations, and the one publication. A pane in the deck's own
  // report is `mounted`; the frame after it is what a user would call open.
  const coldOpenPublished = useRef(false);
  useEffect(() => {
    if (coldOpenPublished.current || runtime === null) return;
    if ((workspace?.panes.length ?? 0) === 0) return;
    godviewColdOpen.mark("mounted");
    coldOpenPublished.current = true;
    void afterNextFrame().then(() => {
      godviewColdOpen.mark("frame");
      const report = godviewColdOpen.report();
      emitGodviewColdOpenMarker({
        totalMs: report.totalMs,
        phases: report.phases as Record<string, number>,
        warm: report.warm,
        prewarmed: warm,
        rendererBackend: runtime.rendererBackend,
      });
    });
  }, [workspace, runtime, warm]);

  // NOTE (GT-D10, deliberate): there is no adopt sweep here any more. The old
  // one listed the floor on every open and pushed anything unseen into a pane,
  // because `claimExistingSessions` is first-run-only — but that made the deck
  // a second authority over what a pane holds, and `seen` existed only to stop
  // it from undoing the user's own pane closes. The workspace claims on mount
  // and that is the rule. Named residual, from the spec: a session born mid-run
  // outside the deck no longer auto-surfaces. It returns as deliberate AR/GT-5
  // work driven by `session-created`, not as a `listSessions` poll.

  // SB-3 — THE BIRTH'S PROFILE. A shell is born under an Agent Profile when the
  // door asks for one (the spawn bloom, the list's menu), or under its PANE's:
  // a ⌘D split copies its source pane's, the agent-exit shell takes its own
  // pane's, a relaunch reads it back from `paneMeta`. The door's ask cannot
  // ride ghosttea's `createSessionInActivePane()` — it takes no arguments — but
  // ghosttea calls this deck's `createSplitSession` override FIRST and
  // synchronously inside it, so a ref set just before the call is what the
  // override reads (and clears) before its first await.
  const pendingBirth = useRef<PendingBirth | null>(null);

  // THE PANE IS THE PROFILE BOUNDARY (RFC 006). A pane's Agent Profile is the
  // one ITS SHELL was born under, as fieldd's create answer (or its roster, for
  // a shell born elsewhere) said: followed whenever the pane shows a shell, and
  // KEPT while an agent's PTY shows there. An agent's run never decides a
  // pane's binding — an unbound pane stays unbound after its agent exits, even
  // one that ran under the default set (QL-D3), and a Work pane stays Work
  // whatever a resumed run ran under. A pane with no record (a restored agent
  // pane) is unbound; `null` records a shell born unbound.
  const paneSets = useRef(new Map<string, string | null>());
  const paneSetOf = useCallback((paneId: string, sessionId: string): string | undefined => {
    const shell = terminalShellBirth(sessionId);
    if (shell !== undefined) paneSets.current.set(paneId, shell);
    return paneSets.current.get(paneId) ?? undefined;
  }, []);

  // LAYER 2 OF RESTORE (GT-D8 as amended): the durable meaning of a pane, which
  // its session id alone does not carry. Ghosttea persists whatever this
  // returns inside its own layout document and hands it back on rehydration —
  // opaque to the library, which is exactly why the shape is ours to keep
  // small: two fields, both JSON, both from the session the floor reported.
  //
  // `cwd` is the one that earns its place — it is what makes a relaunched pane
  // land where its work was instead of at `$HOME`. `title` rides along so a
  // future reader can name a pane it could not otherwise identify; nothing
  // reads it yet, and it is here rather than later because adding a field to a
  // persisted document is a migration and adding it now is not.
  //
  // Stable identity, and it matters: ghosttea's persist effect depends on this
  // prop, so a fresh arrow per render would rewrite localStorage every render.
  const paneMeta = useCallback(
    (session: { id?: string; cwd?: string | null; title?: string | null }, paneId?: string) => {
      // Only DEFINED fields: an explicit `undefined` would serialize away anyway,
      // and a null cwd persisted as `"cwd": null` is a value a reader has to
      // learn to disbelieve.
      //
      // `cwd` is stored VERBATIM — the OSC 7 URL the floor reported, host and
      // all — and decoded by whoever reads it (`paneCwd`). Normalizing on the way
      // in would throw away the host, which is exactly the field a remote pane
      // needs now that GT-4 has lit them up, and would make the persisted
      // document a summary of what the floor said rather than a record of it.
      //
      // `remoteDevice` is the third field, and it is the one that stops a
      // restored peer's pane from spawning a LOCAL shell at that peer's path.
      // Recorded HERE because here is the only moment the answer is certain:
      // the deck attached this replica and knows whose it is. Reading it back
      // off the URL's host would be archaeology, and archaeology is what the
      // erratum is about.
      const remoteDevice =
        session.id === undefined ? undefined : remoteDevices.current.get(session.id);
      // A pane the deck knows is LOCAL names this machine in its own cwd, which
      // is the only place the renderer can learn its own hostname — no contract
      // carries one. A replica's cwd must never reach this: it names the peer.
      if (remoteDevice === undefined) rememberDeviceHost(session.cwd);
      // `profileSet` is the fourth (SB-3): the Agent Profile the PANE is under
      // — the set its shell was born under, kept while an agent runs there — so
      // its relaunch is born under it again. A peer's pane is under none of
      // this device's.
      const profileSet =
        session.id === undefined || remoteDevice !== undefined
          ? undefined
          : paneId !== undefined
            ? paneSetOf(paneId, session.id)
            : (terminalShellBirth(session.id) ?? undefined);
      return {
        ...(typeof session.cwd === "string" && session.cwd !== "" ? { cwd: session.cwd } : {}),
        ...(typeof session.title === "string" && session.title !== ""
          ? { title: session.title }
          : {}),
        ...(remoteDevice !== undefined ? { remoteDevice } : {}),
        ...(profileSet !== undefined ? { profileSet } : {}),
      };
    },
    [paneSetOf],
  );

  // A BIRTH, through the one product door (TP-S1).
  //
  // This reverses GT-D10's implementation without touching its principle. The
  // principle was: the workspace owns pane births, and the deck must not be a
  // second authority over what a pane holds. It still does not — every birth
  // below is still the WORKSPACE asking, through the workspace's own props. What
  // changed is where the session comes from once it has asked.
  //
  // It used to come from `runtime.createSession`, straight down the deck's
  // connection to the floor. The comment here said routing it through
  // `terminal.create` "would put fieldd back in front of a pane birth for no
  // reason". TPv3 gives the reason: a session born on the control connection is
  // born wherever that connection already points, so it can never be placed by
  // CLASS, is not counted against the floor's per-pair cap, and is not audited
  // as a product act. `create(class)` is the product-plane birth (spec §5.1),
  // and the ticket it answers is what opens this window's transport when it has
  // none — which is how a deck with an empty floor gets a connection at all now
  // that the sessionless door is retired.
  //
  // PERSISTENCE moved with it, and is now simpler rather than different. The
  // deck used to pass `terminate-with-app` deliberately, because that is what
  // the workspace's own doors ask for and field-native re-governs an ownerless
  // birth to keep-until-exit on `session-created` (GT-D11). fieldd's create
  // defaults to keep-until-exit directly (`contracts/src/terminal.ts:113-115`),
  // so the same end state is reached by saying it once instead of by saying the
  // opposite and being corrected.
  const bornSession = useCallback(
    async (cwd: string | undefined, profileSet?: string): Promise<SessionSummary | null> => {
      const created = await createTerminalSession({
        ...(cwd !== undefined ? { cwd } : {}),
        // TC-D6(c): the class is the scrollback cap AND the placement hint. A
        // pane a person types into is interactive by definition.
        workloadClass: "interactive",
        // SB-3: born under an Agent Profile — fieldd binds it (SB-2) or
        // refuses in its own words, and a refusal faults nothing (the pool's)
        ...(profileSet !== undefined ? { profileSet } : {}),
      });
      // The folder this pane was born in, remembered for its badge until the
      // shell announces one of its own (PU-14b).
      if (cwd !== undefined && cwd !== "") bornCwd.current.set(created.sessionId, cwd);
      // The join: fieldd answers an id, the workspace mounts a summary, and the
      // floor is the one authority both read.
      unusedPanes.created(created.sessionId);
      return terminalSessionSummary(created.sessionId);
    },
    [unusedPanes],
  );

  // A dead pane, answered with a live one (GT-D8). Armed only after consent.
  const rehydratePane = useCallback(
    async (context: { meta: unknown; sessionId: string; paneId: string }) => {
      if (shell === null) return null;
      // `paneCwd` and not `meta.cwd`: what the floor calls a cwd is the OSC 7
      // URL the shell announced, and a spawn given `file://host/Users/x` cannot
      // chdir into it. Home is the honest fallback for a pane whose shell never
      // announced one at all — which is most of them, since the spawn directory
      // is not reported and OSC 7 needs a shell integration — and now also for a
      // pane that was a PEER'S: its folder is on another machine, and opening a
      // local shell there is either the wrong directory or a dropped pane.
      // ERRATA (2026-09-25, GT-8b): "most of them" stopped being true at
      // ghosttea 0.12.0, which reports a local session's spawn directory from
      // creation, as a plain path that `paneCwd` takes as it is. Home is now the
      // fallback for a peer's pane, a Windows drive path, and an older floor.
      const cwd = paneCwd(context.meta, readDeviceHost()) ?? shell.home;
      // SB-3: re-bound. A bound relaunch fieldd refuses FOR NOW (its agent
      // runtime not answering yet — the startup race) is asked again with a
      // backoff; a set deleted since (NOT_FOUND) or any other refusal is the
      // answer, and the pane goes like any other that cannot be refilled —
      // never an unbound shell in a bound one's place.
      const profileSet = paneProfileSet(context.meta);
      for (let attempt = 0; ; attempt += 1) {
        try {
          const born = await bornSession(cwd, profileSet);
          if (born !== null) paneSets.current.set(context.paneId, profileSet ?? null);
          return born;
        } catch (cause) {
          const wait =
            profileSet !== undefined && refusedForNow(cause)
              ? RELAUNCH_RETRY_MS[attempt]
              : undefined;
          if (wait !== undefined) {
            await new Promise((resolve) => setTimeout(resolve, wait));
            continue;
          }
          // Drop-and-collapse is the library's own answer to a null, and it is
          // the honest one: a pane that cannot be refilled should not be drawn
          // as though it were. The failure is LOUD in the log and quiet on screen.
          getRendererLogger()
            .child({ component: "godview" })
            .error(
              "renderer.godview.rehydrate_failed",
              `A saved pane could not be relaunched at ${cwd}${profileSet === undefined ? "" : ` under ${profileSet}`}`,
              cause,
            );
          return null;
        }
      }
    },
    [bornSession, shell],
  );

  /** A SPLIT, or a new pane in the active one (GT-D10, TP-S1).
   *
   * `createSplitSession` is upstream's one birth override and it is misnamed:
   * `Workspace.js` routes BOTH `splitActive` (:350) and
   * `createSessionInActivePane` (:384) through it, so this single prop is every
   * interactive new-pane door the user has. Supplying it is what puts fieldd in
   * front of those births; omitting it is what used to send them down the
   * control connection instead.
   *
   * A throw here is upstream's to handle (it logs and leaves the layout alone),
   * and that is the honest outcome: a pane that could not be born should not be
   * drawn as though it were. */
  const createSplitSession = useCallback(
    async (activeSession: DeckSession): Promise<SessionSummary> => {
      // SB-3: the door's ask, taken (and cleared) before the first await, so a
      // ⌘D after it cannot inherit it. With none, the new shell is born under
      // its SOURCE PANE's set: the active pane for a ⌘D split, the pane the
      // agent exited in for the agent-exit shell — never the agent's own run's.
      const birth = pendingBirth.current;
      pendingBirth.current = null;
      let profileSet = birth?.profileSet;
      if (birth === null) {
        const context = workspaceRef.current;
        const panes = context?.panes ?? [];
        const source =
          panes.find(
            (pane) => pane.id === context?.activePaneId && pane.session.id === activeSession.id,
          ) ?? panes.find((pane) => pane.session.id === activeSession.id);
        profileSet = source === undefined ? undefined : paneSetOf(source.id, activeSession.id);
      }
      const cwd = paneCwd({ cwd: activeSession.cwd }, readDeviceHost()) ?? shell?.home;
      let born: SessionSummary | null;
      try {
        born = await bornSession(cwd, profileSet);
      } catch (cause) {
        // Ghosttea catches this throw and answers `undefined`; the door's
        // `failed` carries fieldd's own words from here instead (SB-3).
        if (birth !== null) birth.refusal = cause instanceof Error ? cause.message : String(cause);
        throw cause;
      }
      if (born === null) throw new Error("the floor did not report the session it just created");
      recordBornShell(runtime, born.id); // QL-D7: a new pane's shell, which may show the launcher
      return born;
    },
    [bornSession, shell, runtime, paneSetOf],
  );

  /**
   * A floor session, put in a pane — the workspace half of every mount this
   * deck performs (the door's, and the pane frame's resume since GT-6).
   *
   * With no `replacing` the session lands in the pane the user is in. With one,
   * it lands in the pane showing the PTY it takes the place of, and ONLY there
   * (AR-4b): that pane is activated, the mount waits for the workspace to
   * commit the activation (the active pane is a ref the workspace syncs after
   * render, and `mountSession` reads that ref) and refuses if it never does —
   * a pane that closed under the wait must not hand its replacement to
   * whichever pane the user happens to be in. The user's own pane is given back
   * afterwards.
   *
   * Stable by construction: everything it needs is a ref, so the door memo and
   * the frame verbs can both hold it without being rebuilt.
   */
  const mountSummaryNow = useCallback(
    async (
      summary: SessionSummary,
      replacing: string | undefined,
      paneId?: string,
    ): Promise<LocalMountOutcome> => {
      const paneShows = (sessionId: string): boolean =>
        workspaceRef.current?.panes.some((pane) => pane.session.id === sessionId) === true;
      // Read AFTER whatever round trip produced the summary: the panes and the
      // active one are whatever the user made them while the floor answered.
      let context = workspaceRef.current;
      if (context === undefined || context.activePaneId === undefined) return { state: "no-pane" };
      const sessionId = summary.id;
      if (replacing === undefined) {
        context.mountSession(summary);
        return (await settled(() => paneShows(sessionId), 500))
          ? { state: "mounted", sessionId }
          : { state: "failed", reason: "the workspace did not take the mount" };
      }
      const target = context.panes.find(
        (pane) => pane.session.id === replacing && (paneId === undefined || pane.id === paneId),
      );
      if (target === undefined)
        return { state: "failed", reason: "no pane shows the replaced terminal any more" };
      const previous = context.activeSession?.id;
      if (context.activePaneId !== target.id) {
        context.activateSession(target.session.id);
        const committed = await settled(
          () => workspaceRef.current?.activePaneId === target.id,
          500,
        );
        context = workspaceRef.current ?? context;
        if (!committed || context.activePaneId !== target.id) {
          if (previous !== undefined) context.activateSession(previous);
          return {
            state: "failed",
            reason: "the pane showing the replaced terminal could not be activated",
          };
        }
      }
      context.mountSession(summary);
      const took = await settled(() => paneShows(sessionId), 500);
      const after = workspaceRef.current ?? context;
      if (
        previous !== undefined &&
        previous !== replacing &&
        after.panes.some((pane) => pane.session.id === previous)
      ) {
        after.activateSession(previous);
      }
      return took
        ? { state: "mounted", sessionId }
        : { state: "failed", reason: "the workspace did not take the mount" };
    },
    [],
  );

  // THE DOOR (GT-D17). Two verbs, built where the runtime and the workspace
  // already are, so the monitor beside this deck can list the mesh and mount
  // one of its sessions without ever touching either.
  //
  // This is the narrow, deliberate widening of GT-D13's structural guarantee —
  // "the stage holds no runtime" is still literally true, because what the
  // stage holds is this object. The views below it hold even less: they get
  // `actions`, as they always have.
  //
  // Keyed on the RUNTIME alone. The workspace context is read through its ref
  // at call time (ghosttea republishes it on every pane change, and a door
  // rebuilt that often would restart the monitor's poll for no reason), while a
  // new runtime is a new control connection and genuinely a different door.
  const door = useMemo<MonitorDoor | null>(() => {
    if (runtime === null) return null;
    const doorClient = {
      request: (method: string, params: Record<string, unknown>) => fieldd.request(method, params),
      subscribe: (
        method: string,
        params: Record<string, unknown>,
        onFrame: (payload: unknown, kind?: "snapshot" | "delta") => void,
        // S4 — a refused replay reaches the door (the mesh board heals on it)
        opts?: { onReplayFailed?: (error: unknown) => void },
      ) => fieldd.subscribe(method, params, onFrame, opts),
    };
    const built: MonitorDoor = {
      // DS-4e — the monitor's ONE roster subscription, teed: the deck reads the
      // same lists for the names a remote pane says and the flips it asks
      // again on, and opens no second `device.subscribe` of its own
      devices: instrumentDevicesPort(teeDevicesPort(devicesPortOver(doorClient), observeRoster)),
      // AR-5 — the find sheet's daemon questions and the usage column's feed,
      // adapted from fieldd's doors to the views' ports (`monitor/doors.ts`).
      // The views never dial rosettad; the daemon's origin stays in fieldd.
      history: historyPortOver(doorClient),
      usage: usagePortOver(doorClient),
      // The profile tabs filter existing sessions; terminal birth is independent.
      profiles: profileSetsPortOver(doorClient),
      // MV-3 (MV-D18) — the model board and the screen's report: the monitor's
      // rows are the backend's, through this window's one door (`model-replica.ts`).
      model: modelBoardOver(doorClient),
      // DS-4e (2026-10-01; `thinking-desktop-sync-plane.md` §6.3) — ANOTHER
      // desktop's session, mounted in the pane the user is in through the
      // SAME routed host a local pane rides: never ghosttea's remote palette,
      // which threw under the routed runtime (and whose replica no longer
      // exists). Serialized with the local mounts (AR-4b): one active-pane slot.
      attach: (request) => {
        const run = mountQueue.current.then(() => attachRemoteNow(request));
        mountQueue.current = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
      createTerminal: async (request) => {
        const context = workspaceRef.current;
        if (context?.activeSession === undefined) return { state: "no-pane" };
        // SB-3: the ask rides the pending-birth ref into the override (above).
        const birth: PendingBirth = { profileSet: request?.profileSet };
        pendingBirth.current = birth;
        try {
          // Ghosttea owns pane placement and concurrent-birth fencing. Its
          // createSplitSession override uses the same product door as Cmd–D.
          const opening = context.createSessionInActivePane();
          // A birth ghosttea fenced (another one in flight) never reached the
          // override, and its ask must not wait there for the next ⌘D.
          if (pendingBirth.current === birth) pendingBirth.current = null;
          const session = await opening;
          if (!session) {
            // A refusal is fieldd's to word, and the override kept its words.
            return {
              state: "failed",
              reason: birth.refusal ?? "the workspace could not open a terminal",
            };
          }
          const bound = terminalSessionProfileSet(session.id);
          return {
            state: "mounted",
            sessionId: session.id,
            ...(bound !== undefined ? { profileSet: bound } : {}),
          };
        } catch (cause) {
          if (pendingBirth.current === birth) pendingBirth.current = null;
          return {
            state: "failed",
            reason: cause instanceof Error ? cause.message : String(cause),
          };
        }
      },
      mountLocal: (sessionId, options) => {
        // Mounts are SERIALIZED (AR-4b): two replacements landing in one fold
        // frame would otherwise race each other for the single active-pane
        // slot the workspace mounts into, and the second's activation would
        // capture the first's mount.
        const run = mountQueue.current.then(() => mountLocalNow(sessionId, options));
        mountQueue.current = run.then(
          () => undefined,
          () => undefined,
        );
        return run;
      },
    };
    return built;
    /**
     * DS-4e — the remote attach, in three steps, each the answer of its owner:
     *
     *   1. the OWNER's exact summary — `terminal.sessions {device}`, through
     *      this window's daemon (the lead's ruling (B)): the pane mounts by the
     *      session's engine handle, which no other answer carries;
     *   2. the session ADOPTED as the owner's — from here the routed host asks
     *      its ticket, renewal, kill and refresh by `device`, and the summary is
     *      registered so the owner's session events reach the pane;
     *   3. the MOUNT, in the active pane (GT-D17: attach the pane the user is
     *      in; the session it showed is detached, never killed — GT-D5).
     *
     * The ticket is the runtime's to ask once the pane mounts: its answer is
     * the loopback pair this desktop's daemon re-homed, dialled as a local
     * cell's — or a refusal the pane says in its own words (`RemotePaneState`).
     */
    async function attachRemoteNow(request: RemoteAttachRequest): Promise<RemoteAttachOutcome> {
      if (workspaceRef.current?.activePaneId === undefined) return { state: "no-pane" };
      // the roster's name, or "that desktop" — never the id a row falls back to
      const named =
        request.deviceName !== "" && request.deviceName !== request.deviceId
          ? request.deviceName
          : "that desktop";
      try {
        const summary = await readRemoteTerminalSession(request.deviceId, request.remoteSessionId);
        if (summary === null)
          return { state: "failed", reason: `${named} does not list that session` };
        adoptRemoteTerminalSession(request.deviceId, summary);
        // The locality record (GT-5c). This is the one moment the deck knows
        // for certain that this pane holds a PEER'S session, and `paneMeta`
        // stamps it into the persisted document so a later restore does not
        // have to guess from a path.
        remoteDevices.current.set(summary.id, request.deviceName);
        const mounted = await mountSummaryNow(summary, undefined);
        if (mounted.state !== "mounted") return mounted;
        return { state: "attached", sessionId: summary.id, readWrite: summary.readWrite };
      } catch (cause) {
        // The daemon's own words, carried whole: an owner that cannot be
        // reached for its summary is a state to report, not a throw.
        return {
          state: "failed",
          reason: cause instanceof Error ? cause.message : String(cause),
        };
      }
    }
    async function mountLocalNow(
      sessionId: string,
      options: LocalMountOptions | undefined,
    ): Promise<LocalMountOutcome> {
      if (workspaceRef.current?.activePaneId === undefined) return { state: "no-pane" };
      try {
        // The floor is the one authority both halves read (the pool's own
        // join for a birth, asked here for a session that already exists).
        const summary = await terminalSessionSummary(sessionId);
        if (summary === null)
          return { state: "failed", reason: "the floor does not list this session" };
        return await mountSummaryNow(summary, options?.replacing, options?.paneId);
      } catch (cause) {
        return {
          state: "failed",
          reason: cause instanceof Error ? cause.message : String(cause),
        };
      }
    }
  }, [runtime, fieldd, mountSummaryNow, observeRoster]);

  useEffect(() => {
    onRemoteDoor?.(door);
    // The deck going away takes the door with it: a monitor still holding one
    // would be polling a control connection nobody owns.
    return () => onRemoteDoor?.(null);
  }, [door, onRemoteDoor]);

  /** The sessions this deck currently SHOWS, by id and nothing else (TP-L-C).
   * One list, two readers: the monitor's pane facts and the demand below. */
  const paneSessionKey = JSON.stringify((workspace?.panes ?? []).map((pane) => pane.session.id));
  const paneSessionIds = useMemo<readonly string[]>(
    () => JSON.parse(paneSessionKey),
    [paneSessionKey],
  );

  // The shared Puppeteer controller owns the animation and final content resize.
  // Hidden siblings stay mounted; their visibility and source demand pause.
  const zoom = useDeckZoom(zoomHostRef, workspace?.activePaneId, undefined, active);

  // ── THE PANE FRAME (GT-6, record §07) ───────────────────────────────────
  //
  // Every pane wears the reference's frame, and the frame is the PACKAGE'S
  // (`@vibecook/puppeteer-views`, PU-14): the badge growing out of the top
  // edge, the `model · effort` readout, the context meter along the bottom,
  // and the ghost verbs under the pointer. VibeField supplies what only a host
  // can — the agent facts behind each pane (the chrome's facts on the window's
  // one board, MV-3d), the pane's
  // own colour, the device a remote replica came from, the terminal ink the
  // frame mixes with, and the three verbs — and reinterprets none of it
  // (DESIGN.md §1.1).
  //
  // `DeckFrames` finds the panes under the deck element and portals one frame
  // into each, following their coming, going and zooming with a mutation
  // observer; it also marks that element `vf-deck-framed`, which is what the
  // package's stylesheet keys its pane rules on (the record's safe areas, the
  // active pane's radius, the line and the glow).
  const paneAgents = useDeckAgentFacts();
  const paneRuns = useRef(paneAgents.runs);
  paneRuns.current = paneAgents.runs;

  // WHAT GODVIEW LENDS THE LINE (One Frame FR-2, `frame/line-door.ts`). The
  // line's New terminal (⌘T, its create in Godview) is this door's
  // `createTerminal` — what the swarm's hold does, without a spot to land on —
  // and the interim send pastes into a pane through the pane's own input. The
  // rows are the panes this deck shows, named as the swarm names their bodies.
  // History lands here too: its Resume places, its Jump to reveals (P3).
  // Published on change only; the deck going away takes the door with it.
  const linePanesKey = JSON.stringify(
    linePanesOf(workspace?.panes ?? [], paneAgents.agents, workspace?.activePaneId, (id) =>
      bornCwd.current.get(id),
    ),
  );
  useEffect(() => {
    publishGodviewLineDoor({
      panes: JSON.parse(linePanesKey) as LinePane[],
      onScreen: active,
      newTerminal: async () =>
        door === null
          ? { state: "refused", reason: "the deck has no connection yet" }
          : newTerminalOutcome(await door.createTerminal()),
      paste: (sessionId, text) => {
        const pane = workspaceRef.current?.panes.find((entry) => entry.session.id === sessionId);
        const root = zoomHostRef.current;
        return pane !== undefined && root !== null && pasteIntoPane(root, pane.id, text);
      },
      // AR-8c — History's Resume: the resumed agent's create ticket, adopted
      // into the pool exactly as the launcher's resume adopts one, and mounted
      // in the active pane through the door's serialized mount (AR-4b).
      canPlace: door !== null,
      place: async (terminal) => {
        if (door === null) return { state: "refused", reason: "the deck has no connection yet" };
        const born = adoptCreatedTerminal(terminal);
        return newTerminalOutcome(await door.mountLocal(born.sessionId));
      },
      // P3 — History's Jump to: the pane already showing the running session
      // becomes the active one (never a second mount of it); a session no pane
      // shows is mounted in the active pane through the door's serialized mount.
      // A mount in flight lands first, since a replacement borrows the focus.
      reveal: async (sessionId) => {
        if (door === null) return { state: "refused", reason: "the deck has no connection yet" };
        await mountQueue.current;
        const context = workspaceRef.current;
        if (context?.panes.some((pane) => pane.session.id === sessionId) !== true)
          return newTerminalOutcome(await door.mountLocal(sessionId));
        if (context.activeSession?.id !== sessionId) context.activateSession(sessionId);
        return (await settled(() => workspaceRef.current?.activeSession?.id === sessionId, 500))
          ? { state: "opened" }
          : { state: "refused", reason: "the pane showing it could not be made the active one" };
      },
    });
  }, [linePanesKey, active, door]);
  useEffect(() => () => publishGodviewLineDoor(null), []);

  useCompletedAgentPanes(
    runtime,
    (workspace?.panes ?? [])
      .map((pane) => pane.session)
      .filter(
        (session) =>
          paneAgents.runs.has(session.id) && runtime?.remoteSession(session.id) === undefined,
      ),
    {
      createShell: (session) =>
        createSplitSession({
          ...session,
          cwd: paneAgents.agents.get(session.id)?.cwd ?? session.cwd,
        }),
      replaceSession: (id, next) => {
        const replaced = workspaceRef.current?.replaceSession?.(id, next) ?? false;
        if (replaced) transferBubble(id, next.id);
        return replaced;
      },
      releaseSession: terminateTerminalSession,
      onError: (cause) =>
        getRendererLogger()
          .child({ component: "godview" })
          .error(
            "renderer.godview.agent_exit_shell_failed",
            "Could not return the ended agent pane to a shell",
            cause,
          ),
    },
  );
  const shellUsed = useCallback(
    (session: SessionSummary): boolean =>
      runtime?.sessionHasInput(session.id) === true ||
      session.exited ||
      paneAgents.runs.has(session.id) ||
      runtime?.remoteSession(session.id) !== undefined,
    [runtime, paneAgents.runs],
  );
  const releaseUnusedShell = useCallback((sessionId: string, onFailure?: () => void): void => {
    void terminateTerminalSession(sessionId).catch((cause: unknown) => {
      onFailure?.();
      getRendererLogger()
        .child({ component: "godview" })
        .error(
          "renderer.godview.unused_pane_close_failed",
          "Could not close the unused shell",
          cause,
        );
    });
  }, []);
  useLayoutEffect(() => {
    if (runtime === null || workspace === undefined) return;
    const bornHere = bornInThisView(runtime);
    for (const { session } of workspace.panes) {
      if (bornHere(session.id)) unusedPanes.created(session.id);
    }
    for (const session of unusedPanes.update(
      workspace.panes.map((pane) => pane.session),
      shellUsed,
      (session) => session.activity.kind === "foreground-job",
    ))
      releaseUnusedShell(session.id);
  }, [workspace, runtime, unusedPanes, shellUsed, releaseUnusedShell]);
  useEffect(() => {
    if (runtime === null) return;
    const observe = (event: Event): void => {
      const session = (event as CustomEvent<SessionSummary>).detail;
      for (const ready of unusedPanes.observe(
        session,
        shellUsed(session),
        session.activity.kind === "foreground-job",
      )) {
        releaseUnusedShell(ready.id);
      }
    };
    runtime.addEventListener("session-metadata", observe);
    return () => runtime.removeEventListener("session-metadata", observe);
  }, [runtime, unusedPanes, shellUsed, releaseUnusedShell]);
  const prepareLauncherReplacement = useCallback(
    (previous: string, next: string): (() => void) => {
      const showing =
        workspaceRef.current?.panes.filter((pane) => pane.session.id === previous) ?? [];
      if (
        runtime === null ||
        showing.length !== 1 ||
        !bornInThisView(runtime)(previous) ||
        runtime.sessionHasInput(previous) ||
        paneRuns.current.has(previous) ||
        runtime.remoteSession(previous) !== undefined
      )
        return () => undefined;
      transferBubble(previous, next);
      // The monitor can publish the agent before the workspace finishes mounting.
      // Reserve its body now; failed placement restores distinct terminal bodies.
      return () => setTerminalVisualIds((current) => new Map(current).set(next, next));
    },
    [runtime, transferBubble],
  );
  const onLauncherReplaced = useCallback(
    (previous: string, next: string): boolean => {
      // Check the committed workspace, not the launch-time render. A mirror or
      // input delivered while the agent started must keep its original shell.
      if (
        runtime === null ||
        !bornInThisView(runtime)(previous) ||
        runtime.sessionHasInput(previous) ||
        paneRuns.current.has(previous) ||
        runtime.remoteSession(previous) !== undefined ||
        workspaceRef.current?.panes.some((pane) => pane.session.id === previous)
      )
        return false;
      unusedPanes.release(previous);
      transferBubble(previous, next);
      releaseUnusedShell(previous, () =>
        setTerminalVisualIds((current) => new Map(current).set(next, next)),
      );
      return true;
    },
    [runtime, unusedPanes, transferBubble, releaseUnusedShell],
  );

  /** The runs the verbs are aimed with, read at CALL time: the verbs object
   * must stay referentially stable (`DeckFrames` hands it to every frame, and a
   * fresh one per fold frame would re-render all of them), and what they need
   * is whatever the fold says NOW.
   *
   * The zoom controller rides the same rule and for the same reason (GT-6
   * review): `useDeckZoom` returns a fresh object every render, so naming it in
   * the memo's dependencies rebuilt the verbs on every render and this ref
   * bought nothing. */
  const deckZoom = useRef(zoom);
  deckZoom.current = zoom;

  /** The birth folders, joined through the panes the workspace lays out — the
   * badge's LAST fallback, after the agent's project and the session's own cwd
   * (PU-14b). Same shape and same reason as the colours above. */
  const frameFallbackCwds = useMemo(() => {
    const folders = new Map<string, string>();
    for (const pane of workspace?.panes ?? []) {
      const folder = bornCwd.current.get(pane.session.id);
      if (folder !== undefined) folders.set(pane.session.id, folder);
    }
    return folders;
  }, [workspace]);

  /**
   * THE VERBS the deck lends the frame.
   *
   * `stop` is `agent.interrupt` on the fold's RUN — the one door AR-6-0 adds
   * for exactly this (the floor delivers what ^C would, and yields to a human
   * mid-keystroke). It answers whether the interrupt was DELIVERED, which is
   * what turns the square hollow; a run the fold does not name, a refusal and a
   * failure are all "not accepted", and each says so in the log rather than on
   * a button that lies.
   *
   * `resume` is `agent.resume` — the existing door — and the answer carries the
   * new run beside the SAME routed create ticket a birth gets, so the pool
   * adopts it and the new PTY lands in the pane the verb was pressed in,
   * replacing the exited one (AR-4b's hand-over, reused).
   *
   * `zoom` uses the shared frame animation: the package
   * hands over the pane element, and the deck's zoom takes a pane id.
   */
  const frameVerbs = useMemo<PaneFrameVerbs>(() => {
    const log = () => getRendererLogger().child({ component: "godview" });
    const runFor = (sessionId: string): string | undefined => paneRuns.current.get(sessionId);
    return {
      stop: async (sessionId) => {
        const runtimeRunId = runFor(sessionId);
        if (runtimeRunId === undefined) return { accepted: false };
        const refused = (reason: string): { accepted: false } => {
          log().info("renderer.godview.interrupt_refused", "fieldd would not stop this turn", {
            runtimeRunId,
            reason,
          });
          return { accepted: false };
        };
        try {
          // The contract exists, so it is PARSED (the resume verb below does
          // the same): a shape this cannot read is not a delivery, and the
          // discriminated union is what says which of the two answers it is.
          const answer = AgentInterruptResult.parse(
            await fieldd.request("agent.interrupt", { runtimeRunId }),
          );
          return answer.accepted ? { accepted: true } : refused(answer.reason);
        } catch (cause) {
          // fieldd THROWS the two states a deck actually meets — a run that has
          // ended (`PRECONDITION_FAILED`, `details.state: "not-alive"`) and one
          // it does not know (`NOT_FOUND`) — and returns `{accepted: false}`
          // only when the FLOOR refuses (`agent-runtime.ts:755–789`). Both
          // throws are the door's own words about a state, so they take the
          // refusal path; only a daemon that could not be reached is an error.
          // Before this, a healthy daemon refusing a dead run logged "could not
          // reach fieldd" (GT-6 review).
          const state = interruptRefusal(cause);
          if (state !== undefined) return refused(state);
          log().error(
            "renderer.godview.interrupt_failed",
            "the stop verb could not reach fieldd",
            cause,
          );
          return { accepted: false };
        }
      },
      resume: async (sessionId) => {
        const runtimeRunId = runFor(sessionId);
        if (runtimeRunId === undefined) return;
        try {
          const answered = AgentSpawnResult.parse(
            await fieldd.request("agent.resume", { runtimeRunId }),
          );
          const born = adoptCreatedTerminal(answered.terminal);
          // Serialized with the door's own mounts (AR-4b): a resume landing in
          // the same fold frame as a replacement must not race it for the
          // active-pane slot.
          const mount = mountQueue.current.then(() => mountSummaryNow(born.session, sessionId));
          mountQueue.current = mount.then(
            () => undefined,
            () => undefined,
          );
          const outcome = await mount;
          if (outcome.state !== "mounted") {
            log().info(
              "renderer.godview.resume_unmounted",
              "the session resumed, but its pane could not be handed the new terminal",
              {
                runtimeRunId,
                sessionId: born.sessionId,
                state: outcome.state,
                ...(outcome.state === "failed" ? { reason: outcome.reason } : {}),
              },
            );
          }
        } catch (cause) {
          // fieldd's own words: a refusal here is a STATE (the terminal is
          // still running, the record was already continued), not a crash.
          log().error(
            "renderer.godview.resume_failed",
            "the resume verb could not continue this session",
            cause,
          );
        }
      },
      zoom: (pane) => {
        const paneId = pane.dataset["paneId"];
        if (paneId !== undefined) deckZoom.current.toggle(paneId);
      },
      // Ghosttea routes its configured zoom binding to the same controller.
      zoomShortcut: getHost().platform === "darwin" ? "⌘⇧↵" : "⌃⇧↵",
    };
  }, [fieldd, mountSummaryNow]);

  /**
   * The host's frame: the package's, plus the one fact only this deck holds —
   * the device a remote replica lives on (GT-5c's locality record, kept in a
   * ref because `paneMeta` reads it too). Stable, so the portals are not torn
   * down and rebuilt every time the workspace republishes.
   */
  const Frame = useMemo(
    () =>
      function GodviewPaneFrame({ paneId: _paneId, session, ...props }: DeckFrameSlotProps) {
        const remote = remoteDevices.current.get(session.id);
        // DS-4e — a remote pane whose ticket did not come says why, by the
        // desktop's NAME: the roster's, else the one the attach was given when
        // that is a name (a row the roster had not named carries the id)
        const nameOf = (device: string): string | undefined =>
          rosterNames.current.get(device) ??
          (remote !== undefined && remote !== device ? remote : undefined);
        // M49 — each pane's frame behind its own boundary: a throw in one
        // pane's frame takes that frame alone, and the other panes keep theirs.
        // It tries again for a fact the frame is handed, never for the clock it
        // ticks on (`nowMs`, every second while an agent works).
        const { agent, color, fallbackCwd, pane, verbs, zoomed } = props;
        const retryKey = useMemo(
          () => ({ session, agent, color, fallbackCwd, pane, verbs, zoomed, remote }),
          [session, agent, color, fallbackCwd, pane, verbs, zoomed, remote],
        );
        return (
          <ChromeBoundary name="Pane frame" retryKey={retryKey}>
            <PaneFrame session={session} {...props} {...(remote !== undefined ? { remote } : {})} />
            <RemotePaneState pane={props.pane} sessionId={session.id} nameOf={nameOf} />
          </ChromeBoundary>
        );
      },
    [],
  );

  // The shared controller owns fullscreen presentation from the first frame.
  // Siblings retain their layout boxes and pause rendering while covered.
  const zoomedPaneId = zoomLayoutApplied(zoom.state.phase) ? zoom.state.paneId : null;
  const paneVisibility = useMemo(
    () =>
      Object.fromEntries(
        (workspace?.panes ?? []).map((pane) => [
          pane.id,
          zoomedPaneId === null || pane.id === zoomedPaneId,
        ]),
      ),
    [workspace, zoomedPaneId],
  );
  const visibleSessionIds = (workspace?.panes ?? [])
    .filter((pane) => paneVisibility[pane.id] !== false)
    .map((pane) => pane.session.id);

  /** The terminal's INK, from the same projection the workspace is handed
   * (record §07: every figure the frame draws is mixed from the terminal's own
   * ink, so a viewer who changes the palette moves the frame with it).
   *
   * The ground travels no further than this (GT-6 review): the record has the
   * DECK tinted with it at 82%, and VibeField tints each pane instead
   * (`DEFAULT_DECK_APPEARANCE.opacity`, premultiplied by ghosttea's renderer),
   * so publishing `--vf-godview-terminal-bg` gave every reader in the tree a
   * variable nothing read. It returns with the rule that needs it, if James
   * rules the deck should carry the tint.
   *
   * Errata (2026-09-28): James ruled it — the deck sheet is always the
   * terminal's colour (DESIGN.md §8). `--vf-godview-terminal-bg` is published
   * again, from the overlay's stage style (`godviewTerminalGroundStyle`), where
   * the sheet that reads it lives; the panes keep their own translucent ground,
   * which over a sheet of the same colour composites to it exactly. */
  const ground = useMemo(() => terminalGround(terminalTheme), [terminalTheme]);

  // DEMAND (TP-L-E'), declared where the views are.
  //
  // One view per pane, at `live` while the overlay is open and `none` while it
  // is not — PF6's `active` bit, said as a demand rather than only as a
  // visibility prop. The release is atomic and belongs to the pool: a deck that
  // unmounts drops every declaration in one pass, and a session nothing declares
  // is a session nothing has to advance (TP-R1).
  //
  // Ghosttea 0.12 routes visibility to DeclareDemand at the cell as well as
  // suppressing worker draws; closing the overlay stops production at source.
  useTerminalSessionViews(visibleSessionIds, active ? "live" : "none");

  // GT-6b — THE FLOOR'S OWN ROSTER, RE-READ WHEN THE PANES MOVE.
  //
  // James's 2026-09-13 pass: two live sessions, he selected the managed agent,
  // GT-D17's law mounted it in the ACTIVE pane, and the shell that pane was
  // showing left the deck — and left the monitor's roster with it, because the
  // monitor's terminal rows were the deck's panes and nothing else. Both floor
  // reads still listed the shell. A PTY the floor holds must stay reachable.
  //
  // This is a READ, never a placement, which is what keeps GT-D10 intact: the
  // adopt sweep was removed because it pushed unseen sessions INTO panes and
  // made the deck a second authority over what a pane holds. Listing a session
  // as a row the user may click takes no such authority.
  //
  // Triggered by the panes changing rather than by a timer, for the same
  // reason: a pane closing or being taken over is exactly when a live session
  // can become unpaned, and nothing else in this window needs to know. Named
  // residual, stated rather than papered over: a session born OUTSIDE the deck
  // mid-run still does not surface until the next pane change (GT-D10's
  // residual, unchanged by this — what closes it is the `session-created`
  // route that ruling already names).
  // The MOUNT is deliberately not one of those moments. TP-S3e's row holds a
  // bare routed mount to asking fieldd NOTHING — no roster, no mint, no create
  // — and a mount has displaced nothing yet; where there IS a saved layout the
  // restore gate has already read the roster and `pool.roster` is warm. So the
  // first run of this effect is skipped and the reads start at the first pane
  // change, which in a live window is the workspace claiming its sessions.
  const rosterSweepArmed = useRef(false);
  useEffect(() => {
    if (!active) return;
    if (!rosterSweepArmed.current) {
      rosterSweepArmed.current = true;
      return;
    }
    void refreshTerminalRoster().catch(() => undefined);
  }, [active, paneSessionIds]);

  /** The live PTYs the floor holds, as the monitor's own record (TP-D4's UI
   * projection — no placement, and no cwd either, so a row says less rather
   * than claiming more). An unread or refused roster is an EMPTY list here and
   * never fewer pane rows: these rows are additive. */
  const floorRoster = useMemo<readonly MonitorFloorRecord[]>(
    () =>
      pool.roster
        .filter(
          (item) => item.health !== "exited" && !pool.closingSessionIds.includes(item.sessionId),
        )
        .map((item) => ({
          sessionId: item.sessionId,
          workloadClass: item.workloadClass,
          ...(item.title === undefined ? {} : { title: item.title }),
        })),
    [pool.roster, pool.closingSessionIds],
  );

  // SB-3: each pane's set follows the shells it shows (`paneSetOf`) — asked
  // again when the roster names a shell born elsewhere — and a closed pane's
  // record goes with it.
  useEffect(() => {
    if (workspace === undefined) return;
    const shown = new Set<string>();
    for (const pane of workspace.panes) {
      shown.add(pane.id);
      paneSetOf(pane.id, pane.session.id);
    }
    for (const paneId of [...paneSets.current.keys()]) {
      if (!shown.has(paneId)) paneSets.current.delete(paneId);
    }
  }, [workspace, paneSetOf, pool.roster]);

  // The pane facts the monitor reads (GT-D17). Published on CHANGE only — this
  // fires on every workspace republish, and an unchanged array would re-run the
  // monitor's projection at ghosttea's cadence rather than at the panes'.
  const lastPaneFacts = useRef("");
  useEffect(() => {
    const sessionIds = paneSessionIds;
    const activeSessionId = workspace?.activeSession?.id;
    const sessions = (workspace?.panes ?? []).map((pane) => pane.session);
    // AR-5: the panes themselves, for the attachments the views draw (record §02:
    // a pane owns a colour; the session wears it while mounted there)
    const paneIds = (workspace?.panes ?? []).map((pane) => pane.id);
    const activePaneId = workspace?.activePaneId;
    // The gate keys on every fact the monitor DRAWS from these (AR-4b): the
    // ids and the active pane, and per pane the summary's exited/activity/
    // title/cwd — the deck republishes the summaries as the floor moves them,
    // and a gate keyed on ids alone froze them at the last pane change (an
    // exited pane stayed a live row; a terminal's activity never moved).
    const key = [
      [...terminalVisualIds].map(([id, visualId]) => `${id}:${visualId}`).join("\u0000"),
      sessionIds.join("\u0000"),
      activeSessionId ?? "",
      paneIds.join("\u0000"),
      paneIds.map((id) => framePaneColors.get(id) ?? "").join("\u0000"),
      activePaneId ?? "",
      ...sessions.map(
        (session) =>
          `${session.id}:${session.exited ? 1 : 0}:${session.activity?.kind ?? ""}:${session.title ?? ""}:${session.cwd ?? ""}`,
      ),
      // …and the floor's roster, or a session that became unpaned would never
      // reach the monitor: the panes did not change when the roster did.
      ...floorRoster.map((row) => `${row.sessionId}:${row.workloadClass}:${row.title ?? ""}`),
      // …and which shells were born under which Agent Profile (SB-3): a roster
      // read can name a set for a pane the deck did not birth.
      [...pool.profileSets].map(([id, set]) => `${id}=${set}`).join("\u0000"),
    ].join("\u0001");
    if (key === lastPaneFacts.current) return;
    lastPaneFacts.current = key;
    for (const sessionId of remoteDevices.current.keys()) {
      if (!sessionIds.includes(sessionId)) remoteDevices.current.delete(sessionId);
    }
    for (const sessionId of bornCwd.current.keys()) {
      if (!sessionIds.includes(sessionId)) bornCwd.current.delete(sessionId);
    }
    onPanes?.({
      sessionIds,
      ...(activeSessionId !== undefined ? { activeSessionId } : {}),
      paneIds,
      paneColors: framePaneColors,
      ...(activePaneId !== undefined ? { activePaneId } : {}),
      // the floor summaries the panes hold (AR-3): an unclaimed pane is a
      // terminal row on the stage, a managed row carries its PTY's summary
      sessions,
      // …and every live PTY the floor holds (GT-6b), pane or no pane.
      floor: floorRoster,
      terminalVisualIds,
      // …and the Agent Profile each shell was born under (SB-3, fieldd's words)
      profileSets: pool.profileSets,
    });
  }, [
    paneSessionIds,
    workspace,
    onPanes,
    floorRoster,
    framePaneColors,
    terminalVisualIds,
    pool.profileSets,
  ]);

  /** The pane's face, plus the monitor link (GT-D17).
   *
   * `describePane` stays a pure function of the session and keeps its own law
   * (a live pane says nothing). What this adds is the pane's own accent:
   * an accent GROUPS and labels and never signals
   * state, which is why an exit's `--vf-red` still wins: a state outranks a
   * label, always. */
  const decorate = useCallback(
    (session: DeckSession, paneId: string): PaneFace | undefined => {
      const face = describePane(session);
      const color = framePaneColors.get(paneId);
      if (color === undefined) return face;
      return { ...face, color: face?.color ?? color };
    },
    [framePaneColors],
  );

  // M49 — the frames and the launchers are chrome over the terminals, each
  // behind its own boundary (and every pane's frame behind one of its own, in
  // `Frame` above): a throw there leaves the terminals, the deck and its door
  // standing. Each tries again for the facts it is handed, never for its own
  // failure's echo (M176).
  const framesRetryKey = useMemo(
    () => ({
      panes: workspace?.panes,
      agents: paneAgents.agents,
      colors: framePaneColors,
      cwds: frameFallbackCwds,
      verbs: frameVerbs,
      zoomedPaneId,
    }),
    [workspace, paneAgents.agents, framePaneColors, frameFallbackCwds, frameVerbs, zoomedPaneId],
  );
  const launchersRetryKey = useMemo(
    () => ({
      workspace,
      runs: paneAgents.runs,
      colors: framePaneColors,
      cwds: frameFallbackCwds,
      door,
    }),
    [workspace, paneAgents.runs, framePaneColors, frameFallbackCwds, door],
  );

  // Whatever the deck currently is, said out loud once per change. The canvas
  // smoke's CANVAS_READY precedent: the headless harness reads renderer console
  // output because there is no other way to ask a page what it drew.
  useEffect(() => {
    const panes = workspace?.panes ?? [];
    const exited = panes
      .filter((pane) => (pane.session as { exited?: boolean }).exited === true)
      .map((pane) => pane.session.id);
    emitGodviewDeckMarker({
      active,
      panes: panes.length,
      sessions: workspace?.sessions.length ?? 0,
      sessionIds: panes.map((pane) => pane.session.id),
      poolPhase: pool.phase,
      rosterState: pool.rosterState,
      // "starting" while the transport is still being acquired — the same word
      // the render worker uses before it has a backend, and the honest one: no
      // renderer exists yet either way.
      rendererBackend: runtime?.rendererBackend ?? "starting",
      // Read off the theme the workspace was actually handed, not off the
      // appearance the store holds: what the renderer received is the fact
      // worth publishing, and the two could only differ because of a bug.
      glass: {
        paneBackgroundAlpha: terminalTheme.background[3],
        opacityCells: terminalTheme.backgroundOpacityCells === true,
        themeName: activeThemeName,
      },
      // Same rule as the glass: read off what the workspace was HANDED, which
      // for effects also carries the omission — no selection means no prop, and
      // this line says so with a null rather than by falling silent.
      effects: {
        shaderEffect: terminalEffects?.shaderEffects?.[0] ?? null,
        // GT-7: the whole stack, in the order the renderer runs it.
        shaderEffects: [...(terminalEffects?.shaderEffects ?? [])],
        animate: terminalEffects?.animate === true,
      },
      // TP-R3's end-to-end counter. The deck republishes on every zoom state
      // change because `zoom.state` is a dependency below, so a harness reads
      // one line per phase and the commit count only ever grows.
      zoom: { phase: zoom.state.phase, commits: zoom.state.commits },
      ...(error !== null ? { error: error.message, errorPlane: error.plane } : {}),
      ...(consent !== null && consent !== "go" ? { consent } : {}),
      ...(exited.length > 0 ? { exitedSessionIds: exited } : {}),
      ...(workspace?.activeSession !== undefined
        ? { activeSessionId: workspace.activeSession.id }
        : {}),
    });
  }, [
    active,
    workspace,
    runtime,
    pool.phase,
    pool.rosterState,
    error,
    consent,
    terminalTheme,
    terminalEffects,
    activeThemeName,
    zoom.state,
  ]);

  const platform = useMemo<GhostteaWorkspacePlatform | null>(
    () =>
      shell === null
        ? null
        : {
            platform: getHost().platform ?? "other",
            // The user's real login shell, resolved by main (GT-D10). This is the
            // value every pane is spawned with, because the workspace's own doors
            // are the only doors — the `/bin/sh` that used to sit here was a
            // placeholder for a path we then never took, and it was what James
            // actually saw in a pane.
            defaultShell: shell.defaultShell,
            readClipboard: () => navigator.clipboard?.readText() ?? "",
            showContextMenu: () => undefined,
            toggleFullscreen: () => undefined,
            // The deck's "window" is Godview. Ghosttea calls this when the
            // LAST pane closes, and taking the Electron window down there would
            // close the canvas because a terminal ran out — so it goes back to
            // the canvas instead, which is what the gesture meant (FR-1: the
            // view's one owner is asked, the same door ⌘1 knocks on).
            closeWindow: () => {
              void requestView("canvas");
            },
            onMenuAction: () => () => undefined,
          },
    [shell],
  );

  // GT-2b: the honest fault face. Without it, a deck whose ports never arrive
  // shows ghosttea's own raw rejection string on a dead stage with no way back
  // (the dev screenshot that prompted this). The workspace is not rendered —
  // its runtime's one-shot ports wait is already spent.
  if (error !== null) {
    return (
      <div className="vf-godview-deck-fault" role="alert">
        <p className="vf-godview-deck-fault-message">{deckFaultHeadline(error.plane)}</p>
        <p className="vf-godview-deck-fault-detail">
          {error.message}
          <small>{deckFaultConsequence(error.plane)}</small>
        </p>
        <button type="button" className="vf-godview-deck-fault-retry" onClick={retry}>
          retry
        </button>
      </div>
    );
  }

  // The GATE (GT-D10). The workspace keys its initialization on
  // `storageKey ∥ defaultShell ∥ claimExistingSessions ∥ initialCwd`
  // (Workspace.tsx:229), so mounting it with a placeholder shell and correcting
  // it a moment later does not adjust anything — it RE-INITIALIZES, claiming
  // and creating a second time. Waiting costs one round trip on a surface the
  // user just opened; guessing costs a pane nobody asked for.
  //
  // Empty rather than a "connecting" face on purpose: the two honest states
  // this deck owes are the fault face above (the connect failed, here is the
  // way back) and the workspace itself, and everything between them is one
  // round trip inside the overlay's own reveal. A label that appears and
  // vanishes inside 200ms reads as a stutter, not as honesty.
  if (platform === null || shell === null || consent === null || runtime === null) return null;

  // The consent face (GT-3). Same family as the fault face above — a centred
  // statement on the dark stage with actions under it — because they are the
  // same kind of moment: the deck has something true to say before it can be
  // itself. It states counts and consequences (DESIGN.md §9: states tell the
  // truth with numbers) and neither action is styled as the safe one, because
  // neither is: restoring runs shells, and starting clean forgets a layout.
  if (consent !== "go") {
    return (
      <div className="vf-godview-deck-fault" role="dialog" aria-label="Restore saved panes">
        <p className="vf-godview-deck-fault-message">
          this deck had {consent.saved} pane{consent.saved === 1 ? "" : "s"} last time
        </p>
        <p className="vf-godview-deck-fault-detail">{restoreSentence(consent)}</p>
        <div className="vf-godview-deck-actions">
          <button type="button" className="vf-godview-deck-fault-retry" onClick={acceptRestore}>
            restore
          </button>
          <button type="button" className="vf-godview-deck-fault-retry" onClick={startClean}>
            start clean
          </button>
        </div>
      </div>
    );
  }

  return (
    <GhostteaProvider key={generation} runtime={runtime}>
      {/* The zoom host wraps the workspace and the chrome that acts on it: it
          carries the gesture's phase attributes, and it clips the morph, which
          by design overflows the deck. (The zoomed pane itself resolves against
          upstream's `.terminal-host` — `deck-zoom.css` says how.) */}
      <div
        ref={zoomHostRef}
        // `DeckFrames` marks this element too, from an effect — but an effect
        // runs after the first paint, and the package's pane rules (the record's
        // safe areas, the radius, the line) key on this class: without it in the
        // static className the deck's first frame lays its panes out unframed
        // and then reflows them. The mounter's own add is idempotent and it
        // removes only what it added.
        className={`vf-deck-zoom ${DECK_FRAMED_CLASS}`}
        data-zoom-phase="idle"
        style={{ "--vf-godview-terminal-ink": ground.ink, ...TERMINAL_CELL_STYLE } as CSSProperties}
      >
        {/* Pane chrome is shared with Puppeteer. Closing detaches used sessions;
            a fresh shell with no input is reaped through the product door. */}
        <GhostteaWorkspace
          platform={platform}
          theme={terminalTheme}
          // Spread rather than `effects={terminalEffects}` because `undefined`
          // and absent are the same to React but NOT to a tolerant reader of this
          // code: the prop is omitted when nothing is selected, which is what
          // hands ghosttea's config-derived path back to it intact (GT-D12 — the
          // floor keeps its own answer, this viewer only overrides when asked).
          {...(terminalEffects !== undefined ? { effects: terminalEffects } : {})}
          storageKey={DECK_STORAGE_KEY}
          sidebar={Sidebar}
          decoratePane={decorate}
          paneMeta={paneMeta}
          // Armed only on consent. Unarmed, the library's default applies and a
          // dead pane is dropped — which is what "start clean" asked for and what
          // an all-alive deck never encounters.
          {...(rehydrate ? { onRehydratePane: rehydratePane } : {})}
          // THE BIRTH DOOR (TP-S1). Upstream routes both `splitActive` and
          // `createSessionInActivePane` through this one prop, so supplying it
          // puts fieldd's audited, class-placed, capped `create` in front of
          // every interactive pane birth — without the deck intercepting
          // anything or becoming a second authority over what a pane holds. The
          // workspace still asks; it just gets its session from the product door.
          createSplitSession={createSplitSession}
          splitSizing="equal"
          onTogglePaneZoom={zoom.toggle}
          initialCwd={shell.home}
          claimExistingSessions
          // STAYS OFF, and no longer as a wait (GT-D7's 2026-08-05 amendment):
          // ⌘⇧O's palette was upstream's door to remote sessions, not ours. Ours
          // is the monitor — a peer's session is a bubble in the swarm, and
          // clicking it attaches this pane (GT-D17). The prop gates that palette
          // and its hotkey only; the runtime calls the door above makes are
          // untouched by it.
          //
          // KNOWN DEFECT, upstream, verified NOT FIXABLE FROM HERE at 0.9.2
          // (GT-5c; petition candidate G13). With this false, a mounted remote
          // pane that reaches `ended` still renders the library's own
          // `RemoteSessionBanner`, whose "Browse sessions on <device>" button
          // calls `browseDeviceSessions` — which early-returns on this very flag.
          // A control that does nothing, and reachable rather than latent now
          // that GT-4's floor half has landed.
          //
          // The spec's recommended fix is to hand the library a browse handler
          // that opens OUR monitor. There is no seam for one: `GhostteaWorkspace`
          // destructures sixteen props and none is a browse handler
          // (`workspace/Workspace.d.ts`), `browseDeviceSessions` is an internal
          // `useCallback` wired straight to `SplitView`'s `onBrowseDevice`, and
          // the banner is rendered by the library's own pane. The alternative —
          // rendering our own banner from upstream's exported pure helpers —
          // cannot suppress theirs either. So this is upstream's to open, and
          // intercepting the click by matching another package's internal markup
          // is not a decision a builder should take unilaterally.
          enableRemoteSessions={false}
          showTitlebar={false}
          active={active}
          paneVisibility={paneVisibility}
          {...TAKE_GEOMETRY_ON_FOCUS}
        />
        {/* The frames follow the panes ghosttea laid out (GT-6). Mounted
            inside the zoom host so a zoomed pane keeps its frame through the
            morph, and so the stylesheet's `.vf-deck-framed` scope covers every
            pane element under it. */}
        <ChromeBoundary name="Pane frames" retryKey={framesRetryKey}>
          <DeckFrames
            deckRef={zoomHostRef}
            panes={workspace?.panes ?? []}
            agentsBySession={paneAgents.agents}
            paneColors={framePaneColors}
            fallbackCwdBySession={frameFallbackCwds}
            verbs={frameVerbs}
            frame={Frame}
            zoomedPaneId={zoomedPaneId}
          />
        </ChromeBoundary>
        {/* QL-1: a fresh shell's launcher, beside its frame (`deck-launchers.tsx`). */}
        <ChromeBoundary name="Launchers" retryKey={launchersRetryKey}>
          <GodviewDeckLaunchers
            onReplaced={onLauncherReplaced}
            prepareReplacement={prepareLauncherReplacement}
            deckRef={zoomHostRef}
            workspace={workspace}
            paneColors={framePaneColors}
            fallbackCwdBySession={frameFallbackCwds}
            door={door}
          />
        </ChromeBoundary>
      </div>
    </GhostteaProvider>
  );
}
