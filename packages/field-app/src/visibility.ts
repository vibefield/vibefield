// PF6 (design-03 §4.7) — visibility silences the SOURCE, not the sink. This is
// the renderer's one visibility seam: optional work (thumbnail capture,
// post-reveal previews) subscribes here and pauses at its source; refocus
// recovers from daemon-owned truth (P5), never a hidden backlog.
//
// THE EXEMPTION (ESR §5.4.5): the persistence path — DocManager, doc lanes,
// autosave — must NEVER consult this module. A dirty document reaches the
// daemon regardless of visibility; persistence-exemption.test.ts enforces
// that structurally and behaviorally.

export function isHidden(): boolean {
  return typeof document !== "undefined" && document.hidden === true;
}

export function onVisibilityChange(fn: (hidden: boolean) => void): () => void {
  if (typeof document === "undefined") return () => {};
  const listener = (): void => fn(document.hidden === true);
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}
