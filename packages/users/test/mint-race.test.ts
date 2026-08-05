import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readUsersFile } from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = join(here, "..");
const childScript = join(here, "fixtures", "mint-child.ts");

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runChild(root: string, goFile: string): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    // Real processes on purpose (V5): in-process races can be masked by shared
    // state; eight OS processes cannot share anything but the filesystem.
    const child = spawn(process.execPath, ["--import", "tsx", childScript, root, goFile], {
      cwd: packageDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("eight real minters, one empty root (§3.3 / V5 scenario b×b)", () => {
  it("exactly one users.json, one ULID, losers adopt", { timeout: 60_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "vf-mint-race-"));
    const goFile = join(mkdtempSync(join(tmpdir(), "vf-mint-go-")), "go");
    const children = Array.from({ length: 8 }, () => runChild(root, goFile));
    // let the interpreters finish booting so the barrier release is a real race
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    writeFileSync(goFile, "go");
    const results = await Promise.all(children);
    for (const result of results) {
      expect(result.code, result.stderr).toBe(0);
    }
    const reports = results.map(
      (result) => JSON.parse(result.stdout.trim()) as { userId: string; created: boolean },
    );
    const userIds = new Set(reports.map((r) => r.userId));
    expect(userIds.size).toBe(1);
    expect(reports.filter((r) => r.created).length).toBe(1);
    const file = readUsersFile(join(root));
    expect(file?.users).toHaveLength(1);
    expect(file?.nextFuid).toBe(2);
    expect(file?.users[0]?.userId).toBe([...userIds][0]);
  });
});
