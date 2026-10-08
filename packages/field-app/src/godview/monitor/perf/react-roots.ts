// EVERY REACT ROOT'S COMMITS (MV-3c; build-mv M33) — the reader half.
//
// MV-2's A/B run found the harness blind to a view in its OWN React root: the
// view host's legacy bridge mounts each view with its own `createRoot`, and a
// counter around the view in the host's root sees none of that root's work. So
// the Electron lab installs a minimal React DevTools global hook before any
// page script runs (`electron-shell/src/testing/react-commit-hook.ts`, over CDP
// — React's own injection point; the app is unchanged). React calls it on every
// commit of EVERY root of every renderer it loads; it keeps one cumulative
// record per root (its container named, commits, and the summed
// `actualDuration` of the committed root: the time React spent rendering that
// tree this pass). `actualDuration` exists only in React's profiling and
// development builds, so a production build reads `timed: false` and counts
// commits alone; the lab's runner builds with `VF_REACT_PROFILING=1`.
//
// The probe takes differences between its reset and its report.

/** One root, cumulative over the page's life. */
export interface ReactRootRecord {
  id: number;
  /** the root's container, `tag#id.firstClass` */
  label: string;
  commits: number;
  renderMs: number;
}

/** What the hook publishes as `window.__vfReactCommits`. */
export interface ReactCommitLedger {
  records: ReactRootRecord[];
  /** whether committed roots carry `actualDuration` (null before a commit) */
  timed(): boolean | null;
  /** renderers that injected (one per react-dom copy) */
  renderers(): number;
}

declare global {
  interface Window {
    __vfReactCommits?: ReactCommitLedger;
  }
}

export interface ReactRootsReport {
  /** the hook was installed before React loaded */
  hooked: boolean;
  renderers: number;
  timed: boolean | null;
  /** every root's commits in the window, summed */
  commits: number;
  /** every root's render time in the window, summed (0 when untimed) */
  renderMs: number;
  roots: ReactRootRecord[];
}

export type ReactRootsBase = ReadonlyMap<number, { commits: number; renderMs: number }>;

function ledger(): ReactCommitLedger | undefined {
  return typeof window === "undefined" ? undefined : window.__vfReactCommits;
}

/** The cumulative counters now: a window's base. */
export function reactRootsBase(): ReactRootsBase {
  return new Map(
    (ledger()?.records ?? []).map((record) => [
      record.id,
      { commits: record.commits, renderMs: record.renderMs },
    ]),
  );
}

/** Every root's work since `base` (a root first seen since starts at zero). */
export function reactRootsSince(base: ReactRootsBase): ReactRootsReport {
  const held = ledger();
  if (held === undefined) {
    return { hooked: false, renderers: 0, timed: null, commits: 0, renderMs: 0, roots: [] };
  }
  const roots: ReactRootRecord[] = [];
  for (const record of held.records) {
    const before = base.get(record.id) ?? { commits: 0, renderMs: 0 };
    const commits = record.commits - before.commits;
    if (commits === 0) continue;
    roots.push({
      id: record.id,
      label: record.label,
      commits,
      renderMs: record.renderMs - before.renderMs,
    });
  }
  return {
    hooked: true,
    renderers: held.renderers(),
    timed: held.timed(),
    commits: roots.reduce((total, root) => total + root.commits, 0),
    renderMs: roots.reduce((total, root) => total + root.renderMs, 0),
    roots,
  };
}
