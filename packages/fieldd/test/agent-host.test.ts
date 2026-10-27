import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ENV_PREFIXES } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { agentEnvironment, createTerminalAgentHost } from "../src/agent-host";

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
