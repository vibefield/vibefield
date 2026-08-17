// The suite, proven the only way a check can be proven: each refusal class gets
// a tree that TRIPS it and a tree that does not, in the same test. A check that
// has never been seen to fail is a check nobody has tested.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPlugin } from "../src/check";
import {
  baseManifest,
  FIXTURE_ID,
  freshDir,
  makePlugin,
  refusalCodes,
  rendererModule,
} from "./fixtures";

const CARD = `${FIXTURE_ID}.card`;

describe("check — a clean plugin", () => {
  it("passes every row it can run, and notes the ones it cannot", async () => {
    const root = makePlugin({ files: { "src/renderer.ts": "export default {};\n" } });
    const verdicts = await checkPlugin({ dir: root });

    expect(refusalCodes(verdicts)).toEqual([]);
    // No dist/: the artifact and activation rows are NOTES, and the command
    // still passes — `check` never requires a build.
    expect(verdicts.filter((v) => v.level === "note").map((v) => v.code)).toEqual([
      "activation-unbuilt",
      "artifact-absent",
    ]);
  });

  it("runs the binding and leak rows once an artifact exists", async () => {
    const root = makePlugin({ files: { "dist/renderer.js": rendererModule({}) } });
    const verdicts = await checkPlugin({ dir: root });

    expect(refusalCodes(verdicts)).toEqual([]);
    expect(verdicts.map((v) => v.detail)).toContain("1 declared widget type(s) bound exactly");
    expect(verdicts.map((v) => v.detail)).toContain(
      "deactivation released every timer this activation created",
    );
  });
});

describe("check — manifest-invalid (the control run)", () => {
  it("refuses a manifest that breaks a field rule, with a pointer and what was expected", async () => {
    const root = makePlugin({
      rawManifest: `${JSON.stringify({ ...baseManifest(), version: "not-semver" }, null, 2)}\n`,
    });
    const verdicts = await checkPlugin({ dir: root });

    const invalid = verdicts.find((v) => v.code === "manifest-invalid");
    expect(invalid?.level).toBe("refuse");
    expect(invalid?.pointer).toBe("/version");
    expect(invalid?.expected).toBeDefined();

    // GREEN: the same tree with a valid version passes the row.
    const fixed = makePlugin({});
    expect(refusalCodes(await checkPlugin({ dir: fixed }))).toEqual([]);
  });

  it("refuses a cross-field invariant with the schema's own message", async () => {
    const root = makePlugin({
      manifest: baseManifest({ activation: [] }) as Record<string, unknown>,
      rawManifest: `${JSON.stringify(
        { ...baseManifest(), entries: undefined, activation: [] },
        null,
        2,
      )}\n`,
    });
    const verdicts = await checkPlugin({ dir: root });
    const invalid = verdicts.filter((v) => v.code === "manifest-invalid");
    expect(invalid.map((v) => v.detail)).toContain("widgets require entries.renderer");
    expect(invalid[0]?.pointer).toBe("/entries");
  });

  it("takes the rows that need a manifest out of the run, and says so", async () => {
    const root = makePlugin({ rawManifest: "{}\n" });
    const verdicts = await checkPlugin({ dir: root });
    expect(verdicts.some((v) => v.level === "note" && v.check === "check")).toBe(true);
    expect(verdicts.some((v) => v.check === "schema")).toBe(false);
  });

  it("preserves stable behavior admission codes and exact pointers", async () => {
    const withSystems = baseManifest();
    withSystems["contributes"] = {
      ...(withSystems["contributes"] as Record<string, unknown>),
      systems: [{ id: `${FIXTURE_ID}.tick`, phase: "tick", budgetMs: 1, reason: "test" }],
    };
    const retired = makePlugin({ rawManifest: `${JSON.stringify(withSystems, null, 2)}\n` });
    const retiredVerdict = (await checkPlugin({ dir: retired })).find(
      (v) => v.code === "systems-contribution-superseded",
    );
    expect(retiredVerdict?.pointer).toBe("/contributes/systems");
    expect(retiredVerdict?.expected).toContain("contributes.behaviors");

    const withEphemeral = baseManifest({
      capabilities: ["canvas.write"],
      contributes: {
        ...(baseManifest()["contributes"] as Record<string, unknown>),
        behaviors: [
          {
            id: `${FIXTURE_ID}:presence`,
            definition: {
              store: "ephemeral",
              derived: false,
              deriveDuringGesture: false,
              version: 1,
              phase: "publish",
              tickWhile: "all",
              schema: [],
              reads: [],
              writes: [],
              migrationFrom: [],
              hooks: [],
            },
          },
        ],
      },
    });
    const ephemeral = makePlugin({ rawManifest: `${JSON.stringify(withEphemeral, null, 2)}\n` });
    const ephemeralVerdict = (await checkPlugin({ dir: ephemeral })).find(
      (v) => v.code === "behavior-store-unsupported",
    );
    expect(ephemeralVerdict?.pointer).toBe("/contributes/behaviors/0/definition/store");
    expect(ephemeralVerdict?.expected).toContain("runtime behavior");
  });
});

