import {
  createGhostteaTerminalRuntime,
  GhostteaProvider,
  type GhostteaTerminalRuntime,
  waitForGhostteaRendererPorts,
} from "@vibecook/ghosttea-react";
import TerminalRenderWorker from "@vibecook/ghosttea-react/terminal-render.worker.js?worker";
import {
  GhostteaWorkspace,
  type GhostteaWorkspaceContext,
  type GhostteaWorkspacePlatform,
} from "@vibecook/ghosttea-react/workspace";
import { TerminalConnectTicketResult, TerminalListResult } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitGodviewDeckMarker } from "../development-console";
import { getHost } from "../host";
import { getRendererLogger } from "../logging";
import { useDeckAppearance } from "./deck-appearance";
import {
  paneCwd,
  type RestoreQuestion,
  restoreQuestion,
  restoreSentence,
  savedPaneSessionIds,
} from "./deck-restore";
import { godviewTerminalTheme } from "./deck-theme";
import { KillActivePane } from "./KillActivePane";
import { describePane } from "./pane-faces";
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
// Control rides fieldd, the one product door (D27): the renderer asks for the
// connection's ticket with `terminal.connectTicket` — a mint, no session — and
// hands it to main, which dials field-native's sockets and posts the two
// MessagePorts back. Bytes never touch JSON-RPC (EL2). The shell supervises no
// ghosttead: field-native embeds that floor and outlives us, which is what the
// Backend's external mode is for. fieldd stands BESIDE the flow as policy
// client: it mints tickets and audits, and the native plane keeps what the
// workspace creates alive (GT-D11) — neither is a gate in front of a pane.
//
// Nothing here is mounted until the overlay has been opened once — a user who
// never presses ⌘G forks no bridge, opens no socket, and spawns no shell.

/** The deck's own localStorage namespace, in the vf- prefix the renderer's
 * other keys use. Deliberately NOT the app's IPC channel namespace, which wall
 * R6 reserves for contracts — GT-0 caught a storage key squatting there, and
 * R6 catches this comment too if it spells the prefix out. */
const DECK_STORAGE_KEY = "vf-godview-deck-v1";

/** The geometry the workspace's OWN create doors use for a pane with nothing to
 * copy from (Workspace.tsx's initialization door). A rehydrated pane is that
 * same case — the session it replaces is gone, so there are no cols to inherit
 * — and the first resize from the mounted surface corrects it either way. */
const SPAWN_COLS = 100;
const SPAWN_ROWS = 30;

/** Ports are transferred per ATTACH and the wait is one-shot, so a runtime is
 * born with its own fresh wait, armed before the connect that causes the
 * transfer. Generous, because a redeem talks to two daemons. */
function makeRuntime(): GhostteaTerminalRuntime {
  return createGhostteaTerminalRuntime({
    ports: waitForGhostteaRendererPorts(45_000),
    clientBuild: "vibefield-godview",
    // Bundled explicitly: the runtime's default resolves its worker relative to
    // its own module URL, which under Vite means an asset inside node_modules.
    workerFactory: () => new TerminalRenderWorker(),
    platform: {
      writeClipboard: (text) => void navigator.clipboard?.writeText(text),
      forceCanvasFallback: () => false,
      setForceCanvasFallback: () => undefined,
      // A VibeField renderer cannot reload itself — security.ts denies every
      // renderer-initiated navigation outside dev (GT-1 finding 3) — and should
      // not want to: a reload would take the whole canvas down with the deck.
      // Recovery is in-page, below.
      reload: () => undefined,
    },
  });
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
}

