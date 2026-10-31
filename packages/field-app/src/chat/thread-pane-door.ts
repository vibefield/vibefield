import type { SparkId } from "@vibefield/contracts";

// WHAT THE THREAD'S PANE LENDS CHAT (SP-1d; DESIGN.md §8 "Chat's thread", "Chat's composer"). The pane is mounted deep
// in the thread's column and Send (the composer, beside it) is the act that pastes into it, so the pane publishes how
// it stands and its door, per spark, and Send reads them. A module store, after the line door's shape
// (`frame/line-door.ts`, GT-D17): verbs and plain facts only — no runtime, no surface, no session object crosses.

/** How long a spark's pane is waited for: being found, while the floor is read or fieldd has not named the spark's
 * terminal yet (just after a hatch or a wake), and by Send, for a spark it woke to be heard and its pane to appear
 * (DESIGN.md §8 "Chat's thread": "It waits up to 20 s"; "Chat's composer": "waits up to 20 s"). */
export const SPARK_WAKE_WAIT_MS = 20_000;

/** Where the thread's pane stands: being found, not on this desktop's floor, not found for a fault (a floor that did
 * not answer, terminals that could not start), in a window with no terminals, or live. Never a blank. */
export type SparkPaneState = "finding" | "gone" | "fault" | "no-terminals" | "live";

/** The pane's place while there is no pane to draw; a fault carries why, in the floor's or the window's own words. */
export type SparkPanePlace =
  | { readonly state: "finding" | "gone" | "no-terminals" }
  | { readonly state: "fault"; readonly reason: string };

/** The live pane's verbs, for Send. */
export interface SparkPaneDoor {
  /** True once the session's routed input takes input, false after `timeoutMs` (the runtime's announcement, bounded,
   * never a poll). */
  whenInputOpen(timeoutMs: number): Promise<boolean>;
  /** The road ⌘V takes (`terminal/paste-road.ts`): the pane takes the keyboard, and so the session's size, before the
   * text is pasted, with Return never pressed. False, handing nothing over, while the session's input is closed. */
  paste(text: string): boolean;
}

/** What a spark's thread pane says of itself: its place while there is no pane, or its door while it is live. */
export type SparkPaneReport =
  | (SparkPanePlace & { readonly door: null })
  | { readonly state: "live"; readonly door: SparkPaneDoor };

const reports = new Map<SparkId, SparkPaneReport>();
const hearers = new Set<() => void>();

/** The pane of `spark`'s thread says how it stands while Chat shows it, and `null` when it goes. */
export function publishSparkPane(spark: SparkId, report: SparkPaneReport | null): void {
  if (report === null) reports.delete(spark);
  else reports.set(spark, report);
  for (const hear of hearers) hear();
}

/** How `spark`'s thread pane stands now, or null while no pane of its thread is on screen (asleep, not started, or
 * Chat not the view). */
export function sparkPaneOf(spark: SparkId): SparkPaneReport | null {
  return reports.get(spark) ?? null;
}

/** For Send (DESIGN.md §8 "Chat's composer"): `spark`'s thread pane once it has settled — live, or a place that says
 * why there is none (not on this floor, a fault, no terminals) — heard as it is published, never polled. After
 * `timeoutMs` it answers how the pane stands then: still being found, or null while none of its thread is on screen
 * (Chat left, or another thread shown, before its pane settled: Send says the thread was left). */
export function whenSparkPane(spark: SparkId, timeoutMs: number): Promise<SparkPaneReport | null> {
  const settled = (): SparkPaneReport | null => {
    const report = sparkPaneOf(spark);
    return report === null || report.state === "finding" ? null : report;
  };
  const now = settled();
  if (now !== null) return Promise.resolve(now);
  return new Promise((resolve) => {
    const hear = (): void => {
      const report = settled();
      if (report === null) return;
      clearTimeout(timer);
      hearers.delete(hear);
      resolve(report);
    };
    const timer = setTimeout(() => {
      hearers.delete(hear);
      resolve(sparkPaneOf(spark));
    }, timeoutMs);
    hearers.add(hear);
  });
}
