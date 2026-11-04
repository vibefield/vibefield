import type { PhoneViewGolden, PhoneViewInput, PhoneWindowStep } from "./phone-goldens";

/**
 * PG-5 — THE LIST VIEW'S GOLDEN: what puppeteer-views' list draws over the window's rows at every step of the witness
 * run, which the phone's list (`apps/ios/VibeFieldKit/Sources/FieldHome/Godview/List/`) is held to through the kit's
 * byte-identical copy (`Tests/FieldHomeTests/Fixtures/phone-list.golden.json`).
 *
 * SKELETON (PG-5 (red)): every drawn step records nothing yet.
 */

/** What the list's section says from its input: the count, whether every row recedes, and its two parameters as the
 * properties it sets on itself (`--mv-list-row-height`, `--mv-list-project-width`). */
export interface ListSection {
  count: string;
  allReceded: boolean;
  rowHeight: string;
  projectWidth: string;
}

/** The agent column: an agent's mark (`svg` for a drawn path, else the letter it wears), model and account; a peer
 * terminal's host chip; a home terminal's word. */
export type ListAgentCell =
  | { mark: string; model: string; account: string | null }
  | { host: string }
  | { terminal: string };

/** One drawn row, as the DOM says it: its id (the view's own `select`), its flags (the row's classes and
 * `aria-current`), its cells' texts and its label. */
export interface ListRowRecord {
  id: string;
  status: string;
  active: boolean;
  stale: boolean;
  linked: boolean;
  remote: boolean;
  receded: boolean;
  current: boolean;
  project: string;
  branch: string | null;
  agent: ListAgentCell;
  detail: string;
  context: string;
  label: string;
}

export interface ListStep {
  at: PhoneWindowStep["at"];
  frame?: PhoneWindowStep["frame"];
  gap?: true;
  section?: ListSection;
  toolbar?: string;
  empty?: { title: string; hint: string } | null;
  rows?: ListRowRecord[];
}

const NOTE =
  "PG-5 — the phone's list view golden: puppeteer-views' list as it draws the window's rows of phone-fold.golden.json at every step (skeleton). Never edit by hand; a regeneration is a re-bless, said in its commit, and never over a defect.";

/** The steps: one per window step, the gap's recorded as a gap. */
export async function listSteps(input: PhoneViewInput): Promise<ListStep[]> {
  return input.steps.map((step) => ({
    at: step.at,
    ...(step.frame === undefined ? {} : { frame: step.frame }),
    ...(step.gap === true ? { gap: true as const } : { rows: [] }),
  }));
}

export const golden: PhoneViewGolden = { note: NOTE, compute: listSteps };
