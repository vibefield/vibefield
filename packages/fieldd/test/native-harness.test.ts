// WIN-4 — the harness's own win32 branches, proven from a mac. Every native
// suite reaches field-native through these three helpers, so a wrong `.exe` or a
// path where a pipe belongs would fail as "the daemon never came up" on Windows
// and as nothing at all here. An explicit `platform` argument is the whole point
// of the signatures; this is what exercises it. And where the suites' own build
// lands: in the checkout's own target, the one `nativeBinPath` reads.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { nativeBinPath, nativeBuildEnv, nativeEndpoint, shortTmpRoot } from "./native-harness";

describe("the suites' field-native build lands where they look for it", () => {
  const made: string[] = [];
  const dir = (): string => {
    const root = mkdtempSync(join(tmpdir(), "vf-target-"));
    made.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("builds into the checkout's own target — the real path behind its link — when none is named", () => {
    const checkout = dir();
    const lane = dir();
    symlinkSync(lane, join(checkout, "target"));
    expect(nativeBuildEnv(checkout, { PATH: "/usr/bin" })).toEqual({
      PATH: "/usr/bin",
      CARGO_TARGET_DIR: realpathSync(lane),
    });
    const plain = dir();
    mkdirSync(join(plain, "target"));
    expect(nativeBuildEnv(plain, {})["CARGO_TARGET_DIR"]).toBe(realpathSync(join(plain, "target")));
    // a checkout that has built nothing yet: its target is made where the suites will look
    const fresh = dir();
    expect(nativeBuildEnv(fresh, {})["CARGO_TARGET_DIR"]).toBe(join(fresh, "target"));
  });

  it("leaves a target directory the caller named, in either of cargo's spellings", () => {
    const checkout = dir();
    symlinkSync(dir(), join(checkout, "target"));
    const named = { CARGO_TARGET_DIR: "/elsewhere" };
    expect(nativeBuildEnv(checkout, named)).toBe(named);
    const build = { CARGO_BUILD_TARGET_DIR: "/elsewhere" };
    expect(nativeBuildEnv(checkout, build)).toBe(build);
  });
});

describe("the native harness is platform-shaped (WIN-4)", () => {
  // tooling (a): `nativeBinPath` asks cargo where the suites' build lands, so
  // these rows name the target directory rather than assume `<repo>/target`
  const REPO = join(import.meta.dirname, "..", "..", "..");
  // the run's own overrides out (a lane exports CARGO_TARGET_DIR), so each row's is the one cargo reads
  const plain = { ...process.env };
  delete plain["CARGO_TARGET_DIR"];
  delete plain["CARGO_BUILD_TARGET_DIR"];
  const named = { ...plain, CARGO_TARGET_DIR: "/elsewhere" };

  it("appends .exe to the cargo artifact on win32 only", () => {
    expect(nativeBinPath(REPO, "darwin", named)).toBe(join("/elsewhere", "debug", "field-native"));
    expect(nativeBinPath(REPO, "linux", named)).toBe(join("/elsewhere", "debug", "field-native"));
    expect(nativeBinPath(REPO, "win32", named)).toBe(
      join("/elsewhere", "debug", "field-native.exe"),
    );
  });

  it("reads where the suites' build lands, as cargo says it: the named target, else the checkout's own", () => {
    // tooling (a) — it was the literal <root>/target/debug, which a target the
    // caller named without a `target` link beside it made a file never written
    const spelled = { ...plain, CARGO_BUILD_TARGET_DIR: "/other" };
    expect(nativeBinPath(REPO, "darwin", spelled)).toBe(join("/other", "debug", "field-native"));
    const own = nativeBuildEnv(REPO, plain)["CARGO_TARGET_DIR"] as string;
    expect(nativeBinPath(REPO, "darwin", plain)).toBe(join(own, "debug", "field-native"));
  });

  it("resolves a LAYOUT path on unix and a named pipe on win32 (WIN-D1)", () => {
    const root = "/tmp/vf-fixture";
    expect(nativeEndpoint(root, SOCKETS.MGMT, "darwin")).toBe(
      join(root, "native", "run", "mgmt.sock"),
    );
    // the pipe name is the endpoint law's, not this harness's — same derivation
    // both planes use, so the suites dial exactly what field-native bound
    expect(nativeEndpoint(root, SOCKETS.MGMT, "win32")).toBe(pipeEndpointFor(root, SOCKETS.MGMT));
    expect(nativeEndpoint(root, SOCKETS.MGMT, "win32")).toMatch(/^\\\\\.\\pipe\\/);
    // no filesystem presence to wait on — the reason the readiness gates connect
    expect(nativeEndpoint(root, SOCKETS.MGMT, "win32")).not.toContain(root);
  });

  it("keeps unix temp roots under /tmp and win32 ones under tmpdir()", () => {
    // shortTmpRoot mkdtemps the root it returns, so each branch is reachable only
    // on a host whose base dir exists: /tmp is absent on win32 (→ C:\tmp), and the
    // win32 branch's tmpdir() is the real base only there. Each host proves its own.
    if (process.platform === "win32") {
      const win = shortTmpRoot("vf-harness-win-", "win32");
      try {
        expect(win.startsWith(join(tmpdir(), "vf-harness-win-"))).toBe(true);
      } finally {
        rmSync(win, { recursive: true, force: true });
      }
    } else {
      const unix = shortTmpRoot("vf-harness-unix-", "darwin");
      try {
        // the sun_path budget: /tmp, never macOS's ~50-byte /var/folders/… root
        expect(unix.startsWith("/tmp/vf-harness-unix-")).toBe(true);
      } finally {
        rmSync(unix, { recursive: true, force: true });
      }
    }
  });
});
