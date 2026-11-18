import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processStartedAt } from "@vibefield/puppeteer-runtime/spawn-through";
import { afterEach, describe, expect, it } from "vitest";
import { agentEnvironment } from "../src/agent-host";
import { readProcesses } from "../src/agent-typed-run";

// item 537 (2026-11-18, EL7) — fieldd reads the process table (the runtime's typed-run proofs, the gateway's
// placement and adoption) through the kit's `readProcessTable`, whose one `ps` is started by a runner the kit takes as
// an option. These rows hold that runner to the agents' allow-list, and hold the table's start for a pid to the
// kit's own `processStartedAt` reading, from the same `ps`.

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});

/** Set a variable of this process for one row, and put it back after. */
function plant(name: string, value: string): void {
  const previous = process.env[name];
  process.env[name] = value;
  cleanup.push(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
}

const LSTART = "Tue Nov 18 06:00:00 2026";
const PID = 424242;

/** A recording `ps`, first on a PATH the row owns. It writes the NAMES in its environment (never a value), one file
 * per process, and answers the two shapes the kit asks (the whole table, and one pid's start) from ONE start, so
 * both readings read the same text. Any other shape exits 1, as `ps` does for a pid that is gone. */
function stubPs(): { calls: string } {
  const root = mkdtempSync(join(tmpdir(), "vf-537ps-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const calls = join(root, "calls");
  mkdirSync(calls);
  writeFileSync(
    join(root, "ps"),
    [
      "#!/bin/sh",
      `env | awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ { print $1 }' > '${calls}'/$$`,
      'case "$*" in',
      `  "-A -o pid= -o ppid= -o lstart=") printf '%7d %7d %s\\n' 1 0 '${LSTART}' ${PID} 1 '${LSTART}' ;;`,
      `  "-o lstart= -p ${PID}") printf '%s\\n' '${LSTART}' ;;`,
      "  *) exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  plant("PATH", `${root}:${process.env["PATH"] ?? ""}`);
  return { calls };
}

const names = (calls: string): string[] =>
  readdirSync(calls).flatMap((file) =>
    readFileSync(join(calls, file), "utf8")
      .split("\n")
      .filter((name) => name !== ""),
  );

describe("the process table fieldd reads (item 537, EL7)", () => {
  it("fieldd's process-table read starts `ps` under the agents' allow-list, never the daemon's environment (item 537, EL7)", async () => {
    const { calls } = stubPs();
    plant("FIELDD_537_SENTINEL", "1");
    plant("VF_537_UNLISTED", "1");
    // the snapshot the runtime is handed: taken here as the composition takes it, after the PATH above
    const environment = agentEnvironment();
    const table = await readProcesses(environment);
    expect(table?.get(PID)?.startedAt).toBe(new Date(Date.parse(LSTART)).toISOString());
    const seen = names(calls);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((n) => n.startsWith("FIELD_") || n.startsWith("FIELDD_"))).toEqual([]);
    expect(seen).not.toContain("VF_537_UNLISTED");
    expect(seen).toEqual(expect.arrayContaining(["PATH", "HOME"]));
  });

  it("a pid's start read from that table is, as a string, what the kit's `processStartedAt` reads from the same `ps` (item 537, parity)", async () => {
    stubPs();
    const kit = await processStartedAt(PID);
    expect(kit).toBe(new Date(Date.parse(LSTART)).toISOString());
    const table = await readProcesses(agentEnvironment());
    expect(table?.get(PID)?.startedAt).toBe(kit);
    // a pid the table does not hold reads undefined, as the kit reads a pid whose `ps` says nothing
    expect(table?.get(PID + 1)).toBeUndefined();
    expect(await processStartedAt(PID + 1)).toBeUndefined();
  });
});
