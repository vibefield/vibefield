// The runner against real plugins and against controls, driven through the SAME
// loader the bin uses — `createHarness` + `load(src/run.ts)`, not a vitest import
// of run.ts. Loading the runner any other way would test a different React, a
// different ICE catalog, and a different transform than the one that ships.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness, installDom } from "../src/boot";
import type { RunOptions, RunResult, StateVerdict, Verdict } from "../src/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
const REPO = resolve(PACKAGE_ROOT, "..", "..");
const FIXTURES = join(HERE, "fixtures");

/** The plugins that actually live in this repo — the §24.2 conformance subject.
 * Read from the tree rather than listed twice: a plugin added later joins this
 * suite by existing, which is the only way a census stays true. */
const REPO_PLUGINS = [
  join(REPO, "plugins", "note"),
  join(REPO, "plugins", "field-tools"),
  join(REPO, "plugins", "browser"),
  join(REPO, "examples", "plugins", "widgetlab"),
  join(REPO, "examples", "plugins", "kv-service"),
];

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

function states(result: RunResult): StateVerdict[] {
  return result.verdicts.filter((v): v is StateVerdict => v.kind === "state");
}

function refusals(result: RunResult): Verdict[] {
  return result.verdicts.filter((v) => v.kind !== "summary" && v.status === "refused");
}

function declaredWidgets(dir: string): Array<{ type: string; surface: string }> {
  const manifest = JSON.parse(readFileSync(join(dir, "vibefield.plugin.json"), "utf8")) as {
    contributes?: { widgets?: Array<{ type: string; surface: string }> };
  };
  return manifest.contributes?.widgets ?? [];
}

describe("the repo's own plugins", () => {
  it.each(REPO_PLUGINS)("%s renders every declared widget state", async (pluginDir) => {
    const result = await run({ pluginDir, loader: harness });
    expect(refusals(result)).toEqual([]);
    expect(result.summary.exit).toBe(0);

    // §24.2's row, stated as the assertion it is: EVERY declared widget has at
    // least one state row, and every DOM one has at least one that passed. A GL
    // widget is answered for by `skipped-gl` — never counted as a pass.
    for (const widget of declaredWidgets(pluginDir)) {
      const rows = states(result).filter((v) => v.type === widget.type);
      expect(rows.length, `${widget.type} has no state rows`).toBeGreaterThan(0);
      const wanted = widget.surface === "gl" ? "note" : "pass";
      expect(
        rows.some((r) => r.status === wanted),
        `${widget.type} (${widget.surface}) has no ${wanted} row`,
      ).toBe(true);
    }
  });

  it("a plugin with no canvas widgets is an honest empty pass", async () => {
    const result = await run({ pluginDir: join(REPO, "plugins", "browser"), loader: harness });
    expect(result.summary).toMatchObject({
      plugin: "vibefield.browser",
      widgets: 0,
      states: 0,
      refused: 0,
      exit: 0,
    });
    expect(result.verdicts).toEqual([]);
  });

  it("skips widgetlab's GL widgets by declaration, and says why", async () => {
    const result = await run({
      pluginDir: join(REPO, "examples", "plugins", "widgetlab"),
      loader: harness,
    });
    const skipped = states(result).filter((v) => v.status === "note");
    expect(skipped.length).toBe(
      declaredWidgets(join(REPO, "examples", "plugins", "widgetlab")).filter(
        (w) => w.surface === "gl",
      ).length,
    );
    for (const row of skipped) {
      expect(row.code).toBe("skipped-gl");
      expect(row.status).not.toBe("pass");
    }
    // A skip is not a refusal, so the run still exits 0.
    expect(result.summary.exit).toBe(0);
  });
});

describe("controls — the red rows have to go red", () => {
  it("a state whose component throws is refused, and the refusal names that state", async () => {
    const result = await run({ pluginDir: join(FIXTURES, "throwing-state"), loader: harness });
    const rows = states(result);
    expect(rows.find((r) => r.state === "calm")?.status).toBe("pass");
    const boom = rows.find((r) => r.state === "boom");
    expect(boom?.status).toBe("refused");
    expect(boom?.code).toBe("state-render-failed");
    expect(boom?.type).toBe("vibefield.fixture-throwing.card");
    expect(boom?.detail).toContain("throws on purpose");
    expect(result.summary.exit).toBe(1);
    // The control's control: the same component under the same path passed for
    // the other state, so the red row is the state's fact, not the harness's.
    expect(result.summary.passed).toBe(1);
  });

  it("a fixture that contradicts the declaration is state-invalid, not state-render-failed", async () => {
    const result = await run({ pluginDir: join(FIXTURES, "invalid-state"), loader: harness });
    const rows = states(result);
    expect(rows.find((r) => r.state === "ok")?.status).toBe("pass");
    const bad = rows.filter((r) => r.status === "refused");
    expect(bad.map((r) => r.state).sort()).toEqual(["bad-json", "over-max", "typo", "wrong-kind"]);
    for (const row of bad) expect(row.code).toBe("state-invalid");
    expect(rows.find((r) => r.state === "typo")?.pointer).toBe(
      "/vibefield.fixture-invalid.card/typo/kount",
    );
    expect(result.summary.exit).toBe(1);
  });

  it("a declared-but-unregistered widget loses only its own rows", async () => {
    const result = await run({ pluginDir: join(FIXTURES, "unbound-widget"), loader: harness });
    const unbound = result.verdicts.find((v) => v.kind === "widget");
    expect(unbound).toMatchObject({
      code: "widget-unbound",
      type: "vibefield.fixture-unbound.forgotten",
      status: "refused",
    });
    // §11.4 containment: the sibling still rendered.
    expect(states(result).find((r) => r.type === "vibefield.fixture-unbound.bound")?.status).toBe(
      "pass",
    );
    expect(result.summary.exit).toBe(1);
  });

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

describe("--state", () => {
  it("runs one state of one type", async () => {
    const result = await run({
      pluginDir: join(FIXTURES, "throwing-state"),
      loader: harness,
      only: "vibefield.fixture-throwing.card:calm",
    });
    expect(states(result).map((r) => r.state)).toEqual(["calm"]);
    expect(result.summary.exit).toBe(0);
  });

  it("runs every state of one type when no state name is given", async () => {
    const result = await run({
      pluginDir: join(REPO, "plugins", "field-tools"),
      loader: harness,
      only: "vibefield.field-tools.comment",
    });
    expect(states(result).every((r) => r.type === "vibefield.field-tools.comment")).toBe(true);
    expect(states(result).length).toBeGreaterThan(1);
  });
});
