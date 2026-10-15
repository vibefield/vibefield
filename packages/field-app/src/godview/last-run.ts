import type { SessionSummary } from "@vibecook/ghosttea-protocol";
import {
  type AgentLastRunGone,
  AgentLastRunResult,
  type AgentModelBoardRow,
  type AgentModelMeshOpen,
  type AgentModelSnapshot,
  AgentSpawnResult,
} from "@vibefield/contracts";
import { useSyncExternalStore } from "react";
import { type KeyedCallClient, requestResolvingOutcome } from "../forwarded-call";
import { getRendererLogger } from "../logging";
import {
  adoptCreatedTerminal,
  refreshTerminalRoster,
  terminalPoolSnapshot,
} from "../terminal/pool";
import { godviewColdOpen } from "./cold-open";
import { DECK_STORAGE_KEY, savedPaneSessionIds } from "./deck-restore";
import { refusalReason } from "./launcher-doors";
import type { ModelBoardPort } from "./monitor/remote-door";

// LR (James, 2026-10-15 — the focus session's ruling) — WHAT THE LAST RUN LEFT.
//
// "If there are unclosed sessions from last app run, this restore dialogue
// should be shown at the godview at the center, and there should be bubbles
// shown in the swarm view based on previous status, same for each view, a
// static view of previous snapshotted last state shown in each view, and there
// will be a semi transparent overlay on top that shows our dialogue choice."
//
// The deck used to ask this itself, at its first call ("this deck had N panes
// last time"), knowing only its own layout. The question is the WINDOW's now,
// asked once as Godview first opens, and it knows more:
//
//   - fieldd's picture (`agent.lastRun`): the board as the last run left it —
//     every view draws it still, behind the question — and which of its rows
//     did not survive: agents whose records can continue them, bare shells;
//   - the deck's own layout against the floor's roster: the panes whose
//     sessions are gone, as GT-3 always read them.
//
// RESTORE resumes each agent's own conversation (`agent.resume
// {runtimeRunId}`, the record form — the agent's folder, profile and launch
// model come back with it) and hands its new terminal to the pane that showed
// it (`resumedPaneSession`, read by the deck's rehydration); every other dead
// pane is a new shell in its folder, as before. START CLEAN forgets the deck's
// layout and fieldd's picture. Either answer lets fieldd's picture go.
//
// One store per window, module-level like the pool it hands terminals to: the
// overlay asks and draws the curtain, the deck waits on the answer.

/** What the curtain states, in its own numbers (DESIGN.md §9). */
export interface LastRunQuestion {
  /** when fieldd's picture was last taken; absent with no picture (only the
   * deck's layout knew there had been panes) */
  asOf?: string | undefined;
  /** the board to draw still, as the window's one door would have answered it */
  board?: AgentModelMeshOpen | undefined;
  /** the agents a restore resumes */
  agents: readonly LastRunAgent[];
  /** the deck's panes whose shells a restore reopens in their folders */
  shells: number;
  /** bare shells no pane showed: drawn in the picture, not coming back */
  unplaced: number;
}

export interface LastRunAgent {
  id: string;
  /** the floor session its pane showed, for the hand-over */
  sessionId?: string | undefined;
  /** how a failure names it: the agent's label and its project */
  name: string;
}

export interface LastRunFailure {
  name: string;
  reason: string;
}

export type LastRunState =
  | { phase: "unasked" }
  | { phase: "reading" }
  | { phase: "asking"; question: LastRunQuestion }
  | { phase: "restoring"; question: LastRunQuestion }
  /** restored, with refusals the person reads before the curtain lifts */
  | {
      phase: "restored";
      question: LastRunQuestion;
      resumed: number;
      failed: readonly LastRunFailure[];
    }
  | { phase: "answered"; rehydrate: boolean };

/** How long fieldd is asked again — not yet connected, or starting — before
 * the question is asked without its picture: a cold launch's boot and the
 * re-attach grace with room. Never a person's wait: nothing is drawn as asking
 * until this is decided. */
export const LAST_RUN_READ_MS = 45_000;
const READ_RETRY_MS = [250, 500, 1_000, 2_000] as const;

let state: LastRunState = { phase: "unasked" };
const listeners = new Set<() => void>();
/** old floor session → the resumed agent's new session, for the deck */
const resumedPanes = new Map<string, SessionSummary>();

