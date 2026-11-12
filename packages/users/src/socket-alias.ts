// Item 345 (PLAN-345-r2): the unix alias's keeper, the twin of field-native's `socket_alias::ensure`, run before EVERY
// bind and dial of a socket under a data root.
//
// What it holds: a root over the sun_path line gets ONE short alias, `<parent>/vf-<uid>/<scope>` → its run dir, in a
// folder this uid owns with mode 0700 exactly, under a parent no other account can swap entries in (root's or this
// process's, and sticky if others may write it). Every check reads what it finds without following a link (the
// parent excepted: /tmp is itself a link), and a refusal names what it found. There is no fallback.
//
// What it does NOT hold: the alias folder is the uid's own, so a same-uid process can replace a link there, exactly as
// it can replace a socket in the real run dir today. The alias adds no fence against same-uid code and removes none.
// What answers on a socket is still judged by the bearer tokens, not by the path (EL7).
//
// The refusals' words name the alias's own paths and modes, never the data root or the run dir it points at; they go
// to the log and the plane's unavailable state, and nothing of them is drawn for a person.
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  renameSync,
  type Stats,
  statSync,
  symlinkSync,
} from "node:fs";
import { nativeRunDirFor, SOCKET_ALIAS_PARENT, unixSocketDir } from "@vibefield/contracts";
import { UsersError } from "./errors";

export interface SocketAliasOptions {
  /** The uid the alias folder must belong to: the process's own in the product. A test names another to stand for a
   * folder another account made (it cannot chown without root). */
  readonly uid?: number;
  /** The folder the aliases live in: `/tmp` in the product, the test's own temp dir in a test. */
  readonly parent?: string;
}

function refuse(message: string): never {
  throw new UsersError("socket-alias-refused", message);
}

/** An fs failure's code alone: Node's own message would carry the paths it was given, the run dir among them. */
function errno(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? "an unknown error";
}

/** `lstat` that answers null for a path that is not there; any other failure is a refusal. */
function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (errno(error) === "ENOENT") return null;
    return refuse(`${path}: ${errno(error)}`);
  }
}

/** Step 0.5: the parent is a directory owned by root or by this process, and sticky if others may write it. */
function checkParent(parent: string): void {
  let found: Stats;
  try {
    found = statSync(parent); // following, as /tmp is a link to /private/tmp
  } catch (error) {
    refuse(`${parent}: ${errno(error)}`);
  }
  const self = process.getuid?.() ?? 0;
  const mode = found.mode & 0o7777;
  if (!found.isDirectory()) refuse(`${parent} is not a directory`);
  if (found.uid !== 0 && found.uid !== self) refuse(`${parent} belongs to uid ${found.uid}`);
  if (mode & 0o022 && !(mode & 0o1000)) {
    refuse(`${parent} is writable by others without the sticky bit (mode 0${mode.toString(8)})`);
  }
}

/** What an ensure found: the directory, and whether a link pointing ELSEWHERE was replaced. That never happens in
 * honest use (the scope is the root's own hash, so one root always wants one target); a caller logs it as one
 * warning line naming the alias's path alone. */
export interface SocketDirOutcome {
  readonly dir: string;
  readonly replaced: boolean;
}

/** The directory every socket of `dataRoot` is bound and dialed in, made usable first. The planes call
 * `ensureSocketDirOutcome` and log a replacement; this is its answer without the flag. */
export function ensureSocketDir(dataRoot: string, opts: SocketAliasOptions = {}): string {
  return ensureSocketDirOutcome(dataRoot, opts).dir;
}

/** The ensure itself (the order is the list in PLAN-345-r2's S2 read, the same in both twins). */
export function ensureSocketDirOutcome(
  dataRoot: string,
  opts: SocketAliasOptions = {},
): SocketDirOutcome {
  const uid = opts.uid ?? process.getuid?.() ?? 0;
  const parent = opts.parent ?? SOCKET_ALIAS_PARENT;
  const target = nativeRunDirFor(dataRoot);
  const alias = unixSocketDir(uid, dataRoot, parent);
  // 0: a root that fits touches nothing
  if (alias === target) return { dir: target, replaced: false };
  checkParent(parent); // 0.5
  const folder = `${parent}/vf-${uid}`;
  if (lstatOrNull(folder) === null) {
    // 1: made here, so made 0700 whatever the umask; EEXIST is a racing twin, and step 2 reads what it made
    try {
      mkdirSync(folder, { mode: 0o700 });
      chmodSync(folder, 0o700);
    } catch (error) {
      if (errno(error) !== "EEXIST") refuse(`${folder}: ${errno(error)}`);
    }
  }
  const found = lstatOrNull(folder); // 2: the folder as FOUND is what is trusted; an existing one is never chmodded
  if (found === null) return refuse(`${folder} vanished while it was made`);
  if (found.isSymbolicLink()) refuse(`${folder} is a link`);
  if (!found.isDirectory()) refuse(`${folder} is not a directory`);
  if (found.uid !== uid) refuse(`${folder} belongs to uid ${found.uid}, not ${uid}`);
  const mode = found.mode & 0o7777;
  if (mode !== 0o700) {
    const open = mode & 0o077 ? " (open to others)" : "";
    refuse(`${folder} has mode 0${mode.toString(8)}, not 0700${open}`);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const link = lstatOrNull(alias); // 3
    if (link === null) {
      try {
        symlinkSync(target, alias);
        return { dir: alias, replaced: false };
      } catch (error) {
        if (errno(error) !== "EEXIST") refuse(`${alias}: ${errno(error)}`);
        continue; // a racing twin made it: read it again, once
      }
    }
    if (!link.isSymbolicLink()) refuse(`${alias} is not a link`);
    let pointsAt: string;
    try {
      pointsAt = readlinkSync(alias);
    } catch (error) {
      if (errno(error) === "ENOENT") continue; // removed since the lstat: read it again, once
      return refuse(`${alias}: ${errno(error)}`);
    }
    if (pointsAt === target) return { dir: alias, replaced: false };
    // A link pointing elsewhere is replaced by a rename from a temp name inside our own 0700 folder. Nothing is
    // unlinked, here or on quit.
    const scope = alias.slice(folder.length + 1);
    for (let n = 0; n < 8; n += 1) {
      const temp = `${folder}/.${scope}.${process.pid}.${n}`;
      try {
        symlinkSync(target, temp);
      } catch (error) {
        if (errno(error) === "EEXIST") continue;
        refuse(`${temp}: ${errno(error)}`);
      }
      try {
        renameSync(temp, alias);
      } catch (error) {
        refuse(`${alias}: ${errno(error)}`);
      }
      return { dir: alias, replaced: true };
    }
    return refuse(`${folder}: no free temp name for the alias's replacement`);
  }
  return refuse(`${alias} kept changing while it was made`);
}
