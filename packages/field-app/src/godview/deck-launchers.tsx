import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import type { GhostteaTerminalRuntime } from "@vibecook/ghosttea-react";
import type { GhostteaWorkspaceContext } from "@vibecook/ghosttea-react/workspace";
import {
  DeckLaunchers,
  type LauncherOutcome,
  type LauncherUnder,
  watchDrawnSessions,
} from "@vibecook/puppeteer-views/launcher";
import {
  type AgentProfileSet,
  type AgentProviderSummary,
  AgentProvidersResult,
} from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import {
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getRendererLogger } from "../logging";
import { adoptCreatedTerminal, terminalSessionProfileSet, useTerminalPool } from "../terminal/pool";
import { paneCwd, readDeviceHost } from "./deck-restore";
import { launcherAgents, launcherPortOver } from "./launcher-doors";
import { useDeckAgentFacts } from "./monitor/GodviewAgentsProvider";
import {
  monitorHoldsKeys,
  subscribeMonitorHoldsKeys,
  takeLauncherKeys,
} from "./monitor/launcher-keys";
import type { MonitorDoor } from "./monitor/remote-door";

// THE EMPTY PANE LAUNCHER'S HOST (QL-1, thinking-ql-empty-pane-launcher.md;
// the V-QL2 half). The launcher is the views package's (`DeckLaunchers`,
// mounted BESIDE `DeckFrames` under the same deck element); VibeField supplies
// what only a host can: which panes are fresh shells (the gate, QL-D7), each
// pane's folder, the agents (`agent.providers`), and the port over fieldd's
// doors (`launcher-doors.ts`). A launch or a resume lands in the launcher's own
// pane through the deck's door (`mountLocal` with `replacing`, serialized with
// every other mount); the fresh shell it replaces then has no pane, no input
// and a birth receipt. The deck explicitly finishes that handoff after mount;
// the pool coalesces it with any final-attachment cleanup already in flight.

/* ── the gate (QL-D7 as revised 2026-09-28) ─────────────────────────────── */

/**
 * The shells born through the deck's own new-pane door (`createSplitSession`),
 * PER RUNTIME. Ghosttea's own birth receipt (`sessionCreatedHere`) covers the
 * workspace's first shell, which it creates itself; a split is born through
 * fieldd's `terminal.create` and REGISTERED with the runtime, which ghosttea
 * (rightly) does not count as a birth — so the deck says so here, once per
 * split. A rehydrated pane is not recorded: a restored layout's shells never
 * qualify.
 *
 * Keyed by the runtime the split was born under, because every other fact the
 * gate reads is that runtime's: `sessionHasInput` and `sessionCreatedHere` are
 * its memory, and the deck's reaper (`UnusedPaneSessions`) is rebuilt with it.
 * A pool retry replaces the runtime and forgets which shells had input; a
 * module-wide record would have outlived that and shown the launcher over a
 * USED shell, and a launch there would replace a PTY the new reaper never
 * held a receipt for — a leak. Under the new runtime the old splits are
 * simply not born here, exactly as the reaper treats them.
 */
const bornShells = new WeakMap<object, Set<string>>();

/** The deck's new-pane door made this shell under `runtime` (one line in
 * `createSplitSession`). No runtime yet, no record: nothing could say later
 * whether it had input. */
export function recordBornShell(runtime: object | null, sessionId: string): void {
  if (runtime === null) return;
  let born = bornShells.get(runtime);
  if (born === undefined) {
    born = new Set();
    bornShells.set(runtime, born);
  }
  born.add(sessionId);
}

/** Born in this view, under THIS runtime: the deck's record of its splits, or
 * ghosttea's own receipt for the births it made (the workspace's first shell). */
export function bornInThisView(
  runtime: (object & Pick<GhostteaTerminalRuntime, "sessionCreatedHere">) | null,
): (sessionId: string) => boolean {
  if (runtime === null) return () => false;
  const born = bornShells.get(runtime);
  return (sessionId) => born?.has(sessionId) === true || runtime.sessionCreatedHere(sessionId);
}

