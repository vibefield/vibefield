// AR-7j — the agent-shim ROLE of fieldd's own executable: a packaged build's
// launcher runtime (roles.ts, bin.ts, agent-gateway.ts `chooseLauncherRuntime`
// case 2b). A packaged fieldd is a single executable whose RunAsNode fuse is
// closed, so each launcher execs `<fieldd> --vibefield-role=agent-shim
// <home>/lib/agent-shim.cjs "$@"` and the role runs the shim SEALED beside the
// executable — never the home's copy, which anything of this user's can write.
//
// What runs here is fieldd's own bundle under a real Node: `node bin.cjs
// <role> …` hands its arguments at the indices a single executable does, so
// these rows are the role the packaged build runs, from source. The packaged
// executable itself is the release's witness (packaged-typed-agent.test.ts,
// run by apps/desktop/packaging/verify-agents-package.mjs).
//
//  · the dispatch is POSITIONAL, and closed — the pure rows;
//  · the entry imports nothing of the daemon's at its top, so a role pays for
//    builtins and its own bundle — esbuild's own account of the bundle;
//  · the role runs the sealed shim with the agent's arguments exactly, the
//    home's copy never, no daemon, no readiness line, no data directory;
//  · on the REAL floor, a launcher naming the role is a managed typed run, and
//    what cannot be carried is refused in VibeField's words.
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SPAWN_THROUGH_EXIT_UNAVAILABLE,
  spawnThroughLayout,
} from "@vibefield/puppeteer-runtime/spawn-through";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { AGENT_GATEWAY_HOST_LABEL } from "../src/agent-gateway";
import {
  AGENT_SHIM_BUNDLE,
  AGENT_SHIM_EXIT_UNAVAILABLE,
  AGENT_SHIM_ROLE_ARG,
  agentShimArgv,
  agentShimUnavailable,
  FILES_HOST_BUNDLE,
  FILES_HOST_ROLE_ARG,
  roleOf,
} from "../src/roles";
import {
  FILES_HOST_BUNDLE as LAUNCH_FILES_HOST_BUNDLE,
  FILES_HOST_ROLE_ARG as LAUNCH_FILES_HOST_ROLE_ARG,
} from "../src/workspace/launch";
import { linesOf, TYPED_COMMAND } from "./agent-gateway-fixture";
import {
  adopted,
  auditActs,
  END_OF_INPUT,
  FLOOR_BUDGET_MS,
  FLOOR_WAIT_MS,
  floor,
  key,
  openPane,
  readRecord,
  rowOf,
  statusOf,
  teardownFloors,
  type,
  poll as until,
} from "./agent-gateway-floor";
import { bundleAgentShim } from "./agent-shim-bundle";
import { BIN_BUILD_STEP, bundleFielddBin } from "./fieldd-bin-bundle";

const PACKAGE_ROOT = join(import.meta.dirname, "..");

/** A loaded host takes seconds to bundle the daemon and start a process: no row here asserts speed. */
const PROCESS_BUDGET_MS = 120_000;

/** The kit's status for a refused launch (EX_TEMPFAIL): refused, not failed. */
const REFUSED_BY_THE_KIT = 75;

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* already gone */
    }
  }
  cleanup = [];
  await teardownFloors();
}, 60_000);

function scratch(prefix: string): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Run a program to its end: what it printed and how it left. */
function run(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { encoding: "utf8", timeout: PROCESS_BUDGET_MS, env },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : (null as null);
        resolve({ code, stdout, stderr });
      },
    );
  });
}

/** fieldd's bundle, built ONCE for the file, with the kit's real shim sealed
 * beside it — the layout a packaged executable's directory has. */
let bundleDir: string;
let built: Awaited<ReturnType<typeof bundleFielddBin>>;
beforeAll(async () => {
  bundleDir = realpathSync(mkdtempSync(join(tmpdir(), "vf-role-bin-")));
  built = await bundleFielddBin(bundleDir);
  await bundleAgentShim(bundleDir);
}, PROCESS_BUDGET_MS);
afterAll(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});

