#!/usr/bin/env node
// Fuse audit for a PACKAGED artifact (electron-security-packaging.md §9.2's
// read-back, §11.4's release evidence). The afterPack hook already flips and
// verifies during the build; this is the independent second look, run against
// the artifact as it will ship — after signing, when nothing may mutate it.
//
// Why both: the hook proves the flip took at the moment it ran. This proves the
// thing on disk right now still carries it, which is the only claim a release
// can honestly make. §9.2 forbids post-sign mutation precisely so these two
// answers cannot diverge; an audit that disagrees with the hook means something
// touched the executable in between.
//
// Usage:
//   node scripts/audit-fuses.mjs --app <path/to/App.app|executable> [--json <path>]
//   node scripts/audit-fuses.mjs --self-test
// Node >=22 ESM. Depends only on @electron/fuses, resolved from apps/desktop.
import { existsSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import {
  compareWire,
  FUSE_MATRIX,
  FUSE_STATE,
  FUSE_WIRE_INDEX,
  reconcileWithEnum,
} from "../apps/desktop/packaging/fuse-matrix.mjs";

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

// --- self-test: the comparator's rules, proven on synthetic wires ------------
// The rules matter more than they look: a comparator that mis-reads the state
// vocabulary reports every fuse as disabled and still "passes" a matrix of
// disabled fuses. WP5 shipped exactly that bug for one build — FuseState is a
// numeric enum of char codes, not the strings its member names suggest.
function selfTest() {
  const wireFrom = (states) => {
    const w = { version: "1" };
    for (const [name, on] of Object.entries(states)) {
      w[FUSE_WIRE_INDEX[name]] = on ? FUSE_STATE.ENABLE : FUSE_STATE.DISABLE;
    }
    return w;
  };
  const matching = wireFrom(
    Object.fromEntries(Object.entries(FUSE_MATRIX).map(([n, e]) => [n, e.enabled])),
  );

  const cases = [];
  const check = (name, cond) => {
    cases.push([name, cond]);
  };

  const clean = compareWire(matching);
  check("a wire matching the matrix passes", clean.ok && clean.mismatches.length === 0);
  check(
    "transitional fuses are reported even on a passing wire",
    clean.transitional.length ===
      Object.values(FUSE_MATRIX).filter((e) => e.status === "transitional-required").length,
  );

  const flipped = { ...matching };
  flipped[FUSE_WIRE_INDEX.OnlyLoadAppFromAsar] = FUSE_STATE.DISABLE;
  const bad = compareWire(flipped);
  check("a disabled security fuse fails", !bad.ok && /OnlyLoadAppFromAsar/.test(bad.mismatches[0]));

  const inherited = { ...matching };
  inherited[FUSE_WIRE_INDEX.EnableCookieEncryption] = FUSE_STATE.INHERIT;
  const inh = compareWire(inherited);
  check("INHERIT is a failure, not a pass", !inh.ok && /did not take/.test(inh.mismatches[0]));

  const removed = { ...matching };
  removed[FUSE_WIRE_INDEX.WasmTrapHandlers] = FUSE_STATE.REMOVED;
  const rem = compareWire(removed);
  check("REMOVED demands review", !rem.ok && /removed from/.test(rem.mismatches[0]));

  const absent = { ...matching };
  delete absent[FUSE_WIRE_INDEX.RunAsNode];
  check("a fuse absent from the wire fails", !compareWire(absent).ok);

  // The regression that shipped: string-shaped states must not read as enabled.
  const stringy = { version: "1" };
  for (const i of Object.values(FUSE_WIRE_INDEX)) stringy[i] = "ENABLE";
  check("a foreign state vocabulary is not silently accepted", !compareWire(stringy).ok);

  const drift = reconcileWithEnum({ ...FUSE_WIRE_INDEX, SomeNewFuse: 9 });
  check("a new fuse in the tool is detected", drift.missing.includes("SomeNewFuse"));
  const reindexed = reconcileWithEnum({ ...FUSE_WIRE_INDEX, RunAsNode: 5 });
  check("a wire-index disagreement is detected", reindexed.misindexed.length === 1);

  let failures = 0;
  for (const [name, ok] of cases) {
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  }
  if (failures > 0) {
    console.error(`self-test: ${failures} rule(s) misbehaved`);
    process.exit(1);
  }
  console.log("self-test OK");
}

if (args.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

// --- audit a real artifact ---------------------------------------------------
const appArg = argValue("--app");
if (appArg === undefined) {
  console.error("usage: node scripts/audit-fuses.mjs --app <App.app|executable> [--json <path>]");
  process.exit(2);
}

/** Accept either the .app bundle or the executable inside it. */
function electronBinary(p) {
  const abs = resolve(p);
  if (!existsSync(abs)) return null;
  if (abs.endsWith(".app") && statSync(abs).isDirectory()) {
    return join(abs, "Contents", "MacOS", basename(abs).replace(/\.app$/, ""));
  }
  return abs;
}

const target = electronBinary(appArg);
if (target === null || !existsSync(target)) {
  console.error(`release-fuses FAIL: no executable at ${appArg}`);
  process.exit(1);
}

// Resolved from apps/desktop, where the explicit ^2.1.3 pin lives — the
// transitive copy is 1.8.0 and cannot name every fuse in Electron 43's wire.
const require = createRequire(join(resolve("apps/desktop"), "package.json"));
const { getCurrentFuseWire, FuseState, FuseV1Options } = require("@electron/fuses");

const drift = reconcileWithEnum(FuseV1Options);
const driftProblems = [
  ...drift.missing.map((n) => `${n} exists in @electron/fuses but not in the matrix`),
  ...drift.extra.map((n) => `matrix names ${n}, unknown to @electron/fuses`),
  ...drift.misindexed.map((m) => `wire index disagreement — ${m}`),
];

const wire = await getCurrentFuseWire(target);
const { ok, mismatches, transitional } = compareWire(wire, { state: FuseState });

console.log(`release-fuses — ${target}`);
for (const [name, entry] of Object.entries(FUSE_MATRIX)) {
  const actual = wire[FUSE_WIRE_INDEX[name]];
  const on = actual === FuseState.ENABLE;
  const flag = entry.status === "transitional-required" ? "  ← TRANSITIONAL-REQUIRED" : "";
  console.log(`  ${on ? "on " : "off"}  ${name}${flag}`);
}
for (const t of transitional) console.log(`  TRANSITIONAL: ${t}`);
for (const d of driftProblems) console.error(`release-fuses FAIL: ${d}`);
for (const m of mismatches) console.error(`release-fuses FAIL: ${m}`);

const jsonPath = argValue("--json");
if (jsonPath !== undefined) {
  writeFileSync(
    jsonPath,
    `${JSON.stringify(
      {
        target,
        wire,
        expected: Object.fromEntries(
          Object.entries(FUSE_MATRIX).map(([n, e]) => [
            n,
            { enabled: e.enabled, status: e.status },
          ]),
        ),
        ok: ok && driftProblems.length === 0,
        mismatches,
        transitional,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${jsonPath}`);
}

if (!ok || driftProblems.length > 0) process.exit(1);
console.log(
  `release-fuses OK — ${Object.keys(FUSE_MATRIX).length} fuses verified; ${transitional.length} transitional`,
);
