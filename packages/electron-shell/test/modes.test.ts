import { describe, expect, it } from "vitest";
import {
  isSmokeLike,
  parseMode,
  rendererPolicyMode,
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
  "smoke-browser-widget",
  "smoke-plugin-restart",
  "smoke-godview",
  "live-surfaces-lab",
  "terminal-perf-lab",
  "godview-perf-lab",
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
    expect(parseMode(["--smoke-browser-widget"])).toBe("smoke-browser-widget");
    expect(parseMode(["--smoke-plugin-restart"])).toBe("smoke-plugin-restart");
    expect(parseMode(["--smoke-godview"])).toBe("smoke-godview");
    expect(parseMode(["--live-surfaces-lab"])).toBe("live-surfaces-lab");
    expect(parseMode(["--terminal-perf-lab"])).toBe("terminal-perf-lab");
    expect(parseMode(["--godview-perf-lab"])).toBe("godview-perf-lab");
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
    "smoke-browser-widget",
    "smoke-plugin-restart",
    "smoke-godview",
    "live-surfaces-lab",
    "terminal-perf-lab",
    "godview-perf-lab",
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
    "smoke-browser-widget": "stop-owned",
    "smoke-plugin-restart": "stop-owned",
    "smoke-godview": "stop-owned",
    "live-surfaces-lab": "leave-running",
    // TP-S0c: the ONE lab that is stop-owned. Unlike the others it spawns a
    // pair against its own data root and drives real sessions through it, so it
    // owns what it started and stops it.
    "terminal-perf-lab": "stop-owned",
    // MV-0: the Godview perf lab is the perf lab's shape too.
    "godview-perf-lab": "stop-owned",
    // TP-S3a: the door probe is the perf lab's shape — its own pair, stop-owned.
    "terminal-door-probe": "stop-owned",
    "spike-loro": "leave-running",
  };

  it.each(ALL_MODES)("%s", (mode) => {
    expect(shutdownPolicy(mode)).toBe(expected[mode]);
  });
});

// TP-S3e: `parseDirectTerminalDoor` retired with the bridge — the routed
// transport is unconditional and the CSP test asserts the widened policy on
// purpose (security-policy.test.ts).

describe("the worker lab's renderer policy", () => {
  it("admits Vite without changing the lab's isolation or daemon lifetime", () => {
    const mode = parseMode(["--godview-perf-lab"]);
    expect(rendererPolicyMode(mode, "dev")).toBe("dev");
    expect(isSmokeLike(mode)).toBe(true);
    expect(shutdownPolicy(mode)).toBe("stop-owned");
    expect(rendererPolicyMode(mode, undefined)).toBe(mode);
    expect(rendererPolicyMode(mode, "packaged")).toBe(mode);
    expect(rendererPolicyMode(mode, "DEV")).toBe(mode);
  });

  it.each(ALL_MODES.filter((mode) => mode !== "godview-perf-lab"))(
    "ignores the lab override in %s",
    (mode) => expect(rendererPolicyMode(mode, "dev")).toBe(mode),
  );
});
