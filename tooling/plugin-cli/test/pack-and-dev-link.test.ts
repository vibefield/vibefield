// `pack` and `dev-link` — the two commands that put bytes somewhere.
//
// The pack exclusions are the interesting half. The design block requires that
// fixture-state files, `test/` and `scripts/` never travel in an artifact, and
// pack achieves that by INCLUSION (manifest + dist + assets + declared entries)
// rather than by filtering. That is the stronger arrangement, and this test is
// what keeps it true — plus the determinism property it must not cost.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PluginManifestV1 } from "@vibefield/contracts";
import { packVfplugin, unpackVfplugin } from "@vibefield/plugin-build";
import { describe, expect, it } from "vitest";
import { devLink, LINK_MARKER, resolveDevRoot } from "../src/dev-link";
import { artifactNameFor, packPlugin } from "../src/pack-command";
import { baseManifest, freshDir, makePlugin, refusalCodes, rendererModule } from "./fixtures";

function loadManifest(root: string): PluginManifestV1 {
  return PluginManifestV1.parse(
    JSON.parse(readFileSync(join(root, "vibefield.plugin.json"), "utf8")),
  );
}

/** A plugin carrying exactly the things that must NOT be packed. */
function pluginWithBenchMaterial(): string {
  return makePlugin({
    files: {
      "dist/renderer.js": rendererModule({}),
      "dist/renderer.css": ".card { color: red }\n",
      "assets/icon.svg": "<svg/>\n",
      "playground/states.ts": "export const states = { card: { default: {} } };\n",
      "test/plugin.test.ts": "// a test\n",
      "scripts/emit-manifest.ts": "// authoring-time\n",
      "src/renderer.tsx": "// source\n",
      "package.json": "{}\n",
    },
  });
}

describe("pack", () => {
  it("carries the installed bundle and nothing authoring-time", async () => {
    const root = pluginWithBenchMaterial();
    const { bytes } = await packVfplugin({ rootDir: root });
    const dest = freshDir("vf-unpack-");
    const { entries } = await unpackVfplugin(bytes, dest);

    expect(entries).toEqual([
      "assets/icon.svg",
      "dist/renderer.css",
      "dist/renderer.js",
      "vibefield.plugin.json",
    ]);
    for (const excluded of [
      "playground/states.ts",
      "test/plugin.test.ts",
      "scripts/emit-manifest.ts",
      "src/renderer.tsx",
      "package.json",
    ])
      expect(entries).not.toContain(excluded);
  });

  it("stays deterministic with that material present — same tree, same bytes", async () => {
    const root = pluginWithBenchMaterial();
    const first = await packVfplugin({ rootDir: root });
    const second = await packVfplugin({ rootDir: root });
    expect(second.sha256).toBe(first.sha256);
    expect(second.bytes.equals(first.bytes)).toBe(true);

    // And adding more bench material does not move the hash, which is what
    // "excluded" has to mean for a pinned artifact.
    mkdirSync(join(root, "playground"), { recursive: true });
    writeFileSync(join(root, "playground", "extra-states.ts"), "export const more = {};\n");
    writeFileSync(join(root, "scripts", "another.ts"), "// nope\n");
    const third = await packVfplugin({ rootDir: root });
    expect(third.sha256).toBe(first.sha256);
  });

  it("writes the artifact where it is told, and reports its sha256", async () => {
    const root = pluginWithBenchMaterial();
    const manifest = loadManifest(root);
    const out = join(freshDir("vf-pack-out-"), artifactNameFor(manifest));
    const result = await packPlugin({ root, manifest, out });

    expect(refusalCodes(result.verdicts)).toEqual([]);
    expect(existsSync(out)).toBe(true);
    expect(result.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.artifactPath).toBe(out);
  });

  it("refuses rather than packing an artifact whose declared entry is absent", async () => {
    const root = makePlugin({});
    const result = await packPlugin({ root, manifest: loadManifest(root) });
    expect(refusalCodes(result.verdicts)).toEqual(["pack-refused"]);
    expect(result.verdicts[0]?.detail).toContain("dist/renderer.js");
  });
});

