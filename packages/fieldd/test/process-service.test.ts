import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessService } from "../src/process-service";

// PLUG-P6 — §17.1 supervised children, service-level (the daemon caller
// matrix is covered by the kill-matrix e2e). Real processes, no mocks: /bin/sh
// is the fixture. The suite proves the env strip, cwd confinement, the
// termination ladder, restart-on-crash, and stopAll's shutdown law.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const PLUGIN = "vibefield.fixture.proc";

function make(roots: string[] = []): { svc: ProcessService; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "vf-proc-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const svc = new ProcessService({
    allowedCwdRoots: () => [dir, ...roots],
    restartBaseMs: 50,
  });
  cleanup.push(() => svc.stopAll());
  return { svc, dir };
}

const until = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe("ProcessService — §17.1", () => {
  it("spawns, records provenance, and strips FIELD_*/FIELDD_* from the env", async () => {
    const { svc, dir } = make();
    const out = join(dir, "env.txt");
    const rec = svc.spawnFor(PLUGIN, {
      executable: "/bin/sh",
      args: ["-c", `env > ${out}`],
      cwd: dir,
      env: { FIELD_SECRET: "leak", FIELDD_TOKEN: "leak", SAFE_VAR: "ok" },
      restart: "never",
    });
    expect(rec.pluginId).toBe(PLUGIN);
    expect(rec.state).toBe("running");
    expect(rec.spawnCount).toBe(1);
    await until(() => svc.stat(PLUGIN)[0]?.state === "exited");
    const { readFileSync } = await import("node:fs");
    const env = readFileSync(out, "utf8");
    expect(env).toContain("SAFE_VAR=ok");
    expect(env).not.toContain("FIELD_SECRET");
    expect(env).not.toContain("FIELDD_TOKEN");
  });

  it("refuses cwd outside the plugin's roots and relative executables", () => {
    const { svc } = make();
    expect(() =>
      svc.spawnFor(PLUGIN, {
        executable: "/bin/sh",
        args: ["-c", "true"],
        cwd: "/etc",
        restart: "never",
      }),
    ).toThrowError(/cwd must stay under/);
    expect(() =>
      svc.spawnFor(PLUGIN, { executable: "./sh", args: [], restart: "never" }),
    ).toThrowError(/absolute path or a bare PATH command/);
  });

  it("restart:on-crash climbs the ladder and a term signal ends it for good", async () => {
    const { svc } = make();
    const rec = svc.spawnFor(PLUGIN, {
      executable: "/bin/sh",
      args: ["-c", "sleep 30"],
      restart: "on-crash",
      env: {},
    });
    await until(() => svc.stat(PLUGIN, rec.procId)[0]?.state === "running");
    const pid = svc.stat(PLUGIN, rec.procId)[0]?.pid;
    expect(pid).toBeDefined();
    process.kill(pid as number, "SIGKILL"); // a crash, not a signal() stop
    await until(() => {
      const s = svc.stat(PLUGIN, rec.procId)[0]?.state;
      return s === "restarting" || s === "running";
    });
    // the supervisor relaunches (spawnCount grows)
    await until(() => (svc.stat(PLUGIN, rec.procId)[0]?.spawnCount ?? 0) >= 2, 8000);
    // an explicit term is a STOP: no restart after
    svc.signal(PLUGIN, { procId: rec.procId, signal: "term" });
    await until(() => svc.stat(PLUGIN, rec.procId)[0]?.state === "exited", 8000);
    const count = svc.stat(PLUGIN, rec.procId)[0]?.spawnCount;
    await new Promise((r) => setTimeout(r, 300));
    expect(svc.stat(PLUGIN, rec.procId)[0]?.state).toBe("exited");
    expect(svc.stat(PLUGIN, rec.procId)[0]?.spawnCount).toBe(count);
  });

  it("owner scoping: another plugin cannot see or signal the process", () => {
    const { svc } = make();
    const rec = svc.spawnFor(PLUGIN, {
      executable: "/bin/sh",
      args: ["-c", "sleep 5"],
      restart: "never",
    });
    expect(svc.stat("vibefield.other", undefined)).toEqual([]);
    expect(() => svc.signal("vibefield.other", { procId: rec.procId, signal: "term" })).toThrow(
      /no such process/,
    );
    // the plugins.manage view (owner null) sees it
    expect(svc.stat(null).map((p) => p.procId)).toContain(rec.procId);
    svc.signal(PLUGIN, { procId: rec.procId, signal: "kill" });
  });

  it("killPlugin and stopAll leave nothing alive (§17.1 shutdown law)", async () => {
    const { svc } = make();
    const a = svc.spawnFor(PLUGIN, {
      executable: "/bin/sh",
      args: ["-c", "sleep 30"],
      restart: "on-crash",
    });
    await until(() => svc.stat(PLUGIN, a.procId)[0]?.state === "running");
    const pid = svc.stat(PLUGIN, a.procId)[0]?.pid as number;
    await svc.killPlugin(PLUGIN);
    // records drop; the OS process is gone (kill(pid,0) throws ESRCH)
    expect(svc.stat(PLUGIN)).toEqual([]);
    await until(() => {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    });
    // stopAll refuses new spawns
    await svc.stopAll();
    expect(() =>
      svc.spawnFor(PLUGIN, { executable: "/bin/sh", args: ["-c", "true"], restart: "never" }),
    ).toThrowError(/shutting down/);
  });
});
