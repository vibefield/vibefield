import type { SparkStatus } from "@vibefield/design-kit/spark-face";

// Sparks for the catalog (DESIGN.md §2.10): fixed seeds, so every plate deals the same faces. The
// names are the round's; a name never picks a face (NS-D2 B).
export const FIXTURE_SPARKS = [
  { name: "Vela", seed: 7 },
  { name: "Lyra", seed: 4211 },
  { name: "Juno", seed: 90210 },
  { name: "Kiwi", seed: 31337 },
] as const;

/** Framed, by §2.10's surfaces: Chat's row and a thread's head 40, a message's lead 28, a flow's
 * head 26, @'s row 24, Godview's rims and History's rows 20, a chip and a byline 18. */
export const SPARK_FRAMED_LADDER = [40, 28, 26, 24, 20, 18] as const;

/** Free: the New spark sheet's hatch 104, its profile card 64, its own bubble in Godview 20, its
 * agents' panes' chips 16. */
export const SPARK_FREE_LADDER = [104, 64, 20, 16] as const;

/** One stage's live faces, at work as a list would show them. */
export const LIVE_SPARKS: readonly {
  readonly name: string;
  readonly seed: number;
  readonly status: SparkStatus;
}[] = [
  { name: "Vela", seed: 7, status: "thinking" },
  { name: "Lyra", seed: 4211, status: "running" },
  { name: "Juno", seed: 90210, status: "asking" },
  { name: "Kiwi", seed: 31337, status: "sleeping" },
];
