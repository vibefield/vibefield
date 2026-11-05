// AR-7j (LP-D1/LP-D2) — a typed agent in the PACKAGED pair, run from the ARTIFACT.
// Opt-in: FIELDD_TEST_AGENTS_PACKAGE names a package's Resources/bin, and
// apps/desktop/packaging/verify-agents-package.mjs sets it (the only runner that
// has one). Each row execs the real single-executable fieldd from there, over the
// packaged field-native as a REAL floor, as the shell would spawn the pair
// (FIELDD_USER_ROOT, ephemeral ports, the app origin). Its person and the agent's
// stand-in are the godview smoke's own (electron-shell's testing/typed-agent.ts:
// a throwaway HOME, a machine record naming the stub as the typed agent's active
// install), so nothing of the machine owner's is read and no vendor's binary runs.
//  - the packaged fieldd writes its launchers over ITSELF: each execs the
//    executable in its agent-shim role (roles.ts), the sealed shim beside it runs
//    and the home's copy never does; a name typed in a pane is a managed run —
//    a row in the fold, a record holding the launcher's pid, the shell its parent,
//    no private variable handed to the agent — and an argument the agent's adapter
//    cannot carry is refused in VibeField's words with the kit's status;
//  - measured, and reported whatever it says: the role's added start cost over
//    the bare program (median of 20 interleaved runs, against LP-D2's ~250 ms) and
//    the packaged fieldd's publish after a relaunch (against the 8 s a launcher
//    waits for it). FIELDD_TEST_AGENTS_REPORT, when set, is a directory the two
//    measurements are written to as JSON, for the verifier's verdict lines.
import { type ChildProcess, spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AgentListResult, LAYOUT, type TerminalCreateResult } from "@vibefield/contracts";
import {
  launcherScript,
  readLaunchProviders,
  readRendezvous,
  readTerminals,
  spawnThroughLayout,
} from "@vibefield/puppeteer-runtime/spawn-through";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_GATEWAY_HOST_LABEL,
  AGENT_GATEWAY_STRICT,
  agentShimHome,
  sealedAgentShim,
} from "../src/agent-gateway";
import { AGENT_SHIM_ROLE_ARG } from "../src/roles";
import { readRecord, teardownFloors, windowAt } from "./agent-gateway-floor";
import {
  killDaemonTree,
  removeTempRoot,
  shortTmpRoot,
  waitForMgmtEndpoint,
} from "./native-harness";

const PACKAGE = process.env["FIELDD_TEST_AGENTS_PACKAGE"];
const REPORT = process.env["FIELDD_TEST_AGENTS_REPORT"];
const exe = (name: string): string => (process.platform === "win32" ? `${name}.exe` : name);
const HERE = dirname(fileURLToPath(import.meta.url));

/** LP-D2's budget for what the role adds to an agent's start, median. Over it is
 * REPORTED (here and in the verifier's verdict), never a red row: a loaded host's
 * number is not the product's, and a hidden one is worse. */
const ROLE_COST_BUDGET_MS = 250;
/** Interleaved runs per arm. */
const COST_RUNS = 20;
/** The kit's status for a refused launch (EX_TEMPFAIL): refused, not failed. */
const REFUSED_BY_THE_KIT = 75;
/** A cold signed executable and a cold floor outlast any product deadline; the rows' own waits are the checks. */
const WAIT_MS = 90_000;
const ROW_BUDGET_MS = 420_000;

// ── the person and the stub: the godview smoke's ──

/** electron-shell's testing/typed-agent.ts, as these rows use it. */
interface StagedPerson {
  /** the catalog id the stub stands in for */
  agentId: string;
  stub: string;
  /** one JSON line per run of the stub */
  calls: string;
  person: string;
  work: string;
  /** the environment the pair is spawned with: the person's */
  environment: Record<string, string>;
}
interface StubCall {
  argv: string[];
  envKeys: string[];
  tty: boolean;
  pid: number;
  ppid: number;
}
interface TypedAgentStaging {
  /** an argument the typed agent's adapter refuses for an interactive session */
  TYPED_AGENT_REFUSED_ARGUMENT: string;
  stageTypedAgent(opts: { vibefieldRoot: string }): StagedPerson;
  readTypedAgentCalls(calls: string): StubCall[];
  /** the kit's and VibeField's private variables a run was handed */
  leakedVariables(call: Pick<StubCall, "envKeys">): string[];
}

/** Loaded by a COMPUTED path, on purpose: electron-shell dev-depends on fieldd, and
 * a literal import from here would give Nx's project graph an edge fieldd →
 * electron-shell, which `build`'s `^build` would then walk as a cycle. vitest
 * transforms the file the same either way; the shape it must have is checked. */