describe("check — manifest-stale (the freshness law)", () => {
  it("refuses a hand-edited canonical artifact, and passes the emitted one", async () => {
    const root = makePlugin({});
    const path = join(root, "vibefield.plugin.json");
    const committed = readFileSync(path, "utf8");

    // GREEN first: the emitted bytes are canonical.
    expect(refusalCodes(await checkPlugin({ dir: root }))).toEqual([]);

    // RED: same meaning, different bytes — an author "tidying" the file.
    writeFileSync(path, `${JSON.stringify(JSON.parse(committed))}\n`);
    const verdicts = await checkPlugin({ dir: root });
    const stale = verdicts.find((v) => v.code === "manifest-stale");
    expect(stale?.level).toBe("refuse");
    expect(stale?.detail).toContain("first difference at line");

    writeFileSync(path, committed);
    expect(refusalCodes(await checkPlugin({ dir: root }))).toEqual([]);
  });
});

describe("check — wall-violation (the control run)", () => {
  it("refuses a forbidden import with file:line, and passes the SDK door", async () => {
    const root = makePlugin({
      files: {
        "src/renderer.ts": [
          'import { defineRendererPlugin } from "@vibefield/plugin-sdk";',
          'import { app } from "electron";',
          "export default defineRendererPlugin({ activate() {} });",
        ].join("\n"),
      },
    });
    const verdicts = await checkPlugin({ dir: root });
    const violation = verdicts.find((v) => v.code === "wall-violation");
    expect(violation?.level).toBe("refuse");
    expect(violation?.pointer).toBe("src/renderer.ts:2");
    expect(violation?.expected).toContain("electron");

    // GREEN: the same file without the forbidden line.
    writeFileSync(
      join(root, "src", "renderer.ts"),
      'import { defineRendererPlugin } from "@vibefield/plugin-sdk";\nexport default defineRendererPlugin({ activate() {} });\n',
    );
    expect(refusalCodes(await checkPlugin({ dir: root }))).toEqual([]);
  });

  it("refuses a node builtin, and exempts scripts/ and test/", async () => {
    const root = makePlugin({
      files: {
        "src/renderer.ts": 'import { readFileSync } from "node:fs";\n',
        "scripts/emit-manifest.ts": 'import { readFileSync } from "node:fs";\n',
        "test/plugin.test.ts": 'import { PluginRegistry } from "@vibefield/plugin-runtime";\n',
      },
    });
    const walls = (await checkPlugin({ dir: root })).filter((v) => v.code === "wall-violation");
    expect(walls).toHaveLength(1);
    expect(walls[0]?.pointer).toBe("src/renderer.ts:1");
  });

  it("does not lint the built artifact, whose bare imports are the host's business", async () => {
    const root = makePlugin({
      files: {
        "dist/renderer.js": `import "@vibecook/ice";\n${rendererModule({})}`,
      },
    });
    const verdicts = await checkPlugin({ dir: root });
    expect(verdicts.filter((v) => v.code === "wall-violation")).toEqual([]);
  });
});

describe("check — schema-invalid", () => {
  it("refuses a declared settings schema that does not compile, and passes a good one", async () => {
    const settings = (schema: unknown): Record<string, unknown> =>
      baseManifest({
        capabilities: ["storage.self"],
        contributes: {
          ...(baseManifest()["contributes"] as Record<string, unknown>),
          settings: { properties: { pick: { title: "Pick", scope: "user", schema } } },
        },
      });

    const bad = makePlugin({ manifest: settings({ type: "not-a-json-schema-type" }) });
    const verdicts = await checkPlugin({ dir: bad });
    const refusal = verdicts.find((v) => v.code === "schema-invalid");
    expect(refusal?.level).toBe("refuse");
    expect(refusal?.pointer).toBe("/contributes/settings/properties/pick/schema");

    const good = makePlugin({ manifest: settings({ type: "string", maxLength: 8 }) });
    expect(refusalCodes(await checkPlugin({ dir: good }))).toEqual([]);
  });
});

