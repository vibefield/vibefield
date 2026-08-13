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
import { cell, DOC_FILES, generateDocs } from "../src/docs-generate";
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
    // is literally `onStartup | onWidget:…`.
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
      "ctx.widgets.register",
      "conflict group",
      "plugin-build",
      "dev-link",
      "manifestHash",
      "onStartup",
      "hud.side-panel",
      "x.<pluginId>",
    ])
      expect(all, `nothing tells an author about ${topic}`).toContain(topic);
  });

  it("shows a complete minimal manifest an author can copy", () => {
    const readme = docs.get("README.md") ?? "";
    const start = readme.indexOf('{\n  "manifestVersion"');
    expect(start).toBeGreaterThan(0);
    const block = readme.slice(start, readme.indexOf("\n```", start));
    expect(validatePluginManifest(JSON.parse(block)).ok).toBe(true);
  });
});
