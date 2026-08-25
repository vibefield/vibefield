import { execFile } from "node:child_process";
import { renameSync } from "node:fs";
import { chmod, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

// WIN-10 — the two filesystem laws that POSIX gives for free and Windows does
// not. Both live here because every Node-side writer of a secret or of evidence
// needs them and a per-package copy is how the first one silently stopped
// holding on Windows in the first place.

const execFileAsync = promisify(execFile);

/** `mode` on Windows sets the READ-ONLY attribute and nothing else — Node maps
 * it that way because NTFS has no permission bits. So `mkdir(…, 0o700)` +
 * `chmod(0o600)` are not merely weaker there, they are NO-OPs against the
 * question they were asked: every file a daemon writes lands readable by any
 * account with a path to it, and the EL7 "private at rest" posture rests
 * entirely on whatever the parent happened to inherit.
 *
 * The Windows expression of the same intent is an explicit DACL: drop inherited
 * ACEs and grant the current account alone. We set it on the DIRECTORY at
 * creation and let files inherit, which is both how NTFS is meant to be used
 * and the only shape with an acceptable cost — a per-file ACL edit would spawn
 * a process per rotated log segment.
 *
 * `icacls` rather than a native addon: it ships with Windows, adds no
 * dependency and no build step (EL8), and is the mechanism the port plan named.
 * It is invoked through `execFile` with an argument array — never a shell, so
 * a path with a space or an `&` is an argument and not syntax. */
export async function createPrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    // recursive:true skips mode when the directory already exists
    await chmod(path, 0o700);
    return;
  }
  // ONCE PER PATH PER PROCESS. Two costs are being balanced. Callers re-run this
  // on every re-open — `SegmentWriter` does, inside a bounded retry loop — so an
  // unconditional spawn would put two `icacls` launches behind each retry of a
  // failing write. But applying it only when `mkdir` reports a fresh directory
  // would never repair a tree that already exists with the WRONG acl, which is
  // exactly the state every install predating this code is in: an upgrade would
  // silently keep the inherited grants forever. Memoizing per process keeps the
  // migration repair (the first touch after any restart fixes it) and makes the
  // steady-state cost zero.
  if (restricted.has(path)) return;
  await restrictToCurrentUser(path);
  restricted.add(path);
}

/** Paths this process has already restricted — see `createPrivateDir`. */
const restricted = new Set<string>();

/** The DACL edit itself, for a path that cannot rely on a private parent.
 *
 * Prefer `createPrivateDir` on the enclosing directory where you can: a file
 * BORN inside a private directory is private from its first byte, with no
 * window between create and restrict. `shell.token` takes that route. */
export async function restrictToCurrentUser(path: string): Promise<void> {
  if (process.platform !== "win32") return;
  const { sid } = await currentWindowsIdentity();
  // The ACE form depends on WHAT this is, and getting it wrong is silent and
  // total. `(OI)(CI)` are CONTAINER inheritance flags — Object Inherit and
  // Container Inherit describe what children of a directory receive. Applied to
  // a FILE, icacls still exits 0 and still reports "Successfully processed 1
  // files", but the resulting DACL is EMPTY: the owner then gets EPERM reading,
  // rewriting, and even deleting its own file. On `shell.token` that means the
  // shell cannot read its adoption credential and fieldd cannot clean it up at
  // stop. Measured on the box, which is the only reason it is not still here.
  const ace = (await isDirectory(path)) ? `*${sid}:(OI)(CI)F` : `*${sid}:F`;
  // /inheritance:r drops the inherited ACEs — without it the parent's grants
  // survive and "grant" only ADDS to them. /grant:r replaces any existing ACE
  // for this account rather than accumulating one per call, so repeated runs
  // converge instead of growing the ACL.
  await execFileAsync(icaclsPath(), [path, "/inheritance:r", "/grant:r", ace, "/Q"], {
    windowsHide: true,
  });
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path)).isDirectory();
}

