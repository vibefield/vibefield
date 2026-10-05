// The generated reference: deterministic, current, and honest about itself.
//
// The stale-docs control run matters as much as the others. These files are an
// agent's ONLY input by design, so a doc that drifts from the schema is worse
// than a missing one — the gate has to be able to fail, and this proves it does.

import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { invariantRows, RENDERER_CTX_FACES, SERVICE_CTX_FACES } from "../src/docs-anchors";
import { checkDocsFresh, writeDocs } from "../src/docs-command";
import { loadExamples } from "../src/docs-examples";
import {
  cell,
  DOC_FILES,
  generateDocs,
  KIT_PIECES,
  kitPieceDeclarations,
  quotedDeclaration,
  VIEW_BLOCK_FIELDS,
} from "../src/docs-generate";
import { catalogRows, REFUSAL_CATALOG, type RefusalCode } from "../src/refusals";
import { freshDir, refusalCodes } from "./fixtures";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const COMMITTED_DOCS = join(REPO_ROOT, "docs", "plugin-authoring");
const SRC = join(HERE, "..", "src");

describe("generation", () => {
  it("is deterministic — two runs produce identical bytes", () => {
    const first = generateDocs();
    const second = generateDocs();
    expect([...second.keys()]).toEqual([...first.keys()]);
    for (const [name, content] of first) expect(second.get(name)).toBe(content);
  });

  it("emits exactly the declared file set", () => {
    expect([...generateDocs().keys()].sort()).toEqual([...DOC_FILES].sort());
  });

  it("every worked example validates as a real manifest", () => {
    for (const example of Object.values(loadExamples())) {
      const result = validatePluginManifest(example.manifest);
      expect(result.ok, `${example.source}: ${result.ok ? "" : result.issues.join(" · ")}`).toBe(
        true,
      );
    }
  });

  it("states each cross-field invariant in the schema's own words", () => {
    const rows = invariantRows();
    expect(rows.length).toBeGreaterThan(10);
    const manifestDoc = generateDocs().get("manifest.md") ?? "";
    for (const row of rows) expect(manifestDoc).toContain(row.message);
  });

  it("keeps every table cell parseable as a table cell", () => {
    // A `|` inside a cell ends it. This bit the activation rule, whose message
    // is literally `onStartup | onObject:…`.
    for (const [name, content] of generateDocs()) {
      for (const line of content.split("\n")) {
        if (!line.startsWith("| ")) continue;
        const cells = line.split(/(?<!\\)\|/).length - 2;
        expect(cells, `${name}: ${line}`).toBeGreaterThan(0);
      }
    }
  });

  it("wraps a cell whose characters markdown would eat, and leaves formatted ones alone", () => {
    expect(cell("x.<pluginId>.<name>")).toBe("`x.<pluginId>.<name>`");
    expect(cell("a | b")).toBe("a \\| b");
    expect(cell("run `plugin-build` for <this>")).toBe("run `plugin-build` for <this>");
    expect(cell("plain words")).toBe("plain words");
  });
});

describe("freshness (the control run)", () => {
  it("passes against the committed docs", () => {
    expect(refusalCodes(checkDocsFresh(COMMITTED_DOCS))).toEqual([]);
  });

  it("refuses a stale file, then passes once it is regenerated", () => {
    const dir = freshDir("vf-docs-");
    writeDocs(dir);
    expect(refusalCodes(checkDocsFresh(dir))).toEqual([]);

    // RED: someone edits a generated file by hand.
    const path = join(dir, "manifest.md");
    writeFileSync(path, `${readFileSync(path, "utf8")}\n<!-- hand edit -->\n`);
    const stale = checkDocsFresh(dir);
    expect(refusalCodes(stale)).toEqual(["docs-stale"]);
    expect(stale[0]?.pointer).toContain("manifest.md:");

    // GREEN: regenerate.
    writeDocs(dir);
    expect(refusalCodes(checkDocsFresh(dir))).toEqual([]);
  });

  it("refuses a file that was never generated at all", () => {
    const dir = freshDir("vf-docs-");
    writeDocs(dir);
    copyFileSync(join(dir, "cli.md"), join(dir, "cli.md.bak"));
    writeFileSync(join(dir, "cli.md"), "");
    expect(refusalCodes(checkDocsFresh(dir))).toEqual(["docs-stale"]);
  });
});

