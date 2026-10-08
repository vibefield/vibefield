// PJ-1 — what the OWNER says a place is (`build-pj.md` L6;
// `thinking-project-places.md` PJ-L4, §4.2). The device knows its home, its
// temporary roots and the agent catalog's task roots, so it — not the engine —
// names a place's kind, and no home path rides the device roster. The rules
// are the prototype's `kindOf` (`draft/project-places/grouping.js`) less its
// git half, which the engine reads from the facts: a checkout in a temp folder
// with an identity remote still belongs to its repository.
//
// Pure: the caller passes the home and the task roots (`AGENT_CATALOG`'s
// `taskRoots`, PJ-D21 — never a path pattern of the engine's, AR-L1).
import type { PlaceKind } from "@vibefield/contracts";

/** The system temporary roots (macOS `/tmp`, `/private/tmp`, `/var/folders`;
 * Windows `AppData\Local\Temp`), compared on `/`-separated paths. */
const TEMP_ROOTS = [
  /^\/(private\/)?tmp(\/|$)/,
  /^\/(private\/)?var\/folders\//,
  /\/AppData\/Local\/Temp(\/|$)/i,
];

/** `/`-separated, no trailing slash; the root stays `/`. */
export function slashPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

function globToRegExp(glob: string): RegExp {
  const parts = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join("[^/]+")}$`);
}

export interface PlaceOwner {
  /** the device's home folder, as its paths spell it */
  readonly home: string;
  /** the agent catalog's task roots: `~` is the home, `*` one folder */
  readonly taskRoots?: readonly string[];
}

/** `home` (the home itself, `/`, a bare drive root) › `task` › `temp` ›
 * `project`. A folder deeper than home is never home (§12 risk 4). */
export function placeKindOf(path: string, owner: PlaceOwner): PlaceKind {
  const p = slashPath(path);
  const home = slashPath(owner.home);
  if (p.toLowerCase() === home.toLowerCase() || p === "/" || /^[A-Za-z]:$/.test(p)) return "home";
  const task = (owner.taskRoots ?? []).some((root) =>
    globToRegExp(slashPath(root.replace(/^~/, home))).test(p),
  );
  if (task) return "task";
  return TEMP_ROOTS.some((root) => root.test(p)) ? "temp" : "project";
}

/** The path below home as spelled (`Projects/app`), or undefined when the
 * place is not under home. */
export function homeRelativeOf(path: string, home: string): string | undefined {
  const p = slashPath(path);
  const h = slashPath(home);
  return p.toLowerCase().startsWith(`${h.toLowerCase()}/`) ? p.slice(h.length + 1) : undefined;
}