/** What the gate asks of the session's world, apart from its summary. */
export interface FreshShellFacts {
  /** Born in this view: the deck's new-pane door, or the workspace's first shell. */
  bornHere(sessionId: string): boolean;
  /** Input reached it from this view (ghosttea's `sessionHasInput`). */
  hasInput(sessionId: string): boolean;
  /** The fold names a run in it (the pane frame's agent facet). */
  hasAgent(sessionId: string): boolean;
  /** A peer's replica, attached — never born here, said anyway. */
  isRemote(sessionId: string): boolean;
}

type GateSession = Pick<SessionSummary, "id"> & {
  exited?: boolean | undefined;
  activity?: { kind?: string } | undefined;
};

/**
 * The sessions whose panes may show a launcher: born in this view, no agent
 * facet, not exited, no input from this view. Startup jobs do not make a shell
 * used or dismiss its launcher. Restored and attached sessions have no birth
 * receipt, so they never qualify.
 */
export function freshShellIds(
  sessions: readonly GateSession[],
  facts: FreshShellFacts,
): ReadonlySet<string> {
  const fresh = new Set<string>();
  for (const session of sessions) {
    if (!facts.bornHere(session.id)) continue;
    if (session.exited === true) continue;
    if (facts.hasAgent(session.id) || facts.hasInput(session.id) || facts.isRemote(session.id)) {
      continue;
    }
    fresh.add(session.id);
  }
  return fresh;
}

/** A pane's folder, where a launch starts: the shell's own (decoded from the
 * OSC 7 URL the floor reports; a peer's is none), else the folder the deck
 * born it in. */
export function launcherCwds(
  sessions: readonly Pick<SessionSummary, "id" | "cwd">[],
  bornCwd: ReadonlyMap<string, string>,
  localHost: string | null,
): ReadonlyMap<string, string> {
  const folders = new Map<string, string>();
  for (const session of sessions) {
    const cwd = paneCwd({ cwd: session.cwd }, localHost) ?? bornCwd.get(session.id);
    if (cwd !== undefined) folders.set(session.id, cwd);
  }
  return folders;
}

/* ── the host ──────────────────────────────────────────────────────────── */

const NO_SESSIONS: ReadonlySet<string> = new Set();

export interface GodviewDeckLaunchersProps {
  /** The deck element `DeckFrames` finds its panes under. */
  deckRef: RefObject<HTMLElement | null>;
  workspace: GhostteaWorkspaceContext | undefined;
  /** The pane colours per PANE id — the frames' own map. */
  paneColors: ReadonlyMap<string, string>;
  /** The folders the deck born its sessions in (the frames' fallback map). */
  fallbackCwdBySession: ReadonlyMap<string, string>;
  /** The deck's door: its serialized mount and the Agent Profiles feed. */
  door: MonitorDoor | null;
  onReplaced(previousSessionId: string, nextSessionId: string): boolean;
  prepareReplacement(previousSessionId: string, nextSessionId: string): () => void;
}

function log() {
  return getRendererLogger().child({ component: "godview" });
}

