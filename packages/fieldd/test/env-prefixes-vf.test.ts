// item 589 (2026-11-19) — VF_ NAMES LEAVE EVERY CHILD FIELDD MAKES, SAVE A SMOKE'S RUN MARK
// WHERE THE CENSUS READS IT. `VF_` is the prefix of every harness and lab variable (a smoke's
// switches, a stage's loopback door and its token), and ENV_PREFIXES covers it beside FIELD_,
// FIELDD_ and VIBEFIELD_. One name under it is handed back by exact name (ENV_KEEP_NAMES: the
// run's profile name), and only to the children of fieldd the smoke census finds a run's
// processes by: a plain shell (terminal-service.test.ts's item 589 rows) and the workers. An
// agent's PTY and an adapter's helper are never handed it. These rows hold it at fieldd's pure
// sites, each beside an unprefixed control that must arrive; the floor's own row is
// cell_lifecycle.rs's.
import { ENV_KEEP_NAMES } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { agentEnvironment, createTerminalAgentHost } from "../src/agent-host";
import { pluginChildEnv } from "../src/process-service";
import { workerEnvironment } from "../src/workspace/supervisor";

const [MARK] = ENV_KEEP_NAMES;

/** fieldd's environment under a smoke: its run mark, a lab switch, a stage's token, a control. */
const SMOKE_RUN: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin",
  LANG: "en_US.UTF-8",
  [MARK]: "run-589",
  VF_LAB_589: "1",
  VF_PHONE_TOKEN: "a-stage-token",
  CONTROL_589: "must-arrive",
};

const vfNames = (env: Readonly<Record<string, string | undefined>>): string[] =>
  Object.keys(env).filter((key) => key.toUpperCase().startsWith("VF_"));

describe("item 589: no child of fieldd is born with a VF_ name, save the run mark where the census reads it", () => {
  it("an agent's PTY: an adapter's VF_ variable is dropped, its own kept", () => {
    const env = agentEnvironment({
      allowed: { ADAPTER_ROOT: "/profiles/work", VF_LAB_589: "asked" },
      parent: SMOKE_RUN,
      platform: "darwin",
      home: "/home/agent",
    });
    expect(env["ADAPTER_ROOT"]).toBe("/profiles/work");
    expect(vfNames(env)).toEqual([]);
  });

  it("an agent's PTY is never handed the run mark fieldd holds (as on main)", () => {
    const env = agentEnvironment({ parent: SMOKE_RUN, platform: "darwin", home: "/home/agent" });
    expect(env["PATH"]).toBe("/usr/bin:/bin");
    expect(env).not.toHaveProperty(MARK);
  });

  it("an adapter's helper is never handed the run mark fieldd holds (as on main)", () => {
    const host = createTerminalAgentHost({
      terminals: () => null,
      environment: SMOKE_RUN,
      home: "/home/agent",
    });
    const env = host.helperEnvironment({ ADAPTER_ROOT: "/profiles/work" });
    expect(env["ADAPTER_ROOT"]).toBe("/profiles/work");
    expect(env).not.toHaveProperty(MARK);
  });

  it("a plugin's child: a VF_ addition, the mark among them, is dropped, the control kept", () => {
    const env = pluginChildEnv(
      { [MARK]: "asked", VF_LAB_589: "1", CONTROL_589: "kept" },
      "darwin",
      SMOKE_RUN,
    );
    expect(env["CONTROL_589"]).toBe("kept");
    expect(vfNames(env)).toEqual([]);
  });

  it("on win32 the strip folds case, as it does for VibeField's other prefixes", () => {
    const env = pluginChildEnv({ Vf_Lab_589: "1", CONTROL_589: "kept" }, "win32", {});
    expect(env["CONTROL_589"]).toBe("kept");
    expect(vfNames(env)).toEqual([]);
  });

  it("the files worker: fieldd's VF_ names are not handed on, save the run mark by its exact name", () => {
    const env = workerEnvironment(SMOKE_RUN);
    expect(env["CONTROL_589"]).toBe("must-arrive");
    expect(env[MARK]).toBe("run-589");
    expect(vfNames(env)).toEqual([MARK]);
  });
});