describe("the roles are closed, and picked by the FIRST argument alone (AR-7j)", () => {
  it("each role's word and bundle, and the files worker's re-exported unchanged from workspace/launch", () => {
    expect(AGENT_SHIM_ROLE_ARG).toBe("--vibefield-role=agent-shim");
    expect(AGENT_SHIM_BUNDLE).toBe("agent-shim.cjs");
    expect(FILES_HOST_ROLE_ARG).toBe("--vibefield-role=files-host");
    expect(FILES_HOST_BUNDLE).toBe("files-host.cjs");
    expect(LAUNCH_FILES_HOST_ROLE_ARG).toBe(FILES_HOST_ROLE_ARG);
    expect(LAUNCH_FILES_HOST_BUNDLE).toBe(FILES_HOST_BUNDLE);
  });

  it("argv[2] names the role — the index a single executable and `node bin.cjs` both hand the first argument at — and a role's word anywhere else is an agent's argument, never a role", () => {
    const exe = "/App/Contents/Resources/bin/fieldd";
    // a single executable repeats itself at argv[1]
    expect(roleOf([exe, exe, AGENT_SHIM_ROLE_ARG, "/home/lib/agent-shim.cjs"])).toBe("agent-shim");
    expect(roleOf([exe, exe, FILES_HOST_ROLE_ARG])).toBe("files-host");
    expect(roleOf(["/usr/bin/node", "/dist/bin.cjs", AGENT_SHIM_ROLE_ARG])).toBe("agent-shim");
    // the daemon: no argument at all
    expect(roleOf([exe, exe])).toBeUndefined();
    // a typed agent's own arguments, which carry a role's word further along
    for (const argv of [
      [exe, exe, "--model", FILES_HOST_ROLE_ARG],
      [exe, exe, AGENT_SHIM_ROLE_ARG.toUpperCase()],
      [exe, exe, `${AGENT_SHIM_ROLE_ARG}=x`],
      [exe, exe, `${FILES_HOST_ROLE_ARG} `],
      [exe, AGENT_SHIM_ROLE_ARG],
    ])
      expect(roleOf(argv), JSON.stringify(argv)).toBeUndefined();
  });

  it("the shim's argv is `node <sealed> <the agent's arguments…>`: the home's copy at argv[3] is dropped, and every argument after it is passed on exactly", () => {
    const exe = "/App/Contents/Resources/bin/fieldd";
    const sealed = "/App/Contents/Resources/bin/agent-shim.cjs";
    const home = "/Users/person/Library/Application Support/VibeField/users/1/agents/shims";
    const agent = ["--resume", "two words", "", FILES_HOST_ROLE_ARG, AGENT_SHIM_ROLE_ARG];
    expect(
      agentShimArgv(
        [exe, exe, AGENT_SHIM_ROLE_ARG, `${home}/lib/agent-shim.cjs`, ...agent],
        exe,
        sealed,
      ),
    ).toEqual([exe, sealed, ...agent]);
    // a launcher with no arguments after the home's copy, and a bare role
    expect(
      agentShimArgv([exe, exe, AGENT_SHIM_ROLE_ARG, `${home}/lib/agent-shim.cjs`], exe, sealed),
    ).toEqual([exe, sealed]);
    expect(agentShimArgv([exe, exe, AGENT_SHIM_ROLE_ARG], exe, sealed)).toEqual([exe, sealed]);
  });

  it("a role that cannot load its sealed shim leaves with the kit's own cannot-run status, in one line that names the launcher and never a path", () => {
    expect(AGENT_SHIM_EXIT_UNAVAILABLE).toBe(SPAWN_THROUGH_EXIT_UNAVAILABLE);
    expect(agentShimUnavailable(TYPED_COMMAND)).toBe(
      `VibeField: ${TYPED_COMMAND} was not started: this copy of VibeField is missing the file it starts agents with. Reinstall VibeField.`,
    );
    // a name the kit would never write a launcher for is not said
    for (const name of [undefined, "", "../x", "a b", `x${"y".repeat(200)}`, "-flag"])
      expect(agentShimUnavailable(name), String(name)).toContain(
        "VibeField: the agent was not started:",
      );
  });
});

