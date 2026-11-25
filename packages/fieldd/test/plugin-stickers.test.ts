// OB-D16 (2026-11-25) — `plugins.stickers`: each enabled plugin's sticker art, read from its installed bundle, held to
// the law `check` refuses on, and served whole or not at all; read once per registry change.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PluginRecord, PluginStickersResult, STICKER_LIMITS } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginStickerShelf, pluginStickers } from "../src/objects/stickers";

const ART =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 32"><rect width="44" height="32"/></svg>';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** An installed plugin's root with its art files written. */
function installed(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "vf-fieldd-stickers-"));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return root;
}

const object = (type: string, sticker?: Record<string, unknown>) => ({
  type,
  title: type,
  schemaVersion: 1,
  size: { w: 10, h: 10 },
  props: {},
  groups: {},
  binding: { kind: "x" },
  ...(sticker === undefined ? {} : { sticker }),
});

const record = (id: string, enabled: boolean, objects: unknown[]): PluginRecord =>
  ({ id, enabled, contributions: { objects } }) as unknown as PluginRecord;

describe("plugins.stickers", () => {
  it("serves an enabled plugin's sound art with its cut, its paint and its name", () => {
    const root = installed({ "assets/sticker.svg": ART });
    const paint = [
      { prop: "finish", slot: "--finish", values: { a: "#112233" }, fallback: "#000000" },
    ];
    const { rows, refused } = pluginStickers(
      [
        record("vibefield.browser-pane", true, [
          object("vibefield.browser-pane.pane", {
            art: "./assets/sticker.svg",
            radius: 6,
            paint,
            name: "url",
          }),
          object("vibefield.browser-pane.plain"),
        ]),
      ],
      () => root,
    );
    expect(refused).toEqual([]);
    expect(rows).toEqual([
      {
        plugin: "vibefield.browser-pane",
        kind: "vibefield.browser-pane.pane",
        svg: ART,
        radius: 6,
        paint,
        name: "url",
      },
    ]);
    expect(PluginStickersResult.safeParse({ stickers: rows }).success).toBe(true);
  });

  it("serves nothing of a disabled plugin", () => {
    const root = installed({ "assets/sticker.svg": ART });
    const { rows } = pluginStickers(
      [record("p", false, [object("p.k", { art: "./assets/sticker.svg", radius: 1 })])],
      () => root,
    );
    expect(rows).toEqual([]);
  });

  it("leaves out whole, and says why, art that is missing, too large or unsafe", () => {
    const root = installed({
      "assets/big.svg": ART.replace(
        "</svg>",
        `<!--${"x".repeat(STICKER_LIMITS.ART_BYTES)}--></svg>`,
      ),
      "assets/script.svg": ART.replace("</svg>", "<script>1</script></svg>"),
    });
    const { rows, refused } = pluginStickers(
      [
        record("p", true, [
          object("p.missing", { art: "./assets/none.svg", radius: 1 }),
          object("p.big", { art: "./assets/big.svg", radius: 1 }),
          object("p.script", { art: "./assets/script.svg", radius: 1 }),
        ]),
      ],
      () => root,
    );
    expect(rows).toEqual([]);
    expect(refused.map((refusal) => [refusal.kind, refusal.reasons[0]])).toEqual([
      ["p.missing", "the art is not on disk"],
      ["p.big", expect.stringContaining("over the 8192 a sticker carries")],
      ["p.script", "the art holds a script"],
    ]);
  });

  it("is read once and again after each registry change", () => {
    const root = installed({ "assets/sticker.svg": ART });
    let records = [record("p", true, [object("p.k", { art: "./assets/sticker.svg", radius: 1 })])];
    let reads = 0;
    let changed: (() => void) | undefined;
    const shelf = createPluginStickerShelf({
      snapshot: () => {
        reads += 1;
        return records;
      },
      rootPath: () => root,
      onChanged: (listener) => {
        changed = listener;
      },
    });
    expect(shelf.read().stickers).toHaveLength(1);
    expect(shelf.read().stickers).toHaveLength(1);
    expect(reads).toBe(1);
    records = [];
    changed?.();
    expect(shelf.read().stickers).toEqual([]);
    expect(reads).toBe(2);
  });
});
