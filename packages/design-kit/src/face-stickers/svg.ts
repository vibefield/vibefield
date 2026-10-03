import {
  FACE_STICKER_IDS,
  FACE_STICKERS,
  type FaceStickerId,
  type FaceStickerOptical,
} from "./data";

export type FaceStickerFinish = "sticker" | "artwork";
export const FACE_STICKER_DETAIL_AT = 40;

/** Same variation-selector policy as contracts.faceKey, without a wire dependency. */
const emojiKey = (value: string): string => value.replace(/[\uFE0E\uFE0F]/g, "");
const byEmoji = new Map(FACE_STICKER_IDS.map((id) => [emojiKey(FACE_STICKERS[id].emoji), id]));

/** Unknown/custom emoji deliberately return undefined, for the native face fallback. */
export function findFaceSticker(emoji: string): FaceStickerId | undefined {
  return byEmoji.get(emojiKey(emoji));
}

export function faceStickerOptical(size: number): FaceStickerOptical {
  return size < FACE_STICKER_DETAIL_AT ? "small" : "large";
}

export function faceStickerGeometry(name: FaceStickerId, optical: FaceStickerOptical) {
  return {
    drawing: FACE_STICKERS[name],
    shapes: FACE_STICKERS[name][optical],
    grid: optical === "large" ? 112 : 56,
    edge: optical === "large" ? 10 : 8,
  };
}

const attributes: Record<string, string> = {
  strokeWidth: "stroke-width",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  fillRule: "fill-rule",
};
const escapeXml = (value: string | number): string =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** Portable vector export; no React, fonts, filters, bitmap emoji, or external resources. */
export function faceStickerSvg(
  name: FaceStickerId,
  optical: FaceStickerOptical = "large",
  finish: FaceStickerFinish = "sticker",
): string {
  const { drawing, shapes, grid, edge } = faceStickerGeometry(name, optical);
  const render = (under: boolean): string =>
    shapes
      .map((shape) => {
        const attrs = under
          ? {
              ...shape.attrs,
              fill: "#fff",
              stroke: "#fff",
              strokeWidth: edge,
              strokeLinecap: "round",
              strokeLinejoin: "round",
            }
          : shape.attrs;
        return `<${shape.tag} ${Object.entries(attrs)
          .map(([key, value]) => `${attributes[key] ?? key}="${escapeXml(value)}"`)
          .join(" ")}/>`;
      })
      .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid} ${grid}" fill="currentColor" color="#171815" stroke="none"><title>${escapeXml(drawing.label)} — ${escapeXml(drawing.nickname)} (${optical})</title>${finish === "sticker" ? render(true) : ""}${render(false)}</svg>`;
}