function publish(next: LastRunState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

export function lastRunState(): LastRunState {
  return state;
}

export function subscribeLastRun(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLastRun(): LastRunState {
  return useSyncExternalStore(subscribeLastRun, lastRunState, lastRunState);
}

/** The deck's consent (GT-3's gate, answered by the window): null while the
 * last run is read or asked about; `rehydrate` once answered. */
export function deckAnswer(current: LastRunState = state): { rehydrate: boolean } | null {
  if (current.phase === "answered") return { rehydrate: current.rehydrate };
  if (current.phase === "restored") return { rehydrate: true };
  return null;
}

/** The person is being asked: an act that called the terminals waits with
 * them, and its clock stands (W7, DESIGN.md §8 "History"). */
export function askingPerson(current: LastRunState = state): boolean {
  return current.phase === "asking" || current.phase === "restoring";
}

/** The question the curtain draws, while it stands. */
export function curtainQuestion(current: LastRunState = state): LastRunQuestion | null {
  return current.phase === "asking" || current.phase === "restoring" || current.phase === "restored"
    ? current.question
    : null;
}

/** The question as the deck's marker states it, for the harnesses: the
 * curtain's own numbers, while it stands. */
export function consentFacts(
  current: LastRunState = state,
): { agents: number; shells: number; unplaced: number } | undefined {
  const question = curtainQuestion(current);
  if (question === null) return undefined;
  return {
    agents: question.agents.length,
    shells: question.shells,
    unplaced: question.unplaced,
  };
}

/** The resumed agent's terminal for the pane that showed `oldSessionId`. */
export function resumedPaneSession(oldSessionId: string): SessionSummary | undefined {
  return resumedPanes.get(oldSessionId);
}

/** The window's board as a picture holds it: this desktop's rows, live. */
export function pictureOpen(board: AgentModelSnapshot, asOf: string): AgentModelMeshOpen {
  const byDevice = new Map<string, AgentModelBoardRow[]>();
  for (const row of board.rows) {
    const rows = byDevice.get(row.device) ?? [];
    rows.push(row);
    byDevice.set(row.device, rows);
  }
  return {
    devices: [...byDevice.entries()].map(([device, rows]) => ({
      device,
      state: "live" as const,
      asOf,
      snapshot: { epoch: board.epoch ?? "last-run", revision: board.revision, rows },
    })),
  };
}

/** A model port answering the picture and nothing after it: the window's feed
 * and every view behind it run exactly as they run live, on a board that does
 * not move (the replay client's idea, MV-3c, held at one frame). */
export function stillBoardPort(open: AgentModelMeshOpen): ModelBoardPort {
  return {
    subscribe: async () => ({ snapshot: open, unsubscribe: () => undefined }),
    reportShown: async () => ({ reported: true }),
  };
}

/** The question, as arithmetic: fieldd's gone rows and the deck's dead panes.
 * Null when nothing a restore could bring back was lost. */
export function composeLastRun(
  left: AgentLastRunResult | null,
  saved: readonly string[],
  live: ReadonlySet<string> | null,
): LastRunQuestion | null {
  const picture = left?.state === "left" ? left : null;
  const gone = picture?.gone ?? [];
  const rows = new Map((picture?.board.rows ?? []).map((row) => [row.runtimeRunId, row]));
  const agents = gone
    .filter((row) => row.kind === "agent")
    .map((row) => ({ id: row.id, sessionId: row.sessionId, name: nameOf(rows.get(row.id)) }));
  const agentSessions = new Set(agents.flatMap((agent) => agent.sessionId ?? []));
  const savedSet = new Set(saved);
  // a roster this window could not read says nothing is dead (GT-3's rule:
  // guessing every saved pane dead is the one answer certain to be wrong)
  const deadPanes = live === null ? [] : [...savedSet].filter((id) => !live.has(id));
  const shells = deadPanes.filter((id) => !agentSessions.has(id)).length;
  const unplaced = gone.filter(
    (row) => row.kind === "terminal" && !savedSet.has(row.sessionId ?? row.id),
  ).length;
  if (agents.length + shells === 0) return null;
  return {
    ...(picture !== null
      ? { asOf: picture.asOf, board: pictureOpen(picture.board, picture.asOf) }
      : {}),
    agents,
    shells,
    unplaced,
  };
}

function nameOf(row: AgentModelBoardRow | undefined): string {
  const named = row as { label?: unknown; project?: { name?: unknown } } | undefined;
  const label = typeof named?.label === "string" ? named.label : "an agent";
  const project = named?.project?.name;
  return typeof project === "string" && project !== "" ? `${label} in ${project}` : label;
}

/** Ask once per window: fieldd's picture, then the deck's layout against the
 * roster. Idempotent; the first caller asks. */
export async function askLastRun(client: KeyedCallClient): Promise<void> {
  if (state.phase !== "unasked") return;
  publish({ phase: "reading" });
  const left = await readLeft(client);
  let saved: string[] = [];
  try {
    saved = savedPaneSessionIds(localStorage.getItem(DECK_STORAGE_KEY));
  } catch {
    saved = []; // a page with no storage has no layout, which is an answer
  }
  let live: ReadonlySet<string> | null = null;
  if (saved.length > 0) {
    const sessions = await refreshTerminalRoster(godviewColdOpen);
    if (terminalPoolSnapshot().rosterState === "observed") {
      live = new Set(
        sessions
          .filter((session) => session.health !== "exited")
          .map((session) => session.sessionId),
      );
    } else {
      logger().info(
        "renderer.godview.restore_roster_unreadable",
        "The roster could not be read for the restore check; mounting without it",
        { state: terminalPoolSnapshot().rosterState },
      );
    }
  }
  const question = composeLastRun(left, saved, live);
  if (question === null) {
    // nothing to bring back: a picture fieldd still holds (bare shells alone)
    // is let go, so the next launch does not ask about it either
    if (left?.state === "left") await forget(client);
    publish({ phase: "answered", rehydrate: false });
    return;
  }
  publish({ phase: "asking", question });
}

async function readLeft(client: KeyedCallClient): Promise<AgentLastRunResult | null> {
  const started = Date.now();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return AgentLastRunResult.parse(await client.request("agent.lastRun", {}));
    } catch (cause) {
      const wait = READ_RETRY_MS[Math.min(attempt, READ_RETRY_MS.length - 1)] ?? 2_000;
      if (askAgain(cause) && Date.now() - started + wait < LAST_RUN_READ_MS) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      // an older fieldd without the door, or one that would not say: the
      // deck's own layout still asks
      logger().info(
        "renderer.godview.last_run_unread",
        "What the last run left could not be read; asking from the deck's layout alone",
        { error: cause instanceof Error ? cause.message : String(cause) },
      );
      return null;
    }
  }
}

