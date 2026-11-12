import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as loginShell from "../src/main/login-shell";
import { tempDir } from "./temp-dir";

// ESP-18 (item 341) — a packaged pair runs with the person's PATH. A Mac app
// opened from the Dock, the Finder or its updater inherits launchd's short
// PATH; a pair spawned with it found no agent on nightly-20261110.1. In
// `production` alone, main asks the person's login shell for PATH once and
// hands the pair that one key. These rows hold the resolve to its bounds:
// what is asked, what is read back, what is kept, what is said, and when it
// gives up; and the production spawn to its cap. No row reads a real
// environment or a real rc file, and a red prints no environment (item 320):
// the rows that could, 10, 22 and 25, assert by key names and booleans only.
// Each temp root is the package's `tempDir()`, removed when its row ends.

const {
  PERSON_PATH_CEILING_MS,
  PERSON_PATH_MARK: M,
  PERSON_PATH_STDOUT_CAP,
  fallbackPersonPath,
  parsePersonPath,
  personPathChildEnvironment,
  personPathCommand,
  personPathOnce,
  resolvePersonPath,
  spawnPersonPathChild,
} = loginShell;
type Options = loginShell.ResolvePersonPathOptions;
type Exit = { code: number | null; stdout: string };

const LAUNCHD_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const SHIMS = "/Users/pat/Library/Application Support/VibeField/users/1/agents/shims";

afterEach(() => {
  vi.useRealTimers();
});

/** A login shell that answers as told; it records each spawn and each kill. */
function fakeSpawn(answer: Exit | "never" | "throw") {
  const calls: { shell: string; args: readonly string[] }[] = [];
  let kills = 0;
  const spawn: loginShell.PersonPathSpawn = (shell, args) => {
    calls.push({ shell, args });
    if (answer === "throw") throw new Error("spawn EACCES");
    return {
      done: answer === "never" ? new Promise<Exit>(() => undefined) : Promise.resolve(answer),
      killGroup: () => {
        kills += 1;
      },
    };
  };
  return { spawn, calls, kills: () => kills };
}

/** The resolve's log, kept. */
function fakeLog() {
  const events: { event: string; attrs: Record<string, unknown> | undefined }[] = [];
  const log: loginShell.PersonPathLog = {
    info: (event, _message, attrs) => {
      events.push({ event, attrs });
    },
  };
  return { log, events };
}

function options(overrides: Partial<Options> & Pick<Options, "spawn">): Options {
  return {
    mode: "production",
    platform: "darwin",
    shell: "/bin/zsh",
    home: "/Users/pat",
    env: { PATH: LAUNCHD_PATH, HOME: "/Users/pat" },
    exists: (path) => path === "/opt/homebrew/bin",
    now: () => 0,
    log: fakeLog().log,
    shimDirectories: [SHIMS],
    ...overrides,
  };
}

describe("personPathCommand — what the login shell is asked", () => {
  it("asks zsh, bash and ksh for PATH alone, between two marks, with no history kept", () => {
    for (const shell of ["/bin/zsh", "/bin/bash", "/bin/ksh", "/opt/homebrew/bin/bash"]) {
      expect(personPathCommand(shell)).toEqual([
        "-l",
        "-i",
        "-c",
        `unset HISTFILE; printf %s ${M}; /usr/bin/printenv PATH; printf %s ${M}`,
      ]);
    }
  });

  it("asks fish the same, its own history set off first", () => {
    expect(personPathCommand("/opt/homebrew/bin/fish")).toEqual([
      "-l",
      "-i",
      "-c",
      `set fish_history ''; printf %s ${M}; /usr/bin/printenv PATH; printf %s ${M}`,
    ]);
  });

  it("asks no other shell anything", () => {
    for (const shell of ["/bin/tcsh", "/bin/csh", "/bin/sh", "/opt/homebrew/bin/nu", "xonsh"]) {
      expect(personPathCommand(shell)).toBeUndefined();
    }
  });
});

