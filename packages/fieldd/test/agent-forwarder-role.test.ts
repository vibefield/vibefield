// RV #1 (item 203; rv-forwarder-role, built at its lean A) — the agent-forwarder ROLE of
// fieldd's own executable. A packaged fieldd is a single executable that runs only its own
// blob, so puppeteer cannot run the forwarder it would stage for Claude Code's command hooks
// and status lines: the host LENDS the program instead (core `AgentHost.forwarderRuntime`),
// and a packaged fieldd lends itself in this fifth closed role. The role runs puppeteer's
// builtin forwarder entry SEALED beside the executable (`agent-forwarder.cjs`, bundled by
// fieldd's build from the pinned kit) and nothing else: never a script it is handed, never
// the daemon.
//
// What runs here is fieldd's own bundle under a real Node: `node bin.cjs <role> …` hands its
// arguments at the indices a single executable does, so these rows are the role the packaged
// build runs, from source (agent-shim-role.test.ts's pattern). The packaged executable itself
// is build-fieldd-sea.mjs --verify's probe G and desk-gates row 34's witness.
//
//  · the dispatch is POSITIONAL and closed, and the argv the sealed entry sees is
//    `node <sealed> <word> <word's arguments…>` — the pure rows;
//  · the role relays a hook's document with its bearer to a loopback sink and runs a status
//    line's delegate, with no daemon, no readiness line and no data directory;
//  · a script handed after the role is a word the entry does not know: never run;
//  · with no sealed forwarder beside it, DESIGN.md §9's one line and the cannot-run status.
//
// The words after the role (`claude.hook.v1`, `claude.statusline.v1`) are puppeteer's
// protocol, append-only across releases, spelled here only to drive the kit's entry: fieldd's
// own code never reads them (AR-L1).
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPAWN_THROUGH_EXIT_UNAVAILABLE } from "@vibefield/puppeteer-runtime/spawn-through";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  AGENT_FORWARDER_BUNDLE,
  AGENT_FORWARDER_ROLE_ARG,
  AGENT_SHIM_EXIT_UNAVAILABLE,
  AGENT_SHIM_ROLE_ARG,
  agentForwarderArgv,
  FILES_HOST_ROLE_ARG,
  forwarderUnavailable,
  ROLE_ARG_PREFIX,
  roleOf,
} from "../src/roles";
import {
  AGENT_FORWARDER_BUILD_STEP,
  AGENT_FORWARDER_ENTRY,
  bundleAgentForwarder,
} from "./agent-forwarder-bundle";
import { bundleFielddBin } from "./fieldd-bin-bundle";

const PACKAGE_ROOT = join(import.meta.dirname, "..");

/** A loaded host takes seconds to bundle and start a process: no row here asserts speed. */
const PROCESS_BUDGET_MS = 120_000;

/** puppeteer's hook word and status-line word (its forwarder's append-only table). */
const HOOK_WORD = "claude.hook.v1";
const STATUS_LINE_WORD = "claude.statusline.v1";

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
});

function scratch(prefix: string): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Run a program to its end with `input` on its stdin: what it printed and how it left. */
function run(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input = "",
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), PROCESS_BUDGET_MS);
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr });
    });
    // `close`, not `exit`: what the program said is all read only once its stdio has closed
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    // a program that leaves without reading its input closes the pipe under the write
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}

/** One request the sink was sent: never answered with anything but 200. */
interface Heard {
  method: string | undefined;
  path: string | undefined;
  authorization: string | undefined;
  body: string;
}

