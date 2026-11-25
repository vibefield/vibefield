import { z } from "zod";

// OB-D16 (2026-11-25; DESIGN.md §8 "At work, in the pane") — an object's STICKER: its likeness, cut to its shape, which a
// Godview pane wears while that pane's agent holds the object. A kind declares it once, at the kind's own row beside its
// agent half (`contributes.objects[].sticker`), and the art ships in the kind's own bundle under `assets/`. The parser
// takes a kind without one (no installed plugin is refused for it); `vibefield-plugin check` refuses a kind WITH an agent
// half and none, because an object an agent can hold is one Godview must be able to show. The window draws the paper
// edge, the cut and the cast around the art (§2.8's sticker) and fills its paint slots from the object's own props.

export const STICKER_LIMITS = {
  /** the art file, at most: a likeness is a handful of shapes */
  ART_BYTES: 8192,
  /** neither side of the art's viewBox above this, in its own units */
  VIEWBOX_MAX: 256,
  /** the long side over the short, at most: a thing's outline, never a strip */
  ASPECT_MAX: 3,
  /** the slots a kind fills from its props */
  PAINT_SLOTS_MAX: 4,
  /** the values one slot maps to colours: every finish of every iPhone the simulator draws is 84 */
  PAINT_VALUES_MAX: 128,
  /** an art path's length, as the manifest's other asset paths */
  PATH_MAX: 256,
} as const;

/** The art ships only under `assets/` (`pack.ts` bundles `dist` and `assets`), as an SVG file. */
export const STICKER_DIR = "./assets/";

/** A ./-relative POSIX path under `assets/` naming an `.svg`: no `..`, no scheme, no backslash. */
export function isStickerArtPath(p: string): boolean {
  if (p.length === 0 || p.length > STICKER_LIMITS.PATH_MAX) return false;
  if (!p.startsWith(STICKER_DIR) || !/\.svg$/i.test(p)) return false;
  if (p.includes("\0") || p.includes("\\") || p.includes(":")) return false;
  return p
    .slice(2)
    .split("/")
    .every((s) => s.length > 0 && s !== "." && s !== "..");
}

const StickerColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a colour is #rrggbb");

/** One slot of the art the window fills from a prop of the object: the iOS Simulator's body takes its model's finish. */
export const ObjectStickerPaint = z
  .object({
    /** the object's prop whose value picks the colour: a prop the kind declares */
    prop: z.string().min(1).max(64),
    /** the custom property of the art's root the colour fills; the art reads it as `var(--finish, …)` */
    slot: z
      .string()
      .regex(/^--[a-z][a-z0-9-]{0,31}$/, "a slot is a custom property, --lowercase-words"),
    /** the prop's values, each to its colour */
    values: z
      .record(z.string().min(1).max(64), StickerColour)
      .refine(
        (values) => Object.keys(values).length <= STICKER_LIMITS.PAINT_VALUES_MAX,
        `a slot maps at most ${STICKER_LIMITS.PAINT_VALUES_MAX} values`,
      ),
    /** the colour for a value not in `values`, or none */
    fallback: StickerColour,
  })
  .passthrough();
export type ObjectStickerPaint = z.infer<typeof ObjectStickerPaint>;

export const ObjectSticker = z
  .object({
    /** an SVG under `assets/`, at most `STICKER_LIMITS.ART_BYTES`: the object's likeness, its viewBox the cut's box */
    art: z
      .string()
      .refine(isStickerArtPath, `the art is an .svg under ${STICKER_DIR}, ./-relative, no ..`),
    /** the cut's corner radius in the art's viewBox units: half the short side cuts a pill, or a circle */
    radius: z
      .number()
      .min(0)
      .max(STICKER_LIMITS.VIEWBOX_MAX / 2),
    /** the slots the window fills from the object's props */
    paint: z.array(ObjectStickerPaint).max(STICKER_LIMITS.PAINT_SLOTS_MAX).optional(),
    /** the prop whose value names one object, said beside the kind's title when the sticker is pointed at (a page's
     * `url`); absent: the kind's title alone */
    name: z.string().min(1).max(64).optional(),
  })
  .passthrough();
export type ObjectSticker = z.infer<typeof ObjectSticker>;

export interface StickerProblem {
  readonly message: string;
  readonly path: readonly (string | number)[];
}

/** The declaration's own law, beside the manifest's other object rules: each slot paints from a prop the kind declares,
 * no slot is filled twice, and the name is read from a declared prop. */
export function stickerDeclarationProblems(
  sticker: Pick<ObjectSticker, "paint" | "name">,
  declaredProps: readonly string[],
): readonly StickerProblem[] {
  const out: StickerProblem[] = [];
  if (sticker.name !== undefined && !declaredProps.includes(sticker.name))
    out.push({
      message: `a sticker is named from a prop the kind declares; ${sticker.name} is not one`,
      path: ["name"],
    });
  const slots = new Set<string>();
  for (const [index, paint] of (sticker.paint ?? []).entries()) {
    if (!declaredProps.includes(paint.prop))
      out.push({
        message: `a sticker paints from a prop the kind declares; ${paint.prop} is not one`,
        path: ["paint", index, "prop"],
      });
    if (slots.has(paint.slot))
      out.push({
        message: `the slot ${paint.slot} is filled twice`,
        path: ["paint", index, "slot"],
      });
    slots.add(paint.slot);
  }
  return out;
}

export type StickerArtProblemCode = "too-large" | "not-svg" | "viewbox" | "unsafe";

export interface StickerArtProblem {
  readonly code: StickerArtProblemCode;
  readonly message: string;
}

