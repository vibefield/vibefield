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
import { TerminalCreateResult } from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emitGodviewDeckMarker } from "../development-console";
import { getHost } from "../host";
import { getRendererLogger } from "../logging";
import { godviewTerminalTheme } from "./deck-theme";
import { type DeckSession, describePane, sessionsToAdopt } from "./pane-faces";
import "@vibecook/ghosttea-react/styles.css";
import "@vibecook/ghosttea-react/workspace.css";

// The pane deck (GT-D3/D5) — the spike's proven dance, become product.
//
// Control rides fieldd, the one product door (D27): the renderer asks for a
// free shell with `terminal.create`, which answers WITH its ticket, and hands
// the ticket to main, which dials field-native's sockets and posts the two
// MessagePorts back. Bytes never touch JSON-RPC (EL2). The shell supervises no
// ghosttead: field-native embeds that floor and outlives us, which is what the
// Backend's external mode is for.
//
// Nothing here is mounted until the overlay has been opened once — a user who
// never presses ⌘G forks no bridge, opens no socket, and spawns no shell.

/** The deck's own localStorage namespace, in the vf- prefix the renderer's
 * other keys use. Deliberately NOT the app's IPC channel namespace, which wall
 * R6 reserves for contracts — GT-0 caught a storage key squatting there, and
 * R6 catches this comment too if it spells the prefix out. */
const DECK_STORAGE_KEY = "vf-godview-deck-v1";

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

export function GodviewDeck({ active }: GodviewDeckProps): ReactElement {
  const fieldd = useFielddClient();
  const [runtime, setRuntime] = useState(makeRuntime);
  /** Bumped by a recovery. A runtime holds its ports for life, so a rebuilt
   * bridge needs a NEW runtime — and the workspace reads its runtime from
   * context at mount, so the deck has to remount onto it. */
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<GhostteaWorkspaceContext>();
  const latest = useRef<GhostteaWorkspaceContext | undefined>(undefined);
  latest.current = workspace;
  /** Every session this deck has ever put in a pane. Closing a pane detaches a
   * session that goes on living (GT-D5); without this it would be re-adopted on
   * the next open and the close would mean nothing. */
  const seen = useRef(new Set<string>());

  const publish = useCallback((next: GhostteaWorkspaceContext) => setWorkspace(next), []);
  /** GT-2b: a failed deck must offer its own way back. Bumping the generation
   * births a runtime with a FRESH ports wait and re-runs the connect ask — the
   * same path `bridge-up` takes, available to a human when no bridge-up is
   * coming (a bridge that never built, a ladder that spent itself). */
  const retry = useCallback(() => {
    setError(null);
    setGeneration((current) => current + 1);
  }, []);
  // Read once per mount: the tokens do not move under a running deck, and
  // re-reading them every render would restyle every surface for nothing.
  const theme = useMemo(godviewTerminalTheme, []);
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

  // The free shell, and the transport that shows it. Runs once per runtime
  // generation: a recovery rebuilds the bridge, so the ports have to be asked
  // for again — main's `bridge-up` is the invitation, this is the ask.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const terminal = getHost().terminal;
        if (terminal === undefined) {
          throw new Error("this host has no terminal bridge");
        }
        // Parsed, not cast: a create result without a ticket must fail loudly.
        // cwd, shell and persistence are fieldd's to decide (NF-D6/GT-D5: the
        // user's login shell, $HOME, keep-until-exit) — the deck states no
        // policy it does not own.
        const created = TerminalCreateResult.parse(await fieldd.request("terminal.create", {}));
        if (cancelled) return;
        await terminal.connect(created.ticket);
        if (cancelled) return;
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
      if (status.state === "bridge-down") {
        setError("the terminal bridge died — rebuilding");
        return;
      }
      setRuntime((previous) => {
        previous.dispose();
        return makeRuntime();
      });
      setGeneration((previous) => previous + 1);
    });
  }, []);

  // Adopt what the floor has and the deck has never shown. `claimExistingSessions`
  // covers only the first-ever open (ghosttea gates it on there being no saved
  // workspace), so without this a session born after the deck's first layout —
  // another surface's, an agent's when AR lands — would be invisible in the
  // very view that exists to show everything.
  const hasContext = workspace !== undefined;
  useEffect(() => {
    if (!active || !hasContext) return;
    let cancelled = false;
    void (async () => {
      const context = latest.current;
      if (context === undefined) return;
      try {
        const floor = await runtime.listSessions();
        if (cancelled) return;
        for (const pane of context.panes) seen.current.add(pane.session.id);
        for (const session of sessionsToAdopt(floor, seen.current)) {
          seen.current.add(session.id);
          context.addSession(session);
        }
      } catch (cause) {
        // A floor we cannot list is the bridge's problem, and the bridge
        // reports itself; adopting nothing is the honest outcome here.
        getRendererLogger()
          .child({ component: "godview" })
          .warn("renderer.godview.adopt_failed", "The Godview deck could not list the floor", {
            error: cause instanceof Error ? cause.message : String(cause),
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, runtime, hasContext]);

  // Whatever the deck currently is, said out loud once per change. The canvas
  // smoke's CANVAS_READY precedent: the headless harness reads renderer console
  // output because there is no other way to ask a page what it drew.
  useEffect(() => {
    for (const pane of workspace?.panes ?? []) seen.current.add(pane.session.id);
    emitGodviewDeckMarker({
      active,
      panes: workspace?.panes.length ?? 0,
      sessions: workspace?.sessions.length ?? 0,
      sessionIds: (workspace?.panes ?? []).map((pane) => pane.session.id),
      rendererBackend: runtime.rendererBackend,
      ...(error !== null ? { error } : {}),
    });
  }, [active, workspace, runtime, error]);

  const platform: GhostteaWorkspacePlatform = {
    platform: getHost().platform ?? "other",
    // The workspace only uses this for its OWN create path, which
    // `createSplitSession` below replaces outright; fieldd picks the real shell.
    defaultShell: "/bin/sh",
    readClipboard: () => navigator.clipboard?.readText() ?? "",
    showContextMenu: () => undefined,
    toggleFullscreen: () => undefined,
    // The deck's "window" is the overlay. Ghosttea calls this when the LAST
    // pane closes, and taking the Electron window down there would close the
    // canvas because a terminal ran out — so it closes the overlay instead,
    // which is what the gesture meant.
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

  return (
    <GhostteaProvider key={generation} runtime={runtime}>
      <GhostteaWorkspace
        platform={platform}
        theme={theme}
        storageKey={DECK_STORAGE_KEY}
        sidebar={Sidebar}
        decoratePane={describePane}
        // Every split is a FLOOR session (GT-D5): fieldd's `terminal.create`
        // with its keep-until-exit default and its audit, never the workspace's
        // own runtime create — that one asks for `terminate-with-app`, which is
        // the opposite of the promise this product makes about sessions.
        createSplitSession={async (activeSession: DeckSession) => {
          const created = TerminalCreateResult.parse(
            await fieldd.request("terminal.create", {
              ...(activeSession.cwd !== null ? { cwd: activeSession.cwd } : {}),
            }),
          );
          const floor = await runtime.listSessions();
          const session = floor.find((candidate) => candidate.id === created.sessionId);
          if (session === undefined) {
            throw new Error("the floor did not list the session it had just created");
          }
          seen.current.add(session.id);
          return session;
        }}
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
