// CP-4a2a (4A2-Q4 (a), ruled by VF-PM 2026-11-05 08:51Z) — fieldd's executable's closed roles, spelled in two places
// that cannot import one another: `packages/fieldd/src/roles.ts` (the one that dispatches, bin.ts) and the SEA builder
// (`apps/desktop/packaging/build-fieldd-sea.mjs`, which imports no TypeScript and spells each role again for its
// probes). A role spelled one way here and another there is a packaged app whose role finds nothing, so these rows hold
// them equal. roles.ts is read as TEXT: it imports nothing, and its constants are plain string literals.
// *(Trimmed 2026-11-05, ruled by cp-landing 11:34Z: whether each role's bundle is a sidecar and a stage row is item
// 178's one table now, apps/desktop/packaging/fieldd-sidecars.mjs, held by notices-rows.test.mjs.)*
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const REPO = join(import.meta.dirname, "..", "..", "..");
const read = (path) => readFileSync(join(REPO, path), "utf8");

const ROLES = read("packages/fieldd/src/roles.ts");
const SEA = read("apps/desktop/packaging/build-fieldd-sea.mjs");

/** Every `<NAME>_<suffix> = "<value>"` constant in `text`, as a map from NAME to value. */
function constants(text, suffix) {
  const found = new Map();
  for (const match of text.matchAll(new RegExp(`const ([A-Z_]+)_${suffix} = "([^"]+)";`, "g")))
    found.set(match[1], match[2]);
  return found;
}

const roleArgs = constants(ROLES, "ROLE_ARG");
const bundles = constants(ROLES, "BUNDLE");

test("roles.ts names the four roles, each with its argument and its bundle", () => {
  assert.deepEqual([...roleArgs.keys()].sort(), [
    "AGENT_SHIM",
    "FILES_HOST",
    "FLOWS_HOST",
    "TRANSCRIPT_HOST",
  ]);
  assert.deepEqual([...bundles.keys()].sort(), [...roleArgs.keys()].sort());
  for (const [name, arg] of roleArgs)
    assert.match(arg, /^--vibefield-role=[a-z-]+$/, `${name}'s argument is a role's`);
});

test("the SEA builder spells every role's argument exactly as roles.ts does, and no other", () => {
  const spelled = constants(SEA, "ROLE_ARG");
  assert.deepEqual(new Map([...spelled].sort()), new Map([...roleArgs].sort()));
});

test("a run's flow host is a role like the others: its probe's argument is roles.ts's", () => {
  assert.equal(roleArgs.get("FLOWS_HOST"), "--vibefield-role=flows-host");
  assert.equal(bundles.get("FLOWS_HOST"), "flows-host.cjs");
  assert.ok(
    SEA.includes("spawn(exe, [FLOWS_HOST_ROLE_ARG]"),
    "the SEA builder has no flows-host probe",
  );
});
