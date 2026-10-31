/**
 * DK-18 (plan (39)) — a smoke stops its own daemons and WAITS for them (testing/smoke-daemons.ts): the run's processes found
 * by the mark run-smoke.mjs gives Electron (`VF_SMOKE_RUN`), named by their command alone, the ones whose parent is gone
 * asked, every one waited for, what outlives the bound killed; Electron and its own Chromium children never the teardown's.
 * And the home a green run removes whole.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { type Ps, type PsSpelling, psTables } from "../src/testing/smoke-census.mjs";
import {
  censusDeps,
  listRunProcesses,
  processName,
  RUN_STOP,
  type RunProcess,
  runProcesses,
  type StopRunDeps,
  smokeHome,
  stopRunDaemons,
} from "../src/testing/smoke-daemons";

const ELECTRON =
  "/r/node_modules/.pnpm/electron@43.1.1/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";
const HELPER =
  "/r/node_modules/.pnpm/electron@43.1.1/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper (GPU).app/Contents/MacOS/Electron Helper (GPU) --type=gpu-process";

describe("the run's processes — by the mark in their environment, named by their command", () => {
  const mark = "vf-smoke-profile-AbC123";
  const plain = [
    `  100     1 ${ELECTRON} /r/apps/desktop --user-data-dir=/T/${mark} --smoke-canvas`,
    `  101   100 ${HELPER}`,
    `  102   100 ${ELECTRON} /r/packages/fieldd/dist/bin.cjs`,
    `  103     1 /r/target/debug/field-native`,
    `  104   103 /r/target/debug/field-terminal-host --control /private/tmp/vf-smoke-x/users/1/native/run/termctl.1.sock`,
    `  105     1 /r/target/debug/field-native`,
    `  106     1 /usr/bin/some-other-thing`,
  ].join("\n");
  const env = (pid: string, rest: string, carried: string | null): string =>
    `  ${pid} ${rest}${carried === null ? "" : ` VF_SMOKE_RUN=${carried}`} HOME=/u FIELDD_NATIVE_BIN=/r/target/debug/field-native`;
  const withEnv = [
    env("100     1", `${ELECTRON} /r/apps/desktop`, mark),
    env("101   100", HELPER, mark),
    env("102   100", `${ELECTRON} /r/packages/fieldd/dist/bin.cjs`, mark),
    env("103     1", "/r/target/debug/field-native", mark),
    env("104   103", "/r/target/debug/field-terminal-host --control x", mark),
    // another run's field-native: its mark is a LONGER name — never this run's
    env("105     1", "/r/target/debug/field-native", `${mark}9`),
    env("106     1", "/usr/bin/some-other-thing", null),
  ].join("\n");

  it("finds exactly the processes whose environment carries the run's mark, as a whole word", () => {
    expect(runProcesses(withEnv, plain, mark).map((p) => p.pid)).toEqual([100, 101, 102, 103, 104]);
  });

  it("names each by its command, never by a path its environment names", () => {
    expect(
      runProcesses(withEnv, plain, mark).map((p) => [p.pid, p.name, p.helper] as const),
    ).toEqual([
      [100, "electron", false],
      [101, "electron-helper", true],
      [102, "fieldd", false],
      [103, "field-native", false],
      [104, "field-terminal-host", false],
    ]);
  });

  it("names the rest of the run's kind by its executable", () => {
    expect(processName("/opt/x/bin/rosettad serve --db y")).toBe("rosettad");
    expect(processName("/a/b/node /a/fieldd/dist/service-harness.mjs")).toBe("fieldd-worker");
    expect(processName("/a/Crashpad/chrome_crashpad_handler --database=x")).toBe("electron-helper");
    expect(processName("/bin/zsh -l")).toBe("zsh");
  });

  // Item 116 — the teardown's own copy named a packaged app's Chromium children by their first word ("VibeField"): the
  // two copies' drift, latent here (the testing bundle never ships, so this teardown never runs in a packaged app), and
  // gone with the one census, which names them as Electron's as the launcher's row always did.
  it("names a packaged app's own Chromium children as Electron's, and its fieldd by its place (item 116)", () => {
    expect(
      processName(
        "/Applications/VibeField.app/Contents/Frameworks/VibeField Helper (Renderer).app/Contents/MacOS/VibeField Helper (Renderer) --type=renderer",
      ),
    ).toBe("electron-helper");
    expect(processName("/Applications/VibeField.app/Contents/Resources/bin/fieldd --serve")).toBe(
      "fieldd",
    );
  });

  it("is the launcher's census, one copy (item 116)", async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const launcher = await import(
      pathToFileURL(resolve(here, "../../../apps/desktop/packaging/smoke-daemons.mjs")).href
    );
    expect(listRunProcesses).toBe(launcher.listRunProcesses);
    expect(processName).toBe(launcher.processName);
    expect(runProcesses).toBe(launcher.runProcesses);
  });
});

/** A fake machine: each process lives until its `until` (ms on the fake clock), or until it is killed; a SIGTERM to one
 * that drains on a term moves its end to `drainMs` after the ask. */