describe("the refusal catalog is the docs' source of truth", () => {
  it("documents every code, refusals and notes alike", () => {
    const refusals = generateDocs().get("refusals.md") ?? "";
    for (const row of catalogRows()) expect(refusals).toContain(`\`${row.code}\``);
  });

  it("declares every code the kit actually emits", () => {
    // Every `refuse(...)`/`note(...)` call site names its code as a literal, so
    // the source itself is the enumeration to check against.
    const emitted = new Set<string>();
    for (const file of [
      "activation-check.ts",
      "artifact-check.ts",
      "check.ts",
      "cli.ts",
      "dev-link.ts",
      "docs-command.ts",
      "manifest-check.ts",
      "pack-command.ts",
      "registry-commands.ts",
      "schema-check.ts",
      "wall.ts",
    ]) {
      const source = readFileSync(join(SRC, file), "utf8");
      for (const match of source.matchAll(/\b(?:refuse|note)\(\s*"[^"]+",\s*"([^"]+)"/g))
        emitted.add(match[1] ?? "");
      for (const match of source.matchAll(/guidanceFor\("([^"]+)"\)/g)) emitted.add(match[1] ?? "");
    }
    expect(emitted.size).toBeGreaterThan(10);
    for (const code of emitted) expect(Object.keys(REFUSAL_CATALOG)).toContain(code);
  });

  it("gives every refusal a fix, not just a name", () => {
    for (const row of catalogRows()) {
      expect(row.guidance.length, row.code).toBeGreaterThan(20);
      expect(row.meaning.length, row.code).toBeGreaterThan(20);
    }
  });

  it("keeps the catalog's levels honest — a note never fails a command", () => {
    const notes = catalogRows().filter((r) => r.level === "note");
    expect(notes.map((r) => r.code)).toContain("artifact-absent");
    expect(notes.map((r) => r.code)).toContain("activation-unbuilt");
    expect(REFUSAL_CATALOG["docs-stale" satisfies RefusalCode].level).toBe("refuse");
  });
});

describe("the ctx table is anchored to the SDK", () => {
  it("quotes a present-iff rule that really is in the SDK's source", () => {
    const sdk = readFileSync(join(REPO_ROOT, "packages", "plugin-sdk", "src", "index.ts"), "utf8");
    // Collected, not asserted one at a time: when the SDK's comments are
    // rewrapped, several anchors move together and one round trip should show
    // all of them. (Anchors are single-LINE substrings for the same reason.)
    const drifted = [...RENDERER_CTX_FACES, ...SERVICE_CTX_FACES]
      .filter((row) => !sdk.includes(row.anchor))
      .map((row) => `${row.face}: ${row.anchor}`);
    expect(drifted).toEqual([]);
  });

  it("documents no widget door — `ctx.widgets` retired with `contributes.widgets` (DK-8)", () => {
    expect(RENDERER_CTX_FACES.map((r) => r.face)).not.toContain("ctx.widgets");
    expect(generateDocs().get("context.md")).not.toContain("RendererWidgetAPI");
  });

  it("covers every optional face the renderer context declares", () => {
    const documented = new Set(RENDERER_CTX_FACES.map((r) => r.face));
    for (const face of [
      "ctx.commands",
      "ctx.surfaces",
      "ctx.canvas",
      "ctx.settings",
      "ctx.storage",
    ])
      expect(documented).toContain(face);
  });
});

describe("coverage of what an author has to know", () => {
  const docs = generateDocs();
  const all = [...docs.values()].join("\n");

  it("covers the manifest, the loop, and the vocabulary", () => {
    for (const topic of [
      "vibefield.plugin.json",
      "activate(ctx)",
      "conflict group",
      "plugin-build",
      "dev-link",
      "manifestHash",
      "onStartup",
      "hud.side-panel",
      "x.<pluginId>",
      // DK-0f — the object door: the key, the placement key, the export name, the
      // host's refusal on this build, and what a kind must answer
      "contributes.objects",
      "desk.object",
      "binding.kind",
      "objects-need-desk",
      // DK-8 — the retired widget contribution's refusal, and where its rows went
      "widgets-contribution-retired",
      // DK-9 — the activation event renamed clean: the new name, and the old one's refusal
      "onObject:<object type>",
      "onwidget-activation-retired",
      // DK-9 — the runtime with kinds: what enable, disable and update do; where a kind's test runs
      "At run time — enable, disable, update",
      "plugin off",
      "regresses schemaVersion",
      "WHERE IT RUNS",
      "resolve(ctx)",
      "KindLocal.due",
      // DK-10 — the ten-minute bar's punch list: what its agents had to guess, said
      "On the desk, today", // nothing a person can do lays a plugin's kind yet — and what does
      "vibefield-plugin try <dir>", // the object ON THE DESK, drawn or refused, with stills
      "try-kind-refused",
      "vibefield-plugin emit-manifest", // gen:manifest with nothing installed
      "NOTHING NEEDS INSTALLING", // the kit's commands outside a checkout's workspace
      "plugin-playground <dir>", // the executables' own names, beside the checkout's pnpm scripts
      "plugin-build [<dir>]",
      "## Reading props", // ctx.props is flat; the door's numberProp/stringProp
      "export declare const numberProp",
      "## The kit's WGSL", // what each piece declares, the view block, the conventions
      "fn mat_zoom(u: MatUniforms) -> f32",
      "fn portal_cover(",
      "`u.view`",
      "y DOWN",
      "PREMULTIPLIED",
      "export type FieldType", // defineStruct's field types
      "export interface HeldToolDef", // a tool's `kind` — without it, dim and never run
      "object-tool-inert",
      "export interface ChildShape",
      "export interface MarkFrame",
      "export interface ObjectFlux",
      "export interface TrayHang", // what a peg's pitches are measured from
      "import-name-unknown",
      "## The playground's own codes", // renderer-import-failed was in no doc
      "renderer-import-failed",
      "## The kind harness's state codes",
      "state-hit-missed",
      // DK-10 — the fourth agent's notes (it landed its object in 5½ minutes; these it had to guess)
      "once more at rest by night", // the harness's by-night state, in the documented list
      "BY NIGHT:", // how a kind follows the night: per-theme colours, or lit as the mat is
      "export type ThemeName",
      "fn clock_colour(",
      "`u.night`",
      "export declare function cssColor", // what `rgb` parses
      "picked across W × H", // what try's box measures
      "the ONLY dev plugin staged",
    ])
      expect(all, `nothing tells an author about ${topic}`).toContain(topic);
  });

  it("DK-10: says nothing of `widget` but the retired words' own refusals and the names ICE's vocabulary keeps", () => {
    // the retired words, each said only where it is refused by name; ICE's `keyboardEscape` value; the limit the
    // plan's addendum (15) keeps — nothing else of the old face may creep back into what an author reads
    const kept = [
      /`?onWidget:(<type>|com\.example\.demo)?`?/g,
      /onwidget-activation-retired/g,
      /widget-context-retired/g,
      /placement widget-context is retired/g,
      /the retired widget-context command placement/g,
      /contributes\.widgets/g,
      /widgets-contribution-retired/g,
      /keyboardEscape\?: `release` \\\| `widget`/g,
      /`WIDGET_BEHAVIORS_MAX`/g,
    ];
    for (const [name, text] of docs) {
      const left = kept.reduce((t, word) => t.replace(word, ""), text);
      const line = left.split("\n").find((l) => /widget/i.test(l));
      expect(line, `${name} still says widget`).toBeUndefined();
    }
  });

  it("DK-10: the kit's WGSL is listed from the kit itself — each piece, the helpers a kind's shader calls", () => {
    const objects = docs.get("objects.md") ?? "";
    for (const piece of KIT_PIECES) expect(objects).toContain(`- \`${piece}\``);
    expect(kitPieceDeclarations("view")).toEqual(["struct MatUniforms"]);
    expect(kitPieceDeclarations("light")).toContain("fn mat_dpr(u: MatUniforms) -> f32");
    expect(kitPieceDeclarations("portal").some((d) => d.startsWith("fn portal_cover("))).toBe(true);
    for (const [field] of VIEW_BLOCK_FIELDS) expect(objects).toContain(`\`u.${field}\``);
  });

  it("DK-10: a quoted ICE declaration is its doc comment and its whole body — and a missing one throws, never a stale page", () => {
    const tool = quotedDeclaration("core/src/widget/held-tools.d.ts", "HeldToolDef");
    expect(tool.startsWith("/** One tool of the held bar")).toBe(true);
    expect(tool).toContain('readonly kind?: "mode" | "action";');
    expect(tool.trimEnd().endsWith("}")).toBe(true);
    expect(() => quotedDeclaration("core/src/widget/held-tools.d.ts", "NoSuchDeclaration")).toThrow(
      /no exported declaration of NoSuchDeclaration/,
    );
  });

  it("DK-0f: objects.md shows the golden object manifest, and names the retired widget fields", () => {
    const objects = docs.get("objects.md") ?? "";
    const start = objects.indexOf("```json\n");
    expect(start).toBeGreaterThan(0);
    const block = objects.slice(start + "```json\n".length, objects.indexOf("\n```", start));
    const slice = JSON.parse(block) as unknown[];
    expect(Array.isArray(slice) && slice.length).toBe(1);
    for (const field of ["surface", "sizeMode", "preview", "category", "defaultSize", "maxSize"])
      expect(objects, `objects.md never says where ${field} went`).toContain(`\`${field}\``);
  });

  it("shows a complete minimal manifest an author can copy", () => {
    const readme = docs.get("README.md") ?? "";
    const start = readme.indexOf('{\n  "manifestVersion"');
    expect(start).toBeGreaterThan(0);
    const block = readme.slice(start, readme.indexOf("\n```", start));
    expect(validatePluginManifest(JSON.parse(block)).ok).toBe(true);
  });
});
