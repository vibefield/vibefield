import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

  it.skipIf(process.platform === "win32")(
    "hands Electron a fresh profile, removes it after, and exits with Electron's own code",
    () => {
      // Electron's own seam for its binary (`ELECTRON_OVERRIDE_DIST_PATH`): a stand-in that
      // writes into the profile it was handed, says what it saw, and exits 3.
      const dist = mkdtempSync(join(tmpdir(), "dk-5-fake-electron-"));
      try {
        const relative = readFileSync(
          join(
            dirname(createRequire(join(desktopRoot, "package.json")).resolve("electron")),
            "path.txt",
          ),
          "utf8",
        );
        const binary = join(dist, relative);
        mkdirSync(dirname(binary), { recursive: true });
        writeFileSync(
          binary,
          `#!${process.execPath}\n` +
            `const fs = require("node:fs"), path = require("node:path");\n` +
            `const args = process.argv.slice(2);\n` +
            `const dir = args.find((a) => a.startsWith("--user-data-dir=")).slice("--user-data-dir=".length);\n` +
            `fs.mkdirSync(path.join(dir, "Local Storage"), { recursive: true });\n` +
            `fs.writeFileSync(path.join(dir, "Preferences"), "{}");\n` +
            `process.stdout.write("FAKE_ELECTRON " + JSON.stringify({ args, wrote: fs.existsSync(path.join(dir, "Preferences")) }) + "\\n");\n` +
            `process.exit(3);\n`,
        );
        chmodSync(binary, 0o755);
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
