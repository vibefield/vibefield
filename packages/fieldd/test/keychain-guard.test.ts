import * as childProcess from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
// biome-ignore lint/style/useNodejsImportProtocol: item 551 holds the bare spelling guarded too
import * as bareChildProcess from "child_process";
import { describe, expect, it } from "vitest";
import { createDarwinSecretStore, SECURITY_TOOL } from "../src/plugin-settings";

// Item 551, 2026-11-18 — no fieldd test starts the keychain tool (test/keychain-guard.ts). Each row's first
// expectation reads the guard's marker on the module it calls through, and a row that then makes a call first holds
// that the guard refuses that call and that the function is the guard's own. So where the guard is missing, a row
// fails there and calls nothing. A refused row reads the record back, so the guard's own afterEach stays green. The
// rows that call by the bare name hand the call a PATH that holds no program.

interface RefusedCall {
  call: string;
  program: string;
  first: string | undefined;
  row: string | null;
}

/** The marker's shape (test/keychain-guard.ts). */
interface Guard {
  programs: readonly string[];
  reaches(args: readonly unknown[]): { program: string; first: string | undefined } | undefined;
  wraps(fn: unknown): boolean;
  take(): RefusedCall[];
  refusal(where: string, made: readonly RefusedCall[]): Error | undefined;
}

/** The guard on a module, read through its namespace: every row's first expectation. */
function guardOn(module: object): Guard {
  const marker: unknown = Reflect.get(module, "keychainGuard");
  expect(marker, "the keychain guard is on the module").toBeDefined();
  return marker as Guard;
}

/** A PATH with no program in it (the folder is never made). */
const NO_PROGRAMS = {
  PATH: join(dirname(fileURLToPath(import.meta.url)), "fixtures", "no-programs"),
};