function machine(procs: { p: RunProcess; until: number; drainOnTerm?: number }[]) {
  let clock = 0;
  const signals: [number, string][] = [];
  const deps: StopRunDeps = {
    list: () => procs.filter((x) => x.until > clock).map((x) => x.p),
    still: (_mark, pids) =>
      pids.filter((pid) => procs.some((x) => x.p.pid === pid && x.until > clock)),
    signal: (pid, signal) => {
      signals.push([pid, signal]);
      const x = procs.find((y) => y.p.pid === pid);
      if (x === undefined) return;
      if (signal === "SIGKILL") x.until = Math.min(x.until, clock);
      else if (x.drainOnTerm !== undefined) x.until = Math.min(x.until, clock + x.drainOnTerm);
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return { deps, signals };
}

const proc = (pid: number, ppid: number, name: string, helper = false): RunProcess => ({
  pid,
  ppid,
  name,
  helper,
});

describe("stopRunDaemons — the teardown asks what nothing asked, and WAITS for every one", () => {
  it("does nothing on a run with no mark (a smoke started by hand)", async () => {
    const m = machine([{ p: proc(3, 1, "field-native"), until: 1e9 }]);
    expect(await stopRunDaemons(undefined, 100, m.deps)).toEqual({
      mark: null,
      found: [],
      asked: [],
      waitedMs: 0,
      killed: [],
      left: [],
    });
    expect(m.signals).toEqual([]);
  });

  it("waits out a field-native draining its cell's session (the supervisor's SIGTERM already sent) — no kill", async () => {
    const m = machine([
      { p: proc(100, 1, "electron"), until: 1e9 },
      { p: proc(101, 100, "electron-helper", true), until: 1e9 },
      // the `ps` the teardown runs to look carries the mark too — a new one each look
      { p: proc(110, 100, "ps"), until: 1e9 },
      // field-native, already stopping: gone 4.1 s on, its cells with it
      { p: proc(103, 1, "field-native"), until: 4_100 },
      { p: proc(104, 103, "field-terminal-host"), until: 4_000 },
    ]);
    const stopped = await stopRunDaemons("vf-smoke-profile-x", 100, m.deps);
    expect(stopped.found).toEqual([
      { pid: 103, name: "field-native" },
      { pid: 104, name: "field-terminal-host" },
    ]);
    // the root asked (its parent is gone); the cell is field-native's to take down
    expect(stopped.asked).toEqual([103]);
    expect(stopped.waitedMs).toBeGreaterThanOrEqual(4_100);
    expect(stopped.waitedMs).toBeLessThan(RUN_STOP.drainMs);
    expect(stopped.killed).toEqual([]);
    expect(stopped.left).toEqual([]);
    // Electron and its own Chromium children are never signalled
    expect(m.signals.map(([pid]) => pid)).toEqual([103]);
  });

  it("stops the field-native a restarted fieldd ADOPTED — nothing signalled it, so the teardown asks it", async () => {
    const m = machine([{ p: proc(203, 1, "field-native"), until: 1e9, drainOnTerm: 300 }]);
    const stopped = await stopRunDaemons("vf-smoke-profile-x", 100, m.deps);
    expect(stopped.asked).toEqual([203]);
    expect(stopped.killed).toEqual([]);
    expect(stopped.left).toEqual([]);
    expect(stopped.waitedMs).toBeLessThan(1_000);
  });

  it("asks again and then kills what outlives the drain's bound", async () => {
    const m = machine([{ p: proc(303, 1, "field-native"), until: 1e9 }]);
    const stopped = await stopRunDaemons("vf-smoke-profile-x", 100, m.deps);
    expect(stopped.waitedMs).toBeGreaterThanOrEqual(RUN_STOP.drainMs);
    expect(stopped.killed).toEqual([303]);
    expect(stopped.left).toEqual([]);
    expect(m.signals).toEqual([
      [303, "SIGTERM"],
      [303, "SIGTERM"],
      [303, "SIGKILL"],
    ]);
  });
});

describe("item 116 — the teardown's census: one whole-table look, then each pid alone, in the platform's spelling", () => {
  const mark = "vf-smoke-profile-x";
  /** A fake host whose `ps` answers from its table and counts every read; field-native drains 4.1 s after its ask. */
  function host(spelling: PsSpelling) {
    let clock = 0;
    let nativeUntil = 1e9;
    const reads: string[][] = [];
    const procs = () =>
      [
        { pid: 100, ppid: 1, command: ELECTRON, until: 1e9 },
        { pid: 103, ppid: 1, command: "/r/target/debug/field-native", until: nativeUntil },
        {
          pid: 104,
          ppid: 103,
          command: "/r/target/debug/field-terminal-host",
          until: nativeUntil - 100,
        },
      ].filter((p) => p.until > clock);
    const ps: Ps = (args) => {
      reads.push(args);
      const flags = JSON.stringify(args.slice(0, args.indexOf("-o")));
      const env =
        flags === JSON.stringify(spelling.table) || flags === JSON.stringify(spelling.oneWithEnv);
      const line = (p: { pid: number; ppid: number; command: string }): string =>
        `  ${p.pid} ${p.ppid} ${p.command}${env ? ` VF_SMOKE_RUN=${mark} HOME=/u` : ""}`;
      const at = args.indexOf("-p");
      if (at === -1) return procs().map(line).join("\n");
      const one = procs().find((p) => p.pid === Number(args[at + 1]));
      if (one === undefined) throw Object.assign(new Error("ps: no such pid"), { status: 1 });
      return line(one);
    };
    const deps: StopRunDeps = {
      ...censusDeps(ps, spelling),
      signal: (pid, signal) => {
        if (pid === 103 && signal === "SIGTERM") nativeUntil = Math.min(nativeUntil, clock + 4_100);
      },
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
    };
    return { deps, reads };
  }

  it.each([
    ["darwin", ["-axww", "-E"]],
    ["linux", ["axwwe"]],
  ] as const)(
    "on %s: the run found by ONE whole-table read in its own spelling, every wait by pid",
    async (platform, table) => {
      const spelling = psTables(platform);
      const h = host(spelling);
      const stopped = await stopRunDaemons(mark, 100, h.deps);
      expect(stopped.found).toEqual([
        { pid: 103, name: "field-native" },
        { pid: 104, name: "field-terminal-host" },
      ]);
      expect(stopped.asked).toEqual([103]);
      expect(stopped.killed).toEqual([]);
      expect(stopped.left).toEqual([]);
      expect(stopped.waitedMs).toBeGreaterThanOrEqual(4_100);
      const whole = h.reads.filter((args) => !args.includes("-p"));
      expect(whole).toEqual([[...table, "-o", "pid=,ppid=,command="]]);
      // a 4.1 s drain at 100 ms polls: every look after the first asked its pids alone
      expect(h.reads.length).toBeGreaterThan(40);
    },
  );
});

describe("smokeHome — the vf-smoke-* root above the user root, and nothing else", () => {
  it("names the home of a minted smoke root", () => {
    expect(smokeHome("/tmp/vf-smoke-hnUors/users/1")).toBe("/tmp/vf-smoke-hnUors");
    expect(smokeHome("/private/tmp/vf-smoke-hnUors/users/1")).toBe("/private/tmp/vf-smoke-hnUors");
  });

  it("never names a profile, a user's own root or any other shape", () => {
    expect(smokeHome("/T/vf-smoke-profile-x/users/1")).toBeNull();
    expect(smokeHome("/Users/x/Library/Application Support/VibeField/users/1")).toBeNull();
    expect(smokeHome("/tmp/vf-smoke-hnUors/1")).toBeNull();
    expect(smokeHome("/tmp/vf-smoke-godview-x")).toBeNull();
  });
});
