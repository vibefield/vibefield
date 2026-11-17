// @vibefield/trust — OB custody (C6): whose code a process is, asked of macOS's own tool. Custody is handed only by a
// shell that is itself signed by a team under the hardened runtime (`ownIdentity`, else the level is `files`), and
// only to a child that is the same team's, under the same runtime, BEFORE anything is written to it (`childIsOurs`).
// So a daemon binary swapped in the bundle that is STILL that binary when it is asked about is spawned, asked about,
// and never handed a secret: this stops a wrong binary that stays itself, and no more than that (see "What this is
// NOT", corrected 2026-11-10).
//
// C6b — and only to the binary the caller EXPECTS, by its signing identifier. "Our team, hardened" is true of every
// binary our team signs, and the bundle holds others: `field-terminal-host` and `field-freeway-host` read the first
// line of their own stdin as a bootstrap, and an agent starts `field-native door` at will. One of them in a daemon's
// place would pass a team check and be handed the custody line. The requirement therefore names the identifier first.
//
// What this is NOT: a check on a peer, or on who else may hold a child's pipe. For a spawned child, a `true` is about
// the IMAGE at that pid at the moment it is asked, and about nothing else: it stops a wrong binary that stays itself,
// and no more (item 288, named here; nothing in this module stops a program written to pass). What a child its caller
// spawned and has not reaped does give is narrower: its pid cannot have been taken by another process, so the answer
// is about that child's image and nobody else's. `processIsOurs` says what it is not about itself.
// *Corrected 2026-11-10 (item 288). The opening said a swapped binary is "never handed a
// secret", with no condition, and this paragraph said `childIsOurs` "is sound" for a child its caller spawned.
// Neither holds for a program written to pass, and nothing in this module stops that one.*
//
// Never run on a signed build (the lane's rows are edits only): every expectation of codesign here is read from its
// manual, and the rows inject `run`. A landing-class row on a signed package is owed.
//
// node:child_process only (wall R28). The tool is named by its absolute path and run with no shell and a bound.

import { execFile } from "node:child_process";

const CODESIGN = "/usr/bin/codesign";
const TOOL_TIMEOUT_MS = 5_000;
const TOOL_OUTPUT_BYTES = 256 * 1024;
/** An Apple team identifier: ten capitals or digits. Checked before a team is ever put in a requirement. */
const TEAM = /^[A-Z0-9]{10}$/;
/** A code signing identifier as this module will ask for one: letters, digits, dot, underscore and hyphen, at most
 * 128 characters, never a quote or a space. Checked before an identifier is ever put in a requirement. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The signing identifiers of the two daemons custody is handed to: what the release signer gives each. It passes
 * no `--identifier` today (`apps/desktop/packaging/sign-mac.mjs`), so each is codesign's default for a bare
 * executable, its file name. READ, not measured: the custody row on a signed build is what proves these two words. */
export const FIELDD_SIGNING_IDENTIFIER = "fieldd";
export const FIELD_NATIVE_SIGNING_IDENTIFIER = "field-native";

/** A team's signature under the hardened runtime: the only identity custody is handed on. */
export interface CodeIdentity {
  readonly team: string;
  readonly hardened: true;
}

/** Which binary a caller expects at a pid: its signing identifier (`FIELDD_SIGNING_IDENTIFIER`, or the floor's). */
export interface ExpectedCode {
  readonly identifier: string;
}

export interface ToolResult {
  /** the exit status; null when the tool did not exit by itself (it was killed, or it never started) */
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** How a tool is run. Injected in tests, which need no codesign; the default is `runTool`. */
export type RunTool = (file: string, args: readonly string[]) => Promise<ToolResult>;

/** Where `ownIdentity` stands. A test's seam; the default is this process on this platform. */
export interface IdentityHost {
  readonly platform?: NodeJS.Platform;
  readonly pid?: number;
}

/** The default `RunTool`: `execFile`, so no shell reads the arguments, killed after five seconds. Never rejects:
 * a tool that could not start, exited non-zero or was killed is a `code` that is not 0. */
export const runTool: RunTool = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { timeout: TOOL_TIMEOUT_MS, maxBuffer: TOOL_OUTPUT_BYTES, encoding: "utf8", shell: false },
      (error, stdout, stderr) => {
        // an exit status is a number; a tool that never started carries its errno's name there instead
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : null;
        resolve({ code, stdout, stderr });
      },
    );
  });

/** What `codesign --display --verbose=4` says of some code: its team, and whether its flags name the hardened
 * runtime. The words go to stderr; both streams are read, so a tool that moved them changes nothing. */
