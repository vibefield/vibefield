// PG-9 S4c — a packaged fieldd plays no debug swarm: bin.ts refuses FIELDD_DEBUG_SWARM_CORPUS under a
// single executable, loudly, before it writes anything or loads the daemon. A test cannot build a single
// executable, so it runs fieldd's OWN bundle (`fieldd-bin-bundle.ts`, the build's first step) under a
// real Node whose `node:sea` says it is one: a preload answers `isSea()` true, the one fact bin.ts reads
// (`process.getBuiltinModule("node:sea")`). The refusal precedes the daemon's module graph, so the
// bundle needs none of the assets a package stages beside it.
//
// The development half (an unpackaged fieldd takes the path; an empty value is no swarm anywhere — the
// shell's blank) is `debugSwarmCorpusOf`'s, in swarm-replay.test.ts.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIELDD_DEBUG_SWARM_CORPUS_ENV } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bundleFielddBin } from "./fieldd-bin-bundle";

const CORPUS = join(
  import.meta.dirname,
  "..",
  "..",
  "field-app",
  "test",
  "fixtures",
  "godview-corpora",
  "n10-2s-s1.jsonl.gz",
);

/** This Node says it is a single executable; every other builtin answers as before. */
const AS_SEA = `"use strict";
const original = process.getBuiltinModule;
process.getBuiltinModule = function getBuiltinModule(id) {
  if (id === "node:sea" || id === "sea") return { isSea: () => true };
  return typeof original === "function" ? original.call(process, id) : undefined;
};
`;

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
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

describe("PG-9 S4c — a packaged fieldd refuses the debug swarm", () => {
  it("bin.ts under a single executable exits 1 naming FIELDD_DEBUG_SWARM_CORPUS — no readiness line, no root written", async () => {
    expect(existsSync(CORPUS), `the in-repo corpus ${CORPUS}`).toBe(true);
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "vf-s4c-sea-")));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const { bin } = await bundleFielddBin(dir);
    const preload = join(dir, "as-sea.cjs");
    writeFileSync(preload, AS_SEA);
    const home = join(dir, "home");
    const agents = join(dir, "agents");
    const logs = join(dir, "logs");
    for (const path of [home, agents, logs]) mkdirSync(path, { recursive: true });
    // the root a boot would mint: a refused one never does
    const root = join(dir, "vf");

    const child = spawn(process.execPath, ["--require", preload, bin], {
      env: {
        PATH: "/usr/bin:/bin",
        HOME: home,
        TMPDIR: tmpdir(),
        FIELDD_DATA_DIR: root,
        FIELDD_CONTROL_PORT: "0",
        FIELDD_DATA_PORT: "0",
        // were the boot not refused: no agent install of this machine's is read
        FIELDD_AGENT_SEARCH_PATH: agents,
        FIELD_LOG_DIR: logs,
        FIELDD_ALLOW_LOG_DIR_OVERRIDE: "1",
        [FIELDD_DEBUG_SWARM_CORPUS_ENV]: CORPUS,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    cleanup.push(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
    const exit = await exitWithin(child, 10_000);

    expect(exit.stderr, "the refusal names the variable and the package").toMatch(
      new RegExp(`${FIELDD_DEBUG_SWARM_CORPUS_ENV}.*packaged`),
    );
    expect(exit.code, exit.stderr).toBe(1);
    expect(exit.stdout, "no readiness line").not.toMatch(/"ready":true/);
    expect(existsSync(root), "the refused boot minted no root").toBe(false);
  }, 60_000);
});
