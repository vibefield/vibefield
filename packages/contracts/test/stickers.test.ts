// OB-D16 (2026-11-25) — an object's sticker as a kind declares it (`contributes.objects[].sticker`), the art's own law
// (`stickerArtProblems`, which `check` refuses on and fieldd serves by), and `plugins.stickers`' answer.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isStickerArtPath,
  ObjectSticker,
  PluginStickersResult,
  STICKER_LIMITS,
  stickerArtProblems,
  stickerViewBox,
  validatePluginManifest,
} from "../src";

type Row = Record<string, unknown>;

const withSticker = (sticker: unknown) => {
  const manifest = JSON.parse(
    readFileSync(join(__dirname, "../fixtures/plugin-manifest.objects.json"), "utf8"),
  ) as { contributes: { objects: Row[] } };
  const row = manifest.contributes.objects[0] as Row;
  row.sticker = sticker;
  return validatePluginManifest(manifest);
};

const messages = (result: ReturnType<typeof validatePluginManifest>): readonly string[] =>
  result.ok ? [] : result.issueDetails.map((issue) => issue.message);

const ART =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32"/></svg>';

describe("a kind's sticker declaration", () => {
  it("is optional to the parser: a kind without one is taken", () => {
    expect(withSticker(undefined).ok).toBe(true);
  });

  it("takes an SVG under assets with its cut, its paint from a declared prop, and its name", () => {
    const result = withSticker({
      art: "./assets/sticker.svg",
      radius: 16,
      paint: [
        { prop: "style", slot: "--face", values: { classic: "#ffffff" }, fallback: "#f1f0ee" },
      ],
      name: "zone",
    });
    expect(messages(result)).toEqual([]);
  });

  it("refuses art that is not an .svg under ./assets/", () => {
    for (const art of [
      "./dist/sticker.svg",
      "./assets/sticker.png",
      "./assets/../x.svg",
      "assets/x.svg",
      "./assets/a:b.svg",
    ])
      expect(isStickerArtPath(art), art).toBe(false);
    expect(withSticker({ art: "./dist/sticker.svg", radius: 2 }).ok).toBe(false);
  });

  it("refuses paint from a prop the kind does not declare, a slot filled twice, and a name it cannot read", () => {
    const said = messages(
      withSticker({
        art: "./assets/sticker.svg",
        radius: 2,
        paint: [
          { prop: "colour", slot: "--a", values: {}, fallback: "#000000" },
          { prop: "style", slot: "--a", values: {}, fallback: "#000000" },
        ],
        name: "nickname",
      }),
    );
    expect(said).toEqual(
      expect.arrayContaining([
        "a sticker paints from a prop the kind declares; colour is not one",
        "the slot --a is filled twice",
        "a sticker is named from a prop the kind declares; nickname is not one",
      ]),
    );
  });

  it("holds a slot to a custom property, its colours to #rrggbb, and its values to the limit", () => {
    const paint = (patch: Record<string, unknown>) =>
      ObjectSticker.safeParse({
        art: "./assets/s.svg",
        radius: 1,
        paint: [{ prop: "p", slot: "--ok", values: {}, fallback: "#000000", ...patch }],
      }).success;
    expect(paint({})).toBe(true);
    expect(paint({ slot: "fill" })).toBe(false);
    expect(paint({ fallback: "red" })).toBe(false);
    expect(paint({ values: { a: "url(#x)" } })).toBe(false);
    const many = Object.fromEntries(
      Array.from({ length: STICKER_LIMITS.PAINT_VALUES_MAX + 1 }, (_, i) => [`v${i}`, "#000000"]),
    );
    expect(paint({ values: many })).toBe(false);
  });
});

describe("the art's own law", () => {
  it("takes shapes, its own gradients and styles, and #id references", () => {
    const art =
      '<?xml version="1.0"?><!-- a likeness --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 32">' +
      '<style>.b{fill:var(--finish,#e0692a)}</style><defs><linearGradient id="g"/><clipPath id="c"><rect/></clipPath></defs>' +
      '<rect class="b" fill="url(#g)" clip-path="url(\'#c\')"/><use href="#g"/></svg>';
    expect(stickerArtProblems(art)).toEqual([]);
    expect(stickerViewBox(art)).toEqual({ x: 0, y: 0, width: 44, height: 32 });
  });

  it("refuses what a likeness may not hold", () => {
    const unsafe = [
      "<script>alert(1)</script>",
      '<rect onload="x()"/>',
      '<a href="#x"><rect/></a>',
      '<image href="photo.png"/>',
      "<foreignObject><div/></foreignObject>",
      '<use xlink:href="other.svg#a"/>',
      '<rect fill="url(https://example.com/x)"/>',
      "<style>@import 'x.css';</style>",
      "<animateTransform/>",
      '<rect fill="javascript:alert(1)"/>',
    ];
    for (const inner of unsafe) {
      const codes = stickerArtProblems(ART.replace("</svg>", `${inner}</svg>`)).map((p) => p.code);
      expect(codes.length, inner).toBeGreaterThan(0);
      expect(new Set(codes), inner).toEqual(new Set(["unsafe"]));
    }
    // a document type before the root: no art opens that way, so it is not one
    expect(stickerArtProblems(`<!DOCTYPE svg>${ART}`).map((p) => p.code)).toEqual(["not-svg"]);
  });

  it("holds its size, its root and its viewBox", () => {
    const codes = (text: string) => stickerArtProblems(text).map((p) => p.code);
    expect(
      codes(ART.replace("</svg>", `<!--${"x".repeat(STICKER_LIMITS.ART_BYTES)}--></svg>`)),
    ).toContain("too-large");
    expect(codes("<g/>")).toEqual(["not-svg"]);
    expect(codes("<svg><rect/></svg>")).toEqual(["viewbox"]);
    expect(codes('<svg viewBox="0 0 0 10"/>')).toEqual(["viewbox"]);
    expect(codes('<svg viewBox="0 0 300 300"/>')).toEqual(["viewbox"]);
    expect(codes('<svg viewBox="0 0 10 31"/>')).toEqual(["viewbox"]);
    expect(codes('<svg viewBox="0,0,10,30"/>')).toEqual([]);
  });
});

describe("plugins.stickers", () => {
  it("parses its fixture, and each row's art is sound", () => {
    const parsed = PluginStickersResult.parse(
      JSON.parse(readFileSync(join(__dirname, "../fixtures/plugins-stickers.valid.json"), "utf8")),
    );
    expect(parsed.stickers.map((row) => row.kind)).toEqual([
      "vibefield.simulator.phone",
      "vibefield.browser-pane.pane",
    ]);
    for (const row of parsed.stickers) expect(stickerArtProblems(row.svg)).toEqual([]);
  });
});
