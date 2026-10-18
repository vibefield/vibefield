import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReleaseManifest } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { hashPlanes, planeOf } from "../../../../scripts/release-manifest.mjs";
import {
  hashNativePlane,
  type NativePlane,
  nativeVerdict,
} from "../../src/main/updates/native-plane";

// WP12d (L3b-i, build-wp12-updater.md §12 B3; the PM's ruling 2026-10-15 16:03Z) — the native plane read by DIGEST.
// The release workflow's hasher (`release-manifest.mjs`) and main's (`native-plane.ts`) are two implementations of one
// rule; this file holds them to ONE digest and ONE member set on the same app, and judges the verdict's every branch:
// untouched only when the members AND the digest match.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A built app's shape: the floor, its cell, its freeway host and its sidecar beside fieldd's binaries, a helper bundle,
 * the shell. */
function app(files: Record<string, string>): { app: string; resources: string } {
  const root = mkdtempSync(join(tmpdir(), "vf-native-"));
  dirs.push(root);
  const appDir = join(root, "VibeField.app");
  const resources = join(appDir, "Contents", "Resources");
  for (const [rel, text] of Object.entries(files)) {
    const path = rel.startsWith("@app/") ? join(appDir, rel.slice(5)) : join(resources, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return { app: appDir, resources };
}

const BUILD = {
  "@app/Contents/MacOS/VibeField": "electron",
  "app.asar": "asar",
  "bin/field-native": "floor-1",
  "bin/field-terminal-host": "cell-1",
  "bin/field-freeway-host": "host-1",
  "bin/sidecar-slim": "sidecar-1",
  "bin/fieldd": "fieldd-1",
  "bin/rosettad": "rosettad-1",
  "bin/field-screenshot-helper.app/Contents/MacOS/helper": "helper-1",
  "plugins/bundled/x/manifest.json": "{}",
};

describe("the native plane: one rule, two hashers (B3)", () => {
  it("main's hasher and the release workflow's give the same digest and the same members", async () => {
    const built = app(BUILD);
    const workflow = hashPlanes(built.app)["field-native"];
    const main = await hashNativePlane(built.resources);
    expect(main.members).toEqual([
      "bin/field-freeway-host",
      "bin/field-native",
      "bin/field-terminal-host",
      "bin/sidecar-slim",
    ]);
    expect(workflow.members).toEqual(main.members);
    expect(workflow.digest).toBe(main.digest);
    expect(workflow.files).toBe(4);
  });

  it("names every executable the floor execs from its own directory — truffle-sidecar and `.exe` included", async () => {
    expect(planeOf("bin/truffle-sidecar")).toBe("field-native");
    expect(planeOf("bin/truffle-sidecar.exe")).toBe("field-native");
    const built = app({ ...BUILD, "bin/truffle-sidecar": "fallback" });
    const main = await hashNativePlane(built.resources);
    expect(main.members).toContain("bin/truffle-sidecar");
    expect(hashPlanes(built.app)["field-native"].digest).toBe(main.digest);
    const windows = app({
      "bin/field-native.exe": "f",
      "bin/sidecar-slim.exe": "s",
      "bin/fieldd.exe": "d",
    });
    expect((await hashNativePlane(windows.resources)).members).toEqual([
      "bin/field-native.exe",
      "bin/sidecar-slim.exe",
    ]);
  });

  it("the digest is the plane's bytes alone: the app's location, fieldd and the shell do not move it", async () => {
    const one = await hashNativePlane(app(BUILD).resources);
    const other = await hashNativePlane(
      app({ ...BUILD, "bin/fieldd": "fieldd-2", "app.asar": "asar-2" }).resources,
    );
    expect(other.digest).toBe(one.digest);
    const changed = await hashNativePlane(
      app({ ...BUILD, "bin/field-terminal-host": "cell-2" }).resources,
    );
    expect(changed.digest).not.toBe(one.digest);
    // F1 — the freeway host is the floor's: a release that changes only it touches field-native, never fieldd
    expect(planeOf("bin/field-freeway-host")).toBe("field-native");
    const host = app({ ...BUILD, "bin/field-freeway-host": "host-2" });
    expect((await hashNativePlane(host.resources)).digest).not.toBe(one.digest);
    expect(hashPlanes(host.app).fieldd.digest).toBe(hashPlanes(app(BUILD).app).fieldd.digest);
  });

  it("hashes a symlink by its target text, as the manifest does", async () => {
    const built = app(BUILD);
    symlinkSync("field-native", join(built.resources, "bin", "truffle-sidecar"));
    expect((await hashNativePlane(built.resources)).digest).toBe(
      hashPlanes(built.app)["field-native"].digest,
    );
  });

  it("a missing bin directory is an empty plane, never a throw", async () => {
    const empty = app({ "app.asar": "asar" });
    expect((await hashNativePlane(empty.resources)).members).toEqual([]);
  });
});

describe("the verdict: untouched only when the members AND the digest match (the PM's hard condition)", () => {
  const local: NativePlane = {
    digest: "e".repeat(64),
    members: ["bin/field-native", "bin/field-terminal-host", "bin/sidecar-slim"],
  };
  const manifest = (native: { digest: string; members: string[] }, platform = "mac-arm64") =>
    ReleaseManifest.parse({
      schemaVersion: 1,
      version: "0.9.0",
      tag: "v0.9.0",
      channel: "stable",
      commit: "a".repeat(40),
      builds: {
        [platform]: {
          "field-native": {
            digest: native.digest,
            files: native.members.length,
            members: native.members,
          },
        },
      },
      touched: ["field-native"],
      previous: null,
    });

  it("equal members and digest: untouched", () => {
    expect(
      nativeVerdict(
        manifest({ digest: local.digest, members: [...local.members] }),
        "mac-arm64",
        local,
      ),
    ).toEqual({
      touched: false,
    });
  });

  it("an extra member, a missing member, or another digest: touched, named", () => {
    expect(
      nativeVerdict(
        manifest({
          digest: local.digest,
          members: [...local.members, "bin/truffle-sidecar"].sort(),
        }),
        "mac-arm64",
        local,
      ),
    ).toEqual({ touched: true, why: "members" });
    expect(
      nativeVerdict(
        manifest({ digest: local.digest, members: ["bin/field-native", "bin/sidecar-slim"] }),
        "mac-arm64",
        local,
      ),
    ).toEqual({ touched: true, why: "members" });
    expect(
      nativeVerdict(
        manifest({ digest: "f".repeat(64), members: [...local.members] }),
        "mac-arm64",
        local,
      ),
    ).toEqual({ touched: true, why: "digest" });
  });

  it("no manifest, no build for this platform, or an unreadable plane: touched", () => {
    expect(nativeVerdict(null, "mac-arm64", local)).toEqual({ touched: true, why: "no-manifest" });
    expect(
      nativeVerdict(
        manifest({ digest: local.digest, members: [...local.members] }, "mac-x64"),
        "mac-arm64",
        local,
      ),
    ).toEqual({ touched: true, why: "no-build" });
    expect(
      nativeVerdict(
        manifest({ digest: local.digest, members: [...local.members] }),
        "mac-arm64",
        null,
      ),
    ).toEqual({ touched: true, why: "unreadable" });
  });
});
