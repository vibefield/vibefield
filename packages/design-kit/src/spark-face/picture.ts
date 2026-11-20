import { SPARK_FRAME, type Sparklings, sparkFaceScale } from "./engine";
import { type FlatStarEye, flatStar } from "./flat-star";
import { drawStill, type StillFace, stillKey } from "./stills";

// A face as a picture a host draws (DESIGN.md §2.10; TH-3, 2026-11-19): the still the window's one canvas
// draws, or, where the window has no WebGL2, the flat star as an SVG picture. Either way it is a
// `data:image/…` URL, so a view draws it without fetching anything, and it is never a blank. A view
// draws a host's picture inside its own box, so a free face is drawn edge to edge, with no room for its
// props (DESIGN.md §2.10's Godview row): its star fills the box at its own size.

/** A face's picture. The same key promises the same picture. */
export interface SparkPicture {
  readonly key: string;
  /** a `data:image/png` still, or a `data:image/svg+xml` flat star */
  readonly image: string;
}

/** The flat star in the star's radii: the one drawing behind the face's SVG and its picture. */
export interface FlatStarFigure {
  /** the box, the disc's when framed and the star's when free */
  readonly box: { readonly x: number; readonly y: number; readonly side: number };
  /** the body's glow: its centre, its middle, its rim */
  readonly glow: readonly [string | undefined, string | undefined, string | undefined];
  /** the palette's backdrop, top then bottom: a framed face's disc */
  readonly deep: readonly [string | undefined, string | undefined];
  /** a framed face's disc: its centre's height and its radius; null when free */
  readonly disc: { readonly cy: number; readonly r: number } | null;
  readonly outline: string;
  readonly eyes: readonly [FlatStarEye, FlatStarEye];
}

/** A face's flat star (DESIGN.md §2.10), or null for a seed whose palette the engine does not hold. */
export function flatStarFigure(
  engines: Sparklings,
  face: { readonly seed: number; readonly size: number; readonly framed: boolean },
): FlatStarFigure | null {
  const dna = engines.agentDNA(face.seed);
  const palette = engines.PALETTES[dna.palette];
  if (!palette) return null;
  const shape = flatStar(
    engines.makeBody(dna.seed, dna.body),
    engines.makeEyes(dna.seed, dna.eyes),
    sparkFaceScale(face.size),
  );
  const [, centre, middle, rim] = palette.c;
  const [top, bottom] = palette.deep;
  const radius = SPARK_FRAME.frameH;
  // the box is the disc: the star sits 6% of its radius below the disc's centre; free, it is centred
  const lift = face.framed ? SPARK_FRAME.frameC[1] : 0;
  return {
    box: { x: -radius, y: -radius - lift, side: radius * 2 },
    glow: [centre, middle, rim],
    deep: [top, bottom],
    disc: face.framed ? { cy: -lift, r: radius } : null,
    outline: shape.outline,
    eyes: shape.eyes,
  };
}

/** The face's picture: its still, or its flat star where the window has no WebGL2. Null only for a
 * seed whose palette the engine does not hold, so the host draws no picture rather than a blank. */
export function sparkPicture(
  engines: Sparklings,
  face: Omit<StillFace, "room">,
): SparkPicture | null {
  const edgeToEdge: StillFace = { ...face, room: 1 };
  const still = drawStill(engines, edgeToEdge);
  if (still !== null) {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    return { key: `still|${stillKey(edgeToEdge, pixelRatio)}`, image: still };
  }
  const figure = flatStarFigure(engines, face);
  if (figure === null) return null;
  return {
    key: ["flat", face.seed, face.size, face.framed ? "framed" : "free"].join("|"),
    image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(flatStarSvg(figure, face))}`,
  };
}

const escaped = (value: string): string =>
  value.replace(/[&<>"]/gu, (character) => `&#${character.charCodeAt(0)};`);

/** One attribute, left out when it has no value, as React leaves it out. */
const attribute = (name: string, value: string | number | undefined): string =>
  value === undefined ? "" : ` ${name}="${escaped(String(value))}"`;

const stop = (offset: string, colour: string | undefined): string =>
  `<stop${attribute("offset", offset)}${attribute("stop-color", colour)}/>`;

/** The figure as an SVG document, edge to edge in the face's own box. */
function flatStarSvg(figure: FlatStarFigure, face: { readonly size: number }): string {
  const box = [figure.box.x, figure.box.y, figure.box.side, figure.box.side].join(" ");
  const [centre, middle, rim] = figure.glow;
  const [top, bottom] = figure.deep;
  const disc = figure.disc
    ? `<circle cx="0"${attribute("cy", figure.disc.cy)}${attribute("r", figure.disc.r)} fill="url(#disc)"/>`
    : "";
  const eyes = figure.eyes
    .map(
      (eye) =>
        `<rect${attribute("x", eye.x)}${attribute("y", eye.y)}${attribute("width", eye.width)}` +
        `${attribute("height", eye.height)}${attribute("rx", eye.width / 2)}${attribute("fill", rim)}/>`,
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"${attribute("width", face.size)}${attribute("height", face.size)}` +
    `${attribute("viewBox", box)}>` +
    `<defs><radialGradient id="body">${stop("0", centre)}${stop("0.55", middle)}${stop("1", rim)}` +
    `</radialGradient><linearGradient id="disc" x1="0" y1="0" x2="0" y2="1">${stop("0", top)}` +
    `${stop("1", bottom)}</linearGradient></defs>` +
    `${disc}<path${attribute("d", figure.outline)} fill="url(#body)"/>${eyes}</svg>`
  );
}
