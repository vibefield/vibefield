// item 576 (2026-11-19) — VIBEFIELD_ NAMES LEAVE EVERY CHILD FIELDD MAKES. A dev run hands
// Electron main VIBEFIELD_ names (the runner's state root, the checkout, the build id, and any
// release or packaging variable the launching shell exported), and main's whole environment
// reaches fieldd and the floor. ENV_PREFIXES names the classes no child of the daemon inherits;
// VIBEFIELD_ joins FIELD_ and FIELDD_ there. These rows hold it at fieldd's pure sites, each beside
// an unprefixed control that must arrive; the floor's own row is cell_lifecycle.rs's. A person
// still gives such a variable on the command line or in the shell's own profile: the strip is at a
// child's birth, never a filter on what the shell does after.
import { describe, expect, it } from "vitest";
import { agentEnvironment } from "../src/agent-host";
import { pluginChildEnv } from "../src/process-service";
import { workerEnvironment } from "../src/workspace/supervisor";

/** fieldd's environment in a dev run: the runner's names, one planted sentinel, and a control. */
const DEV_RUN: NodeJS.ProcessEnv = {
  PATH: "/usr/bin:/bin",
  LANG: "en_US.UTF-8",
  VIBEFIELD_DEV_ROOT: "/outer/dev-root",
  VIBEFIELD_DEV_REPO_ROOT: "/outer/checkout",
  VIBEFIELD_SENTINEL_576: "must-not-arrive",
  CONTROL_576: "must-arrive",
};

const vibefieldNames = (env: Readonly<Record<string, string | undefined>>): string[] =>
  Object.keys(env).filter((key) => key.toUpperCase().startsWith("VIBEFIELD_"));

describe("item 576: no child of fieldd is born with a VIBEFIELD_ name", () => {
  it("an agent's PTY: an adapter's VIBEFIELD_ variable is dropped, its own kept", () => {
    const env = agentEnvironment({
      allowed: { ADAPTER_ROOT: "/profiles/work", VIBEFIELD_SENTINEL_576: "asked" },
      parent: DEV_RUN,
      platform: "darwin",
      home: "/home/agent",
    });
    expect(env["ADAPTER_ROOT"]).toBe("/profiles/work");
    expect(vibefieldNames(env)).toEqual([]);
  });

  it("a plugin's child: a VIBEFIELD_ addition is dropped, the control kept", () => {
    const env = pluginChildEnv(
      { VIBEFIELD_SENTINEL_576: "asked", CONTROL_576: "kept" },
      "darwin",
      DEV_RUN,
    );
    expect(env["CONTROL_576"]).toBe("kept");
    expect(vibefieldNames(env)).toEqual([]);
  });

  it("on win32 the strip folds case, as it does for FIELD_ and FIELDD_", () => {
    const env = pluginChildEnv(
      { Vibefield_Sentinel_576: "asked", CONTROL_576: "kept" },
      "win32",
      {},
    );
    expect(env["CONTROL_576"]).toBe("kept");
    expect(vibefieldNames(env)).toEqual([]);
  });

  it("the files worker: fieldd's VIBEFIELD_ names are not handed on, the control is", () => {
    const env = workerEnvironment(DEV_RUN);
    expect(env["CONTROL_576"]).toBe("must-arrive");
    expect(env["PATH"]).toBe("/usr/bin:/bin");
    expect(vibefieldNames(env)).toEqual([]);
  });
});
