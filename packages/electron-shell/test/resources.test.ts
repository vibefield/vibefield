import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPackagedResources,
  type DesktopResources,
  ResourceError,
  readBundledTrust,
  resolveDevelopmentRepoRoot,
  resolveDevelopmentResources,
  resolvePackagedResources,
} from "../src/main/resources";

// The packaged/development resource contract (distribution spec §4.3). These are
// pure path decisions, so the suite drives them directly — no Electron, no disk,
// except where a fixture is deliberately injected.
//
// Fixture roots are spelled for the HOST and every expectation is built with the
// same `join` the resolver uses. `join`/`resolve` are host-bound: on win32 a
// POSIX literal resolves onto whichever drive the suite runs from
// (`/Applications/…` → `D:\Applications\…`) and the segments come back separated
// by `\`, so a hand-written `${REPO}/a/b` would compare a mac string against a
// Windows answer and prove nothing. The `platform` argument passed below still
// names the TARGET — it decides the `.exe` suffix (§4.3), not the path's shape.

/** A fixture path spelled for this host — the volume prefix is what a POSIX
 * literal is missing on win32, and `\` is what `join` answers with there. */
const hostPath = (posix: string): string =>
  process.platform === "win32" ? `C:${posix.replaceAll("/", "\\")}` : posix;

const REPO = hostPath("/Users/dev/vibe-field");
const RESOURCES = hostPath("/Applications/VibeField.app/Contents/Resources");
const ELECTRON = hostPath("/Applications/VibeField.app/Contents/MacOS/VibeField");

const MACHO_ARM64 = (() => {
  const b = new Uint8Array(64);
  b.set([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]);
  return b;
})();
/** WP8c — two root public keys in the kit's encoding (the contracts fixture's; no secret exists for them). */
const ROOT_KEYS: string[] = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "..", "..", "contracts", "fixtures", "trust-root.valid.json"),
    "utf8",
  ),
).root.keys;
/** A packaged layout's staged identity and signed roots, as text reads answer them: valid and RELEASE-keyed
 * unless an override (by path suffix) says otherwise; `null` is a missing file. */
const textReader =
  (over: Record<string, string | null> = {}) =>
  (path: string): string | null => {
    for (const [suffix, answer] of Object.entries(over)) if (path.endsWith(suffix)) return answer;
    if (path.endsWith("release-identity.json"))
      return JSON.stringify({
        schemaVersion: 1,
        keyClass: "release",
        identityRevision: 5,
        trustRootKeys: ROOT_KEYS,
        appId: "com.jamesyong.vibefield",
        productName: "VibeField",
        updateChannel: "beta",
        updateOrigin: "https://github.com/vibefield/vibefield/releases",
      });
    return "{}";
  };
const MACHO_X64 = (() => {
  const b = new Uint8Array(64);
  b.set([0xcf, 0xfa, 0xed, 0xfe, 0x07, 0x00, 0x00, 0x01]);
  return b;
})();

describe("resolveDevelopmentResources", () => {
  const dev = resolveDevelopmentResources({
    repoRoot: REPO,
    electronExecPath: ELECTRON,
    platform: "darwin",
  });

  it("runs the fieldd bundle from the repo through Electron-as-node", () => {
    expect(dev.packaged).toBe(false);
    expect(dev.developmentDockIconPath).toBe(
      join(REPO, "apps", "desktop", "packaging", "icons", "app-macos-dock.png"),
    );
    expect(dev.fielddCommand).toBe(ELECTRON);
    expect(dev.fielddArgs).toEqual([join(REPO, "packages", "fieldd", "dist", "bin.cjs")]);
    // Development keeps node mode: building a 145 MB SEA per edit would be an
    // absurd inner loop, and the dev Electron is unfused.
    expect(dev.fielddNeedsNodeMode).toBe(true);
  });

  it("uses the cargo debug profile — legal here, forbidden in a package (EDP-13)", () => {
    expect(dev.fieldNativePath).toBe(join(REPO, "target", "debug", "field-native"));
  });

  it("points the screenshot helper at the per-platform native build, inside its bundle on macOS", () => {
    // SNAP-D5/D9: the bundle is the unit macOS keys consent on; the executable
    // the tool spawns lives inside it. Windows builds a bare .exe; every other
    // platform has no helper and says so with null rather than a path to nothing.
    expect(dev.screenshotHelperPath).toBe(
      join(
        REPO,
        "apps",
        "desktop",
        "build",
        "native",
        "macos",
        "field-screenshot-helper.app",
        "Contents",
        "MacOS",
        "field-screenshot-helper",
      ),
    );
    const win = resolveDevelopmentResources({
      repoRoot: REPO,
      electronExecPath: ELECTRON,
      platform: "win32",
    });
    expect(win.screenshotHelperPath).toBe(
      join(REPO, "apps", "desktop", "build", "native", "windows", "field-screenshot-helper.exe"),
    );
    const linux = resolveDevelopmentResources({
      repoRoot: REPO,
      electronExecPath: ELECTRON,
      platform: "linux",
    });
    expect(linux.screenshotHelperPath).toBeNull();
  });

  it("names no rosettad — the dev runner resolves the lock's build and exports it (AR-8)", () => {
    expect(dev.rosettadPath).toBeNull();
  });

  it("offers both plugin roots, including the dev-linked pack", () => {
    expect(dev.pluginRoots.bundled).toEqual([join(REPO, "plugins")]);
    expect(dev.pluginRoots.devLinked).toEqual([join(REPO, "examples", "plugins")]);
  });

  it("keeps repository resources stable when Electron launches an immutable snapshot", () => {
    expect(
      resolveDevelopmentRepoRoot(
        join(REPO, ".vibefield", "dev", "runtime", "dev-111111111111111111111111", "app"),
        REPO,
      ),
    ).toBe(REPO);
    expect(() => resolveDevelopmentRepoRoot("/snapshot/app", "relative/repo")).toThrow(
      /absolute path/,
    );
  });
});