describe("item 551: fieldd's tests never start the keychain tool", () => {
  it("names the tool by both its spellings, and a command string by its first word", () => {
    const guard = guardOn(childProcess);
    expect(guard.programs).toEqual([SECURITY_TOOL, "security"]);
    expect(guard.reaches([SECURITY_TOOL, ["help"]])).toEqual({
      program: SECURITY_TOOL,
      first: "help",
    });
    expect(guard.reaches(["security"])).toEqual({ program: "security", first: undefined });
    expect(guard.reaches(["security help -v"])).toEqual({ program: "security", first: "help" });
    expect(guard.reaches([` '${SECURITY_TOOL}'\thelp`])).toEqual({
      program: SECURITY_TOOL,
      first: "help",
    });
    expect(guard.reaches(['"security" "help"'])).toEqual({ program: "security", first: "help" });
    // a longer name, or the tool's name as an argument, is not the tool
    expect(guard.reaches([`${SECURITY_TOOL}d`, ["help"]])).toBeUndefined();
    expect(guard.reaches(["git", ["security"]])).toBeUndefined();
    expect(guard.take()).toEqual([]);
  });

  it("refuses the tool by its path before it starts, and keeps the call with this row", () => {
    const guard = guardOn(childProcess);
    expect(guard.reaches([SECURITY_TOOL, ["help"]])).toBeDefined();
    expect(guard.wraps(childProcess.spawn)).toBe(true);
    expect(() => childProcess.spawn(SECURITY_TOOL, ["help"])).toThrow(
      /^item 551: spawn of \/usr\/bin\/security is refused/u,
    );
    expect(guard.take()).toEqual([
      {
        call: "spawn",
        program: SECURITY_TOOL,
        first: "help",
        row: expect.stringMatching(
          /keychain-guard\.test\.ts > item 551: .+ > refuses the tool by its path/u,
        ),
      },
    ]);
  });

  it("refuses the default store's read, which answers UNAVAILABLE, and keeps the call", async () => {
    const guard = guardOn(childProcess);
    expect(guard.reaches([SECURITY_TOOL, ["find-generic-password"]])).toBeDefined();
    expect(guard.wraps(childProcess.spawn)).toBe(true);
    // the platform is named so the row reaches the runner everywhere; the tool and the runner are the defaults
    const store = createDarwinSecretStore({ platform: "darwin" });
    await expect(store.get("vibefield-item-551", "absent")).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "keychain", state: "refused" },
    });
    expect(guard.take()).toEqual([
      {
        call: "spawn",
        program: SECURITY_TOOL,
        first: "find-generic-password",
        row: expect.stringMatching(/ > refuses the default store's read/u),
      },
    ]);
  });

  it("refuses the bare name in each of the six calls, and as a command string, before any starts", () => {
    const guard = guardOn(childProcess);
    expect(guard.reaches(["security", ["help"]])).toBeDefined();
    expect(guard.reaches(["security help"])).toBeDefined();
    const env = NO_PROGRAMS;
    const tries: Array<{ name: string; fn: unknown; call: () => unknown }> = [
      {
        name: "spawn",
        fn: childProcess.spawn,
        call: () => childProcess.spawn("security", ["help"], { env }),
      },
      {
        name: "spawnSync",
        fn: childProcess.spawnSync,
        call: () => childProcess.spawnSync("security", ["help"], { env }),
      },
      {
        name: "execFile",
        fn: childProcess.execFile,
        call: () => childProcess.execFile("security", ["help"], { env }, () => undefined),
      },
      {
        name: "execFileSync",
        fn: childProcess.execFileSync,
        call: () => childProcess.execFileSync("security", ["help"], { env }),
      },
      {
        name: "exec",
        fn: childProcess.exec,
        call: () => childProcess.exec("security help", { env }, () => undefined),
      },
      {
        name: "execSync",
        fn: childProcess.execSync,
        call: () => childProcess.execSync("security help", { env }),
      },
    ];
    for (const { name, fn } of tries) expect(guard.wraps(fn), name).toBe(true);
    for (const { name, call } of tries) expect(call, name).toThrow(/^item 551: /u);
    expect(guard.take().map(({ call, program, first }) => [call, program, first])).toEqual(
      tries.map(({ name }) => [name, "security", "help"]),
    );
  });

  it("leaves every other program alone, and a promisified execFile still answers stdout and stderr", async () => {
    const guard = guardOn(childProcess);
    expect(guard.wraps(childProcess.execFileSync)).toBe(true);
    expect(guard.wraps(childProcess.execFile)).toBe(true);
    const say = ["-e", "process.stdout.write('ran')"];
    expect(childProcess.execFileSync(process.execPath, say, { encoding: "utf8" })).toBe("ran");
    const answer = await promisify(childProcess.execFile)(process.execPath, say);
    expect(answer).toMatchObject({ stdout: "ran", stderr: expect.any(String) });
    expect(guard.take()).toEqual([]);
  });

  it("guards the module's bare spelling too", () => {
    const guard = guardOn(childProcess);
    const bare = guardOn(bareChildProcess);
    expect(bare.programs).toEqual(guard.programs);
    expect(bare.wraps(bareChildProcess.spawn)).toBe(true);
    expect(guard.take()).toEqual([]);
  });

  it("fails a row by its name, with each call's program and first argument", () => {
    const guard = guardOn(childProcess);
    expect(guard.refusal('the row "a > b"', [])).toBeUndefined();
    const failure = guard.refusal('the row "a > b"', [
      { call: "spawn", program: SECURITY_TOOL, first: "find-generic-password", row: "a > b" },
      { call: "exec", program: "security", first: undefined, row: "a > b" },
    ]);
    expect(failure?.message).toBe(
      'item 551: the row "a > b" reached for the keychain tool (spawn /usr/bin/security ' +
        "find-generic-password; exec security). Hand it a store of its own: createDarwinSecretStore's " +
        "`run`, or the daemon's `secretStore`.",
    );
  });
});
