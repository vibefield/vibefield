import type { AgentModelChoice } from "@vibefield/contracts";
import type { AgentChip } from "./composer-draft";
import {
  type AgentMenuRow,
  agentMenuOf,
  type EffortChoice,
  effortOf,
  type ModelsReading,
} from "./new-spark";

// AN AGENT'S MENU IN CHAT'S COMPOSER (SP-1d; DESIGN.md §8 "Chat's composer", an agent's model and effort; CH-D5 A).
// PURE: an agent's chip, its picker as read, and the row the person points at in; the menu @'s box draws out. It is the
// New spark sheet's agent menu (`agentMenuOf`) for the chip's one agent, the profile on its head when the spark has
// more than one, and Effort under a chosen model that has one. The ONE reading of it: the composer's controller draws
// it, and the catalog's plates draw it over fixtures.

/** A picker's models, once read. */
export const modelsOf = (picker: ModelsReading | undefined): readonly AgentModelChoice[] =>
  picker?.state === "read" ? (picker.answer.catalog?.models ?? []) : [];

/** A model row's id as the menu's hot row names it: "" for Its own model. */
export const menuRowId = (model: string | null): string => model ?? "";

/** An agent chip's menu, as @'s box draws it and the keyboard walks it. */
export interface AgentChipMenu {
  /** its head, Its own model, then its picker's models, or a word in their place */
  readonly rows: readonly AgentMenuRow[];
  /** the chosen model's Effort; none until a model is chosen */
  readonly effort: EffortChoice | undefined;
  /** the hot model row: the one pointed at, else the chip's own model ("" for Its own model) */
  readonly hot: string;
  /** the model rows' ids, top to bottom: where ↑ ↓ stop */
  readonly stops: readonly string[];
  /** the chip's chosen model as its picker lists it, while it lists it */
  readonly model: AgentModelChoice | undefined;
}

/** The menu of `chip`'s agent over `picker`, its hot row `hot` (null: none pointed at yet). */
export function agentChipMenuOf(
  chip: AgentChip,
  picker: ModelsReading | undefined,
  hot: string | null,
): AgentChipMenu {
  const selection = chip.model?.selection;
  const model = modelsOf(picker).find((choice) => choice.id === selection?.modelId);
  const rows = agentMenuOf(
    [{ id: chip.agent, label: chip.label, takes: true }],
    chip.agent,
    picker,
    selection,
    chip.named ? chip.profile.name : undefined,
  );
  return {
    rows,
    effort: effortOf(model, selection),
    hot: hot ?? menuRowId(selection?.modelId ?? null),
    stops: rows.flatMap((row) => (row.kind === "model" ? [menuRowId(row.id)] : [])),
    model,
  };
}