/** A loopback sink standing in for a session's bridge: it keeps every request it is sent. */
async function sink(): Promise<{ origin: string; heard: Heard[] }> {
  const heard: Heard[] = [];
  const server: Server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      heard.push({
        method: request.method,
        path: request.url,
        authorization: request.headers.authorization,
        body,
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return { origin: `http://127.0.0.1:${port}`, heard };
}

/** fieldd's bundle and the kit's forwarder, built ONCE for the file — the layout a packaged
 * executable's directory has. */
let bundleDir: string;
let built: Awaited<ReturnType<typeof bundleFielddBin>>;
let forwarder: string;
beforeAll(async () => {
  bundleDir = realpathSync(mkdtempSync(join(tmpdir(), "vf-forwarder-bin-")));
  built = await bundleFielddBin(bundleDir);
  forwarder = await bundleAgentForwarder(bundleDir);
}, PROCESS_BUDGET_MS);
afterAll(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});

/** The file's bundle in a row's own directory, with the sealed forwarder beside it or not. */
function stage(dir: string, sealed: boolean): string {
  const bin = join(dir, "bin.cjs");
  writeFileSync(bin, readFileSync(built.bin));
  if (sealed) writeFileSync(join(dir, AGENT_FORWARDER_BUNDLE), readFileSync(forwarder));
  return bin;
}

describe("the agents' forwarder is the executable's fifth closed role (RV #1, item 203)", () => {
  it("its word and its bundle, picked by the FIRST argument alone; a role's word anywhere else is an agent's argument", () => {
    expect(AGENT_FORWARDER_ROLE_ARG).toBe("--vibefield-role=agent-forwarder");
    expect(AGENT_FORWARDER_BUNDLE).toBe("agent-forwarder.cjs");
    expect(AGENT_FORWARDER_ROLE_ARG.startsWith(ROLE_ARG_PREFIX)).toBe(true);
    const exe = "/App/Contents/Resources/bin/fieldd";
    const hook = [HOOK_WORD, "http://127.0.0.1:1/hooks", "PUPPETEER_HOOK_TOKEN", "5000"];
    // a single executable repeats itself at argv[1]; `node bin.cjs` hands the same index
    expect(roleOf([exe, exe, AGENT_FORWARDER_ROLE_ARG, ...hook])).toBe("agent-forwarder");
    expect(roleOf([exe, exe, AGENT_FORWARDER_ROLE_ARG])).toBe("agent-forwarder");
    const viaNode = ["/usr/bin/node", "/dist/bin.cjs", AGENT_FORWARDER_ROLE_ARG, STATUS_LINE_WORD];
    expect(roleOf(viaNode)).toBe("agent-forwarder");
    // further along it is the agent's own argument, and the first is no role at all
    expect(roleOf([exe, exe, "--model", AGENT_FORWARDER_ROLE_ARG])).toBe("stray");
    // a word that only begins like it asks for a role this build does not have
    for (const first of [`${AGENT_FORWARDER_ROLE_ARG}-2`, `${AGENT_FORWARDER_ROLE_ARG}=x`])
      expect(roleOf([exe, exe, first, ...hook]), first).toBe("unknown");
    // the other roles are still theirs
    expect(roleOf([exe, exe, AGENT_SHIM_ROLE_ARG])).toBe("agent-shim");
    expect(roleOf([exe, exe, FILES_HOST_ROLE_ARG])).toBe("files-host");
  });

  it("the sealed entry's argv is `node <sealed> <word> <word's arguments…>`: the role is dropped, and every argument after it is passed on exactly", () => {
    const exe = "/App/Contents/Resources/bin/fieldd";
    const sealed = "/App/Contents/Resources/bin/agent-forwarder.cjs";
    const words = [HOOK_WORD, "http://127.0.0.1:1/hooks", "PUPPETEER_HOOK_TOKEN", "5000", ""];
    const argv = [exe, exe, AGENT_FORWARDER_ROLE_ARG, ...words];
    expect(agentForwarderArgv(argv, exe, sealed)).toEqual([exe, sealed, ...words]);
    // a bare role: the entry is given no word, and says so itself
    const bare = [exe, exe, AGENT_FORWARDER_ROLE_ARG];
    expect(agentForwarderArgv(bare, exe, sealed)).toEqual([exe, sealed]);
  });

  it("a role that cannot load its sealed forwarder says DESIGN.md §9's one line, naming no path, and leaves with the kit's cannot-run status", () => {
    expect(AGENT_SHIM_EXIT_UNAVAILABLE).toBe(SPAWN_THROUGH_EXIT_UNAVAILABLE);
    const design = readFileSync(join(PACKAGE_ROOT, "..", "..", "DESIGN.md"), "utf8");
    expect(design).toContain(`- "${forwarderUnavailable()}"`);
    expect(forwarderUnavailable()).toBe(
      "VibeField: this copy of VibeField is missing the file it observes agents with. Reinstall VibeField.",
    );
    expect(forwarderUnavailable()).toMatch(/^VibeField: [^\n/]+\.$/u);
  });

  it("is a step of fieldd's own build, beside the daemon's bundle, with the options these rows ran", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      scripts: { build: string };
    };
    const steps = manifest.scripts.build.split(" && ");
    expect(steps.filter((step) => step.includes(AGENT_FORWARDER_ENTRY))).toEqual([
      AGENT_FORWARDER_BUILD_STEP,
    ]);
    expect(AGENT_FORWARDER_BUILD_STEP).toMatch(/ --outfile=dist\/agent-forwarder\.cjs$/u);
    expect(steps.some((step) => step.includes("--outfile=dist/bin.cjs"))).toBe(true);
  });
});