function displayed(result: ToolResult): { team: string | null; hardened: boolean } {
  const text = `${result.stderr}\n${result.stdout}`;
  // `TeamIdentifier=ABCDE12345`, or `TeamIdentifier=not set` for ad-hoc and unsigned code
  const team = /^TeamIdentifier=(.*)$/m.exec(text)?.[1]?.trim() ?? "";
  // `CodeDirectory v=20500 size=… flags=0x10000(runtime) hashes=…`: the names inside the parentheses
  const flags = /^CodeDirectory\b.*\bflags=0x[0-9a-fA-F]+\(([^)]*)\)/m.exec(text)?.[1] ?? "";
  return {
    team: TEAM.test(team) ? team : null,
    hardened: flags.split(",").some((flag) => flag.trim() === "runtime"),
  };
}

async function display(pid: number, run: RunTool): Promise<ReturnType<typeof displayed> | null> {
  const result = await run(CODESIGN, ["--display", "--verbose=4", `+${pid}`]);
  return result.code === 0 ? displayed(result) : null;
}

const isPid = (pid: number): boolean => Number.isSafeInteger(pid) && pid > 0;

/**
 * This process's own code identity, or null: not macOS, no team (unsigned, ad-hoc), no hardened runtime, or the tool
 * did not answer. null means custody's `files` level; it is never an error, and the caller makes no keystore call on
 * it. Asked once per boot, of the running process (`+pid`), never of a path somebody could have rewritten since.
 */
export async function ownIdentity(
  run: RunTool = runTool,
  host: IdentityHost = {},
): Promise<CodeIdentity | null> {
  const platform = host.platform ?? process.platform;
  const pid = host.pid ?? process.pid;
  if (platform !== "darwin" || !isPid(pid)) return null;
  try {
    const own = await display(pid, run);
    if (own === null || own.team === null || !own.hardened) return null;
    return { team: own.team, hardened: true };
  } catch {
    return null;
  }
}

/** The one judgment both doors below make. Never throws: every doubt is `false`. */
async function satisfies(
  pid: number,
  own: CodeIdentity,
  expect: ExpectedCode,
  run: RunTool,
): Promise<boolean> {
  // the team and the identifier are spliced into a requirement, so each is held to its own pattern first: nothing
  // else reaches the tool, and neither can close the quotes it is put between
  if (!isPid(pid) || !TEAM.test(own.team)) return false;
  if (typeof expect?.identifier !== "string" || !IDENTIFIER.test(expect.identifier)) return false;
  try {
    // WHICH binary, then WHOSE: the identifier the caller expects, under Apple's anchor, signed by our team
    const requirement = [
      `=identifier "${expect.identifier}"`,
      "anchor apple generic",
      `certificate leaf[subject.OU] = "${own.team}"`,
    ].join(" and ");
    // `-R` is codesign's `--test-requirement`, the VERIFY option. `--requirement` is not it: that abbreviates
    // `--requirements`, the signing option, and a verify given it tests no requirement at all.
    const verified = await run(CODESIGN, ["--verify", "-R", requirement, `+${pid}`]);
    if (verified.code !== 0) return false;
    // a second read: the requirement says which and whose, the flags say it runs hardened (no injected library, no
    // debugger)
    const theirs = await display(pid, run);
    return theirs?.hardened === true;
  } catch {
    return false;
  }
}

/**
 * true when the image at the CHILD `pid`, now, is the binary `expect` names, signed by `own.team`, under the hardened
 * runtime: the dynamic check (`codesign --verify -R … +pid`), then its runtime flag. Only for a child the caller
 * spawned and has not reaped: its pid is then that child's and no other process's, so the answer is about that
 * child's image and nobody else's. Await it BEFORE writing anything to the child. It stops a wrong binary that stays
 * itself, and no more (item 288, named here).
 * *Corrected 2026-11-10 (item 288): this said the pid's being the child's "is what makes a
 * pid check sound here". It makes the answer be about the right process, and no more.*
 */
export function childIsOurs(
  pid: number,
  own: CodeIdentity,
  expect: ExpectedCode,
  run: RunTool = runTool,
): Promise<boolean> {
  return satisfies(pid, own, expect, run);
}

/**
 * The same requirement and runtime check for a process the caller did NOT spawn (a pid read from product.json). It
 * proves the BINARY at that pid at the moment of asking: that the process there is the one `expect` names, our
 * team's, hardened. It never proves who holds a socket or who will answer on a port, and the pid can be another
 * process's by the time anything acts on it. So it has one use and no other: the two stops of an automatic renewal
 * of the custody root at boot (the old fieldd, then the old floor), each verified IMMEDIATELY before its signal
 * (WP12 D10: no signal to a pid read from a file without this). It decides nothing about whom to trust with a
 * secret.
 */
export function processIsOurs(
  pid: number,
  own: CodeIdentity,
  expect: ExpectedCode,
  run: RunTool = runTool,
): Promise<boolean> {
  return satisfies(pid, own, expect, run);
}
