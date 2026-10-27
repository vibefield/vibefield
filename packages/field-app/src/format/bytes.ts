// Sizes as Finder counts them (DESIGN.md §9): in thousands — bytes, KB, MB, GB.
// One formatter for every page that says a size: Settings → Terminal's
// scrollback, and the History pane's agents (track AO, AO-3).

/** Bytes as the page says them. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e5) / 10} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} bytes`;
}