describe("`node bin.cjs --vibefield-role=agent-forwarder …` — what a packaged agent's hooks and status lines run (RV #1, item 203)", () => {
  it(
    "relays a hook's document on its input to the bridge with the bearer its variable holds, and leaves 0: no daemon, no readiness line, no data directory",
    async () => {
      const dir = scratch("vf-forwarder-");
      const bin = stage(dir, true);
      const bridge = await sink();
      const data = join(dir, "data");
      const token = "forwarder-row-token";
      const document = JSON.stringify({
        session_id: "forwarder-row",
        cwd: dir,
        hook_event_name: "SessionStart",
        source: "startup",
      });
      const ran = await run(
        process.execPath,
        [
          bin,
          AGENT_FORWARDER_ROLE_ARG,
          HOOK_WORD,
          `${bridge.origin}/hooks`,
          "VF_ROW_TOKEN",
          "5000",
        ],
        {
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          HOME: dir,
          VF_ROW_TOKEN: token,
          FIELDD_DATA_DIR: data,
          FIELDD_CONTROL_PORT: "0",
        },
        document,
      );
      expect(existsSync(data), "no daemon made its data directory").toBe(false);
      expect(ran).toEqual({ code: 0, stdout: "", stderr: "" });
      expect(bridge.heard).toEqual([
        { method: "POST", path: "/hooks", authorization: `Bearer ${token}`, body: document },
      ]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "runs a status line's delegate and prints what it printed, and relays the line's document to its endpoint",
    async () => {
      const dir = scratch("vf-forwarder-");
      const bin = stage(dir, true);
      const bridge = await sink();
      const data = join(dir, "data");
      const token = "status-row-token";
      const document = JSON.stringify({
        session_id: "forwarder-row",
        cwd: dir,
        context_window: { context_window_size: 200_000, total_input_tokens: 0 },
      });
      const ran = await run(
        process.execPath,
        [bin, AGENT_FORWARDER_ROLE_ARG, STATUS_LINE_WORD],
        {
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          HOME: dir,
          PUPPETEER_STATUSLINE_ENDPOINT: `${bridge.origin}/statusline`,
          PUPPETEER_STATUSLINE_DELEGATE: "printf hi",
          PUPPETEER_STATUSLINE_TOKEN_ENV_VAR: "VF_ROW_TOKEN",
          // the relay's own bound, at the most the forwarder takes, as the hook rows hand theirs:
          // its 250 ms default is a loaded host's to miss, and a late relay is dropped in silence
          PUPPETEER_STATUSLINE_TIMEOUT_MS: "5000",
          VF_ROW_TOKEN: token,
          FIELDD_DATA_DIR: data,
          FIELDD_CONTROL_PORT: "0",
        },
        document,
      );
      expect(existsSync(data), "no daemon made its data directory").toBe(false);
      expect(ran).toEqual({ code: 0, stdout: "hi", stderr: "" });
      expect(bridge.heard).toEqual([
        { method: "POST", path: "/statusline", authorization: `Bearer ${token}`, body: document },
      ]);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "never runs a script it is handed: a path after the role is a word the sealed entry does not know, refused with the cannot-run status",
    async () => {
      const dir = scratch("vf-forwarder-");
      const bin = stage(dir, true);
      // puppeteer 0.3's staged forwarder, poisoned: run, it would say so and leave 99
      const poisoned = join(dir, "POISONED");
      const script = join(dir, "X.hooks.mjs");
      writeFileSync(
        script,
        `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(poisoned)}, "ran");
process.exit(99);
`,
      );
      const data = join(dir, "data");
      const ran = await run(
        process.execPath,
        [bin, AGENT_FORWARDER_ROLE_ARG, script, "http://127.0.0.1:1/hooks", "VF_ROW_TOKEN", "5000"],
        {
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          HOME: dir,
          FIELDD_DATA_DIR: data,
          FIELDD_CONTROL_PORT: "0",
        },
      );
      expect(existsSync(poisoned), "the handed script never ran").toBe(false);
      expect(existsSync(data), "no daemon made its data directory").toBe(false);
      expect(ran.code).toBe(SPAWN_THROUGH_EXIT_UNAVAILABLE);
      expect(ran.stdout).toBe("");
      // the kit's own line for a word it does not know: one line, and the path never said back
      expect(ran.stderr.trimEnd().includes("\n")).toBe(false);
      expect(ran.stderr).not.toContain(script);
    },
    PROCESS_BUDGET_MS,
  );

  it(
    "with no sealed forwarder beside it says DESIGN.md §9's line and leaves with the cannot-run status: nothing relayed, no daemon, no data directory",
    async () => {
      const dir = scratch("vf-forwarder-");
      const bin = stage(dir, false);
      const bridge = await sink();
      const data = join(dir, "data");
      const ran = await run(
        process.execPath,
        [
          bin,
          AGENT_FORWARDER_ROLE_ARG,
          HOOK_WORD,
          `${bridge.origin}/hooks`,
          "VF_ROW_TOKEN",
          "5000",
        ],
        {
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          HOME: dir,
          VF_ROW_TOKEN: "missing-row-token",
          FIELDD_DATA_DIR: data,
          FIELDD_CONTROL_PORT: "0",
        },
        JSON.stringify({ hook_event_name: "SessionStart" }),
      );
      expect(existsSync(data), "no daemon made its data directory").toBe(false);
      expect(ran).toEqual({
        code: SPAWN_THROUGH_EXIT_UNAVAILABLE,
        stdout: "",
        stderr: `${forwarderUnavailable()}\n`,
      });
      expect(bridge.heard).toEqual([]);
    },
    PROCESS_BUDGET_MS,
  );
});
