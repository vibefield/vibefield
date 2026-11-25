import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type PluginRecord,
  type PluginStickerRow,
  type PluginStickersResult,
  STICKER_LIMITS,
  stickerArtProblems,
} from "@vibefield/contracts";

// OB-D16 (2026-11-25) — the stickers Godview's panes wear while an agent holds an object (`contracts/src/stickers.ts`):
// each enabled plugin's kind that declares one, its art read from the plugin's installed bundle, held to the same
// problems `vibefield-plugin check` refuses, and served as text by `plugins.stickers`. A kind whose art is missing or
// refused is left out whole and said in the log: the window then wears its paper label, never half a picture.

export interface StickerRefusal {
  readonly plugin: string;
  readonly kind: string;
  readonly art: string;
  readonly reasons: readonly string[];
}

export interface PluginStickers {
  readonly rows: readonly PluginStickerRow[];
  readonly refused: readonly StickerRefusal[];
}

/** One read of every enabled plugin's stickers. `rootPath` is the plugin's installed root (the registry's). */
export function pluginStickers(
  records: readonly PluginRecord[],
  rootPath: (id: string) => string | undefined,
): PluginStickers {
  const rows: PluginStickerRow[] = [];
  const refused: StickerRefusal[] = [];
  for (const record of records) {
    if (!record.enabled) continue;
    const root = rootPath(record.id);
    for (const object of record.contributions.objects) {
      const sticker = object.sticker;
      if (sticker === undefined) continue;
      const refuse = (...reasons: string[]): void => {
        refused.push({ plugin: record.id, kind: object.type, art: sticker.art, reasons });
      };
      if (root === undefined) {
        refuse("the plugin has no installed root");
        continue;
      }
      // the declaration's path is ./assets/…svg with no `..` (the manifest's parser), so it stays inside the root
      const path = join(root, sticker.art);
      let text: string;
      try {
        const size = statSync(path).size;
        if (size > STICKER_LIMITS.ART_BYTES) {
          refuse(
            `the art is ${size} bytes, over the ${STICKER_LIMITS.ART_BYTES} a sticker carries`,
          );
          continue;
        }
        text = readFileSync(path, "utf8");
      } catch {
        refuse("the art is not on disk");
        continue;
      }
      const problems = stickerArtProblems(text);
      if (problems.length > 0) {
        refuse(...problems.map((problem) => problem.message));
        continue;
      }
      rows.push({
        plugin: record.id,
        kind: object.type,
        svg: text,
        radius: sticker.radius,
        ...(sticker.paint !== undefined ? { paint: sticker.paint } : {}),
        ...(sticker.name !== undefined ? { name: sticker.name } : {}),
      });
    }
  }
  return { rows, refused };
}

export interface PluginStickerShelfDeps {
  readonly snapshot: () => readonly PluginRecord[];
  readonly rootPath: (id: string) => string | undefined;
  /** the registry's change: the next read reads the bundles again */
  readonly onChanged: (listener: () => void) => void;
  readonly refused?: (refusal: StickerRefusal) => void;
}

/** `plugins.stickers`' answer, read once per registry change and held between. */
export function createPluginStickerShelf(deps: PluginStickerShelfDeps): {
  read(): PluginStickersResult;
} {
  let held: PluginStickersResult | undefined;
  deps.onChanged(() => {
    held = undefined;
  });
  return {
    read() {
      if (held !== undefined) return held;
      const { rows, refused } = pluginStickers(deps.snapshot(), deps.rootPath);
      for (const refusal of refused) deps.refused?.(refusal);
      held = { stickers: [...rows] };
      return held;
    },
  };
}
