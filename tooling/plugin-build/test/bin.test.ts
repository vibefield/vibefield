// DK-10 — the bin's command line: every agent of the ten-minute bar asked `plugin-build --help` first, and the bin
// built a plugin at `./--help` ("no vibefield.plugin.json in …/--help"). An option is never a directory.
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const BIN = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "bin", "plugin-build.mjs");
const run = promisify(execFile);

describe("plugin-build's command line (DK-10)", () => {
  it("--help prints its usage and exits 0 — it says what it reads, what it writes, and what emits the manifest", async () => {
    const { stdout } = await run(process.execPath, [BIN, "--help"]);
    expect(stdout).toContain("plugin-build [<plugin dir>]");
    expect(stdout).toContain("vibefield-plugin emit-manifest");
    expect(stdout).not.toContain("FAILED");
  });

  it("an unknown option is refused with the usage, never read as a plugin directory", async () => {
    const failed = await run(process.execPath, [BIN, "--bogus"]).catch(
      (error: { code?: number; stderr?: string }) => error,
    );
    expect((failed as { code?: number }).code).toBe(1);
    expect((failed as { stderr?: string }).stderr).toContain("unknown option --bogus");
    expect((failed as { stderr?: string }).stderr).not.toContain("vibefield.plugin.json in");
  });
});
