import { describe, expect, it } from "vitest";
import { resolveWin32Target, shimSpawn } from "../src/spawn-shim";

// WIN-3 (§4.5) — the `.cmd`/`.bat` door. Both halves are proven from unix with
// an injected filesystem: DETECTION (which spawns need the shim at all) and
// QUOTING (the cross-spawn/qntm recipe, whose vectors are the whole security
// argument for not passing `shell: true`).

const COMSPEC = "C:\\Windows\\System32\\cmd.exe";
/** an injected filesystem — `exists` sees exactly these, case-insensitively */
const fsWith = (...files: string[]) => {
  const set = new Set(files.map((f) => f.toLowerCase()));
  return (candidate: string) => set.has(candidate.toLowerCase());
};

const win = (executable: string, args: string[], ctx: Parameters<typeof shimSpawn>[3] = {}) =>
  shimSpawn(executable, args, "win32", { comSpec: COMSPEC, ...ctx });

describe("shim detection — PATH + PATHEXT, in the OS's own order", () => {
  it("an explicit .cmd/.bat suffix needs no disk access at all", () => {
    let probes = 0;
    const ctx = {
      exists: () => {
        probes += 1;
        return false;
      },
    };
    expect(win("C:\\tools\\run.cmd", [], ctx).command).toBe(COMSPEC);
    expect(win("C:\\tools\\run.BAT", [], ctx).command).toBe(COMSPEC);
    expect(probes).toBe(0);
  });

  it("resolves a BARE name through PATH — `npx` IS `npx.cmd`", () => {
    const shimmed = win("npx", ["-y", "server"], {
      env: { PATH: "C:\\Windows\\System32;C:\\Program Files\\nodejs" },
      exists: fsWith("C:\\Program Files\\nodejs\\npx.cmd"),
    });
    expect(shimmed.command).toBe(COMSPEC);
    expect(shimmed.args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(shimmed.windowsVerbatimArguments).toBe(true);
  });

  it("honours PATHEXT ORDER — an .exe beside the .cmd is spawned directly", () => {
    const ctx = {
      env: { PATH: "C:\\bin", PATHEXT: ".COM;.EXE;.BAT;.CMD" },
      exists: fsWith("C:\\bin\\tool.exe", "C:\\bin\\tool.cmd"),
    };
    expect(win("tool", ["a"], ctx)).toEqual({
      command: "tool",
      args: ["a"],
      windowsVerbatimArguments: false,
    });
    // and the same directory WITHOUT the exe is a shim
    expect(win("tool", ["a"], { ...ctx, exists: fsWith("C:\\bin\\tool.cmd") }).command).toBe(
      COMSPEC,
    );
  });

  it("searches the child's cwd before PATH, exactly as cmd.exe does", () => {
    const shimmed = win("tool", [], {
      cwd: "C:\\plugin\\data",
      env: { PATH: "C:\\bin" },
      exists: fsWith("C:\\plugin\\data\\tool.cmd"),
    });
    expect(shimmed.command).toBe(COMSPEC);
  });

  it("never walks PATH for a name that carries its own location or drive", () => {
    const exists = fsWith("C:\\bin\\npx.cmd");
    const env = { PATH: "C:\\bin" };
    // `sub\npx` means sub\npx under the cwd — PATH must not rescue it
    expect(win("sub\\npx", [], { cwd: "C:\\work", env, exists }).command).toBe("sub\\npx");
    // `C:npx` is relative to C:'s own working directory, not to PATH
    expect(win("C:npx", [], { env, exists }).command).toBe("C:npx");
  });

  it("passes through what it cannot resolve, and what needs no shim", () => {
    const env = { PATH: "C:\\bin" };
    expect(win("nonesuch", ["x"], { env, exists: fsWith() })).toEqual({
      command: "nonesuch",
      args: ["x"],
      windowsVerbatimArguments: false,
    });
    expect(win("node", [], { env, exists: fsWith("C:\\bin\\node.exe") }).command).toBe("node");
    expect(win("C:\\Windows\\System32\\where.exe", []).command).toBe(
      "C:\\Windows\\System32\\where.exe",
    );
  });

  it("is a no-op on unix — a `.cmd` there is just a file with a name", () => {
    expect(shimSpawn("/opt/tools/run.cmd", ["a b"], "linux")).toEqual({
      command: "/opt/tools/run.cmd",
      args: ["a b"],
      windowsVerbatimArguments: false,
    });
    expect(shimSpawn("npx", ["-y"], "darwin").command).toBe("npx");
  });

  it("resolveWin32Target reports the file a spawn would land on", () => {
    // a QUOTED PATH entry (legal on Windows) and an empty one (a shell accident)
    expect(
      resolveWin32Target("npx", {
        env: { PATH: 'C:\\a;;"C:\\Program Files\\nodejs"', PATHEXT: ".exe;.cmd" },
        exists: fsWith("C:\\Program Files\\nodejs\\npx.cmd"),
      }),
    ).toBe("C:\\Program Files\\nodejs\\npx.cmd");
    expect(resolveWin32Target("", {})).toBeUndefined();
  });
});

describe("shim quoting — the cross-spawn/qntm recipe, vector by vector", () => {
  const shimOf = (executable: string, args: string[]) =>
    win(executable, args, { exists: fsWith("C:\\bin\\npx.cmd"), env: { PATH: "C:\\bin" } });

  it("wraps the whole payload in one pair of quotes for /s", () => {
    const { args } = shimOf("npx", ["-y", "a b"]);
    expect(args[3]).toBe('"npx ^"-y^" ^"a^ b^""');
  });

  it("doubles a backslash run that ends an argument (it precedes a quote)", () => {
    // `C:\data\` naively quoted becomes `"C:\data\"` — the trailing backslash
    // escapes the closing quote and the next argument is swallowed.
    const { args } = shimOf("npx", ["C:\\data\\"]);
    expect(args[3]).toBe('"npx ^"C:\\data\\\\^""');
  });

  it("escapes an embedded quote and the backslashes in front of it", () => {
    // the space is a meta char too (`say^ `) — the `^` layer is what stops cmd
    // from re-splitting an argument the quotes already delimited
    expect(shimOf("npx", ['say "hi"']).args[3]).toBe('"npx ^"say^ \\^"hi\\^"^""');
  });

  it("neutralizes every cmd.exe meta character", () => {
    expect(shimOf("npx", ["a&b|c>d<e^f%g!h"]).args[3]).toBe('"npx ^"a^&b^|c^>d^<e^^f^%g^!h^""');
  });

  it("double-escapes for an npm cmd-shim, which re-enters cmd.exe once more", () => {
    const shimmed = win("mcp-server", ["a&b"], {
      env: { PATH: "C:\\proj\\node_modules\\.bin" },
      exists: fsWith("C:\\proj\\node_modules\\.bin\\mcp-server.cmd"),
    });
    expect(shimmed.args[3]).toBe('"mcp-server ^^^"a^^^&b^^^""');
  });

  it("normalizes the command token and escapes ITS meta chars", () => {
    const { args } = win("C:/Program Files/tools/run.cmd", []);
    expect(args[3]).toBe('"C:\\Program^ Files\\tools\\run.cmd"');
  });

  it("keeps an empty argument addressable rather than dropping it", () => {
    expect(shimOf("npx", ["", "x"]).args[3]).toBe('"npx ^"^" ^"x^""');
  });
});