describe("the entry imports nothing of the daemon's at its top (AR-7j)", () => {
  it("is fieldd's own build step, and in its bundle `src/bin.ts` imports only builtins and roles.ts statically — the daemon, the contracts, logging, the users root and the boot environment only by `import()`", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      scripts: { build: string };
    };
    expect(manifest.scripts.build.split(" && ")[0]).toBe(BIN_BUILD_STEP);

    const entry = built.metafile.inputs["src/bin.ts"];
    expect(entry).toBeDefined();
    const imports = entry?.imports ?? [];
    const statics = imports.filter((record) => record.kind !== "dynamic-import");
    // every one a builtin (external), or roles.ts
    expect(
      statics.filter((record) => record.external !== true && record.path !== "src/roles.ts"),
    ).toEqual([]);
    expect(statics.some((record) => record.path === "src/roles.ts")).toBe(true);
    // and roles.ts imports nothing at all
    expect(built.metafile.inputs["src/roles.ts"]?.imports).toEqual([]);
    // the daemon's graph is there — reached by `import()`, evaluated when main() calls it
    const dynamic = imports
      .filter((record) => record.kind === "dynamic-import")
      .map((record) => record.path);
    for (const module of ["src/daemon.ts", "src/boot-env.ts"])
      expect(dynamic, module).toContain(module);
    expect(dynamic.some((path) => path.includes("contracts"))).toBe(true);
    expect(dynamic.some((path) => path.includes("logging"))).toBe(true);
    expect(dynamic.some((path) => path.includes("users"))).toBe(true);
  });
});