async function staging(): Promise<TypedAgentStaging> {
  const stager = join(HERE, "..", "..", "electron-shell", "src", "testing", "typed-agent.ts");
  const loaded = (await import(stager)) as Partial<TypedAgentStaging>;
  if (
    typeof loaded.stageTypedAgent !== "function" ||
    typeof loaded.readTypedAgentCalls !== "function" ||
    typeof loaded.leakedVariables !== "function" ||
    typeof loaded.TYPED_AGENT_REFUSED_ARGUMENT !== "string"
  ) {
    throw new Error(`${stager} no longer stages the typed agent as this witness reads it`);
  }
  return loaded as TypedAgentStaging;
}

// ── the packaged pair ──

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ask until there is an answer; a throw is a "not yet" whose words the timeout carries. */
async function until<T>(
  read: () => T | undefined | Promise<T | undefined>,
  label: string,
  ms: number = WAIT_MS,
): Promise<T> {
  const deadline = Date.now() + ms;
  let last: unknown;
  for (;;) {
    try {
      const value = await read();
      if (value !== undefined) return value;
    } catch (error) {
      last = error;
    }
    if (Date.now() > deadline)
      throw new Error(`until: ${label}${last === undefined ? "" : ` (last: ${String(last)})`}`);
    await sleep(100);
  }
}

/** Quote one word for POSIX `sh`. */
const sh = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

interface Booted {
  child: ChildProcess;
  readyMs: number;
  port: number;
  stderr: () => string;
}

/** The packaged fieldd, spawned as the shell spawns it; answered at its readiness line. */
async function bootFieldd(sea: string, env: Record<string, string>): Promise<Booted> {
  const started = performance.now();
  const child = spawn(sea, [], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4_000);
  });
  cleanup.push(() => stopFieldd(child));
  const ready = await new Promise<{ port: number }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no readiness line in ${WAIT_MS} ms\n${stderr}`)),
      WAIT_MS,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      for (const line of stdout.split("\n")) {
        if (!line.startsWith("{")) continue;
        try {
          const said = JSON.parse(line) as { ready?: boolean; port?: number };
          if (said.ready === true && typeof said.port === "number") {
            clearTimeout(timer);
            resolve({ port: said.port });
          }
        } catch {
          // half a line: the next chunk completes it
        }
      }
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(`the packaged fieldd exited before it was ready (${signal ?? code})\n${stderr}`),
      );
    });
  });
  return { child, readyMs: performance.now() - started, port: ready.port, stderr: () => stderr };
}

/** SIGTERM, as the shell's quit does; SIGKILL only past 15 s. */
function stopFieldd(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const kill = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.once("exit", () => {
      clearTimeout(kill);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

interface Pair {
  root: string;
  dataDir: string;
  /** the launchers' home */
  home: string;
  staged: StagedPerson;
  /** the packaged executable, by its physical path (what `process.execPath` says in it) */
  sea: string;
  env: Record<string, string>;
  fieldd: Booted;
  shellToken: string;
}

async function packagedPair(staging: TypedAgentStaging): Promise<Pair> {
  const bin = PACKAGE as string;
  // a SHORT root: the floor's sockets must fit macOS's 104-byte sun_path
  const root = shortTmpRoot("vf-pka-");
  // removed after every process of the row is reaped (cleanup runs in reverse)
  cleanup.push(() => removeTempRoot(root));
  const dataDir = join(root, ...LAYOUT.USERS_DIR, "1");
  const logs = join(root, "logs");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  mkdirSync(logs, { recursive: true });
  const staged = staging.stageTypedAgent({ vibefieldRoot: root });
  // the person's environment, without this harness's own switches
  const person = Object.fromEntries(
    Object.entries(staged.environment).filter(([name]) => !name.startsWith("FIELDD_TEST_")),
  );
  const nativeBin = join(bin, exe("field-native"));
  const native = spawn(nativeBin, [], {
    env: {
      ...person,
      FIELD_NATIVE_DATA_DIR: dataDir,
      FIELD_LOG_DIR: logs,
      FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
    },
    stdio: "ignore",
  });
  cleanup.push(() => killDaemonTree(native));
  await waitForMgmtEndpoint(dataDir, 30_000);
  const env = {
    ...person,
    FIELDD_USER_ROOT: dataDir,
    FIELDD_CONTROL_PORT: "0",
    FIELDD_DATA_PORT: "0",
    FIELDD_ALLOWED_ORIGINS: "vibefield-app://shell",
    // the floor above is adopted; this is the respawn the product would make
    FIELDD_NATIVE_BIN: nativeBin,
    FIELD_LOG_DIR: logs,
    FIELDD_ALLOW_LOG_DIR_OVERRIDE: "1",
  };
  const sea = realpathSync(join(bin, exe("fieldd")));
  const fieldd = await bootFieldd(sea, env);
  const shellToken = await until(() => {
    const token = join(dataDir, ...LAYOUT.SHELL_TOKEN);
    return existsSync(token) ? readFileSync(token, "utf8").trim() || undefined : undefined;
  }, "the packaged fieldd's shell token");
  return { root, dataDir, home: agentShimHome(dataDir), staged, sea, env, fieldd, shellToken };
}

/** The gateway as THIS boot published it: a rendezvous that is not `previous`'s,
 * and the typed agent's launcher. */
async function published(
  pair: Pair,
  previous?: string,
): Promise<{ token: string; retryMs: number; name: string; launcher: string }> {
  return until(async () => {
    const rendezvous = await readRendezvous(pair.home);
    if (rendezvous === undefined || rendezvous.token === previous) return undefined;
    const provider = (await readLaunchProviders(pair.home))?.find(
      (each) => each.id === pair.staged.agentId,
    );
    const name = provider?.nativeInvocation?.commands[0]?.name;
    if (name === undefined) return undefined;
    const launcher = join(spawnThroughLayout(pair.home).shimDirectory, name);
    return existsSync(launcher)
      ? { token: rendezvous.token, retryMs: rendezvous.retryMs, name, launcher }
      : undefined;
  }, "the packaged gateway publishing the typed agent's launcher").catch((error: unknown) => {
    throw new Error(`${String(error)}\n${pair.fieldd.stderr()}`);
  });
}

/** A home copy of the shim that says so if it is ever run. */
function poisonHomeCopy(pair: Pair): string {
  const marker = join(pair.root, "HOME-COPY-RAN");
  writeFileSync(
    spawnThroughLayout(pair.home).script,
    `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "the home's copy ran");
