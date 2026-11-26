// EY-1 (2026-11-19) — THE PAGE ENGINE'S IDENTITY, checked before every start. Main runs the pinned
// agent-browser binary only when it is the one the record names (PAGES_ENGINE_RECORD, the EL8's
// pin):
// - in development, by its bytes: opened without following a link, a regular file, hashed through
//   that one descriptor and compared with the record's SHA-256 for this host;
// - in a package, by its signature: the app re-signs the engine, which changes its bytes, so it is
//   judged as code signed by the app's OWN team (codesign's strict verify with a requirement naming
//   that team, read from the app's signature at start). An ad hoc preview has no team, and pages
//   are unavailable there.
// Either way, `--version` must then name the record's version, run with three variables (PATH,
// HOME, TMPDIR) in the instance's empty cwd, never in daemon mode.
//
// The release binary's stream port (2026-11-24): the record names TWO identities, and the one
// main starts is the SOURCE BUILD alone (`sourceBuild`). The release binary (`binarySha256`, the
// npm package's) always opens a loopback port that relays any command to the engine for any local
// process, so it is refused before anything of it runs, `--version` included:
// - in development the sum must be the source build's for this host. The release binary's sum is
//   refused by name (`release-binary`), and a host with no source build has no engine;
// - in a package the sum cannot be compared (the re-signing), and both builds print the same
//   version. What tells them apart there is in the bytes: the source build names the three
//   switches main starts it with, and the release build names none of them. Code of the app's own
//   team whose bytes do not name all three is refused (`no-switches`). This guards against a
//   stage that put the wrong build in the package, not against the team's own signature.
//
// Known and accepted: in development a same-uid process could swap the file between the hash and
// the start (the hash, then exec); the identity is a check against a stale or wrong pin, not a
// fence against same-uid code (EL7 is the tokens' and the walls' work).

import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { PagesEngineRecordV1 } from "@vibefield/contracts";
import { PAGES_ENGINE_SWITCHES } from "./surroundings";

/** How long `--version` and each codesign read may take. */
export const ENGINE_IDENTITY_TIMEOUT_MS = 10_000;
const CHUNK_BYTES = 1024 * 1024;
const TEAM = /^[A-Z0-9]{10}$/u;

export type PagesEngineIdentityFailure =
  | "no-path"
  | "unrecorded-host"
  | "not-regular"
  | "release-binary"
  | "sha256-mismatch"
  | "unsigned"
  | "team-mismatch"
  | "no-switches"
  | "version-mismatch";

export type PagesEngineIdentityResult =
  | {
      readonly ok: true;
      readonly kind: "dev-source-build" | "packaged-team";
      readonly path: string;
      readonly version: string;
    }
  | { readonly ok: false; readonly reason: PagesEngineIdentityFailure };

/** What a child answered: its exit code (null when killed) and its two streams. */
export interface RunOutcome {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a file by absolute path with exactly the environment and cwd given, bounded in time. */
export type RunFile = (
  file: string,
  args: readonly string[],
  o: {
    readonly env: Readonly<Record<string, string>>;
    readonly cwd: string;
    readonly timeoutMs: number;
  },
) => Promise<RunOutcome>;

export interface PagesEngineIdentityDeps {
  /** The pin: its version, the release binaries' sums (refused by name, never started), and the
   * source build, the one identity that is started. */
  readonly record: Pick<PagesEngineRecordV1, "version" | "binarySha256" | "sourceBuild">;
  /** `<platform>-<arch>`, the record's key for this host's binary. */
  readonly host: string;
  readonly run: RunFile;
  /** The three variables `--version` runs with (the instance's PATH, HOME and TMPDIR). */
  readonly versionEnv: Readonly<{ PATH: string; HOME: string; TMPDIR: string }>;
  /** The instance's empty cwd. */
  readonly cwd: string;
}

const fail = (reason: PagesEngineIdentityFailure): PagesEngineIdentityResult => ({
  ok: false,
  reason,
});

/** The file's SHA-256 through one descriptor opened without following a link, or null when it is
 * not a regular file there (a link, a folder, nothing). */
export function sha256OfRegularFile(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    const hash = createHash("sha256");
    const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
    let n = readSync(fd, chunk, 0, CHUNK_BYTES, null);
    while (n > 0) {
      hash.update(chunk.subarray(0, n));
      n = readSync(fd, chunk, 0, CHUNK_BYTES, null);
    }
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}

/** Whether a regular file's bytes hold every one of `needles`, read through one descriptor opened
 * without following a link; null when it is not a regular file there. A needle is found across a
 * read's edge too: each read is searched together with the tail of the one before. */
export function regularFileHolds(path: string, needles: readonly string[]): boolean | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    const wanted = needles.map((needle) => Buffer.from(needle, "utf8"));
    const keep = Math.max(0, ...wanted.map((needle) => needle.length - 1));
    const missing = new Set(wanted);
    const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
    let tail: Buffer = Buffer.alloc(0);
    let n = readSync(fd, chunk, 0, CHUNK_BYTES, null);
    while (n > 0 && missing.size > 0) {
      const window = Buffer.concat([tail, chunk.subarray(0, n)]);
      for (const needle of [...missing]) if (window.includes(needle)) missing.delete(needle);
      tail = Buffer.from(window.subarray(Math.max(0, window.length - keep)));
      n = readSync(fd, chunk, 0, CHUNK_BYTES, null);
    }
    return missing.size === 0;
  } finally {
    closeSync(fd);
  }
}