describe("`node bin.cjs --vibefield-role=agent-shim …` — the role a packaged launcher runs (AR-7j)", () => {
  it(
    "runs the SEALED shim beside the bundle with the agent's arguments exactly — the home's copy never, no daemon, no readiness line, no data directory",
    async () => {
      // a stand-in for the sealed shim, beside a bundle of the role's own: it
      // says what it was started with and leaves
      const dir = scratch("vf-role-");
      copyBundle(dir);
      const told = join(dir, "sealed-ran.json");
      writeFileSync(
        join(dir, AGENT_SHIM_BUNDLE),
        `"use strict";
require("node:fs").writeFileSync(${JSON.stringify(told)}, JSON.stringify({ argv: process.argv }));
`,
      );
      // the home's copy, poisoned: run, it would say so and leave 99
      const home = join(dir, "home");
      const homeCopy = spawnThroughLayout(home).script;
      mkdirSync(join(home, "lib"), { recursive: true });
      const poisoned = join(dir, "POISONED");
      writeFileSync(
        homeCopy,
        `require("node:fs").writeFileSync(${JSON.stringify(poisoned)}, "the home's copy ran");
process.exit(99);
`,
      );
      // a daemon would make its data directory first: it must not exist after
      const data = join(dir, "data");
      const agent = ["--model", "two words", "", FILES_HOST_ROLE_ARG, AGENT_SHIM_ROLE_ARG];
      const ran = await run(
        process.execPath,
        [join(dir, "bin.cjs"), AGENT_SHIM_ROLE_ARG, homeCopy, ...agent],
        {
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          HOME: home,
          FIELDD_DATA_DIR: data,
          FIELDD_USER_ROOT: join(data, "users", "1"),
          FIELDD_CONTROL_PORT: "0",
        },
      );
      expect(ran).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(existsSync(poisoned)).toBe(false);
      expect(existsSync(data)).toBe(false);
      const seen = JSON.parse(readFileSync(told, "utf8")) as { argv: string[] };
      expect(seen.argv).toEqual([process.execPath, join(dir, AGENT_SHIM_BUNDLE), ...agent]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "with no sealed shim beside it the role says so in one line, leaves with the kit's cannot-run status, and still never runs the home's copy",
    async () => {
      const dir = scratch("vf-role-");
      copyBundle(dir);
      const home = join(dir, "home");
      const homeCopy = spawnThroughLayout(home).script;
      mkdirSync(join(home, "lib"), { recursive: true });
      const poisoned = join(dir, "POISONED");
      writeFileSync(
        homeCopy,
        `require("node:fs").writeFileSync(${JSON.stringify(poisoned)}, "ran");\n`,
      );
      const ran = await run(
        process.execPath,
        [join(dir, "bin.cjs"), AGENT_SHIM_ROLE_ARG, homeCopy, "--resume", "x"],
        {
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          HOME: home,
          PUPPETEER_SHIM_NAME: TYPED_COMMAND,
        },
      );
      expect(ran).toEqual({
        code: SPAWN_THROUGH_EXIT_UNAVAILABLE,
        stdout: "",
        stderr: `${agentShimUnavailable(TYPED_COMMAND)}\n`,
      });
      expect(existsSync(poisoned)).toBe(false);
    },
    PROCESS_BUDGET_MS,
  );
});

/** The file's one bundle, copied into a row's own directory (each row seals its own shim beside it). */
function copyBundle(dir: string): void {
  writeFileSync(join(dir, "bin.cjs"), readFileSync(built.bin));
}

describe("a launcher naming the role — the REAL floor (AR-7j)", () => {
  it(
    "a name typed in a pane runs through `node bin.cjs --vibefield-role=agent-shim`: the run is managed — a row in the fold, a record with the launcher's pid — the home's copy never runs, and what cannot be carried is refused in VibeField's words",
    async () => {
      const bin = join(bundleDir, "bin.cjs");
      const box = await floor({
        bundle: join(bundleDir, AGENT_SHIM_BUNDLE),
        gateway: { launcher: { command: process.execPath, args: [bin, AGENT_SHIM_ROLE_ARG] } },
      });
      const layout = spawnThroughLayout(box.home);
      // the kit wrote the role into the launcher, before the home's copy
      const launcher = readFileSync(join(box.shimDirectory, TYPED_COMMAND), "utf8");
      expect(launcher.split("\n").find((line) => line.startsWith("exec "))).toBe(
        `exec '${process.execPath}' '${bin}' '${AGENT_SHIM_ROLE_ARG}' '${layout.script}' "$@"`,
      );
      expect(box.daemon.agentGateway?.state().launcher).toEqual({
        command: process.execPath,
        source: "configured",
      });
      // the home's copy, poisoned now the gateway has written it: run, it would leave 99
      const poisoned = join(box.root, "POISONED");
      writeFileSync(
        layout.script,
        `require("node:fs").writeFileSync(${JSON.stringify(poisoned)}, "ran");
process.exit(99);
`,
      );

      // ── type it: a managed run ──
      const pane = await openPane(box);
      await type(box, pane, TYPED_COMMAND);
      const row = await adopted(box, pane);
      expect(row).toMatchObject({
        spawnedBy: "user-shell",
        tier: "managed",
        terminal: { hosted: "local", runtimeSessionId: pane.sessionId },
      });
      const record = readRecord(box.dataDir, row.runtimeRunId);
      expect(record).toMatchObject({ spawnedBy: "user-shell", terminalSessionId: pane.sessionId });
      expect(record.process?.pid).toBeGreaterThan(0);
      // the recipe ran, managed; the real executable did not; the home's copy never ran
      await until(() => (linesOf(box.script.managedLog).length === 1 ? true : undefined));
      expect(linesOf(box.script.realLog)).toEqual([]);
      expect(existsSync(poisoned)).toBe(false);
      const acts = await until(() => {
        const found = auditActs(box.dataDir, "agent.session.adopt");
        return found.length > 0 && found[0]?.outcome !== undefined ? found : undefined;
      });
      expect(acts[0]?.outcome).toMatchObject({ outcome: "succeeded" });

      // the agent ends the way a person ends it, and the pane is free
      await key(box, pane, END_OF_INPUT);
      await until(
        () => (rowOf(box, row.runtimeRunId) === undefined ? true : undefined),
        FLOOR_WAIT_MS,
        "the row leaving",
      );

      // ── refused: what the scripted agent cannot carry, in VibeField's words ──
      // `2> file`: the launcher's words to a file; its input and output stay the
      // terminal, so the launch is interactive — what a refusal is for
      const said = join(box.root, "refused.txt");
      const status = await statusOf(box, pane, `${TYPED_COMMAND} --bare 2> '${said}'`, "bare");
      expect(status).toBe(REFUSED_BY_THE_KIT);
      const sentence = `${TYPED_COMMAND} was not started: a managed session cannot carry --bare (the scripted agent has no managed form for it). Run ${TYPED_COMMAND} without it.`;
      const words = readFileSync(said, "utf8");
      expect(words).toContain(`${AGENT_GATEWAY_HOST_LABEL}: ${sentence}`);
      // nothing ran: not the real executable, not a second recipe, not the home's copy
      expect(linesOf(box.script.realLog)).toEqual([]);
      expect(linesOf(box.script.managedLog).length).toBe(1);
      expect(existsSync(poisoned)).toBe(false);
      const refused = await until(() => {
        const found = auditActs(box.dataDir, "agent.session.adopt_refused");
        return found.length > 0 && found[0]?.outcome !== undefined ? found : undefined;
      });
      expect(refused[0]?.attempt).toMatchObject({ reasonCode: "REJECTED_ARGUMENT" });
    },
    FLOOR_BUDGET_MS,
  );
});
