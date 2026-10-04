// @vitest-environment node
// THE KIND-CONFORMANCE HARNESS (DK-7; `@vibefield/plugin-sdk/testing`): an object's code half against
// its durable half with NO device and NO DOM — (a) the declaration the host reads, (b) the program on a
// recording device (its WGSL READ, never compiled), (c) every declared state driven, then dispose; the
// report `{ states, verdicts }`. Each verdict is earned by a fixture broken exactly that way
// (fixtures/disc-kind.ts); the unbroken disc — the create-plugin template's kind — passes.
import { FIT, lod, objectKindOf, ZOOM_MAX, ZOOM_MIN } from "@vibecook/ice/desk";
import { DESK_OBJECTS } from "@vibecook/ice/desk/objects";
import { describe, expect, it } from "vitest";
import {
  bindingsUsedBy,
  checkKindDeclaration,
  checkKindProgram,
  DESK_ZOOMS,
  type KindConformanceInput,
  type KindReport,
  type KindVerdict,
  kindPlan,
  readWgsl,
  runKindConformance,
} from "../src/testing";
import { containable, DISC_TYPE, type DiscBreak, discKind, discRow } from "./fixtures/disc-kind";

const run = (
  how: DiscBreak | null,
  extra: Partial<KindConformanceInput> = {},
): Promise<KindReport> =>
  runKindConformance({
    binding: how === null ? undefined : { kind: discKind(how) },
    row: discRow(),
    at: "/contributes/objects/0",
    createBudgetMs: 200,
    ...extra,
  });

const refusals = (r: { readonly verdicts: readonly KindVerdict[] } | readonly KindVerdict[]) =>
  ("verdicts" in r ? r.verdicts : r).filter((v) => v.status === "refused").map((v) => v.code);
const notes = (r: KindReport) => r.verdicts.filter((v) => v.status === "note").map((v) => v.code);
const refusal = (r: KindReport, code: string) => r.verdicts.find((v) => v.code === code);

describe("the unbroken disc — the create-plugin template's kind — passes", () => {
  it("its declaration, its program (READ, the compile named as the gap), every state, its dispose", async () => {
    const r = await run({});
    expect(refusals(r)).toEqual([]);
    expect(notes(r)).toEqual(["object-wgsl-not-compiled"]);
    expect(r.verdicts.map((v) => [v.status, v.subject])).toEqual([
      ["pass", "declaration"],
      ["pass", "program"],
      ["note", "program"],
      ["pass", "default"],
    ]);
    expect(r.verdicts[1]?.detail).toMatch(
      /arrived as text and reads: \d+ characters, vertex vs \+ fragment fs; 1 pipeline\(s\) whose stages statically use 3 binding\(s\), each laid in its layout; 1 bind group\(s\)/,
    );
    // idle, selected, held at every zoom, and once at rest by night
    expect(r.states).toBe(3 * r.plan.zooms.length + 1);
    expect(r.verdicts[3]?.detail).toContain(
      "through resolve · record · hit · frame · prepare · drawRange",
    );
  });

  it("its states are the count it DROVE: fixtures × (modes × zooms + 1) — opening and containment add a mode each", async () => {
    const both = await run(
      { chip: "good", opens: true },
      { row: discRow(containable()), states: { default: {}, coral: { color: "#e8765c" } } },
    );
    expect(refusals(both)).toEqual([]);
    expect(both.plan.modes).toEqual(["idle", "selected", "held", "open", "contained"]);
    expect(both.plan.fixtures).toEqual(["default", "coral"]);
    expect(both.states).toBe(2 * (5 * both.plan.zooms.length + 1));
    expect(both.verdicts.at(-1)?.detail).toContain("chip · the opening · prepare · drawRange");
  });

  it("it is driven at the zooms the desk's LOD names — a band of its decade lattice each, its ends, the arrival band — and its hang", () => {
    const bands = new Set(
      DESK_ZOOMS.map((zoom) => lod({ camX: 0, camY: 0, zoom, width: 1, height: 1 }).k0),
    );
    for (
      let k0 = lod({ camX: 0, camY: 0, zoom: ZOOM_MAX, width: 1, height: 1 }).k0;
      k0 <= lod({ camX: 0, camY: 0, zoom: ZOOM_MIN, width: 1, height: 1 }).k0;
      k0 += 1
    )
      expect(bands.has(k0), `the band k0 = ${k0}`).toBe(true);
    expect(DESK_ZOOMS).toEqual(
      expect.arrayContaining([ZOOM_MIN, ZOOM_MAX, FIT.minZoom, FIT.maxZoom]),
    );
    // the hang: a 96 × 96 specimen of a 120 × 120 object
    const plan = kindPlan(discRow(), { opens: false, fixtures: ["default"] });
    expect(plan.zooms).toContain(0.8);
    expect(plan.zooms).toHaveLength(DESK_ZOOMS.length + 1);
  });

  it("the declaration alone — `check`'s activation row — says how it hangs and what it provides", () => {
    const [v] = checkKindDeclaration({ kind: discKind() }, discRow(), "/contributes/objects/0");
    expect(v).toMatchObject({ status: "pass", subject: "declaration" });
    expect(v?.detail).toBe(
      `\`Disc\` is a desk kind named by its type, lying in the things; hangs on "things" by a hook (96 × 96); provides ${DISC_TYPE} + desk.object`,
    );
  });
});

