// A time as a tile or a card says it, relative to now (DESIGN.md §9): the
// fields explorer's tiles (the head) and the hand's line of provenance.

/** "2h ago": "just now" under a minute, then minutes, hours and days; a date
 * past a week. */
export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(ms).toLocaleDateString();
}