export interface StickerViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What the art may not hold. The window draws it as an image, which runs no script and loads nothing, so these are a
 * second wall and the art's hygiene: a likeness is still shapes, its own gradients and its own styles. Motion is the
 * window's (the art never animates), and every reference stays inside the file. */
const UNSAFE: readonly (readonly [RegExp, string])[] = [
  [/<!doctype|<!entity/i, "declares a document type or an entity"],
  [/<script\b/i, "holds a script"],
  [/<(foreignobject|iframe|object|embed|audio|video|canvas)\b/i, "embeds foreign content"],
  [/<image\b/i, "draws an image of another file"],
  [/<a\b/i, "holds a link"],
  [/<(animate|animatemotion|animatetransform|set|discard)\b/i, "animates itself"],
  [/\son[a-z]+\s*=/i, "carries an event handler"],
  [/javascript:/i, "names a javascript: address"],
  [
    /(?:^|[\s"'])(?:xlink:)?href\s*=\s*(["'])(?!#)/i,
    "refers outside itself (an href that is not #id)",
  ],
  [/url\(\s*["']?(?!["'#])/i, "refers outside itself (a url() that is not #id)"],
  [/@import\b/i, "imports a style"],
];

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

/** The root `<svg …>` tag, after an optional BOM, XML declaration, comments and whitespace; undefined when the file does
 * not open with one. */
function rootTag(text: string): string | undefined {
  let rest = text.replace(/^﻿/, "");
  for (;;) {
    const trimmed = rest.replace(/^\s+/, "");
    if (trimmed.startsWith("<?xml")) {
      const end = trimmed.indexOf("?>");
      if (end < 0) return undefined;
      rest = trimmed.slice(end + 2);
    } else if (trimmed.startsWith("<!--")) {
      const end = trimmed.indexOf("-->");
      if (end < 0) return undefined;
      rest = trimmed.slice(end + 3);
    } else {
      rest = trimmed;
      break;
    }
  }
  const open = /^<svg[\s>/]/.exec(rest);
  if (open === null) return undefined;
  const end = rest.indexOf(">");
  return end < 0 ? undefined : rest.slice(0, end + 1);
}

/** The art's viewBox, read off its root tag; undefined when it has none that four finite numbers spell. */
export function stickerViewBox(text: string): StickerViewBox | undefined {
  const tag = rootTag(text);
  if (tag === undefined) return undefined;
  const found = /\sviewBox\s*=\s*(["'])([^"']*)\1/.exec(tag);
  if (found === null) return undefined;
  const parts = (found[2] ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length !== 4 || !parts.every(Number.isFinite)) return undefined;
  const [x = 0, y = 0, width = 0, height = 0] = parts;
  return { x, y, width, height };
}

/** Every reason the art cannot be a sticker: its size, its root, its viewBox, and anything it may not hold. Empty: it
 * can. `vibefield-plugin check` refuses on these, and fieldd serves no art that has one. */
export function stickerArtProblems(text: string): readonly StickerArtProblem[] {
  const out: StickerArtProblem[] = [];
  const bytes = utf8Length(text);
  if (bytes > STICKER_LIMITS.ART_BYTES)
    out.push({
      code: "too-large",
      message: `the art is ${bytes} bytes, over the ${STICKER_LIMITS.ART_BYTES} a sticker carries`,
    });
  if (rootTag(text) === undefined) {
    out.push({ code: "not-svg", message: "the art does not open with an <svg> element" });
    return out;
  }
  const box = stickerViewBox(text);
  if (box === undefined)
    out.push({ code: "viewbox", message: "the art's <svg> has no viewBox of four numbers" });
  else if (!(box.width > 0 && box.height > 0))
    out.push({ code: "viewbox", message: "the art's viewBox has no area" });
  else if (box.width > STICKER_LIMITS.VIEWBOX_MAX || box.height > STICKER_LIMITS.VIEWBOX_MAX)
    out.push({
      code: "viewbox",
      message: `the art's viewBox is over ${STICKER_LIMITS.VIEWBOX_MAX} on a side`,
    });
  else if (
    Math.max(box.width, box.height) / Math.min(box.width, box.height) >
    STICKER_LIMITS.ASPECT_MAX
  )
    out.push({
      code: "viewbox",
      message: `the art's viewBox is longer than ${STICKER_LIMITS.ASPECT_MAX} times its width: a sticker is a thing's outline`,
    });
  for (const [pattern, why] of UNSAFE)
    if (pattern.test(text)) out.push({ code: "unsafe", message: `the art ${why}` });
  return out;
}

/** One kind's sticker as fieldd serves it to the window (`plugins.stickers`): the declaration with its art read from the
 * plugin's installed bundle and found sound. */
export const PluginStickerRow = z
  .object({
    plugin: z.string().min(1).max(128),
    kind: z.string().min(1).max(128),
    svg: z.string().min(1).max(STICKER_LIMITS.ART_BYTES),
    radius: z
      .number()
      .min(0)
      .max(STICKER_LIMITS.VIEWBOX_MAX / 2),
    paint: z.array(ObjectStickerPaint).max(STICKER_LIMITS.PAINT_SLOTS_MAX).optional(),
    name: z.string().min(1).max(64).optional(),
  })
  .passthrough();
export type PluginStickerRow = z.infer<typeof PluginStickerRow>;

/** `plugins.stickers` — every enabled plugin's kind that declares a sticker whose art is on disk and sound. A kind whose
 * art is missing or refused is left out, never sent half. */
export const PluginStickersResult = z
  .object({
    stickers: z.array(PluginStickerRow).max(512),
  })
  .passthrough();
export type PluginStickersResult = z.infer<typeof PluginStickersResult>;