describe("(a) the declaration — each refusal earned by a fixture broken that way", () => {
  it("object-export-missing: the renderer module exports nothing under the row's binding.kind", async () => {
    const r = await run(null);
    expect(refusals(r)).toEqual(["object-export-missing"]);
    expect(refusal(r, "object-export-missing")?.pointer).toBe(
      "/contributes/objects/0/binding/kind",
    );
    expect(r.states).toBe(0);
  });

  it("object-kind-invalid: the export holds something that is not a desk kind (or lies in no stratum the ground draws)", async () => {
    const notAKind = await runKindConformance({
      binding: { kind: { name: DISC_TYPE } },
      row: discRow(),
    });
    expect(refusals(notAKind)).toEqual(["object-kind-invalid"]);
    expect(refusal(notAKind, "object-kind-invalid")?.detail).toContain(
      "stratum, create, resolve, record, hit, reach",
    );
    const nowhere = await runKindConformance({
      binding: { kind: { ...discKind(), stratum: "ceiling" } },
      row: discRow(),
    });
    expect(refusals(nowhere)).toEqual(["object-kind-invalid"]);
  });

  it("object-kind-misnamed: a WRONG NAME — the kind's registry name is not the row's type", async () => {
    const r = await run({ name: "vendor.fixture.circle" });
    expect(refusals(r)).toEqual(["object-kind-misnamed"]);
    expect(refusal(r, "object-kind-misnamed")?.expected).toBe(`name the kind "${DISC_TYPE}"`);
  });

  it("object-tray-hang-missing: a MISSING HANG — the tray entry says nothing of how its specimen hangs", async () => {
    const row = discRow({ tray: { category: "things", label: "Disc" } as never });
    const r = await run({}, { row });
    expect(refusals(r)).toEqual(["object-tray-hang-missing"]);
    expect(refusal(r, "object-tray-hang-missing")?.pointer).toBe(
      "/contributes/objects/0/tray/hang",
    );
    // a hang that is no size, on no accessory the pegboard has, on no pegs — each its own detail
    for (const hang of [
      { w: 0, h: 96, accessory: "hook", pegs: [[0, 0]] },
      { w: 96, h: 96, accessory: "nail", pegs: [[0, 0]] },
      { w: 96, h: 96, accessory: "hook", pegs: [] },
    ])
      expect(
        refusals(
          await run(
            {},
            { row: discRow({ tray: { category: "things", label: "Disc", hang } as never }) },
          ),
        ),
      ).toEqual(["object-tray-hang-missing"]);
  });

  it("object-tray-category-invalid: a category past the pegboard's 64 characters", async () => {
    const row = discRow({
      tray: {
        category: "x".repeat(65),
        label: "Disc",
        hang: { w: 96, h: 96, accessory: "hook", pegs: [[0, -0.5]] },
      } as never,
    });
    expect(refusals(await run({}, { row }))).toEqual(["object-tray-category-invalid"]);
  });

  it("object-provides-no-desk-object: a row that does not provide desk.object, which the desk places by", async () => {
    const r = await run({}, { row: discRow({ provides: [DISC_TYPE] }) });
    expect(refusals(r)).toEqual(["object-provides-no-desk-object"]);
    expect(refusal(r, "object-provides-no-desk-object")?.pointer).toBe(
      "/contributes/objects/0/provides",
    );
  });
});

