import type { LiveInput } from "@vibefield/plugin-sdk/desk";
import { type PhoneGeometry, pickPhone } from "./law";
// The phone's DESK STATE — the kind's own state on ONE desk (`ObjectKind.local`): flux, never a world fact (the facts are the
// phone's props and its rect).
//  - Each bound phone's LIVE FACE (live.ts): opened by the object's durable key on the host's `LIVE` service, taken when it
//    says something arrived, asked of by the phone's demand law over the desk's SIGHT;
//  - each phone's MORPH clock (morph.ts): a change of its `model` morphs it over 0.72 s, the records remade every frame while
//    one runs (the kind is due at once), never on its own;
//  - each face's WORDS (notice.ts): drawn by the words' raster its DOM half lends (`WORDS_RASTER`) — where none is lent (a
//    Node still), the committed raster their key names (face-words.ts), else none — cached by what they say, their texture
//    charged to the desk's raster budget under the kind's name (`notice <key>`) and let go at its eviction — laid again from
//    its record when the phone is next drawn;
//  - In hand, status actions own their presses. The live glass forwards pointer and wheel input in guest coordinates.
//  - Simulator settings reads compatible iPhone models and installed iOS runtimes through the host's device service.
// A loop at rest ticks the kind only when it is due: nothing is polled.

import {
  type Entity,
  type HeldEvent,
  type KindHost,
  type KindLocal,
  type LiveFace,
  type LiveInfo,
  type LiveSimulatorSpec,
  type LiveState,
  type LiveTexture,
  SIMULATOR_DEVICES,
  type Sight,
  type SimulatorDevices,
} from "@vibefield/plugin-sdk/desk";
import { stillWords } from "./face-words";
import { SIMULATOR_KIND } from "./ids";
import type { FinishValues, NoticePlan } from "./layout";
import { createPhoneFaces, type PhoneFaceStats } from "./live";
import type { PhoneModel } from "./model";
import { createMorphs, type Shown } from "./morph";
import { NOTICE_SCALE, type NoticeWords, noticeKey, WORDS_RASTER } from "./notice";

/** The pass's doors the local reads (the root pass, once the ground has made it). */
interface PhoneDoors {
  /** Told a phone's words' texture was made (its bytes on the device) or let go (0). */
  onNotice(fn: ((entity: number, bytes: number) => void) | undefined): void;
  /** A phone's words' texture let go at the budget's word: laid again from its record when it is next drawn. */
  unnotice(entity: number): boolean;
  /** Words laid for a phone since its surface was made — what has LANDED on it. */
  made(entity: number): number;
  forget(entity: number): void;
}

/** The budget's key for a phone's words' texture. */
export const noticeBudgetKey = (key: string): string => `notice ${key}`;

export interface SimulatorLocal extends KindLocal {
  /** `e`'s live face for the device `spec` names (opened at its first ask, reopened for another device; undefined: no `LIVE` lent, no durable key). */
  face(e: Entity, spec: LiveSimulatorSpec, native: readonly [number, number]): LiveFace | undefined;
  /** `e`'s face closed: it is unbound. */
  drop(e: Entity): void;
  /** The sight the pass tells, carried on the records of phones with a face. */
  readonly sight: Sight;
  /** `e`'s face's words now (its key, state and info), or undefined: no face. */
  screen(
    e: Entity,
  ): { readonly key: string; readonly state: LiveState; readonly info: LiveInfo } | undefined;
  /** `e`'s face's texture now (the host's), or undefined: no face, or nothing in it yet. */
  texture(e: Entity): LiveTexture | undefined;
  /** What `e` shows now for its model and its finish's colours: its model's shape, or mid-morph a blend (morph.ts). */
  shown(e: Entity, model: PhoneModel, finish: FinishValues): Shown;
  /**
   * `e`'s face's words as the pass lays them (drawn by the lent raster — once a line, a size and an ink; none lent, the
   * committed raster that says exactly them), or undefined: no raster lent on this desk and none committed says them — the
   * face carries no words.
   */
  notice(
    e: Entity,
    points: readonly [number, number],
    words: NoticeWords,
    ink: string,
  ): NoticePlan | undefined;
  /** How many lines `e`'s words last took (the act's capsule lies under them), or undefined: no words drawn. */
  lines(e: Entity): number | undefined;
  /** The act `e`'s face offers now (the record says it) — what a release over its capsule in hand runs. */
  offer(e: Entity, act: (() => void) | undefined): void;
  /**
   * The kind's tick, always there (KindLocal's is optional): steps the morphs and the faces' clocks; true while a morph runs
   * and on the frame it lands (the last record drawn was a blend: it is remade at the new model exactly).
   */
  tick(now: number): boolean;
  /** Phones mid-morph, and morphs begun (a test's witness). */
  morphs(): { readonly running: number; readonly begun: number };
  /** What the faces did (a test's and a smoke's witness). */
  faces(): PhoneFaceStats;
  /** PT-S2 — this Mac's devices as the host lends them (`SIMULATOR_DEVICES`), or undefined: none lent on this desk. */
  laid(e: Entity, geometry: PhoneGeometry, cx: number, cy: number, zoom: number): void;
  interactive(e: Entity): boolean;
  send(e: Entity, event: LiveInput): void;
  devices(): SimulatorDevices | undefined;
  /** Words drawn, and acts run, since the desk was made (a test's witness). */
  readonly notices: number;
  readonly acts: number;
}

