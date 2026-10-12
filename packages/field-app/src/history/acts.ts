import { AgentSpawnResult, type ProjectIntentParams } from "@vibefield/contracts";
import type { KeyedCallClient } from "../forwarded-call";
import { requestResolvingOutcome } from "../forwarded-call";
import {
  deckAnswerWithin,
  type JumpOutcome,
  type LineViewDoor,
  lateReason,
  type ResumeOutcome,
  whenGodviewCanPlace,
} from "../frame/line-door";
import { requestView } from "../frame/view-state";
import { refusalReason } from "../godview/launcher-doors";
import { readLiveRun } from "./jump";
import { type ResumeReading, readResume, resumeNative } from "./resume";

// HISTORY'S ACTS (AR-8c's Resume, P3's Jump to, PJ-4's New agent and the
// project's acts). The line's create acts on the room's chosen session; since
// PJ-4 the room also holds acts of its own — a session row's Resume or Jump
// to (R4), ④'s head (R5), ②'s New agent (H6) and the project's acts (H4) —
// pressed on ANY session or project the room draws. They are one set of acts,
// here, over the window's fieldd client: what each asks of fieldd, and how its
// outcome reads. Where the act shows what it did, the window moves to Godview
// and its deck places the session as the swarm's open does (GV-D4: beside the
// focused pane, or in its place with three showing), as the line's Resume
// always has.
//
// An act never ends in silence (2026-10-11; two `smoke:godview` reds where New
// agent started a run, moved the window and said nothing for 60 s). Once fieldd
// has answered, everything that follows is inside the act's own try, and the
// deck's place or reveal is raced against a bound: its mounts wait their turn
// (AR-4b), and a turn that never ends is said ("no pane took it in 20 s") and
// logged (`unplaced`), as a throw is, in its own words. The bound is the
// deck's time, never the person's (W7): while the deck an act called up asks
// whether to restore last time's panes, its clock stands and the line says what
// it waits on (`deckAnswerWithin`).

/** How long an act waits for Godview's deck — mounted on Godview's first
 * open — to be able to place what it started, and then for the deck to place
 * or show it. Twice the deck's own bound on each read of a floor
 * (`TERMINAL_FLOOR_READ_TIMEOUT_MS`), so a mount stuck ahead of the act's own
 * fails as its read ends and the act's still lands inside the bound. */
export const HISTORY_DECK_WAIT_MS = 20_000;

/** What a throw in an act's work comes to, in words: an answer this build
 * cannot read is said as such, never as a schema's dump. */
export function thrownReason(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);
  return cause.name === "ZodError" ? "fieldd's answer could not be read" : cause.message;
}

/** A throw as the log has it: its own message, whole. */
function thrownMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A session as an act names it: the room's selection, or a row's session. */
export interface SessionTarget {
  readonly sessionId: string;
  readonly nativeSessionId: string;
  readonly folder: string | null;
  /** PJ-4 (R4) — the device-qualified key the host gave the row
   * (`hostKeyOf`); absent from a room that was handed none. */
  readonly hostKey?: string | undefined;
}

const HOST_KEY_SEPARATOR = "\u001f";

/** PJ-4 (R4) — a session's host key: the desktop that holds it and its id.
 * The room never reads it; it rides the selection back out, so an act knows
 * WHERE the session is before it acts — and refuses to act here on one that
 * ran on another desktop (it would resume this Mac's same-spelled folder). */
export function hostKeyOf(device: string, sessionId: string): string {
  return `${device}${HOST_KEY_SEPARATOR}${sessionId}`;
}

/** The desktop a host key names, or null for a key this build did not make. */
export function deviceOfHostKey(hostKey: string | undefined): string | null {
  if (hostKey === undefined) return null;
  const cut = hostKey.indexOf(HOST_KEY_SEPARATOR);
  return cut <= 0 ? null : hostKey.slice(0, cut);
}

/** Why an act on `target` cannot run on this desktop, or null. A session
 * another desktop holds is acted on from there until routed acts (DS-2). */
export function elsewhereReason(
  target: Pick<SessionTarget, "hostKey">,
  self: string | null,
  nameOf: (device: string) => string,
): string | null {
  const device = deviceOfHostKey(target.hostKey);
  if (device === null || self === null || device === self) return null;
  return `it ran on ${nameOf(device)} — act there until routed acts (DS-2)`;
}

