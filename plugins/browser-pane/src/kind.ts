// THE BROWSER PANE as a kind (PT-1 — PORTALS' first, written exactly as a third party writes one: through
// `@vibefield/plugin-sdk/desk` alone, ICE design-016 K-L1/K-L2): its RENDER half (`browserPaneProgram` — its own pass
// and WGSL, made on the root's mat, spawned into every other slot) and its WORLD half — `resolve` the slab where it lies
// (cut to its size at its device's density, lifted by the desk's flux, seen from its own eye) under the desk's one lamp,
// `record` its glass, its page and its head from its props and its look, `hit` its slab as drawn (what is picked is what
// is drawn: the face, the arris — never a part at rest, so a drag anywhere on it moves it), the frame the desk's marks
// go round (the silhouette as its eye sees it), its look from the palette (theme.ts), its rung (the head's raster band),
// its desk state (the heads, the deferred pages' wake — local.ts) and its OPENING: picked up into the hand, read at the
// reading size — ICE's pick-up (design-015 §8), never a camera lean-in (PT-1 ruling 2).
//
// PT-3 — IN USE: in hand its page and its head's controls are NAMED PARTS (`heldPartAt` — at rest every point stays the pane),
// the wheel over it is the page's (`open.wheel: "kind"`), the cursor over its page is the page's own (`open.cursor`), Esc stays
// the desk's (one press puts it down), and the held bar's tools WORK — back, forward, reload (stop while it loads), the address
// (its DOM half's editor over the capsule — hand.ts), the device (PT-1's switch).

import {
  type HeldToolApi,
  type HeldToolDef,
  type HeldToolStateContext,
  type KindProgram,
  type LiveFace,
  type LiveInfo,
  type MarkFrame,
  type ObjectContext,
  type ObjectHit,
  type ObjectKind,
  type OpenBinding,
  type RungContext,
  type ShaderText,
  stringProp,
} from "@vibefield/plugin-sdk/desk";
import { displayOf, PROMPT } from "./address";
import { nextDevice } from "./device";
import { deviceIdentity, deviceOf } from "./devices";
import { handOf } from "./hand";
import { bandDensity, bandFor, headKey, headStateOf, rungFor } from "./head";
import { stillSplit } from "./head-still";
import { BROWSER_PANE_KIND, PANE_SCHEMES, type PaneScheme, SAMPLE_URL } from "./ids";
import {
  BROWSER,
  type BrowserLaw,
  castPane,
  glowReach,
  HELD_CONTROLS,
  type HeldPart,
  heldPartAt,
  openExtent,
  type PaneGeometry,
  type PaneShape,
  paneReach,
  resolvePane,
  shapeOf,
  silhouetteOf,
} from "./law";
import {
  type HeadPlan,
  livePlan,
  type PagePlan,
  type PaneInstance,
  type PaneLookValues,
} from "./layout";
import { isPageUrl } from "./live";
import { createPaneLocal, type PaneLocal } from "./local";
import { PanePass } from "./pass";
import { pageTexels } from "./sample-page";
import { paneShaders } from "./shaders";
import { type BrowserPanePalette, paneFinish, paneLook } from "./theme";

/** The pane's address from its props (none: the sample). */
export const urlOf = (props: Readonly<Record<string, unknown>>): string =>
  stringProp(props, "url", SAMPLE_URL);

/** The page's colour scheme: the pane's own, or the desk's (the pages follow the desk into dark — the default). */
export function schemeOf(
  props: Readonly<Record<string, unknown>>,
  theme: "light" | "dark",
): "light" | "dark" {
  const s = stringProp(props, "scheme", "desk");
  const scheme = ((PANE_SCHEMES as readonly string[]).includes(s) ? s : "desk") as PaneScheme;
  return scheme === "desk" ? theme : scheme;
}

/**
 * What the page shows with no live face: the sample web's landing page — a still the pass draws (sample-page.ts) — laid out
 * for the pane's viewport in its scheme, or nothing for any other address (the dark film — a web page's before its first
 * frame, and where no host lends `LIVE`; PT-2's live page is the face's texture, `livePlan`).
 */
export function pagePlan(url: string, S: PaneShape, scheme: "light" | "dark"): PagePlan | null {
  if (url !== SAMPLE_URL) return null;
  const [width, height] = pageTexels(S.viewport);
  return {
    key: `sample|${S.viewport[0]}x${S.viewport[1]}|${scheme}|${width}x${height}`,
    viewport: S.viewport,
    scheme,
    width,
    height,
  };
}

/** A held control's act from the bar (or its chord, when the keymap has it): the hand on this world runs it on the pane in hand. */
const runControl =
  (control: HeldPart) =>
  (api: HeldToolApi): void =>
    handOf(api.world)?.tool(api.entity, control);

/** A held page's words as a tool's state reads them: off the pane's desk state (ICE I49 — `HeldToolStateContext.local`);
 * none where no desk answers, or the pane shows no live page (a still, the film). */
