import {
  type SetupLedger,
  type SetupMomentKey,
  type SetupStep,
  type SetupStepState,
  type SetupTutorialRecord,
  setupStepState,
  setupTutorialRecord,
  type TutorialChapter,
} from "@vibefield/contracts/setup";
import type { GlyphName } from "@vibefield/design-kit/glyphs";
import type { FielddClient } from "@vibefield/fieldd-client";
import { useSubscription } from "@vibefield/fieldd-client/react";

// The Setup Assistant's ledger, as a window reads and writes it (track AO, AO-2;
// fieldd's `setup.*`, contracts setup.ts). The wizard answers its steps here;
// Settings' "Finish setting up" lists the ones put off (AO-D10, DESIGN.md §8).

/** The ledger while the daemon answers; null while it is read, or from a
 * daemon that predates `setup.subscribe` — never a guess at what was answered. */
export function useSetupLedger(): SetupLedger | null {
  const ledger = useSubscription<SetupLedger>("setup.subscribe");
  return ledger.status === "live" ? (ledger.data ?? null) : null;
}

/** Record one step's answer (declarative — the same answer twice is written
 * once). Callers move on whatever it says: a refused write is the ledger's
 * loss, never the person's, because every step still lives on its page. */
export async function answerSetupStep(
  client: FielddClient,
  step: SetupStep,
  state: SetupStepState,
): Promise<void> {
  await client.request("setup.answer", { step, state });
}

/** AO-6b (AO-D15) — a new agent with a past, one moment per agent (its catalog id). */
export function agentPastMoment(agent: string): SetupMomentKey {
  return `agent-past:${agent}`;
}

/** Retire one moment for good: Not now, or its act done (declarative — the
 * same answer twice is written once). A refused write is the ledger's loss,
 * never the person's: the moment may show once more. */
export async function retireSetupMoment(
  client: FielddClient,
  moment: SetupMomentKey,
): Promise<void> {
  await client.request("setup.moment", { moment, state: "retired" });
}

/** SH-1 (track SH; DESIGN.md §8 "Tutorials", "Kept") — a chapter's record; undefined while the
 * ledger has none it can read, or while the ledger itself is not read yet. */
export function tutorialRecord(
  ledger: SetupLedger | null,
  chapter: TutorialChapter,
): SetupTutorialRecord | undefined {
  return ledger === null ? undefined : setupTutorialRecord(ledger, chapter);
}

/** SH-1 — record one chapter's answer; fieldd's table decides what it replaces (an offer never
 * lands on a chapter begun, declined or done). A refused write is the ledger's loss, never the
 * person's: the chapter still waits in Settings → Tutorials. */
export async function recordTutorial(
  client: FielddClient,
  chapter: TutorialChapter,
  answer:
    | { readonly state: "offered" | "declined" | "finished" }
    | { readonly state: "started"; readonly step: number; readonly steps: number },
): Promise<void> {
  await client.request("setup.tutorial", { chapter, ...answer });
}

/** SH-1 — what a window shows of a chapter. "paused" and "left" are never written: a started row
 * is "running" or "paused" while this window runs that chapter, and "left" while none does, so a
 * stale "paused" can never stand behind a crash. */
export type TutorialShown =
  | "none"
  | "offered"
  | "declined"
  | "running"
  | "paused"
  | "left"
  | "finished";

export function tutorialShown(
  record: SetupTutorialRecord | undefined,
  running: { readonly paused: boolean } | null,
): TutorialShown {
  if (record === undefined) return "none";
  if (record.state !== "started") return record.state;
  if (running === null) return "left";
  return running.paused ? "paused" : "running";
}

/** The steps Finish setting up can list, and its sheet ask again: each joins
 * with its slice (Agents and Profiles with AO-5). */
export type FinishStep = Extract<SetupStep, "history" | "devices">;

/** One step Finish setting up lists, with its glyph and its one line. */
export interface FinishSetupRow {
  readonly step: FinishStep;
  readonly glyph: GlyphName;
  readonly label: string;
}

/** What Finish setting up lists (DESIGN.md §8), in the assistant's order: the
 * steps put off, and only while they still are. A step answered elsewhere
 * leaves by itself — Devices the moment a link exists, wherever it was made
 * (agreed with track TS); History once nothing found on this Mac is left to
 * bring in — and a no is never listed. History is also listed, with no row in
 * the ledger, for someone who set up before the chapter existed (AO-D12) or
 * whose census had not answered in time. Nothing while the person has hidden it. */
export function finishSetupRows(
  ledger: SetupLedger | null,
  facts: {
    readonly linked: boolean;
    /** the census found history on this Mac that is not brought in */
    readonly historyToBringIn: boolean;
  },
): readonly FinishSetupRow[] {
  if (ledger === null || ledger.hidden) return [];
  const rows: FinishSetupRow[] = [];
  if (setupStepState(ledger, "history") !== "answered" && facts.historyToBringIn) {
    rows.push({ step: "history", glyph: "history", label: "Bring in your past sessions" });
  }
  if (setupStepState(ledger, "devices") === "later" && !facts.linked) {
    rows.push({ step: "devices", glyph: "mesh", label: "Connect your devices" });
  }
  return rows;
}
