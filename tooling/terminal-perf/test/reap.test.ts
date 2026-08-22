import { describe, expect, it } from "vitest";
import { findStrays, orderForReaping } from "../src/reap";

// Every row here is a process that WOULD BE SENT SIGKILL if the matcher were
// wrong. Two of them are the decoys the first version killed.

const ROOT = "/Users/x/Projects/project100/vf-s0c";
const OTHER = "/Users/x/Projects/project100/vf-s1r";
const JAMES = "/Users/x/Projects/project100/vibe-field";
const ELECTRON = `${ROOT}/node_modules/.pnpm/electron@43/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`;

const ps = (...lines: string[]): string => lines.join("\n");

describe("findStrays — what it CLAIMS", () => {
  it("finds a floor and a cell executed directly", () => {
    const found = findStrays(
      ps(
        ` 101 ${ROOT}/target/debug/field-native --root /tmp/vf-smoke-a`,
        ` 102 ${ROOT}/target/debug/field-terminal-host --session b`,
      ),
      ROOT,
    );
    expect(found.map((s) => [s.pid, s.kind])).toEqual([
      [101, "floor"],
      [102, "cell"],
    ]);
  });

  it("finds fieldd running as argv[1] under a runtime", () => {
    const found = findStrays(ps(` 103 ${ELECTRON} ${ROOT}/packages/fieldd/dist/bin.cjs`), ROOT);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("fieldd");
  });
});

describe("findStrays — what it must NEVER kill", () => {
  it("spares another worktree's floor", () => {
    expect(findStrays(ps(` 201 ${OTHER}/target/debug/field-native`), ROOT)).toEqual([]);
  });

  it("spares James's own checkout", () => {
    expect(findStrays(ps(` 202 ${JAMES}/target/debug/field-native`), ROOT)).toEqual([]);
  });

  it("spares a process that merely NAMES the path — the first version's bug", () => {
    // A shell grepping for the binary carries the absolute path in its command
    // line and would have matched `command.includes(path)`.
    expect(
      findStrays(ps(` 203 grep -r something ${ROOT}/target/debug/field-native`), ROOT),
    ).toEqual([]);
  });

  it("spares a runtime whose script is NOT at argv[1] — the second decoy", () => {
    // `node -e <code> <path>`: argv[0] is a runtime and the fieldd path is
    // present, but at token 3. Verified live before this row existed.
    expect(
      findStrays(
        ps(` 204 node -e setTimeout(()=>{},30000) ${ROOT}/packages/fieldd/dist/bin.cjs`),
        ROOT,
      ),
    ).toEqual([]);
  });

  it("spares the caller and its parent", () => {
    const line = ps(
      ` 205 ${ROOT}/target/debug/field-native`,
      ` 206 ${ROOT}/target/debug/field-native`,
    );
    expect(findStrays(line, ROOT, [205, 206])).toEqual([]);
  });

  it("spares a path that only PREFIX-matches another worktree name", () => {
    // `vf-s0c-old` starts with the root string; the trailing separator in rule 1
    // and the exact token equality in rule 2 both have to hold.
    expect(findStrays(ps(` 207 ${ROOT}-old/target/debug/field-native`), ROOT)).toEqual([]);
  });

  it("returns nothing for unparseable or empty ps output", () => {
    expect(findStrays("", ROOT)).toEqual([]);
    expect(findStrays("not a ps line at all", ROOT)).toEqual([]);
  });
});

describe("orderForReaping", () => {
  it("signals fieldd first so nothing respawns behind the kill", () => {
    const strays = findStrays(
      ps(
        ` 301 ${ROOT}/target/debug/field-terminal-host`,
        ` 302 ${ROOT}/target/debug/field-native`,
        ` 303 ${ELECTRON} ${ROOT}/packages/fieldd/dist/bin.cjs`,
      ),
      ROOT,
    );
    expect(orderForReaping(strays).map((s) => s.kind)).toEqual(["fieldd", "floor", "cell"]);
  });
});