describe("resolvePackagedResources", () => {
  const pkg = resolvePackagedResources({
    resourcesPath: RESOURCES,
    electronExecPath: ELECTRON,
    platform: "darwin",
  });

  it("hangs everything off resourcesPath", () => {
    expect(pkg.packaged).toBe(true);
    expect(pkg.developmentDockIconPath).toBeNull();
    expect(pkg.fieldNativePath).toBe(join(RESOURCES, "bin", "field-native"));
    expect(pkg.macosLiveSurfaceCapture).toEqual({
      helperPath: join(RESOURCES, "bin", "live-surface-capture-helper"),
      adapterPath: join(RESOURCES, "bin", "live-surface-adapter.node"),
    });
    expect(pkg.pluginRoots.bundled).toEqual([join(RESOURCES, "plugins", "bundled")]);
    // the bundle sits flat under bin/ beside the other native helpers
    expect(pkg.screenshotHelperPath).toBe(
      join(
        RESOURCES,
        "bin",
        "field-screenshot-helper.app",
        "Contents",
        "MacOS",
        "field-screenshot-helper",
      ),
    );
  });

  it("puts rosettad beside fieldd, flat under bin/ (AR-8, L3)", () => {
    expect(pkg.rosettadPath).toBe(join(RESOURCES, "bin", "rosettad"));
  });

  it("does not make the screenshot helper a boot-fatal resource (SNAP-D5)", () => {
    // Every OTHER packaged binary is asserted before anything spawns; the
    // screenshot helper is optional in the stage, so a package without it must
    // boot and answer `helper-missing` at capture time instead.
    const okHeads = (path: string): Uint8Array | null =>
      path.includes("field-screenshot-helper") ? null : MACHO_ARM64;
    expect(() =>
      assertPackagedResources(pkg, {
        nodeArch: "arm64",
        readHead: okHeads,
        readText: textReader(),
      }),
    ).not.toThrow();
  });

  it("execs a REAL fieldd executable, not Electron wearing a hat (EDP-14)", () => {
    expect(pkg.fielddCommand).toBe(join(RESOURCES, "bin", "fieldd"));
    expect(pkg.fielddArgs).toEqual([]);
    // The command must not be the app's own binary — that would be the
    // Electron-as-node launcher the RunAsNode fuse now refuses to honour.
    expect(pkg.fielddCommand).not.toBe(ELECTRON);
  });

  it("does not ask for node mode, because a packaged build cannot be granted it", () => {
    expect(pkg.fielddNeedsNodeMode).toBe(false);
  });

  it("has NO dev-linked plugin root — a package must not load unverified plugins", () => {
    expect(pkg.pluginRoots.devLinked).toEqual([]);
  });

  it("never mentions target/debug or a repository layout (§4.3's forbidden list)", () => {
    const everyPath = [
      ...pkg.fielddArgs,
      pkg.fieldNativePath,
      ...(pkg.macosLiveSurfaceCapture === null
        ? []
        : [pkg.macosLiveSurfaceCapture.helperPath, pkg.macosLiveSurfaceCapture.adapterPath]),
      ...(pkg.screenshotHelperPath === null ? [] : [pkg.screenshotHelperPath]),
      ...(pkg.rosettadPath === null ? [] : [pkg.rosettadPath]),
      ...pkg.pluginRoots.bundled,
      ...Object.values(pkg.tray).flatMap((set) => Object.values(set)),
    ].join("\n");
    // The needles carry the host separator too: `"target/debug"` can never
    // appear in a `join`ed Windows path, so a POSIX-spelled forbidden term is a
    // test that passes by never being able to fail.
    expect(everyPath).not.toContain(join("target", "debug"));
    expect(everyPath).not.toContain("node_modules");
    expect(everyPath).not.toContain(`packages${sep}`);
    for (const p of everyPath.split("\n")) expect(p.startsWith(RESOURCES)).toBe(true);
  });

  it("adds .exe on win32 and nowhere else", () => {
    const win = resolvePackagedResources({
      resourcesPath: "C:\\Program Files\\VibeField\\resources",
      electronExecPath: "C:\\Program Files\\VibeField\\VibeField.exe",
      platform: "win32",
    });
    expect(win.fieldNativePath.endsWith("field-native.exe")).toBe(true);
    expect(win.macosLiveSurfaceCapture).toBeNull();
    expect(win.screenshotHelperPath?.endsWith("field-screenshot-helper.exe")).toBe(true);
    expect(win.rosettadPath?.endsWith("rosettad.exe")).toBe(true);
    expect(pkg.fieldNativePath.endsWith("field-native")).toBe(true);
    expect(
      resolvePackagedResources({
        resourcesPath: RESOURCES,
        electronExecPath: ELECTRON,
        platform: "linux",
      }).screenshotHelperPath,
    ).toBeNull();
  });

  it("carries all four tray states and preserves the macOS Template suffix", () => {
    // AU-4 (AU-G14): `update` joins — an install that waits wears its own image, never the attention badge
    for (const kind of ["base", "attention", "update", "offline"] as const) {
      const set = pkg.tray[kind];
      // The suffix is what makes macOS tint the glyph for light/dark menu bars;
      // losing it to a rename or a bundler hash is a silent visual bug.
      expect(set.macTemplate1x).toMatch(/Template\.png$/);
      expect(set.macTemplate2x).toMatch(/Template@2x\.png$/);
      expect(set.windowsIco.endsWith(".ico")).toBe(true);
      expect(set.linuxPng.endsWith(".png")).toBe(true);
    }
    // distinct art per state — not one file reused four times
    const ones = new Set(
      (["base", "attention", "update", "offline"] as const).map((k) => pkg.tray[k].macTemplate1x),
    );
    expect(ones.size).toBe(4);
    expect(pkg.tray.update).toEqual({
      macTemplate1x: expect.stringMatching(/[\\/]fieldUpdateTemplate\.png$/),
      macTemplate2x: expect.stringMatching(/[\\/]fieldUpdateTemplate@2x\.png$/),
      windowsIco: expect.stringMatching(/[\\/]field-update\.ico$/),
      linuxPng: expect.stringMatching(/[\\/]field-linux-update\.png$/),
    });
  });
});

