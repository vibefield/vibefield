import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  handedAsUserData,
  isolateSmokeProfile,
  isSmokeHome,
  SMOKE_HOME_PREFIX,
  SMOKE_PROFILE_PREFIX,
  sharedProfilePath,
  smokeHomeParent,
  userDataDirArg,
} from "../src/main/smoke-profile";
import { fakeElectron as installFakeElectron } from "./fake-electron";

// DK-5 — a smoke never touches the app's SHARED Electron profile: each run has its own,
// fresh under the OS temp and removed after it. Main's half holds the line for every
// smoke-like mode; the launcher's half (`apps/desktop/packaging/run-smoke.mjs`) mints,
// hands over and removes.

describe("main's smoke profile", () => {
  it("keeps the profile a run was handed — Electron already honors `--user-data-dir`", () => {
    const set: string[] = [];
    const profile = isolateSmokeProfile(
      "smoke-canvas",
      ["electron", ".", "--user-data-dir=/tmp/vf-smoke-profile-given", "--smoke-canvas"],
      { setUserData: (path) => set.push(path), mintDir: () => "/never" },
    );
    expect(profile).toEqual({
      userData: "/tmp/vf-smoke-profile-given",
      minted: false,
      home: false,
    });
    expect(set).toEqual([]);
  });

  it("BP-1c: a handed smoke HOME is known by its name — its data root is the same directory", () => {
    const profile = isolateSmokeProfile(
      "smoke-canvas",
      ["electron", ".", "--user-data-dir=/tmp/vf-smoke-hnUors", "--smoke-canvas"],
      { setUserData: () => undefined, mintDir: () => "/never" },
    );
    expect(profile).toEqual({ userData: "/tmp/vf-smoke-hnUors", minted: false, home: true });
  });

  it("BP-1c: a smoke home's name is the prefix and mkdtemp's six — never a profile alone or a scratch", () => {
    expect(SMOKE_HOME_PREFIX).toBe("vf-smoke-");
    expect(isSmokeHome("/tmp/vf-smoke-hnUors")).toBe(true);
    expect(isSmokeHome("/private/tmp/vf-smoke-A1b2C3")).toBe(true);
    expect(isSmokeHome("C:\\Users\\x\\AppData\\Local\\Temp\\vf-smoke-zp6IXf")).toBe(
      process.platform === "win32",
    );
    for (const not of [
      "/T/vf-smoke-profile-AbC123",
      "/tmp/vf-smoke-godview-o3xiDp",
      "/tmp/vf-smoke-",
      "/tmp/vf-smoke-abc",
      "/Users/x/Library/Application Support/VibeField",
      "/r/.vibefield/dev",
    ])
      expect(isSmokeHome(not), not).toBe(false);
  });

  it("BP-1c: a home lives under the short socket root — /tmp on Unix, the OS temp on Windows", () => {
    expect(smokeHomeParent("darwin")).toBe("/tmp");
    expect(smokeHomeParent("linux")).toBe("/tmp");
    expect(smokeHomeParent("win32")).toBe(tmpdir());
  });

  it("BP-1c: only the directory a run was handed as `--user-data-dir` is its launcher's to remove", () => {
    const argv = ["electron", ".", "--user-data-dir=/tmp/vf-smoke-hnUors", "--smoke"];
    expect(handedAsUserData("/tmp/vf-smoke-hnUors", argv)).toBe(true);
    expect(handedAsUserData("/tmp/vf-smoke-hnUors/", argv)).toBe(true);
    expect(handedAsUserData("/tmp/vf-smoke-other1", argv)).toBe(false);
    expect(handedAsUserData("/tmp/vf-smoke-hnUors", ["electron", "."])).toBe(false);
    // read as the filesystem names both: the users package roots the data under the real path
    const real = (p: string): string => p.replace(/^\/tmp\//u, "/private/tmp/");
    expect(handedAsUserData("/private/tmp/vf-smoke-hnUors", argv, real)).toBe(true);
  });

  it("mints its own and sets it as userData when a smoke-like run was handed none", () => {
    for (const mode of [
      "smoke",
      "smoke-godview",
      "smoke-plugin-restart",
      "terminal-perf-lab",
    ] as const) {
      const set: string[] = [];
      const profile = isolateSmokeProfile(mode, ["electron", "."], {
        setUserData: (path) => set.push(path),
        mintDir: () => `/tmp/${SMOKE_PROFILE_PREFIX}minted`,
      });
      expect(profile).toEqual({
        userData: `/tmp/${SMOKE_PROFILE_PREFIX}minted`,
        minted: true,
        home: false,
      });
      expect(set).toEqual([`/tmp/${SMOKE_PROFILE_PREFIX}minted`]);
    }
  });

  it("BP-1c: mints a smoke HOME under the short root by default — userData and data root in one", () => {
    const set: string[] = [];
    const profile = isolateSmokeProfile("smoke-canvas", [], { setUserData: (p) => set.push(p) });
    try {
      // by its real path (`/private/tmp` on macOS), as the users package roots the data in it
      expect(
        profile?.userData.startsWith(join(realpathSync(smokeHomeParent()), SMOKE_HOME_PREFIX)),
      ).toBe(true);
      expect(profile?.home).toBe(true);
      expect(set).toEqual([profile?.userData]);
      expect(existsSync(profile?.userData ?? "")).toBe(true);
    } finally {
      if (profile !== null) rmSync(profile.userData, { recursive: true, force: true });
    }
  });

  it("touches nothing for the app itself — production and dev keep their profiles", () => {
    for (const mode of ["production", "dev"] as const) {
      const set: string[] = [];
      expect(isolateSmokeProfile(mode, [], { setUserData: (p) => set.push(p) })).toBeNull();
      expect(set).toEqual([]);
    }
  });

  it("reads only the `=` spelling Chromium's switch parser reads", () => {
    expect(userDataDirArg(["--user-data-dir=/a"])).toBe("/a");
    expect(userDataDirArg(["--user-data-dir", "/a"])).toBeUndefined();
    expect(userDataDirArg(["--user-data-dir="])).toBeUndefined();
    expect(sharedProfilePath("/Users/x/Library/Application Support", "VibeField")).toBe(
      "/Users/x/Library/Application Support/VibeField",
    );
  });
});

describe("the smoke launcher (apps/desktop/packaging/run-smoke.mjs)", () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/desktop");
  const launcher = join(desktopRoot, "packaging", "run-smoke.mjs");
  /** The stand-in Electron, resolved as this launcher resolves it (`fake-electron.ts`: Electron's own seam). */
  const fakeElectron = (dist: string, body: string): void =>
    installFakeElectron(launcher, dist, body);
  /** Item 93 (2026-10-31): a daemon the launcher SIGTERMed and its census counted gone can still answer `kill(pid, 0)`
   * as a zombie (its parent, the stand-in, had exited, and launchd had not yet reaped it). A zombie holds no work and
   * carries no mark (`ps -E` shows it no environment), so the census is right to count it gone, and so is this. A pid
   * `ps` shows nothing is gone too: launchd can reap the zombie between the two reads. */
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
    } catch {
      return false;
    }
    const ps = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
    const stat = ps.stdout.trim();
    return stat !== "" && !stat.startsWith("Z");
  };
  // *Measured 2026-10-29 (item 93):* each row below resolves Electron's binary in a node child (37 ms here), then runs
  // the launcher as a smoke does. The launcher and the stand-in are node starts (34 ms each), with one more node in two
  // of the rows. The stand-in waits 300 ms in the LEFT row. Then the census runs (`smoke-daemons.mjs`): 124 ms with
  // nothing left and 239 ms with a daemon left, alone on a quiet host. The census is the part a loaded host stretches.
  // Its read of the whole process table, every environment with it, grows with the host. Before item 93 it made two of
  // those reads per look, four or more in the LEFT row.
  // In this Mac's logged suites since 10-20 (121 runs), the LEFT row took a median 2201 ms (p90 3568, the greens' worst
  // 4991) and was red four times past 5 s, at up to 9144 ms. The other two rows' medians were 1.2 and 1.1 s, and their
  // worst were 3598 and 6432 ms (the one red). Alone ×5 at load 13–16 the three took 879–979, 505–597 and 477–689 ms
  // (main's census: 1191–1311, 580–687, 556–665). The rows are synchronous (`spawnSync`), so vitest's timer fires only
  // when one resolves (`@vitest/runner` 3.2.7, chunk-hooks.js:1880–1886).
  // 15 s is more than 1.6 times the worst any of them took here, with the census as it was.
  const LAUNCHER_ROW_BUDGET_MS = 15_000;

  it("DK-18 (39): asks `ps` in the platform's own spelling — macOS's BSD flags as ever, procps's on Linux", async () => {
    // procps refuses `-axww` ("must set personality to get -x option") and has no `-E`; macOS reads a bare `e` as every
    // process, never the environment — so neither spelling serves both (the affected job, ubuntu-latest, 2026-10-29).
    // The census's three reads (item 93): the whole table with the environment once, then one pid at a time
    type Spelling = { table: string[]; one: string[]; oneWithEnv: string[] };
    const { psTables } = (await import(
      pathToFileURL(join(desktopRoot, "packaging", "smoke-daemons.mjs")).href
    )) as { psTables: (platform: string) => Spelling };
    expect(psTables("darwin")).toEqual({
      table: ["-axww", "-E"],
      one: ["-ww"],
      oneWithEnv: ["-ww", "-E"],
    });
    expect(psTables("linux")).toEqual({ table: ["axwwe"], one: ["-ww"], oneWithEnv: ["wwe"] });
  });

  it.skipIf(process.platform === "win32")(
    "DK-18 (39): marks the run, and a daemon the smoke LEFT is found by the mark, reaped, and makes the run red",
    { timeout: LAUNCHER_ROW_BUDGET_MS },
    () => {
      // the stand-in starts a DETACHED daemon (it inherits the run's mark, as fieldd and field-native do) and exits 0
      const dist = mkdtempSync(join(tmpdir(), "dk-18-fake-electron-"));
      let daemon = 0;
      try {
        fakeElectron(
          dist,
          `const { spawn } = require("node:child_process");\n` +
            `const d = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { detached: true, stdio: "ignore" });\n` +
            `d.unref();\n` +
            `process.stdout.write("FAKE_ELECTRON " + JSON.stringify({ mark: process.env.VF_SMOKE_RUN ?? null, daemon: d.pid }) + "\\n");\n` +
            `setTimeout(() => process.exit(0), 300);\n`,
        );
        const run = spawnSync(process.execPath, [launcher, "--smoke-canvas"], {
          cwd: desktopRoot,
          encoding: "utf8",
          env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: dist },
        });
        const seen = JSON.parse(/FAKE_ELECTRON (.*)/.exec(run.stdout)?.[1] ?? "null") as {
          mark: string | null;
          daemon: number;
        };
        daemon = seen.daemon;
        // the mark is the run's profile name
        const removed = JSON.parse(
          /SMOKE_PROFILE_REMOVED (.*)/.exec(run.stdout)?.[1] ?? "null",
        ) as {
          userData: string;
        };
        expect(seen.mark).toBe(removed.userData.slice(removed.userData.lastIndexOf("/") + 1));
        const row = JSON.parse(/SMOKE_DAEMONS (.*)/.exec(run.stdout)?.[1] ?? "null") as {
          left: { pid: number; name: string }[];
          reaped: number[];
        };
        expect(row.left).toEqual([{ pid: seen.daemon, name: "node" }]);
        expect(row.reaped).toEqual([seen.daemon]);
        // red although Electron said 0, and nothing left alive
        expect(run.status).toBe(1);
        expect(alive(seen.daemon)).toBe(false);
      } finally {
        if (daemon > 0 && alive(daemon)) process.kill(daemon, "SIGKILL");
        rmSync(dist, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "DK-18 (39): a run whose processes all went with it keeps Electron's code — the row finds nothing",
    { timeout: LAUNCHER_ROW_BUDGET_MS },
    () => {
      const dist = mkdtempSync(join(tmpdir(), "dk-18-fake-electron-"));
      try {
        fakeElectron(
          dist,
          `const { spawnSync } = require("node:child_process");\n` +
            `spawnSync(process.execPath, ["-e", "0"]);\n` +
            `process.exit(0);\n`,
        );
        const run = spawnSync(process.execPath, [launcher, "--smoke-canvas"], {
          cwd: desktopRoot,
          encoding: "utf8",
          env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: dist },
        });
        const row = JSON.parse(/SMOKE_DAEMONS (.*)/.exec(run.stdout)?.[1] ?? "null") as {
          left: unknown[];
        };
        expect(row.left).toEqual([]);
        expect(run.status).toBe(0);
      } finally {
        rmSync(dist, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "hands Electron a fresh profile, removes it after, and exits with Electron's own code",
    { timeout: LAUNCHER_ROW_BUDGET_MS },
    () => {
      // Electron's own seam for its binary (`ELECTRON_OVERRIDE_DIST_PATH`): a stand-in that
      // writes into the profile it was handed, says what it saw, and exits 3.
      const dist = mkdtempSync(join(tmpdir(), "dk-5-fake-electron-"));
      try {
        fakeElectron(
          dist,
          `const fs = require("node:fs"), path = require("node:path");\n` +
            `const args = process.argv.slice(2);\n` +
            `const dir = args.find((a) => a.startsWith("--user-data-dir=")).slice("--user-data-dir=".length);\n` +
            `fs.mkdirSync(path.join(dir, "Local Storage"), { recursive: true });\n` +
            `fs.writeFileSync(path.join(dir, "Preferences"), "{}");\n` +
            `process.stdout.write("FAKE_ELECTRON " + JSON.stringify({ args, wrote: fs.existsSync(path.join(dir, "Preferences")) }) + "\\n");\n` +
            `process.exit(3);\n`,
        );
        const run = spawnSync(process.execPath, [launcher, "--smoke-canvas", "--disable-gpu"], {
          cwd: desktopRoot,
          encoding: "utf8",
          env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: dist },
        });
        expect(run.status).toBe(3);
        const seen = JSON.parse(/FAKE_ELECTRON (.*)/.exec(run.stdout)?.[1] ?? "null") as {
          args: string[];
          wrote: boolean;
        };
        expect(seen.wrote).toBe(true);
        expect(seen.args[0]).toBe(desktopRoot);
        expect(seen.args.slice(2)).toEqual(["--smoke-canvas", "--disable-gpu"]);
        const profile = (seen.args[1] ?? "").slice("--user-data-dir=".length);
        // BP-1c: the profile is the run's smoke HOME, under the short socket root
        expect(profile.startsWith(join(realpathSync(smokeHomeParent()), SMOKE_HOME_PREFIX))).toBe(
          true,
        );
        expect(isSmokeHome(profile)).toBe(true);
        // red, but main never reached its data root in it (no logs, no users.json): removed whole
        const removed = JSON.parse(/SMOKE_PROFILE_REMOVED (.*)/.exec(run.stdout)?.[1] ?? "null");
        expect(removed).toEqual({ userData: profile, removed: true });
        expect(existsSync(profile)).toBe(false);
      } finally {
        rmSync(dist, { recursive: true, force: true });
      }
    },
  );

  /** A stand-in that writes what main writes into a smoke home it roots its data in (its logs, the users file) beside
   * Chromium's own, then exits with `code`. */
  const homeWriter = (code: number): string =>
    `const fs = require("node:fs"), path = require("node:path");\n` +
    `const dir = process.argv.slice(2).find((a) => a.startsWith("--user-data-dir=")).slice("--user-data-dir=".length);\n` +
    `fs.mkdirSync(path.join(dir, "logs"), { recursive: true });\n` +
    `fs.writeFileSync(path.join(dir, "users.json"), "{}");\n` +
    `fs.writeFileSync(path.join(dir, "Preferences"), "{}");\n` +
    `process.exit(${code});\n`;
  const runWith = (dist: string, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [launcher, "--smoke-canvas"], {
      cwd: desktopRoot,
      encoding: "utf8",
      env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: dist, ...env },
    });
  const settled = (stdout: string) =>
    JSON.parse(/SMOKE_PROFILE_REMOVED (.*)/.exec(stdout)?.[1] ?? "null") as {
      userData: string;
      removed: boolean;
      kept?: string;
    };

  it.skipIf(process.platform === "win32")(
    "BP-1c: a RED run whose home holds main's data root keeps it whole — its logs are the run's evidence — and keeps Electron's code",
    { timeout: LAUNCHER_ROW_BUDGET_MS },
    () => {
      const dist = mkdtempSync(join(tmpdir(), "bp-1c-fake-electron-"));
      let home = "";
      try {
        fakeElectron(dist, homeWriter(2));
        const run = runWith(dist);
        const said = settled(run.stdout);
        home = said.userData;
        expect(said).toEqual({ userData: home, removed: false, kept: "red" });
        expect(existsSync(join(home, "logs"))).toBe(true);
        expect(run.status).toBe(2);
      } finally {
        if (home !== "") rmSync(home, { recursive: true, force: true });
        rmSync(dist, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "BP-1c: a run asked to keep its root (smoke:profile's phase A) keeps the home whole and stays green",
    { timeout: LAUNCHER_ROW_BUDGET_MS },
    () => {
      const dist = mkdtempSync(join(tmpdir(), "bp-1c-fake-electron-"));
      let home = "";
      try {
        fakeElectron(dist, homeWriter(0));
        const run = runWith(dist, { VF_SMOKE_KEEP_ROOT: "1" });
        const said = settled(run.stdout);
        home = said.userData;
        expect(said).toEqual({ userData: home, removed: false, kept: "asked" });
        expect(existsSync(join(home, "users.json"))).toBe(true);
        expect(run.status).toBe(0);
      } finally {
        if (home !== "") rmSync(home, { recursive: true, force: true });
        rmSync(dist, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "BP-1c: a GREEN run's home is removed whole, whatever main left in it",
    { timeout: LAUNCHER_ROW_BUDGET_MS },
    () => {
      const dist = mkdtempSync(join(tmpdir(), "bp-1c-fake-electron-"));
      try {
        fakeElectron(dist, homeWriter(0));
        const run = runWith(dist);
        const said = settled(run.stdout);
        expect(said).toEqual({ userData: said.userData, removed: true });
        expect(existsSync(said.userData)).toBe(false);
        expect(run.status).toBe(0);
      } finally {
        rmSync(dist, { recursive: true, force: true });
      }
    },
  );
});

describe("the smoke home's settling (apps/desktop/packaging/smoke-profile.mjs) — BP-1c", () => {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/desktop");
  type Settle = (
    home: string,
    outcome: { code: number; keepRoot: boolean },
    fs: { existsSync: (p: string) => boolean; rmSync: (p: string, o: unknown) => void },
  ) => { userData: string; removed: boolean; kept?: string };
  const load = async () =>
    (await import(pathToFileURL(join(desktopRoot, "packaging", "smoke-profile.mjs")).href)) as {
      settleSmokeHome: Settle;
      DATA_ROOT_MARKS: readonly string[];
      SMOKE_HOME_PREFIX: string;
      smokeHomeParent: (platform?: string) => string;
    };
  /** A home whose entries are `names`; removing it empties it. */
  const fakeFs = (home: string, names: string[]) => {
    const there = new Set(names.map((n) => join(home, n)));
    let gone = false;
    return {
      removed: () => gone,
      existsSync: (p: string) => !gone && (p === home || there.has(p)),
      rmSync: (p: string) => {
        if (p === home) gone = true;
      },
    };
  };

  it("keeps a home only for main's data root, on a red run or one that asked", async () => {
    const { settleSmokeHome, DATA_ROOT_MARKS } = await load();
    expect(DATA_ROOT_MARKS).toEqual(["logs", "users.json"]);
    const home = "/tmp/vf-smoke-hnUors";
    for (const [names, outcome, kept] of [
      [["logs", "Preferences"], { code: 2, keepRoot: false }, "red"],
      [["users.json"], { code: 0, keepRoot: true }, "asked"],
      [["users.json", "logs"], { code: 1, keepRoot: true }, "asked"],
    ] as const) {
      const fs = fakeFs(home, [...names]);
      expect(settleSmokeHome(home, outcome, fs)).toEqual({ userData: home, removed: false, kept });
      expect(fs.removed()).toBe(false);
    }
  });

  it("removes it whole otherwise: a green run, or a red one that never reached its data root", async () => {
    const { settleSmokeHome } = await load();
    const home = "/tmp/vf-smoke-hnUors";
    for (const [names, outcome] of [
      [["logs", "users.json", "Preferences"], { code: 0, keepRoot: false }],
      [["Preferences", "Local State"], { code: 3, keepRoot: false }],
      [["Preferences"], { code: 0, keepRoot: true }],
    ] as const) {
      const fs = fakeFs(home, [...names]);
      expect(settleSmokeHome(home, outcome, fs)).toEqual({ userData: home, removed: true });
      expect(fs.removed()).toBe(true);
    }
  });

  it("names its homes as main does, under the same short root", async () => {
    const { SMOKE_HOME_PREFIX: launcherPrefix, smokeHomeParent: launcherParent } = await load();
    expect(launcherPrefix).toBe(SMOKE_HOME_PREFIX);
    for (const platform of ["darwin", "linux", "win32"] as const)
      expect(launcherParent(platform)).toBe(smokeHomeParent(platform));
  });
});
