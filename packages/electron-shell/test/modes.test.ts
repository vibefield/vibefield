import { describe, expect, it } from "vitest";
import { isSmokeLike, parseMode, type ShellMode, shutdownPolicy } from "../src/main/modes";

// Mode selection is parsed ONCE (ESR §5.2.6). These lock the precedence, the
// smoke-like classification, and the daemon-lifetime policy so no downstream
// module re-derives them from argv.

const ALL_MODES: readonly ShellMode[] = [
  "production",
  "dev",
  "smoke",
  "smoke-canvas",
  "spike-loro",
  "spike-godview",
];

describe("parseMode", () => {
  it("defaults to production when no recognized flag is present", () => {
    expect(parseMode([])).toBe("production");
    expect(parseMode(["node", "main.js"])).toBe("production");
    expect(parseMode(["--unknown", "--also-unknown"])).toBe("production");
  });

  it("selects each mode from its own flag", () => {
    expect(parseMode(["--dev"])).toBe("dev");
    expect(parseMode(["--smoke"])).toBe("smoke");
    expect(parseMode(["--smoke-canvas"])).toBe("smoke-canvas");
    expect(parseMode(["--spike-loro"])).toBe("spike-loro");
    expect(parseMode(["--spike-godview"])).toBe("spike-godview");
  });

  it("finds the flag anywhere in argv, not only at a fixed position", () => {
    expect(parseMode(["/usr/bin/node", "/app/main.js", "--dev"])).toBe("dev");
    expect(parseMode(["--foo", "--smoke", "--bar"])).toBe("smoke");
    expect(parseMode(["a", "b", "c", "--spike-loro"])).toBe("spike-loro");
  });

  it("honors precedence spike-loro > spike-godview > smoke > smoke-canvas > dev", () => {
    expect(parseMode(["--dev", "--smoke-canvas", "--smoke", "--spike-loro"])).toBe("spike-loro");
    expect(parseMode(["--dev", "--smoke-canvas", "--smoke"])).toBe("smoke");
    expect(parseMode(["--dev", "--smoke-canvas"])).toBe("smoke-canvas");
    expect(parseMode(["--dev", "--smoke"])).toBe("smoke");
    expect(parseMode(["--smoke-canvas", "--spike-loro"])).toBe("spike-loro");
    expect(parseMode(["--dev", "--spike-loro"])).toBe("spike-loro");
    expect(parseMode(["--spike-godview", "--spike-loro"])).toBe("spike-loro");
    expect(parseMode(["--dev", "--smoke", "--spike-godview"])).toBe("spike-godview");
  });
});

describe("isSmokeLike", () => {
  // Exactly the transient, port-isolated, never-packaged runs.
  const smokeLike = new Set<ShellMode>(["smoke", "smoke-canvas", "spike-loro", "spike-godview"]);

  it.each(ALL_MODES)("classifies %s", (mode) => {
    expect(isSmokeLike(mode)).toBe(smokeLike.has(mode));
  });
});

describe("shutdownPolicy", () => {
  // Two subtle lines: spike-loro joins PRODUCTION in leave-running (not a
  // stop-owned smoke run despite passing isSmokeLike), and dev is
  // leave-running because the dev-runner owns daemon teardown — the shell
  // hands the running pair to its successor via buildId-gated adoption.
  // The spikes disagree with each other on purpose: spike-godview spawns the
  // real pair to reach the terminal floor, so it owes that pair a teardown.
  const expected: Record<ShellMode, "stop-owned" | "leave-running"> = {
    production: "leave-running",
    dev: "leave-running",
    smoke: "stop-owned",
    "smoke-canvas": "stop-owned",
    "spike-loro": "leave-running",
    "spike-godview": "stop-owned",
  };

  it.each(ALL_MODES)("%s", (mode) => {
    expect(shutdownPolicy(mode)).toBe(expected[mode]);
  });
});
