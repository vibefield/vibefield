// AR-7b/c — a typed agent is a managed agent: fieldd as the HOST of puppeteer's
// spawn-through kit (`@vibecook/puppeteer-runtime/spawn-through`). The kit gives
// the gateway, the wire, the shim, the launcher and the rendezvous files; what
// is under test here is VibeField's side of it and nothing of any vendor's —
// the scripted provider is the instrument, and no row runs a vendor's binary.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SPAWN_THROUGH_EXIT_UNAVAILABLE } from "@vibecook/puppeteer-runtime/spawn-through";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT_SHIM_ENTRY, bundleAgentShim } from "./agent-shim-bundle";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A loaded host takes seconds to start a process: no row here asserts speed. */
const PROCESS_BUDGET_MS = 60_000;

let bundleDir: string;
let shimScript: string;
beforeAll(async () => {
  bundleDir = mkdtempSync(join(tmpdir(), "vf-shim-"));
  shimScript = await bundleAgentShim(bundleDir);
}, PROCESS_BUDGET_MS);
afterAll(() => {
  rmSync(bundleDir, { recursive: true, force: true });
});

/** Run a program to its end: what it printed and how it left. */
function run(
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { encoding: "utf8", timeout: PROCESS_BUDGET_MS, ...options },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === "number" ? error.code : (null as null);
        resolve({ code, stdout, stderr });
      },
    );
  });
}

describe("the shim bundle (AR-7b)", () => {
  it(
    "is ONE CommonJS file built from the pinned kit's own entry, and run without its launcher's variables it says so and leaves with the kit's status",
    async () => {
      expect(statSync(shimScript).isFile()).toBe(true);
      // the launcher names these two; without them the shim can do nothing
      const env = { ...process.env };
      delete env["PUPPETEER_SHIM_NAME"];
      delete env["PUPPETEER_SHIM_HOME"];
      const bare = await run(process.execPath, [shimScript], { env });
      expect(bare.code).toBe(SPAWN_THROUGH_EXIT_UNAVAILABLE);
      expect(bare.stderr).toContain("PUPPETEER_SHIM_NAME and PUPPETEER_SHIM_HOME are required");
      expect(bare.stdout).toBe("");
    },
    PROCESS_BUDGET_MS,
  );

  it("is a step of fieldd's own build, beside the daemon's bundle, with the options the rows above ran", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      scripts: { build: string };
    };
    const steps = manifest.scripts.build.split(" && ");
    const step = steps.find((candidate) => candidate.includes("agent-shim.cjs"));
    expect(step).toBe(
      `esbuild ${AGENT_SHIM_ENTRY} --bundle --platform=node --format=cjs --target=node22 --outfile=dist/agent-shim.cjs`,
    );
    // beside the daemon's own bundle: that is where the gateway looks by default
    expect(steps.some((candidate) => candidate.includes("--outfile=dist/bin.cjs"))).toBe(true);
  });
});
