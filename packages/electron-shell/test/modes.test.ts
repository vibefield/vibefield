import { describe, expect, it } from "vitest";
import {
  isSmokeLike,
  parseDirectTerminalDoor,
  parseMode,
  type ShellMode,
  shutdownPolicy,
} from "../src/main/modes";

// Mode selection is parsed ONCE (ESR §5.2.6). These lock the precedence, the
// smoke-like classification, and the daemon-lifetime policy so no downstream
// module re-derives them from argv.

const ALL_MODES: readonly ShellMode[] = [
  "production",
  "dev",
  "smoke",
  "smoke-canvas",
  "smoke-plugin-restart",
  "smoke-godview",
  "live-surfaces-lab",
  "terminal-perf-lab",
  "terminal-door-probe",
  "spike-loro",
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
    expect(parseMode(["--smoke-plugin-restart"])).toBe("smoke-plugin-restart");
    expect(parseMode(["--smoke-godview"])).toBe("smoke-godview");
    expect(parseMode(["--live-surfaces-lab"])).toBe("live-surfaces-lab");
    expect(parseMode(["--terminal-perf-lab"])).toBe("terminal-perf-lab");
    expect(parseMode(["--terminal-door-probe"])).toBe("terminal-door-probe");
    expect(parseMode(["--spike-loro"])).toBe("spike-loro");
  });

  it("finds the flag anywhere in argv, not only at a fixed position", () => {
    expect(parseMode(["/usr/bin/node", "/app/main.js", "--dev"])).toBe("dev");
    expect(parseMode(["--foo", "--smoke", "--bar"])).toBe("smoke");
    expect(parseMode(["a", "b", "c", "--spike-loro"])).toBe("spike-loro");
  });

  it("honors precedence lab > perf-lab > spike-loro > restart > godview > smoke > canvas > dev", () => {
    expect(parseMode(["--spike-loro", "--live-surfaces-lab"])).toBe("live-surfaces-lab");
    expect(parseMode(["--spike-loro", "--terminal-perf-lab"])).toBe("terminal-perf-lab");
    expect(parseMode(["--terminal-perf-lab", "--live-surfaces-lab"])).toBe("live-surfaces-lab");
    expect(parseMode(["--dev", "--smoke-godview", "--terminal-perf-lab"])).toBe(
      "terminal-perf-lab",
    );
    expect(parseMode(["--dev", "--smoke-canvas", "--smoke", "--spike-loro"])).toBe("spike-loro");
    expect(parseMode(["--dev", "--smoke-canvas", "--smoke"])).toBe("smoke");
    expect(parseMode(["--dev", "--smoke-canvas"])).toBe("smoke-canvas");
    expect(parseMode(["--dev", "--smoke"])).toBe("smoke");
    expect(parseMode(["--smoke-canvas", "--spike-loro"])).toBe("spike-loro");
    expect(parseMode(["--dev", "--spike-loro"])).toBe("spike-loro");
    expect(parseMode(["--smoke-godview", "--smoke-plugin-restart"])).toBe("smoke-plugin-restart");
    // --smoke-godview is its own argv element, so the --smoke test never sees
    // it as a prefix; the ordering below is about a caller passing both.
    expect(parseMode(["--smoke", "--smoke-godview"])).toBe("smoke-godview");
    expect(parseMode(["--dev", "--smoke-godview"])).toBe("smoke-godview");
  });
});

describe("isSmokeLike", () => {
  // Exactly the transient, port-isolated, never-packaged runs.
  const smokeLike = new Set<ShellMode>([
    "smoke",
    "smoke-canvas",
    "smoke-plugin-restart",
    "smoke-godview",
    "live-surfaces-lab",
    "terminal-perf-lab",
    "terminal-door-probe",
    "spike-loro",
  ]);

  it.each(ALL_MODES)("classifies %s", (mode) => {
    expect(isSmokeLike(mode)).toBe(smokeLike.has(mode));
  });
});

describe("shutdownPolicy", () => {
  // Two subtle lines: spike-loro joins PRODUCTION in leave-running (not a
  // stop-owned smoke run despite passing isSmokeLike — it touches no daemon),
  // and dev is leave-running because the dev-runner owns daemon teardown — the
  // shell hands the running pair to its successor via buildId-gated adoption.
  const expected: Record<ShellMode, "stop-owned" | "leave-running"> = {
    production: "leave-running",
    dev: "leave-running",
    smoke: "stop-owned",
    "smoke-canvas": "stop-owned",
    "smoke-plugin-restart": "stop-owned",
    "smoke-godview": "stop-owned",
    "live-surfaces-lab": "leave-running",
    // TP-S0c: the ONE lab that is stop-owned. Unlike the others it spawns a
    // pair against its own data root and drives real sessions through it, so it
    // owns what it started and stops it.
    "terminal-perf-lab": "stop-owned",
    // TP-S3a: the door probe is the perf lab's shape — its own pair, stop-owned.
    "terminal-door-probe": "stop-owned",
    "spike-loro": "leave-running",
  };

  it.each(ALL_MODES)("%s", (mode) => {
    expect(shutdownPolicy(mode)).toBe(expected[mode]);
  });
});

describe("parseDirectTerminalDoor (TP-S3a — TP-D1's rollback flag)", () => {
  it("is OFF by default, ON by argv or env, and implied by the door probe", () => {
    expect(parseDirectTerminalDoor([], {})).toBe(false);
    expect(parseDirectTerminalDoor(["--smoke"], { VIBEFIELD_TERMINAL_DIRECT_DOOR: "0" })).toBe(
      false,
    );
    expect(parseDirectTerminalDoor(["--terminal-direct-door"], {})).toBe(true);
    expect(parseDirectTerminalDoor([], { VIBEFIELD_TERMINAL_DIRECT_DOOR: "1" })).toBe(true);
    expect(parseDirectTerminalDoor(["--terminal-door-probe"], {})).toBe(true);
  });
});
