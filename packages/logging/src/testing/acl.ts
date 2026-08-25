import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { currentWindowsIdentity } from "../private-fs";

// Test-only: reads back the DACL that `createPrivateDir` writes, so the win32
// half of EL7 "private at rest" has something to assert instead of a skip.
//
// It lives here, beside the writer, rather than being copied into each suite:
// two packages assert the same property (@vibefield/logging's segments and
// @vibefield/audit's chain), and a second copy of this parser is how one of
// them would quietly stop meaning what it says.

const execFileAsync = promisify(execFile);

/** One access-control entry, exactly as `icacls` prints it. */
export interface WindowsAce {
  /** `DOMAIN\user`, a well-known name like `BUILTIN\Users`, or a bare SID when
   * the account no longer resolves (app-container SIDs print this way). */
  account: string;
  /** The rights string verbatim, e.g. `(OI)(CI)(F)`. */
  rights: string;
  /** `(I)`: the entry came from the parent, not from this object. A private
   * DIRECTORY must have none — that is what `/inheritance:r` buys. A file
   * inside one has only inherited entries, which is the mechanism working. */
  inherited: boolean;
}

/** Absolute, from SystemRoot, for the same reason `private-fs` resolves it that
 * way: a bare `icacls` comes from an inherited PATH. */
function icaclsPath(): string {
  const root = process.env["SystemRoot"] ?? process.env["windir"] ?? "C:\\Windows";
  return join(root, "System32", "icacls.exe");
}

const ACE_LINE = /^(.+):((?:\([^()]*\))+)$/;

/** The ACL on `path`, one entry per grant. win32 only — callers gate on the
 * platform, because there is no meaningful answer elsewhere.
 *
 * `icacls` prints the path followed by its first entry, then one indented entry
 * per line, then a blank line and a localized "Successfully processed" summary.
 * The path is stripped by length rather than by pattern: it is echoed verbatim
 * and it contains a colon of its own (`D:\…`), which would otherwise parse as
 * an account/rights separator. An unparseable line throws rather than being
 * dropped — a silently skipped entry is a silently weakened assertion. */
export async function readWindowsAcl(path: string): Promise<WindowsAce[]> {
  const { stdout } = await execFileAsync(icaclsPath(), [path], { windowsHide: true });
  const aces: WindowsAce[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = (raw.startsWith(path) ? raw.slice(path.length) : raw).trim();
    if (line.length === 0) break;
    const match = ACE_LINE.exec(line);
    if (match === null) throw new Error(`unparseable icacls entry for ${path}: ${line}`);
    aces.push({
      account: match[1] as string,
      rights: match[2] as string,
      inherited: (match[2] as string).includes("(I)"),
    });
  }
  if (aces.length === 0) throw new Error(`icacls reported no ACL for ${path}`);
  return aces;
}

/** The account `createPrivateDir`'s grant resolves back to: the TOKEN's own
 * `authority\user`, read through the writer's `whoami` identity — never the
 * env's `%USERDOMAIN%`, which lies in service sessions (see
 * `currentWindowsIdentity` for the box-gate session where they disagree).
 * icacls prints a SID grant back as the resolved name; compare
 * case-insensitively, because icacls capitalizes what whoami lowercases. */
export async function currentWindowsAccount(): Promise<string> {
  return (await currentWindowsIdentity()).account;
}

/** Principals that would make a private path shared. Named explicitly so the
 * threat is visible in the assertion, even though "exactly one account" already
 * excludes them; the English names are the ones this repo's boxes print. */
export const MULTI_USER_PRINCIPALS = [
  "BUILTIN\\Users",
  "Everyone",
  "NT AUTHORITY\\Authenticated Users",
  "BUILTIN\\Administrators",
];
