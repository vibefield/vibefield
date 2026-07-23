import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePluginManifest } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../src/canonical";
import { emitManifest } from "../src/emit";

// Shaped like packages/contracts/fixtures/plugin-manifest.valid.json — the
// minimal real plugin (a renderer-only note widget, spec §7.2-adjacent).
const VALID_MANIFEST = {
  manifestVersion: 1,
  id: "com.example.notes",
  version: "0.1.0",
  title: "Example Notes",
  description: "A renderer-only note widget — the minimal real plugin",
  engines: { app: "^0.1.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: ["onWidget:com.example.notes"],
  capabilities: ["doc.write"],
  contributes: {
    widgets: [
      {
        type: "com.example.notes",
        title: "Note",
        description: "A sticky note",
        category: "Cards",
        preview: { kind: "color", value: "#F6E7A9" },
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 260, h: 180 },
        minSize: { w: 120, h: 90 },
        props: {
          text: { kind: "string", default: "", maxLength: 4000 },
          color: { kind: "enum", options: ["yellow", "blue", "pink"], default: "yellow" },
        },
        groups: { text: ["text"], color: ["color"] },
      },
    ],
  },
};

function tempOutPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "plugin-build-test-"));
  return join(dir, "vibefield.plugin.json");
}

describe("emitManifest", () => {
  it("throws with every validation issue joined into the message, and writes nothing", () => {
    const broken = { manifestVersion: 1, id: "NOT-VALID-ID!", title: "" };
    const outPath = tempOutPath();

    const validation = validatePluginManifest(broken);
    expect(validation.ok).toBe(false);

    let thrown: unknown;
    try {
      emitManifest(broken, outPath);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    if (!validation.ok) {
      for (const issue of validation.issues) {
        expect((thrown as Error).message).toContain(issue);
      }
    }
    expect(existsSync(outPath)).toBe(false); // a broken manifest fails at build — nothing is written
  });

  it("writes the canonical form of the PARSED (validated + defaulted) manifest to outPath", () => {
    const outPath = tempOutPath();

    const { unknownKeys } = emitManifest(VALID_MANIFEST, outPath);
    expect(unknownKeys).toEqual([]);

    const validation = validatePluginManifest(VALID_MANIFEST);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(readFileSync(outPath, "utf8")).toBe(canonicalJson(validation.manifest));
    }
  });

  it("surfaces unknown top-level keys without failing the build", () => {
    const outPath = tempOutPath();
    const withUnknown = { ...VALID_MANIFEST, futureField: "from a newer host" };

    const { unknownKeys } = emitManifest(withUnknown, outPath);
    expect(unknownKeys).toEqual(["futureField"]);
    expect(existsSync(outPath)).toBe(true); // unknown keys warn, they don't refuse emit
  });
});