/** Ask again for a refusal that says so (`retryable` — the door is starting)
 * and for a call that never reached a door at all (the window's connection is
 * still coming up at a cold launch). A refusal that does not invite a retry —
 * an older fieldd without the door, a principal refused — and an answer that
 * does not parse are answers. */
function askAgain(cause: unknown): boolean {
  if (cause === null || typeof cause !== "object") return false;
  const { retryable, kind, name } = cause as {
    retryable?: unknown;
    kind?: unknown;
    name?: unknown;
  };
  if (retryable === true) return true;
  return typeof kind !== "string" && name !== "ZodError";
}

/** Restore: every agent resumed into its own conversation, at once; the
 * deck's other dead panes reopened by its rehydration once it mounts. */
export async function restoreLastRun(client: KeyedCallClient): Promise<void> {
  if (state.phase !== "asking") return;
  const question = state.question;
  publish({ phase: "restoring", question });
  const outcomes = await Promise.all(
    question.agents.map(async (agent): Promise<LastRunFailure | null> => {
      try {
        const answered = await requestResolvingOutcome(client, "agent.resume", {
          runtimeRunId: agent.id,
        });
        const born = adoptCreatedTerminal(AgentSpawnResult.parse(answered).terminal);
        if (agent.sessionId !== undefined) resumedPanes.set(agent.sessionId, born.session);
        return null;
      } catch (cause) {
        logger().error(
          "renderer.godview.last_run_resume_failed",
          "An agent the last run left could not be resumed",
          cause,
        );
        return { name: agent.name, reason: refusalReason(cause) };
      }
    }),
  );
  await forget(client);
  const failed = outcomes.filter((outcome): outcome is LastRunFailure => outcome !== null);
  publish(
    failed.length === 0
      ? { phase: "answered", rehydrate: true }
      : { phase: "restored", question, resumed: question.agents.length - failed.length, failed },
  );
}

/** Start clean: the deck's layout and fieldd's picture both go. Nothing on the
 * floor is touched — a session still running goes on (GT-D5). */
export async function startCleanLastRun(client: KeyedCallClient): Promise<void> {
  if (state.phase !== "asking") return;
  try {
    localStorage.removeItem(DECK_STORAGE_KEY);
  } catch (cause) {
    logger().error(
      "renderer.godview.layout_clear_failed",
      "The saved deck layout could not be cleared",
      cause,
    );
  }
  await forget(client);
  publish({ phase: "answered", rehydrate: false });
}

/** The refusals are read; the curtain lifts. */
export function dismissLastRun(): void {
  if (state.phase === "restored") publish({ phase: "answered", rehydrate: true });
}

async function forget(client: KeyedCallClient): Promise<void> {
  try {
    await client.request("agent.lastRunForget", {});
  } catch (cause) {
    // the next launch asks again — the honest cost of an answer fieldd did
    // not hear
    logger().warn(
      "renderer.godview.last_run_forget_failed",
      "fieldd did not hear the answer; the next launch asks again",
      { error: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}

function logger() {
  return getRendererLogger().child({ component: "godview" });
}

/** Tests only: the store as a test needs it. */
export function resetLastRunForTests(
  next: LastRunState = { phase: "unasked" },
  resumed: ReadonlyMap<string, SessionSummary> = new Map(),
): void {
  resumedPanes.clear();
  for (const [id, session] of resumed) resumedPanes.set(id, session);
  publish(next);
}

export type { AgentLastRunGone };
