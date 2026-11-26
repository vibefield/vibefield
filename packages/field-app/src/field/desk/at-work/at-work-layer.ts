import { HOLD } from "@vibecook/ice/desk";
import type { MatLight } from "@vibecook/ice/desk/kit";
import type { SparkId } from "@vibefield/contracts";
import {
  createDrivenStage,
  type DrivenStage,
  loadSparklings,
  type Sparklings,
  type SparkStatus,
} from "@vibefield/design-kit/spark-face";
import type { PeersHidden } from "../peers/peers-model";
import {
  AT_WORK_ATLAS,
  type AtWorkAtlas,
  type AtWorkPrintedStar,
  createAtWorkAtlas,
} from "./at-work-atlas";
import { atWorkCovers } from "./at-work-hand";
import {
  type AtWorkInk,
  type AtWorkInks,
  type InkTone,
  type Rgb01,
  readAtWorkInks,
} from "./at-work-ink";
import {
  AT_WORK,
  AT_WORK_EASE,
  AT_WORK_STAR_PROPS,
  type AtWorkMarks,
  type AtWorkObjectState,
  type AtWorkStar,
  atWorkBoardWake,
  type ScreenFrame,
  stepAtWork,
} from "./at-work-model";
import {
  AT_WORK_CONTEXT,
  AT_WORK_FS,
  AT_WORK_ROWS,
  AT_WORK_VS,
  type AtWorkPencil,
  type AtWorkShaderColours,
  atWorkHandUniforms,
  atWorkLight,
  atWorkShaderColours,
} from "./at-work-shader";
import {
  AT_WORK_DOM_INKS,
  type AtWorkDrawnObject,
  type AtWorkForm,
  type AtWorkShape,
  atWorkIds,
  atWorkPlacementsOf,
  atWorkShapeOf,
} from "./at-work-shape";
import type { AtWorkBoard } from "./at-work-store";

// THE AT-WORK LAYER (item 550, 2026-11-18; DESIGN.md §8 "At work on the mat", §6 "At work on the mat", §2.10 "the desk
// is a stage"). VibeField's own WebGL2 layer over the desk: ICE 0.17.0 has no host pass, and a mark that moved inside
// ICE would redraw and wake the whole desk every frame. Each frame it is given the marked objects' frames ON SCREEN
// (the reflector's placement, `at-work-reflector.ts`, made in the same flush as the desk's compose, so it is exact to
// the camera), steps each object's pure model (`stepAtWork`), and draws them all in ONE instanced draw
// (`at-work-shader.ts`): per object a band of eight quads over the reach and glow only, and one quad per seat, the rows
// riding an RGBA32F data texture (`AT_WORK_ROWS`, written by `packAtWork` below into storage made once), never
// attributes.
//
// ONE CONTEXT PER WINDOW, MADE ON THE FIRST MARK (`atWorkContext`): never at a desk's mount, never by a read of the
// door; kept across desk remounts, as the spark stills' canvas is, a remount taking the same canvas into its own
// `.vf-atwork` box. Premultiplied (`AT_WORK_CONTEXT`), dpr up to 2. On `webglcontextlost` the DOM form takes over at
// once (a CSS stroke in the ink, the sticker a chip with `AgentIcon`: still, never a blank); on `webglcontextrestored`
// the program, the data texture and the atlas's texture are built again and the GL form returns. With no WebGL2, a root
// that spells no ink, or a window that can bake no sticker (`canBake`), the DOM form stands. Let go
// (WEBGL_lose_context) when the window goes. The sticker atlas is the window's too (`createAtWorkAtlas`: baked on the
// CPU, uploaded whenever its revision moves, and again after a restore).
//
// A SPARK'S LIVE STAR is drawn on this desk's own stage (DESIGN.md §2.10 "the desk is a stage"): the kit's driven stage
// (`createDrivenStage`) on a second canvas in the same box, above the overlay's ink and below the stills and the chips,
// made for the first live star and let go once none is live (each star is live while its work moves or its status
// changes, and for the desk's ambient after). It wears its spark's status as Chat's list holds it (`sparkStatus`, the
// one status on every surface), and with none it is its still; its props are on or off by `AT_WORK_STAR_PROPS`. The
// overlay places each face and renders the stage from its own frame, so a star and its line move as one; while the
// stage draws a star its still stands aside. The stage is made, and sized, OUTSIDE the desk's flush — after the frame
// that wants it, and on its box's resize — for its engine measures its canvas; in the frame it is only drawn. Where the
// stage cannot be had (no engine, no WebGL2, its context lost) the star is its still until no star is live.
//
// IDLE (DESIGN.md §6 "At rest", M5: zero frames while nothing moves). The layer draws inside the desk's flush while the
// desk steps (a pan, a lift); while the desk sleeps it runs its own rAF only while the model says a mark on screen
// moves or a live star is on its stage, and a timer for what comes with no new row (the needs-you ring every 2.4 s, a
// chip's end, a bud, a star's rest), sleeping between. A flush that brings nothing new while nothing moves draws
// nothing, and a frame run for a live star alone leaves the overlay as it stands. At most one draw a frame
// (`frameStamp`). The canvas is display:none with no mark on screen, and nothing draws while the layer is hidden (the
// desk not drawing, a cover, the board out). The DOM form is still: its marks are stepped as under reduced motion, so
// it asks for no frame it cannot show. Doors: `atWorkDraws()`, `atWorkStageFrames()`, `atWorkContexts()`,
// `atWorkStageContexts()`, `atWorkRecord()`.
//
// THE HAND'S COVER (2026-11-24; DESIGN.md §8 When not). While something is in hand, or flying home after the put-down,
// the scene carries its silhouette (`hand`); every object but the held one (`held`) is drawn as lying under it, the
// cover outlasting the dim while the desk comes back: its row says so and the shader masks its band and its seats (a
// sticker, a count) out of the silhouette by the pixel, a live star or a still or a chip whose centre it covers stands
// at none, and the DOM form hides such an object's frame whole where its reach meets the silhouette (`atWorkPlacementsOf`). A
// hand that moves is a new frame, as a camera move is.
//
// NO COLOUR IS WRITTEN HERE: every colour is a root token (the shader's `atWorkShaderColours`, the ink's
// `readAtWorkInks`), the toolkit's colour for a
// project, or a printed star's palette (the atlas), and reaches the shader as a uniform or a texel, or the stage as a
// face's ground; the light is the theme's (`atWorkLight` over ICE's `MatLight`). The tokens are read
// OUTSIDE the desk's flush, which never reads style: when the layer is attached, when its owner says the theme turned
// (`setTokens`), and on a timer when a scene's theme moved or a read found the root not yet spelled.

// ———————————————————————————————————————————————————————————————— the numbers

const MOST_OBJECTS = 64;

/** Item 550 (2026-11-18): the layer's own numbers. */
export const AT_WORK_GL = {
  maxDpr: 2,
  /** at most this many objects in one draw (a board with more draws the first, in the feed's order) */
  mostObjects: MOST_OBJECTS,
  /** the rows texture's height, made once: every object's row and its strokes' and seats', at the most objects */
  rows: MOST_OBJECTS * (1 + AT_WORK_ROWS.strokes + AT_WORK.seat.most),
  /** a token read that found the root not yet spelled (the stylesheet still arriving) is tried again this often, at
   * most this many times */
  tokenRetryMs: 250,
  tokenTries: 8,
} as const;

/** Item 550 (2026-11-18): while anything is in hand every other object's marks dim with the out-of-focus desk, at the
 * hand's own pace as the desk's blur and dim go (ICE's `HOLD`): over 560 ms as it is picked up and back over 440 ms as
 * it is put back, both on the island curve (DESIGN.md §6 "At work on the mat", Something in hand; §8 "At work on the
 * mat", When not). */
