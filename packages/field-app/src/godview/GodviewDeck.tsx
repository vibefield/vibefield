import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import { GhostteaProvider } from "@vibecook/ghosttea-react";
import {
  GhostteaWorkspace,
  type GhostteaWorkspaceContext,
  type GhostteaWorkspacePlatform,
} from "@vibecook/ghosttea-react/workspace";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  emitGodviewColdOpenMarker,
  emitGodviewDeckMarker,
  emitGodviewDirectTerminalMarker,
} from "../development-console";
import { getHost } from "../host";
import { getRendererLogger } from "../logging";
import {
  createTerminalSession,
  openDormantTransport,
  refreshTerminalRoster,
  retryTerminalPool,
  type TerminalFault,
  type TerminalFaultPlane,
  terminalPoolSnapshot,
  terminalSessionSummary,
  useTerminalPool,
  useTerminalPoolOpen,
  useTerminalSessionViews,
} from "../terminal/pool";
import { afterNextFrame, godviewColdOpen } from "./cold-open";
import { deckThemeNameForMode, useDeckAppearance } from "./deck-appearance";
import {
  paneCwd,
  type RestoreQuestion,
  readDeviceHost,
  rememberDeviceHost,
  restoreQuestion,
  restoreSentence,
  savedPaneSessionIds,
} from "./deck-restore";
import { godviewTerminalEffects, godviewTerminalTheme } from "./deck-theme";
import type { GodviewTheme } from "./GodviewTuningPanel";
import { KillActivePane } from "./KillActivePane";
import type { RemoteSessionDoor } from "./monitor/remote-door";
import type { MonitorPaneFacts } from "./monitor/useMonitorAgents";
import { type DeckSession, describePane, type PaneFace } from "./pane-faces";
import { useDeckZoom, ZoomActivePane } from "./ZoomActivePane";
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
  onRemoteDoor?: (door: RemoteSessionDoor | null) => void;
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
  /** Published by the sidebar probe. Read only to REPORT what the deck holds
   * (the marker below); the deck does not drive panes through it any more —
   * that was the adopt sweep GT-2e deleted. */
  const [workspace, setWorkspace] = useState<GhostteaWorkspaceContext>();
  /** The same context, reachable WITHOUT a render (GT-D17). The door is built
   * once per runtime and lives longer than any one context object — ghosttea
   * publishes a fresh one on every pane change — so an attach reads the current
   * one at call time instead of closing over whichever existed at build time. */
  const workspaceRef = useRef<GhostteaWorkspaceContext>(undefined);
  /** The deck's own wrapper — the element pane zoom writes its phase onto. It
   * has to be the deck's rather than the stage's: the stage is shared with the
   * monitor and the tuning panel, and a zoom is about the panes. */
  const zoomHostRef = useRef<HTMLDivElement>(null);
  /** Session id → the monitor row's accent that brought it here. The pane wears
   * the bubble's color, which is the deck↔monitor link the reference app draws
   * (GT-3m ported `PaneAttachment` for exactly this and could not feed it). A
   * ref because `decoratePane` must stay referentially stable, and the mount
   * that follows an attach re-renders the workspace anyway. */
  const paneColors = useRef(new Map<string, string>());
  /** Local replica id → the PEER it came from. The deck is the only place that
   * knows a pane is a peer's, and it knows it exactly once — at the attach that
   * made it — so this is where locality is recorded rather than inferred later
   * from a path (GT-5c, the 2026-08-06 erratum). It is read by `paneMeta`, so a
   * ref for the same reason `paneColors` is one. */
  const remoteDevices = useRef(new Map<string, string>());
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
        await createTerminalSession({ workloadClass: "interactive" }, godviewColdOpen);
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
    (session: { id?: string; cwd?: string | null; title?: string | null }) => {
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
      return {
        ...(typeof session.cwd === "string" && session.cwd !== "" ? { cwd: session.cwd } : {}),
        ...(typeof session.title === "string" && session.title !== ""
          ? { title: session.title }
          : {}),
        ...(remoteDevice !== undefined ? { remoteDevice } : {}),
      };
    },
    [],
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
    async (cwd: string | undefined): Promise<SessionSummary | null> => {
      const created = await createTerminalSession({
        ...(cwd !== undefined ? { cwd } : {}),
        // TC-D6(c): the class is the scrollback cap AND the placement hint. A
        // pane a person types into is interactive by definition.
        workloadClass: "interactive",
      });
      // The join: fieldd answers an id, the workspace mounts a summary, and the
      // floor is the one authority both read.
      return terminalSessionSummary(created.sessionId);
    },
    [],
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
      const cwd = paneCwd(context.meta, readDeviceHost()) ?? shell.home;
      try {
        return await bornSession(cwd);
      } catch (cause) {
        // Drop-and-collapse is the library's own answer to a null, and it is
        // the honest one: a pane that cannot be refilled should not be drawn as
        // though it were. The failure is LOUD in the log and quiet on screen.
        getRendererLogger()
          .child({ component: "godview" })
          .error(
            "renderer.godview.rehydrate_failed",
            `A saved pane could not be relaunched at ${cwd}`,
            cause,
          );
        return null;
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
      const cwd = paneCwd({ cwd: activeSession.cwd }, readDeviceHost()) ?? shell?.home;
      const born = await bornSession(cwd);
      if (born === null) throw new Error("the floor did not report the session it just created");
      return born;
    },
    [bornSession, shell],
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
  const door = useMemo<RemoteSessionDoor | null>(() => {
    if (runtime === null) return null;
    return {
      // `enableRemoteSessions={false}` below turns off upstream's palette and
      // its ⌘⇧O binding — it does NOT gate these calls, which live on the
      // runtime and speak to the floor's control connection directly. That is
      // exactly what GT-D7's amendment asked for: their door closed, ours open.
      listHosts: () => runtime.listRemoteHosts(),
      attach: async (request) => {
        const active = workspaceRef.current?.activeSession;
        if (active === undefined) return { state: "no-pane" };
        try {
          // Sized to the pane it is about to live in, like upstream's own
          // palette open — a replica born at the wrong geometry redraws once
          // and reflows the peer's screen for everyone watching it.
          const session = await runtime.openRemoteSession(
            request.deviceId,
            request.remoteSessionId,
            active.cols,
            active.rows,
            request.deviceName,
          );
          const context = workspaceRef.current;
          if (context === undefined || context.activePaneId === undefined) {
            // The pane went away while the mesh was answering. Upstream's own
            // cleanup for this exact case, and the same call: for a session the
            // local registry does not hold, ghosttea 0.9.1's `Terminate` routes
            // to the MESH runtime's `close_session` (service.rs:2894-2909) —
            // the replica layer, not the peer's PTY. Named residual: that
            // trait method carries no doc comment and its implementation ships
            // in `ghosttea-truffle`, so "it closes only our replica" is read
            // from the routing, not from a contract test. Sub-millisecond
            // window; the alternative is leaking a replica nothing can reach.
            runtime.terminate(session.id);
            return { state: "no-pane" };
          }
          paneColors.current.set(session.id, request.color);
          // The locality record (GT-5c). This is the one moment the deck knows
          // for certain that this pane holds a PEER'S session, and `paneMeta`
          // stamps it into the persisted document so a later restore does not
          // have to guess from a path.
          remoteDevices.current.set(session.id, request.deviceName);
          // THE MOUNT. `mountSession` puts a session in the ACTIVE pane and
          // activates it — the workspace's own door (GT-D10), the same one the
          // reference app's select flow drives. Note what it is not: `addSession`,
          // which upstream's palette uses to SPLIT. GT-D17 says attach the pane
          // the user is in, so the deck's shape is the user's, not ours.
          //
          // The session the pane was showing is detached, never killed: the
          // pane leaf's session is replaced (pane-layout's `mountSessionInPane`)
          // and nothing terminates it — GT-D5's close-detaches law, arriving
          // here for free because the library obeys it too.
          context.mountSession(session);
          return { state: "attached", sessionId: session.id, readWrite: session.readWrite };
        } catch (cause) {
          // The floor's own words, carried whole. A mesh that refuses is a
          // state to report, not an exception to swallow.
          return {
            state: "failed",
            reason: cause instanceof Error ? cause.message : String(cause),
          };
        }
      },
    };
  }, [runtime]);

  useEffect(() => {
    onRemoteDoor?.(door);
    // The deck going away takes the door with it: a monitor still holding one
    // would be polling a control connection nobody owns.
    return () => onRemoteDoor?.(null);
  }, [door, onRemoteDoor]);

  /** The sessions this deck currently SHOWS, by id and nothing else (TP-L-C).
   * One list, two readers: the monitor's pane facts and the demand below. */
  const paneSessionIds = useMemo(
    () => (workspace?.panes ?? []).map((pane) => pane.session.id),
    [workspace],
  );

  // PANE ZOOM (TP-D18, §9.7). The chord is claimed from ghosttea here — see
  // `ZoomActivePane` for why, and `deck-zoom.ts` for what upstream's own zoom
  // does instead. Note what this does NOT touch: demand. A zoomed deck shows
  // one pane and keeps every other pane MOUNTED (hidden, not unmounted), so
  // every session's view binding and its declared demand are exactly what they
  // were — which is the difference between a zoom and upstream's remount.
  const zoom = useDeckZoom(zoomHostRef, workspace?.activePaneId);

  // DEMAND (TP-L-E'), declared where the views are.
  //
  // One view per pane, at `live` while the overlay is open and `none` while it
  // is not — PF6's `active` bit, said as a demand rather than only as a
  // visibility prop. The release is atomic and belongs to the pool: a deck that
  // unmounts drops every declaration in one pass, and a session nothing declares
  // is a session nothing has to advance (TP-R1).
  //
  // What this does NOT do yet, stated plainly: reach the cell. `DeclareDemand`
  // lands at TP-S3b with the direct connection, and until then `active: false`
  // still leaves the source hot and the worker decoding — upstream's `setVisible`
  // is worker-only and never reaches the daemon. The ledger is the honest record
  // of what the tier SHOULD be; it is not yet a claim that it is.
  useTerminalSessionViews(paneSessionIds, active ? "live" : "none");

  // The pane facts the monitor reads (GT-D17). Published on CHANGE only — this
  // fires on every workspace republish, and an unchanged array would re-run the
  // monitor's projection at ghosttea's cadence rather than at the panes'.
  const lastPaneFacts = useRef("");
  useEffect(() => {
    const sessionIds = paneSessionIds;
    const activeSessionId = workspace?.activeSession?.id;
    const key = `${sessionIds.join("\0")}${activeSessionId ?? ""}`;
    if (key === lastPaneFacts.current) return;
    lastPaneFacts.current = key;
    // A color belongs to a pane, so it leaves with one. Pruned HERE rather than
    // on close because this is where the deck learns its panes changed, whatever
    // changed them — and a map that only ever grew would hand a stale accent
    // back if the floor ever reused a session id.
    for (const sessionId of paneColors.current.keys()) {
      if (!sessionIds.includes(sessionId)) paneColors.current.delete(sessionId);
    }
    for (const sessionId of remoteDevices.current.keys()) {
      if (!sessionIds.includes(sessionId)) remoteDevices.current.delete(sessionId);
    }
    onPanes?.({ sessionIds, ...(activeSessionId !== undefined ? { activeSessionId } : {}) });
  }, [paneSessionIds, workspace, onPanes]);

  /** The pane's face, plus the monitor link (GT-D17).
   *
   * `describePane` stays a pure function of the session and keeps its own law
   * (a live pane says nothing). What this adds is a §2.6 accent for a pane a
   * monitor row put there — an accent GROUPS and labels and never signals
   * state, which is why an exit's `--vf-red` still wins: a state outranks a
   * label, always. */
  const decorate = useCallback((session: DeckSession): PaneFace | undefined => {
    const face = describePane(session);
    const color = paneColors.current.get(session.id);
    if (color === undefined) return face;
    return { ...face, color: face?.color ?? color };
  }, []);

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

  const platform: GhostteaWorkspacePlatform | null =
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
          // The deck's "window" is the overlay. Ghosttea calls this when the
          // LAST pane closes, and taking the Electron window down there would
          // close the canvas because a terminal ran out — so it closes the
          // overlay instead, which is what the gesture meant.
          closeWindow: () => {
            void getHost().godview?.set(false);
          },
          onMenuAction: () => () => undefined,
        };

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
      <div ref={zoomHostRef} className="vf-deck-zoom" data-zoom-phase="idle">
        {workspace?.activeSession !== undefined && (
          <KillActivePane session={workspace.activeSession} fieldd={fieldd} />
        )}
        <ZoomActivePane
          phase={zoom.state.phase}
          paneId={workspace?.activePaneId}
          onToggle={zoom.toggle}
        />
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
        />
      </div>
    </GhostteaProvider>
  );
}