describe("parsePersonPath — what is read back, and what is kept", () => {
  const read = (between: string, before = "", after = "") =>
    parsePersonPath(`${before}${M}${between}${M}${after}`, { shimDirectories: [SHIMS] });

  it("reads only between the marks: an rc's banner and prompt are never read", () => {
    expect(read("/opt/homebrew/bin:/usr/bin\n", "Welcome /fake/banner/bin:\n", "% ")).toEqual([
      "/opt/homebrew/bin",
      "/usr/bin",
    ]);
  });

  it("answers nothing without two marks, or with nothing between them", () => {
    const opts = { shimDirectories: [SHIMS] };
    expect(parsePersonPath("a banner and no marks", opts)).toBeUndefined();
    expect(parsePersonPath(`${M}/usr/bin`, opts)).toBeUndefined();
    expect(read(" \n")).toBeUndefined();
  });

  it("keeps absolute directories only: no empty entry, '.', relative entry or control", () => {
    expect(read("/a::.:rel/bin:/b\u0007x:/c")).toEqual(["/a", "/c"]);
  });

  it("keeps the first of two equal entries", () => {
    expect(read("/a:/b:/a")).toEqual(["/a", "/b"]);
  });

  it("never hands back VibeField's own launcher directories", () => {
    expect(read(`/a:${SHIMS}:${SHIMS}/:/b`)).toEqual(["/a", "/b"]);
  });

  it("keeps at most 256 entries and 16 KiB", () => {
    const many = Array.from({ length: 300 }, (_, i) => `/d/${i}`);
    const kept = read(many.join(":"));
    expect(kept?.length).toBe(256);
    expect(kept?.[0]).toBe("/d/0");
    expect(kept?.[255]).toBe("/d/255");
    const long = Array.from({ length: 40 }, (_, i) => `/${String(i).padStart(999, "x")}`);
    const bounded = read(long.join(":"));
    expect(bounded?.length).toBe(16);
    expect((bounded ?? []).join(":").length <= 16 * 1024).toBe(true);
  });
});

describe("personPathChildEnvironment — the child's environment", () => {
  it("drops VibeField's own variables, and keeps no history file", () => {
    const child = personPathChildEnvironment({
      PATH: LAUNCHD_PATH,
      HOME: "/Users/pat",
      LANG: "en_US.UTF-8",
      FIELD_LOG_DIR: "fixture",
      FIELDD_ALLOW_LOG_DIR_OVERRIDE: "fixture",
      VIBEFIELD_DEV_BUILD_ID: "fixture",
      VF_SMOKE_RUN: "fixture",
      HISTFILE: "/Users/pat/.zsh_history",
      TERM: "xterm-256color",
      UNSET: undefined,
    });
    // key names and the two values set, never the object (item 320)
    expect(Object.keys(child).sort()).toEqual(["HISTFILE", "HOME", "LANG", "PATH", "TERM"]);
    expect(child["HISTFILE"] === "/dev/null").toBe(true);
    expect(child["TERM"] === "dumb").toBe(true);
  });
});

describe("fallbackPersonPath — when the login shell does not answer", () => {
  it("keeps main's PATH, then adds the common install folders that exist, in order", () => {
    const exists = (path: string) =>
      path === "/opt/homebrew/bin" || path === "/Users/pat/.local/bin";
    expect(fallbackPersonPath("/usr/bin:/bin:/usr/bin::rel", "/Users/pat", exists)).toEqual([
      "/usr/bin",
      "/bin",
      "/opt/homebrew/bin",
      "/Users/pat/.local/bin",
    ]);
    expect(fallbackPersonPath("/opt/homebrew/bin", "/Users/pat", exists)).toEqual([
      "/opt/homebrew/bin",
      "/Users/pat/.local/bin",
    ]);
    expect(fallbackPersonPath(undefined, "/Users/pat", () => false)).toEqual([]);
  });
});