export const AT_WORK_FOCUS = {
  /** the level the other objects' marks dim to */
  dimmed: 0.35,
  /** the pickup's time and the put-back's: the hand's own (`HOLD.inMs`, `HOLD.outMs`) */
  inMs: HOLD.inMs,
  outMs: HOLD.outMs,
} as const;

// ———————————————————————————————————————————————————————————————— the scene a flush hands the layer

/** One marked object as the reflector placed it this frame. */
export interface AtWorkPlaced {
  /** the object's durable key */
  readonly key: string;
  /** its silhouette on screen, CSS px of the desk's box (lift, tilt, corner in; the hand's pose when in hand) */
  readonly frame: ScreenFrame;
  /** the person's hand is on it (in hand, dragged, a note being written) */
  readonly heldByYou: boolean;
  /** the desk's own fade of it (a delete's ghost), 0–1 */
  readonly fade: number;
  /** something else is in hand: its marks fade with the out-of-focus desk */
  readonly dimmed: boolean;
  /** it is the object the hand draws, in hand or flying home: the hand's cover never covers its own marks
   * (2026-11-24); every other object lies under the cover while a hand stands */
  readonly held: boolean;
}

/** What the reflector hands the layer each flush. */
export interface AtWorkScene {
  readonly board: AtWorkBoard;
  readonly placed: readonly AtWorkPlaced[];
  readonly zoom: number;
  /** the view, CSS px (the anchor's `view`); null: the layer's host as it last measured */
  readonly view: { readonly width: number; readonly height: number } | null;
  /** the mat's light as the theme states it (ICE's `matLight`): its night, and its night model's numbers */
  readonly light: MatLight;
  /** where the overlay keeps off the pencil (the shader's `uPencilBox`, `uPencilTurn`) */
  readonly pencil: AtWorkPencil;
  /** the silhouette of the object the hand draws on screen, in hand or flying home, which covers the marks of every
   * other object (the shader's `uHandBox`, `uHandTurn`; 2026-11-24, DESIGN.md §8 When not); null or absent with
   * nothing in hand */
  readonly hand?: ScreenFrame | null;
  /** the app's theme: when it turns, the tokens are read again, outside the flush */
  readonly theme: string;
}

// ———————————————————————————————————————————————————————————————— packing (PURE)

/** What the packing looks up: the atlas's cells, a crew run's printed star (by its spark), and whether a spark's own
 * star has a face to wear. */
export interface AtWorkCells {
  mark(agent: string): number | null;
  count(n: number): number | null;
  /** the spark's printed star; undefined while it is still to come (baking, or its seed not read yet) */
  star(spark: SparkId): AtWorkPrintedStar | null | undefined;
  crewSeat(markCell: number, starCell: number): readonly [number, number];
  /** whether the spark's face is dealt (its seed read): a star seat with none has no star over it, so it throws no
   * shadow (DESIGN.md §2.10) */
  face(spark: SparkId): boolean;
}

export interface AtWorkPacked {
  /** the rows, `width` texels a row from the first; the caller's buffer when it handed one */
  readonly data: Float32Array;
  /** texels a row (`AT_WORK_ROWS.texels`) and rows */
  readonly width: number;
  readonly height: number;
  readonly objects: number;
  readonly seats: number;
  readonly firstSeat: number;
  readonly instances: number;
}

/** The rows for one draw, as `at-work-shader.ts`'s table lays them: the objects' rows first (in the band instances'
 * order), then their strokes', then the seats' (in the seat instances' order). Written into `into` when it is large
 * enough (the rows it holds cleared first; the layer's one buffer, so a frame allocates none), else into a new array.
 * PURE but for `cells` and `into`. */
export function packAtWork(
  drawn: readonly Pick<AtWorkDrawnObject, "frame" | "marks" | "under">[],
  cells: AtWorkCells,
  into?: Float32Array,
): AtWorkPacked {
  const R = AT_WORK_ROWS;
  const objects = Math.min(drawn.length, AT_WORK_GL.mostObjects);
  let strokeRows = 0;
  let seatRows = 0;
  for (let i = 0; i < objects; i += 1) {
    const marks = drawn[i]?.marks;
    if (marks === undefined) continue;
    strokeRows += Math.min(marks.strokes.length, R.strokes);
    seatRows += Math.min(marks.seats.length, AT_WORK.seat.most);
  }
  const firstStroke = objects;
  const firstSeat = objects + strokeRows;
  const height = Math.max(firstSeat + seatRows, 1);
  const size = R.texels * height * 4;
  const data = into !== undefined && into.length >= size ? into : new Float32Array(size);
  if (data === into) data.fill(0, 0, size);
  const put = (row: number, texel: number, a: number, b: number, c: number, d: number): void => {
    const at = (row * R.texels + texel) * 4;
    data[at] = a;
    data[at + 1] = b;
    data[at + 2] = c;
    data[at + 3] = d;
  };
  const tone = (row: number, texel: number, rgb: Rgb01, w: number): void =>
    put(row, texel, rgb[0], rgb[1], rgb[2], w);
  /** an ink as it eases from another: its tones mixed here, in the encoded space, so the shader reads one ink */
  const mixed = (
    from: AtWorkInk,
    to: AtWorkInk,
    k: number,
    pick: (ink: AtWorkInk) => InkTone,
  ): Rgb01 => {
    const a = pick(from).encoded;
    const b = pick(to).encoded;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  };
  let stroke = firstStroke;
  let seat = firstSeat;
  for (let i = 0; i < objects; i += 1) {
    const one = drawn[i];
    if (one === undefined) continue;
    const { frame, marks, under } = one;
    const strokes = marks.strokes.slice(0, R.strokes);
    const O = R.object;
    put(i, O.frame, frame.cx, frame.cy, frame.hx, frame.hy);
    put(i, O.turn, Math.cos(frame.angle), Math.sin(frame.angle), frame.r, marks.inkScale);
    put(i, O.strokes, strokes.length, stroke, marks.clock / 1_000, under === true ? 1 : 0);
    for (const s of strokes) {
      const S = R.stroke;
      const ink = (pick: (ink: AtWorkInk) => InkTone): Rgb01 =>
        mixed(s.inkFrom, s.ink, s.inkMix, pick);
      put(stroke, S.motion, s.drawn, s.gap, s.travel, s.wet);
      tone(
        stroke,
        S.ink,
        ink((t) => t.base),
        s.glow,
      );
      tone(
        stroke,
        S.deep,
        ink((t) => t.deep),
        s.seam,
      );
      tone(
        stroke,
        S.leanA,
        ink((t) => t.leanA),
        s.quiet,
      );
      tone(
        stroke,
        S.leanB,
        ink((t) => t.leanB),
        s.close,
      );
      put(stroke, S.hand, s.seed, s.shiver, R.form[s.form], s.opacity);
      put(stroke, S.width, s.hw, 0, 0, 0);
      stroke += 1;
    }
    for (const s of marks.seats.slice(0, AT_WORK.seat.most)) {
      const E = R.seat;
      // a spark's star throws its shadow where the star is (riding its line's head as it arrives); its shiver is in
      // its place already
      const star = s.star;
      put(seat, E.place, star?.x ?? s.x, star?.y ?? s.y, i, R.seatForm[s.form]);
      tone(seat, E.ink, s.ink.base.encoded, s.seal);
      tone(seat, E.leanA, s.ink.leanA.encoded, s.lift);
      tone(seat, E.leanB, s.ink.leanB.encoded, s.sweep);
      // a sticker's and a count's cell is the atlas's: the GL form draws only where the window can bake one
      // (`canBake`), else the DOM form stands
      const cell =
        s.form === "sticker" ? cells.mark(s.agent) : s.form === "count" ? cells.count(s.count) : 0;
      put(seat, E.hand, s.seed, cell ?? 0, star === null ? s.shiver : 0, s.quiet);
      // a spark's star is seated (its shadow on the mat) once its line has run round: the model says how far; a star
      // seat whose face is not dealt yet has no star over it, so it packs no opacity and throws no shadow
      const faced = s.form !== "star" || (s.spark !== null && cells.face(s.spark));
      put(
        seat,
        E.ring,
        s.ring?.phase ?? 0,
        s.ring?.strength ?? 0,
        faced ? s.opacity : 0,
        star?.seated ?? 1,
      );
      const printed = s.form === "sticker" && s.crewSpark !== null ? cells.star(s.crewSpark) : null;
      if (printed !== null && printed !== undefined && cell !== null) {
        const [x, y] = cells.crewSeat(cell, printed.cell);
        put(seat, E.crew, printed.cell, s.crew, x, y);
        tone(seat, E.crewInk, printed.tone.c, 0);
        tone(seat, E.crewLeanA, printed.tone.a, 0);
        tone(seat, E.crewLeanB, printed.tone.b, 0);
      } else {
        put(seat, E.crew, R.noStar, 0, 0, 0);
      }
      seat += 1;
    }
  }
  return {
    data,
    width: R.texels,
    height,
    objects,
    seats: seatRows,
    firstSeat,
    instances: objects * R.pieces + seatRows,
  };
}