/** The current TOKEN's account and SID, from `whoami /user` — memoized per
 * process, because a token's identity cannot change under it.
 *
 * NOT the environment, and that is a correction (2026-08-24): the grant used
 * to be built from `%USERDOMAIN%\%USERNAME%`, and USERDOMAIN is a SESSION
 * fact, not a token fact. An sshd service session on a workgroup machine
 * exports `USERDOMAIN=WORKGROUP` while the token's authority is the machine
 * name — so every grant asked icacls for `WORKGROUP\me`, no LSA mapping
 * exists for that name (error 1332), and `createPrivateDir` failed across
 * the whole box gate, the very sessions the WIN rounds ride. The SID needs
 * no name resolution at all: icacls takes it directly in `*S-1-…` form.
 * A failed or unparseable `whoami` refuses loudly — a guessed principal
 * would either lock the daemon out of its own tree or grant nothing. */
export interface WindowsIdentity {
  /** `authority\user` as the token spells it (whoami prints it lowercase). */
  account: string;
  sid: string;
}

let identity: Promise<WindowsIdentity> | undefined;

export function currentWindowsIdentity(): Promise<WindowsIdentity> {
  identity ??= (async () => {
    const { stdout } = await execFileAsync(
      join(systemRoot(), "System32", "whoami.exe"),
      ["/user", "/fo", "csv", "/nh"],
      { windowsHide: true },
    );
    const match = /^"(.+)","(S-1-[\d-]+)"$/.exec(stdout.trim());
    if (match === null) {
      throw new Error(
        `cannot restrict a path to the current user: whoami /user answered "${stdout.trim()}"`,
      );
    }
    return { account: match[1] as string, sid: match[2] as string };
  })();
  return identity;
}

/** Absolute, from SystemRoot: a bare `icacls` resolves through an inherited
 * PATH, and this runs with daemon authority (EL7). */
function systemRoot(): string {
  return process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
}

function icaclsPath(): string {
  return join(systemRoot(), "System32", "icacls.exe");
}

/** POSIX `rename(2)` replaces an open target atomically. Windows does not:
 * while ANY handle is open on the destination, `MoveFileEx` refuses with
 * ERROR_ACCESS_DENIED / ERROR_SHARING_VIOLATION, surfacing as EPERM/EACCES/
 * EBUSY. The holder is usually not us — a virus scanner, the search indexer or
 * a backup agent opening the file microseconds after we wrote it — so the
 * condition is transient by nature and a bounded retry is the documented cure
 * (the same reason Node's own `rm` grew `maxRetries`).
 *
 * Every publish path that commits by rename must use this. It is not a
 * durability weakening: each attempt is the same all-or-nothing rename, and a
 * caller that still cannot publish after the budget gets the original error
 * rather than a silent success. */
export async function durableRename(tmp: string, target: string): Promise<void> {
  if (process.platform !== "win32") return rename(tmp, target);
  let delayMs = 5;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await rename(tmp, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      // ~315ms across 6 retries — long enough for a scanner's handle, short
      // enough that a genuinely locked file still fails the write loudly.
      if (attempt >= 6 || !TRANSIENT_RENAME_CODES.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs *= 2;
    }
  }
}

const TRANSIENT_RENAME_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

/** `durableRename` for a commit point that cannot await — the same exposure and
 * the same cure, spelled synchronously.
 *
 * The retry BLOCKS the thread (`Atomics.wait` on a throwaway buffer, the only
 * true sleep Node offers without async), which is why the budget is a tenth of
 * the async one: these callers hold a write path, and a stalled daemon is its
 * own failure. A sync commit point that can be made async should be, and then
 * this should not be used; it exists because `artifact-service`, `link-service`
 * and the doc registry publish inside synchronous critical sections today. */
export function durableRenameSync(tmp: string, target: string): void {
  if (process.platform !== "win32") {
    renameSync(tmp, target);
    return;
  }
  let delayMs = 5;
  for (let attempt = 0; ; attempt += 1) {
    try {
      renameSync(tmp, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= 4 || !TRANSIENT_RENAME_CODES.has(code)) throw error;
      Atomics.wait(SLEEP_BUFFER, 0, 0, delayMs);
      delayMs *= 2;
    }
  }
}

/** A never-notified word, so `Atomics.wait` always runs its full timeout. */
const SLEEP_BUFFER = new Int32Array(new SharedArrayBuffer(4));