export interface HistoryActsDeps {
  readonly client: KeyedCallClient;
  /** this desktop's id, as the listing names it (null until known) */
  readonly self: () => string | null;
  /** a desktop's name, for the words */
  readonly nameOf: (device: string) => string;
  /** test seam: the deck the act places in (default: Godview's, once open) */
  readonly deck?: (timeoutMs: number) => Promise<LineViewDoor | null>;
  /** test seam: the view the act moves the window to (default: the frame's) */
  readonly showView?: (view: "godview") => void;
  /** a session's pane did not open: said to the log */
  readonly unplaced?: (what: string, reason?: string) => void;
}

function deckOf(deps: HistoryActsDeps): Promise<LineViewDoor | null> {
  (deps.showView ?? ((view) => void requestView(view)))("godview");
  return (deps.deck ?? whenGodviewCanPlace)(HISTORY_DECK_WAIT_MS);
}

/** Resume `target` in its own agent and show it (the line's Resume, and a
 * row's or ④'s). Never a second run on a running conversation (asked at the
 * press); never a session another desktop holds (R4's host key). `reading`
 * is the line's own reading when it has one; else it is read now. */
export async function resumeTarget(
  deps: HistoryActsDeps,
  target: SessionTarget,
  reading?: ResumeReading | null,
): Promise<ResumeOutcome> {
  const elsewhere = elsewhereReason(target, deps.self(), deps.nameOf);
  if (elsewhere !== null) return { state: "refused", reason: elsewhere };
  if ((await readLiveRun(deps.client, target.nativeSessionId)) !== null)
    return { state: "running" };
  const read = reading ?? (await readResume(deps.client, target));
  if (read.state === "waits") return { state: "refused", reason: read.why };
  const answer = await resumeNative(deps.client, read.facts);
  if (answer.state === "running") return answer;
  if (answer.state === "refused") return answer;
  // it resumed: every end from here is what came of showing it
  try {
    const deck = await deckOf(deps);
    if (deck === null) {
      deps.unplaced?.("resume");
      return { state: "refused", reason: "it resumed, but the deck did not open to show it" };
    }
    const placed = await deckAnswerWithin(deck.place(answer.terminal), HISTORY_DECK_WAIT_MS);
    if (placed.state === "opened")
      return {
        state: "resumed",
        ...(placed.placement !== undefined ? { placement: placed.placement } : {}),
      };
    if (placed.state === "late") {
      const late = lateReason("took", HISTORY_DECK_WAIT_MS);
      deps.unplaced?.("resume", late);
      return { state: "refused", reason: `it resumed, but ${late}` };
    }
    deps.unplaced?.("resume", placed.reason);
    return { state: "refused", reason: `it resumed, but no pane took it (${placed.reason})` };
  } catch (cause) {
    deps.unplaced?.("resume", thrownMessage(cause));
    return { state: "refused", reason: `it resumed, but no pane took it (${thrownReason(cause)})` };
  }
}

/** Show the pane `target` runs in (P3's Jump to; a row's or ④'s). */
export async function jumpTarget(
  deps: HistoryActsDeps,
  target: SessionTarget,
): Promise<JumpOutcome> {
  const elsewhere = elsewhereReason(target, deps.self(), deps.nameOf);
  if (elsewhere !== null) return { state: "refused", reason: elsewhere };
  const run = await readLiveRun(deps.client, target.nativeSessionId);
  if (run === null) return { state: "ended" };
  try {
    const deck = await deckOf(deps);
    if (deck === null) {
      deps.unplaced?.("jump");
      return { state: "refused", reason: "the deck did not open to show it" };
    }
    const shown = await deckAnswerWithin(deck.reveal(run.floorSessionId), HISTORY_DECK_WAIT_MS);
    if (shown.state === "opened") return { state: "jumped" };
    const reason =
      shown.state === "late" ? lateReason("showed", HISTORY_DECK_WAIT_MS) : shown.reason;
    deps.unplaced?.("jump", reason);
    return { state: "refused", reason };
  } catch (cause) {
    deps.unplaced?.("jump", thrownMessage(cause));
    return { state: "refused", reason: thrownReason(cause) };
  }
}

/** What a New agent came to. */
export type NewAgentOutcome =
  | { readonly state: "started"; readonly where: string }
  | { readonly state: "refused"; readonly reason: string };