describe("(b) the program on a recording device — each refusal earned", () => {
  it("object-create-failed: a create that rejects, or resolves no pass", async () => {
    expect(refusals(await run({ create: "throws" }))).toEqual(["object-create-failed"]);
    expect(refusals(await run({ create: "no-pass" }))).toEqual(["object-create-failed"]);
  });

  it("object-create-not-run-here (a NOTE): a create that never settles on a device with no GPU — the states are driven without its pass", async () => {
    const r = await run({ create: "never" });
    expect(refusals(r)).toEqual([]);
    expect(notes(r)).toEqual(["object-create-not-run-here"]);
    expect(r.verdicts.at(-1)?.detail).toContain("through resolve · record · hit · frame");
    expect(r.verdicts.at(-1)?.detail).not.toContain("prepare");
  });

  it("object-create-not-run-here (a NOTE): a create that reaches for a browser global Node does not define — the harness's ceiling, never the kind's fault", async () => {
    const r = await run({ create: "browser" });
    expect(refusals(r)).toEqual([]);
    expect(notes(r)).toEqual(["object-create-not-run-here"]);
    expect(r.verdicts.find((v) => v.status === "note")?.detail).toContain(
      "OffscreenCanvas is not defined",
    );
  });

  it("object-kit-piece-unknown: a pass naming a kit piece that does not exist", async () => {
    const r = await run({ pieces: ["view", "portal", "light", "lens"] });
    expect(refusals(r)).toEqual(["object-kit-piece-unknown"]);
    expect(refusal(r, "object-kit-piece-unknown")?.detail).toContain('the kit piece "lens"');
  });

  it("object-wgsl-not-text: a shader module whose code never arrived as text", async () => {
    const r = await run({ code: { default: "@vertex fn vs() {}" } });
    expect(refusals(r)).toContain("object-wgsl-not-text");
    expect(refusal(r, "object-wgsl-not-text")?.detail).toContain(
      "code that is object, not WGSL text",
    );
  });

  it("object-wgsl-unread: a WGSL that does not read — its pipeline names an entry point the module never declares", async () => {
    const r = await run({ fragment: "fs_main" });
    expect(refusals(r)).toEqual(["object-wgsl-unread"]);
    expect(refusal(r, "object-wgsl-unread")?.detail).toContain(
      'names the fragment entry point "fs_main", which "vendor.fixture/disc.wgsl" does not declare (it declares: vertex vs, fragment fs)',
    );
  });

  it("object-wgsl-binding-unlaid: a binding the WGSL uses that its pipeline's layout does not carry", async () => {
    const r = await run({ layoutDropsOrder: true });
    expect(refusals(r)).toEqual(["object-wgsl-binding-unlaid", "object-bind-group-mismatch"]);
    expect(refusal(r, "object-wgsl-binding-unlaid")?.detail).toContain(
      "uses `order` at @group(0) @binding(2), which its layout does not carry",
    );
  });

  it("object-bind-group-mismatch: a bind group that fills a storage binding with a uniform buffer", async () => {
    const r = await run({ groupMisfilled: true });
    expect(refusals(r)).toEqual(["object-bind-group-mismatch"]);
    expect(refusal(r, "object-bind-group-mismatch")?.detail).toContain(
      "fills read-only-storage binding 1 with a buffer not made for STORAGE use",
    );
  });

  it("object-dispose-failed: a pass whose dispose throws", async () => {
    const r = await run({ disposeThrows: true });
    expect(refusals(r)).toEqual(["object-dispose-failed"]);
    expect(
      (await checkKindProgram({ kind: discKind({ disposeThrows: true }) })).map((v) => v.code),
    ).toContain("object-dispose-failed");
  });
});

describe("(c) the states driven — each refusal earned", () => {
  it("state-invalid: a fixture whose props the row never declared, or of the wrong kind — refused before anything draws it", async () => {
    const r = await run(
      {},
      { states: { typo: { colour: "#ffffff" }, wrong: { color: 7 }, fine: { color: "#ffffff" } } },
    );
    expect(refusals(r)).toEqual(["state-invalid", "state-invalid"]);
    expect(
      r.verdicts.filter((v) => v.code === "state-invalid").map((v) => [v.subject, v.pointer]),
    ).toEqual([
      ["typo", `/${DISC_TYPE}/typo/colour`],
      ["wrong", `/${DISC_TYPE}/wrong/color`],
    ]);
    expect(r.plan.fixtures).toEqual(["fine"]);
  });

  it("state-spawn-failed: a world half that throws — said once, at the first state, with how many more", async () => {
    const r = await run({ recordThrows: true });
    expect(refusals(r)).toEqual(["state-spawn-failed"]);
    expect(refusal(r, "state-spawn-failed")?.detail).toMatch(
      new RegExp(
        `^default/idle@1e-8: its record threw: the disc's record throws on purpose \\(and at ${r.states - 1} more of its ${r.states} states\\)$`,
      ),
    );
  });

  it("state-spawn-failed: a chip that answers no colour", async () => {
    const r = await run({ chip: "bad" }, { row: discRow(containable()) });
    expect(refusals(r)).toEqual(["state-spawn-failed"]);
    expect(refusal(r, "state-spawn-failed")?.detail).toContain(
      "its chip threw: answered colour [null,0,0] — an RGB triple",
    );
  });

  it("state-hit-missed: a hit that never hits its own box", async () => {
    const r = await run({ hitNever: true });
    expect(refusals(r)).toEqual(["state-hit-missed"]);
    expect(refusal(r, "state-hit-missed")?.detail).toContain(
      "its hit missed every one of 26 points across its own 120 × 120 box",
    );
  });

  it("state-render-failed: a pass whose prepare throws", async () => {
    const r = await run({ prepareThrows: true });
    expect(refusals(r)).toEqual(["state-render-failed"]);
    expect(refusal(r, "state-render-failed")?.detail).toContain(
      "its prepare threw: the disc's prepare throws on purpose",
    );
  });

  it("state-draw-ill-formed: a draw with no bind group at an index its pipeline's layout carries", async () => {
    const r = await run({ drawsUngrouped: true });
    expect(refusals(r)).toEqual(["state-draw-ill-formed"]);
    expect(refusal(r, "state-draw-ill-formed")?.detail).toContain(
      'a draw with the pipeline "vendor.fixture/discs" and no bind group at index 0',
    );
  });

  it("`only` drives one fixture", async () => {
    const r = await run(
      {},
      { states: { default: {}, coral: { color: "#e8765c" } }, only: "coral" },
    );
    expect(r.plan.fixtures).toEqual(["coral"]);
    expect(r.states).toBe(3 * r.plan.zooms.length + 1);
  });
});

