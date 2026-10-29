// @vitest-environment node
// THE IMPORT WALL (the browser pane's, DK-8; ICE design-016 K-L1/K-L4 — VibeField's own kind, walled as the pane is, beside
// R10): every module the phone SHIPS (src/) reaches ICE through the SDK's doors alone — never `@vibecook/ice` or any of its
// entries, never a workspace-internal `@ice/*` name, and above all never `/desk/objects` (a kind never imports a built-in;
// it names another only by its registry name). What it may name: the SDK's root and `/desk`, the contracts (the manifest's
// types and the binding's schema — the ONE reader it shares with PT-S2's resolver), and its own modules — its `.wgsl` files
// among them. No widening: unlike the pane it writes no `Position` or `Size` (a phone is never resized), so `/canvas` is
// refused everywhere. Its authoring-time trees (scripts/, test/, playground/) may add the build kit, the SDK's testing door,
// the runner and Node's builtins.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

/**
 * Every image in a package's own trees (package-relative, sorted): never under `node_modules`, and never under a dot-directory —
 * a tool's output, ignored in this repository and never shipped (the playground's `.vibefield-still/`, a try's `.vibefield-try/`:
 * their PNGs are stills of what the phone draws, written beside it by `pnpm still`).
 */
function imagesIn(pkg: string): string[] {
  const all = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.name === "node_modules" || (e.isDirectory() && e.name.startsWith("."))
            ? []
            : e.isDirectory()
              ? all(join(dir, e.name))
              : [join(dir, e.name)],
        )
      : [];
  return all(pkg)
    .filter((f) => /\.(png|jpe?g|gif|webp|heic|pdf|svg)$/i.test(f))
    .map((f) => relative(pkg, f))
    .sort();
}

const shipped = walk(join(PKG, "src"));
const authoring = [
  ...walk(join(PKG, "test")),
  ...walk(join(PKG, "scripts")),
  ...walk(join(PKG, "playground")),
  join(PKG, "vitest.config.ts"),
];

describe("the phone reaches ICE through the SDK's doors alone (K-L1)", () => {
  it("finds the package's modules, and they really consume ICE — through the door, and its WGSL as files", () => {
    expect(shipped.length).toBeGreaterThan(12);
    const named = shipped.flatMap((f) => specifiersOf(readFileSync(f, "utf8")));
    expect(new Set(named.filter((s) => s.startsWith("@vibefield/plugin-sdk")))).toEqual(
      new Set(["@vibefield/plugin-sdk", "@vibefield/plugin-sdk/desk"]),
    );
    expect(named.filter((s) => s.endsWith(".wgsl")).sort()).toEqual([
      "./phone-pass.wgsl",
      "./phone.wgsl",
    ]);
    // the binding is read by the contract's own schema (binding.ts) — the one reader PT-S2's resolver shares
    expect(named).toContain("@vibefield/contracts");
  });

  it("every specifier its shipped modules name is the door, the contracts, or a module of its own", () => {
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

  it("the wall refuses what an insider would write: ICE's entries, the built-ins', a workspace name, a raw dependency, /canvas", () => {
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
      "zod",
      "node:fs",
      "vitest",
      "@vibefield/plugin-sdk/canvas",
      "@vibefield/plugin-browser-pane",
    ])
      expect(violation(f, spec, false), spec).not.toBeNull();
    for (const spec of [
      "@vibefield/plugin-sdk/desk",
      "@vibefield/plugin-sdk",
      "@vibefield/contracts",
      "./law",
      "./phone.wgsl",
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

  it("ships no Apple artwork (PHONE.md Q-9): no image of any kind in the package, and the fixture draws from arithmetic", () => {
    expect(imagesIn(PKG)).toEqual([]);
    expect(readFileSync(join(PKG, "src/fixture.ts"), "utf8")).not.toMatch(
      /ios-home|\.png|OffscreenCanvas|drawImage/,
    );
  });

  it("…reading the package's own trees, never a tool's output: the playground's stills and a try's are pictures OF the phone, not artwork it carries", () => {
    const dir = mkdtempSync(join(tmpdir(), "pts1-artwork-"));
    try {
      for (const f of [
        "src/home.png",
        "assets/frame.svg",
        ".vibefield-still/vibefield.simulator--live--day.png",
        ".vibefield-try/still.png",
        "node_modules/x/icon.png",
        "src/law.ts",
      ]) {
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        writeFileSync(join(dir, f), "");
      }
      expect(imagesIn(dir)).toEqual(["assets/frame.svg", "src/home.png"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
