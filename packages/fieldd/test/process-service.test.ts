import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executableAllowed, ProcessService, pluginChildEnv } from "../src/process-service";

// PLUG-P6 — §17.1 supervised children, service-level (the daemon caller
// matrix is covered by the kill-matrix e2e). Real processes, no mocks. The
// suite proves the env strip, cwd confinement, the termination ladder,
// restart-on-crash, and stopAll's shutdown law.
//
// WIN-4 — the fixture used to be `/bin/sh -c …`, which is not a program on
// Windows. The stand-in is THIS node: `process.execPath` is absolute on both
// platforms (so §17.1's executable rule accepts it either way), and `-e`
// carries the three behaviors the tests need without a shell to parse it.
const NODE = process.execPath;
/** Alive until something signals it — the old `sleep 30`/`sleep 5`. */
const IDLE = ["-e", "setInterval(() => {}, 1000)"];
/** Exits 0 immediately — the old `true`. */
const EXIT_NOW = ["-e", ""];
/** Writes the child's whole env as JSON to $OUT_FILE — the old `env > file`.
 * The path rides an env var rather than the script text because a Windows path
 * cannot be pasted into a JS string literal unescaped. */
const DUMP_ENV = [
  "-e",
  "require('fs').writeFileSync(process.env.OUT_FILE, JSON.stringify(process.env))",
];

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
    const out = join(dir, "env.json");
    const rec = svc.spawnFor(PLUGIN, {
      executable: NODE,
      args: DUMP_ENV,
      cwd: dir,
      env: { FIELD_SECRET: "leak", FIELDD_TOKEN: "leak", SAFE_VAR: "ok", OUT_FILE: out },
      restart: "never",
    });
    expect(rec.pluginId).toBe(PLUGIN);
    expect(rec.state).toBe("running");
    expect(rec.spawnCount).toBe(1);
    await until(() => svc.stat(PLUGIN)[0]?.state === "exited");
    // JSON, not `env`'s `KEY=value` lines: an exact key set instead of a
    // substring search that a value could satisfy by accident.
    const env = JSON.parse(readFileSync(out, "utf8")) as Record<string, string>;
    expect(env["SAFE_VAR"]).toBe("ok");
    expect(env["FIELD_SECRET"]).toBeUndefined();
    expect(env["FIELDD_TOKEN"]).toBeUndefined();
    // and the strip is total, not just the two keys this test planted
    const reserved = Object.keys(env).filter((k) => /^FIELDD?_/i.test(k));
    expect(reserved).toEqual([]);
  });

  it("refuses cwd outside the plugin's roots and relative executables", () => {
    const { svc } = make();
    // NODE, not "/bin/sh": spawnFor validates the executable BEFORE the cwd
    // (process-service.ts §17.1), so a unix-only path here would refuse for the
    // wrong reason on win32 and this test would pass while proving nothing.
    // Neither call spawns.
    expect(() =>
      svc.spawnFor(PLUGIN, {
        executable: NODE,
        args: EXIT_NOW,
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
      executable: NODE,
      args: IDLE,
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
      executable: NODE,
      args: IDLE,
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
      executable: NODE,
      args: IDLE,
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
      svc.spawnFor(PLUGIN, { executable: NODE, args: EXIT_NOW, restart: "never" }),
    ).toThrowError(/shutting down/);
  });
});

// WIN-3 (thinking-windows-port §4.2/§4.5) — the two child-spawn laws that FAIL
// SILENTLY on Windows: an env strip that stops stripping, and an executable
// policy that stops refusing. Both are proven here with an explicit platform, on
// unix, because neither one breaks a build or reddens a test where it matters.
describe("the child env law is platform-shaped (EL7)", () => {
  it("strips FIELD_*/FIELDD_* case-INSENSITIVELY on win32", () => {
    // Windows env keys are case-insensitive: a var stored `Field_Token` survives
    // an exact-prefix compare and the child reads it back as FIELD_TOKEN. This
    // is the mirror-write capability leak (§4.2), TS side.
    const env = pluginChildEnv(
      { Field_Token: "leak", fieldd_secret: "leak", FIELD_X: "leak", SAFE_VAR: "ok" },
      "win32",
      {},
    );
    expect(env).toEqual({ SAFE_VAR: "ok" });
  });

  it("stays EXACT on unix, where two casings are two variables", () => {
    const env = pluginChildEnv({ Field_Token: "kept", FIELD_X: "stripped" }, "linux", {});
    expect(env).toEqual({ Field_Token: "kept" });
  });

  it("forwards the win32 floor — SystemRoot, or the child cannot start at all", () => {
    const env = pluginChildEnv({}, "win32", {
      // the parent's OWN casing, which on Windows is whatever set the variable
      Path: "C:\\Windows\\System32",
      SystemRoot: "C:\\Windows",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      NUMBER_OF_PROCESSORS: "32",
      HOME: "/not-a-windows-thing",
      SOME_OTHER: "not on the allowlist",
    });
    // matched case-insensitively, forwarded under the CANONICAL name
    expect(env["PATH"]).toBe("C:\\Windows\\System32");
    expect(env["COMSPEC"]).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(env["SystemRoot"]).toBe("C:\\Windows");
    expect(env["PATHEXT"]).toBe(".COM;.EXE;.BAT;.CMD");
    expect(env["NUMBER_OF_PROCESSORS"]).toBe("32");
    expect(env["HOME"]).toBeUndefined();
    expect(env["SOME_OTHER"]).toBeUndefined();
  });

  it("leaves the unix allowlist exactly as it was", () => {
    const env = pluginChildEnv({}, "linux", {
      PATH: "/usr/bin",
      HOME: "/home/me",
      LANG: "C",
      TMPDIR: "/tmp",
      SHELL: "/bin/zsh",
      SYSTEMROOT: "irrelevant",
    });
    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/me",
      LANG: "C",
      TMPDIR: "/tmp",
      SHELL: "/bin/zsh",
    });
  });
});

describe("the executable policy refuses every cwd-dependent Windows form", () => {
  it("refuses the three forms that read absolute-ish and are not", () => {
    for (const bad of [
      "..\\evil.exe",
      ".\\evil.exe",
      "sub\\evil.exe",
      "C:evil",
      "\\evil.exe",
      "",
    ]) {
      expect(executableAllowed(bad, "win32")).toBe(false);
    }
  });

  it("allows a drive-absolute path, a UNC path, and a bare PATH name", () => {
    for (const ok of [
      "C:\\Windows\\System32\\cmd.exe",
      "C:/Windows/System32/cmd.exe",
      "\\\\server\\share\\tool.exe",
      "npx",
    ]) {
      expect(executableAllowed(ok, "win32")).toBe(true);
    }
  });

  it("keeps the unix rule byte-for-byte", () => {
    expect(executableAllowed("/bin/sh", "linux")).toBe(true);
    expect(executableAllowed("npx", "linux")).toBe(true);
    expect(executableAllowed("./sh", "linux")).toBe(false);
    expect(executableAllowed("../sh", "linux")).toBe(false);
    expect(executableAllowed("sub/sh", "linux")).toBe(false);
  });
});
