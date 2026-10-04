import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePluginManifest } from "@vibefield/contracts";
import { canonicalJson } from "@vibefield/plugin-build";
import { CONTAINABLE, DESK_OBJECT, isObjectKind, PENS } from "@vibefield/plugin-sdk/desk";
import { activateWithMockHost } from "@vibefield/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  COMMENT_PAD_CATEGORY,
  COMMENT_PAD_TYPE,
  commentPadManifest,
  commentPadRenderer,
  PAD_ACCENTS,
  PAD_PENS,
  PAD_SIZE,
} from "../src";
import * as rendererModule from "../src/renderer";

// The pad's contract in miniature (DK-8): its manifest V1-validates and is committed as its own canonical
// emission; its one OBJECT row names an export of the renderer module whose kind the host will take — a desk
// kind whose registry name IS the row's type; its placement keys are the SDK's own; its writing is ONE cell;
// it hangs under its own category; and its activation binds nothing (the kind is a static export).
describe("vibefield.comment-pad", () => {
  const row = commentPadManifest.contributes?.objects?.[0];

  it("declares one object and no widget, bound by name to the renderer module's export — a desk kind named by its type", () => {
    expect(commentPadManifest.contributes?.widgets).toBeUndefined();
    expect(commentPadManifest.contributes?.objects).toHaveLength(1);
    expect(row?.type).toBe(COMMENT_PAD_TYPE);
    // the host reads a row's kind off the module's NAMESPACE by its binding name (spec §12.8)
    const exported = (rendererModule as unknown as Record<string, { kind?: unknown }>)[
      row?.binding.kind ?? ""
    ];
    const kind = exported?.kind;
    expect(isObjectKind(kind)).toBe(true);
    expect(isObjectKind(kind) ? kind.name : undefined).toBe(row?.type);
  });

  it("places by the SDK's keys — on the desk and into a mini mat — never by a list that names it", () => {
    expect(row?.provides).toEqual([COMMENT_PAD_TYPE, DESK_OBJECT, CONTAINABLE]);
  });

  it("keeps its writing in ONE cell, `ink` — the text and its seeds, written in one transaction, never split", () => {
    expect(row?.groups).toEqual({ ink: ["text", "seeds"] });
    expect(Object.keys(row?.props ?? {}).sort()).toEqual([
      "accent",
      "pen",
      "seed",
      "seeds",
      "text",
    ]);
  });

  it("hangs on the pegboard under its OWN category, at its own aspect (the specimen fills its hang)", () => {
    const tray = row?.tray;
    expect(tray?.category).toBe(COMMENT_PAD_CATEGORY);
    expect(["paper", "surfaces", "things"]).not.toContain(tray?.category);
    expect(tray?.hang.accessory).toBe("hook");
    expect((tray?.hang.w ?? 0) / PAD_SIZE.w).toBeCloseTo((tray?.hang.h ?? 0) / PAD_SIZE.h, 9);
    expect(row?.size).toEqual(PAD_SIZE);
  });

  it("writes with the kit's pens by name (the inks are the host's) and wears one of DESIGN.md §2.6's accents", () => {
    expect([...PAD_PENS]).toEqual([...PENS]);
    const pen = row?.props.pen;
    expect(pen?.kind === "enum" ? pen.options : undefined).toEqual([...PENS]);
    const accent = row?.props.accent;
    expect(accent?.kind === "enum" ? accent.options : undefined).toEqual([...PAD_ACCENTS]);
    expect(PAD_ACCENTS).toHaveLength(8);
  });

  it("activates as any plugin does, binding no command, surface or behavior — its kind is its export", async () => {
    const session = await activateWithMockHost(commentPadRenderer, {
      id: commentPadManifest.id,
      version: commentPadManifest.version,
    });
    expect([...session.commands.keys()]).toEqual([]);
    expect([...session.surfaces.keys()]).toEqual([]);
    await session.close();
  });

  it("keeps the committed manifest byte-identical to its validated canonical emission", () => {
    const result = validatePluginManifest(commentPadManifest);
    if (!result.ok) throw new Error(result.issues.join(" · "));
    const artifact = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "vibefield.plugin.json"),
      "utf8",
    );
    expect(artifact).toBe(canonicalJson(result.manifest));
  });
});
