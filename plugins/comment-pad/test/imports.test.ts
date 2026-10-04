// @vitest-environment node
// THE IMPORT WALL (DK-8; ICE design-016 K-L1/K-L4 — VibeField's own kind, walled as the clock is, beside R10): every module
// the pad SHIPS (src/) reaches ICE through the SDK's `/desk` door alone — never `@vibecook/ice` or any of
// its entries, never a workspace-internal `@ice/*` name, and above all never `/desk/objects` (a kind never
// imports a built-in; it names another only by its registry name). What it may name: the SDK's root and
// `/desk`, the contracts' types (the manifest), and its own modules — its `.wgsl` files among them. Its
// authoring-time trees (scripts/, test/) may add the build kit, the SDK's testing door, the runner and
// Node's builtins. The example clock holds itself to the same wall (`examples/plugins/desk-clock/test/imports.test.ts`).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PKG = resolve(import.meta.dirname, "..");

/** What the shipped modules may name besides their own. */
const SHIPPED = new Set([
  "@vibefield/plugin-sdk",
  "@vibefield/plugin-sdk/desk",
  "@vibefield/contracts",
]);
/** What the authoring-time trees may add. */
const AUTHORING =
  /^(vitest(\/config)?|node:[a-z/_]+|@vibefield\/plugin-build(\/wgsl)?|@vibefield\/plugin-sdk\/testing)$/;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|mts|mjs|js)$/.test(ent.name)) out.push(full);
  }
  return out;
}

/** Every static, re-export, type-only, side-effect and dynamic specifier in a module (a query dropped). */
function specifiersOf(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(
    /(?:^|[\s;{}])(?:import|export)\s[^;]*?\sfrom\s*['"]([^'"]+)['"]/g,
  ))
    specs.push(m[1] as string);
  for (const m of source.matchAll(/(?:^|[\s;])import\s*['"]([^'"]+)['"]/g))
    specs.push(m[1] as string);
  for (const m of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1] as string);
  return specs.map((s) => s.replace(/\?.*$/, ""));
}

/** Why a specifier in `file` is off the wall, or null when the wall admits it. */
function violation(file: string, spec: string, authoring: boolean): string | null {
  if (spec.startsWith(".")) {
    return relative(PKG, resolve(dirname(file), spec)).startsWith("..")
      ? `"${spec}" climbs out of the package`
      : null;
  }
  if (spec === "@vibecook/ice/desk/objects")
    return `"${spec}" is the built-ins' entry — a kind never imports another kind (K-L4)`;
  if (spec === "@vibecook/ice" || spec.startsWith("@vibecook/ice/"))
    return `"${spec}" is ICE itself — a plugin reaches ICE through @vibefield/plugin-sdk/desk (K-L1)`;
  if (spec.startsWith("@ice/")) return `"${spec}" is ICE's workspace-internal name`;
  if (SHIPPED.has(spec)) return null;
  if (authoring && AUTHORING.test(spec)) return null;
  return `"${spec}" is not the SDK's door (${[...SHIPPED].join(", ")})`;
}

const shipped = walk(join(PKG, "src"));
const authoring = [
  ...walk(join(PKG, "test")),
  ...walk(join(PKG, "scripts")),
  join(PKG, "vitest.config.ts"),
];

describe("the comment pad reaches ICE through the SDK's /desk door alone (K-L1)", () => {
  it("finds the package's modules, and they really consume ICE — through the door, and its WGSL as files", () => {
    expect(shipped.length).toBeGreaterThan(8);
    const named = shipped.flatMap((f) => specifiersOf(readFileSync(f, "utf8")));
    expect(new Set(named.filter((s) => s.startsWith("@vibefield/plugin-sdk")))).toEqual(
      new Set(["@vibefield/plugin-sdk", "@vibefield/plugin-sdk/desk"]),
    );
    expect(named.filter((s) => s.endsWith(".wgsl")).sort()).toEqual([
      "./pad-pass.wgsl",
      "./pad.wgsl",
    ]);
  });

  it("every specifier its shipped modules name is the door, the contracts' types, or a module of its own", () => {
    const bad = shipped.flatMap((f) =>
      specifiersOf(readFileSync(f, "utf8"))
        .map((s) => violation(f, s, false))
        .filter((v) => v !== null)
        .map((v) => `${relative(PKG, f)}: ${v}`),
    );
    expect(bad).toEqual([]);
  });

  it("…and its authoring-time trees add only the build kit, the SDK's testing door, the runner and Node", () => {
    const bad = authoring.flatMap((f) =>
      specifiersOf(readFileSync(f, "utf8"))
        .map((s) => violation(f, s, true))
        .filter((v) => v !== null)
        .map((v) => `${relative(PKG, f)}: ${v}`),
    );
    expect(bad).toEqual([]);
  });

  it("the wall refuses what an insider would write: ICE's entries, the built-ins', a workspace name, a raw dependency", () => {
    const f = join(PKG, "src/index.ts");
    for (const spec of [
      "@vibecook/ice",
      "@vibecook/ice/desk",
      "@vibecook/ice/desk/kit",
      "@vibecook/ice/desk/engine",
      "@vibecook/ice/desk/objects",
      "@ice/desk",
      "../../../packages/plugin-sdk/src/desk",
      "@vibecook/strata-ecs",
      "loro-crdt",
      "node:fs",
      "vitest",
    ]) {
      expect(violation(f, spec, false), spec).not.toBeNull();
    }
    for (const spec of [
      "@vibefield/plugin-sdk/desk",
      "@vibefield/plugin-sdk",
      "./law",
      "./pad.wgsl",
    ])
      expect(violation(f, spec, false), spec).toBeNull();
  });

  it("reads type-only, re-export, side-effect and dynamic specifiers alike", () => {
    // assembled at run time: this file's own text names no specifier the wall would read
    const imp = "imp" + "ort";
    const q = (s: string): string => `"${s}"`;
    const src = [
      `${imp} type { A } from ${q("x1")};`,
      `export { b } from ${q("x2")};`,
      `export * from ${q("x3")};`,
      `${imp} ${q("x4")};`,
      `const m = await ${imp}(${q("x5")});`,
      `${imp} {`,
      "  c,",
      "  type D,",
      `} from ${q("x6")};`,
    ].join("\n");
    expect(specifiersOf(src).sort()).toEqual(["x1", "x2", "x3", "x4", "x5", "x6"]);
  });
});
