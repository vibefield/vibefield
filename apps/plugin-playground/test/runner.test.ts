// The runner against real plugins and against controls, driven through the SAME
// loader the bin uses — `createHarness` + `load(src/run.ts)`, not a vitest import
// of run.ts. Loading the runner any other way would test a different React, a
// different ICE catalog, and a different transform than the one that ships.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, installDom } from "../src/boot";
import type { KindRow, ObjectVerdict, RunOptions, RunResult, Verdict } from "../src/index";
import { RETIRED_CODES } from "../src/verdict";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
const REPO = resolve(PACKAGE_ROOT, "..", "..");
const FIXTURES = join(HERE, "fixtures");

let harness: Harness;
let run: (options: RunOptions) => Promise<RunResult>;
/** Every result this file ran — the retired codes are held to none of them. */
const ran: RunResult[] = [];
/** Scaffolds of the create-plugin template, made as an author makes one (its bin, a temp dir):
 * `demo` as scaffolded, `empty` with a states file that declares its kind with no states, and `bare` with
 * NOTHING installed — the plugin outside any workspace the ten-minute bar's agents held (DK-10). */
let scaffold:
  | { readonly root: string; readonly dir: string; readonly empty: string; readonly bare: string }
  | undefined;

/** The create-plugin bin into `root/<name>`, its three workspace dependencies linked as an install
 * links them (unless `installed` is false) — so the playground judges exactly the files an author is
 * handed, never a copy kept here. */
async function scaffoldTemplate(root: string, name: string, installed = true): Promise<string> {
  const dir = join(root, name);
  await promisify(execFile)(process.execPath, [
    join(REPO, "tooling", "create-plugin", "bin", "create-plugin.mjs"),
    "--id",
    `vendor.${name}`,
    "--title",
    name === "demo" ? "Demo" : name,
    "--dir",
    dir,
  ]);
  if (!installed) return dir;
  mkdirSync(join(dir, "node_modules", "@vibefield"), { recursive: true });
  for (const [name, path] of [
    ["plugin-sdk", "packages/plugin-sdk"],
    ["contracts", "packages/contracts"],
    ["plugin-build", "tooling/plugin-build"],
  ] as const)
    symlinkSync(join(REPO, path), join(dir, "node_modules", "@vibefield", name), "dir");
  return dir;
}

beforeAll(async () => {
  await installDom();
  const root = mkdtempSync(join(tmpdir(), "dk-7-template-"));
  const empty = await scaffoldTemplate(root, "empty");
  writeFileSync(join(empty, "playground", "states.ts"), 'export default { "vendor.empty": {} };\n');
  scaffold = {
    root,
    dir: await scaffoldTemplate(root, "demo"),
    empty,
    bare: await scaffoldTemplate(root, "bare", false),
  };
  harness = await createHarness([FIXTURES, scaffold.root]);
  const mod = await harness.load(join(PACKAGE_ROOT, "src", "run.ts"));
  const runPlayground = mod.runPlayground as typeof run;
  run = async (options) => {
    const result = await runPlayground(options);
    ran.push(result);
    return result;
  };
}, 180_000);

afterAll(async () => {
  await harness?.close();
  if (scaffold !== undefined) rmSync(scaffold.root, { recursive: true, force: true });
});

const objectRows = (r: RunResult): ObjectVerdict[] =>
  r.verdicts.filter((v): v is ObjectVerdict => v.kind === "object");
const kindRows = (r: RunResult, type?: string): KindRow[] =>
  r.verdicts.filter(
    (v): v is KindRow => v.kind === "kind" && (type === undefined || v.type === type),
  );

// DK-3 (desk/landing; the slice's estate, DK-2's failure list row 16, class A): this file's
// DOM-MOUNT rows are RETIRED — every repo plugin's widget states, widgetlab's `skipped-gl`, the
// throwing / invalid / unbound controls and both `--state` rows. The runner's verdict for a widget
// state was "its React face mounts in happy-dom", and a widget binds no face since DK-2 (the desk
// draws object KINDS). DK-7 (the playground v2): the kind-conformance harness judges every object
// kind — the repo's clock and carrier, the create-plugin template as scaffolded, and a fixture of
// kinds broken one way each — and its rows stand here in their place.
describe("the repo's own plugins", () => {
  // The subject was `vibefield.browser` until DT-3 gave it a canvas card, which
  // is the whole reason this row names its plugin rather than taking whichever
  // one happens to declare nothing: the empty pass has to be witnessed by a
  // plugin that is deliberately kind-less, and `kv-service` is the repo's —
  // service-only, staging no renderer module at all.
  it("a plugin with no object kinds is an honest empty pass", async () => {
    const result = await run({
      pluginDir: join(REPO, "examples", "plugins", "kv-service"),
      loader: harness,
    });
    expect(result.summary).toMatchObject({
      plugin: "vibefield.example.kv",
      objects: 0,
      states: 0,
      refused: 0,
      exit: 0,
    });
    expect(result.verdicts).toEqual([]);
    // DK-8: the summary counts kinds and their states alone — its widget count retired with
    // `contributes.widgets`
    expect(result.summary).not.toHaveProperty("widgets");
  });
});

