import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execute = promisify(execFile);
const runner = fileURLToPath(
  new URL("../../../apps/desktop/packaging/run-plugin-runtime-soak.mjs", import.meta.url),
);
// This fixture uses a POSIX executable script as the Electron stand-in. It launches no app/daemon.
const unixIt = process.platform === "win32" ? it.skip : it;

unixIt.each([false, true])(
  "archives diagnostic records through profile cleanup (early failure: %s)",
  async (earlyFailure) => {
    const root = mkdtempSync(join(tmpdir(), "vf-soak-runner-test-"));
    try {
      const fakeDist = join(root, "fake-electron");
      // Ask Electron under its override: path.txt may not exist before its lazy download.
      const { stdout: fake } = await execute(
        process.execPath,
        [
          "-e",
          'process.stdout.write(require("node:module").createRequire(process.argv[1])("electron"))',
          runner,
        ],
        {
          env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: fakeDist },
          timeout: 10_000,
        },
      );
      mkdirSync(dirname(fake), { recursive: true });
      const diagnostic = {
        kind: "phase",
        phase: "os-resources",
        cycle: 0,
        monotonicMs: 100,
        wallTimeMs: 1_000,
      };
      const lines = [`PLUGIN_RUNTIME_SOAK_DIAGNOSTIC ${JSON.stringify(diagnostic)}`];
      if (!earlyFailure) {
        lines.push(`PLUGIN_RUNTIME_SOAK_SAMPLE ${JSON.stringify({ cycle: 0 })}`);
        lines.push(
          `PLUGIN_RUNTIME_SOAK ${JSON.stringify({
            claim: "calibration",
            claimSatisfied: false,
            verdict: { verdict: "pass", sampleCount: 1 },
          })}`,
        );
      }
      writeFileSync(
        fake,
        `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(`${lines.join("\n")}\n`)}, () => process.exit(${earlyFailure ? 2 : 0}));\n`,
        { mode: 0o700 },
      );
      const output = join(root, "trace.jsonl");
      let stdout = "";
      let stderr = "";
      let code = 0;
      try {
        const result = await execute(
          process.execPath,
          [runner, "--cycles", "1", "--no-footprint", "--output", output],
          {
            env: { ...process.env, ELECTRON_OVERRIDE_DIST_PATH: fakeDist },
            timeout: 10_000,
          },
        );
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (error) {
        const failure = error as { stdout: string; stderr: string; code: number };
        stdout = failure.stdout;
        stderr = failure.stderr;
        code = failure.code;
      }
      expect(code, stderr).toBe(earlyFailure ? 1 : 0);
      if (earlyFailure) expect(stderr).toContain("no structured verdict");
      const rows = readFileSync(output, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(rows.find((row) => row.type === "diagnostic")?.diagnostic).toEqual(diagnostic);
      expect(rows.filter((row) => row.type === "sample")).toHaveLength(earlyFailure ? 0 : 1);
      const removedLine = stdout
        .split("\n")
        .find((line) => line.startsWith("SMOKE_PROFILE_REMOVED "));
      expect(removedLine).toBeDefined();
      const removed = JSON.parse(removedLine!.slice("SMOKE_PROFILE_REMOVED ".length));
      expect(removed.removed).toBe(true);
      expect(existsSync(removed.userData)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  15_000,
);
