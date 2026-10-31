import { describe, expect, it } from "vitest";
import {
  answersSetup,
  isSmokeLike,
  keepsFramesWhenCovered,
  keepsGpu,
  mintsOnboarded,
  parseMode,
  rendererPolicyMode,
  type ShellMode,
  shutdownPolicy,
  smokeSimctlDeveloperDir,
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
  "smoke-first-run",
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
    expect(parseMode(["--smoke-plugin-restart"])).toBe("smoke-plugin-restart");
    expect(parseMode(["--smoke-godview"])).toBe("smoke-godview");
    expect(parseMode(["--smoke-first-run"])).toBe("smoke-first-run");
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

  it("honors precedence lab > perf-lab > spike-loro > restart > godview > first-run > smoke > canvas > dev", () => {
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
    // track FG: the first-run smoke sits under godview and over the plain smoke
    expect(parseMode(["--smoke-first-run", "--smoke-godview"])).toBe("smoke-godview");
    expect(parseMode(["--smoke", "--smoke-first-run", "--dev"])).toBe("smoke-first-run");
  });
});

describe("isSmokeLike", () => {
  // Exactly the transient, port-isolated, never-packaged runs.
  const smokeLike = new Set<ShellMode>([
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
  ]);

  it.each(ALL_MODES)("classifies %s", (mode) => {
    expect(isSmokeLike(mode)).toBe(smokeLike.has(mode));
  });
});

describe("keepsGpu", () => {
  // DK-5: the desk-drawing smokes keep the GPU unless run GPU-less on purpose; every other
  // smoke-like mode drops it (ssh, GPU-less runners); the labs measure it; the app keeps it.
  const kept = new Set<ShellMode>([
    "production",
    "dev",
    "smoke-canvas",
    "smoke-plugin-restart",
    // track FG: the Setup Assistant's glass is the live field's own pass
    "smoke-first-run",
    "live-surfaces-lab",
    "terminal-perf-lab",
    // MV-0: the Godview perf lab measures the swarm's WebGPU canvas
    "godview-perf-lab",
  ]);

  it.each(ALL_MODES)("%s", (mode) => {
    expect(keepsGpu(mode, [])).toBe(kept.has(mode));
  });

  it("drops it for the desk smokes run with --disable-gpu, and only for them", () => {
    expect(keepsGpu("smoke-canvas", ["--disable-gpu"])).toBe(false);
    expect(keepsGpu("smoke-plugin-restart", ["--disable-gpu"])).toBe(false);
    expect(keepsGpu("smoke-first-run", ["--disable-gpu"])).toBe(false);
    expect(keepsGpu("live-surfaces-lab", ["--disable-gpu"])).toBe(true);
    expect(keepsGpu("production", ["--disable-gpu"])).toBe(true);
  });
});

describe("keepsFramesWhenCovered", () => {
  // TP-S0c, grown at DK-9: the frame-counting labs keep a covered window's frames — the terminal perf lab and
  // the GPU-on desk smokes (their idle, stillness and frame-rate rows); production backgrounds a covered window.
  const kept = new Set<ShellMode>([
    "terminal-perf-lab",
    "smoke-canvas",
    "smoke-plugin-restart",
    // track FG: the first run's holds are timed by their own clocks, its stills taken of the field's frames
    "smoke-first-run",
  ]);

  it.each(ALL_MODES)("%s", (mode) => {
    expect(keepsFramesWhenCovered(mode, [])).toBe(kept.has(mode));
  });

  it("not for a desk smoke run GPU-less (nothing draws there to count)", () => {
    expect(keepsFramesWhenCovered("smoke-canvas", ["--disable-gpu"])).toBe(false);
    expect(keepsFramesWhenCovered("smoke-plugin-restart", ["--disable-gpu"])).toBe(false);
    expect(keepsFramesWhenCovered("smoke-first-run", ["--disable-gpu"])).toBe(false);
    expect(keepsFramesWhenCovered("terminal-perf-lab", ["--disable-gpu"])).toBe(true);
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
    "smoke-first-run": "stop-owned",
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

describe("the Setup Assistant at a fresh root's mint (UA-3w as amended 2026-10-31)", () => {
  // A test harness's first user is minted onboarded, so its boot never holds at the Setup Assistant — but for the
  // ONE harness built to answer it. A new smoke-like mode lands here onboarded unless this row is changed with it.
  const answering = new Set<ShellMode>(["smoke-first-run"]);

  it.each(ALL_MODES)("%s", (mode) => {
    expect(answersSetup(mode)).toBe(answering.has(mode));
    expect(mintsOnboarded(mode)).toBe(isSmokeLike(mode) && !answering.has(mode));
  });

  it("answers it in exactly one mode, and a person's modes meet it", () => {
    expect(ALL_MODES.filter(answersSetup)).toEqual(["smoke-first-run"]);
    expect(ALL_MODES.filter((mode) => isSmokeLike(mode) && !mintsOnboarded(mode))).toEqual([
      "smoke-first-run",
    ]);
    expect(mintsOnboarded("production")).toBe(false);
    expect(mintsOnboarded("dev")).toBe(false);
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

describe("PT-S3 (P2): a smoke's simctl developer directory", () => {
  // SIM-NONE points main's simctl probe at an empty directory to witness `no-simulator` on a Mac with a Simulator; the
  // variable is a smoke's word only — production's probe always asks xcode-select.
  const env = { VF_SMOKE_SIMCTL_DEVELOPER_DIR: "/var/empty" };

  it("smoke-canvas — the phone rows' mode — reads it, and nothing when it is unset", () => {
    expect(smokeSimctlDeveloperDir(parseMode(["--smoke-canvas", "--phone"]), env)).toBe(
      "/var/empty",
    );
    expect(smokeSimctlDeveloperDir("smoke-canvas", {})).toBeUndefined();
  });

  it("production and dev ignore it, whatever the environment says", () => {
    expect(smokeSimctlDeveloperDir("production", env)).toBeUndefined();
    expect(smokeSimctlDeveloperDir("dev", env)).toBeUndefined();
  });

  it.each(ALL_MODES)("%s reads it exactly when it is smoke-like", (mode) => {
    expect(smokeSimctlDeveloperDir(mode, env)).toBe(isSmokeLike(mode) ? "/var/empty" : undefined);
  });
});
