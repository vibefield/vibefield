import { describe, expect, it } from "vitest";
import {
  assertPackagedResources,
  type DesktopResources,
  ResourceError,
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
    expect(dev.fielddCommand).toBe(ELECTRON);
    expect(dev.fielddArgs).toEqual([`${REPO}/packages/fieldd/dist/bin.cjs`]);
  });

  it("uses the cargo debug profile — legal here, forbidden in a package (EDP-13)", () => {
    expect(dev.fieldNativePath).toBe(`${REPO}/target/debug/field-native`);
  });

  it("offers both plugin roots, including the dev-linked pack", () => {
    expect(dev.pluginRoots.bundled).toEqual([`${REPO}/plugins`]);
    expect(dev.pluginRoots.devLinked).toEqual([`${REPO}/examples/plugins`]);
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
    expect(pkg.fielddArgs).toEqual([`${RESOURCES}/bin/bin.cjs`]);
    expect(pkg.fieldNativePath).toBe(`${RESOURCES}/bin/field-native`);
    expect(pkg.pluginRoots.bundled).toEqual([`${RESOURCES}/plugins/bundled`]);
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

  it("reports a missing fieldd bundle with a doctor code, not a stack trace", () => {
    try {
      assertPackagedResources(packaged());
      throw new Error("expected a ResourceError");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceError);
      expect((error as ResourceError).code).toBe("fieldd-bundle-missing");
      expect((error as ResourceError).path).toContain("bin.cjs");
    }
  });

  it("refuses an architecture mismatch — the failure that otherwise reads as a missing file", () => {
    // The bundle check passes only when the file exists, so this drives the
    // native check directly with an injected reader and a real repo path.
    const withRealBundle = packaged({ fielddArgs: [`${process.cwd()}/package.json`] });
    try {
      assertPackagedResources(withRealBundle, {
        nodeArch: "arm64",
        readHead: () => MACHO_X64,
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
    const withRealBundle = packaged({ fielddArgs: [`${process.cwd()}/package.json`] });
    try {
      assertPackagedResources(withRealBundle, { nodeArch: "arm64", readHead: () => null });
      throw new Error("expected a ResourceError");
    } catch (error) {
      expect((error as ResourceError).code).toBe("field-native-missing");
    }
  });

  it("accepts a matching architecture", () => {
    const withRealBundle = packaged({ fielddArgs: [`${process.cwd()}/package.json`] });
    expect(() =>
      assertPackagedResources(withRealBundle, { nodeArch: "arm64", readHead: () => MACHO_ARM64 }),
    ).not.toThrow();
  });

  it("never silently falls back to a development path when packaged", () => {
    // The regression this guards: an installed app quietly spawning from a
    // developer's checkout, which "works" on one machine and nowhere else.
    const pkg = packaged();
    expect(pkg.fielddArgs[0]).not.toContain(REPO);
    expect(() => assertPackagedResources(pkg)).toThrow(ResourceError);
  });
});
