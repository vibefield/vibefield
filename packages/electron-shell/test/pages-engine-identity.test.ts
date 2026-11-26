import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkDevEngine,
  checkPackagedEngine,
  type PagesEngineIdentityDeps,
  type RunFile,
  type RunOutcome,
  readAppTeam,
  sha256OfRegularFile,
  teamRequirement,
} from "../src/main/pages/broker/engine-identity";

// EY-1 (2026-11-19): the page engine runs only as the record's pin, by its bytes in development and
// by the app's own team in a package. Every child is a fake: nothing here runs a binary.
// The release binary's stream port (2026-11-24): the pin has two identities, and only the SOURCE
// BUILD is ever started. BYTES stands for the source build, RELEASE for the npm package's binary.

const cleanup: string[] = [];
const SWITCHES = [
  "AGENT_BROWSER_NO_STREAM",
  "AGENT_BROWSER_PEER_PIDS",
  "AGENT_BROWSER_HIDE_CDP_URL",
] as const;
const BYTES = `#!/bin/sh\necho 'agent-browser 0.41.0'\n# ${SWITCHES.join(" ")}\n`;
const SHA = createHash("sha256").update(BYTES).digest("hex");
const RELEASE = "#!/bin/sh\necho 'agent-browser 0.41.0'\n# the release: it opens the stream port\n";
const RELEASE_SHA = createHash("sha256").update(RELEASE).digest("hex");
const TEAM = "ABCDE12345";

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-engine-"));
  chmodSync(dir, 0o700);
  cleanup.push(dir);
  return dir;
}

function engine(bytes = BYTES): string {
  const path = join(folder(), "agent-browser");
  writeFileSync(path, bytes, { mode: 0o755 });
  return path;
}

/** A fake child: `--version` answers `version`; codesign's verify passes for `team` alone. */
function fakeRun(version = "agent-browser 0.41.0", team: string | null = TEAM) {
  return vi.fn<RunFile>(async (file, args): Promise<RunOutcome> => {
    if (args[0] === "--version") return { code: 0, stdout: `${version}\n`, stderr: "" };
    if (file === "/usr/bin/codesign" && args[0] === "--verify") {
      const passes = team !== null && args.includes(`-R${teamRequirement(team)}`);
      return { code: passes ? 0 : 3, stdout: "", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "" };
  });
}

function deps(run: RunFile, host = "darwin-arm64"): PagesEngineIdentityDeps {
  return {
    record: {
      version: "0.41.0",
      // the release binary's sums: held by preflight, never started. darwin-x64 has no source build
      binarySha256: { "darwin-arm64": RELEASE_SHA, "darwin-x64": RELEASE_SHA },
      sourceBuild: {
        tagCommit: "1453dd37a40c730fe00f592bc32198a896ff8747",
        patchSha256: "0".repeat(64),
        binarySha256: { "darwin-arm64": SHA },
      },
    },
    host,
    run,
    versionEnv: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: "/h", TMPDIR: "/t" },
    cwd: "/c",
  };
}

