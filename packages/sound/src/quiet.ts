/**
 * Quiet's clock (SD-D22; DESIGN.md §14 "Quiet"): for an hour, or until 8:00 the next morning by this Mac's clock.
 * Quiet is a moment it ends at, in epoch milliseconds, so it ends by itself and every desktop that reads it agrees.
 */

export const QUIET = {
  /** "For an hour". */
  HOUR_MS: 3_600_000,
  /** "Until tomorrow": this hour of the next calendar day, local time. */
  MORNING_HOUR: 8,
} as const;

/** When a Quiet chosen now ends, in epoch milliseconds. */
export function quietEnd(kind: "hour" | "tomorrow", now: Date): number {
  if (kind === "hour") return now.getTime() + QUIET.HOUR_MS;
  const end = new Date(now.getTime());
  end.setDate(end.getDate() + 1);
  end.setHours(QUIET.MORNING_HOUR, 0, 0, 0);
  return end.getTime();
}

/** Whether Quiet holds at `now`: until its moment, never at or after it. */
export function isQuiet(until: number | undefined, now: number): boolean {
  return until !== undefined && now < until;
}