export function GodviewDeck({ active }: GodviewDeckProps): ReactElement | null {
  const fieldd = useFielddClient();
  const [runtime, setRuntime] = useState(makeRuntime);
  /** Bumped by a recovery. A runtime holds its ports for life, so a rebuilt
   * bridge needs a NEW runtime — and the workspace reads its runtime from
   * context at mount, so the deck has to remount onto it. */
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Published by the sidebar probe. Read only to REPORT what the deck holds
   * (the marker below); the deck does not drive panes through it any more —
   * that was the adopt sweep GT-2e deleted. */
  const [workspace, setWorkspace] = useState<GhostteaWorkspaceContext>();
  /** The shell every pane is born with, and where. Main's answer to the connect
   * (GT-D10) — `null` until it lands, which is what gates the workspace's first
   * mount below. */
  const [shell, setShell] = useState<{ defaultShell: string; home: string } | null>(null);
  /** GT-3, the restore gate. `null` while the question is still being asked of
   * the floor; a question object while the user is being asked; `"go"` once the
   * deck may mount — with rehydration armed or not, per `rehydrate`. */
  const [consent, setConsent] = useState<RestoreQuestion | "go" | null>(null);
  /** Whether `onRehydratePane` is armed. False is not a bug state: a user who
   * chose to start clean has no layout left to rehydrate, and a deck with no
   * dead panes never had anything to ask about. */
  const [rehydrate, setRehydrate] = useState(false);
  /** GT-2c: only a status TRANSITION may act — main republishes unchanged
   * states by contract, and a republish treated as news is a remount loop. */
  const lastBridgeState = useRef<string | null>(null);
  /** Replaced runtimes retire here and are disposed after commit. A Set, so a
   * twice-run updater (StrictMode) retires an instance once; disposal inside
   * an updater or an unmount cleanup would double-fire there. */
  const retiredRuntimes = useRef(new Set<GhostteaTerminalRuntime>());

  const publish = useCallback((next: GhostteaWorkspaceContext) => setWorkspace(next), []);
  /** GT-2b: a failed deck must offer its own way back. Bumping the generation
   * births a runtime with a FRESH ports wait and re-runs the connect ask — the
   * same path `bridge-up` takes, available to a human when no bridge-up is
   * coming (a bridge that never built, a ladder that spent itself). */
  const retry = useCallback(() => {
    setError(null);
    // The failed runtime's one-shot ports wait is SPENT — retry must mint a
    // fresh runtime, not merely re-ask on the dead one.
    setRuntime((previous) => {
      retiredRuntimes.current.add(previous);
      return makeRuntime();
    });
    setGeneration((current) => current + 1);
  }, []);

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

  // Disposal happens HERE, after commit, never in an updater: each runtime
  // owns a render worker and the ports, and a leaked one is a leaked thread.
  useEffect(() => {
    for (const old of retiredRuntimes.current) {
      if (old !== runtime) {
        retiredRuntimes.current.delete(old);
        old.dispose();
      }
    }
  }, [runtime]);
  // The viewer's own appearance (GT-D12), read from the store Settings writes.
  // Recomputed when it moves and ONLY then: `theme` is not among the
  // workspace's initialization deps (`storageKey ∥ defaultShell ∥
  // claimExistingSessions ∥ initialCwd ∥ runtime`), so a new theme re-renders
  // the panes without re-initializing the deck — an appearance change applies
  // to an open deck with no remount, no reclaim, and no new pane.
  const appearance = useDeckAppearance();
  const theme = useMemo(() => godviewTerminalTheme(appearance), [appearance]);
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

  // The transport, and the shell policy that rides its answer. Runs once per
  // runtime generation: a recovery rebuilds the bridge, so the ports have to be
  // asked for again — main's `bridge-up` is the invitation, this is the ask.
  //
  // No session is created here, and that is the whole of GT-D10. The deck asks
  // for a ticket to the floor; what appears in a pane is the workspace's
  // decision, made through its own doors against the connection this opens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const terminal = getHost().terminal;
        if (terminal === undefined) {
          throw new Error("this host has no terminal bridge");
        }
        // Parsed, not cast: a mint without a ticket must fail loudly.
        const minted = TerminalConnectTicketResult.parse(
          await fieldd.request("terminal.connectTicket", {}),
        );
        if (cancelled) return;
        // Main answers the connect with the shell identity it alone can read.
        const attached = await terminal.connect(minted.ticket);
        if (cancelled) return;
        setShell({ defaultShell: attached.defaultShell, home: attached.home });
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        getRendererLogger()
          .child({ component: "godview" })
          .error(
            "renderer.godview.deck_unavailable",
            "The Godview deck could not reach a shell",
            cause,
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fieldd, generation]);

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
  // A floor that cannot be asked mounts too, unarmed: `terminal.list` failing
  // means the deck is about to have bigger problems than a prompt, and guessing
  // that every saved pane is dead would be the one answer certain to be wrong.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let saved: string[] = [];
      try {
        saved = savedPaneSessionIds(localStorage.getItem(DECK_STORAGE_KEY));
      } catch {
        saved = []; // a page with no storage has no layout, which is an answer
      }
      if (saved.length === 0) {
        if (!cancelled) setConsent("go");
        return;
      }
      let live: string[] = [];
      try {
        live = TerminalListResult.parse(await fieldd.request("terminal.list", {})).terminals.map(
          (terminal) => terminal.sessionId,
        );
      } catch (cause) {
        getRendererLogger()
          .child({ component: "godview" })
          .error(
            "renderer.godview.restore_floor_unreadable",
            "The floor could not be listed for the restore check; mounting without it",
            cause,
          );
        if (!cancelled) setConsent("go");
        return;
      }
      if (cancelled) return;
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
  }, [fieldd]);

  // Recovery (GT-1's ladder, from the renderer's side). `bridge-down` is the
  // honest moment of death; `bridge-up` is the only one this page can act on,
  // and acting means a new runtime with a fresh ports wait for the deck to
  // remount onto. `ticket-expired` means main's credentials rotted with a
  // field-native reboot and only a fresh redeem will do — which is what a new
  // generation performs.
  useEffect(() => {
    const terminal = getHost().terminal;
    if (terminal === undefined) return;
    return terminal.onStatus((status) => {
      // GT-2c: main publishes on EVERY set, including unchanged — its own
      // contract test pins that — so only a TRANSITION may act here. Treating
      // a republish as news built a feedback loop: each event minted a runtime
      // and a generation, each generation re-asked, and the deck remounted
      // itself to death (the dev storm James hit).
      if (status.state === lastBridgeState.current) return;
      lastBridgeState.current = status.state;
      if (status.state === "bridge-down") {
        setError("the terminal bridge died — rebuilding");
        return;
      }
      if (status.state !== "bridge-up" && status.state !== "ticket-expired") return;
      // Act = a fresh runtime (the old one's one-shot ports wait is spent) and
      // a new generation (re-redeem + re-connect). The old runtime is disposed
      // by the effect below, never inside the updater — updaters must stay
      // pure, React may run them more than once.
      setError(null);
      setRuntime((previous) => {
        retiredRuntimes.current.add(previous);
        return makeRuntime();
      });
      setGeneration((previous) => previous + 1);
    });
  }, []);

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
  const paneMeta = useCallback((session: { cwd?: string | null; title?: string | null }) => {
    // Only DEFINED fields: an explicit `undefined` would serialize away anyway,
    // and a null cwd persisted as `"cwd": null` is a value a reader has to
    // learn to disbelieve.
    //
    // `cwd` is stored VERBATIM — the OSC 7 URL the floor reported, host and
    // all — and decoded by whoever reads it (`paneCwd`). Normalizing on the way
    // in would throw away the host, which is exactly the field a remote pane
    // will need when GT-4 lights them up, and would make the persisted document
    // a summary of what the floor said rather than a record of it.
    return {
      ...(typeof session.cwd === "string" && session.cwd !== "" ? { cwd: session.cwd } : {}),
      ...(typeof session.title === "string" && session.title !== ""
        ? { title: session.title }
        : {}),
    };
  }, []);

  // A dead pane, answered with a live one (GT-D8). Armed only after consent.
  //
  // The replacement is created through the WORKSPACE'S OWN runtime door, with
  // the same options its own initialization uses — that is GT-D10 holding under
  // a feature that could easily have broken it. Going through `terminal.create`
  // would put fieldd back in front of a pane birth for no reason: the deck has
  // a connection, the workspace has a door, and fieldd's policy seat does not
  // require it to be on the path.
  //
  // `terminate-with-app` is passed DELIBERATELY, and it is the one thing here
  // that looks wrong and is not: it is what the workspace's own doors ask for,
  // and field-native re-governs an ownerless birth to keep-until-exit on
  // `session-created` (GT-D11). Asking for keep-until-exit here would make this
  // pane the one session on the floor whose retention came from the renderer.
  const rehydratePane = useCallback(
    async (context: { meta: unknown; sessionId: string; paneId: string }) => {
      if (shell === null) return null;
      // `paneCwd` and not `meta.cwd`: what the floor calls a cwd is the OSC 7
      // URL the shell announced, and a spawn given `file://host/Users/x` cannot
      // chdir into it. Home is the honest fallback for a pane whose shell never
      // announced one at all — which is most of them, since the spawn directory
      // is not reported and OSC 7 needs a shell integration.
      const cwd = paneCwd(context.meta) ?? shell.home;
      try {
        return await runtime.createSession({
          executable: shell.defaultShell,
          args: [],
          cwd,
          environment: { mode: "inherit" },
          cols: SPAWN_COLS,
          rows: SPAWN_ROWS,
          persistence: "terminate-with-app",
          programKind: "interactive-shell",
        });
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
    [runtime, shell],
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
      rendererBackend: runtime.rendererBackend,
      // Read off the theme the workspace was actually handed, not off the
      // appearance the store holds: what the renderer received is the fact
      // worth publishing, and the two could only differ because of a bug.
      glass: {
        paneBackgroundAlpha: theme.background[3],
        opacityCells: theme.backgroundOpacityCells === true,
        themeName: appearance.themeName,
      },
      ...(error !== null ? { error } : {}),
      ...(consent !== null && consent !== "go" ? { consent } : {}),
      ...(exited.length > 0 ? { exitedSessionIds: exited } : {}),
      ...(workspace?.activeSession !== undefined
        ? { activeSessionId: workspace.activeSession.id }
        : {}),
    });
  }, [active, workspace, runtime, error, consent, theme, appearance.themeName]);

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
        <p className="vf-godview-deck-fault-message">the deck could not reach its shell</p>
        <p className="vf-godview-deck-fault-detail">{error}</p>
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
  if (platform === null || shell === null || consent === null) return null;

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
      {workspace?.activeSession !== undefined && (
        <KillActivePane session={workspace.activeSession} fieldd={fieldd} />
      )}
      <GhostteaWorkspace
        platform={platform}
        theme={theme}
        storageKey={DECK_STORAGE_KEY}
        sidebar={Sidebar}
        decoratePane={describePane}
        paneMeta={paneMeta}
        // Armed only on consent. Unarmed, the library's default applies and a
        // dead pane is dropped — which is what "start clean" asked for and what
        // an all-alive deck never encounters.
        {...(rehydrate ? { onRehydratePane: rehydratePane } : {})}
        // No `createSplitSession` (GT-D10): splits go through the workspace's
        // own door, like every other birth. It asks for `terminate-with-app`
        // there — the opposite of this product's promise — and that is
        // corrected where it belongs, in the plane that outlives fieldd:
        // field-native re-governs ownerless births to keep-until-exit on
        // `session-created` (GT-D11). Intercepting the door instead is what
        // made this deck an authority it should never have been.
        initialCwd={shell.home}
        claimExistingSessions
        // GT-4's floor work is what lights these up; until field-native serves
        // the mesh the palette would list nothing and promise something.
        enableRemoteSessions={false}
        showTitlebar={false}
        active={active}
      />
    </GhostteaProvider>
  );
}