describe("check — declaration ↔ binding", () => {
  it("refuses a binding the manifest never declared", async () => {
    const root = makePlugin({
      files: { "dist/renderer.js": rendererModule({ binds: [`${FIXTURE_ID}.other`] }) },
    });
    const verdicts = await checkPlugin({ dir: root });
    // The mock host enforces §12.1 at register time, so an undeclared bind
    // surfaces as a failed activation naming the type.
    const refusal = verdicts.find(
      (v) => v.code === "activation-failed" || v.code === "binding-undeclared",
    );
    expect(refusal?.level).toBe("refuse");
    expect(refusal?.detail).toContain(`${FIXTURE_ID}.other`);
  });

  it("refuses a declaration nothing binds", async () => {
    const root = makePlugin({
      manifest: baseManifest({
        activation: [`onWidget:${CARD}`],
        contributes: {
          widgets: [
            (baseManifest()["contributes"] as { widgets: unknown[] }).widgets[0],
            {
              type: `${FIXTURE_ID}.second`,
              title: "Second",
              schemaVersion: 1,
              surface: "dom",
              sizeMode: "fixed",
              defaultSize: { w: 10, h: 10 },
            },
          ],
        },
      }),
      files: { "dist/renderer.js": rendererModule({ binds: [CARD] }) },
    });
    const verdicts = await checkPlugin({ dir: root });
    const refusal = verdicts.find((v) => v.code === "binding-missing");
    expect(refusal?.level).toBe("refuse");
    expect(refusal?.detail).toContain(`${FIXTURE_ID}.second`);
  });

  it("refuses an activate that throws", async () => {
    const root = makePlugin({ files: { "dist/renderer.js": rendererModule({ throws: true }) } });
    const verdicts = await checkPlugin({ dir: root });
    expect(verdicts.find((v) => v.code === "activation-failed")?.detail).toContain(
      "fixture activate refused",
    );
  });

  it("refuses a module with no activate", async () => {
    const root = makePlugin({
      files: { "dist/renderer.js": rendererModule({ wrongShape: true }) },
    });
    expect(refusalCodes(await checkPlugin({ dir: root }))).toContain("module-shape-invalid");
  });

  it("refuses a deactivation that leaves a timer running, and passes one that clears it", async () => {
    const leaky = makePlugin({ files: { "dist/renderer.js": rendererModule({ leak: true }) } });
    const verdicts = await checkPlugin({ dir: leaky });
    const leak = verdicts.find((v) => v.code === "activation-leak");
    expect(leak?.level).toBe("refuse");
    expect(leak?.detail).toContain("Timeout");

    const clean = makePlugin({ files: { "dist/renderer.js": rendererModule({}) } });
    expect(refusalCodes(await checkPlugin({ dir: clean }))).toEqual([]);
  });
});

describe("check — artifacts", () => {
  it("refuses a half-built plugin, where one declared entry is missing", async () => {
    const root = makePlugin({
      manifest: baseManifest({
        entries: { renderer: "./dist/renderer.js", service: "./dist/service.js" },
      }),
      files: { "dist/renderer.js": rendererModule({}) },
    });
    const verdicts = await checkPlugin({ dir: root });
    const missing = verdicts.find((v) => v.code === "artifact-missing");
    expect(missing?.level).toBe("refuse");
    expect(missing?.pointer).toBe("/entries/service");
  });

  it("refuses an artifact importing a specifier the host import map cannot bind", async () => {
    const root = makePlugin({
      files: { "dist/renderer.js": `import "lodash";\n${rendererModule({})}` },
    });
    const verdicts = await checkPlugin({ dir: root });
    const refusal = verdicts.find((v) => v.code === "artifact-unmappable-specifier");
    expect(refusal?.level).toBe("refuse");
    expect(refusal?.detail).toContain("lodash");
  });

  it("accepts the singleton specifiers the map does bind", async () => {
    const root = makePlugin({
      files: {
        "dist/renderer.js": `import "@vibefield/plugin-sdk/ui";\nimport "react";\n${rendererModule({})}`,
      },
    });
    expect(refusalCodes(await checkPlugin({ dir: root }))).toEqual([]);
  });
});

describe("check — the directory itself", () => {
  it("separates the three ways a plugin directory can fail to be one", async () => {
    // Not a directory at all.
    const missingDir = await checkPlugin({ dir: "/definitely/not/a/plugin/dir" });
    expect(missingDir[0]?.code).toBe("plugin-dir-invalid");

    // A directory with no manifest — the verdict names how to emit one.
    const noManifest = await checkPlugin({ dir: freshDir() });
    expect(noManifest[0]?.code).toBe("manifest-missing");
    expect(noManifest[0]?.expected).toContain("gen:manifest");

    // A manifest that is not JSON at all is unreadable, not invalid: there is
    // no field to point at, and saying "invalid" would send an author looking
    // for one.
    const unreadable = await checkPlugin({ dir: makePlugin({ rawManifest: "" }) });
    expect(unreadable[0]?.code).toBe("manifest-unreadable");
  });
});
