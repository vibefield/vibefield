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
  subscribeTerminalPool,
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
// pane is a new shell in its folder, as before, but one that showed an agent no
// longer gone, which the deck leaves (`agentPaneLeft`, LR, 2026-11-25). START
// CLEAN forgets the deck's layout and fieldd's picture. Either answer lets
// fieldd's picture go. While the question stands it is read again
// (`refreshLastRun`): what is still gone shrinks it, and nothing left lifts it.
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
/** LR, 2026-11-25 — every floor session a picture this window read showed an agent in. Kept
 * across reads: fieldd lets its picture go once nothing is gone, and a later read holds none. */
const agentPanes = new Set<string>();
/** of those, the panes whose agent the question does not resume (`agentPaneLeft`) */
const leftAgentPanes = new Set<string>();
/** LR (mend), 2026-11-25 — reads again begun, so the latest stands: an earlier one that lands
 * after it is let go */
let readsBegun = 0;

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

/** LR, 2026-11-25 — a pane the picture showed an AGENT in, whose agent is not coming back (it was
 * resumed elsewhere, it ended, or it left no record to resume): the deck's rehydration leaves it,
 * so no bare shell is born where an agent was. An agent the restore resumes is not one; nor is one
 * it tried and could not. */
export function agentPaneLeft(sessionId: string): boolean {
  return leftAgentPanes.has(sessionId);
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

/** The floor sessions the picture shows an agent in: every row that is not a bare terminal, as
 * fieldd tells the two apart (`agent-last-run.ts`), whether or not that agent is still gone. */
function pictureAgentPanes(left: AgentLastRunResult | null): string[] {
  if (left?.state !== "left") return [];
  return left.board.rows
    .filter((row) => row.kind !== "terminal")
    .flatMap((row) => row.terminal?.runtimeSessionId ?? []);
}

/** The question, as arithmetic: fieldd's gone rows and the deck's dead panes.
 * Null when nothing a restore could bring back was lost. `known` is the agents'
 * panes earlier reads saw (LR, 2026-11-25). */
export function composeLastRun(
  left: AgentLastRunResult | null,
  saved: readonly string[],
  live: ReadonlySet<string> | null,
  known: ReadonlySet<string> = new Set(),
): LastRunQuestion | null {
  const picture = left?.state === "left" ? left : null;
  const gone = picture?.gone ?? [];
  const rows = new Map((picture?.board.rows ?? []).map((row) => [row.runtimeRunId, row]));
  const agents = gone
    .filter((row) => row.kind === "agent")
    .map((row) => ({ id: row.id, sessionId: row.sessionId, name: nameOf(rows.get(row.id)) }));
  // LR, 2026-11-25 — an agent's pane is never a terminal: one whose agent is no longer gone
  // (resumed elsewhere, or ended) is not a shell a restore reopens
  const agentSessions = new Set([
    ...agents.flatMap((agent) => agent.sessionId ?? []),
    ...pictureAgentPanes(left),
    ...known,
  ]);
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
  // at launch a layout or roster that cannot be read says nothing is dead (GT-3's rule)
  const { question, panes } = await questionOf(left);
  holdLeftPanes(question, panes);
  if (question === null) {
    await nothingToAsk(client, left);
    return;
  }
  publish({ phase: "asking", question });
}

/** LR, 2026-11-25 — the question read again while it stands: what is still gone, as Godview opens
 * onto it and as the window's roster moves. One read, never a retry; a read fieldd does not
 * answer keeps the question, and one that lands after the person answered, or after a later read
 * began, is dropped. A layout or roster this read could not read keeps the question too: GT-3's
 * "nothing is dead" is the launch's rule, and would unsay terminals the person was told (LR
 * (mend), 2026-11-25). Nothing left to ask lifts the curtain as a launch with nothing to ask does.
 * The picture the person is answering about stays: the still board and its moment. */
export async function refreshLastRun(client: KeyedCallClient): Promise<void> {
  if (state.phase !== "asking") return;
  readsBegun += 1;
  const read = readsBegun;
  let left: AgentLastRunResult;
  try {
    left = AgentLastRunResult.parse(await client.request("agent.lastRun", {}));
  } catch (cause) {
    rereadFailed(cause instanceof Error ? cause.message : String(cause));
    return;
  }
  if (state.phase !== "asking" || read !== readsBegun) return;
  const { question, panes, unread } = await questionOf(left);
  if (state.phase !== "asking" || read !== readsBegun) return;
  if (unread !== null) {
    rereadFailed(unread);
    return;
  }
  holdLeftPanes(question, panes);
  if (question === null) {
    await nothingToAsk(client, left);
    return;
  }
  const standing = state.question;
  const kept =
    standing.board !== undefined
      ? { ...question, asOf: standing.asOf, board: standing.board }
      : question;
  if (!sameQuestion(standing, kept)) publish({ phase: "asking", question: kept });
}

function rereadFailed(error: string): void {
  logger().info(
    "renderer.godview.last_run_reread_failed",
    "What the last run left could not be read again; the question stands",
    { error },
  );
}

/** LR, 2026-11-25 — the trailing wait before the standing question is read again: a burst of
 * births (a crew) is one read. */
const LAST_RUN_REREAD_MS = 500;

/** What of the window's roster can move the question: its state and its live sessions. A read
 * that finds the same floor changes nothing, so the question's own roster read asks no more. */
function rosterKey(): string {
  const pool = terminalPoolSnapshot();
  const live = pool.roster
    .filter((item) => item.health !== "exited")
    .map((item) => item.sessionId)
    .sort();
  return `${pool.rosterState} ${live.join(" ")}`;
}

/** Read the standing question again on each change of the window's roster, and once as Godview
 * opens onto it (`now`): after a trailing wait, one read at a time, a change during a read read
 * once more after it. The stop it returns cancels the wait (the overlay's, as the question is
 * answered or the overlay leaves). */
export function rereadLastRun(read: () => Promise<void>, now: boolean): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reading = false;
  let again = false;
  let stopped = false;
  let seen = rosterKey();
  const schedule = (): void => {
    if (stopped) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void run(), LAST_RUN_REREAD_MS);
  };
  const run = async (): Promise<void> => {
    timer = undefined;
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    await read().catch(() => undefined);
    reading = false;
    if (again) {
      again = false;
      schedule();
    }
  };
  const unsubscribe = subscribeTerminalPool(() => {
    const key = rosterKey();
    if (key === seen) return;
    seen = key;
    schedule();
  });
  if (now) schedule();
  return () => {
    stopped = true;
    unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** The question both reads put: fieldd's picture, then the deck's layout against the roster. With
 * it, the picture's agent panes (kept only once the question is taken, `holdLeftPanes`) and what
 * could not be read, if anything (`unread`): the layout, or the roster's state. */
async function questionOf(left: AgentLastRunResult | null): Promise<{
  question: LastRunQuestion | null;
  panes: readonly string[];
  unread: string | null;
}> {
  const panes = pictureAgentPanes(left);
  let unread: string | null = null;
  let saved: string[] = [];
  try {
    saved = savedPaneSessionIds(localStorage.getItem(DECK_STORAGE_KEY));
  } catch {
    saved = []; // a page with no storage has no layout, which is an answer at launch
    unread = "the deck's layout";
  }
  let live: ReadonlySet<string> | null = null;
  if (saved.length > 0) {
    const sessions = await refreshTerminalRoster(godviewColdOpen);
    const rosterState = terminalPoolSnapshot().rosterState;
    if (rosterState === "observed") {
      live = new Set(
        sessions
          .filter((session) => session.health !== "exited")
          .map((session) => session.sessionId),
      );
    } else {
      unread = `the roster, ${rosterState}`;
      logger().info(
        "renderer.godview.restore_roster_unreadable",
        "The roster could not be read for the restore check; mounting without it",
        { state: rosterState },
      );
    }
  }
  const known = new Set([...agentPanes, ...panes]);
  return { question: composeLastRun(left, saved, live, known), panes, unread };
}

/** The question taken: the picture's agent panes join those earlier reads saw, and the ones it
 * does not resume are the ones the deck leaves. */
function holdLeftPanes(question: LastRunQuestion | null, panes: readonly string[]): void {
  for (const id of panes) agentPanes.add(id);
  const resumes = new Set(question?.agents.flatMap((agent) => agent.sessionId ?? []) ?? []);
  leftAgentPanes.clear();
  for (const id of agentPanes) if (!resumes.has(id)) leftAgentPanes.add(id);
}

/** Nothing to bring back: the deck mounts unarmed, and a picture fieldd still holds (bare shells
 * alone) is let go, so the next launch does not ask about it either. Answered before fieldd is
 * told (LR (mend), 2026-11-25): a curtain still drawn while the forget is heard could be answered
 * on a question that is no longer true. A forget fieldd does not hear only asks again next launch. */
async function nothingToAsk(
  client: KeyedCallClient,
  left: AgentLastRunResult | null,
): Promise<void> {
  publish({ phase: "answered", rehydrate: false });
  if (left?.state === "left") await forget(client);
}

/** The same agents to resume and the same numbers: a read again that changed nothing publishes
 * nothing, so the curtain and its still picture do not move. */
function sameQuestion(was: LastRunQuestion, now: LastRunQuestion): boolean {
  const ids = (question: LastRunQuestion) =>
    JSON.stringify(question.agents.map((agent) => [agent.id, agent.sessionId ?? null]));
  return was.shells === now.shells && was.unplaced === now.unplaced && ids(was) === ids(now);
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
        // item 468 (2026-11-18): the pane that showed the old session takes the new one (the
        // rehydration's hand-over), so the birth names it, as item 464's hand-offs do, and other
        // screens draw the two as one body. fieldd keeps the claim only while its floor still
        // lists that session; a floor that restarted drops it with one line, and the resume goes
        // on as without it.
        const answered = await requestResolvingOutcome(client, "agent.resume", {
          runtimeRunId: agent.id,
          ...(agent.sessionId !== undefined ? { succeeds: agent.sessionId } : {}),
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
  agentPanes.clear();
  leftAgentPanes.clear();
  readsBegun += 1; // a read in flight across a reset lands on nothing
  publish(next);
}

export type { AgentLastRunGone };
