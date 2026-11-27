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
import { memberDigest } from "../src/main/updates/code-directory.mjs";
import { machO, type Signing } from "./updates/macho-fixture";

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

function engine(bytes: string | Uint8Array = BYTES): string {
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

/** `staged`: the record's staged engines' CodeDirectory digests (item 658, 2026-11-26); none by default, as today. */
function deps(
  run: RunFile,
  host = "darwin-arm64",
  staged: Readonly<Record<string, string>> = {},
): PagesEngineIdentityDeps {
  return {
    record: {
      version: "0.41.0",
      // the release binary's sums: held by preflight, never started. darwin-x64 has no source build
      binarySha256: { "darwin-arm64": RELEASE_SHA, "darwin-x64": RELEASE_SHA },
      sourceBuild: {
        tagCommit: "1453dd37a40c730fe00f592bc32198a896ff8747",
        patchSha256: "0".repeat(64),
        binarySha256: { "darwin-arm64": SHA },
        stagedCdhash: { ...staged },
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

// Item 658 (2026-11-26): a package's engine is code the app's team signed (macho-fixture's signed Mach-O, every
// CodeDirectory hash real), named in the record by its CodeDirectory's SHA-256. The fake codesign judges the team
// alone, so the digest rows hold what main reads itself, before codesign or the engine runs.
const SIGNED_CODE = `the source build's code ${SWITCHES.join(" ")} `.repeat(300);
/** A signed engine of `code` in a folder of its own, and the digest a stage would record for it. */
function signedEngine(code = SIGNED_CODE, signing: Signing = {}) {
  const image = machO(code, { team: TEAM, identifier: "agent-browser", ...signing });
  const cdhash = memberDigest(image.bytes);
  expect(cdhash.by).toBe("cdhash");
  return {
    path: engine(image.bytes),
    cdhash: cdhash.digest,
    bytes: image.bytes,
    directories: image.directories,
  };
}
const staged = (cdhash: string) => ({ "darwin-arm64": cdhash });

describe("a package: a staged engine the record names, by its CodeDirectory (item 658, 2026-11-26)", () => {
  it("starts no engine whose staged digest the record does not name: nothing runs, codesign included", async () => {
    // code the app's team signed, whose bytes name every switch: today's check passed it
    const { path } = signedEngine();
    const run = fakeRun();
    expect(await checkPackagedEngine(path, TEAM, deps(run))).toEqual({
      ok: false,
      reason: "unstaged",
    });
    // a record naming another host's staged engine names none for this one
    const x64 = deps(run, "darwin-arm64", { "darwin-x64": "c".repeat(64) });
    expect(await checkPackagedEngine(path, TEAM, x64)).toEqual({ ok: false, reason: "unstaged" });
    expect(run).toHaveBeenCalledTimes(0);
  });

  it("passes the recorded CodeDirectory, and still passes it re-signed: a new signature moves no code", async () => {
    const monday = signedEngine(SIGNED_CODE, { cms: "signed Monday 01:00Z · timestamp token A" });
    const tuesday = signedEngine(SIGNED_CODE, {
      cms: "signed Tuesday 01:00Z · a longer timestamp token B, its chain",
    });
    expect(tuesday.bytes.equals(monday.bytes)).toBe(false);
    expect(tuesday.cdhash).toBe(monday.cdhash);
    for (const { path } of [monday, tuesday]) {
      const run = fakeRun();
      expect(
        await checkPackagedEngine(path, TEAM, deps(run, "darwin-arm64", staged(monday.cdhash))),
      ).toEqual({
        ok: true,
        kind: "packaged-team",
        path,
        version: "0.41.0",
      });
      // codesign judged the team, then the engine named its version
      expect(run.mock.calls.map(([, args]) => args[0])).toEqual(["--verify", "--version"]);
    }
  });

  it("refuses other code, and the same code unsigned, by its digest: nothing runs", async () => {
    const recorded = signedEngine();
    const other = signedEngine(`${SIGNED_CODE}one more line`);
    const unsignedImage = machO(SIGNED_CODE, null);
    const resignedByAnother = signedEngine(SIGNED_CODE, { team: "ZZZZZ99999" });
    // the recorded engine's own CodeDirectory, planted as the whole file: it is no Mach-O, so its
    // digest is its bytes' sum, which IS the recorded value; only the digest's kind refuses it
    const blob = recorded.directories[0];
    if (blob === undefined) throw new Error("the signed fixture holds a CodeDirectory");
    expect(memberDigest(blob)).toMatchObject({ by: "bytes", digest: recorded.cdhash });
    for (const path of [
      other.path,
      engine(unsignedImage.bytes),
      resignedByAnother.path,
      engine(BYTES),
      engine(blob),
    ]) {
      const run = fakeRun();
      expect(
        await checkPackagedEngine(path, TEAM, deps(run, "darwin-arm64", staged(recorded.cdhash))),
        path,
      ).toEqual({ ok: false, reason: "digest-mismatch" });
      expect(run).toHaveBeenCalledTimes(0);
    }
    // the unsigned file's bytes hold the very code the recorded engine's do
    expect(unsignedImage.bytes.includes(Buffer.from(SIGNED_CODE))).toBe(true);
  });

  it("refuses a link and a folder before the record is read: never followed, never run", async () => {
    const { path, cdhash } = signedEngine();
    const link = join(folder(), "agent-browser");
    symlinkSync(path, link);
    const dir = join(folder(), "agent-browser");
    mkdirSync(dir);
    const run = fakeRun();
    // with no staged engine recorded (as today) as well as with one: the file is read, and refused
    // as not regular, before the record's staged digests are looked at
    for (const record of [deps(run), deps(run, "darwin-arm64", staged(cdhash))]) {
      for (const at of [link, dir, join(folder(), "absent")]) {
        expect(await checkPackagedEngine(at, TEAM, record), at).toEqual({
          ok: false,
          reason: "not-regular",
        });
      }
    }
    expect(run).toHaveBeenCalledTimes(0);
  });
});

describe("a package: the app's own team", () => {
  it("passes code the app's team signed, and fails another team's", async () => {
    // a package's engine is re-signed, so its sum is not the record's: it is judged by its staged
    // CodeDirectory (item 658, 2026-11-26), by its team, and by the switch names only the source
    // build's bytes carry
    const { path, cdhash } = signedEngine();
    expect(
      await checkPackagedEngine(path, TEAM, deps(fakeRun(), "darwin-arm64", staged(cdhash))),
    ).toEqual({
      ok: true,
      kind: "packaged-team",
      path,
      version: "0.41.0",
    });
    const otherTeam = deps(
      fakeRun("agent-browser 0.41.0", "ZZZZZ99999"),
      "darwin-arm64",
      staged(cdhash),
    );
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
      // even a staged digest the record names: its code still names no switch
      const { path, cdhash } = signedEngine(bytes);
      const run = fakeRun();
      expect(
        await checkPackagedEngine(path, TEAM, deps(run, "darwin-arm64", staged(cdhash))),
        bytes,
      ).toEqual({
        ok: false,
        reason: "no-switches",
      });
      // codesign judged the team; the engine itself never ran, not even for --version
      expect(run.mock.calls.map(([file]) => file)).toEqual(["/usr/bin/codesign"]);
    }
  });

  it("finds a switch name wherever it lies in the file, a megabyte's edge included", async () => {
    const chunk = 1024 * 1024;
    const [first, second, third] = SWITCHES;
    // the first name straddles the file's first megabyte (the code starts after the image's 48 bytes of header and
    // load command), the others lie after the second
    const head = "x".repeat(chunk - 48 - 9);
    const code = `${head}${first}${"y".repeat(chunk)}${second}\0${third}`;
    const big = { reserve: 1 << 17 };
    const whole = signedEngine(code, big);
    expect(whole.bytes.indexOf(first)).toBe(chunk - 9);
    const run = fakeRun();
    expect(
      (await checkPackagedEngine(whole.path, TEAM, deps(run, "darwin-arm64", staged(whole.cdhash))))
        .ok,
    ).toBe(true);
    const cut = signedEngine(code.replace(first, `${first.slice(0, 9)}\0${first.slice(9)}`), big);
    expect(
      await checkPackagedEngine(
        cut.path,
        TEAM,
        deps(fakeRun(), "darwin-arm64", staged(cut.cdhash)),
      ),
    ).toEqual({
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
