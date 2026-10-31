// Sizes as Finder counts them (DESIGN.md §9): in thousands — bytes, KB, MB, GB.
// One formatter for every page that says a size: Settings → Terminal's
// scrollback, and the History pane's agents (track AO, AO-3). The frame's
// sentences — a refusal that names a size beside a bound, a card's facts — say
// theirs through `sizeWords`, which chooses its unit after rounding.

/** Bytes as the page says them. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e5) / 10} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} bytes`;
}

/** A size in the frame's words, counted in thousands as Finder counts it
 * (DESIGN.md §9): bytes below a kilobyte, whole KB below a megabyte, then MB
 * and GB to a tenth. `round` says which way — a size beside a bound is rounded
 * up and the bound down, so the two never read as equal; a size alone is
 * rounded to the nearest. The unit is chosen after the rounding: 999,999 bytes
 * rounded up is "1 MB", never "1000 KB". (Moved from `frame/line-door.ts`, the
 * D6 refusal's, for every sentence of the frame that names a size — HN B2.) */
export function sizeWords(bytes: number, round: (value: number) => number = Math.round): string {
  if (bytes < 1_000) return bytes === 1 ? "1 byte" : `${bytes} bytes`;
  const kb = round(bytes / 1_000);
  if (kb < 1_000) return `${kb} KB`;
  const mb = round(bytes / 100_000) / 10;
  if (mb < 1_000) return `${mb} MB`;
  return `${round(bytes / 100_000_000) / 10} GB`;
}
