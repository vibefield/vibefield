// WIN-4 — the harness's own win32 branches, proven from a mac. Every native
// suite reaches field-native through these three helpers, so a wrong `.exe` or a
// path where a pipe belongs would fail as "the daemon never came up" on Windows
// and as nothing at all here. An explicit `platform` argument is the whole point
// of the signatures; this is what exercises it.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeEndpointFor, SOCKETS } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { nativeBinPath, nativeEndpoint, shortTmpRoot } from "./native-harness";

describe("the native harness is platform-shaped (WIN-4)", () => {
  it("appends .exe to the cargo artifact on win32 only", () => {
    expect(nativeBinPath("/repo", "darwin")).toBe(join("/repo", "target", "debug", "field-native"));
    expect(nativeBinPath("/repo", "linux")).toBe(join("/repo", "target", "debug", "field-native"));
    expect(nativeBinPath("/repo", "win32")).toBe(
      join("/repo", "target", "debug", "field-native.exe"),
    );
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