const doorsOf = (host: KindHost | undefined): PhoneDoors | undefined => {
  const pass = host?.pass() as Partial<PhoneDoors> | undefined;
  return typeof pass?.onNotice === "function" &&
    typeof pass.unnotice === "function" &&
    typeof pass.made === "function" &&
    typeof pass.forget === "function"
    ? (pass as PhoneDoors)
    : undefined;
};

export function createSimulatorLocal(host: KindHost | undefined): SimulatorLocal {
  const live = createPhoneFaces(host);
  const morphs = createMorphs();
  const noticed = new Map<Entity, NoticePlan & { readonly lines: number }>();
  const offers = new Map<Entity, () => void>();
  /** A press in hand on the act's capsule, until its release. */
  const pressing = new Set<Entity>();
  const layouts = new Map<
    Entity,
    { geometry: PhoneGeometry; cx: number; cy: number; zoom: number }
  >();
  const fingers = new Map<Entity, readonly [number, number]>();
  const interactive = (e: Entity): boolean =>
    live.opened(e)?.info().extra?.deviceInput === true && live.opened(e)?.state().is === "live";
  const send = (e: Entity, event: LiveInput): void => live.opened(e)?.input?.(event);
  let notices = 0;
  let acts = 0;

  /** The words' rows charged, by phone — a row is named by its face's key, and goes WITH ITS PHONE (the pane's PT-5b2 ruling 7). */
  const rows = new Map<Entity, string>();
  const release = (e: Entity): void => {
    const row = rows.get(e);
    if (row === undefined) return;
    rows.delete(e);
    host?.budget?.release(SIMULATOR_KIND, row);
  };
  const charge = (entity: number, bytes: number): void => {
    const e = entity as Entity;
    if (bytes <= 0) {
      release(e);
      return;
    }
    const key = live.words(e)?.key;
    if (key === undefined || host?.budget === undefined) return;
    const row = noticeBudgetKey(key);
    rows.set(e, row);
    host.budget.charge(SIMULATOR_KIND, row, bytes, () => {
      // (the ledger has dropped the row itself)
      rows.delete(e);
      doors()?.unnotice(entity);
    });
  };
  let wired: PhoneDoors | undefined;
  /** The root pass's doors, its words' report wired to the budget the first time they are there. */
  const doors = (): PhoneDoors | undefined => {
    const d = doorsOf(host);
    if (d !== undefined && d !== wired) {
      d.onNotice(charge);
      wired = d;
    }
    return d;
  };

  return {
    face: (e, spec, native) => {
      doors();
      return live.face(e, spec, native);
    },
    drop(e) {
      live.drop(e);
      noticed.delete(e);
      layouts.delete(e);
      fingers.delete(e);
      offers.delete(e);
      pressing.delete(e);
      release(e);
    },
    laid: (e, geometry, cx, cy, zoom) => {
      layouts.set(e, { geometry, cx, cy, zoom });
    },
    interactive,
    send,
    sight: live.sight,
    screen: (e) => live.words(e),
    texture: (e) => live.opened(e)?.texture(),
    shown: (e, model, finish) => morphs.shown(e, model, finish),
    notice(e, points, words, ink) {
      doors();
      const spec = { points, scale: NOTICE_SCALE, words, ink };
      const key = noticeKey(spec);
      const had = noticed.get(e);
      if (had?.key === key) return had;
      // the lent raster draws them; none lent (a Node still: no platform Canvas 2D), the committed one that says exactly them
      const raster = host?.use?.(WORDS_RASTER);
      const drawn = raster !== undefined ? raster.notice(spec) : stillWords(key);
      if (drawn === undefined) return undefined;
      const plan = {
        key,
        bytes: drawn.bytes,
        width: drawn.width,
        height: drawn.height,
        points,
        block: drawn.block,
        lines: drawn.lines,
      };
      noticed.set(e, plan);
      notices += 1;
      // the act's capsule lies under the lines: a phone whose words took another count is resolved again (its part in hand)
      if (had?.lines !== plan.lines) host?.remake?.(e);
      return plan;
    },
    lines: (e) => noticed.get(e)?.lines,
    offer(e, act) {
      if (act === undefined) offers.delete(e);
      else offers.set(e, act);
    },
    morphs: () => morphs.stats(),
    faces: () => live.stats(),
    devices: () => host?.use?.(SIMULATOR_DEVICES),
    get notices() {
      return notices;
    },
    get acts() {
      return acts;
    },
    // the kind's word on a raster it charged (`notice <key>`): kept while its phone is seen or held
    keeps(key) {
      const at = key.indexOf(" ");
      const e = at < 0 ? undefined : live.entityOf(key.slice(at + 1));
      return e !== undefined && live.shown(e);
    },
    // the faces' takes and asks answer nothing of their own (a landed frame asks a redraw, new words a remake); a running
    // morph remakes every record of the kind, frame after frame — AND on the frame it lands: the record drawn last was a
    // blend (t < 1), and the desk remakes a record only on a frame its kind's tick answered true, so "nothing runs now" there
    // would leave the phone a hair (after a long last frame, visibly) short of its new model (PHONE.md §13: "it ends the X
    // exactly")
    tick(now) {
      const drawnMid = morphs.running();
      morphs.step(now);
      live.tick(now);
      return drawnMid || morphs.running();
    },
    due: (now) => (morphs.running() ? now : live.due(now)),
    // words laid after their record change how the phone looks with no fact of its own moving
    landed: (e) => doors()?.made(e as number) ?? 0,
    // Project input into the displayed device frame. A status action owns its own press and release.
    held(e, events: readonly HeldEvent[]) {
      for (const ev of events) {
        const layout = layouts.get(e);
        if (layout && interactive(e)) {
          const hit = pickPhone(layout.geometry, layout.cx + ev.x, layout.cy + ev.y);
          const points = layout.geometry.shape.points;
          const logical = live.opened(e)?.texture()?.logical ?? points;
          const xy: readonly [number, number] | undefined =
            hit?.part === "screen"
              ? [(hit.point[0] * logical[0]) / points[0], (hit.point[1] * logical[1]) / points[1]]
              : fingers.get(e);
          if (xy && ev.type === "wheel") {
            const scale = logical[0] / (2 * layout.geometry.shape.display[0] * layout.zoom);
            send(e, { kind: "wheel", x: xy[0], y: xy[1], dx: ev.dx * scale, dy: ev.dy * scale });
            continue;
          }
          if (
            xy &&
            ev.type === "pointer" &&
            ev.part !== "act" &&
            (ev.phase === "down" ? ev.button === 0 && hit?.part === "screen" : fingers.has(e))
          ) {
            if (ev.phase === "up") fingers.delete(e);
            else fingers.set(e, xy);
            send(e, {
              kind: "pointer",
              phase: ev.phase,
              x: xy[0],
              y: xy[1],
              button: ev.button,
              buttons: ev.buttons,
              count: ev.count,
            });
            continue;
          }
        }
        if (ev.type !== "pointer") continue;
        if (ev.phase === "down" && ev.part === "act") pressing.add(e);
        else if (ev.phase === "up" && pressing.delete(e) && ev.part === "act") {
          const act = offers.get(e);
          if (act !== undefined) {
            acts += 1;
            act();
          }
        }
      }
    },
    forget(e) {
      doors()?.forget(e as number);
      live.forget(e);
      morphs.forget(e);
      noticed.delete(e);
      layouts.delete(e);
      fingers.delete(e);
      offers.delete(e);
      pressing.delete(e);
      release(e);
    },
    dispose() {
      for (const e of [...rows.keys()]) release(e);
      live.dispose();
      noticed.clear();
      layouts.clear();
      fingers.clear();
      offers.clear();
      pressing.clear();
      wired?.onNotice(undefined);
      wired = undefined;
    },
  };
}