const infoOf = (c: HeldToolStateContext): LiveInfo | undefined =>
  (c.local as PaneLocal | undefined)?.page(c.entity)?.info;

/** ↻ while the page loads: Stop — the head's ✕. */
export const STOP_GLYPH = { path: "M7 7 L17 17 M17 7 L7 17" } as const;

/**
 * The held bar's tools (PT-3 ruling 8) — ACTIONS: ‹ back, › forward, ↻ reload through the page's navigation, the ADDRESS (the
 * one editor over the head's capsule), the DEVICE (PT-1's switch, to the next device). The chords are the browser's (⌘[ ⌘] ⌘R
 * ⌘L) — while the page's lease holds the keys, the lease runs them (ruling 7). PT-5a (ruling 2; ICE I49) — each SAYS ITS STATE,
 * read with the anchor: ‹ and › are DISABLED where the page has nowhere to go (a still has nowhere), and ↻ reads STOP — its
 * glyph the head's ✕, its label — while the page loads. The bar and the head say the same truth now.
 */
export const PANE_TOOLS: readonly HeldToolDef[] = [
  {
    id: "back",
    label: "Back",
    kind: "action",
    keys: ["mod+["],
    hint: "⌘[",
    glyph: { path: "M14.5 5.5 L8 12 L14.5 18.5" },
    run: runControl("back"),
    state: (c) => ({ enabled: infoOf(c)?.back === true }),
  },
  {
    id: "forward",
    label: "Forward",
    kind: "action",
    keys: ["mod+]"],
    hint: "⌘]",
    glyph: { path: "M9.5 5.5 L16 12 L9.5 18.5" },
    run: runControl("forward"),
    state: (c) => ({ enabled: infoOf(c)?.forward === true }),
  },
  {
    id: "reload",
    label: "Reload",
    kind: "action",
    keys: ["mod+r"],
    hint: "⌘R",
    glyph: { path: "M18.5 12 A6.5 6.5 0 1 1 15.6 6.6 M18.5 4.5 V9 H14" },
    run: runControl("reload"),
    state: (c) =>
      infoOf(c)?.loading !== undefined ? { glyph: STOP_GLYPH, label: "Stop" } : undefined,
  },
  {
    id: "address",
    label: "Address",
    kind: "action",
    keys: ["mod+l"],
    hint: "⌘L",
    glyph: { path: "M7 8.5 H17 A3.5 3.5 0 0 1 17 15.5 H7 A3.5 3.5 0 0 1 7 8.5 Z" },
    run: runControl("address"),
  },
  {
    id: "device",
    label: "Device",
    kind: "action",
    glyph: { path: "M6 6.5 H18 V15.5 H6 Z M3.5 18.5 H20.5" },
    run: nextDevice,
  },
];

/** The pane's program for a host's shader text (the kit's pieces from it; its own from shaders.ts): its pass on the root's mat. */
export function browserPaneProgram(text?: ShaderText): KindProgram<PaneInstance> {
  return {
    name: BROWSER_PANE_KIND,
    stratum: "things",
    create: async (device, format, mat) => PanePass.create(device, format, paneShaders(text), mat),
  };
}

export interface BrowserPaneKindOptions {
  /** The host's shader text for the kit's pieces; the desk's generated module unless a host says. */
  readonly text?: ShaderText;
  readonly law?: BrowserLaw;
}

/** The pane's OPENING: picked up into the hand at the reading size — the page and the head — its word the address as printed. */
export function paneOpening(law: BrowserLaw = BROWSER): OpenBinding {
  return {
    // the page plus the head, in the pane's own desk units, centred as its rect is
    extent: ({ rect, props }) => openExtent(rect, shapeOf(rect, deviceOf(props.device), law)),
    pose: "camera",
    tools: PANE_TOOLS,
    // PT-3 — the wheel over it is its page's (the hand never pans for it); Esc the desk's (one press puts it down)
    wheel: "kind",
    escape: "desk",
    // the cursor over its page is the page's own; over a control the head's (a lit chevron, the reload, the capsule)
    cursor: ({ entity, part, local }) => {
      const info = (local as PaneLocal | undefined)?.page(entity)?.info;
      if (part === "page") return info?.cursor;
      if (part === "back") return info?.back === true ? "pointer" : undefined;
      if (part === "forward") return info?.forward === true ? "pointer" : undefined;
      return (HELD_CONTROLS as readonly string[]).includes(part) ? "pointer" : undefined;
    },
    // a live page's word is its TITLE when it has one (PT-4 ruling 5 — the address stays on the head's capsule), else the
    // address it is at (its producer's truth — a redirect's); a still's the address it was given
    readout: ({ props, entity, local }) => {
      const info = (local as PaneLocal | undefined)?.page(entity)?.info;
      return info?.title?.trim() || displayOf(info?.address ?? urlOf(props())) || PROMPT;
    },
  };
}