describe("resolvePersonPath — the resolve", () => {
  const ok: Exit = { code: 0, stdout: `Welcome\n${M}/opt/homebrew/bin:/usr/bin\n${M}% ` };

  it("asks the login shell once in production and answers what it said", async () => {
    const fake = fakeSpawn(ok);
    const clock = [1_000, 1_042];
    const now = () => clock.shift() ?? 1_042;
    const answer = await resolvePersonPath(options({ spawn: fake.spawn, now }));
    expect(fake.calls.length).toBe(1);
    expect(fake.calls[0]?.shell).toBe("/bin/zsh");
    expect(fake.calls[0]?.args).toEqual(personPathCommand("/bin/zsh"));
    expect(answer).toEqual({
      path: "/opt/homebrew/bin:/usr/bin",
      source: "login-shell",
      dirs: 2,
      ms: 42,
    });
  });

  it("asks nothing in development or any smoke-like mode: they keep their own PATH", async () => {
    const modes = [
      "dev",
      "smoke",
      "smoke-canvas",
      "smoke-plugin-restart",
      "smoke-godview",
      "smoke-first-run",
      "live-surfaces-lab",
      "terminal-perf-lab",
      "godview-perf-lab",
      "terminal-door-probe",
      "spike-loro",
    ];
    for (const mode of modes) {
      const fake = fakeSpawn(ok);
      const said = fakeLog();
      const answer = await resolvePersonPath(options({ mode, spawn: fake.spawn, log: said.log }));
      expect(answer).toBe(undefined);
      expect(fake.calls.length).toBe(0);
      expect(said.events.length).toBe(0);
    }
  });

  it("asks nothing on Windows, where an app gets the person's PATH already", async () => {
    const fake = fakeSpawn(ok);
    const answer = await resolvePersonPath(options({ platform: "win32", spawn: fake.spawn }));
    expect(answer).toBe(undefined);
    expect(fake.calls.length).toBe(0);
  });

  it("gives up at the ceiling: the child's group is ended and the fallback answers", async () => {
    vi.useFakeTimers();
    const fake = fakeSpawn("never");
    const pending = resolvePersonPath(options({ spawn: fake.spawn, now: () => Date.now() }));
    let settled = false;
    pending.then(
      () => {
        settled = true;
      },
      () => undefined,
    );
    await vi.advanceTimersByTimeAsync(PERSON_PATH_CEILING_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const answer = await pending;
    expect(settled).toBe(true);
    expect(fake.kills()).toBe(1);
    expect(answer?.source).toBe("fallback");
    expect(answer?.why).toBe("timeout");
    expect(answer?.path).toBe(`${LAUNCHD_PATH}:/opt/homebrew/bin`);
  });

  it("answers the fallback when the login shell exits non-zero", async () => {
    const fake = fakeSpawn({ code: 1, stdout: ok.stdout });
    const answer = await resolvePersonPath(options({ spawn: fake.spawn }));
    expect(answer?.source).toBe("fallback");
    expect(answer?.why).toBe("exit");
  });

  it("answers the fallback when the login shell printed no marks", async () => {
    const fake = fakeSpawn({ code: 0, stdout: "an rc that exec'd something else" });
    const answer = await resolvePersonPath(options({ spawn: fake.spawn }));
    expect(answer?.source).toBe("fallback");
    expect(answer?.why).toBe("no-mark");
  });

  it("never spawns a shell it does not ask, and answers the fallback", async () => {
    const fake = fakeSpawn(ok);
    const answer = await resolvePersonPath(options({ shell: "/bin/tcsh", spawn: fake.spawn }));
    expect(fake.calls.length).toBe(0);
    expect(answer?.source).toBe("fallback");
    expect(answer?.why).toBe("unsupported-shell");
  });

  it("answers the fallback when the spawn itself fails", async () => {
    const fake = fakeSpawn("throw");
    const answer = await resolvePersonPath(options({ spawn: fake.spawn }));
    expect(fake.calls.length).toBe(1);
    expect(answer?.source).toBe("fallback");
    expect(answer?.why).toBe("spawn-failed");
  });

  it("says one event, with its source, reason and counts, and never a directory", async () => {
    const said = fakeLog();
    const fake = fakeSpawn({ code: 0, stdout: `${M}/sentinel-341/bin:/usr/bin${M}` });
    await resolvePersonPath(options({ spawn: fake.spawn, log: said.log }));
    expect(said.events.map((e) => e.event)).toEqual(["desktop.person_path.resolved"]);
    const keys = Object.keys(said.events[0]?.attrs ?? {});
    expect(keys.every((key) => ["dirs", "ms", "source", "why"].includes(key))).toBe(true);
    expect(JSON.stringify(said.events).includes("sentinel-341")).toBe(false);
  });
});

describe("personPathOnce — one answer per shell process", () => {
  it("asks once, whatever the number of pairs and respawns that want it", async () => {
    const answer: loginShell.PersonPath = {
      path: "/usr/bin",
      source: "login-shell",
      dirs: 1,
      ms: 5,
    };
    let asked = 0;
    const once = personPathOnce(async () => {
      asked += 1;
      return answer;
    });
    const [a, b] = await Promise.all([once(), once()]);
    const c = await once();
    expect(asked).toBe(1);
    expect(a === answer && b === answer && c === answer).toBe(true);
  });
});

const zsh = process.platform !== "win32" && existsSync("/bin/zsh");

describe.skipIf(!zsh)("the real /bin/zsh, with nothing of anyone's read", () => {
  it("reads the PATH its rc builds, not its banner, and leaves no history file", async () => {
    // the resolve settles only once the child is gone, at its close or at the ceiling's group kill,
    // so nothing of the child's lives when `tempDir` removes this root as the row ends
    const home = tempDir("vf-person-path-");
    const stub = join(home, "stub-bin");
    mkdirSync(stub);
    // the global rc files are off (no path_helper), so the PATH is launchd's plus the stub's
    writeFileSync(join(home, ".zshenv"), "unsetopt GLOBAL_RCS\n");
    writeFileSync(
      join(home, ".zshrc"),
      [
        "echo VF-341-BANNER",
        'HISTFILE="$ZDOTDIR/.zsh_history"',
        "SAVEHIST=100",
        "HISTSIZE=100",
        `export PATH="${stub}:$PATH"`,
        "",
      ].join("\n"),
    );
    const answer = await resolvePersonPath({
      mode: "production",
      platform: process.platform,
      shell: "/bin/zsh",
      home,
      env: { PATH: LAUNCHD_PATH, HOME: home, ZDOTDIR: home, SHELL: "/bin/zsh" },
      spawn: spawnPersonPathChild,
      exists: existsSync,
      now: Date.now,
      log: fakeLog().log,
      shimDirectories: [],
      ceilingMs: 10_000,
    });
    // booleans only: a red prints no PATH (item 320)
    const dirs = answer?.path.split(":") ?? [];
    expect(answer?.source === "login-shell").toBe(true);
    expect(dirs[0] === stub).toBe(true);
    expect(dirs.includes("/usr/bin")).toBe(true);
    expect(answer?.path.includes("VF-341-BANNER") === true).toBe(false);
    expect(existsSync(join(home, ".zsh_history"))).toBe(false);
  });
});

const sh = process.platform !== "win32" && existsSync("/bin/sh");

describe.skipIf(!sh)("spawnPersonPathChild — the production spawn", () => {
  it("holds at most the cap of what it prints, and ends its whole group there", async () => {
    // 200 000 bytes on stdout, then a sleep that outlives the row's bound: only the cap is ever
    // held, and the group's kill at the cap ends the sleep too. `done` settles on the close, when
    // every process holding the child's stdout has let go of it, so a quick settle IS the proof
    // that none of the group lives (no process listing is read)
    const started = Date.now();
    const child = spawnPersonPathChild(
      "/bin/sh",
      ["-c", "head -c 200000 /dev/zero | tr '\\000' x; sleep 5"],
      { PATH: LAUNCHD_PATH },
    );
    const exit = await child.done;
    const took = Date.now() - started;
    expect(exit.stdout.length === PERSON_PATH_STDOUT_CAP).toBe(true);
    expect(/^x*$/.test(exit.stdout)).toBe(true);
    expect(exit.code === null).toBe(true);
    expect(took < 2_500).toBe(true);
  }, 10_000);
});