describe("assertPackagedResources", () => {
  const packaged = (over: Partial<DesktopResources> = {}): DesktopResources => ({
    ...resolvePackagedResources({
      resourcesPath: RESOURCES,
      electronExecPath: ELECTRON,
      platform: "darwin",
    }),
    ...over,
  });

  it("is a no-op for a development layout — a dev tree may lack a release binary", () => {
    const dev = resolveDevelopmentResources({ repoRoot: REPO, electronExecPath: ELECTRON });
    expect(() => assertPackagedResources(dev)).not.toThrow();
  });

  /** Path-aware reader: fieldd and field-native are now BOTH executables, so
   * each has to be able to fail while the other passes. */
  const reader =
    (byPath: Record<"fieldd" | "native", Uint8Array | null>) =>
    (path: string): Uint8Array | null =>
      path.endsWith("field-native") ? byPath.native : byPath.fieldd;

  const bothOk = { fieldd: MACHO_ARM64, native: MACHO_ARM64 };

  it("reports a missing fieldd executable with a doctor code, not a stack trace", () => {
    try {
      assertPackagedResources(packaged(), {
        nodeArch: "arm64",
        readHead: reader({ fieldd: null, native: MACHO_ARM64 }),
      });
      throw new Error("expected a ResourceError");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceError);
      expect((error as ResourceError).code).toBe("fieldd-bundle-missing");
      expect((error as ResourceError).path).toContain("fieldd");
    }
  });

  it("refuses a fieldd built for another architecture", () => {
    // The SEA embeds a whole Node binary, so an x64 SEA on an arm64 machine is
    // a real and easy mistake once universal builds arrive.
    try {
      assertPackagedResources(packaged(), {
        nodeArch: "arm64",
        readHead: reader({ fieldd: MACHO_X64, native: MACHO_ARM64 }),
      });
      throw new Error("expected a ResourceError");
    } catch (error) {
      expect((error as ResourceError).code).toBe("fieldd-arch-mismatch");
      expect((error as ResourceError).message).toContain("x64");
    }
  });

  it("refuses a field-native mismatch — the failure that otherwise reads as a missing file", () => {
    try {
      assertPackagedResources(packaged(), {
        nodeArch: "arm64",
        readHead: reader({ fieldd: MACHO_ARM64, native: MACHO_X64 }),
      });
      throw new Error("expected a ResourceError");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceError);
      expect((error as ResourceError).code).toBe("field-native-arch-mismatch");
      expect((error as ResourceError).message).toContain("x64");
      expect((error as ResourceError).message).toContain("arm64");
    }
  });

  it("reports an absent field-native distinctly from a mismatched one", () => {
    try {
      assertPackagedResources(packaged(), {
        nodeArch: "arm64",
        readHead: reader({ fieldd: MACHO_ARM64, native: null }),
      });
      throw new Error("expected a ResourceError");
    } catch (error) {
      expect((error as ResourceError).code).toBe("field-native-missing");
    }
  });

  it("accepts a matching architecture on both executables", () => {
    expect(() =>
      assertPackagedResources(packaged(), {
        nodeArch: "arm64",
        readHead: reader(bothOk),
        readText: textReader(),
      }),
    ).not.toThrow();
  });

  it("requires matching packaged SCK helper and adapter binaries on macOS", () => {
    const capture = packaged().macosLiveSurfaceCapture!;
    const read =
      (missingOrWrong: string | null, wrong = false) =>
      (path: string) => {
        if (missingOrWrong !== null && path === missingOrWrong) return wrong ? MACHO_X64 : null;
        return MACHO_ARM64;
      };
    for (const [path, missingCode, mismatchCode] of [
      [
        capture.helperPath,
        "live-surface-capture-helper-missing",
        "live-surface-capture-helper-arch-mismatch",
      ],
      [capture.adapterPath, "live-surface-adapter-missing", "live-surface-adapter-arch-mismatch"],
    ] as const) {
      expect(() =>
        assertPackagedResources(packaged(), { nodeArch: "arm64", readHead: read(path) }),
      ).toThrow(expect.objectContaining({ code: missingCode }));
      expect(() =>
        assertPackagedResources(packaged(), {
          nodeArch: "arm64",
          readHead: read(path, true),
        }),
      ).toThrow(expect.objectContaining({ code: mismatchCode }));
    }
  });

  it("boots without rosettad, and refuses one built for another architecture (AR-8, L3)", () => {
    // Absent is History's honest "no agent history", never a refusal to boot;
    // present, it gets the same architecture question as every executable.
    const rosettad = packaged().rosettadPath!;
    const heads =
      (answer: Uint8Array | null) =>
      (path: string): Uint8Array | null =>
        path === rosettad ? answer : MACHO_ARM64;
    expect(() =>
      assertPackagedResources(packaged(), {
        nodeArch: "arm64",
        readHead: heads(null),
        readText: textReader(),
      }),
    ).not.toThrow();
    expect(() =>
      assertPackagedResources(packaged(), {
        nodeArch: "arm64",
        readHead: heads(MACHO_ARM64),
        readText: textReader(),
      }),
    ).not.toThrow();
    try {
      assertPackagedResources(packaged(), { nodeArch: "arm64", readHead: heads(MACHO_X64) });
      throw new Error("expected a ResourceError");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceError);
      expect((error as ResourceError).code).toBe("rosettad-arch-mismatch");
      expect((error as ResourceError).path).toBe(rosettad);
      expect((error as ResourceError).message).toContain("x64");
    }
  });

  it("never silently falls back to a development path when packaged", () => {
    // The regression this guards: an installed app quietly spawning from a
    // developer's checkout, which "works" on one machine and nowhere else.
    const pkg = packaged();
    expect(pkg.fielddCommand).not.toContain(REPO);
    expect(pkg.fieldNativePath).not.toContain(REPO);
    // With nothing on disk at those paths, boot must fail rather than search.
    expect(() => assertPackagedResources(pkg)).toThrow(ResourceError);
  });
});