describe("an object kind's WGSL (DK-6)", () => {
  // The example plugin ships its shaders as `.wgsl` files (plugin-build inlines them as text); the
  // harness loads its renderer from SOURCE, so it must load them the same way — or every object
  // plugin, the scaffold's own included, is refused `renderer-import-failed` before its kind is read.
  it("loads the example clock, whose kind's WGSL is two .wgsl files, and judges its object", async () => {
    const result = await run({
      pluginDir: join(REPO, "examples", "plugins", "desk-clock"),
      loader: harness,
    });
    expect(result.summary).toMatchObject({
      plugin: "vibefield.example.desk-clock",
      objects: 1,
      refused: 0,
      exit: 0,
    });
    expect(result.verdicts).toContainEqual(
      expect.objectContaining({
        kind: "object",
        type: "vibefield.example.desk-clock",
        binding: "clock",
        refusal: null,
      }),
    );
  });
});

describe("the playground v2: the kind-conformance harness over the repo's kinds (DK-7)", () => {
  it("passes the EXAMPLE CLOCK — every declared state driven: idle, selected, held, open, contained at every zoom", async () => {
    const result = await run({
      pluginDir: join(REPO, "examples", "plugins", "desk-clock"),
      loader: harness,
    });
    const [clock] = objectRows(result);
    // one fixture (no states file: `default`), five modes (it opens; it provides desk.containable),
    // 21 zooms (the LOD's 20 and its hang), and once at rest by night
    expect(clock).toMatchObject({ states: 5 * 21 + 1, refusal: null });
    expect(kindRows(result).map((v) => [v.subject, v.status, v.code])).toEqual([
      ["declaration", "pass", "ok"],
      ["program", "pass", "ok"],
      ["program", "note", "object-wgsl-not-compiled"],
      ["default", "pass", "ok"],
    ]);
    expect(kindRows(result)[3]?.detail).toContain("chip · the opening · prepare · drawRange");
    expect(result.summary).toMatchObject({
      states: 106,
      passed: 3,
      skipped: 1,
      refused: 0,
      exit: 0,
    });
  });

  it("passes the CONFORMANCE CARRIER — a kind whose pass draws nothing", async () => {
    const result = await run({
      pluginDir: join(REPO, "examples", "plugins", "behavior-conformance"),
      loader: harness,
    });
    expect(objectRows(result)).toEqual([
      expect.objectContaining({ type: "vibefield.behavior-conformance.card", refusal: null }),
    ]);
    expect(kindRows(result).map((v) => v.status)).not.toContain("refused");
    expect(kindRows(result)[1]?.detail).toBe(
      "its create made a pass that compiles no shader — a kind that draws nothing",
    );
    expect(result.summary.exit).toBe(0);
  });

  it("passes the CREATE-PLUGIN TEMPLATE, scaffolded as an author scaffolds it — both of its playground states, every mode, every zoom", async () => {
    const result = await run({ pluginDir: scaffold?.dir as string, loader: harness });
    const [disc] = objectRows(result);
    // three fixtures (default, coral, and a colour `rgb` cannot parse — DK-10: drawn as the default, never a strike)
    // × (idle, selected, held × 21 zooms + at rest by night)
    expect(disc).toMatchObject({
      type: "vendor.demo",
      binding: "Demo",
      states: 3 * (3 * 21 + 1),
      refusal: null,
    });
    expect(kindRows(result).map((v) => [v.subject, v.status])).toEqual([
      ["declaration", "pass"],
      ["program", "pass"],
      ["program", "note"],
      ["default", "pass"],
      ["coral", "pass"],
      ["unparsed", "pass"],
    ]);
    expect(result.summary.exit).toBe(0);
  });

  // DK-10 — the bar's first wall: a plugin outside any workspace has no node_modules, so its source's
  // `@vibefield/plugin-sdk` resolved to nothing and EVERY such plugin — the untouched scaffold included — was
  // refused `renderer-import-failed` before its kind was read. The loader binds the host's singletons to the
  // kit's own copies for an importer outside the workspace (boot.ts `hostSingletons`), as the host's import map does.
  it("passes the template scaffolded OUTSIDE any workspace with NOTHING installed — the host's specifiers bound to the kit's copies", async () => {
    const result = await run({ pluginDir: scaffold?.bare as string, loader: harness });
    expect(objectRows(result)).toEqual([
      expect.objectContaining({ type: "vendor.bare", states: 3 * (3 * 21 + 1), refusal: null }),
    ]);
    expect(result.summary.exit).toBe(0);
  });

  it("fails each BROKEN kind with its OWN verdict, beside a whole one that passes", async () => {
    const result = await run({ pluginDir: join(FIXTURES, "broken-kinds"), loader: harness });
    const refusalOf = Object.fromEntries(
      objectRows(result).map((v) => [v.type.split(".").at(-1), v.refusal]),
    );
    expect(refusalOf).toEqual({
      whole: null,
      misnamed: "object-kind-misnamed",
      "no-export": "object-export-missing",
      "unknown-piece": "object-kit-piece-unknown",
      unread: "object-wgsl-unread",
      "missing-hit": "state-hit-missed",
      throws: "state-spawn-failed",
      render: "state-render-failed",
    });
    // each kind is refused ONCE, by its own code — no row of one kind is another's
    for (const v of objectRows(result))
      expect(
        kindRows(result, v.type)
          .filter((k) => k.status === "refused")
          .map((k) => k.code),
      ).toEqual(v.refusal === null ? [] : [v.refusal]);
    expect(result.summary).toMatchObject({ objects: 8, refused: 7, exit: 1 });
  });

  it("`--state <type>:<name>` drives one kind's one fixture", async () => {
    const result = await run({
      pluginDir: scaffold?.dir as string,
      loader: harness,
      only: "vendor.demo:coral",
    });
    expect(objectRows(result)).toEqual([expect.objectContaining({ states: 3 * 21 + 1 })]);
    expect(kindRows(result).map((v) => v.subject)).toEqual([
      "declaration",
      "program",
      "program",
      "coral",
    ]);
    // …and no other kind: the type half filters the broken fixture down to its whole one
    const one = await run({
      pluginDir: join(FIXTURES, "broken-kinds"),
      loader: harness,
      only: "vibefield.fixture-broken-kinds.whole",
    });
    expect(objectRows(one).map((v) => v.type)).toEqual(["vibefield.fixture-broken-kinds.whole"]);
    expect(one.summary.exit).toBe(0);
  });

  it("a states file that declares a kind with NO states is refused `states-empty`, never passed with zero", async () => {
    const result = await run({ pluginDir: scaffold?.empty as string, loader: harness });
    expect(result.verdicts).toEqual([
      expect.objectContaining({
        kind: "type",
        type: "vendor.empty",
        code: "states-empty",
        pointer: "/vendor.empty",
      }),
    ]);
    expect(result.summary.exit).toBe(1);
  });

  it("never emits a RETIRED code (`widget-unbound`, `skipped-gl`, `widget-unbuildable`) — in any run this file made", () => {
    expect(ran.length).toBeGreaterThan(0);
    const codes = ran.flatMap((r) =>
      r.verdicts.map((v: Verdict) => ("code" in v ? v.code : undefined)),
    );
    for (const retired of RETIRED_CODES) expect(codes).not.toContain(retired);
  });
});

