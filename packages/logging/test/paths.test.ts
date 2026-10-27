import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pairLogRoot, pairLogRoots, resolvePlatformLogRoot } from "../src/index";

// Item 78 (UA-D16 reversed 2026-10-27; LOG §6.5, §7.1) — a user's daemon pair logs under its own root, DERIVED from the
// user root's shape; field-native's resolver (config.rs) derives the same, row for row.
describe("a user's pair log root", () => {
  it("is users/<fuid> under the platform root, read off the user root", () => {
    expect(
      pairLogRoot(
        "/Users/test/Library/Logs/VibeField",
        "/Users/test/Library/Application Support/VibeField/users/2",
        "darwin",
      ),
    ).toBe("/Users/test/Library/Logs/VibeField/users/2");
    expect(pairLogRoot("/state/vibefield/logs", "/data/VibeField/users/1/", "linux")).toBe(
      "/state/vibefield/logs/users/1",
    );
    expect(
      pairLogRoot(
        "D:\\Local\\VibeField\\Logs",
        "C:\\Users\\t\\AppData\\Roaming\\VibeField\\users\\12",
        "win32",
      ),
    ).toBe("D:\\Local\\VibeField\\Logs\\users\\12");
  });

  it("is the platform root itself for a data dir of any other shape (tests, injected roots)", () => {
    for (const userRoot of [
      "/tmp/vf-test-abc",
      "/data/VibeField/users/abc",
      "/data/VibeField/users/0",
      "/data/VibeField/users/01",
      "/data/VibeField/users/1/native",
      "/data/VibeField/accounts/2",
    ]) {
      expect(pairLogRoot("/logs", userRoot, "linux"), userRoot).toBe("/logs");
    }
  });

  it("enumerates every user's pair root under a platform root, in fuid order, for the readers that span users", async () => {
    const root = mkdtempSync(join(tmpdir(), "vibefield-pair-roots-"));
    try {
      expect(await pairLogRoots(root, "linux")).toEqual([]);
      for (const name of ["10", "2", "abc", "0"])
        mkdirSync(join(root, "users", name), { recursive: true });
      writeFileSync(join(root, "users", "3"), "a file, not a user root");
      expect(await pairLogRoots(root, "linux")).toEqual([
        { fuid: "2", root: join(root, "users", "2") },
        { fuid: "10", root: join(root, "users", "10") },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("platform log-root resolution", () => {
  it("uses the platform-native application log location", () => {
    expect(resolvePlatformLogRoot({ platform: "darwin", homeDir: "/Users/test", env: {} })).toBe(
      "/Users/test/Library/Logs/VibeField",
    );
    expect(resolvePlatformLogRoot({ platform: "linux", homeDir: "/home/test", env: {} })).toBe(
      "/home/test/.local/state/vibefield/logs",
    );
    expect(
      resolvePlatformLogRoot({
        platform: "linux",
        homeDir: "/home/test",
        env: { XDG_STATE_HOME: "/state" },
      }),
    ).toBe("/state/vibefield/logs");
    expect(
      resolvePlatformLogRoot({
        platform: "win32",
        homeDir: "C:\\Users\\test",
        env: { LOCALAPPDATA: "D:\\Local" },
      }),
    ).toBe("D:\\Local\\VibeField\\Logs");
  });

  it("ignores ambient overrides unless the caller explicitly enables them", () => {
    expect(
      resolvePlatformLogRoot({
        platform: "darwin",
        homeDir: "/Users/test",
        env: { FIELD_LOG_DIR: "/tmp/ambient" },
      }),
    ).toBe("/Users/test/Library/Logs/VibeField");
    expect(
      resolvePlatformLogRoot({
        platform: "darwin",
        homeDir: "/Users/test",
        env: { FIELD_LOG_DIR: "/tmp/explicit" },
        allowOverride: true,
      }),
    ).toBe("/tmp/explicit");
  });

  it("rejects a relative development override", () => {
    expect(() =>
      resolvePlatformLogRoot({
        platform: "linux",
        homeDir: "/home/test",
        env: { FIELD_LOG_DIR: "../escape" },
        allowOverride: true,
      }),
    ).toThrow("FIELD_LOG_DIR must be absolute");
  });
});
