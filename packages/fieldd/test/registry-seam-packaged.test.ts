// MK-6 — a packaged fieldd reads no plugin list from its environment: bin.ts refuses
// FIELDD_PLUGIN_REGISTRY_URL and FIELDD_PLUGIN_REGISTRY_KEY under a single executable, both
// together or either alone, before it writes a root or loads the daemon. A test cannot build a
// single executable, so this is PG-9 S4c's harness (swarm-replay-packaged.test.ts): fieldd's OWN
// bundle (`fieldd-bin-bundle.ts`, the build's first step) under a real Node whose `node:sea` says
// it is one, the one fact bin.ts reads. The refusal precedes the daemon's module graph, so the
// bundle needs none of the assets a package stages beside it. A later edit that drops bin.ts's
// call, or moves it below the root's minting, reddens this file; the pure function's rows would
// not see it. It is the row VF-PM's ruling on the seam asked for, with MK-6's custody note (EL7).
//
// The development half (both or neither, the address's kind, words that name no value) is
// `pluginRegistryOf`'s, in registry-seam.test.ts; the shell's blank for a package is
// electron-shell's fieldd-debug-swarm.test.ts.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  FIELDD_PLUGIN_REGISTRY_KEY_ENV,
  FIELDD_PLUGIN_REGISTRY_URL_ENV,
} from "@vibefield/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bundleFielddBin } from "./fieldd-bin-bundle";
import { killDaemonTree, runAliasParentEnv } from "./native-harness";

/** This Node says it is a single executable; every other builtin answers as before. */
const AS_SEA = `"use strict";
const original = process.getBuiltinModule;
process.getBuiltinModule = function getBuiltinModule(id) {
  if (id === "node:sea" || id === "sea") return { isSea: () => true };
  return typeof original === "function" ? original.call(process, id) : undefined;
};
`;

/** a public key's shape only: nothing verifies here, and the refusal must not say it */
const PUBLIC = "MCowBQYDK2VwAyEAseamtestseamtestseamtestseamtestseamtes=";

/** What the boot is handed: both variables, or one alone. */
const CASES = [
  { said: "both", url: true, key: true },
  { said: "the list's address alone", url: true, key: false },
  { said: "the key alone", url: false, key: true },
] as const;

let dir = "";
let bin = "";
let preload = "";
let cleanup: Array<() => void | Promise<void>> = [];

beforeAll(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "vf-mk6-sea-")));
  ({ bin } = await bundleFielddBin(dir));
  preload = join(dir, "as-sea.cjs");
  writeFileSync(preload, AS_SEA);
}, 60_000);

afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/** The child's exit, or — past `ms` — its stop (TERM, then KILL): a boot that was not refused. */
function exitWithin(child: ChildProcess, ms: number): Promise<Exit> {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout = (stdout + chunk.toString()).slice(-4_000);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4_000);
  });
  return new Promise((resolve) => {
    const term = setTimeout(() => child.kill("SIGTERM"), ms);
    const kill = setTimeout(() => child.kill("SIGKILL"), ms + 3_000);
    child.once("exit", (code, signal) => {
      clearTimeout(term);
      clearTimeout(kill);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

describe("MK-6 — bin.ts as a single executable refuses the plugin list's seam", () => {
  for (const handed of CASES) {
    it(`handed ${handed.said}: exits 1 by name, no readiness line, no root`, async () => {
      const run = join(dir, handed.said.replace(/\W+/gu, "-"));
      const home = join(run, "home");
      const agents = join(run, "agents");
      const logs = join(run, "logs");
      for (const path of [home, agents, logs]) mkdirSync(path, { recursive: true });
      // the root a boot would mint: a refused one never does
      const root = join(run, "vf");
      // an address of the kind the seam takes, naming a list that is not there: nothing reads it
      const url = pathToFileURL(join(run, "list", "index.json")).href;

      const child = spawn(process.execPath, ["--require", preload, bin], {
        env: {
          PATH: "/usr/bin:/bin",
          HOME: home,
          TMPDIR: tmpdir(),
          // item 345: the socket alias's parent is this run's own, as swarm-replay-packaged's is
          ...runAliasParentEnv(),
          FIELDD_DATA_DIR: root,
          FIELDD_CONTROL_PORT: "0",
          FIELDD_DATA_PORT: "0",
          // were the boot not refused: no agent install of this machine's is read
          FIELDD_AGENT_SEARCH_PATH: agents,
          FIELD_LOG_DIR: logs,
          FIELDD_ALLOW_LOG_DIR_OVERRIDE: "1",
          ...(handed.url ? { [FIELDD_PLUGIN_REGISTRY_URL_ENV]: url } : {}),
          ...(handed.key ? { [FIELDD_PLUGIN_REGISTRY_KEY_ENV]: PUBLIC } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      // the bundled fieldd's exit is awaited before the folder goes (afterAll runs after this)
      cleanup.push(() => killDaemonTree(child));
      const exit = await exitWithin(child, 10_000);

      const named = handed.url ? FIELDD_PLUGIN_REGISTRY_URL_ENV : FIELDD_PLUGIN_REGISTRY_KEY_ENV;
      expect(exit.stderr, "the refusal names the variable and the package").toMatch(
        new RegExp(`${named}.*packaged`, "u"),
      );
      expect(exit.stderr).toMatch(/a packaged fieldd reads no plugin list from its environment/u);
      expect(exit.code, exit.stderr).toBe(1);
      expect(exit.stdout, "no readiness line").not.toMatch(/"ready":true/);
      expect(existsSync(root), "the refused boot minted no root").toBe(false);
      // words naming the variables, never their values (the key is public; the rule is the seam's)
      expect(exit.stderr.includes(url), "the refusal says no address").toBe(false);
      expect(exit.stderr.includes(PUBLIC), "the refusal says no key").toBe(false);
    }, 60_000);
  }
});
