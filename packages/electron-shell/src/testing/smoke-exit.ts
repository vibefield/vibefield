// Item 658 (2026-11-26) — HOW THE PAGES SMOKE LEAVES ELECTRON. One physical run of the row said its
// verdict, tore down, asked Electron to exit, and Electron lived on for fifteen minutes; the runs
// before it ended at once. The product's own quit ends its pages' offscreen windows before it
// exits (its quit flow disposes the live-surface custody); the smokes skip that flow and ask
// Electron to exit with them alive. So this smoke closes them the product's way first (the door's
// `closeSurfaces`, in smoke.ts), and leaves through here:
// - ONE line of counts: what main held before that close, what it holds now;
// - a WATCH: if main still runs when it comes due, Electron did not take the exit. That is said in
//   one line (counts, and what keeps node's loop alive by kind) and main ends ITSELF: that run is
//   then not green by its exit. THE WATCH IS A TIMER ON MAIN'S OWN LOOP (2026-11-27): it fires only
//   while that loop still turns. It has fired on no real run, and whether it would have in the one
//   held run is not known. A hold that stops the loop is ended by the gate's own bound, as before;
// - then the exit, asked for once.
// The close is ONE of the calls the product's quit makes (the custody's disposal, which ends the
// windows); the quit disposes more, which this smoke's teardown does not need.
// The verdict was said before any of this: nothing here changes a leg. No line holds a place, a
// pid or an address. Every dependency is handed in, so the rules are rows on plain stand-ins.

/** How long Electron is given to take the exit before main ends itself: long beside an exit that is
 * only slow (the runs that ended took under a second), short beside a gate's bound. */
export const PAGES_EXIT_HELD_MS = 10_000;

export interface PagesExitDeps {
  /** the windows main still holds, each by whether it is an offscreen one */
  windows(): readonly { readonly offscreen: boolean }[];
  /** how many pages (WebContents) main still holds */
  contents(): number;
  /** what keeps node's loop alive, by kind: node's own list */
  active(): readonly string[];
  say(line: string): void;
  /** Electron's own exit, with the run's code */
  exit(code: number): void;
  /** main ends itself, at once */
  end(): void;
  setTimeout(fn: () => void, ms: number): unknown;
}

/** What main holds, as counts; null for a count that could not be taken, never a zero. */
export interface ExitCensus {
  readonly windows: number | null;
  readonly offscreen: number | null;
  readonly contents: number | null;
}

export function censusAtExit(deps: Pick<PagesExitDeps, "windows" | "contents">): ExitCensus {
  let windows: number | null = null;
  let offscreen: number | null = null;
  let contents: number | null = null;
  try {
    const held = deps.windows();
    windows = held.length;
    offscreen = held.filter((w) => w.offscreen).length;
  } catch {
    // said as not counted
  }
  try {
    contents = deps.contents();
  } catch {
    // said as not counted
  }
  return { windows, offscreen, contents };
}

/** Node's list as kinds and how many of each, in the kinds' own order; null when it could not be read. */
function activeKinds(deps: Pick<PagesExitDeps, "active">): Record<string, number> | null {
  try {
    const kinds: Record<string, number> = {};
    for (const kind of [...deps.active()].sort()) kinds[kind] = (kinds[kind] ?? 0) + 1;
    return kinds;
  } catch {
    return null;
  }
}

/** Says a line; a line that cannot be said stops nothing. */
function said(deps: Pick<PagesExitDeps, "say">, line: string): void {
  try {
    deps.say(line);
  } catch {
    // the exit goes on
  }
}

/** THE EXIT: the line, the watch, then Electron's exit with `code`.
 * `before` is what main held before the pages' surfaces were closed; `surfaces` is what came of that
 * close ("closed", "threw", or "none" when the run never reached it). */
export function exitSaid(
  code: number,
  deps: PagesExitDeps,
  o: { readonly before: ExitCensus; readonly surfaces: "closed" | "threw" | "none" },
): void {
  said(
    deps,
    `SMOKE_PAGES_EXIT ${JSON.stringify({ before: o.before, surfaces: o.surfaces, ...censusAtExit(deps) })}`,
  );
  deps.setTimeout(() => {
    // main still runs: Electron did not take the exit
    said(
      deps,
      `SMOKE_PAGES_EXIT_HELD ${JSON.stringify({
        afterMs: PAGES_EXIT_HELD_MS,
        ...censusAtExit(deps),
        active: activeKinds(deps),
      })}`,
    );
    deps.end();
  }, PAGES_EXIT_HELD_MS);
  deps.exit(code);
}
