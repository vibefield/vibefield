import { describe, expect, it } from "vitest";
import {
  assertPackagedResources,
  type DesktopResources,
  ResourceError,
  resolveDevelopmentRepoRoot,
  resolveDevelopmentResources,
  resolvePackagedResources,
} from "../src/main/resources";

// The packaged/development resource contract (distribution spec §4.3). These are
// pure path decisions, so the suite drives them directly — no Electron, no disk,
// except where a fixture is deliberately injected.

const REPO = "/Users/dev/vibe-field";
const RESOURCES = "/Applications/VibeField.app/Contents/Resources";
const ELECTRON = "/Applications/VibeField.app/Contents/MacOS/VibeField";

const MACHO_ARM64 = (() => {
  const b = new Uint8Array(64);
  b.set([0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01]);
  return b;
})();
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
      `${REPO}/apps/desktop/packaging/icons/app-macos-1024.png`,
    );
    expect(dev.fielddCommand).toBe(ELECTRON);
    expect(dev.fielddArgs).toEqual([`${REPO}/packages/fieldd/dist/bin.cjs`]);
    // Development keeps node mode: building a 145 MB SEA per edit would be an
    // absurd inner loop, and the dev Electron is unfused.
    expect(dev.fielddNeedsNodeMode).toBe(true);
  });

  it("uses the cargo debug profile — legal here, forbidden in a package (EDP-13)", () => {
    expect(dev.fieldNativePath).toBe(`${REPO}/target/debug/field-native`);
  });

  it("offers both plugin roots, including the dev-linked pack", () => {
    expect(dev.pluginRoots.bundled).toEqual([`${REPO}/plugins`]);
    expect(dev.pluginRoots.devLinked).toEqual([`${REPO}/examples/plugins`]);
  });

  it("keeps repository resources stable when Electron launches an immutable snapshot", () => {
    expect(
      resolveDevelopmentRepoRoot(
        `${REPO}/.vibefield/dev/runtime/dev-111111111111111111111111/app`,
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
    expect(pkg.fieldNativePath).toBe(`${RESOURCES}/bin/field-native`);
    expect(pkg.pluginRoots.bundled).toEqual([`${RESOURCES}/plugins/bundled`]);
  });

  it("execs a REAL fieldd executable, not Electron wearing a hat (EDP-14)", () => {
    expect(pkg.fielddCommand).toBe(`${RESOURCES}/bin/fieldd`);
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
      ...pkg.pluginRoots.bundled,
      ...Object.values(pkg.tray).flatMap((set) => Object.values(set)),
    ].join("\n");
    expect(everyPath).not.toContain("target/debug");
    expect(everyPath).not.toContain("node_modules");
    expect(everyPath).not.toContain("packages/");
    for (const p of everyPath.split("\n")) expect(p.startsWith(RESOURCES)).toBe(true);
  });

  it("adds .exe on win32 and nowhere else", () => {
    const win = resolvePackagedResources({
      resourcesPath: "C:\\Program Files\\VibeField\\resources",
      electronExecPath: "C:\\Program Files\\VibeField\\VibeField.exe",
      platform: "win32",
    });
    expect(win.fieldNativePath.endsWith("field-native.exe")).toBe(true);
    expect(pkg.fieldNativePath.endsWith("field-native")).toBe(true);
  });

  it("carries all three tray states and preserves the macOS Template suffix", () => {
    for (const kind of ["base", "attention", "offline"] as const) {
      const set = pkg.tray[kind];
      // The suffix is what makes macOS tint the glyph for light/dark menu bars;
      // losing it to a rename or a bundler hash is a silent visual bug.
      expect(set.macTemplate1x).toMatch(/Template\.png$/);
      expect(set.macTemplate2x).toMatch(/Template@2x\.png$/);
      expect(set.windowsIco.endsWith(".ico")).toBe(true);
      expect(set.linuxPng.endsWith(".png")).toBe(true);
    }
    // distinct art per state — not one file reused three times
    const ones = new Set(
      (["base", "attention", "offline"] as const).map((k) => pkg.tray[k].macTemplate1x),
    );
    expect(ones.size).toBe(3);
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
      assertPackagedResources(packaged(), { nodeArch: "arm64", readHead: reader(bothOk) }),
    ).not.toThrow();
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
