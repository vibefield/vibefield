import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPlugin,
  findBundledSingletons,
  findUnmappableSpecifiers,
  isHostSingletonSpecifier,
  PluginBuildError,
} from "../src/build";

// P8a — the build stages. Two levels, deliberately:
//
//   * the PA-29 artifact check is unit-tested against a synthetic module list,
//     because the honest end-to-end version cannot be staged — externals come
//     from ONE list that both the bundler and the check read, so a real build
//     cannot swallow a singleton without the same edit disabling the check.
//     What the unit test proves is that the check FAILS when handed evidence of
//     a bundled singleton, which is the half a future refactor can break;
//   * the stage-failure paths and the service bundle run end to end on fixture
//     plugins, because those CAN be staged truthfully — and the service stage
//     has no shipping consumer yet (kv-service ships a hand-written entry), so
//     without a fixture it would be an unexercised code path.
//
// P8 rung 0b — the unmappable-specifier check joins the SECOND group, and the
// asymmetry is the point: the bundler externalizes by PREFIX while §11.6's
// import map is an exact enumeration, so a fixture can emit a specifier nothing
// binds without a single list being edited to arrange it. Nothing here builds a
// real plugin: `pnpm test` must not wait on `pnpm build` (the P8a law).

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "plugin-build-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

const manifest = (entries: Record<string, string>): string =>
  JSON.stringify({ id: "com.example.fixture", entries });

describe("isHostSingletonSpecifier", () => {
  it("matches a singleton and its subpaths, and nothing else", () => {
    expect(isHostSingletonSpecifier("react")).toBe(true);
    // The subpath arm is the load-bearing one: externalizing `@vibecook/ice`
    // while bundling `@vibecook/ice/react` is exactly how a second copy lands.
    expect(isHostSingletonSpecifier("@vibecook/ice/react")).toBe(true);
    expect(isHostSingletonSpecifier("react/jsx-runtime")).toBe(true);
    expect(isHostSingletonSpecifier("./widget")).toBe(false);
    expect(isHostSingletonSpecifier("react-markdown")).toBe(false); // prefix, not subpath
  });
});

describe("findBundledSingletons (the PA-29 artifact check)", () => {
  it("REFUSES a module list carrying a bundled singleton", () => {
    const swallowed = findBundledSingletons([
      "/repo/plugins/x/src/widget.tsx",
      "/repo/node_modules/.pnpm/react@19/node_modules/react/index.js",
    ]);
    expect(swallowed).toContain("react");
  });

  it("catches a workspace singleton, which never appears under node_modules", () => {
    // The SDK is the one singleton EVERY plugin imports, and it resolves to its
    // source tree — a check keyed only on node_modules would miss precisely it.
    expect(findBundledSingletons(["/repo/packages/plugin-sdk/src/index.ts"])).toContain(
      "@vibefield/plugin-sdk",
    );
  });

  it("passes a clean list, including a package whose name merely starts alike", () => {
    expect(
      findBundledSingletons([
        "/repo/plugins/x/src/widget.tsx",
        "/repo/node_modules/react-markdown/index.js",
      ]),
    ).toEqual([]);
  });
});

describe("findUnmappableSpecifiers (the §11.6 artifact check)", () => {
  it("binds the enumerated specifiers, including the SDK subpaths a real bundle emits", () => {
    expect(
      findUnmappableSpecifiers([
        "react",
        "react/jsx-runtime",
        "@vibefield/plugin-sdk",
        "@vibefield/plugin-sdk/ui",
        "@vibefield/plugin-sdk/canvas",
      ]),
    ).toEqual([]);
  });

  it("REFUSES a singleton subpath nobody enumerated", () => {
    // The load-bearing case. `isHostSingletonSpecifier` externalizes this by
    // prefix and the map has no key for it, so without this check the renderer
    // meets a specifier at import time that resolves to nothing.
    expect(isHostSingletonSpecifier("@vibecook/ice/react")).toBe(true);
    expect(findUnmappableSpecifiers(["@vibecook/ice/react"])).toEqual(["@vibecook/ice/react"]);
  });

  it("leaves the bundle's own business alone: relative, absolute, and node builtins", () => {
    expect(
      findUnmappableSpecifiers([
        "./chunk.js",
        "../shared/util.js",
        "/abs/path.js",
        "node:fs",
        "os",
      ]),
    ).toEqual([]);
  });
});