/** `--version` must answer the record's version, exactly, and exit 0. */
async function versionHolds(path: string, deps: PagesEngineIdentityDeps): Promise<boolean> {
  const out = await deps.run(path, ["--version"], {
    env: { ...deps.versionEnv },
    cwd: deps.cwd,
    timeoutMs: ENGINE_IDENTITY_TIMEOUT_MS,
  });
  return out.code === 0 && out.stdout.trim() === `agent-browser ${deps.record.version}`;
}

/** Development: the SOURCE BUILD's SHA-256 for this host. Nothing runs the file unless it matches:
 * the release binary's bytes are refused by name, and a host the record names no source build for
 * has no engine, whichever bytes the path holds. */
export async function checkDevEngine(
  path: string | null,
  deps: PagesEngineIdentityDeps,
): Promise<PagesEngineIdentityResult> {
  if (path === null || !path.startsWith("/")) return fail("no-path");
  const sums = deps.record.sourceBuild.binarySha256;
  const wanted = Object.hasOwn(sums, deps.host) ? sums[deps.host] : undefined;
  if (wanted === undefined) return fail("unrecorded-host");
  const found = sha256OfRegularFile(path);
  if (found === null) return fail("not-regular");
  if (found !== wanted.toLowerCase()) {
    const released = Object.values(deps.record.binarySha256).some(
      (sum) => sum.toLowerCase() === found,
    );
    return fail(released ? "release-binary" : "sha256-mismatch");
  }
  if (!(await versionHolds(path, deps))) return fail("version-mismatch");
  return { ok: true, kind: "dev-source-build", path, version: deps.record.version };
}

/** The app's own team, read from its signature (codesign writes its description to stderr), or
 * null for an ad hoc or unsigned app. */
export async function readAppTeam(
  appPath: string,
  run: RunFile,
  o: { readonly env: Readonly<Record<string, string>>; readonly cwd: string },
): Promise<string | null> {
  const out = await run("/usr/bin/codesign", ["--display", "--verbose=4", appPath], {
    ...o,
    timeoutMs: ENGINE_IDENTITY_TIMEOUT_MS,
  });
  if (out.code !== 0) return null;
  const line = out.stderr.split(/\r?\n/u).find((l) => l.startsWith("TeamIdentifier="));
  const team = line?.slice("TeamIdentifier=".length).trim() ?? "";
  return TEAM.test(team) ? team : null;
}

/** codesign's designated-requirement text for code signed by `team`'s Developer ID. */
export function teamRequirement(team: string): string {
  if (!TEAM.test(team)) throw new Error("a team identifier is ten uppercase letters or digits");
  return `=anchor apple generic and certificate leaf[subject.OU] = "${team}"`;
}

/** A package: the engine must verify strictly as code signed by the app's own team, and its bytes
 * must name every switch main starts it with (the source build does; the release build names
 * none). Nothing of the engine runs, `--version` included, unless both hold. */
export async function checkPackagedEngine(
  path: string | null,
  appTeam: string | null,
  deps: PagesEngineIdentityDeps,
): Promise<PagesEngineIdentityResult> {
  if (path === null || !path.startsWith("/")) return fail("no-path");
  if (appTeam === null || !TEAM.test(appTeam)) return fail("unsigned");
  const switched = regularFileHolds(path, PAGES_ENGINE_SWITCHES);
  if (switched === null) return fail("not-regular");
  const verify = await deps.run(
    "/usr/bin/codesign",
    ["--verify", "--strict", `-R${teamRequirement(appTeam)}`, path],
    { env: { ...deps.versionEnv }, cwd: deps.cwd, timeoutMs: ENGINE_IDENTITY_TIMEOUT_MS },
  );
  if (verify.code !== 0) return fail("team-mismatch");
  if (!switched) return fail("no-switches");
  if (!(await versionHolds(path, deps))) return fail("version-mismatch");
  return { ok: true, kind: "packaged-team", path, version: deps.record.version };
}
