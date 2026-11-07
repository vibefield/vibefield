/** How many live harness iframes may exist at once. */
export const MAX_LIVE_MOUNTS = 2;

/**
 * Keep near, already mounted slots first, then fill up to max in document order.
 * Slots that are not near are not mounted. This does not remove their headings.
 */
export function chooseMounts(entries, max = MAX_LIVE_MOUNTS) {
  const limit = Math.max(0, max);
  const chosen = [];
  const seen = new Set();
  const take = (entry) => {
    if (!entry?.near || seen.has(entry.id) || chosen.length >= limit) return;
    seen.add(entry.id);
    chosen.push(entry.id);
  };
  for (const entry of entries) {
    if (entry?.active) take(entry);
  }
  for (const entry of entries) take(entry);
  return new Set(chosen);
}
