// DK-10 — THE TRY BOARD's pure half (testing/smoke-try.ts): which types a `--try` run lays, read from what
// `vibefield-plugin try` names (`VF_SMOKE_TRY`) or, unnamed, from every plugin manifest under the staged dev roots
// (`FIELDD_PLUGIN_DEV_ROOTS`, a PATH-style list) — so `pnpm smoke:plugin` with a dev root lays what was dev-linked there.
// The rows themselves are held in the product: `vibefield-plugin try` on a plugin (drawn, exit 0) and on a copy whose
// WGSL names an undeclared value (refused at create, the compiler's line quoted, exit 1).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  devRootObjectTypes,
  stillName,
  TRY_MAX,
  TRY_SEARCH_KEY,
  TRY_TYPES_ENV,
  tryTypes,
} from "../src/testing/smoke-try";

const roots: string[] = [];

function devRoot(plugins: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "dk-10-try-root-"));
  roots.push(root);
  for (const [dir, manifest] of Object.entries(plugins)) {
    if (manifest === undefined) {
      writeFileSync(join(root, dir), "not a plugin directory"); // a loose file under the root is passed by
      continue;
    }
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(
      join(root, dir, "vibefield.plugin.json"),
      typeof manifest === "string" ? manifest : JSON.stringify(manifest),
    );
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("the try board's types (DK-10)", () => {
  it("restates field-app's URL door, and caps a board as field-app does", () => {
    expect(TRY_SEARCH_KEY).toBe("deskTry");
    expect(TRY_MAX).toBe(16);
  });

  it("lays what `vibefield-plugin try` names, de-duplicated, before anything a dev root holds", () => {
    const root = devRoot({ a: { contributes: { objects: [{ type: "acme.other" }] } } });
    expect(
      tryTypes({
        [TRY_TYPES_ENV]: " acme.dice, acme.dice ,acme.card",
        FIELDD_PLUGIN_DEV_ROOTS: root,
      }),
    ).toEqual({ types: ["acme.dice", "acme.card"], from: "env" });
  });

  it("unnamed, lays every object type the dev roots' plugins declare — root order, then directory order", () => {
    const first = devRoot({
      "b-plugin": { contributes: { objects: [{ type: "b.two" }, { type: "b.three" }] } },
      "a-plugin": { contributes: { objects: [{ type: "a.one" }] } },
      "no-objects": { contributes: { commands: [] } },
      "not-json": "{ nope",
      "loose-file.txt": undefined,
    });
    const second = devRoot({
      c: { contributes: { objects: [{ type: "c.four" }, { type: "a.one" }] } },
    });
    const list = [first, second, join(first, "missing-root")].join(delimiter);
    expect(devRootObjectTypes(list)).toEqual(["a.one", "b.two", "b.three", "c.four"]);
    expect(tryTypes({ FIELDD_PLUGIN_DEV_ROOTS: list })).toEqual({
      types: ["a.one", "b.two", "b.three", "c.four"],
      from: "dev-roots",
    });
    expect(tryTypes({}).types).toEqual([]);
  });

  it("names each object's stills by its type, with what a file name cannot hold replaced", () => {
    expect(stillName("acme.dice", "light")).toBe("try-acme.dice-light.png");
    expect(stillName("acme/odd type", "dark")).toBe("try-acme_odd_type-dark.png");
  });
});
