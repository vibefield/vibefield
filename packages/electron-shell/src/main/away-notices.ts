import { type AgentFieldRow, type FrameView, sessionName } from "@vibefield/contracts";
import type { PlayRequest, VoiceCue } from "@vibefield/sound";

// SD-3 (DESIGN.md §14 "Away"; James, the Heard While Away page, 2026-11-06: Q1 "sound on/off and notification on/off
// are two separate things", then (a); Q2 (a), Q3 (a)) — what the field's voice says while no VibeField window is in
// front, as the OS notices main posts beside the sound. Pure: main's SoundObserver hands it each request the voice
// says away, played or not, and posts what it returns, silent, never in a smoke.
// - One agent: its name as the window names it (contracts' `sessionName`: the field row carries no title, so its
//   agent's label in its folder), then what happened.
// - A Done chord: its number ("3 agents"), then Done. All quiet: "VibeField", then All quiet.
// - A request that speaks for several agents: one notice each, so each asker is named and no plural is invented.
// - A click opens Godview, where the agents are.

/** One notice: its title, its body and the view a click opens. */
export interface AwayNotice {
  readonly title: string;
  readonly body: string;
  readonly opens: FrameView;
}

/** What happened, as the notice's body says it (§14 "Away", Q2 (a)). */
export const AWAY_WORDS: Readonly<Record<Exclude<VoiceCue, "settle">, string>> = {
  done: "Done",
  question: "Has a question",
  approval: "Needs your approval",
  failed: "Stopped: it failed",
};

/** The app's own name, the title of All quiet's notice. */
export const AWAY_APP_TITLE = "VibeField";
export const AWAY_SETTLE_BODY = "All quiet";

/** A field row named as the window names it. */
export const awayNameOf = (row: AgentFieldRow): string =>
  sessionName({ label: row.label, folder: row.project?.name, id: row.runtimeRunId });

/** The notices one request raises away; `nameOf` names an agent by the voice's id, `undefined` when it has gone. */
export function awayNoticesOf(
  request: Pick<PlayRequest, "cue" | "ids">,
  nameOf: (id: string) => string | undefined,
): AwayNotice[] {
  const opens: FrameView = "godview";
  if (request.cue === "settle") return [{ title: AWAY_APP_TITLE, body: AWAY_SETTLE_BODY, opens }];
  const body = AWAY_WORDS[request.cue];
  if (request.cue === "done" && request.ids.length > 1) {
    return [{ title: `${request.ids.length} agents`, body, opens }];
  }
  const notices: AwayNotice[] = [];
  for (const id of request.ids) {
    const title = nameOf(id);
    if (title !== undefined) notices.push({ title, body, opens });
  }
  return notices;
}
