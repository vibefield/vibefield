/**
 * GT-7 — the Config file tab's two readers of the pinned loader. The key
 * reference is GENERATED from the ghosttea-config crate (`pnpm gen`, freshness
 * held by `gen:check`); these cases hold the page's own half — the groups — to
 * it, so a pin move that adds a key cannot silently drop it from the
 * reference. The gutter marks are the loader's diagnostics placed on lines,
 * plus the two facts the text alone shows: a key set twice, and a key ghosttea
 * keeps without drawing.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TerminalConfigDiagnostic } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { lineMarks } from "../src/panels/terminal/ConfigFileTab";
import { parseConfigLines } from "../src/panels/terminal/config-text";
import {
  KEY_BY_NAME,
  KEY_COUNTS,
  KEY_ENTRIES,
  KEY_GROUPS,
} from "../src/panels/terminal/ghostty-key-groups";
import { GHOSTTY_KEYS, GHOSTTY_KEYS_SOURCE } from "../src/panels/terminal/ghostty-keys.generated";

describe("the key reference", () => {
  it("puts every key the pinned loader knows in exactly one group", () => {
    const placed = KEY_GROUPS.flatMap((group) => group.keys);
    expect(new Set(placed).size).toBe(placed.length);
    const known = new Set(GHOSTTY_KEYS.map((entry) => entry.key));
    expect(placed.filter((key) => !known.has(key))).toEqual([]);
    expect(
      KEY_ENTRIES.filter((entry) => entry.group.id === "other").map((entry) => entry.key),
    ).toEqual([]);
    expect(KEY_ENTRIES).toHaveLength(GHOSTTY_KEYS.length);
  });

  it("counts support as the crate reports it", () => {
    expect(KEY_COUNTS.applied + KEY_COUNTS.parsed + KEY_COUNTS.unsupported).toBe(KEY_COUNTS.known);
    expect(KEY_BY_NAME.get("palette")?.support).toBe("applied");
    expect(KEY_BY_NAME.get("font-size")?.support).toBe("parsed");
  });

  it("reads the same ghosttea release the deck runs", () => {
    const pkg = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "../node_modules/@vibecook/ghosttea-react/package.json",
        ),
        "utf8",
      ),
    ) as { version: string };
    expect(GHOSTTY_KEYS_SOURCE.version).toBe(pkg.version);
  });
});

const PATH = "/Users/you/Library/Application Support/VibeField/native/config.ghostty";

function diagnostic(partial: Partial<TerminalConfigDiagnostic>): TerminalConfigDiagnostic {
  return { severity: "error", code: "invalid-value", message: "bad", ...partial };
}

describe("the gutter's marks", () => {
  it("places a loader diagnostic on the line it names in this document only", () => {
    const lines = parseConfigLines("background = #12\nforeground = #ffffff\n");
    const marks = lineMarks(
      lines,
      [
        diagnostic({ source: PATH, line: 1, code: "invalid-color", message: "not a colour" }),
        diagnostic({ source: "/Users/you/.config/ghostty/config", line: 2 }),
      ],
      `${PATH}/`,
    );
    expect(marks.get(1)).toEqual([
      { kind: "error", message: "not a colour", code: "invalid-color" },
    ]);
    expect(marks.has(2)).toBe(false);
  });

  it("marks every line that sets a key the loader names without a line", () => {
    const lines = parseConfigLines("cursor-style = bar\ncursor-style = block\n");
    const marks = lineMarks(
      lines,
      [
        diagnostic({
          severity: "info",
          code: "recognized-not-applied",
          message: "not applied yet",
          key: "cursor-style",
        }),
      ],
      PATH,
    );
    expect(marks.get(1)?.[0]?.kind).toBe("info");
    expect(marks.get(2)?.[0]?.kind).toBe("info");
  });

  it("says when a later line wins, but never for keys meant to repeat", () => {
    const lines = parseConfigLines(
      "scrollback-limit = 1\nscrollback-limit = 2\npalette = 1=#ffffff\npalette = 2=#000000\n",
    );
    const marks = lineMarks(lines, [], PATH);
    expect(marks.get(1)).toEqual([
      {
        kind: "shadow",
        message: "Line 2 sets scrollback-limit again, and the later line wins.",
      },
    ]);
    expect(marks.has(2)).toBe(false);
    expect(marks.has(3) || marks.has(4)).toBe(false);
  });

  it("lets an earlier line stand when the later one is an error", () => {
    const lines = parseConfigLines("scrollback-limit = 1\nscrollback-limit = lots\n");
    const marks = lineMarks(lines, [diagnostic({ source: PATH, line: 2 })], PATH);
    expect(marks.has(1)).toBe(false);
    expect(marks.get(2)?.[0]?.kind).toBe("error");
  });

  it("notes a key ghosttea keeps without drawing", () => {
    const marks = lineMarks(parseConfigLines("font-size = 15\n"), [], PATH);
    expect(marks.get(1)?.[0]).toMatchObject({ kind: "kept" });
  });

  it("orders a line's marks most serious first", () => {
    const lines = parseConfigLines("background = #12\n");
    const marks = lineMarks(
      lines,
      [
        diagnostic({ severity: "info", source: PATH, line: 1, message: "info" }),
        diagnostic({ severity: "error", source: PATH, line: 1, message: "error" }),
        diagnostic({ severity: "warning", source: PATH, line: 1, message: "warning" }),
      ],
      PATH,
    );
    expect(marks.get(1)?.map((mark) => mark.kind)).toEqual(["error", "warning", "info"]);
  });
});