describe("dev-link", () => {
  it("copies the installed bundle into the dev root and marks what it made", () => {
    const root = pluginWithBenchMaterial();
    const devRootDir = freshDir("vf-dev-root-");
    const result = devLink({
      root,
      manifest: loadManifest(root),
      devRoot: { root: devRootDir, origin: "flag" },
      now: 1_700_000_000_000,
    });

    expect(refusalCodes(result.verdicts)).toEqual([]);
    const link = join(devRootDir, baseManifest()["id"] as string);
    expect(existsSync(join(link, "vibefield.plugin.json"))).toBe(true);
    expect(existsSync(join(link, "dist", "renderer.js"))).toBe(true);
    expect(existsSync(join(link, "assets", "icon.svg"))).toBe(true);
    // Bench material stays behind, exactly as it does for pack.
    expect(existsSync(join(link, "playground"))).toBe(false);
    expect(existsSync(join(link, "test"))).toBe(false);

    const marker = JSON.parse(readFileSync(join(link, LINK_MARKER), "utf8")) as {
      source: string;
      linkedAt: number;
    };
    expect(marker.source).toBe(root);
    expect(marker.linkedAt).toBe(1_700_000_000_000);
  });

  it("copies REAL files — a link would be invisible to discovery and refused at load", () => {
    const root = pluginWithBenchMaterial();
    const devRootDir = freshDir("vf-dev-root-");
    devLink({ root, manifest: loadManifest(root), devRoot: { root: devRootDir, origin: "flag" } });

    const link = join(devRootDir, baseManifest()["id"] as string);
    // Discovery keeps only entries whose dirent isDirectory(); a symlinked
    // plugin dir reports false. The copy is a real directory.
    expect(existsSync(link)).toBe(true);
    const before = readFileSync(join(root, "dist", "renderer.js"), "utf8");
    writeFileSync(join(root, "dist", "renderer.js"), "// edited after linking\n");
    expect(readFileSync(join(link, "dist", "renderer.js"), "utf8")).toBe(before);
  });

  it("re-links over its own copy, and refuses a directory it did not create", () => {
    const root = pluginWithBenchMaterial();
    const devRootDir = freshDir("vf-dev-root-");
    const args = {
      root,
      manifest: loadManifest(root),
      devRoot: { root: devRootDir, origin: "flag" as const },
    };

    expect(refusalCodes(devLink(args).verdicts)).toEqual([]);
    expect(refusalCodes(devLink(args).verdicts)).toEqual([]);

    // Someone else's directory of the same name is not ours to replace.
    const link = join(devRootDir, baseManifest()["id"] as string);
    writeFileSync(join(link, LINK_MARKER), "not json");
    expect(refusalCodes(devLink(args).verdicts)).toEqual(["link-exists"]);
  });

  it("removes only what it made, and says so when there is nothing to remove", () => {
    const root = pluginWithBenchMaterial();
    const devRootDir = freshDir("vf-dev-root-");
    const args = {
      root,
      manifest: loadManifest(root),
      devRoot: { root: devRootDir, origin: "flag" as const },
    };

    const absent = devLink({ ...args, remove: true });
    expect(refusalCodes(absent.verdicts)).toEqual([]);
    expect(absent.verdicts[0]?.code).toBe("link-missing");

    devLink(args);
    expect(refusalCodes(devLink({ ...args, remove: true }).verdicts)).toEqual([]);
    expect(existsSync(join(devRootDir, baseManifest()["id"] as string))).toBe(false);
  });

  it("resolves the dev root in the documented order", () => {
    const explicit = resolveDevRoot({ explicit: "/tmp/explicit", env: "/tmp/env", from: "/tmp" });
    expect(explicit).toEqual({ root: "/tmp/explicit", origin: "flag" });

    const fromEnv = resolveDevRoot({ env: `/tmp/env-a:/tmp/env-b`, from: "/tmp" });
    expect(fromEnv).toEqual({ root: "/tmp/env-a", origin: "env" });

    // The repo default is the root `resources.ts` hands fieldd in development.
    const fromRepo = resolveDevRoot({ env: "", from: process.cwd() });
    expect(fromRepo?.origin).toBe("repo");
    expect(fromRepo?.root.endsWith("/examples/plugins")).toBe(true);
  });
});
