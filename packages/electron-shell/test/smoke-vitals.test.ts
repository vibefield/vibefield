import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VITALS_DOCUMENT,
  VITALS_RECORDING,
  VITALS_ROW_EXPECTED,
  VITALS_ROW_READ,
  type VitalsRowFacts,
  vitalsRowProblems,
  vitalsRowSummary,
} from "../src/testing/smoke-vitals";

const read = (...rel: string[]): string => readFileSync(join(__dirname, "..", ...rel), "utf8");

/** A drawn, live census as the Godview smoke's run reads it: a desk, a pair, one terminal, the window itself. */
function green(): VitalsRowFacts {
  return {
    state: VITALS_RECORDING,
    groups: [
      {
        group: "shell",
        rows: [
          ["Main", "2%", "188 MB"],
          ["Desk window", "6%", "628 MB"],
          ["GPU", "–", "73 MB"],
        ],
      },
      { group: "fieldd", rows: [["fieldd", "4%", "328 MB"]] },
      {
        group: "floor",
        rows: [
          ["field-native", "0.5%", "39 MB"],
          ["Terminal cell", "0.4%", "23 MB"],
        ],
      },
      { group: "agents", rows: [["Terminal · 2 processes", "1%", "12 MB"]] },
      { group: "observer", rows: [["Vitals window", "3%", "90 MB"]] },
    ],
    total: ["15%", "1.3 GB"],
    traces: 8,
    loop: ["shell", "fieldd"],
    loopReading: "Main · 3% busy",
    sparks: 8,
    lines: 4,
    door: ["subscribe", "captures"],
    product: "undefined",
    node: "undefined undefined",
  };
}

const withGroup = (
  facts: VitalsRowFacts,
  group: string,
  rows: VitalsRowFacts["groups"][number]["rows"],
): VitalsRowFacts => ({
  ...facts,
  groups: facts.groups.map((candidate) =>
    candidate.group === group ? { group, rows } : candidate,
  ),
});

describe("VT-2 — the Godview smoke's VITALS row, judged", () => {
  it("passes a drawn, live census", () => {
    expect(vitalsRowProblems(green())).toEqual([]);
  });

  it("a terminal's row is found whether it counts one process or a tree", () => {
    expect(vitalsRowProblems(withGroup(green(), "agents", [["Terminal", "–", "3 MB"]]))).toEqual(
      [],
    );
  });

  it("names the state it read when the census is not recording", () => {
    expect(vitalsRowProblems({ ...green(), state: "fieldd isn't answering" })).toEqual([
      `the state line says "fieldd isn't answering"`,
    ]);
  });

  it("names a missing row and what its group listed instead: main's roster did not arrive", () => {
    // with no roster the shell's processes are nobody's: the group lists nothing of main's naming
    const problems = vitalsRowProblems(withGroup(green(), "shell", [["Other", "1%", "40 MB"]]));
    expect(problems).toEqual([
      `no "Main" row under shell (it lists: Other)`,
      `no "Desk window" row under shell (it lists: Other)`,
    ]);
    expect(vitalsRowProblems({ ...green(), groups: [] })).toHaveLength(VITALS_ROW_EXPECTED.length);
  });

  it("holds a named row to a memory figure, and lets a first reading's CPU be unmeasured", () => {
    expect(vitalsRowProblems(withGroup(green(), "fieldd", [["fieldd", "–", "–"]]))).toEqual([
      `"fieldd" has no memory figure`,
    ]);
    expect(vitalsRowProblems(withGroup(green(), "fieldd", [["fieldd", "–", "300 MB"]]))).toEqual(
      [],
    );
  });

  it("holds the foot, the traces, the sparklines and the log lines", () => {
    expect(vitalsRowProblems({ ...green(), total: null })).toEqual([
      "the list has no foot for all of VibeField",
    ]);
    expect(vitalsRowProblems({ ...green(), traces: 4, sparks: 0, lines: 0 })).toEqual([
      "4 lane trace(s) drawn, expected at least 6",
      "0 sparkline(s) drawn, expected at least 4",
      "no log line under the lanes",
    ]);
  });

  it("holds the Loop lane to fieldd's loop and to main's, which the open window makes it say (VT-3)", () => {
    expect(vitalsRowProblems({ ...green(), loop: ["fieldd"] })).toEqual([
      "the Loop lane draws no trace for shell (it draws: fieldd)",
    ]);
    expect(vitalsRowProblems({ ...green(), loop: [] })).toEqual([
      "the Loop lane draws no trace for fieldd (it draws: none)",
      "the Loop lane draws no trace for shell (it draws: none)",
    ]);
  });

  it("holds the page to its one door: no product bridge, no Node", () => {
    expect(
      vitalsRowProblems({
        ...green(),
        door: ["subscribe", "captures", "request"],
        product: "object",
        node: "function object",
      }),
    ).toEqual([
      "the page's door holds [subscribe, captures, request], expected subscribe and captures alone",
      "the page holds the product window's bridge",
      "the page sees Node (function object)",
    ]);
  });

  it("prints counts and the named rows' figures, and nothing else of the page", () => {
    const summary = vitalsRowSummary(green());
    expect(summary["groups"]).toEqual({ shell: 3, fieldd: 1, floor: 2, agents: 1, observer: 1 });
    expect((summary["rows"] as Record<string, unknown>)["floor/field-native"]).toBe("0.5% · 39 MB");
    expect((summary["rows"] as Record<string, unknown>)["agents/Terminal"]).toBe("1% · 12 MB");
  });
});

describe("VT-2 — the VITALS row reads the shipping view and main's own names", () => {
  it("reads only class names the view draws, and the states and names its words say", () => {
    const view = read("..", "field-app", "src", "vitals", "VitalsView.tsx");
    for (const name of VITALS_ROW_READ.match(/vf-vitals__[a-z-]+/g) ?? []) {
      expect(view, name).toContain(name);
    }
    const words = read("..", "field-app", "src", "vitals", "vitals-words.ts");
    expect(words).toContain(`words: "${VITALS_RECORDING}"`);
    for (const [group, name] of VITALS_ROW_EXPECTED) {
      expect(words, group).toContain(`${group}: "`);
      expect(words, name).toContain(`"${name}"`);
    }
  });

  it("finds the window by the document main loads, and the smoke presses the menu's own item", () => {
    expect(read("src", "main", "vitals-window.ts")).toContain(
      `const VITALS_DOCUMENT = "${VITALS_DOCUMENT}";`,
    );
    const smoke = read("src", "testing", "smoke.ts");
    expect(smoke).toContain("getMenuItemById(VITALS_ITEM_ID)");
    // before the short proof's branch, so smoke:godview and smoke:terminal-direct both hold the row
    expect(smoke.indexOf(`verdict["vitals"] = await vitalsRow(`)).toBeLessThan(
      smoke.indexOf("if (opts.terminalDirectProof === true) {"),
    );
  });

  it("a harness's Vitals window is kept from the person: shown without the keys, passed through by the pointer", () => {
    const host = read("src", "main", "vitals-window.ts");
    const present = host.slice(host.indexOf("const present = "), host.indexOf("const open = "));
    expect(present).toContain("target.setIgnoreMouseEvents(true);");
    expect(present).toContain("target.showInactive();");
    expect(read("src", "main", "vitals.ts")).toContain("quiet: isSmokeLike(opts.mode),");
  });
});