/** Whether any of an object's ink reaches into the view (its frame grown by the band's quads and a seat's). PURE. */
export function atWorkOnScreen(
  frame: ScreenFrame,
  marks: AtWorkMarks,
  view: { readonly width: number; readonly height: number },
): boolean {
  if (marks.strokes.length === 0 && marks.seats.length === 0) return false;
  const c = Math.abs(Math.cos(frame.angle));
  const s = Math.abs(Math.sin(frame.angle));
  // the band's quads reach the outermost gap and 48 past it; a seat's quad stands 46 round a seat past the band
  const out = (marks.reach + 48 + 2 * 46) * marks.inkScale;
  const ex = c * frame.hx + s * frame.hy + out;
  const ey = s * frame.hx + c * frame.hy + out;
  const across = frame.cx + ex > 0 && frame.cx - ex < view.width;
  return across && frame.cy + ey > 0 && frame.cy - ey < view.height;
}

// ———————————————————————————————————————————————————————————————— the window's one context

/** The window's WebGL2 context for the at-work marks, kept across desk remounts, and its sticker atlas. */
export interface AtWorkContext {
  readonly canvas: HTMLCanvasElement;
  /** the window's sticker atlas (baked on the CPU, so it outlives a lost context) */
  readonly atlas: AtWorkAtlas;
  /** it holds a WebGL2 context, lost or not; false where the window gave none */
  readonly webgl: boolean;
  /** the program and its textures, built; null with no WebGL2, while lost, or when the shader would not build */
  built(): AtWorkBuilt | null;
  /** why there is no GL form, or null while there is one */
  why(): string | null;
  /** told when the context is lost or restored */
  subscribe(fn: () => void): () => void;
}

export interface AtWorkBuilt {
  readonly gl: WebGL2RenderingContext;
  readonly program: WebGLProgram;
  readonly vao: WebGLVertexArrayObject;
  /** the rows' storage, `AT_WORK_ROWS.texels` × `AT_WORK_GL.rows` RGBA32F, made once a build */
  readonly rows: WebGLTexture;
  readonly atlas: WebGLTexture;
  /** the atlas's revision this texture holds (−1: none yet) */
  atlasRevision: number;
  readonly loc: (name: string) => WebGLUniformLocation | null;
}

/** How a layer reaches the window's context: a look that never makes one, and the factory (a test's stand-ins). */
export interface AtWorkContextDoor {
  /** the window's context if a mark has made it, else null */
  peek(): AtWorkContext | null;
  /** the window's context, made on the first ask; null where there is no document */
  make(): AtWorkContext | null;
}

/** Why there is no GL form: the door's words (never shown to a person, who sees the DOM form). */
const WHY = {
  unmade: "no mark has asked for the at-work context yet",
  none: "this window has no WebGL2",
  compile: "the at-work shader did not compile",
  link: "the at-work shader did not link",
  buffers: "the at-work layer could not make its buffers",
  lost: "the at-work context was lost",
} as const;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader;
  gl.deleteShader(shader);
  return null;
}

/** A texture sampled as the shader asks: NEAREST for the rows (`texelFetch`), LINEAR for the atlas's fields. Left
 * bound. */
function texture(gl: WebGL2RenderingContext, filter: number): WebGLTexture | null {
  const made = gl.createTexture();
  if (made === null) return null;
  gl.bindTexture(gl.TEXTURE_2D, made);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return made;
}

/** The program, the VAO and the two textures on `gl`, or why not. */
function build(gl: WebGL2RenderingContext): AtWorkBuilt | string {
  const vert = compile(gl, gl.VERTEX_SHADER, AT_WORK_VS);
  const frag = compile(gl, gl.FRAGMENT_SHADER, AT_WORK_FS);
  const program = gl.createProgram();
  if (vert === null || frag === null || program === null) return WHY.compile;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return WHY.link;
  // the draw reads no attribute (its corner is `gl_VertexID`, its instance `gl_InstanceID`); an empty VAO is bound so
  // no other attribute state reaches it
  const vao = gl.createVertexArray();
  const rows = texture(gl, gl.NEAREST);
  // the rows' storage, once a build: the most rows a draw can write; each draw writes its own rows into it
  if (rows !== null)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, AT_WORK_ROWS.texels, AT_WORK_GL.rows);
  const atlas = texture(gl, gl.LINEAR);
  if (vao === null || rows === null || atlas === null) return WHY.buffers;
  const locs = new Map<string, WebGLUniformLocation | null>();
  const loc = (name: string): WebGLUniformLocation | null => {
    if (!locs.has(name)) locs.set(name, gl.getUniformLocation(program, name));
    return locs.get(name) ?? null;
  };
  return { gl, program, vao, rows, atlas, atlasRevision: -1, loc };
}

/** The at-work context over `canvas` and `gl` (null: none), its atlas `atlas`: built at once, lost and restored with
 * its canvas. The window's factory (`atWorkContext`) makes one; a test hands its stand-ins. */