describe("development: the record's bytes", () => {
  it("passes the source build's sum, and refuses one byte off with nothing run", async () => {
    const run = fakeRun();
    const path = engine();
    expect(await checkDevEngine(path, deps(run))).toEqual({
      ok: true,
      kind: "dev-source-build",
      path,
      version: "0.41.0",
    });
    const other = fakeRun();
    const off = engine(`${BYTES} `);
    expect(await checkDevEngine(off, deps(other))).toEqual({
      ok: false,
      reason: "sha256-mismatch",
    });
    expect(other).not.toHaveBeenCalled();
  });

  it("refuses the release binary by name: the npm package's bytes are never run, not even for --version", async () => {
    const run = fakeRun();
    expect(await checkDevEngine(engine(RELEASE), deps(run))).toEqual({
      ok: false,
      reason: "release-binary",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a link and a folder: never followed, never run", async () => {
    const run = fakeRun();
    const link = join(folder(), "agent-browser");
    symlinkSync(engine(), link);
    expect(await checkDevEngine(link, deps(run))).toEqual({ ok: false, reason: "not-regular" });
    const dir = join(folder(), "agent-browser");
    mkdirSync(dir);
    expect(await checkDevEngine(dir, deps(run))).toEqual({ ok: false, reason: "not-regular" });
    expect(sha256OfRegularFile(join(folder(), "absent"))).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("answers no path, and a host the record names no source build for", async () => {
    const run = fakeRun();
    expect(await checkDevEngine(null, deps(run))).toEqual({ ok: false, reason: "no-path" });
    expect(await checkDevEngine("relative", deps(run))).toEqual({ ok: false, reason: "no-path" });
    // darwin-x64 has a release binary in the record and no source build: there is no engine there,
    // whichever bytes the path holds
    for (const bytes of [BYTES, RELEASE]) {
      expect(await checkDevEngine(engine(bytes), deps(run, "darwin-x64"))).toEqual({
        ok: false,
        reason: "unrecorded-host",
      });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("requires --version to name the record's version, run with three variables", async () => {
    const run = fakeRun("agent-browser 0.40.0");
    expect(await checkDevEngine(engine(), deps(run))).toEqual({
      ok: false,
      reason: "version-mismatch",
    });
    const [, args, o] = run.mock.calls[0] ?? [];
    expect(args).toEqual(["--version"]);
    expect(o?.env).toEqual({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: "/h", TMPDIR: "/t" });
    expect(o?.cwd).toBe("/c");
  });
});

describe("a package: the app's own team", () => {
  it("passes code the app's team signed, and fails another team's", async () => {
    // a package's engine is re-signed, so its sum is not the record's: it is judged by its team,
    // and by the switch names only the source build's bytes carry
    const path = engine(`re-signed bytes ${SWITCHES.join(" ")}`);
    expect(await checkPackagedEngine(path, TEAM, deps(fakeRun()))).toEqual({
      ok: true,
      kind: "packaged-team",
      path,
      version: "0.41.0",
    });
    const otherTeam = deps(fakeRun("agent-browser 0.41.0", "ZZZZZ99999"));
    expect(await checkPackagedEngine(path, TEAM, otherTeam)).toEqual({
      ok: false,
      reason: "team-mismatch",
    });
  });

  it("refuses the app's own team's code when its bytes name no switch: the release build is never run", async () => {
    const lacking = [
      "re-signed release bytes",
      `re-signed ${SWITCHES[0]} ${SWITCHES[1]}`,
      `re-signed ${SWITCHES[1]} ${SWITCHES[2]}`,
    ];
    for (const bytes of lacking) {
      const run = fakeRun();
      expect(await checkPackagedEngine(engine(bytes), TEAM, deps(run)), bytes).toEqual({
        ok: false,
        reason: "no-switches",
      });
      // codesign judged the team; the engine itself never ran, not even for --version
      expect(run.mock.calls.map(([file]) => file)).toEqual(["/usr/bin/codesign"]);
    }
  });

  it("finds a switch name wherever it lies in the file, across a read's edge too", async () => {
    const chunk = 1024 * 1024;
    const [first, second, third] = SWITCHES;
    // the first name straddles the first megabyte, the others lie after the second
    const head = "x".repeat(chunk - 9);
    const bytes = `${head}${first}${"y".repeat(chunk)}${second}\0${third}`;
    const path = engine(bytes);
    expect((await checkPackagedEngine(path, TEAM, deps(fakeRun()))).ok).toBe(true);
    const cut = bytes.replace(first, `${first.slice(0, 9)}\0${first.slice(9)}`);
    expect(await checkPackagedEngine(engine(cut), TEAM, deps(fakeRun()))).toEqual({
      ok: false,
      reason: "no-switches",
    });
  });

  it("answers an ad hoc app (no team) unsigned, before anything runs", async () => {
    const run = fakeRun();
    expect(await checkPackagedEngine(engine(), null, deps(run))).toEqual({
      ok: false,
      reason: "unsigned",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("reads the app's team from codesign's description, and none for ad hoc", async () => {
    const said = (stderr: string, code = 0) =>
      vi.fn<RunFile>(async () => ({ code, stdout: "", stderr }));
    const o = { env: { PATH: "/usr/bin:/bin" }, cwd: "/c" };
    const signed = "Identifier=x\nTeamIdentifier=ABCDE12345\nTimestamp=1\n";
    expect(await readAppTeam("/A.app", said(signed), o)).toBe(TEAM);
    expect(await readAppTeam("/A.app", said("TeamIdentifier=not set\n"), o)).toBeNull();
    expect(await readAppTeam("/A.app", said("code object is not signed", 1), o)).toBeNull();
  });

  it("names only a well-formed team in its requirement", () => {
    expect(teamRequirement(TEAM)).toBe(
      `=anchor apple generic and certificate leaf[subject.OU] = "${TEAM}"`,
    );
    expect(() => teamRequirement('X" or true')).toThrow();
  });
});
