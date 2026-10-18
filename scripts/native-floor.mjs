// FW (F1) — the floor's own binaries. ONE release build of field-native (`build:native-release`) produces all three,
// and the floor resolves the other two as SIBLINGS of its own executable (field-native `config.rs`: `cell_binary()` for
// the TC-S2 terminal cell, `freeway_binary()` for the freeway host; FIELD_NATIVE_CELL_BIN and FIELD_NATIVE_FREEWAY_BIN
// are test and dev seams that packaging never sets). The stager ships them as a SET (`floorSetProblems`) and the launch
// check runs each (`host-links.mjs`); the release manifest's native plane is this set plus the sidecars the floor also
// execs from its own directory (`release-manifest.mjs`).

/** The floor first, then the binaries it resolves beside itself. */
export const FLOOR_BINARIES = ["field-native", "field-terminal-host", "field-freeway-host"];

/** Each sibling, and what a floor without it boots with — said in the refusal. */
const SIBLING = {
  "field-terminal-host": ["its terminal cell (TC-S2)", "its terminal unit would stay Degraded"],
  "field-freeway-host": ["its freeway host (F1)", "its freeway would read disabled"],
};

/** The set's file names on a platform (`.exe` on Windows). */
export function floorBinaryNames(platform = process.platform) {
  return FLOOR_BINARIES.map((stem) => (platform === "win32" ? `${stem}.exe` : stem));
}

/**
 * The floor's set ships whole or not at all, judged against the staged paths (`bin/<name>`). None staged is the stage's
 * declared optional gap (a preview with no native plane); some but not all is a half-state — a `target/release` built
 * before one of them existed — and each refusal names what the floor would fail to find beside itself.
 */
export function floorSetProblems(staged, platform = process.platform) {
  const names = floorBinaryNames(platform);
  const floor = names[0];
  const missing = names.filter((name) => !staged.has(`bin/${name}`));
  if (missing.length === 0 || missing.length === names.length) return [];
  if (missing.includes(floor)) {
    const siblings = names.filter((name) => !missing.includes(name)).map((name) => `bin/${name}`);
    return [`SET  ${siblings.join(" and ")} staged without bin/${floor} — siblings with no floor`];
  }
  return missing.map((name) => {
    const [what, then] = SIBLING[name.replace(/\.exe$/u, "")];
    return (
      `SET  bin/${floor} is staged without bin/${name} — the floor resolves ${what} beside itself and would ` +
      `find none, so ${then}; rebuild the set with \`pnpm --filter @vibefield/desktop build:native-release\``
    );
  });
}
