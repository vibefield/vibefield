// The runner against real plugins and against controls, driven through the SAME
// loader the bin uses — `createHarness` + `load(src/run.ts)`, not a vitest import
// of run.ts. Loading the runner any other way would test a different React, a
// different ICE catalog, and a different transform than the one that ships.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, installDom } from "../src/boot";
import type { RunOptions, RunResult } from "../src/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
const REPO = resolve(PACKAGE_ROOT, "..", "..");
const FIXTURES = join(HERE, "fixtures");

let harness: Harness;
let run: (options: RunOptions) => Promise<RunResult>;

beforeAll(async () => {
  await installDom();
  harness = await createHarness([FIXTURES]);
  const mod = await harness.load(join(PACKAGE_ROOT, "src", "run.ts"));
  run = mod.runPlayground as typeof run;
}, 180_000);

afterAll(async () => {
  await harness?.close();
});

// DK-3 (desk/landing; the slice's estate, DK-2's failure list row 16, class A): this file's
// DOM-MOUNT rows are RETIRED — every repo plugin's widget states, widgetlab's `skipped-gl`, the
// throwing / invalid / unbound controls and both `--state` rows. The runner's verdict for a widget
// state was "its React face mounts in happy-dom", and a widget binds no face since DK-2 (the desk
// draws object KINDS; every row read `widget-unbound`). What stands is what never needed a face:
// a plugin with nothing to mount, a fixture with no widgets, a directory with no manifest. The
// kind-conformance harness that judges an object's states (`resolve`/`record`/`hit` over the
// declared states, no DOM) is DK-7's — the playground v2 — and its rows replace these there.
describe("the repo's own plugins", () => {
  // The subject was `vibefield.browser` until DT-3 gave it a canvas card, which
  // is the whole reason this row names its plugin rather than taking whichever
  // one happens to declare nothing: the empty pass has to be witnessed by a
  // plugin that is deliberately widget-less, and `kv-service` is the repo's —
  // service-only, staging no renderer module at all.
  it("a plugin with no canvas widgets is an honest empty pass", async () => {
    const result = await run({
      pluginDir: join(REPO, "examples", "plugins", "kv-service"),
      loader: harness,
    });
    expect(result.summary).toMatchObject({
      plugin: "vibefield.example.kv",
      widgets: 0,
      states: 0,
      refused: 0,
      exit: 0,
    });
    expect(result.verdicts).toEqual([]);
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
});

describe("controls", () => {
  it("a widget-less fixture passes with zero states", async () => {
    const result = await run({ pluginDir: join(FIXTURES, "no-widgets"), loader: harness });
    expect(result.summary).toMatchObject({ states: 0, refused: 0, exit: 0 });
  });

  it("a directory with no manifest is refused as manifest-missing", async () => {
    const result = await run({ pluginDir: FIXTURES, loader: harness });
    expect(result.verdicts[0]).toMatchObject({ kind: "plugin", code: "manifest-missing" });
    expect(result.summary.exit).toBe(1);
  });
});