process.exit(99);
`,
  );
  return marker;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};
const round = (ms: number): number => Math.round(ms * 10) / 10;

/** One run of a program to its end, timed from the spawn to the exit. */
function timed(
  command: string,
  args: readonly string[],
  env: Record<string, string>,
): Promise<{ ms: number; code: number | null }> {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(command, [...args], { env, stdio: "ignore" });
    child.once("error", () => resolve({ ms: performance.now() - started, code: null }));
    child.once("exit", (code) => resolve({ ms: performance.now() - started, code }));
  });
}

describe.skipIf(PACKAGE === undefined || PACKAGE === "")(
  "AR-7j — a typed agent in the packaged pair (FIELDD_TEST_AGENTS_PACKAGE)",
  () => {
    it(
      "the packaged fieldd's launcher execs its OWN executable in the agent-shim role; a name typed in a pane is a managed run, the home's copy of the shim never runs, and an argument the agent cannot carry is refused in VibeField's words",
      async () => {
        const typed = await staging();
        const pair = await packagedPair(typed);
        const { name, launcher } = await published(pair);
        const layout = spawnThroughLayout(pair.home);

        // ── the launcher: the kit's own script over the role, exactly ──
        expect(readFileSync(launcher, "utf8")).toBe(
          launcherScript({
            name,
            home: pair.home,
            runtime: { command: pair.sea, args: [AGENT_SHIM_ROLE_ARG] },
            strict: AGENT_GATEWAY_STRICT,
            hostLabel: AGENT_GATEWAY_HOST_LABEL,
          }),
        );
        const execLine = readFileSync(launcher, "utf8")
          .split("\n")
          .find((line) => line.startsWith("exec "));
        expect(execLine).toBe(
          `exec ${sh(pair.sea)} ${sh(AGENT_SHIM_ROLE_ARG)} ${sh(layout.script)} "$@"`,
        );
        expect(existsSync(sealedAgentShim(pair.sea))).toBe(true);
        console.log(`PACKAGED_LAUNCHER ${execLine}`);
        // the home's copy, poisoned now the gateway has written it
        const homeCopyRan = poisonHomeCopy(pair);

        // ── a pane: its shell types what a person would ──
        // `2> file` keeps the refused launch's input and output the terminal, so it is
        // interactive — what a refusal is for — and leaves its words in a file to read
        const refusedWords = join(pair.root, "refused.txt");
        const refusedStatus = join(pair.root, "refused.status");
        // the shell types nothing until the gateway lists it, as a person's first line comes
        // after the prompt: the floor rows' order (born, listed, typed)
        const go = join(pair.root, "pane-go");
        const paneShell = join(pair.root, "pane-shell");
        writeFileSync(
          paneShell,
          [
            "#!/bin/sh",
            "# AR-7j's packaged witness: the pane's shell, typing what a person types",
            `PATH=${sh(layout.shimDirectory)}:"$PATH"; export PATH`,
            `while [ ! -e ${sh(go)} ]; do sleep 0.1; done`,
            sh(name),
            `${sh(name)} ${sh(typed.TYPED_AGENT_REFUSED_ARGUMENT)} 2> ${sh(refusedWords)}; echo "status=$?" > ${sh(refusedStatus)}`,
            "exec /bin/cat",
            "",
          ].join("\n"),
        );
        chmodSync(paneShell, 0o755);
        const win = await windowAt(pair.fieldd.port, pair.shellToken, [
          "agent.spawn",
          "agent.observe",
          "agent.control",
          "terminal.attach",
        ]);
        const created = (await win.call("terminal.create", {
          shell: paneShell,
          cwd: pair.staged.work,
        })) as TerminalCreateResult;
        await until(async () => {
          const shells = (await readTerminals(pair.home)) ?? [];
          const shell = created.session.pid;
          return (shell === null ? shells.length > 0 : shells.some((each) => each.pid === shell))
            ? true
            : undefined;
        }, "the packaged gateway listing the pane's shell for its launchers");
        writeFileSync(go, "go\n");

        // ── the managed run ──
        const managed = (call: StubCall) => call.tty && call.argv.includes("--session-id");
        const call = await until(
          () => typed.readTypedAgentCalls(pair.staged.calls).find(managed),
          "the stub started as a managed session in the pane",
        ).catch((error: unknown) => {
          throw new Error(`${String(error)}\n${pair.fieldd.stderr()}`);
        });
        const row = await until(async () => {
          const listed = (await win.call("agent.list", {})) as AgentListResult;
          return listed.sessions.find(
            (each) => each.terminal?.runtimeSessionId === created.sessionId,
          );
        }, "the typed run in the packaged fold");
        expect(row).toMatchObject({
          spawnedBy: "user-shell",
          tier: "managed",
          kind: pair.staged.agentId,
        });
        const record = readRecord(pair.dataDir, row.runtimeRunId);
        expect(record).toMatchObject({
          spawnedBy: "user-shell",
          terminalSessionId: created.sessionId,
          process: { pid: call.pid },
        });
        // one pid from the prompt to the agent: the pane's shell is its parent
        if (created.session.pid !== null) expect(call.ppid).toBe(created.session.pid);
        // EL7: nothing of the kit's or of VibeField's private classes reached the agent
        expect(typed.leakedVariables(call)).toEqual([]);
        expect(existsSync(homeCopyRan)).toBe(false);
        console.log(
          `PACKAGED_TYPED_RUN ${JSON.stringify({ run: row.runtimeRunId, pid: call.pid, flags: call.argv.filter((argument) => argument.startsWith("-")) })}`,
        );

        // the agent ends; the row leaves, and the pane's shell goes on to its next line
        process.kill(call.pid, "SIGTERM");
        await until(async () => {
          const listed = (await win.call("agent.list", {})) as AgentListResult;
          return listed.sessions.some((each) => each.runtimeRunId === row.runtimeRunId)
            ? undefined
            : true;
        }, "the typed run leaving the packaged fold");

        // ── refused, in VibeField's words, with the kit's status — and nothing ran ──
        const status = await until(
          () =>
            existsSync(refusedStatus)
              ? readFileSync(refusedStatus, "utf8").trim() || undefined
              : undefined,
          "the refused launch's status",
        );
        expect(status).toBe(`status=${REFUSED_BY_THE_KIT}`);
        const words = readFileSync(refusedWords, "utf8");
        expect(words).toContain(`${AGENT_GATEWAY_HOST_LABEL}: ${name} was not started`);
        expect(words).toContain(typed.TYPED_AGENT_REFUSED_ARGUMENT);
        const sessions = typed.readTypedAgentCalls(pair.staged.calls).filter((each) => each.tty);
        expect(sessions.map((each) => each.pid)).toEqual([call.pid]);
        expect(existsSync(homeCopyRan)).toBe(false);
        console.log(`PACKAGED_REFUSED ${JSON.stringify(words.trim())}`);
      },
      ROW_BUDGET_MS,
    );

    it(
      "measured and reported, never hidden: the role's added start cost over the bare program (20 interleaved runs), and the packaged fieldd's publish after a relaunch against the launcher's wait",
      async () => {
        const sea = realpathSync(join(PACKAGE as string, exe("fieldd")));
        const sealed = sealedAgentShim(sea);
        expect(existsSync(sealed)).toBe(true);

        // ── the role's start cost ──
        // three arms, interleaved so a host's drift lands on all of them: the bare
        // program; the packaged role, whose shim finds nothing to manage and execs
        // that program in place; and a real Node running the same sealed shim (what
        // a development build's launcher runs), for scale
        const scratch = realpathSync(mkdtempSync(join(tmpdir(), "vf-pka-cost-")));
        cleanup.push(() => rmSync(scratch, { recursive: true, force: true }));
        const programs = join(scratch, "bin");
        const home = join(scratch, "home");
        mkdirSync(programs, { recursive: true });
        mkdirSync(join(home, "lib"), { recursive: true });
        const probeName = "vf-cost-probe";
        const program = join(programs, probeName);
        writeFileSync(program, "#!/bin/sh\nexit 0\n");
        chmodSync(program, 0o755);
        const homeCopyRan = join(scratch, "HOME-COPY-RAN");
        writeFileSync(
          spawnThroughLayout(home).script,
          `require("node:fs").writeFileSync(${JSON.stringify(homeCopyRan)}, "ran");\nprocess.exit(99);\n`,
        );
        const env = {
          PATH: `${programs}:/usr/bin:/bin`,
          HOME: home,
          PUPPETEER_SHIM_NAME: probeName,
          PUPPETEER_SHIM_HOME: home,
          PUPPETEER_SHIM_STRICT: "0",
          PUPPETEER_SHIM_STRIP: "",
        };
        const arms = {
          bare: () => timed(program, [], env),
          role: () => timed(sea, [AGENT_SHIM_ROLE_ARG, spawnThroughLayout(home).script], env),
          node: () => timed(process.execPath, [sealed], env),
        };
        const cold = await arms.role();
        const samples = { bare: [] as number[], role: [] as number[], node: [] as number[] };
        const failures: string[] = [];
        if (cold.code !== 0) failures.push(`cold role run left ${cold.code}`);
        const order = ["bare", "role", "node"] as const;
        for (let run = 0; run < COST_RUNS; run += 1) {
          for (let i = 0; i < order.length; i += 1) {
            const arm = order[(run + i) % order.length] as (typeof order)[number];
            const result = await arms[arm]();
            if (result.code !== 0) failures.push(`${arm} run ${run} left ${result.code}`);
            samples[arm].push(result.ms);
          }
        }
        const added = samples.role.map((ms, i) => ms - (samples.bare[i] as number));
        const cost = {
          runs: COST_RUNS,
          bareMedianMs: round(median(samples.bare)),
          roleMedianMs: round(median(samples.role)),
          nodeMedianMs: round(median(samples.node)),
          addedMedianMs: round(median(added)),
          addedOverNodeMedianMs: round(median(samples.role) - median(samples.node)),
          coldRoleMs: round(cold.ms),
          budgetMs: ROLE_COST_BUDGET_MS,
          withinBudget: median(added) <= ROLE_COST_BUDGET_MS,
        };
        console.log(`PACKAGED_ROLE_COST ${JSON.stringify(cost)}`);
        if (REPORT !== undefined && REPORT !== "")
          writeFileSync(join(REPORT, "cost.json"), `${JSON.stringify(cost, null, 2)}\n`);
        expect(failures).toEqual([]);
        expect(existsSync(homeCopyRan)).toBe(false);

        // ── the publish after a relaunch ──
        const typed = await staging();
        const pair = await packagedPair(typed);
        const first = await published(pair);
        await stopFieldd(pair.fieldd.child);
        const relaunched = performance.now();
        pair.fieldd = await bootFieldd(pair.sea, pair.env);
        const again = await published(pair, first.token);
        const publishMs = performance.now() - relaunched;
        const publish = {
          readyMs: round(pair.fieldd.readyMs),
          publishMs: round(publishMs),
          launcherWaitsMs: again.retryMs,
          withinWait: publishMs <= again.retryMs,
        };
        console.log(`PACKAGED_RELAUNCH_PUBLISH ${JSON.stringify(publish)}`);
        if (REPORT !== undefined && REPORT !== "")
          writeFileSync(join(REPORT, "publish.json"), `${JSON.stringify(publish, null, 2)}\n`);
        // the same launcher stands across the relaunch, naming the same executable
        expect(again.name).toBe(first.name);
        expect(readFileSync(again.launcher, "utf8")).toContain(
          `exec ${sh(pair.sea)} ${sh(AGENT_SHIM_ROLE_ARG)}`,
        );
      },
      ROW_BUDGET_MS,
    );
  },
);