// WP8c (build-wp8-bundled-plugins.md W4; WP8-D3, D4, D9 as amended by trust-and-distribution.md §5): the staged
// identity is the app's anchor for its own plugins, so a package without it, without the signed index it vouches
// for, or signed with development keys refuses to boot — typed, before anything spawns. A development layout has
// no anchor at all: its bundled root is the developer's own tree.
describe("the bundled trust anchor (WP8c)", () => {
  const packaged = resolvePackagedResources({
    resourcesPath: RESOURCES,
    electronExecPath: ELECTRON,
    platform: "darwin",
  });
  const allHeads = (): Uint8Array | null => MACHO_ARM64;
  const codeOf = (fn: () => void): string | null => {
    try {
      fn();
      return null;
    } catch (error) {
      return error instanceof ResourceError ? error.code : String(error);
    }
  };

  it("names the staged identity in the packaged layout, and none in development", () => {
    expect(packaged.identity).toEqual({
      identityPath: join(RESOURCES, "identity", "release-identity.json"),
      trustRootPath: join(RESOURCES, "identity", "trust-root.json"),
    });
    const dev = resolveDevelopmentResources({ repoRoot: REPO, electronExecPath: ELECTRON });
    expect(dev.identity).toBeNull();
    expect(readBundledTrust(dev)).toBeNull();
  });

  it("hands fieldd the trust-root's path and the staged root keys", () => {
    expect(readBundledTrust(packaged, textReader())).toEqual({
      trustRootPath: join(RESOURCES, "identity", "trust-root.json"),
      rootKeys: ROOT_KEYS,
      keyClass: "release",
    });
  });

  it("hands the shell this build's identity when the stage recorded one (WP12 D10), and none from an older stage", () => {
    const withBuild = textReader({
      "release-identity.json": JSON.stringify({
        schemaVersion: 1,
        keyClass: "release",
        identityRevision: 6,
        trustRootKeys: ROOT_KEYS,
        appId: "com.jamesyong.vibefield",
        productName: "VibeField",
        updateChannel: "beta",
        updateOrigin: "https://github.com/vibefield/vibefield/releases",
        buildId: "0.9.0+0d48e33",
      }),
    });
    expect(readBundledTrust(packaged, withBuild)?.buildId).toBe("0.9.0+0d48e33");
    expect(readBundledTrust(packaged, textReader())).not.toHaveProperty("buildId");
  });

  it("refuses a missing or damaged identity, and a trust-root without its signatures", () => {
    for (const over of [
      { "release-identity.json": null },
      { "release-identity.json": "{not json" },
      { "release-identity.json": JSON.stringify({ schemaVersion: 1, keyClass: "release" }) },
      { "trust-root.json.sig": null },
      { "trust-root.json": null },
    ]) {
      expect(
        codeOf(() =>
          assertPackagedResources(packaged, {
            nodeArch: "arm64",
            readHead: allHeads,
            readText: textReader(over),
          }),
        ),
        JSON.stringify(over),
      ).toBe("bundled-identity-missing");
    }
  });

  it("refuses a package whose bundled root has no signed index", () => {
    expect(
      codeOf(() =>
        assertPackagedResources(packaged, {
          nodeArch: "arm64",
          readHead: allHeads,
          readText: textReader({ "bundled-plugins.json": null }),
        }),
      ),
    ).toBe("bundled-root-missing");
  });

  it("refuses a DEV-keyed package unless launched with --allow-dev-trust", () => {
    const dev = textReader({
      "release-identity.json": JSON.stringify({
        schemaVersion: 1,
        keyClass: "dev",
        identityRevision: 5,
        trustRootKeys: ROOT_KEYS,
        appId: "com.jamesyong.vibefield",
        productName: "VibeField",
        updateChannel: "beta",
        updateOrigin: "https://github.com/vibefield/vibefield/releases",
      }),
    });
    expect(
      codeOf(() =>
        assertPackagedResources(packaged, { nodeArch: "arm64", readHead: allHeads, readText: dev }),
      ),
    ).toBe("bundled-dev-trust");
    expect(
      codeOf(() =>
        assertPackagedResources(packaged, {
          nodeArch: "arm64",
          readHead: allHeads,
          readText: dev,
          allowDevTrust: true,
        }),
      ),
    ).toBeNull();
  });
});
