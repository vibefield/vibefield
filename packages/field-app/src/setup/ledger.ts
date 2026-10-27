import {
  type SetupLedger,
  type SetupStep,
  type SetupStepState,
  setupStepState,
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
