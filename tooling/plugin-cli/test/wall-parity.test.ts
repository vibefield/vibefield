// The parity pin. `wall.ts` reimplements R10's matcher because
// `scripts/check-import-boundaries.mjs` is a CLI that runs at import time and
// cannot be required — so the two lists are held together by THIS test, which
// reads the rule out of that script and compares. Add a module to R10 without
// adding it here and the kit's suite reds, which is the whole point: the repo
// has been bitten before by a wall that was a second source of truth nobody
// diffed.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  R10_ALLOWED_DOOR,
  R10_FORBIDDEN_MODULES,
  R10_FORBIDDEN_PREFIXES,
  violatesR10,
} from "../src/wall";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-import-boundaries.mjs");

/** Pull the R10 rule's `modules` and `prefixes` arrays out of the script. */
function r10FromScript(): { modules: string[]; prefixes: string[] } {
  const source = readFileSync(SCRIPT, "utf8");
  const ruleStart = source.indexOf('id: "R10"');
  expect(ruleStart, "R10 is no longer a rule in check-import-boundaries.mjs").toBeGreaterThan(0);
  const ruleEnd = source.indexOf('id: "R11"', ruleStart);
  const rule = source.slice(ruleStart, ruleEnd === -1 ? undefined : ruleEnd);

  const list = (name: string): string[] => {
    const at = rule.indexOf(`${name}: [`);
    if (at === -1) return [];
    const block = rule.slice(at, rule.indexOf("]", at));
    return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
  };
  return { modules: list("modules"), prefixes: list("prefixes") };
}

describe("R10 parity with the repo's import-boundary checker", () => {
  it("forbids exactly the modules the script forbids", () => {
    expect([...R10_FORBIDDEN_MODULES].sort()).toEqual(r10FromScript().modules.sort());
  });

  it("forbids exactly the prefixes the script forbids", () => {
    expect([...R10_FORBIDDEN_PREFIXES].sort()).toEqual(r10FromScript().prefixes.sort());
  });

  it("matches subpaths the way the script's importsModule does, and not impostors", () => {
    expect(violatesR10("@vibecook/ice")).toBe(true);
    expect(violatesR10("@vibecook/ice/react")).toBe(true);
    // DK-6: a kind's ICE arrives through the SDK's `/desk` door alone — the desk's
    // published entries are walled like the root, the built-ins' entry first of all
    // (K-L4: a plugin never imports a built-in kind).
    expect(violatesR10("@vibecook/ice/desk")).toBe(true);
    expect(violatesR10("@vibecook/ice/desk/kit")).toBe(true);
    expect(violatesR10("@vibecook/ice/desk/objects")).toBe(true);
    expect(violatesR10("node:fs")).toBe(true);
    // The SDK door and its subpaths are the sanctioned imports.
    expect(violatesR10("@vibefield/plugin-sdk")).toBe(false);
    expect(violatesR10("@vibefield/plugin-sdk/canvas")).toBe(false);
    expect(violatesR10("@vibefield/plugin-sdk/behavior")).toBe(false);
    expect(violatesR10("@vibefield/plugin-sdk/desk")).toBe(false);
    expect(violatesR10("react")).toBe(false);
    // A same-prefix impostor is not the forbidden module.
    expect(violatesR10("electronics")).toBe(false);
    expect(violatesR10("wsx")).toBe(false);
  });

  it("states the door as the SDK ships it: every runtime subpath, none of them walled", () => {
    // The SDK's exports map is the door's truth; `./testing` is authoring-time (the mock host).
    const sdk = JSON.parse(
      readFileSync(join(REPO_ROOT, "packages", "plugin-sdk", "package.json"), "utf8"),
    ) as { name: string; exports: Record<string, string> };
    const runtime = Object.keys(sdk.exports)
      .filter((sub) => sub !== "./testing")
      .map((sub) => (sub === "." ? sdk.name : `${sdk.name}${sub.slice(1)}`));
    expect(runtime).toContain("@vibefield/plugin-sdk/desk");
    for (const spec of runtime) expect(R10_ALLOWED_DOOR, spec).toContain(spec);
    for (const spec of R10_ALLOWED_DOOR) expect(violatesR10(spec), spec).toBe(false);
  });
});
