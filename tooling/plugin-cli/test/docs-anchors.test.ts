import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The P8d-3 rehearsal found the generated docs teaching three calls that did
// not compile against the shipped SDK (bare <CardShell>, zero-arg
// useWidgetProps, a setProp that does not exist) — a bar-run failure waiting,
// because these docs are the ten-minute-bar agent's ONLY input. The fix is
// pinned here the way the ctx table is pinned: every API call a worked example
// teaches must appear, as the same substring, in the shipped proof widget
// (plugins/note/src/widget.tsx). If the SDK moves, note moves, this test reds,
// and the generator must follow — the docs can no longer drift from shipping
// code silently.

const repoRoot = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

const NOTE_WIDGET = "plugins/note/src/widget.tsx";

/** anchor → the generated file that teaches it */
const ANCHORS: ReadonlyArray<[anchor: string, taughtIn: string]> = [
  ["<CardShell world={world} entity={entity}", "docs/plugin-authoring/README.md"],
  ["useWidgetProps<", "docs/plugin-authoring/widgets.md"],
  ["(world, entity, TYPE)", "docs/plugin-authoring/widgets.md"],
  ["ops.setWidgetProps(entity,", "docs/plugin-authoring/widgets.md"],
  [": WidgetComponentProps", "docs/plugin-authoring/widgets.md"],
];

describe("generated docs teach the shipped API", () => {
  const note = read(NOTE_WIDGET);

  it.each(ANCHORS)("%s appears in both the docs and the proof widget", (anchor, taughtIn) => {
    expect(read(taughtIn)).toContain(anchor);
    expect(note).toContain(anchor);
  });

  it("the docs name the scaffolder — an agent must be able to discover create-plugin", () => {
    expect(read("docs/plugin-authoring/README.md")).toContain("create-plugin --id");
  });

  it("the interaction vocabulary renders inline — an `object` cell teaches nothing (S2)", () => {
    // schema-walk's inline-object threshold is calibrated to this exact shape;
    // if interaction outgrows it again, this reds instead of the table silently
    // collapsing (which is how keyboard/keyboardEscape nearly shipped invisible).
    const widgets = read("docs/plugin-authoring/widgets.md");
    expect(widgets).toContain("sweepContained?: boolean");
    expect(widgets).toContain("keyboard?: `shared` \\| `exclusive`");
    expect(widgets).toContain("keyboardEscape?: `release` \\| `widget`");
  });

  it("keeps parser tombstones out of the author-facing vocabulary", () => {
    const manifest = read("docs/plugin-authoring/manifest.md");
    expect(manifest).toContain("behaviors?: object[]");
    expect(manifest).not.toContain("systems?:");
  });
});
