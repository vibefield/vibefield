// FW (F1) — the floor's set (`scripts/native-floor.mjs`): field-native and the two binaries it resolves beside itself ship
// whole or not at all. The stager's verify() reports these lines; a `target/release` built before the freeway host
// existed holds the floor and its cell and no host, and must fail the stage rather than pack a freeway that reads
// disabled.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FLOOR_BINARIES,
  floorBinaryNames,
  floorSetProblems,
} from "../../../scripts/native-floor.mjs";

const staged = (...names) => new Set(names.map((name) => `bin/${name}`));

test("the set is the floor first, then its cell and its freeway host; `.exe` on Windows", () => {
  assert.deepEqual(FLOOR_BINARIES, ["field-native", "field-terminal-host", "field-freeway-host"]);
  assert.deepEqual(floorBinaryNames("darwin"), FLOOR_BINARIES);
  assert.deepEqual(floorBinaryNames("win32"), [
    "field-native.exe",
    "field-terminal-host.exe",
    "field-freeway-host.exe",
  ]);
});

test("whole, or none at all (the stage's declared optional gap), is no problem", () => {
  assert.deepEqual(floorSetProblems(staged(...FLOOR_BINARIES), "darwin"), []);
  assert.deepEqual(floorSetProblems(staged(), "darwin"), []);
  assert.deepEqual(floorSetProblems(staged("fieldd", "sidecar-slim"), "darwin"), []);
});

test("a floor and its cell without the freeway host — a release build from before F1 — is refused, said as disabled", () => {
  const problems = floorSetProblems(staged("field-native", "field-terminal-host"), "darwin");
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^SET {2}bin\/field-native is staged without bin\/field-freeway-host/);
  assert.match(problems[0], /freeway would read disabled/);
  assert.match(problems[0], /pnpm --filter @vibefield\/desktop build:native-release/);
});

test("each missing sibling is its own line; siblings with no floor are one", () => {
  const both = floorSetProblems(staged("field-native"), "darwin");
  assert.equal(both.length, 2);
  assert.match(both[0], /without bin\/field-terminal-host — .*terminal unit would stay Degraded/);
  assert.match(both[1], /without bin\/field-freeway-host/);
  assert.deepEqual(
    floorSetProblems(staged("field-terminal-host", "field-freeway-host"), "darwin"),
    [
      "SET  bin/field-terminal-host and bin/field-freeway-host staged without bin/field-native — siblings with no floor",
    ],
  );
});

test("judged by the platform's own names", () => {
  assert.deepEqual(
    floorSetProblems(
      staged("field-native.exe", "field-terminal-host.exe", "field-freeway-host.exe"),
      "win32",
    ),
    [],
  );
  assert.match(
    floorSetProblems(staged("field-native.exe", "field-terminal-host.exe"), "win32")[0],
    /without bin\/field-freeway-host\.exe/,
  );
});