describe("the WGSL, READ the way ICE's device-ratio unit reads it — no compiler", () => {
  const MODULE = `
    // @group(0) @binding(9) var<uniform> commented_out: f32;
    @group(0) @binding(0) var<uniform> u: View;
    @group(0) @binding(1) var tex: texture_2d<f32>;
    @group(0) @binding(2) var samp: sampler;
    @group(1) @binding(0) var<storage, read_write> out: array<f32>;
    override GAIN: f32 = 1.0;
    @id(7) override BIAS: f32 = 0.0;
    fn shade(p: vec2f) -> vec4f { return textureSample(tex, samp, p); }
    @vertex fn vs_depth(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return u.m * vec4f(f32(i)); }
    @fragment fn fs(@location(0) p: vec2f) -> @location(0) vec4f { return shade(p) * GAIN; }
    @compute @workgroup_size(64) fn cs(@builtin(global_invocation_id) id: vec3u) { out[id.x] = BIAS; }
  `;

  it("reads its entry points, its bindings (a commented one is none) and its overrides — by name and by id", () => {
    const read = readWgsl(MODULE);
    expect(read.entryPoints).toEqual([
      { stage: "vertex", name: "vs_depth" },
      { stage: "fragment", name: "fs" },
      { stage: "compute", name: "cs" },
    ]);
    expect(read.bindings.map((b) => [b.group, b.binding, b.name, b.resource])).toEqual([
      [0, 0, "u", "uniform"],
      [0, 1, "tex", "texture"],
      [0, 2, "samp", "sampler"],
      [1, 0, "out", "storage"],
    ]);
    expect([...read.overrides].sort()).toEqual(["7", "BIAS", "GAIN"]);
  });

  it("a stage's STATIC USE is what its entry point reaches, through the functions it calls — never the whole module's", () => {
    const read = readWgsl(MODULE);
    expect(bindingsUsedBy(read, "vs_depth").map((b) => b.name)).toEqual(["u"]);
    expect(bindingsUsedBy(read, "fs").map((b) => b.name)).toEqual(["tex", "samp"]);
    expect(bindingsUsedBy(read, "cs").map((b) => b.name)).toEqual(["out"]);
  });

  it("FIDELITY: the recording device holds ICE's six reference kinds' programs as the product's device does — none refused", async () => {
    // A device that refused a kind the desk draws every day would be lying about plugin kinds too. The six
    // are the most demanding kinds there are: five pipelines and a depth-only stage (the notebook), seven
    // pipelines over one module (the board, the calendar), two bind groups (the photo).
    for (const type of DESK_OBJECTS) {
      const verdicts = await checkKindProgram({ kind: objectKindOf(type) });
      expect(refusals(verdicts), type.type).toEqual([]);
      expect(
        verdicts.map((v) => v.code),
        type.type,
      ).toEqual(["ok", "object-wgsl-not-compiled"]);
    }
  });
});

describe("the WebGPU constants Node lacks", () => {
  it("are installed for a run and taken away after it", async () => {
    const scope = globalThis as Record<string, unknown>;
    expect(scope.GPUShaderStage).toBeUndefined();
    await run({});
    expect(scope.GPUShaderStage).toBeUndefined();
    expect(scope.GPUBufferUsage).toBeUndefined();
  });
});
