// item 657 (2026-11-23) — NO CHILD OF FIELDD INHERITS A LAUNCHING CLAUDE CODE SESSION'S NAMES.
// VibeField started inside a Claude Code session (`pnpm dev` in its terminal, a harness job) holds
// that session's environment: CLAUDECODE, CLAUDE_CODE_* (its id, its messaging socket and token,
// CLAUDE_CODE_CHILD_SESSION) and two names outside that prefix, CLAUDE_PID and CLAUDE_EFFORT
// (contracts' HOST_SESSION_ENV_PREFIXES and HOST_SESSION_ENV_NAMES). They are stripped from what a
// child INHERITS, never from what VibeField sets: puppeteer's own CLAUDE_CODE_NO_FLICKER still
// reaches every agent, and a person's own CLAUDE_CONFIG_DIR is not the session's and passes. These
// rows hold it at fieldd's pure sites; the floor's own rows are cell_lifecycle.rs's and the kill
// matrix's. Every value here is this file's own sentinel, and every assertion compares NAMES (or a
// sentinel), so a red prints no value the runner's own environment holds.
import { HOST_SESSION_ENV_NAMES, HOST_SESSION_ENV_PREFIXES } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { agentEnvironment, createTerminalAgentHost } from "../src/agent-host";
import { pluginChildEnv } from "../src/process-service";
import { workerEnvironment } from "../src/workspace/supervisor";

/** puppeteer's own policy value for every agent (buildAgentEnvironment). */
const NO_FLICKER = "CLAUDE_CODE_NO_FLICKER";

/** fieldd's environment when VibeField was started inside a Claude Code session: the session's
 * names (sentinel values), a parent value for puppeteer's own name, a person's own Claude setting
 * and an unprefixed control. */
const LAUNCHED_IN_A_SESSION: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin",
  LANG: "en_US.UTF-8",
  CLAUDECODE: "1",
  CLAUDE_CODE_CHILD_SESSION: "sentinel-657",
  CLAUDE_CODE_SESSION_ID: "sentinel-657",
  CLAUDE_CODE_MESSAGING_TOKEN: "sentinel-657",
  CLAUDE_PID: "sentinel-657",
  CLAUDE_EFFORT: "sentinel-657",
  [NO_FLICKER]: "the-parent-says",
  CLAUDE_CONFIG_DIR: "/home/person/.claude-own",
  CONTROL_657: "must-arrive",
};

/** The session's names an environment holds, by name alone (case folded, as the strips fold). */
const sessionNames = (env: Readonly<Record<string, string | undefined>>): string[] =>
  Object.keys(env).filter((key) => {
    const probe = key.toUpperCase();
    return (
      HOST_SESSION_ENV_PREFIXES.some((prefix) => probe.startsWith(prefix)) ||
      (HOST_SESSION_ENV_NAMES as readonly string[]).includes(probe)
    );
  });

describe("item 657: no child of fieldd inherits a launching Claude Code session's names", () => {
  it("the fixture holds every class the strip names, so the rows below are not vacuous", () => {
    expect(sessionNames(LAUNCHED_IN_A_SESSION).sort()).toEqual(
      [
        "CLAUDECODE",
        "CLAUDE_CODE_CHILD_SESSION",
        "CLAUDE_CODE_MESSAGING_TOKEN",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_EFFORT",
        "CLAUDE_PID",
        NO_FLICKER,
      ].sort(),
    );
  });

  for (const platform of ["darwin", "win32"] as const)
    it(`an agent's PTY (${platform}): none of the session's names, and puppeteer's own NO_FLICKER at its own value`, () => {
      const env = agentEnvironment({
        parent: LAUNCHED_IN_A_SESSION,
        platform,
        home: "/home/agent",
      });
      expect(env["PATH"]).toBe("/usr/bin:/bin");
      expect(sessionNames(env)).toEqual([NO_FLICKER]);
      expect(env[NO_FLICKER]).toBe("1");
    });

  it("an adapter's helper: none of the session's names, save puppeteer's own", () => {
    const host = createTerminalAgentHost({
      terminals: () => null,
      environment: LAUNCHED_IN_A_SESSION,
      home: "/home/agent",
    });
    const env = host.helperEnvironment({ ADAPTER_ROOT: "/profiles/work" });
    expect(env["ADAPTER_ROOT"]).toBe("/profiles/work");
    expect(sessionNames(env)).toEqual([NO_FLICKER]);
    expect(env[NO_FLICKER]).toBe("1");
  });

  it("a plugin's child: none of the session's names is inherited", () => {
    const env = pluginChildEnv({ CONTROL_657: "kept" }, "darwin", LAUNCHED_IN_A_SESSION);
    expect(env["CONTROL_657"]).toBe("kept");
    expect(sessionNames(env)).toEqual([]);
  });

  it("the files worker: none of the session's names; the control and a person's own CLAUDE_CONFIG_DIR arrive", () => {
    const env = workerEnvironment(LAUNCHED_IN_A_SESSION);
    expect(env["CONTROL_657"]).toBe("must-arrive");
    expect(env["CLAUDE_CONFIG_DIR"]).toBe("/home/person/.claude-own");
    expect(sessionNames(env)).toEqual([]);
  });

  it("the files worker folds case, as its strip of VibeField's own prefixes does", () => {
    const env = workerEnvironment({
      Claude_Pid: "sentinel-657",
      ClaudeCode: "1",
      Claude_Code_Session_Id: "sentinel-657",
      CONTROL_657: "must-arrive",
    });
    expect(Object.keys(env)).toEqual(["CONTROL_657"]);
  });

  it("an exact name is exact at fieldd's site: a longer name that merely begins with one passes", () => {
    const env = workerEnvironment({ CLAUDE_PIDFILE_657: "/tmp/own", CLAUDE_PID: "sentinel-657" });
    expect(Object.keys(env)).toEqual(["CLAUDE_PIDFILE_657"]);
  });
});
