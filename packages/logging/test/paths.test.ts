import { describe, expect, it } from "vitest";
import { resolvePlatformLogRoot } from "../src/index";

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