describe("buildPlugin", () => {
  it("bundles a service entry self-contained, leaving only the SDK external", async () => {
    const root = fixture({
      "vibefield.plugin.json": manifest({ service: "./dist/service.js" }),
      "src/helper.ts": "export const answer = (): number => 42;\n",
      "src/service.ts":
        'import { answer } from "./helper";\n' +
        'import { defineServicePlugin } from "@vibefield/plugin-sdk";\n' +
        "export default defineServicePlugin({ activate: () => answer() });\n",
    });

    const report = await buildPlugin({ root });
    expect(report.ok).toBe(true);
    const out = readFileSync(join(root, "dist", "service.js"), "utf8");
    // the local module travelled INTO the artifact...
    expect(out).toContain("42");
    // ...and the SDK stayed a bare specifier for the harness hook to bind.
    expect(out).toMatch(/from\s*"@vibefield\/plugin-sdk"/);
  });

  it("REFUSES a bundle that swallowed a singleton the externals matcher never saw", async () => {
    // The end-to-end control, and the reason it imports by RELATIVE PATH: the
    // external matcher only ever sees bare specifiers, so a path import into a
    // singleton's own files walks straight past it and into the artifact. That
    // is the gap this check exists to close, and the only way to stage it
    // truthfully — dropping a name from the externals list disables the
    // bundler and the check together (measured: react bundled, 5 → 9 modules,
    // check silent), so that experiment proves nothing.
    const root = fixture({
      "vibefield.plugin.json": manifest({ service: "./dist/service.js" }),
      "node_modules/react/index.js": "export const version = 'fixture';\n",
      "src/service.ts":
        'import { version } from "../node_modules/react/index.js";\nexport default { version };\n',
    });
    await expect(buildPlugin({ root })).rejects.toThrow(/host singletons.*react|react.*external/s);
  });

  it("bundles a renderer whose every emitted specifier the host can bind", async () => {
    // The control's control: a plugin importing the SDK root AND a subpath —
    // the shape all four shipping renderer plugins have — must sail through.
    const root = fixture({
      "vibefield.plugin.json": manifest({ renderer: "./dist/renderer.js" }),
      "src/renderer.ts":
        'import { defineRendererPlugin } from "@vibefield/plugin-sdk";\n' +
        'import { UiButton } from "@vibefield/plugin-sdk/ui";\n' +
        "export default defineRendererPlugin({ activate: () => UiButton });\n",
    });

    const report = await buildPlugin({ root });
    expect(report.ok).toBe(true);
    // Both stayed bare for the import map to bind, subpath included.
    const out = readFileSync(join(root, "dist", "renderer.js"), "utf8");
    expect(out).toMatch(/from\s*"@vibefield\/plugin-sdk"/);
    expect(out).toMatch(/from\s*"@vibefield\/plugin-sdk\/ui"/);
    expect(report.stages.at(-1)?.detail).toContain("emitted specifiers all mappable");
  });

  it("REFUSES a renderer artifact emitting a specifier the host cannot resolve", async () => {
    // The end-to-end control, and staging it disables nothing: the externals
    // matcher takes `@vibecook/ice/react` by PREFIX, so the bundler emits it
    // bare — while the import map is an exact enumeration with no key for it.
    // That gap is the whole reason this check exists, and it is reachable
    // without editing a single list to arrange the failure.
    const root = fixture({
      "vibefield.plugin.json": manifest({ renderer: "./dist/renderer.js" }),
      "src/renderer.ts":
        'import { useIce } from "@vibecook/ice/react";\nexport default { useIce };\n',
    });

    await expect(buildPlugin({ root })).rejects.toThrow(PluginBuildError);
    // The message is the interface: it names the specifier that has no home and
    // the list that would give it one.
    await expect(buildPlugin({ root })).rejects.toThrow(
      /@vibecook\/ice\/react[\s\S]*HOST_SINGLETON_MODULE_SPECIFIERS[\s\S]*@vibefield\/contracts/,
    );
  });

  it("refuses when the manifest promises a renderer no source can produce", async () => {
    const root = fixture({ "vibefield.plugin.json": manifest({ renderer: "./dist/renderer.js" }) });
    await expect(buildPlugin({ root })).rejects.toThrow(PluginBuildError);
    await expect(buildPlugin({ root })).rejects.toThrow(/no renderer source exists/);
    expect(existsSync(join(root, "dist", "renderer.js"))).toBe(false);
  });

  it("refuses a plugin with no emitted manifest, and names the command that writes one", async () => {
    const root = fixture({ "src/renderer.ts": "export default {};\n" });
    // The message is the interface here: build reads the manifest, gen:manifest
    // writes it, and a plugin author (or an agent) must be told which.
    await expect(buildPlugin({ root })).rejects.toThrow(/gen:manifest/);
  });
});
