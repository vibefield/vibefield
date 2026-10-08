// PJ-1 — what the OWNER says a place is (`build-pj.md` L6;
// `thinking-project-places.md` PJ-L4, §4.2). The device knows its home, its
// temporary roots and the agent catalog's task roots, so it — not the engine —
// names a place's kind, and no home path rides the device roster. The rules
// are the prototype's `kindOf` (`draft/project-places/grouping.js`) less its
// git half, which the engine reads from the facts: a checkout in a temp folder
// with an identity remote still belongs to its repository.
//
// Pure: the caller passes the home and the task roots (`AGENT_CATALOG`'s
// `taskRoots`, PJ-D21 — never a path pattern of the engine's, AR-L1), and the
// volume's case rule. M1 (2026-10-08, the lead's ruling on the pj1a/pj1b
// overlap): this is the ONE kind rule — the files worker's place facts call
// it too — and it departs from the prototype twice: a task root matches AT OR
// BELOW the folder its glob names, and case is folded only on a caseless
// volume (default caseless, so the corpus reads as before: its two task
// places sit at the glob's depth and every device is caseless).
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

/** A task root's glob as a test of a place AT OR BELOW a folder it names:
 * `*` is one whole folder name; a session that went into a task folder's
 * subfolder is still the task (M1, 2026-10-08). */
function globToRegExp(glob: string, caseless: boolean): RegExp {
  const parts = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join("[^/]+")}(?:/|$)`, caseless ? "i" : "");
}

export interface PlaceOwner {
  /** the device's home folder, as its paths spell it */
  readonly home: string;
  /** the agent catalog's task roots: `~` is the home, `*` one folder */
  readonly taskRoots?: readonly string[];
  /** the place's volume compares paths without case (APFS's and NTFS's
   * default; the files worker probes it per volume). Home, a task root and a
   * temporary root are then matched without case; on a case-sensitive volume
   * `/Users/A` is not `/users/a`. Absent: caseless. */
  readonly caseless?: boolean;
  /** the temporary roots, as `/`-separated paths, IN PLACE OF the system's
   * own (a test's seam: its fixtures live under the system's temp folder) */
  readonly temps?: readonly string[];
}

/** `home` (the home itself, `/`, a bare drive root) › `task` (at or below a
 * catalog task root) › `temp` › `project`. A folder deeper than home is never
 * home (§12 risk 4). */
export function placeKindOf(path: string, owner: PlaceOwner): PlaceKind {
  const caseless = owner.caseless !== false;
  const fold = (text: string): string => (caseless ? text.toLowerCase() : text);
  const p = slashPath(path);
  const home = slashPath(owner.home);
  if (fold(p) === fold(home) || p === "/" || /^[A-Za-z]:$/.test(p)) return "home";
  const task = (owner.taskRoots ?? []).some((root) =>
    globToRegExp(slashPath(root.replace(/^~/, home)), caseless).test(p),
  );
  if (task) return "task";
  const temp =
    owner.temps !== undefined
      ? owner.temps.some((root) => {
          const r = fold(slashPath(root));
          return fold(p) === r || fold(p).startsWith(`${r}/`);
        })
      : TEMP_ROOTS.some((root) => root.test(caseless ? p.toLowerCase() : p));
  return temp ? "temp" : "project";
}

/** The path below home as spelled (`Projects/app`), or undefined when the
 * place is not under home — the prefix matched without case unless the
 * volume is known to keep it (`caseless: false`). */
export function homeRelativeOf(path: string, home: string, caseless = true): string | undefined {
  const p = slashPath(path);
  const h = slashPath(home);
  const fold = (text: string): string => (caseless ? text.toLowerCase() : text);
  return fold(p).startsWith(`${fold(h)}/`) ? p.slice(h.length + 1) : undefined;
}