export function makeAtWorkContext(
  canvas: HTMLCanvasElement,
  atlas: AtWorkAtlas,
  gl: WebGL2RenderingContext | null,
): AtWorkContext {
  const listeners = new Set<() => void>();
  const tell = (): void => {
    for (const fn of [...listeners]) fn();
  };
  let built: AtWorkBuilt | null = null;
  let why: string | null = gl === null ? WHY.none : null;
  const make = (): void => {
    if (gl === null) return;
    const made = build(gl);
    built = typeof made === "string" ? null : made;
    why = typeof made === "string" ? made : null;
  };
  make();
  canvas.addEventListener("webglcontextlost", (event) => {
    // the DOM form at once; `preventDefault` asks the browser to restore the context
    event.preventDefault();
    built = null;
    why = WHY.lost;
    tell();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    // a new program, rows and atlas texture; the atlas's cells are the CPU's and are uploaded again
    make();
    tell();
  });
  return {
    canvas,
    atlas,
    webgl: gl !== null,
    built: () => built,
    why: () => why,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** A smoke's stand-in for what Chat's list would hold of a spark: its face seed and its status. */
export interface AtWorkLentSpark {
  readonly seed: number;
  readonly status: SparkStatus;
}

let windowContext: AtWorkContext | null = null;
let glDeclined = false;
let lentSparks: ReadonlyMap<string, AtWorkLentSpark> = new Map();

/** Item 550 (2026-11-18): the smokes' DOM-form switch. The desk door throws it on a page a smoke loaded with
 * `?atWorkGl=0` (its other doors' gate); from then on the window's factory makes its context with no WebGL2, as a
 * window that has none, so the DOM form is witnessed over a drawing desk. Nothing in the product throws it. */
export function declineAtWorkGl(): void {
  glDeclined = true;
}

/** Whether the smokes' switch stands (`declineAtWorkGl`). */
export function atWorkGlDeclined(): boolean {
  return glDeclined;
}

/** Item 550 (2026-11-18): the smokes' sparks. The desk door's fixture lends them on a page a smoke loaded with
 * `?atWorkFixture=1`: a smoke's window reads no spark of its own, so a fixture's spark is dealt its face and its status
 * here, as Chat's list would hold them, and its live star is drawn on the stage. A spark Chat has read keeps its own
 * seed and its own status. Nothing in the product lends any. */
export function lendAtWorkSparks(sparks: ReadonlyMap<string, AtWorkLentSpark>): void {
  lentSparks = sparks;
}

/** Item 550 (2026-11-18): a smoke's lent spark's face seed (`lendAtWorkSparks`), or null. The mount's seed door falls
 * back to it where Chat's list holds no seed, so the view's still of a lent spark stands once its stage is let go, as
 * the layer's own stage and shadow read it. Nothing in the product lends any: there it is always null. */
export function lentAtWorkSeed(spark: SparkId): number | null {
  return lentSparks.get(spark)?.seed ?? null;
}

/** The window's at-work context if a mark has made it, else null: never makes one. */
export function peekAtWorkContext(): AtWorkContext | null {
  return windowContext;
}

/** The window's one at-work context, made on the first ask: the first mark's (item 550, 2026-11-18). Null where there
 * is no document. */
export function atWorkContext(): AtWorkContext | null {
  if (windowContext !== null) return windowContext;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.className = "vf-atwork__canvas";
  canvas.setAttribute("aria-hidden", "true");
  const gl = glDeclined ? null : canvas.getContext("webgl2", AT_WORK_CONTEXT);
  windowContext = makeAtWorkContext(canvas, createAtWorkAtlas(), gl);
  if (gl !== null && typeof window !== "undefined") {
    // the window's context goes with the window, never left for the browser to evict another's
    window.addEventListener(
      "pagehide",
      () => {
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      },
      { once: true },
    );
  }
  return windowContext;
}

const WINDOW_CONTEXT: AtWorkContextDoor = { peek: peekAtWorkContext, make: atWorkContext };

// ———————————————————————————————————————————————————————————————— the live star's stage

/** How the layer draws a spark's live star: the kit's driven stage over a canvas of its own (a test's stand-ins). */
export interface AtWorkStageSeams {
  /** the spark engine (the kit's `loadSparklings`) */
  readonly load: () => Promise<Sparklings>;
  /** a driven stage over `canvas`, or null where it gives no WebGL2 (the kit's `createDrivenStage`) */
  readonly create: (canvas: HTMLCanvasElement, engines: Sparklings) => DrivenStage | null;
  /** a canvas for it, or null where there is no document */
  readonly canvas: () => HTMLCanvasElement | null;
}

const KIT_STAGE: AtWorkStageSeams = {
  load: loadSparklings,
  create: createDrivenStage,
  canvas: () => (typeof document === "undefined" ? null : document.createElement("canvas")),
};

/** This desk's stage while a live star is on it. */
interface OpenStage {
  readonly canvas: HTMLCanvasElement;
  readonly driven: DrivenStage;
  /** the ids its faces stand under (`atWorkIds.seat`) */
  faces: ReadonlySet<string>;
  /** the view it was last sized for */
  size: string;
  readonly lost: () => void;
}

// ———————————————————————————————————————————————————————————————— the layer seams and doors

export interface AtWorkLayerSeams {
  readonly now: () => number;
  /** the current animation frame's time (`document.timeline.currentTime`): one draw per value at most */
  readonly frameStamp: () => number | null;
  readonly requestFrame: (fn: () => void) => unknown;
  readonly cancelFrame: (handle: unknown) => void;
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
  /** whether the desk's own loop is awake now: then its flush draws this frame, and the layer's rAF does not */
  readonly deskAwake: () => boolean;
  /** a root token as the root spells it now: read outside the desk's flush only */
  readonly token: (name: string) => string;
  /** a spark's face seed (Chat's reading of its record), or null while it is not read */
  readonly sparkSeed: (spark: SparkId) => number | null;
  /** a spark's status as Chat's list holds it now, or null while it holds no entry for it (DESIGN.md §2.10): the face
   * its own star wears, read as the layer steps */
  readonly sparkStatus: (spark: SparkId) => SparkStatus | null;
  /** the window's context (a test's stand-ins) */
  readonly context?: AtWorkContextDoor;
  /** the live star's stage (a test's stand-ins) */
  readonly stage?: AtWorkStageSeams;
}

/** What the layer did — the door's read (`__vfDesk.atWork()`). */
export interface AtWorkLayerRecord {
  readonly form: AtWorkForm;
  readonly why: string | null;
  readonly hidden: PeersHidden;
  readonly objects: number;
  /** marks on screen at the last frame (0: the canvas is display:none) */
  readonly onScreen: number;
  /** the window's at-work WebGL2 context: 1 once the first mark has made it, else 0 */
  readonly contexts: number;
  /** this desk's live-star stage: 1 while a spark's live star is drawn on it, else 0 */
  readonly stageContexts: number;
  /** the draws and the stage's frames, window-wide */
  readonly draws: number;
  readonly stageFrames: number;
  readonly steps: number;
  readonly rafs: number;
  readonly timers: number;
  /** flush draws held to the next frame because the layer had drawn this one */
  readonly deferred: number;
  readonly writes: number;
  readonly renders: number;
  /** the layer's own rAF is running, and when its timer wakes it */
  readonly moving: boolean;
  readonly wakeAt: number | null;
}

export interface AtWorkLayer {
  /** Take this mount's `.vf-atwork` box as the canvases' home, and read the tokens. Returns the undo. */
  attach(host: HTMLElement): () => void;
  /** The flush's placement: step every marked object at now, and draw. */
  show(scene: AtWorkScene): void;
  /** Draw again now, from the last scene, outside any flush: something the scene does not carry moved (the sparks read
   * at last, a spark's status changed in Chat's list, a bake landed, the tokens read). */
  touch(): void;
  /** Read the root's tokens now, outside any flush (the theme turned): through `read`, or the seam's `token`. */
  setTokens(read?: (name: string) => string): void;
  /** The layer's verdict moved (the desk, a cover, the board): hidden, nothing draws and no loop runs. */
  setHidden(hidden: PeersHidden): void;
  setReducedMotion(reduced: boolean): void;
  /** The keys the layer still draws (a leaving mark's object stays placed until it has left). */
  drawing(): readonly string[];
  /** Whether a mark is on the board or still leaving: the reflector flushes always while so. */
  busy(): boolean;
  /** The desk went: every mark goes with it at once, with no leaving, and nothing is drawn. */
  drop(): void;
  /** The element React made for `id` (`atWorkIds`), placed by the layer from now on. Returns the unbind. */
  bind(id: string, el: HTMLElement): () => void;
  /** A ref for `id`'s element, the same function for the layer's life (React 19's ref with its cleanup). */
  ref(id: string): (el: HTMLElement | null) => (() => void) | undefined;
  /** The ref of the canvases' host (`attach`). */
  readonly host: (el: HTMLElement | null) => (() => void) | undefined;
  /** What React renders; the same object until it changes. */
  shape(): AtWorkShape;
  subscribe(fn: () => void): () => void;
  record(): AtWorkLayerRecord;
  dispose(): void;
}

let draws = 0;
let stageFrames = 0;
let renders = 0;
let stagesOpen = 0;
let latest: AtWorkLayer | null = null;

/** How many times the at-work layer has drawn, window-wide: the smokes' witness of zero at rest and under a cover. */
export function atWorkDraws(): number {
  return draws;
}

/** How many frames a spark's live star has been drawn on a desk's stage, window-wide: the smoke's "no stage frame 8 s
 * after the last touch". */
export function atWorkStageFrames(): number {
  return stageFrames;
}

/** The window's at-work WebGL2 contexts: 1 once the first mark has made it, else 0. */
export function atWorkContexts(): number {
  return windowContext?.webgl === true ? 1 : 0;
}

/** The live-star stages open now, window-wide (each one WebGL2 context, while a spark's live star is on its desk). */
export function atWorkStageContexts(): number {
  return stagesOpen;
}

/** How often the at-work view has rendered — the door's witness that a frame is never a render. */
export function atWorkRenders(): number {
  return renders;
}

/** Counts one render of the at-work view (its mount on the desk calls it as it renders). */
export function countAtWorkRender(): void {
  renders += 1;
}

/** The record of the at-work layer mounted now, or null. */
export function atWorkRecord(): AtWorkLayerRecord | null {
  return latest?.record() ?? null;
}

const NO_SHAPE: AtWorkShape = { form: "dom", hidden: null, objects: [] };
const NONE_STAGED: ReadonlySet<string> = new Set();

/** One object's focus: whether it stands dimmed, the level it faded from and when (−∞: it stands where it is). */
interface Focus {
  readonly dimmed: boolean;
  readonly from: number;
  readonly at: number;
}

const focusTarget = (dimmed: boolean): number => (dimmed ? AT_WORK_FOCUS.dimmed : 1);

/** How long a focus takes to its target: the pickup's 560 ms toward the dimmed level, the put-back's 440 back. */
const focusMs = (dimmed: boolean): number => (dimmed ? AT_WORK_FOCUS.inMs : AT_WORK_FOCUS.outMs);

/** A focus's level at `now`: from where it was toward its target over the hand's time, on the island curve. */
function focusLevel(f: Focus, now: number): number {
  const to = focusTarget(f.dimmed);
  const p = Math.min(Math.max((now - f.at) / focusMs(f.dimmed), 0), 1);
  return f.from + (to - f.from) * AT_WORK_EASE.island(p);
}

/** A view's size as the stage was last sized for it. */
const sizeKey = (view: { readonly width: number; readonly height: number }): string =>
  `${view.width}x${view.height}`;

/** A state whose live star asks for no frame: its stage cannot draw it, so it is a still. */
const withoutStage = (state: AtWorkObjectState): AtWorkObjectState =>
  state.marks.stageLive ? { ...state, marks: { ...state.marks, stageLive: false } } : state;

/** Why the layer runs a frame: the desk's flush, its own rAF, its timer, or a touch outside any flush. */
type RunWhy = "flush" | "frame" | "timer" | "touch";

export function createAtWorkLayer(seams: AtWorkLayerSeams): AtWorkLayer {
  const door = seams.context ?? WINDOW_CONTEXT;
  const kit = seams.stage ?? KIT_STAGE;
  const states = new Map<string, AtWorkObjectState>();
  const focus = new Map<string, Focus>();
  /** each object's focus level as last drawn: a frame whose level moved draws */
  const levels = new Map<string, number>();
  const els = new Map<string, HTMLElement>();
  const written = new Map<string, string>();
  const widths = new Map<string, number>();
  const refs = new Map<string, (el: HTMLElement | null) => (() => void) | undefined>();
  const listeners = new Set<() => void>();
  /** the rows' one buffer, written in place each draw */
  const rowsData = new Float32Array(AT_WORK_ROWS.texels * AT_WORK_GL.rows * 4);
  let host: HTMLElement | null = null;
  let hostSize: { width: number; height: number } = { width: 0, height: 0 };
  let observer: ResizeObserver | null = null;
  let scene: AtWorkScene | null = null;
  let epoch = -1;
  let hidden: PeersHidden = null;
  let reduced = false;
  // the root's tokens, read outside the flush; `tokensFor` is the theme of the scene they were read under
  let tokenReader = seams.token;
  let tokensFor: string | null | undefined;
  let tokenTimer: unknown = null;
  let tokenTries = 0;
  let inks: AtWorkInks | null = null;
  let colours: AtWorkShaderColours | null = null;
  let shape: AtWorkShape = NO_SHAPE;
  let shapeKey = "";
  let frame: unknown = null;
  let timer: unknown = null;
  let timerAt: number | null = null;
  let drawnStamp: number | null = null;
  let onScreen = 0;
  let canvasShown: boolean | null = null;
  let counts = { steps: 0, rafs: 0, timers: 0, deferred: 0, writes: 0, renders: 0 };
  let moving = false;
  let lastBoard: AtWorkBoard | null = null;
  let boards = 0;
  let drawnSignature = "";
  let followed: AtWorkContext | null = null;
  let unfollow: (() => void) | null = null;
  // the live star's stage
  let stage: OpenStage | null = null;
  /** the stage's making or sizing, asked from a frame and run after it (it measures its canvas) */
  let stageTimer: unknown = null;
  let engines: Sparklings | null = null;
  let loading = false;
  /** the stage cannot be had (no engine, no WebGL2, its context lost): the stars are stills until none is live */
  let stageRefused = false;
  /** a live star on screen is drawn on the stage, or will be once the engine is here: its frames are asked for */
  let stageWanted = false;

  /** a spark's face seed: as Chat reads its record, else a smoke's lent one, else null (not read yet) */
  const seedOf = (spark: SparkId): number | null =>
    seams.sparkSeed(spark) ?? lentSparks.get(spark)?.seed ?? null;

  /** a spark's status: as Chat's list holds it, else a smoke's lent one, else null (no entry: its still, no word) */
  const statusOf = (spark: SparkId): SparkStatus | null =>
    seams.sparkStatus(spark) ?? lentSparks.get(spark)?.status ?? null;

  const formNow = (): AtWorkForm => {
    const context = door.peek();
    return context !== null &&
      context.built() !== null &&
      context.atlas.canBake() &&
      inks !== null &&
      colours !== null
      ? "gl"
      : "dom";
  };

  const tell = (): void => {
    for (const fn of [...listeners]) fn();
  };

  /** The tokens, read now (never inside a flush): again a little later while the root does not spell them yet. */
  const readTokens = (): void => {
    if (tokenTimer !== null) seams.clearTimer(tokenTimer);
    tokenTimer = null;
    const nextInks = readAtWorkInks(tokenReader);
    const nextColours = atWorkShaderColours(tokenReader);
    const was = JSON.stringify([inks, colours]);
    const changed = JSON.stringify([nextInks, nextColours]) !== was;
    inks = nextInks;
    colours = nextColours;
    tokensFor = scene?.theme ?? null;
    if (inks !== null && colours !== null) tokenTries = 0;
    else if (tokenTries < AT_WORK_GL.tokenTries) {
      tokenTries += 1;
      tokenTimer = seams.setTimer(readTokens, AT_WORK_GL.tokenRetryMs);
    }
    if (changed) touch();
  };

  /** The scene's theme moved: the tokens are read again after this flush, never in it. */
  const askTokens = (): void => {
    if (tokenTimer !== null) return;
    tokenTries = 0;
    tokenTimer = seams.setTimer(readTokens, 0);
  };

  const viewOf = (s: AtWorkScene): { width: number; height: number } => s.view ?? hostSize;

  /** the DOM's elements placed, each property written only when it changed */
  const placeDom = (
    drawn: readonly AtWorkDrawnObject[],
    form: AtWorkForm,
    viewWidth: number,
    staged: ReadonlySet<string>,
    hand: ScreenFrame | null,
  ): void => {
    const widthOf = (id: string): number => widths.get(id) ?? 0;
    for (const place of atWorkPlacementsOf(drawn, form, widthOf, viewWidth, staged, hand)) {
      const el = els.get(place.id);
      if (el === undefined) continue;
      const said = `${place.transform}|${place.opacity ?? ""}|${JSON.stringify(place.vars)}`;
      if (written.get(place.id) === said) continue;
      el.style.transform = place.transform;
      if (place.opacity !== null) el.style.opacity = place.opacity;
      if (place.vars !== null)
        for (const [name, value] of Object.entries(place.vars)) el.style.setProperty(name, value);
      written.set(place.id, said);
      counts.writes += 1;
    }
  };

  /** the shape React renders: it moves only when an element comes or goes, never with a position */
  const reshape = (drawn: readonly AtWorkDrawnObject[], form: AtWorkForm): void => {
    const next = atWorkShapeOf(drawn, form, hidden);
    const key = JSON.stringify(next);
    if (key === shapeKey) return;
    shapeKey = key;
    shape = next;
    counts.renders += 1;
    tell();
  };

  const cancelLoops = (): void => {
    if (frame !== null) seams.cancelFrame(frame);
    frame = null;
    if (timer !== null) seams.clearTimer(timer);
    timer = null;
    timerAt = null;
    moving = false;
  };

  const showCanvas = (shown: boolean): void => {
    const canvas = door.peek()?.canvas;
    if (canvas === undefined || canvasShown === shown) return;
    canvasShown = shown;
    canvas.style.display = shown ? "" : "none";
  };

  /** The atlas's cells as the window has baked them (moves when a mark or a star lands). */
  const atlasRevision = (): number => door.peek()?.atlas.texels().revision ?? 0;

  /** What a frame is drawn from: a flush that brings the same while nothing moves draws nothing (M5). */
  const signatureOf = (s: AtWorkScene): string => {
    if (s.board !== lastBoard) {
      lastBoard = s.board;
      boards += 1;
    }
    const view = viewOf(s);
    const parts: (string | number)[] = [boards, s.zoom, view.width, view.height, s.theme];
    parts.push(s.light.night, ...s.pencil.box, ...s.pencil.turn, atlasRevision());
    const hand = s.hand ?? null;
    parts.push(
      hand === null
        ? "no hand"
        : `${hand.cx}:${hand.cy}:${hand.hx}:${hand.hy}:${hand.angle}:${hand.r}`,
    );
    for (const p of s.placed) {
      const f = p.frame;
      parts.push(p.key, f.cx, f.cy, f.hx, f.hy, f.angle, f.r, p.fade, p.heldByYou ? 1 : 0);
      parts.push(p.dimmed ? 1 : 0);
    }
    return parts.join("|");
  };

  /** Told while this mount holds the context: a printed star's bake landing, and the context lost or restored. */
  const follow = (context: AtWorkContext): (() => void) => {
    const offAtlas = context.atlas.subscribe(() => touch());
    const offContext = context.subscribe(() => {
      // lost: the DOM form at once (the shape's form moves, so React renders it); restored: the GL form returns
      drawnStamp = null;
      canvasShown = null;
      touch();
    });
    return () => {
      offAtlas();
      offContext();
    };
  };

  /** The window's canvas taken into this mount's box (first in it, under the stage's), and its changes followed. */
  const adopt = (context: AtWorkContext): void => {
    if (host !== null && context.canvas.parentElement !== host) host.prepend(context.canvas);
    if (followed === context) return;
    unfollow?.();
    followed = context;
    unfollow = follow(context);
  };

  /** The window's context, made now if a mark asks for it first (never before: one context a window, M5's count). */
  const ensureContext = (): void => {
    const context = door.peek() ?? door.make();
    if (context !== null) adopt(context);
  };

  /** The focus of object `key` at `now`, as the hand's pickup and put-back dim it (at once in the still DOM form). */
  const focusAt = (key: string, dimmed: boolean, now: number, still: boolean): number => {
    const was = focus.get(key);
    if (was === undefined || still) {
      focus.set(key, { dimmed, from: focusTarget(dimmed), at: Number.NEGATIVE_INFINITY });
      return focusTarget(dimmed);
    }
    if (was.dimmed !== dimmed) {
      const next: Focus = { dimmed, from: focusLevel(was, now), at: now };
      focus.set(key, next);
      return focusLevel(next, now);
    }
    return focusLevel(was, now);
  };

  const focusFading = (key: string, now: number): boolean => {
    const f = focus.get(key);
    return f !== undefined && now - f.at < focusMs(f.dimmed);
  };

  const releaseStage = (): void => {
    if (stageTimer !== null) seams.clearTimer(stageTimer);
    stageTimer = null;
    const open = stage;
    if (open === null) return;
    stage = null;
    stagesOpen -= 1;
    open.canvas.removeEventListener("webglcontextlost", open.lost);
    open.driven.release();
    open.canvas.remove();
  };

  const loadEngines = (): void => {
    if (loading || engines !== null) return;
    loading = true;
    kit.load().then(
      (loaded) => {
        loading = false;
        engines = loaded;
        touch();
      },
      () => {
        loading = false;
        stageRefused = true;
        touch();
      },
    );
  };

  /** This desk's stage, made now for the first live star (in this mount's box, after the overlay's canvas), for a view
   * of `size`; null where it cannot be had. Never in the desk's flush: the engine measures its canvas as it is made. */
  const openStage = (size: string): OpenStage | null => {
    if (host === null || engines === null) return null;
    const canvas = kit.canvas();
    if (canvas === null) {
      stageRefused = true;
      return null;
    }
    canvas.className = "vf-atwork__canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.setAttribute("data-atwork-stage", "");
    // in the box before the stage measures it: above the overlay's ink, below the stills and the chips
    host.append(canvas);
    const driven = kit.create(canvas, engines);
    if (driven === null) {
      canvas.remove();
      stageRefused = true;
      return null;
    }
    const lost = (): void => {
      // its context lost: the stars are their stills until none is live
      stageRefused = true;
      releaseStage();
      touch();
    };
    canvas.addEventListener("webglcontextlost", lost);
    stagesOpen += 1;
    stage = { canvas, driven, faces: NONE_STAGED, size, lost };
    return stage;
  };

  /** The stage's chores that measure layout, run after the frame that asked, outside any flush: made for the first
   * live star, or sized to a view that moved; then drawn at once (a stage refused is drawn as the stills it leaves). */
  const tendStage = (): void => {
    stageTimer = null;
    const s = scene;
    if (s === null || hidden !== null || !stageWanted) return;
    const size = sizeKey(viewOf(s));
    if (stage !== null && stage.size === size) return;
    if (stage === null) {
      openStage(size);
    } else {
      stage.size = size;
      stage.driven.resize();
    }
    touch();
  };

  const askStage = (): void => {
    if (stageTimer === null) stageTimer = seams.setTimer(tendStage, 0);
  };

  /** Each live star on screen placed on the stage, in the status Chat reads for it and its props by the switch, drawn
   * in this frame; the ids it drew (their stills stand aside). With none live (or none whose face is dealt yet) the
   * stage is let go. The stage is made, and sized to a new view, after the frame (`tendStage`), never here. */
  const driveStage = (
    shown: readonly AtWorkDrawnObject[],
    view: { width: number; height: number },
    now: number,
    hand: ScreenFrame | null,
  ): ReadonlySet<string> => {
    const live: {
      readonly id: string;
      readonly seed: number;
      readonly status: SparkStatus;
      readonly star: AtWorkStar;
    }[] = [];
    for (const d of shown) {
      for (const seat of d.marks.seats) {
        const star = seat.star;
        // a star with no status is its still, with no face to wear (the model never makes one live)
        if (star === null || !star.live || star.status === null || seat.spark === null) continue;
        const seed = seedOf(seat.spark);
        if (seed === null) continue;
        live.push({
          id: atWorkIds.seat(d.key, seat.run, seat.form),
          seed,
          status: star.status,
          // under the hand, a star whose centre it covers stands at none (2026-11-24, DESIGN.md §8 When not)
          star:
            d.under === true && atWorkCovers(hand, star.x, star.y) ? { ...star, alpha: 0 } : star,
        });
      }
    }
    if (live.length === 0) {
      stageWanted = false;
      releaseStage();
      stageRefused = false;
      return NONE_STAGED;
    }
    if (stageRefused || host === null) {
      stageWanted = false;
      return NONE_STAGED;
    }
    stageWanted = true;
    if (engines === null) {
      loadEngines();
      return NONE_STAGED;
    }
    const open = stage;
    // made, or sized to a view that moved, after this frame: the engine measures its canvas
    if (open === null || open.size !== sizeKey(view)) askStage();
    if (open === null) return NONE_STAGED;
    const staged = new Set<string>();
    for (const one of live) {
      const { size, x, y, alpha } = one.star;
      const props = AT_WORK_STAR_PROPS;
      open.driven.place(one.id, { seed: one.seed, status: one.status, size, x, y, alpha, props });
      staged.add(one.id);
    }
    for (const id of open.faces) if (!staged.has(id)) open.driven.drop(id);
    open.faces = staged;
    // the star moves on the overlay's clock, in the overlay's frame
    open.driven.render(now / 1_000);
    stageFrames += 1;
    drawnStamp = seams.frameStamp();
    return staged;
  };

  const drawGl = (
    g: AtWorkBuilt,
    shown: readonly AtWorkDrawnObject[],
    s: AtWorkScene,
    view: { width: number; height: number },
    c: AtWorkShaderColours,
  ): void => {
    const { gl, loc } = g;
    const context = door.peek();
    if (context === null) return;
    const { canvas, atlas } = context;
    const ratio = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
    const dpr = Math.min(ratio, AT_WORK_GL.maxDpr);
    const W = Math.max(1, Math.round(view.width * dpr));
    const H = Math.max(1, Math.round(view.height * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    // the cells first (a first sight bakes a mark, a crew run's first ask starts its star's bake), then the texels
    const packed = packAtWork(
      shown,
      {
        mark: (agent) => atlas.mark(agent),
        count: (n) => atlas.count(n),
        star: (spark) => {
          const seed = seedOf(spark);
          // a seed not read yet is a star still to come, never "no star": the view touches the layer once it is read
          return seed === null ? undefined : atlas.star(spark, seed);
        },
        crewSeat: (mark, star) => atlas.crewSeat(mark, star),
        face: (spark) => seedOf(spark) !== null,
      },
      rowsData,
    );
    const texels = atlas.texels();
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    draws += 1;
    if (packed.instances === 0) return;
    // Item 550 (2026-11-24): WebGL's own `useProgram`, not a React hook (the hook rule is item 620's)
    // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's own call, not a hook
    gl.useProgram(g.program);
    gl.bindVertexArray(g.vao);
    gl.enable(gl.BLEND);
    // premultiplied: ink, foil, paper and shadow as colour with alpha; the ink's light with zero alpha, added
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, g.rows);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    // this draw's rows, written into the storage made once (`build`) from the layer's one buffer: WebGL reads the
    // `rowsHigh` rows it is told and no further
    const { width: rowsWide, height: rowsHigh, data: rows } = packed;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, rowsWide, rowsHigh, gl.RGBA, gl.FLOAT, rows);
    gl.uniform1i(loc("uData"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, g.atlas);
    if (texels.revision !== g.atlasRevision) {
      // RG8, row 0 at the top (the atlas's own layout), uploaded whole when a cell is added or after a restore
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const { width, height, data } = texels;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, width, height, 0, gl.RG, gl.UNSIGNED_BYTE, data);
      g.atlasRevision = texels.revision;
    }
    gl.uniform1i(loc("uAtlas"), 1);
    gl.uniform2f(loc("uAtlasGrid"), AT_WORK_ATLAS.cols, texels.height / AT_WORK_ATLAS.cell);
    gl.uniform4f(loc("uView"), view.width, view.height, dpr, 0);
    gl.uniform4i(loc("uCounts"), packed.objects, packed.seats, packed.firstSeat, 0);
    const light = atWorkLight(s.light);
    gl.uniform4f(loc("uLight"), ...light.light);
    gl.uniform4f(loc("uMoonlight"), ...light.moonlight);
    gl.uniform3f(loc("uMoon"), ...light.moon);
    gl.uniform3f(loc("uRod"), ...light.rod);
    gl.uniform3f(loc("uEigen"), ...light.eigengrau);
    gl.uniform3f(loc("uPrint"), ...c.print);
    gl.uniform3f(loc("uCast"), ...c.cast);
    gl.uniform3f(loc("uCastNight"), ...c.castNight);
    gl.uniform3f(loc("uPaper"), ...c.paper);
    gl.uniform4f(loc("uCut"), ...c.cut.rgb, c.cut.alpha);
    gl.uniform4f(loc("uPencilBox"), ...s.pencil.box);
    gl.uniform4f(loc("uPencilTurn"), ...s.pencil.turn);
    const hand = atWorkHandUniforms(s.hand ?? null);
    gl.uniform4f(loc("uHandBox"), ...hand.box);
    gl.uniform4f(loc("uHandTurn"), ...hand.turn);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, packed.instances);
    gl.bindVertexArray(null);
  };

  /** One frame of the marks at `now`, from the last scene: step, place, draw. */
  const run = (now: number, why: RunWhy): void => {
    const s = scene;
    if (s === null || hidden !== null) return;
    const signature = signatureOf(s);
    if (why === "flush") {
      // the desk stepped for its own reasons (a kind's clock, a write) and nothing of the marks moved: no draw
      if (!moving && signature === drawnSignature) return;
      // this frame was drawn already (the layer's rAF ran first, then the desk woke): the flush's camera is drawn on
      // the next frame, so a frame is never drawn twice (`document.timeline.currentTime` stands still through one
      // frame's callbacks, so it tells the frames apart; at the desk's wake this costs one frame of lag)
      const stamp = seams.frameStamp();
      if (stamp !== null && stamp === drawnStamp) {
        counts.deferred += 1;
        ask();
        return;
      }
    }
    if (s.theme !== tokensFor) askTokens();
    if (s.board.epoch !== epoch) {
      // a clear: what was drawn is dropped at once, with no leaving (the store's `epoch`)
      epoch = s.board.epoch;
      states.clear();
      focus.clear();
      levels.clear();
    }
    // the first mark makes the window's context; a board with none makes nothing
    if (s.placed.some((p) => s.board.objects.has(p.key) || states.has(p.key))) ensureContext();
    const form = formNow();
    const hand = s.hand ?? null;
    // the DOM form is still: stepped as under reduced motion, it asks for no frame it cannot show
    const still = reduced || form === "dom";
    const drawInks = inks ?? AT_WORK_DOM_INKS;
    const drawn: AtWorkDrawnObject[] = [];
    const placedKeys = new Set<string>();
    let moved = false;
    for (const p of s.placed) {
      placedKeys.add(p.key);
      const object = s.board.objects.get(p.key);
      const prev = states.get(p.key);
      if (object === undefined && prev === undefined) continue;
      const f = focusAt(p.key, p.dimmed, now, form === "dom");
      if (levels.get(p.key) !== f) moved = true;
      levels.set(p.key, f);
      const landed = s.board.landed.get(p.key);
      const next = stepAtWork(prev, {
        rows: object?.agents ?? [],
        frame: p.frame,
        zoom: s.zoom,
        now,
        reducedMotion: still,
        heldByYou: p.heldByYou,
        inks: drawInks,
        sparkStatus: statusOf,
        ...(landed === undefined ? {} : { landed }),
        fade: p.fade * f,
      });
      counts.steps += 1;
      if (prev === undefined || prev.moving || next.moving) moved = true;
      const left = next.marks.strokes.length === 0 && next.marks.seats.length === 0;
      if (object === undefined && left) {
        states.delete(p.key);
        focus.delete(p.key);
        levels.delete(p.key);
        continue;
      }
      states.set(p.key, next);
      // the hand stands over it (in hand or flying home, the cover outlasting the dim as the desk comes back): its
      // marks are covered where the hand's silhouette lies (2026-11-24)
      drawn.push({
        key: p.key,
        frame: p.frame,
        marks: next.marks,
        under: hand !== null && !p.held,
      });
    }
    // an object the desk no longer places (deleted, in another canvas) takes its marks with it
    for (const key of [...states.keys()]) {
      if (placedKeys.has(key)) continue;
      states.delete(key);
      focus.delete(key);
      levels.delete(key);
    }
    const view = viewOf(s);
    const shown = drawn.filter((d) => atWorkOnScreen(d.frame, d.marks, view));
    onScreen = shown.length;
    const staged = driveStage(shown, view, now, hand);
    reshape(drawn, form);
    placeDom(drawn, form, view.width, staged, hand);
    const g = form === "gl" ? (door.peek()?.built() ?? null) : null;
    if (g !== null && colours !== null) {
      showCanvas(onScreen > 0);
      // a frame of the layer's own whose marks and focus stood still and whose camera did not move would draw the same
      // overlay (one run for a live star alone): it is left as it stands
      const same = why === "frame" && !moved && signature === drawnSignature;
      if (onScreen > 0 && !same) {
        drawnStamp = seams.frameStamp();
        drawGl(g, shown, s, view, colours);
      }
    } else {
      showCanvas(false);
    }
    // read again after the draw: a draw that baked a sticker moved the atlas's revision and uploaded it, so the
    // revision this frame drew is the one after it (else the next flush that brings nothing would draw it again)
    drawnSignature = signatureOf(s);
    schedule(now, shown);
  };

  /** Ask for the next frame (rAF) while a mark moves. */
  const ask = (): void => {
    moving = true;
    if (frame !== null) return;
    frame = seams.requestFrame(() => {
      frame = null;
      counts.rafs += 1;
      // while the desk steps, its flush draws this frame: the layer's own loop only keeps itself alive
      if (seams.deskAwake()) {
        ask();
        return;
      }
      // this frame was drawn already (a flush drew it as the desk fell asleep): the next one is the layer's
      const stamp = seams.frameStamp();
      if (stamp !== null && stamp === drawnStamp) {
        ask();
        return;
      }
      run(seams.now(), "frame");
    });
  };

  /** After a frame: rAF while a mark on screen moves (or a live star is on its stage), else a timer for what comes with
   * no new row, else sleep. */
  const schedule = (now: number, shown: readonly AtWorkDrawnObject[]): void => {
    const on: AtWorkObjectState[] = [];
    for (const d of shown) {
      const state = states.get(d.key);
      if (state !== undefined) on.push(state);
    }
    // a live star asks for frames only while a stage draws it (or will, once the engine is here): else it is a still
    const wake = atWorkBoardWake(stageWanted ? on : on.map(withoutStage), now);
    const fading = shown.some((d) => focusFading(d.key, now));
    // a mark that moves off screen asks no frame: the next flush that brings it on steps it on (its step capped)
    if ((wake.raf || fading) && onScreen > 0) {
      if (timer !== null) seams.clearTimer(timer);
      timer = null;
      timerAt = null;
      ask();
      return;
    }
    moving = false;
    if (frame !== null) seams.cancelFrame(frame);
    frame = null;
    // nothing on screen: nothing to wake for either (a ring nobody sees), until a flush brings a mark on
    const at = onScreen === 0 ? null : wake.at;
    if (at === null) {
      if (timer !== null) seams.clearTimer(timer);
      timer = null;
      timerAt = null;
      return;
    }
    if (timerAt === at && timer !== null) return;
    if (timer !== null) seams.clearTimer(timer);
    timerAt = at;
    timer = seams.setTimer(
      () => {
        timer = null;
        timerAt = null;
        counts.timers += 1;
        run(seams.now(), "timer");
      },
      Math.max(0, at - now),
    );
  };

  /** Draw again now from the last scene, outside any flush. */
  const touch = (): void => {
    drawnSignature = "";
    run(seams.now(), "touch");
  };

  const layer: AtWorkLayer = {
    attach(next) {
      latest = layer;
      // this mount's own box (an element React renders empty, so React never meets a node it did not make): the
      // window's canvas is taken into it once a mark has made it, and moved here from the last mount's
      host = next;
      const context = door.peek();
      if (context !== null) adopt(context);
      readTokens();
      if (typeof ResizeObserver !== "undefined") {
        observer?.disconnect();
        observer = new ResizeObserver((entries) => {
          const box = entries[0]?.contentRect;
          if (box === undefined) return;
          hostSize = { width: box.width, height: box.height };
          // the stage measures its canvas here, where the layout is fresh, never in the desk's flush
          if (stage !== null) {
            stage.size = sizeKey(scene === null ? hostSize : viewOf(scene));
            stage.driven.resize();
          }
          touch();
        });
        observer.observe(next);
      }
      return () => {
        observer?.disconnect();
        observer = null;
        unfollow?.();
        unfollow = null;
        followed = null;
        cancelLoops();
        releaseStage();
        if (tokenTimer !== null) seams.clearTimer(tokenTimer);
        tokenTimer = null;
        // the window's canvas stays in this box until the next mount takes it: a remount never draws on a detached
        // canvas
        if (host === next) host = null;
        if (latest === layer) latest = null;
      };
    },
    show(next) {
      scene = next;
      run(seams.now(), "flush");
    },
    touch,
    setTokens(read) {
      if (read !== undefined) tokenReader = read;
      tokenTries = 0;
      readTokens();
    },
    setHidden(verdict) {
      if (hidden === verdict) return;
      hidden = verdict;
      if (hidden !== null) {
        cancelLoops();
        // under a cover, the pegboard, or a desk that does not draw, no star is live: its stage goes too
        releaseStage();
        showCanvas(false);
        reshape([], formNow());
        return;
      }
      touch();
    },
    setReducedMotion(next) {
      if (reduced === next) return;
      reduced = next;
      // drawn again now: a flip at rest is never left for the next flush, nor a ring's timer kept under it
      touch();
    },
    drawing: () => [...states.keys()],
    busy: () => states.size > 0,
    drop() {
      cancelLoops();
      releaseStage();
      states.clear();
      focus.clear();
      levels.clear();
      scene = null;
      drawnSignature = "";
      onScreen = 0;
      showCanvas(false);
      reshape([], formNow());
    },
    bind(id, el) {
      els.set(id, el);
      // a new element for a placed id: its place is written to it afresh
      written.delete(id);
      let watch: ResizeObserver | null = null;
      if (id.startsWith("chip:") && typeof ResizeObserver !== "undefined") {
        // a chip's width, for its flip at the window's edge: observed, never read in a flush
        watch = new ResizeObserver((entries) => {
          const width = entries[0]?.contentRect.width;
          if (width !== undefined) widths.set(id, width);
        });
        watch.observe(el);
      }
      return () => {
        watch?.disconnect();
        if (els.get(id) !== el) return;
        els.delete(id);
        widths.delete(id);
      };
    },
    ref(id) {
      let ref = refs.get(id);
      if (ref === undefined) {
        ref = (el) => (el === null ? undefined : layer.bind(id, el));
        refs.set(id, ref);
      }
      return ref;
    },
    host: (el) => (el === null ? undefined : layer.attach(el)),
    shape: () => shape,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    record: () => {
      const context = door.peek();
      return {
        form: formNow(),
        why: context === null ? WHY.unmade : context.why(),
        hidden,
        objects: states.size,
        onScreen,
        contexts: context?.webgl === true ? 1 : 0,
        stageContexts: stage === null ? 0 : 1,
        draws,
        stageFrames,
        steps: counts.steps,
        rafs: counts.rafs,
        timers: counts.timers,
        deferred: counts.deferred,
        writes: counts.writes,
        renders: counts.renders,
        moving,
        wakeAt: timerAt,
      };
    },
    dispose() {
      cancelLoops();
      releaseStage();
      unfollow?.();
      unfollow = null;
      followed = null;
      observer?.disconnect();
      observer = null;
      if (tokenTimer !== null) seams.clearTimer(tokenTimer);
      tokenTimer = null;
      listeners.clear();
      states.clear();
      focus.clear();
      levels.clear();
      if (latest === layer) latest = null;
      counts = { steps: 0, rafs: 0, timers: 0, deferred: 0, writes: 0, renders: 0 };
    },
  };
  return layer;
}
