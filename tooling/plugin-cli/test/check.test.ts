// The suite, proven the only way a check can be proven: each refusal class gets
// a tree that TRIPS it and a tree that does not, in the same test. A check that
// has never been seen to fail is a check nobody has tested.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OBJECTS_NEED_DESK } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { emittedSpecifiers } from "../src/artifact-check";
import { checkPlugin } from "../src/check";
import { REFUSAL_CATALOG } from "../src/refusals";
import {
  baseManifest,
  FIXTURE_COMMAND,
  FIXTURE_ID,
  FIXTURE_WGSL,
  freshDir,
  makePlugin,
  objectRendererModule,
  refusalCodes,
  rendererModule,
} from "./fixtures";

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
    expect(verdicts.map((v) => v.detail)).toContain("1 declared command(s) bound exactly");
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
    expect(invalid.map((v) => v.detail)).toContain("commands require entries.renderer");
    expect(invalid[0]?.pointer).toBe("/entries");
  });

  it("takes the rows that need a manifest out of the run, and says so", async () => {
    const root = makePlugin({ rawManifest: "{}\n" });
    const verdicts = await checkPlugin({ dir: root });
    expect(verdicts.some((v) => v.level === "note" && v.check === "check")).toBe(true);
    expect(verdicts.some((v) => v.check === "schema")).toBe(false);
  });

  it("refuses contributes.widgets BY NAME, pointing at contributes.objects (DK-8)", async () => {
    // a widget row the 0.11 build accepted, verbatim — the author is told where its rows went
    const withWidgets = baseManifest({
      contributes: {
        ...(baseManifest()["contributes"] as Record<string, unknown>),
        widgets: [
          {
            type: `${FIXTURE_ID}.card`,
            title: "Card",
            schemaVersion: 1,
            surface: "dom",
            sizeMode: "fixed",
            defaultSize: { w: 200, h: 120 },
          },
        ],
      },
    });
    const retired = makePlugin({ rawManifest: `${JSON.stringify(withWidgets, null, 2)}\n` });
    const verdicts = await checkPlugin({ dir: retired });
    const refusal = verdicts.find((v) => v.code === "widgets-contribution-retired");
    expect(refusal?.level).toBe("refuse");
    expect(refusal?.pointer).toBe("/contributes/widgets");
    expect(refusal?.detail).toContain("declare it under contributes.objects");
    expect(REFUSAL_CATALOG["widgets-contribution-retired"].guidance).toContain(
      "contributes.objects",
    );
    // never shrugged off as an unknown key
    expect(verdicts.some((v) => v.code === "manifest-unknown-key")).toBe(false);
  });

  it("refuses the onWidget: activation event BY NAME, pointing at onObject: — one verdict, no alias (DK-9)", async () => {
    const retired = makePlugin({
      rawManifest: `${JSON.stringify(
        baseManifest({ activation: [`onCommand:${FIXTURE_COMMAND}`, `onWidget:${FIXTURE_ID}`] }),
        null,
        2,
      )}\n`,
    });
    const verdicts = await checkPlugin({ dir: retired });
    const refusals = verdicts.filter((v) => v.level === "refuse" && v.check === "manifest");
    expect(refusals.map((v) => v.code)).toEqual(["onwidget-activation-retired"]);
    expect(refusals[0]?.pointer).toBe("/activation/1");
    expect(refusals[0]?.detail).toContain(`onObject:${FIXTURE_ID}`);
    expect(REFUSAL_CATALOG["onwidget-activation-retired"].guidance).toContain("onObject:<type>");
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
    const unattested = makePlugin({
      rawManifest: `${JSON.stringify(withEphemeral, null, 2)}\n`,
    });
    const unattestedVerdict = (await checkPlugin({ dir: unattested })).find(
      (v) =>
        v.code === "manifest-invalid" &&
        v.pointer === "/contributes/behaviors/0/definition/maxFacetBytes",
    );
    expect(unattestedVerdict?.detail).toContain("must attest");

    const behaviors = (withEphemeral["contributes"] as Record<string, unknown>)[
      "behaviors"
    ] as Array<Record<string, unknown>>;
    const definition = behaviors[0]?.["definition"] as Record<string, unknown>;
    definition["maxFacetBytes"] = 1_024;
    const bounded = makePlugin({
      rawManifest: `${JSON.stringify(withEphemeral, null, 2)}\n`,
    });
    const boundedVerdicts = await checkPlugin({ dir: bounded });
    expect(
      boundedVerdicts.some(
        (verdict) =>
          verdict.code === "behavior-store-unsupported" ||
          verdict.code === "behavior-presence-budget-exceeded",
      ),
    ).toBe(false);

    definition["maxFacetBytes"] = 24_321;
    behaviors.push({
      ...structuredClone(behaviors[0]!),
      id: `${FIXTURE_ID}:presence-two`,
    });
    const overBudget = makePlugin({
      rawManifest: `${JSON.stringify(withEphemeral, null, 2)}\n`,
    });
    const budgetVerdict = (await checkPlugin({ dir: overBudget })).find(
      (verdict) => verdict.code === "behavior-presence-budget-exceeded",
    );
    expect(budgetVerdict?.pointer).toBe("/contributes/behaviors");
    expect(budgetVerdict?.expected).toContain("reduce maxFacetBytes");
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
    // The mock host enforces §8.3 at register time, so an undeclared bind
    // surfaces as a failed activation naming the command.
    const refusal = verdicts.find(
      (v) => v.code === "activation-failed" || v.code === "binding-undeclared",
    );
    expect(refusal?.level).toBe("refuse");
    expect(refusal?.detail).toContain(`${FIXTURE_ID}.other`);
  });

  it("refuses a declaration nothing binds — a command the user can reach and nothing implements", async () => {
    // DK-8: the one exception this row carried — a WIDGET row, compiled faceless and so bound or
    // not — retired with `contributes.widgets`; every declaration left is held both ways
    const commandUnbound = makePlugin({
      files: { "dist/renderer.js": rendererModule({ binds: [] }) },
    });
    const refusal = (await checkPlugin({ dir: commandUnbound })).find(
      (v) => v.code === "binding-missing",
    );
    expect(refusal?.level).toBe("refuse");
    expect(refusal?.detail).toContain(`command ${FIXTURE_COMMAND}`);
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

// DK-2 (desk/landing): DK-0f's `objects-need-desk` activation row is FLIPPED OFF —
// the desk draws objects, so `check` passes an object plugin's manifest AND its
// activation like any plugin's. DK-6: each object row is held to the module's
// export — the host's reading, in Node, with no device (object-check.ts).
describe("check — object kinds on the desk build", () => {
  const CLOCK = `${FIXTURE_ID}.clock`;
  /** A pass that draws nothing, as fixture source. */
  const PASS = "({ spawn() { return this; }, prepare: () => 0, drawRange() {}, dispose() {} })";
  const objects = [
    {
      type: CLOCK,
      title: "Clock",
      schemaVersion: 1,
      size: { w: 160, h: 160 },
      provides: ["desk.object"],
      tray: {
        category: "things",
        label: "Clock",
        hang: { w: 110, h: 110, accessory: "hook", pegs: [[0, -0.5]] },
      },
      binding: { kind: "clock" },
    },
  ];
  const objectPlugin = (module: string) =>
    makePlugin({
      manifest: { activation: [`onObject:${CLOCK}`], contributes: { objects } },
      files: { "dist/renderer.js": module },
    });
  const activation = (verdicts: Awaited<ReturnType<typeof checkPlugin>>) =>
    verdicts.filter((v) => v.check === "activation");

  it("accepts the manifest and activates it — no objects-need-desk on any row", async () => {
    const verdicts = await checkPlugin({ dir: objectPlugin(objectRendererModule()) });

    expect(refusalCodes(verdicts)).toEqual([]);
    expect(verdicts.some((v) => v.code === OBJECTS_NEED_DESK.code)).toBe(false);
    expect(verdicts.filter((v) => v.check === "manifest").map((v) => v.level)).toEqual(
      expect.arrayContaining(["pass"]),
    );
    expect(activation(verdicts).map((v) => v.level)).toEqual(expect.arrayContaining(["pass"]));
  });

  it("activates objects standing beside a command — the command's binding rows run as before", async () => {
    const root = makePlugin({
      manifest: {
        activation: [`onObject:${CLOCK}`, `onCommand:${FIXTURE_COMMAND}`],
        contributes: { ...(baseManifest()["contributes"] as object), objects },
      },
      files: { "dist/renderer.js": objectRendererModule({ binds: [FIXTURE_COMMAND] }) },
    });
    const verdicts = await checkPlugin({ dir: root });
    expect(refusalCodes(verdicts)).toEqual([]);
    expect(verdicts.some((v) => v.code === OBJECTS_NEED_DESK.code)).toBe(false);
    // the ordinary activation rows ran (DK-0f's single refusing row is gone)
    expect(activation(verdicts).length).toBeGreaterThan(1);
  });

  it("DK-6 — holds binding.kind to a REAL export: a desk kind named by its type, and says how it hangs (DK-7: the harness's declaration row)", async () => {
    const verdicts = await checkPlugin({ dir: objectPlugin(objectRendererModule()) });
    expect(activation(verdicts).map((v) => v.detail)).toEqual(
      expect.arrayContaining([
        `${CLOCK}: \`clock\` is a desk kind named by its type, lying in the things; hangs on "things" by a hook (110 × 110); provides desk.object`,
        `${CLOCK}: its create made a pass that compiles no shader — a kind that draws nothing`,
      ]),
    );
  });

  it("DK-6 — refuses the three bindings the host refuses: no such export, no desk kind, a kind named otherwise", async () => {
    const missing = await checkPlugin({
      dir: objectPlugin(objectRendererModule({ exportName: "clocks" })),
    });
    expect(refusalCodes(missing)).toEqual(["object-export-missing"]);
    expect(missing.find((v) => v.code === "object-export-missing")?.pointer).toBe(
      "/contributes/objects/0/binding/kind",
    );
    const notKind = await checkPlugin({
      dir: objectPlugin(objectRendererModule({ notAKind: true })),
    });
    expect(refusalCodes(notKind)).toEqual(["object-kind-invalid"]);
    const misnamed = await checkPlugin({
      dir: objectPlugin(objectRendererModule({ kindName: "clock" })),
    });
    expect(refusalCodes(misnamed)).toEqual(["object-kind-misnamed"]);
    expect(misnamed.find((v) => v.code === "object-kind-misnamed")?.detail).toContain(
      `kind is named "clock"`,
    );
    // the harness's own `expected`, specific to the row, rides the refusal
    expect(misnamed.find((v) => v.code === "object-kind-misnamed")?.expected).toBe(
      `name the kind "${CLOCK}"`,
    );
  });

  it("DK-7 — refuses a row that does not provide desk.object, the key the desk places by", async () => {
    const root = makePlugin({
      manifest: {
        activation: [`onObject:${CLOCK}`],
        contributes: { objects: [{ ...objects[0], provides: [CLOCK] }] },
      },
      files: { "dist/renderer.js": objectRendererModule() },
    });
    const verdicts = await checkPlugin({ dir: root });
    expect(refusalCodes(verdicts)).toEqual(["object-provides-no-desk-object"]);
    expect(verdicts.find((v) => v.code === "object-provides-no-desk-object")?.pointer).toBe(
      "/contributes/objects/0/provides",
    );
  });

  it("DK-6 — its WGSL present as TEXT and READ (DK-7), with the compile it did NOT run named as a note", async () => {
    // the create reads a WebGPU constant first (as ICE's bindLayout does), then compiles its text
    const create = `async (device) => { const stage = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT; device.createBindGroupLayout({ entries: [{ binding: 0, visibility: stage, buffer: {} }] }); device.createShaderModule({ code: ${JSON.stringify(FIXTURE_WGSL)} }); return ${PASS}; }`;
    const verdicts = await checkPlugin({ dir: objectPlugin(objectRendererModule({ create })) });
    expect(refusalCodes(verdicts)).toEqual([]);
    expect(activation(verdicts).map((v) => v.detail)).toContain(
      `${CLOCK}: its WGSL arrived as text and reads: ${FIXTURE_WGSL.length} characters, vertex vs + fragment fs; 0 pipeline(s) whose stages statically use 0 binding(s), each laid in its layout; 0 bind group(s) filling their layouts`,
    );
    // DK-6's open question 1, said plainly: the row is presence and a READ — never a compile
    const gap = verdicts.find((v) => v.code === "object-wgsl-not-compiled");
    expect(gap?.level).toBe("note");
    expect(gap?.detail).toContain("never compiled");
    expect(gap?.expected).toContain("I30");
    // the constants were the row's, lent for the create and taken back
    expect((globalThis as Record<string, unknown>)["GPUShaderStage"]).toBeUndefined();
  });

  it("DK-6 — refuses a shader whose code is not text, and a create that throws; notes a create that reaches for a browser global (DK-7)", async () => {
    const notText = await checkPlugin({
      dir: objectPlugin(
        objectRendererModule({
          create: `async (device) => { device.createShaderModule({ code: 42 }); return ${PASS}; }`,
        }),
      ),
    });
    expect(refusalCodes(notText)).toEqual(["object-wgsl-not-text"]);
    const throws = await checkPlugin({
      dir: objectPlugin(
        objectRendererModule({
          create: 'async () => { throw new Error("wants a real adapter"); }',
        }),
      ),
    });
    expect(refusalCodes(throws)).toEqual(["object-create-failed"]);
    expect(throws.find((v) => v.code === "object-create-failed")?.detail).toContain(
      "wants a real adapter",
    );
    const browser = await checkPlugin({
      dir: objectPlugin(objectRendererModule({ create: "async () => new OffscreenCanvas(1, 1)" })),
    });
    expect(refusalCodes(browser)).toEqual([]);
    const noted = browser.find((v) => v.code === "object-create-not-run-here");
    expect(noted?.level).toBe("note");
    expect(noted?.detail).toContain("OffscreenCanvas is not defined");
  });

  it("DK-7 — every code the object rows can say is in the catalog, at the level it is said", () => {
    for (const [code, level] of [
      ["object-tray-hang-missing", "refuse"],
      ["object-tray-category-invalid", "refuse"],
      ["object-provides-no-desk-object", "refuse"],
      ["object-create-failed", "refuse"],
      ["object-kit-piece-unknown", "refuse"],
      ["object-wgsl-unread", "refuse"],
      ["object-wgsl-binding-unlaid", "refuse"],
      ["object-bind-group-mismatch", "refuse"],
      ["object-dispose-failed", "refuse"],
      ["object-wgsl-not-compiled", "note"],
      ["object-create-not-run-here", "note"],
    ] as const)
      expect(REFUSAL_CATALOG[code].level, code).toBe(level);
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

  it("DK-6 — reads no import out of prose the bundle carries: a backticked word after `from` is none", async () => {
    // the browser plugin's bundle carries the contracts' comments, six of which read "… from `x`" —
    // each was refused as an unmappable specifier until the artifact matcher took string literals only
    const prose =
      "/** the family VibeField computes from `git_repo` (DS-D9), a claim apart from `alive` */\n";
    const root = makePlugin({ files: { "dist/renderer.js": `${prose}${rendererModule({})}` } });
    expect(refusalCodes(await checkPlugin({ dir: root }))).toEqual([]);
    expect(
      emittedSpecifiers(`${prose}import "react";\nconst m = import(\`./chunk.js\`);\n`),
    ).toEqual(["./chunk.js", "react"]);
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
