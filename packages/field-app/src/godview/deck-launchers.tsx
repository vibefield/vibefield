import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import type { GhostteaTerminalRuntime } from "@vibecook/ghosttea-react";
import type { GhostteaWorkspaceContext } from "@vibecook/ghosttea-react/workspace";
import { DeckLaunchers, type LauncherOutcome } from "@vibecook/puppeteer-views/launcher";
import {
  type AgentProfileSet,
  type AgentProviderSummary,
  AgentProvidersResult,
} from "@vibefield/contracts";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { type ReactElement, type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { getRendererLogger } from "../logging";
import { adoptCreatedTerminal, useTerminalPool } from "../terminal/pool";
import { paneCwd, readDeviceHost } from "./deck-restore";
import { launcherAgents, launcherPortOver } from "./launcher-doors";
import { useDeckAgentFacts } from "./monitor/GodviewAgentsProvider";
import { setLauncherOwnsKeys } from "./monitor/launcher-keys";
import type { MonitorDoor } from "./monitor/remote-door";

// THE EMPTY PANE LAUNCHER'S HOST (QL-1, thinking-ql-empty-pane-launcher.md;
// the V-QL2 half). The launcher is the views package's (`DeckLaunchers`,
// mounted BESIDE `DeckFrames` under the same deck element); VibeField supplies
// what only a host can: which panes are fresh shells (the gate, QL-D7), each
// pane's folder, the agents (`agent.providers`), and the port over fieldd's
// doors (`launcher-doors.ts`). A launch or a resume lands in the launcher's own
// pane through the deck's door (`mountLocal` with `replacing`, serialized with
// every other mount); the fresh shell it replaces then has no pane, no input
// and a birth receipt, which is exactly what the deck's reaper closes through
// `terminal.terminate` (QL-D8 as revised: the reaper, not a second close).

/* ── the gate (QL-D7 as revised 2026-09-28) ─────────────────────────────── */

/**
 * The shells born through the deck's own new-pane door (`createSplitSession`).
 * Ghosttea's own birth receipt (`sessionCreatedHere`) covers the workspace's
 * first shell, which it creates itself; a split is born through fieldd's
 * `terminal.create` and REGISTERED with the runtime, which ghosttea (rightly)
 * does not count as a birth — so the deck says so here, once per split. A
 * rehydrated pane is not recorded: a restored layout's shells never qualify.
 */
const bornShells = new Set<string>();

/** The deck's new-pane door made this shell (one line in `createSplitSession`). */
export function recordBornShell(sessionId: string): void {
  bornShells.add(sessionId);
}

/** Born in this view: the deck's record of its splits, or ghosttea's own
 * receipt for the births it made (the workspace's first shell). */
export function bornInThisView(
  runtime: Pick<GhostteaTerminalRuntime, "sessionCreatedHere"> | null,
): (sessionId: string) => boolean {
  return (sessionId) =>
    bornShells.has(sessionId) || runtime?.sessionCreatedHere(sessionId) === true;
}

/** Tests only. */
export function forgetBornShells(): void {
  bornShells.clear();
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
 * facet, not exited, no input from this view, no foreground job (the same
 * "used" the deck's reaper reads, so the two can never disagree about which
 * shells are still empty). Restored and attached sessions have no birth
 * receipt, so they never qualify.
 */
export function freshShellIds(
  sessions: readonly GateSession[],
  facts: FreshShellFacts,
): ReadonlySet<string> {
  const fresh = new Set<string>();
  for (const session of sessions) {
    if (!facts.bornHere(session.id)) continue;
    if (session.exited === true || session.activity?.kind === "foreground-job") continue;
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
}: GodviewDeckLaunchersProps): ReactElement | null {
  const fieldd = useFielddClient();
  const { runtime } = useTerminalPool();
  const paneAgents = useDeckAgentFacts();
  const panes = workspace?.panes ?? [];
  const sessions = panes.map((pane) => pane.session as GateSession & SessionSummary);

  const fresh = freshShellIds(sessions, {
    bornHere: bornInThisView(runtime),
    hasInput: (id) => runtime?.sessionHasInput(id) === true,
    hasAgent: (id) => paneAgents.agents.has(id),
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

  // The Agent Profiles, for the preview line's name of the default one. Held
  // only while a launcher is up (PF6's rule for the stage's own feeds).
  const [profileSets, setProfileSets] = useState<readonly AgentProfileSet[]>([]);
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

  // The port, memoized on the connection alone: the launcher re-asks its list
  // whenever the port's identity changes.
  const port = useMemo(
    () =>
      launcherPortOver({
        client: fieldd,
        providers: () => providersRef.current,
        place: async (terminal, replacing): Promise<LauncherOutcome> => {
          if (door === null) return { accepted: false, reason: "the deck is not connected" };
          // The answer carries the SAME create ticket a shell birth gets: the
          // pool adopts it and the pane showing the fresh shell takes it
          // (AR-4b's hand-over, as the frame's resume verb does it).
          const born = adoptCreatedTerminal(terminal);
          const outcome = await door.mountLocal(born.sessionId, { replacing });
          if (outcome.state === "mounted") return { accepted: true };
          const reason = outcome.state === "failed" ? outcome.reason : "no pane is open";
          log().info(
            "renderer.godview.launcher_unmounted",
            "the agent started, but the launcher's pane could not take it",
            { sessionId: born.sessionId, replacing, state: outcome.state, reason },
          );
          // Said as what happened: the agent IS running, and the monitor has it.
          return {
            accepted: false,
            reason: `it started, but this pane could not take it (${reason})`,
          };
        },
      }),
    [fieldd, door],
  );

  // Mounted for the deck's whole life, not only while a pane is fresh: the
  // mounter remembers which launchers were put away with ⎋ and which shells
  // it saw input reach, and a remount would forget both.
  if (workspace === undefined) return null;
  return (
    <DeckLaunchers
      deckRef={deckRef}
      panes={panes}
      activePaneId={workspace.activePaneId}
      freshSessionIds={freshShells}
      cwdBySession={cwdBySession}
      paneColors={paneColors}
      agents={agents}
      port={port}
      hasInput={(id) => runtime?.sessionHasInput(id) === true}
      onOwnsKeysChange={setLauncherOwnsKeys}
    />
  );
}
