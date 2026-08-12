import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RpcCallError } from "../src/native-link";
import {
  executableAllowed,
  hasGracefulTermination,
  isUnderRoot,
  killPlan,
  ProcessService,
  pluginChildEnv,
  spawnMcpStdio,
} from "../src/process-service";

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

/** The server the shim launches: heartbeats into $BEAT_FILE forever. Its path
 * rides the env rather than the script text, so no quoting survives two shells. */
const HEARTBEAT = "setInterval(()=>require('fs').appendFileSync(process.env.BEAT_FILE,'.'),25)";

/** Writes a SHIM that launches that server and stays in the middle — the shape
 * `spawn-shim` produces for every `.cmd`/`.bat` target (npx, uvx: how MCP stdio
 * servers are actually configured), where the pid fieldd tracks is the shim and
 * the real server is one level down.
 *
 * The intermediate must NOT be Node, and that is the whole reason this helper
 * exists. libuv assigns every process a Node parent spawns to a job object that
 * dies with it, so a node-in-the-middle fixture tears its own grandchild down
 * for free on Windows — MEASURED: the first version of this row passed with the
 * fix reverted, proving nothing at all. cmd.exe builds no such job, which is
 * exactly why the production defect was reachable through it. */
function writeShim(dir: string): string {
  if (process.platform === "win32") {
    const shim = join(dir, "serve.cmd");
    writeFileSync(shim, `@echo off\r\n"${process.execPath}" -e "${HEARTBEAT}"\r\n`);
    return shim;
  }
  const shim = join(dir, "serve.sh");
  // `&` + `wait` keeps the shim alive alongside its child, as cmd.exe is.
  writeFileSync(shim, `#!/bin/sh\n"${process.execPath}" -e "${HEARTBEAT}" &\nwait\n`, {
    mode: 0o755,
  });
  return shim;
}

const until = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** Resolves once `sample()` stops changing across `windowMs`. Proving a process
 * stopped RUNNING beats probing its pid: a win32 pid can be unreachable while
 * alive and reusable while dead, so the filesystem is the honest witness. */
