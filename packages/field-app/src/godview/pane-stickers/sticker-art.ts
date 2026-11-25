import {
  type ObjectStickerPaint,
  PluginStickersResult,
  stickerViewBox,
} from "@vibefield/contracts";
import { useSyncExternalStore } from "react";
import { BUILT_IN_STICKERS } from "../../field/desk/agent-kinds/stickers";
import { subscribePluginRegistry } from "../../plugin-host/plugin-registry-store";

/**
 * OB-D16 (2026-11-25) — EVERY KIND'S STICKER ART, HELD FOR THE WINDOW. The built-ins' art is the app's own
 * (`agent-kinds/stickers`); a plugin kind's comes from its bundle through fieldd (`plugins.stickers`), read once and again
 * on every registry change. The art is text, and it is only ever drawn as an IMAGE (`stickerArtUrl`): an image runs no
 * script and loads nothing, so art that reached the window is a picture whatever it holds.
 */
export interface StickerArt {
  readonly kind: string;
  readonly svg: string;
  /** the cut's corner, in the art's own units */
  readonly radius: number;
  /** the art's viewBox sides */
  readonly width: number;
  readonly height: number;
  readonly paint?: readonly ObjectStickerPaint[] | undefined;
  /** the prop that names one object */
  readonly name?: string | undefined;
}

/** What the store asks of a fieldd client: one request door. */
export interface StickerDoorClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
}

function artOf(
  kind: string,
  svg: string,
  radius: number,
  paint?: readonly ObjectStickerPaint[],
  name?: string,
): StickerArt | undefined {
  const box = stickerViewBox(svg);
  if (box === undefined || !(box.width > 0 && box.height > 0)) return undefined;
  return { kind, svg, radius, width: box.width, height: box.height, paint, name };
}

const BUILT_INS: ReadonlyMap<string, StickerArt> = new Map(
  Object.entries(BUILT_IN_STICKERS).flatMap(([kind, sticker]) => {
    const art = artOf(kind, sticker.svg, sticker.radius);
    return art === undefined ? [] : [[kind, art] as const];
  }),
);

let byKind: ReadonlyMap<string, StickerArt> = BUILT_INS;
let client: StickerDoorClient | null = null;
let asking: Promise<void> | null = null;
let again = false;
let unwatch: (() => void) | null = null;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of [...listeners]) listener();
};

async function ask(door: StickerDoorClient): Promise<void> {
  try {
    const answer = PluginStickersResult.safeParse(await door.request("plugins.stickers", {}));
    if (!answer.success) return;
    const next = new Map(BUILT_INS);
    for (const row of answer.data.stickers) {
      const art = artOf(row.kind, row.svg, row.radius, row.paint, row.name);
      if (art !== undefined) next.set(row.kind, art);
    }
    byKind = next;
    emit();
  } catch {
    // the door did not answer: the art held stands, and the next registry change asks again
  }
}

function read(): void {
  const door = client;
  if (door === null) return;
  if (asking !== null) {
    again = true;
    return;
  }
  asking = ask(door).finally(() => {
    asking = null;
    if (again) {
      again = false;
      read();
    }
  });
}

/** The door the plugins' art comes through: asked now, and again whenever the registry changes. */
export function connectStickerArt(door: StickerDoorClient): void {
  if (client === door) return;
  client = door;
  unwatch ??= subscribePluginRegistry(read);
  read();
}

export function stickerArtOf(kind: string): StickerArt | undefined {
  return byKind.get(kind);
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = (): ReadonlyMap<string, StickerArt> => byKind;

export function useStickerArts(): ReadonlyMap<string, StickerArt> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Each slot's colour for an object's props: its value's, else the slot's fallback. */
export function stickerFills(
  art: StickerArt,
  props: Readonly<Record<string, unknown>>,
): readonly (readonly [slot: string, colour: string])[] {
  return (art.paint ?? []).map((paint) => {
    const value = props[paint.prop];
    const colour = typeof value === "string" ? paint.values[value] : undefined;
    return [paint.slot, colour ?? paint.fallback] as const;
  });
}

const urls = new WeakMap<StickerArt, Map<string, string>>();

/** The art as an image URL, its slots filled on its root (a parsed copy, never markup in the page). */
export function stickerArtUrl(art: StickerArt, props: Readonly<Record<string, unknown>>): string {
  const fills = stickerFills(art, props);
  const key = fills.map(([slot, colour]) => `${slot}:${colour}`).join(";");
  let held = urls.get(art);
  const cached = held?.get(key);
  if (cached !== undefined) return cached;
  let text = art.svg;
  if (
    fills.length > 0 &&
    typeof DOMParser !== "undefined" &&
    typeof XMLSerializer !== "undefined"
  ) {
    const doc = new DOMParser().parseFromString(art.svg, "image/svg+xml");
    const root = doc.documentElement;
    if (root.localName === "svg" && doc.getElementsByTagName("parsererror").length === 0) {
      const style = [
        root.getAttribute("style") ?? "",
        ...fills.map(([slot, colour]) => `${slot}:${colour}`),
      ]
        .filter((part) => part.length > 0)
        .join(";");
      root.setAttribute("style", style);
      text = new XMLSerializer().serializeToString(doc);
    }
  }
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
  if (held === undefined) {
    held = new Map();
    urls.set(art, held);
  }
  held.set(key, url);
  return url;
}

/** Tests only: the store as a fresh window has it. */
export function resetStickerArtForTests(): void {
  byKind = BUILT_INS;
  client = null;
  asking = null;
  again = false;
  unwatch?.();
  unwatch = null;
  emit();
}