describe("the DOM it installs", () => {
  // DK-5: the repo's SHARED happy-dom shim (tooling/test-env) on the playground's own
  // window, applied before its classes are bound onto globalThis — an observer here
  // survives a garbage collection. The forced-GC witness runs once, in test-env.
  it("observes through the shared shim's held MutationObserver", () => {
    const observer = new MutationObserver(() => undefined);
    const held = Symbol.for("vibefield.test-env.held-mutation-observer");
    expect((Object.getPrototypeOf(observer) as Record<symbol, unknown>)[held]).toBe(true);
  });

  // DK-7: the Node-26 localStorage shim is the shared one too (tooling/test-env), on the same window
  it("keeps a working localStorage where Node 26's undefined-valued one stood", () => {
    localStorage.setItem("dk-7.wiring", "held");
    expect(localStorage.getItem("dk-7.wiring")).toBe("held");
    localStorage.removeItem("dk-7.wiring");
  });
});

describe("controls", () => {
  it("a kind-less fixture passes with zero states", async () => {
    const result = await run({ pluginDir: join(FIXTURES, "no-objects"), loader: harness });
    expect(result.summary).toMatchObject({ states: 0, refused: 0, exit: 0 });
  });

  it("a directory with no manifest is refused as manifest-missing", async () => {
    const result = await run({ pluginDir: FIXTURES, loader: harness });
    expect(result.verdicts[0]).toMatchObject({ kind: "plugin", code: "manifest-missing" });
    expect(result.summary.exit).toBe(1);
  });
});
