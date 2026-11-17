import type { AgentPlanTier } from "@vibefield/contracts";

// DESIGN.md §8 "A plan's tier" — A PLAN'S TIER, AS THE BADGE AFTER ITS NAME. The
// tier is a record beside the plan's family word, read by the namer's sign-in
// (`AgentPlan.account.planTier`), with three cases the contract keeps apart: a label is the
// badge; an empty record is the agent saying the plan has none; no record is a tier not read.
// AR-L1: the label is drawn exactly as given. Nothing here parses it, cases it, compares it to
// a literal or derives it from the plan's name; a family is two plans in view compared value to
// value, never to a word.

/** What one plan's tier record says. */
export type PlanTierRead =
  /** the tier was read: its label, as given ("20x", "200") */
  | { kind: "label"; label: string }
  /** the agent says this plan has no tier */
  | { kind: "none" }
  /** the tier was not read */
  | { kind: "unread" };

/** The contract's three cases. A label the contract would refuse never reaches here (the
 * field reads as not read); an empty one is held the same way, so no capsule holds nothing. */
export function tierOf(tier: AgentPlanTier | undefined): PlanTierRead {
  if (tier === undefined) return { kind: "unread" };
  const label = tier.label;
  if (label === undefined) return { kind: "none" };
  return label.length > 0 ? { kind: "label", label } : { kind: "unread" };
}

/** One plan in view, as the family rule reads it: its service's id, its title, its tier. */
export interface TierRow {
  /** absent for a row that is no plan (an agent on none): it is in no family */
  service?: string | undefined;
  title: string;
  tier?: AgentPlanTier | undefined;
}

/** What stands after a plan's title: the badge, the empty dashed capsule, or nothing. */
export type TierMark = { kind: "badge"; label: string } | { kind: "unread" } | undefined;

/**
 * Each row's mark, in the rows' order. A label is its badge. A tier not read wears the empty
 * dashed capsule only while another row in view of its own family (the same service and the
 * same title, compared value to value) has a label, so a missing badge never reads as the
 * lowest tier; alone, it draws nothing. A plan the agent says has no tier draws nothing, even
 * beside a labelled one.
 */
export function tierMarks(rows: readonly TierRow[]): TierMark[] {
  const reads = rows.map((row) => tierOf(row.tier));
  return rows.map((row, index): TierMark => {
    const read = reads[index];
    if (read === undefined || read.kind === "none") return undefined;
    if (read.kind === "label") return { kind: "badge", label: read.label };
    const service = row.service;
    if (service === undefined) return undefined;
    const family = rows.some(
      (other, at) =>
        at !== index &&
        other.service === service &&
        other.title === row.title &&
        reads[at]?.kind === "label",
    );
    return family ? { kind: "unread" } : undefined;
  });
}

/** The plan's name as a reader hears it: the title and its badge's label as one phrase, joined
 * by a space ("ChatGPT Pro 200"); the title alone otherwise, the empty capsule included, which
 * says nothing aloud. */
export function spokenPlanName(title: string, mark: TierMark): string {
  return mark?.kind === "badge" ? `${title} ${mark.label}` : title;
}

/** The same spoken name from the tier record alone, where words name a plan with no badge drawn
 * beside them (the Bands circle's words for each plan): a label joins the title, anything else
 * leaves the title alone. */
export function spokenPlanTitle(title: string, tier: AgentPlanTier | undefined): string {
  const read = tierOf(tier);
  const mark: TierMark = read.kind === "label" ? { kind: "badge", label: read.label } : undefined;
  return spokenPlanName(title, mark);
}