/** The pane's kind, whole (`ObjectKind`): its program and its world half. */
export function browserPaneKind(
  opts: BrowserPaneKindOptions = {},
): ObjectKind<PaneGeometry, PaneInstance, PaneLookValues> {
  const law = opts.law ?? BROWSER;
  return {
    ...browserPaneProgram(opts.text),
    reach: paneReach(law),
    // the record reads the view's zoom and dpr ONLY through the head's band: a zoom within a rung remakes nothing
    rung: (c: RungContext): number => rungFor(c.zoom * c.dpr),
    local: (host) => createPaneLocal(host),
    resolve(ctx: ObjectContext): PaneGeometry {
      const S = shapeOf(ctx.rect, deviceOf(ctx.props.device), law);
      // by night a lit page's glow reaches round the pane: the quad grows to hold it (a still's, or a live page's)
      const url = urlOf(ctx.props);
      const lit = ctx.theme.name === "dark" && (url === SAMPLE_URL || isPageUrl(url, SAMPLE_URL));
      return resolvePane(
        ctx.rect,
        ctx.flux,
        S,
        ctx.lamp,
        law,
        lit ? glowReach(law) : 0,
        ctx.held !== undefined,
      );
    },
    record(G: PaneGeometry, ctx: ObjectContext): PaneInstance {
      const look = ctx.look as PaneLookValues | undefined;
      if (look === undefined)
        throw new Error(
          "browser-pane: no look — the desk hands every kind the look its `theme` makes",
        );
      const url = urlOf(ctx.props);
      const S = G.shape;
      const scheme = schemeOf(ctx.props, ctx.theme.name);
      const local = ctx.local as PaneLocal | undefined;
      // PT-2 — a web page is a LIVE FACE the host opens by the pane's durable key; any other address closes the one it had
      let face: LiveFace | undefined;
      if (isPageUrl(url, SAMPLE_URL))
        face = local?.face(
          ctx.entity,
          {
            source: "browser",
            url,
            viewport: S.viewport,
            deviceScaleFactor: S.device.dpr,
            scheme,
            label: displayOf(url) || "Browser",
            // PT-4 — the device the page is seen as: its layout, its fingers, the agent it announces
            device: deviceIdentity(S.device),
          },
          S,
        );
      else local?.drop(ctx.entity);
      if (face !== undefined) {
        // PT-3 — the url it read (one that moved under the page is followed), and, in hand, where the hand's points land
        local?.follow(ctx.entity, url);
        if (ctx.held !== undefined)
          local?.laid(ctx.entity, G, openExtent(ctx.rect, S), ctx.view.zoom);
      }
      const words = face === undefined ? undefined : local?.page(ctx.entity);
      // PT-4 — the page's favicon as the head can print it now (its picture decoded), the generic mark where it has none
      const state = headStateOf(url, S, words?.info, local?.icon(ctx.entity, words?.info));
      const tpu = bandDensity(S, bandFor(ctx.view.zoom * ctx.view.dpr));
      const laid = local?.head(ctx.entity, S, state, tpu);
      const key = laid?.key ?? headKey(S, state, tpu);
      const bitmap = laid?.bitmap;
      // no service lent (a Node still): the committed raster this head's key names, if one says it — else none
      const split =
        bitmap !== undefined
          ? { height: bitmap.height, h: bitmap.h, at: bitmap.at }
          : stillSplit(key);
      const head: HeadPlan =
        bitmap !== undefined
          ? { key, bitmap, split }
          : split !== undefined
            ? { key, still: key, split }
            : { key };
      const t = face?.texture();
      return {
        geometry: G,
        finish: paneFinish(look, stringProp(ctx.props, "finish", "low-iron")),
        look,
        // a live page's texture once its first frame lands (the film before), the sample's still, or the film
        page:
          face === undefined
            ? pagePlan(url, S, scheme)
            : t === undefined
              ? null
              : livePlan(t, S.viewport, scheme),
        brightness: 1,
        loading: words?.info.loading ?? -1,
        head,
        ...(face === undefined || local === undefined
          ? {}
          : { live: { e: ctx.entity, face, sight: local.sight } }),
      };
    },
    // what is drawn is what is picked: the slab as its eye sees it — the face, the arris (a wall, were one seen). At rest
    // every point of it is the pane itself (`content`): a drag on the head or the page moves it. IN HAND (PT-3 ruling 2) its
    // page and its head's controls are named parts — presses there are the kind's (`heldPartAt`), the rest is the pane's.
    hit: (G: PaneGeometry, wx: number, wy: number): ObjectHit | null =>
      G.held === true ? heldPartAt(G, wx, wy) : castPane(G, wx, wy) === null ? null : "content",
    // the desk's marks go round the silhouette as the pane's own eye sees it (its corner, magnified as it is)
    frame: (G: PaneGeometry): MarkFrame => {
      const s = silhouetteOf(G);
      return { cx: s.cx, cy: s.cy, hx: s.hx, hy: s.hy, angle: 0, r: s.r };
    },
    theme: (palette): PaneLookValues => paneLook(palette as BrowserPanePalette),
    open: paneOpening(law),
  };
}