export function GodviewDeckLaunchers({
  deckRef,
  workspace,
  paneColors,
  fallbackCwdBySession,
  door,
  onReplaced,
  prepareReplacement,
}: GodviewDeckLaunchersProps): ReactElement | null {
  const fieldd = useFielddClient();
  // SB-3: the pool's record of which shell was born under which Agent Profile
  // (fieldd's words) — the launcher in a bound pane launches under it
  const { runtime, profileSets: boundSets } = useTerminalPool();
  const paneAgents = useDeckAgentFacts();
  const panes = workspace?.panes ?? [];
  const sessions = panes.map((pane) => pane.session as GateSession & SessionSummary);

  const fresh = freshShellIds(sessions, {
    bornHere: bornInThisView(runtime),
    hasInput: (id) => runtime?.sessionHasInput(id) === true,
    hasAgent: (id) => paneAgents.runs.has(id),
    isRemote: (id) => runtime?.remoteSession(id) !== undefined,
  });
  const freshKey = [...fresh].sort().join("\n");
  const freshShells = useMemo<ReadonlySet<string>>(
    () => new Set(freshKey === "" ? [] : freshKey.split("\n")),
    [freshKey],
  );
  const cwdKey = sessions.map((session) => `${session.id}\t${session.cwd ?? ""}`).join("\n");
  // Keyed on the facts it reads (ids and cwds), not on the summaries ghosttea republishes.
  const cwdBySession = useMemo(
    () => launcherCwds(sessions, fallbackCwdBySession, readDeviceHost()),
    [cwdKey, fallbackCwdBySession],
  );

  // The panes as the launchers see them: each session's folder is the one
  // above or none. `DeckLaunchers` falls back to a pane summary's own `cwd`,
  // and that is the floor's raw OSC 7 value — a `file://` URL, another host's
  // path when the shell announced one from an ssh session — which no launch or
  // list may be given. A local pane whose folder `paneCwd` cannot read has none.
  const paneKey = panes.map((pane) => `${pane.id}\t${pane.session.id}`).join("\n");
  const launcherPanes = useMemo(
    () =>
      panes.map((pane) => ({
        id: pane.id,
        session: { id: pane.session.id, cwd: cwdBySession.get(pane.session.id) ?? null },
      })),
    [paneKey, cwdBySession],
  );

  // The agents: asked when a launcher appears (and whenever the set of fresh
  // panes changes), so `lastLaunchedAt` is as new as the launch before it.
  // Nothing is asked while no pane is fresh.
  const [providers, setProviders] = useState<readonly AgentProviderSummary[]>([]);
  const providersRef = useRef(providers);
  providersRef.current = providers;
  useEffect(() => {
    if (freshKey === "") return;
    let cancelled = false;
    void fieldd
      .request("agent.providers", {})
      .then((answer) => {
        if (!cancelled) setProviders(AgentProvidersResult.parse(answer).providers);
      })
      .catch((cause: unknown) =>
        log().info(
          "renderer.godview.launcher_providers_unread",
          "The launcher could not read the agents",
          { reason: cause instanceof Error ? cause.message : String(cause) },
        ),
      );
    return () => {
      cancelled = true;
    };
  }, [fieldd, freshKey]);

  // The Agent Profiles, for the preview line's name of the default one and a
  // bound pane's own caption and agents (SB-3). Held only while a launcher is
  // up (PF6's rule for the stage's own feeds).
  const [profileSets, setProfileSets] = useState<readonly AgentProfileSet[]>([]);
  const profileSetsRef = useRef(profileSets);
  profileSetsRef.current = profileSets;
  const anyFresh = freshKey !== "";
  useEffect(() => {
    if (door?.profiles === undefined || !anyFresh) return;
    // A feed that cannot open costs the preview its profile name ("its
    // defaults"), never the deck: this is a nicety beside the terminals.
    try {
      return door.profiles.subscribe(setProfileSets);
    } catch (cause) {
      log().info(
        "renderer.godview.launcher_profiles_unread",
        "The launcher could not follow the Agent Profiles",
        { reason: cause instanceof Error ? cause.message : String(cause) },
      );
      return undefined;
    }
  }, [door, anyFresh]);

  const agents = useMemo(() => launcherAgents(providers, profileSets), [providers, profileSets]);

  // SB-3 — the launcher in a pane born under an Agent Profile (QL-D3 revised:
  // it launches under it): `New · Under Work`, and that profile's agents — an
  // agent it holds no sign-in for is `no sign-in`. A desktop with one profile
  // has no choice to name, and a set the feed does not list (not read yet, or
  // deleted since) names nothing: the launch still carries the pane's set, and
  // fieldd's refusal says the rest.
  const paneUnder = useCallback(
    ({ sessionId }: { paneId: string; sessionId: string }): LauncherUnder | undefined => {
      const id = boundSets.get(sessionId);
      if (id === undefined || profileSets.length <= 1) return undefined;
      const set = profileSets.find((candidate) => candidate.id === id);
      if (set === undefined) return undefined;
      return {
        label: set.label,
        ...(set.glyph !== undefined ? { glyph: set.glyph } : {}),
        kind: set.kind,
        isDefault: set.default,
        agents: launcherAgents(providers, profileSets, set),
      };
    },
    [boundSets, profileSets, providers],
  );

  // The port, memoized on the connection alone: the launcher re-asks its list
  // whenever the port's identity changes.
  const port = useMemo(
    () =>
      launcherPortOver({
        client: fieldd,
        providers: () => providersRef.current,
        profileSetOf: terminalSessionProfileSet,
        profileSets: () => profileSetsRef.current,
        place: async (terminal, { paneId, replacing }): Promise<LauncherOutcome> => {
          if (door === null) return { accepted: false, reason: "the deck is not connected" };
          // The answer carries the SAME create ticket a shell birth gets: the
          // pool adopts it and the pane showing the fresh shell takes it
          // (AR-4b's hand-over, as the frame's resume verb does it).
          const born = adoptCreatedTerminal(terminal);
          // THIS pane: a mirrored fresh shell shows in several, and the
          // launcher that was used is the one whose pane takes the agent
          const rollback = prepareReplacement(replacing, born.sessionId);
          let outcome: Awaited<ReturnType<MonitorDoor["mountLocal"]>>;
          try {
            outcome = await door.mountLocal(born.sessionId, { replacing, paneId });
          } catch (cause) {
            rollback();
            throw cause;
          }
          if (outcome.state === "mounted") {
            if (!onReplaced(replacing, born.sessionId)) rollback();
            // Named, so the launch waits for this terminal's first frame (QL-2).
            return { accepted: true, sessionId: born.sessionId };
          }
          rollback();
          const reason = outcome.state === "failed" ? outcome.reason : "no pane is open";
          log().info(
            "renderer.godview.launcher_unmounted",
            "the agent started, but the launcher's pane could not take it",
            { sessionId: born.sessionId, paneId, replacing, state: outcome.state, reason },
          );
          // Said as what happened: the agent IS running, and the monitor has it.
          return {
            accepted: false,
            reason: `it started, but this pane could not take it (${reason})`,
          };
        },
      }),
    [fieldd, door, onReplaced, prepareReplacement],
  );

  // QL-2: the launch lands on the agent's first frame, which the runtime
  // publishes per session (ghosttea's `session-drawn`); a runtime without it
  // lands the launch at the port's answer.
  const watchFirstFrame = useMemo(
    () => (runtime === null ? undefined : watchDrawnSessions(runtime)),
    [runtime],
  );

  // A monitor sheet over the stage (the find sheet) holds the keyboard. The
  // launchers' one key listener gives each key to the launcher of the pane
  // that HOLDS it, selected or not, so resting them is not enough: while the
  // sheet is up they are not drawn at all (no fresh shell is handed down), and
  // come back as they were — the mounter still remembers what was put away.
  const monitorHolds = useSyncExternalStore(subscribeMonitorHoldsKeys, monitorHoldsKeys);
  const handedShells = monitorHolds ? NO_SESSIONS : freshShells;

  // QL-D2: a key routed into a pane that shows a launcher is that launcher's,
  // so the monitor's strip yields exactly those. The claim is held while any
  // launcher can be up, and asks the DOM at event time which panes show one
  // (the launcher's own hook, `data-vf-pane-launcher`, portalled straight into
  // the pane element): a launcher put away or used is no longer there.
  const claiming = handedShells.size > 0;
  useEffect(() => {
    if (!claiming) return;
    return takeLauncherKeys((target) => {
      for (const launcher of deckRef.current?.querySelectorAll<HTMLElement>(
        "[data-vf-pane-launcher]",
      ) ?? []) {
        if (launcher.parentElement?.contains(target) === true) return true;
      }
      return false;
    });
  }, [claiming, deckRef]);

  // Activating a pane is the workspace's own verb; a click inside a launcher
  // (a portal) never reaches ghosttea's pane pointer handler, so the launcher
  // asks for it (DeckLaunchers' `onActivatePane`).
  const onActivatePane = useCallback(
    (paneId: string): void => {
      const pane = workspace?.panes.find((candidate) => candidate.id === paneId);
      if (pane !== undefined && workspace?.activePaneId !== paneId) {
        workspace?.activateSession(pane.session.id);
      }
    },
    [workspace],
  );

  // Mounted for the deck's whole life, not only while a pane is fresh: the
  // mounter remembers which launchers were put away with ⎋ and which shells
  // it saw input reach, and a remount would forget both.
  if (workspace === undefined) return null;
  return (
    <DeckLaunchers
      deckRef={deckRef}
      panes={launcherPanes}
      activePaneId={monitorHolds ? null : workspace.activePaneId}
      onActivatePane={onActivatePane}
      freshSessionIds={handedShells}
      cwdBySession={cwdBySession}
      paneColors={paneColors}
      agents={agents}
      paneUnder={paneUnder}
      port={port}
      hasInput={(id) => runtime?.sessionHasInput(id) === true}
      {...(watchFirstFrame !== undefined ? { watchFirstFrame } : {})}
    />
  );
}
