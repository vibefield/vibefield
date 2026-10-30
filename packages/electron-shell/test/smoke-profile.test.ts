import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isolateSmokeProfile,
  SMOKE_PROFILE_PREFIX,
  sharedProfilePath,
  userDataDirArg,
} from "../src/main/smoke-profile";

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
    expect(profile).toEqual({ userData: "/tmp/vf-smoke-profile-given", minted: false });
    expect(set).toEqual([]);
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
      expect(profile).toEqual({ userData: `/tmp/${SMOKE_PROFILE_PREFIX}minted`, minted: true });
      expect(set).toEqual([`/tmp/${SMOKE_PROFILE_PREFIX}minted`]);
    }
  });

  it("mints under the OS temp by default", () => {
    const set: string[] = [];
    const profile = isolateSmokeProfile("smoke-canvas", [], { setUserData: (p) => set.push(p) });
    try {
      expect(profile?.userData.startsWith(join(tmpdir(), SMOKE_PROFILE_PREFIX))).toBe(true);
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
  /** Electron's own seam for its binary (`ELECTRON_OVERRIDE_DIST_PATH`): a stand-in Node script at the path Electron's
   * package names, run in `dist`; the launcher spawns it as it would Electron. The path is asked of Electron's package
   * in a child, exactly as the launcher asks it. Under the override it names `<dist>/<path.txt>` when the binary is
   * installed and `<dist>/electron` when it is not, and never downloads, so these rows need no binary. They once read
   * path.txt themselves, a file only the download writes. Electron 43 has no postinstall, so on a fresh install it
   * appears at the run's first plain `require("electron")`, and the rows raced that (CI's verify 40333930954,
   * 2026-10-26). */
  const fakeElectron = (dist: string, body: string): void => {
    const resolved = spawnSync(
      process.execPath,
      [
        "-e",
        'process.stdout.write(require("node:module").createRequire(process.argv[1])("electron"))',
        launcher,
      ],
      { encoding: "utf8", env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: dist } },
    );
    if (resolved.status !== 0) {
      throw new Error(`Electron's package does not resolve from the launcher: ${resolved.stderr}`);
    }
    const binary = resolved.stdout;
    mkdirSync(dirname(binary), { recursive: true });
    writeFileSync(binary, `#!${process.execPath}\n${body}`);
    chmodSync(binary, 0o755);
  };
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it("DK-18 (39): asks `ps` in the platform's own spelling — macOS's BSD flags as ever, procps's on Linux", async () => {
    // procps refuses `-axww` ("must set personality to get -x option") and has no `-E`; macOS reads a bare `e` as every
    // process, never the environment — so neither spelling serves both (the affected job, ubuntu-latest, 2026-10-29)
    const { psTables } = (await import(
      pathToFileURL(join(desktopRoot, "packaging", "smoke-daemons.mjs")).href
    )) as { psTables: (platform: string) => { withEnv: string[]; plain: string[] } };
    expect(psTables("darwin")).toEqual({
      withEnv: ["-axww", "-E", "-o", "pid=,ppid=,command="],
      plain: ["-axww", "-o", "pid=,ppid=,command="],
    });
    expect(psTables("linux")).toEqual({
      withEnv: ["axwwe", "-o", "pid=,ppid=,command="],
      plain: ["axww", "-o", "pid=,ppid=,command="],
    });
  });

  it.skipIf(process.platform === "win32")(
    "DK-18 (39): marks the run, and a daemon the smoke LEFT is found by the mark, reaped, and makes the run red",
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
        expect(profile.startsWith(join(tmpdir(), SMOKE_PROFILE_PREFIX))).toBe(true);
        const removed = JSON.parse(/SMOKE_PROFILE_REMOVED (.*)/.exec(run.stdout)?.[1] ?? "null");
        expect(removed).toEqual({ userData: profile, removed: true });
        expect(existsSync(profile)).toBe(false);
      } finally {
        rmSync(dist, { recursive: true, force: true });
      }
    },
  );
});
