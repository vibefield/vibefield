import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { ENV_PREFIXES } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { chooseForwarderRuntime, sealedAgentForwarder } from "../src/agent-forwarder";
import { agentEnvironment, createTerminalAgentHost } from "../src/agent-host";
import { AGENT_FORWARDER_BUNDLE, AGENT_FORWARDER_ROLE_ARG } from "../src/roles";

// EL7, item 50's class (the re-attach study's Step 0): a helper an adapter
// spawns itself — a private server, a leader, a backend — runs the agent's
// turns and tools, so it is born with the environment an agent PTY is born
// with: this host's policy over the adapter's own variables, never the
// daemon's own environment.

const run = promisify(execFile);

/** A daemon's environment: both secret classes and a setting no policy grants,
 * beside what an agent may have. */
const DAEMON_ENV: NodeJS.ProcessEnv = {
  PATH: process.env["PATH"] ?? "/usr/bin:/bin",
  LANG: "en_US.UTF-8",
  FIELDD_SECRET_TOKEN: "daemon-secret",
  FIELD_SIDECAR_PATH: "/daemon/only/sidecar",
  DAEMON_ONLY_SETTING: "never-granted",
  // a win32 child aborts without it
  ...(process.platform === "win32"
    ? { SystemRoot: process.env["SystemRoot"] ?? "C:\\Windows" }
    : {}),
};

/** an adapter's own variables, one of them asking for a daemon-secret class */
const ADAPTER_ENV = { ADAPTER_ROOT: "/profiles/work", FIELDD_SMUGGLED: "never" };

const host = () =>
  createTerminalAgentHost({ terminals: () => null, environment: DAEMON_ENV, home: "/home/agent" });

const secretKeys = (env: Record<string, string>): string[] =>
  Object.keys(env).filter((key) =>
    ENV_PREFIXES.some((prefix) => key.toUpperCase().startsWith(prefix)),
  );

describe("helperEnvironment — an adapter's helper runs as the agent, not as fieldd", () => {
  it("is the agent PTY's composition: the policy, the adapter's variables, the strip", () => {
    const env = host().helperEnvironment(ADAPTER_ENV);
    expect(env).toEqual(
      agentEnvironment({ allowed: ADAPTER_ENV, parent: DAEMON_ENV, home: "/home/agent" }),
    );
    expect(env["ADAPTER_ROOT"]).toBe("/profiles/work");
    expect(env["HOME"]).toBe("/home/agent");
    expect(secretKeys(env)).toEqual([]);
    expect(env).not.toHaveProperty("DAEMON_ONLY_SETTING");
  });

  it("a helper spawned under a fieldd holding FIELDD_* and FIELD_* sees none of them", async () => {
    // the helper: a child spawned with what the host composed, printing the
    // environment it was born with
    const { stdout } = await run(
      process.execPath,
      ["-e", "process.stdout.write(JSON.stringify(process.env))"],
      { env: host().helperEnvironment(ADAPTER_ENV) },
    );
    const seen = JSON.parse(stdout) as Record<string, string>;
    expect(secretKeys(seen)).toEqual([]);
    expect(seen).not.toHaveProperty("DAEMON_ONLY_SETTING");
    expect(seen["ADAPTER_ROOT"]).toBe("/profiles/work");
  });
});

// RV #1 (item 203) — the program a managed agent's command hooks and status lines run
// (puppeteer's `AgentHost.forwarderRuntime`). A packaged fieldd is a single executable that
// runs only its own blob, so it lends ITSELF in its closed forwarder role, which runs the
// forwarder sealed beside it; every other fieldd lends nothing, and puppeteer's own script
// runner decides which Node runs its staged forwarder (one authority). No node on PATH is
// ever named here.
describe("forwarderRuntime — what a managed agent's hooks and status lines run (RV #1, item 203)", () => {
  const exe = "/Applications/VibeField.app/Contents/Resources/bin/fieldd";
  /** a lookup a row must never make: only a single executable looks for its sealed forwarder */
  const unasked = (path: string): boolean => {
    throw new Error(`a fieldd that is no single executable looked for ${path}`);
  };

  it("a single executable whose sealed forwarder is readable lends itself in the forwarder role, and looks for nothing else", () => {
    const looked: string[] = [];
    const chosen = chooseForwarderRuntime({
      sea: true,
      execPath: exe,
      exists: (path) => {
        looked.push(path);
        return path === sealedAgentForwarder(exe);
      },
    });
    expect(chosen).toEqual({ command: exe, args: [AGENT_FORWARDER_ROLE_ARG] });
    // the sealed copy is the one beside the executable, and it is the only file looked for
    expect(sealedAgentForwarder(exe)).toBe(join(dirname(exe), AGENT_FORWARDER_BUNDLE));
    expect(looked).toEqual([sealedAgentForwarder(exe)]);
  });

  it("lends nothing for a single executable without its sealed forwarder, a real Node or Electron: puppeteer's runner decides, or refuses", () => {
    const missing = chooseForwarderRuntime({ sea: true, execPath: exe, exists: () => false });
    expect(missing).toBeUndefined();
    const unpackaged = [
      "/usr/local/bin/node",
      "/Applications/Electron.app/Contents/MacOS/Electron",
    ];
    for (const execPath of unpackaged) {
      const chosen = chooseForwarderRuntime({ sea: false, execPath, exists: unasked });
      expect(chosen, execPath).toBeUndefined();
    }
  });

  it("looks on this machine by default: a readable FILE beside the executable, never a directory of its name", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "vf-forwarder-host-")));
    try {
      const packaged = join(dir, "bin", "fieldd");
      mkdirSync(dirname(packaged), { recursive: true });
      expect(chooseForwarderRuntime({ sea: true, execPath: packaged })).toBeUndefined();
      mkdirSync(sealedAgentForwarder(packaged));
      expect(chooseForwarderRuntime({ sea: true, execPath: packaged })).toBeUndefined();
      rmSync(sealedAgentForwarder(packaged), { recursive: true });
      writeFileSync(sealedAgentForwarder(packaged), "// the sealed forwarder\n");
      expect(chooseForwarderRuntime({ sea: true, execPath: packaged })).toEqual({
        command: packaged,
        args: [AGENT_FORWARDER_ROLE_ARG],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the host carries the runtime it is given, and otherwise this process's own choice — under a test's real Node, none", () => {
    const lent = { command: exe, args: [AGENT_FORWARDER_ROLE_ARG] };
    const given = createTerminalAgentHost({ terminals: () => null, forwarderRuntime: lent });
    expect(given.forwarderRuntime).toEqual(lent);
    expect(host().forwarderRuntime).toBeUndefined();
  });
});