/** What New agent starts (H6, PJ-L8 until PJ-6's descriptor): the agent (the
 * catalog's id, chosen from `agent.providers` — never a literal, R23), the
 * persona it runs under, and the folder ③ shows. No model and no effort:
 * `agent.spawn` takes neither yet (PJ-6), and the menu says so. */
export interface NewAgentAsk {
  readonly provider: string;
  readonly profileId?: string | undefined;
  readonly cwd: string;
  /** how the folder is said in the note */
  readonly where: string;
}

/** `agent.spawn {provider, cwd, profileId}` into the chosen place (PJ-L5: a
 * place acts — the project never does), then the pane shown in Godview. */
export async function newAgent(deps: HistoryActsDeps, ask: NewAgentAsk): Promise<NewAgentOutcome> {
  let answered: unknown;
  try {
    // DS-D15 — one logical launch: an outcome-unknown is asked once more
    answered = await requestResolvingOutcome(deps.client, "agent.spawn", spawnParamsOf(ask));
  } catch (cause) {
    return { state: "refused", reason: refusalReason(cause) };
  }
  // it started: every end from here is what came of showing it
  try {
    const deck = await deckOf(deps);
    if (deck === null) {
      deps.unplaced?.("spawn");
      return { state: "refused", reason: "it started, but the deck did not open to show it" };
    }
    const placed = await deckAnswerWithin(
      deck.place(AgentSpawnResult.parse(answered).terminal),
      HISTORY_DECK_WAIT_MS,
    );
    if (placed.state === "opened") return { state: "started", where: ask.where };
    if (placed.state === "late") {
      const late = lateReason("took", HISTORY_DECK_WAIT_MS);
      deps.unplaced?.("spawn", late);
      return { state: "refused", reason: `it started, but ${late}` };
    }
    deps.unplaced?.("spawn", placed.reason);
    return { state: "refused", reason: `it started, but no pane took it (${placed.reason})` };
  } catch (cause) {
    deps.unplaced?.("spawn", thrownMessage(cause));
    return { state: "refused", reason: `it started, but no pane took it (${thrownReason(cause)})` };
  }
}

/** `agent.spawn`'s params for an ask: exactly the three things it takes. */
export function spawnParamsOf(ask: NewAgentAsk): Record<string, unknown> {
  return {
    provider: ask.provider,
    cwd: ask.cwd,
    ...(ask.profileId !== undefined ? { profileId: ask.profileId } : {}),
  };
}

/** The words a New agent is said in. */
export function newAgentNote(outcome: NewAgentOutcome): string {
  return outcome.state === "started"
    ? `Started in ${outcome.where}`
    : `Could not start — ${outcome.reason}`;
}

/** What a project's act came to (H4). */
export type IntentOutcome =
  | { readonly state: "done"; readonly key: string }
  | { readonly state: "refused"; readonly reason: string };

/** A refusal of `project.intent`, in a person's words (the doors' reasons). */
function intentRefusal(cause: unknown): string {
  const details =
    typeof cause === "object" && cause !== null
      ? (cause as { details?: Record<string, unknown> }).details
      : undefined;
  switch (details?.["reason"]) {
    case "key-moved":
      return "the project changed while you looked — try again";
    case "not-a-project":
      return "Temporary is not a project";
    case "home":
      return "a desktop's Home stands alone";
    case "only-place":
      return "it is the project's only folder";
    case "same-project":
      return "it is already part of this project";
    case "no-such-place":
      return "that folder is not one of this project's";
    case "no-such-project":
      return "the project is no longer listed";
    default:
      return refusalReason(cause);
  }
}

/** H4 — one act on a project, through `project.intent` (a desktop window's
 * door, P2): rename, pin, hide, split, link, dismiss. */
export async function projectIntent(
  client: KeyedCallClient,
  params: ProjectIntentParams,
): Promise<IntentOutcome> {
  try {
    const answer = (await client.request("project.intent", { ...params })) as { key?: unknown };
    return { state: "done", key: typeof answer?.key === "string" ? answer.key : params.key };
  } catch (cause) {
    return { state: "refused", reason: intentRefusal(cause) };
  }
}

/** The words a project's act is said in on the line: what it did ("Pinned
 * vibe-field"), or what it could not do and why ("Could not pin — …"). A
 * rename's refusal is not said here: the room says it under ②'s name. */
export function intentNote(
  outcome: IntentOutcome,
  words: { readonly done: string; readonly verb: string },
): string {
  return outcome.state === "done" ? words.done : `Could not ${words.verb} — ${outcome.reason}`;
}
