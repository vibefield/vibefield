// THE BROWSER PANE as a kind (PT-1 — PORTALS' first, written exactly as a third party writes one: through
// `@vibefield/plugin-sdk/desk` alone, ICE design-016 K-L1/K-L2): its RENDER half (`browserPaneProgram` — its own pass
// and WGSL, made on the root's mat, spawned into every other slot) and its WORLD half — `resolve` the slab where it lies
// (cut to its size at its device's density, lifted by the desk's flux, seen from its own eye) under the desk's one lamp,
// `record` its glass, its page and its head from its props and its look, `hit` its slab as drawn (what is picked is what
// is drawn: the face, the arris — never a part at rest, so a drag anywhere on it moves it), the frame the desk's marks
// go round (the silhouette as its eye sees it), its look from the palette (theme.ts), its rung (the head's raster band),
// its desk state (the heads, the deferred pages' wake — local.ts) and its OPENING: picked up into the hand, read at the
// reading size — ICE's pick-up (design-015 §8), never a camera lean-in (PT-1 ruling 2).

import {
  type HeldToolDef,
  type KindProgram,
  type LiveFace,
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
import { deviceOf } from "./devices";
import { bandDensity, bandFor, headKey, headStateOf, rungFor } from "./head";
import { stillSplit } from "./head-still";
import { BROWSER_PANE_KIND, PANE_SCHEMES, type PaneScheme, SAMPLE_URL } from "./ids";
import {
  BROWSER,
  type BrowserLaw,
  castPane,
  glowReach,
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

/** The held bar's tools — DECLARED ONLY in PT-1 (no `kind`: the bar shows them dim and nothing runs them; PT-3 works them). */
export const PANE_TOOLS: readonly HeldToolDef[] = [
  { id: "back", label: "Back", hint: "⌘[", glyph: { path: "M14.5 5.5 L8 12 L14.5 18.5" } },
  { id: "forward", label: "Forward", hint: "⌘]", glyph: { path: "M9.5 5.5 L16 12 L9.5 18.5" } },
  {
    id: "reload",
    label: "Reload",
    hint: "⌘R",
    glyph: { path: "M18.5 12 A6.5 6.5 0 1 1 15.6 6.6 M18.5 4.5 V9 H14" },
  },
  {
    id: "address",
    label: "Address",
    hint: "⌘L",
    glyph: { path: "M7 8.5 H17 A3.5 3.5 0 0 1 17 15.5 H7 A3.5 3.5 0 0 1 7 8.5 Z" },
  },
  { id: "device", label: "Device", glyph: { path: "M6 6.5 H18 V15.5 H6 Z M3.5 18.5 H20.5" } },
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
    extent: ({ rect, props }) => {
      const S = shapeOf(rect, deviceOf(props.device), law);
      const top = -S.half[1];
      const foot = S.page[1] + S.page[3];
      return { cx: rect.cx, cy: rect.cy + (top + foot) / 2, w: 2 * S.page[2], h: foot - top };
    },
    pose: "camera",
    tools: PANE_TOOLS,
    // a live page's word is the address it is at (its producer's truth — a redirect's), a still's the one it was given
    readout: ({ props, entity, local }) =>
      displayOf((local as PaneLocal | undefined)?.page(entity)?.info.address ?? urlOf(props())) ||
      PROMPT,
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
      return resolvePane(ctx.rect, ctx.flux, S, ctx.lamp, law, lit ? glowReach(law) : 0);
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
          },
          S,
        );
      else local?.drop(ctx.entity);
      const words = face === undefined ? undefined : local?.page(ctx.entity);
      const state = headStateOf(url, S, words?.info);
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
    // every point of it is the pane itself (`content`): a drag on the head or the page moves it. The parts are named by
    // the law (`pickPane`, `controlAt`) for the pane in use — PT-3's.
    hit: (G: PaneGeometry, wx: number, wy: number): ObjectHit | null =>
      castPane(G, wx, wy) === null ? null : "content",
    // the desk's marks go round the silhouette as the pane's own eye sees it (its corner, magnified as it is)
    frame: (G: PaneGeometry): MarkFrame => {
      const s = silhouetteOf(G);
      return { cx: s.cx, cy: s.cy, hx: s.hx, hy: s.hy, angle: 0, r: s.r };
    },
    theme: (palette): PaneLookValues => paneLook(palette as BrowserPanePalette),
    open: paneOpening(law),
  };
}
