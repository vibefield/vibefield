import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXAMPLE_PLUGIN_DIR, quotedRegion } from "../src/docs-generate";

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
    // collapsing (which is how keyboard/keyboardEscape nearly shipped invisible —
    // retired since with ICE 0.16's LT2, PT-2: refused by name, never taught).
    // (DK-8: on objects.md — widgets.md retired with `contributes.widgets`)
    const objects = read("docs/plugin-authoring/objects.md");
    expect(objects).toContain("sweepContained?: boolean");
    expect(objects).toContain("snap?: `source` \\| `target` \\| `both` \\| `none`");
    expect(objects).toContain("dragOn?: `press` \\| `longPress`");
    expect(objects).not.toContain("keyboard?:");
    expect(objects).not.toContain("keyboardEscape?:");
  });

  it("keeps parser tombstones out of the author-facing vocabulary", () => {
    const manifest = read("docs/plugin-authoring/manifest.md");
    expect(manifest).toContain("behaviors?: object[]");
    expect(manifest).not.toContain("systems?:");
    // DK-8: `widgets` is a tombstone too — refused by name, never taught as a field
    expect(manifest).not.toContain("widgets?:");
  });
});

// DK-6 — THE RE-ANCHOR DK-3 promised: the docs' worked examples are the example OBJECT plugin's code
// (examples/plugins/desk-clock, through the SDK's `/desk` door) and the SDK's own `ObjectBinding`,
// QUOTED at generation — so the committed pages must carry those regions byte for byte, and no page may
// teach the React face DK-2 cut.
describe("generated docs quote the shipped object code", () => {
  const objects = read("docs/plugin-authoring/objects.md");
  const readme = read("docs/plugin-authoring/README.md");

  it("objects.md carries the example plugin's binding, kind, program and wake — and the SDK's ObjectBinding — verbatim", () => {
    for (const [file, region] of [
      [`${EXAMPLE_PLUGIN_DIR}/src/object.ts`, "binding"],
      [`${EXAMPLE_PLUGIN_DIR}/src/kind.ts`, "kind"],
      [`${EXAMPLE_PLUGIN_DIR}/src/shaders.ts`, "program"],
      [`${EXAMPLE_PLUGIN_DIR}/src/local.ts`, "due"],
      ["packages/plugin-sdk/src/desk.ts", "object-binding"],
    ] as const) {
      const quoted = quotedRegion(file, region);
      expect(quoted.split("\n").length, `${file} ${region}`).toBeGreaterThan(5);
      expect(objects, `objects.md does not carry ${file}'s "${region}" as it ships`).toContain(
        quoted,
      );
    }
  });

  it("the README's renderer module and objects.md's are the example plugin's renderer.ts, whole", () => {
    const renderer = read(`${EXAMPLE_PLUGIN_DIR}/src/renderer.ts`).trimEnd();
    expect(readme).toContain(renderer);
    expect(objects).toContain(renderer);
  });

  it("no page teaches the React face the desk retired (DK-2): no CardShell, no component binding", () => {
    for (const page of ["README.md", "context.md", "objects.md"]) {
      const text = read(`docs/plugin-authoring/${page}`);
      expect(text, page).not.toContain("CardShell");
      expect(text, page).not.toContain("WidgetComponentProps");
      expect(text, page).not.toMatch(/binding:\s*\{\s*component/);
    }
  });

  it("a quoted region that lost its markers stops generation, never a silently stale page", () => {
    expect(() => quotedRegion(`${EXAMPLE_PLUGIN_DIR}/src/object.ts`, "no-such-region")).toThrow(
      /no "\/\/ docs:begin no-such-region"/,
    );
  });
});