const untilQuiet = async (sample: () => number, windowMs = 250, ms = 8000): Promise<void> => {
  const t0 = Date.now();
  for (;;) {
    const before = sample();
    await new Promise((r) => setTimeout(r, windowMs));
    if (sample() === before) return;
    if (Date.now() - t0 > ms) throw new Error("the grandchild never stopped writing");
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

  it("the whole TREE dies: the shim's server does not outlive it (§17.1)", async () => {
    // The law says children die no later than fieldd — and on win32 that was
    // false for the commonest child there is. `process.kill(-pid)` does not
    // misbehave on Windows, it THROWS ESRCH (measured), so the old ladder fell
    // through to killing the tracked pid alone; with a cmd.exe shim in the
    // middle that reached the shim and left the server running — through the
    // plugin's kill, its disable, and fieldd's own shutdown.
    //
    // Control-run performed 2026-08-11: with killPlan's win32 arm reverted this
    // row FAILS on the box ("the grandchild never stopped writing") and stays
    // green on unix — which is exactly the asymmetry that let the defect ship.
    const { svc, dir } = make();
    const beat = join(dir, "beat.log");
    const rec = svc.spawnFor(PLUGIN, {
      // The real door: a .cmd target goes through spawn-shim → cmd.exe /d /s /c.
      executable: writeShim(dir),
      args: [],
      env: { BEAT_FILE: beat },
      cwd: dir,
      restart: "never",
    });
    const beats = (): number => (existsSync(beat) ? statSync(beat).size : 0);
    await until(() => beats() > 0); // the grandchild is alive and writing
    svc.signal(PLUGIN, { procId: rec.procId, signal: "kill" });
    await until(() => svc.stat(PLUGIN, rec.procId)[0]?.state === "exited");
    // The tree verb is asynchronous (a taskkill process on win32), so poll for
    // quiet instead of assuming it. Two samples a heartbeat-window apart answer
    // "did it stop RUNNING" — a pid probe would answer something else on win32,
    // where an unreachable pid and a dead one are not the same reading.
    await untilQuiet(beats);
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

// §17.4's stdio door is the SECOND caller of the policy above. As a closure in
// the daemon it applied the child-env law and SKIPPED the executable rule, so an
// MCP transport could name `..\evil.exe` where a plugin service could not. MCP
// configs are settings-authored, which made that an asymmetry rather than an
// injection — but EL7 reads a same-uid agent as the adversary, and these rows
// exist so the two doors into one subsystem cannot drift apart again.
describe("the MCP stdio door shares the process door's policy (§17.4)", () => {
  const REFUSED =
    process.platform === "win32"
      ? ["..\\evil.exe", ".\\evil.exe", "C:evil", "\\evil.exe", ""]
      : ["./evil", "../evil", "sub/evil", ""];

  it("refuses every cwd-dependent spelling with the process door's own error", () => {
    for (const executable of REFUSED) {
      let thrown: unknown;
      try {
        spawnMcpStdio({ executable, args: [] });
      } catch (error) {
        thrown = error;
      }
      // The SHAPE is the assertion, not just the refusal: the MCP session lands
      // `failed` with this message as its lastError, so a config author reads
      // exactly what a plugin author reads.
      expect(thrown).toBeInstanceOf(RpcCallError);
      const error = thrown as RpcCallError;
      expect(error.kind).toBe("PRECONDITION_FAILED");
      expect(error.retryable).toBe(false);
      expect(error.message).toMatch(/absolute path or a bare PATH command/);
    }
  });

  it("still spawns a legal server over pipes, with the env law applied (EL7)", async () => {
    // The control for the rows above — a guard that refused everything would
    // pass them and break every real MCP server. This one also proves the moved
    // door kept the strip: additions land, FIELD_*/FIELDD_* never do.
    const child = spawnMcpStdio({
      executable: NODE,
      args: ["-e", "process.stdout.write(JSON.stringify(process.env))"],
      env: { FIELD_SECRET: "leak", FIELDD_TOKEN: "leak", SAFE_VAR: "ok" },
    });
    cleanup.push(() => child.kill());
    const out = await new Promise<string>((resolve, reject) => {
      let acc = "";
      child.stdout.on("data", (chunk: unknown) => {
        acc += String(chunk);
      });
      child.stdout.on("end", () => resolve(acc));
      child.stdout.on("error", reject);
    });
    const env = JSON.parse(out) as Record<string, string>;
    expect(env["SAFE_VAR"]).toBe("ok");
    expect(Object.keys(env).filter((k) => /^FIELDD?_/i.test(k))).toEqual([]);
  });
});

// WIN-D4 — cwd confinement compares PATHS, and on NTFS two spellings of one
// directory differ only in case (an installer records `C:\…`; a shell hands the
// same directory back as `c:\…`). The byte-exact compare refused a plugin its
// OWN directory over that — closed, never a bypass, but a door that refuses the
// legitimate caller is still broken. Both arms are decided here from either
// machine: the platform argument picks the CASE rule; the paths stay native.
describe("cwd confinement folds case on win32 only (§17.1)", () => {
  const root = join(tmpdir(), "VF-Case-Root");

  it("accepts the same directory spelled in another case — on win32 alone", () => {
    const under = join(root.toLowerCase(), "sub");
    expect(under).not.toBe(join(root, "sub")); // the row is about a real difference
    expect(isUnderRoot(under, root, "win32")).toBe(true);
    // unix paths are genuinely case-sensitive: /Data and /data are two different
    // directories there, so the same fold would ADMIT one for the other.
    expect(isUnderRoot(under, root, "linux")).toBe(false);
    // the control: the exact spelling was always under the root, on both arms
    expect(isUnderRoot(join(root, "sub"), root, "win32")).toBe(true);
    expect(isUnderRoot(join(root, "sub"), root, "linux")).toBe(true);
    // and the root itself, which is `p === r` rather than the prefix branch
    expect(isUnderRoot(root.toLowerCase(), root, "win32")).toBe(true);
  });

  it("is not a bare prefix test — the adjacent sibling stays out on both", () => {
    for (const platform of ["win32", "linux"] as const) {
      expect(isUnderRoot(`${root}-evil`, root, platform)).toBe(false);
      expect(isUnderRoot(join(tmpdir(), "VF-Case-Elsewhere"), root, platform)).toBe(false);
    }
    // the fold must not turn the separator guard off either
    expect(isUnderRoot(`${root.toLowerCase()}-evil`, root, "win32")).toBe(false);
  });

  it.skipIf(process.platform !== "win32")(
    "lets a plugin spawn in its own directory under another spelling",
    async () => {
      const { svc, dir } = make();
      // %TEMP% always carries capitals on Windows, so this is never the same
      // string as the configured root — the refusal it used to earn was real.
      expect(dir.toLowerCase()).not.toBe(dir);
      const rec = svc.spawnFor(PLUGIN, {
        executable: NODE,
        args: EXIT_NOW,
        cwd: dir.toLowerCase(),
        restart: "never",
      });
      await until(() => svc.stat(PLUGIN, rec.procId)[0]?.state === "exited");
      expect(svc.stat(PLUGIN, rec.procId)[0]?.exitCode).toBe(0);
    },
  );
});

// The termination verb is platform-shaped for the same reason the two above
// are: on win32 the unix spelling does not merely misbehave, it throws, and the
// fallback silently narrows the promise from "the tree" to "one process".
// Both arms are decided here from either machine; the tree is WITNESSED for
// real by the grandchild row in the suite above.
describe("the termination verb is platform-shaped (§17.1)", () => {
  it("signals the process GROUP through a negative pid on unix", () => {
    expect(killPlan(4321, "term", "darwin")).toEqual({
      kind: "group",
      pid: 4321,
      signal: "SIGTERM",
    });
    expect(killPlan(4321, "kill", "linux")).toEqual({
      kind: "group",
      pid: 4321,
      signal: "SIGKILL",
    });
  });

  it("terminates the TREE on win32, which has no signalable group", () => {
    expect(killPlan(4321, "kill", "win32", { SystemRoot: "C:\\Windows" })).toEqual({
      kind: "tree",
      command: "C:\\Windows\\System32\\taskkill.exe",
      args: ["/PID", "4321", "/T", "/F"],
    });
  });

  it("never resolves taskkill through PATH — this runs with daemon authority", () => {
    // EL7: a bare `taskkill` would be found through an inherited PATH a
    // same-uid agent can arrange. Absolute in every spelling we might inherit,
    // including a machine that hands us neither variable.
    for (const [env, expected] of [
      [{ SystemRoot: "C:\\Windows" }, "C:\\Windows\\System32\\taskkill.exe"],
      [{ windir: "D:\\Win" }, "D:\\Win\\System32\\taskkill.exe"],
      [{}, "C:\\Windows\\System32\\taskkill.exe"],
    ] as const) {
      const plan = killPlan(7, "kill", "win32", env);
      expect(plan.kind === "tree" && plan.command).toBe(expected);
    }
  });

  it("admits that win32 has no graceful rung, while unix keeps its ladder", () => {
    // A TERM → grace → KILL ladder needs a catchable TERM. Windows has none, so
    // scheduling a second identical kill 2s later would only delay the first.
    expect(hasGracefulTermination("win32")).toBe(false);
    expect(hasGracefulTermination("darwin")).toBe(true);
    expect(hasGracefulTermination("linux")).toBe(true);
  });
});
