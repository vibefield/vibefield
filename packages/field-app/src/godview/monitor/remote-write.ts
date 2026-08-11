import type { MonitorRemoteFacet } from "./types";

/**
 * HOW A ROW MAY SAY WHO CAN TYPE (GT-D7, GT-D17, and the code review's 2b).
 *
 * What the mesh advertises is one boolean PER HOST — upstream's
 * `allow_tailnet_write || capability.is_some()` — and the per-viewer answer is
 * decided at ATTACH, against the capability this viewer presents. So the only
 * honest pre-attach sentence is a sentence about the host.
 *
 * The words are host-shaped in BOTH directions on purpose. Before this, only a
 * refusing host was marked, and a permitting one was marked by nothing — which
 * on a capability-configured peer meant every row read as writable to a viewer
 * who was about to be read-only. Silence is not neutral beside a mark; a reader
 * learns what its absence means. Two parallel claims leave nothing to infer.
 *
 * The per-viewer truth still arrives, one click later and honestly: the
 * monitor's post-attach announce says whether writes came with the session, and
 * the pane wears the library's own "View only" face.
 */
export function remoteWriteLabel(remote: Pick<MonitorRemoteFacet, "hostWritable">): string {
  return remote.hostWritable ? "writable host" : "read-only host";
}

/** The same fact at length, for the hover that has room for it. */
export function remoteWriteTitle(remote: Pick<MonitorRemoteFacet, "hostWritable">): string {
  return remote.hostWritable
    ? "this host allows writes — whether yours arrive is decided when you attach"
    : "this host shares read-only — no viewer may type here";
}
