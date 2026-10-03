import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The P8d-3 rehearsal found the generated docs teaching three calls that did
// not compile against the shipped SDK (bare <CardShell>, zero-arg
// useWidgetProps, a setProp that does not exist). Until DK-2 this file pinned
// every call a worked example taught to the same substring in the shipped proof
// widget (plugins/note/src/widget.tsx). DK-2 cut the SDK's card face exports and
// deleted that face, so the anchors had nothing to hold the docs to and the file
// failed at collection (DK-2's failure list row 17, class A). DK-3 RETIRES the
// five face anchors (`<CardShell world={world} entity={entity}`, `useWidgetProps<`,
// `(world, entity, TYPE)`, `ops.setWidgetProps(entity,`, `: WidgetComponentProps`):
// the docs' React worked examples are stale on the desk build and DK-6 re-keys
// the generator and re-anchors its examples to the example OBJECT plugin. The
// rows below never needed a face, and stand.

const repoRoot = join(__dirname, "..", "..", "..");
const read = (rel: string): string => readFileSync(join(repoRoot, rel), "utf8");

describe("generated docs teach the shipped API", () => {
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
