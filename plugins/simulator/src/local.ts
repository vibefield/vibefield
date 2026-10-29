// The phone's DESK STATE — the kind's own state on ONE desk (`ObjectKind.local`): flux, never a world fact (the facts are the
// phone's props and its rect).
//  - Each bound phone's LIVE FACE (live.ts): opened by the object's durable key on the host's `LIVE` service, taken when it
//    says something arrived, asked of by the phone's demand law over the desk's SIGHT;
//  - each phone's MORPH clock (morph.ts): a change of its `model` morphs it over 0.72 s, the records remade every frame while
//    one runs (the kind is due at once), never on its own;
//  - each face's WORDS (notice.ts): drawn by the words' raster its DOM half lends (`WORDS_RASTER`), cached by what they say,
//    their texture charged to the desk's raster budget under the kind's name (`notice <key>`) and let go at its eviction —
//    laid again from its record when the phone is next drawn;
//  - IN HAND (used — the open binding): the hand's press on the face's act's capsule runs the act on its release over it
//    (the host's — it manages the device, never iOS); every other press is the desk's (v1 is view-only).
// A loop at rest ticks the kind only when it is due: nothing is polled.

import type {
  Entity,
  HeldEvent,
  KindHost,
  KindLocal,
  LiveFace,
  LiveInfo,
  LiveSimulatorSpec,
  LiveState,
  LiveTexture,
  Sight,
} from "@vibefield/plugin-sdk/desk";
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
   * `e`'s face's words as the pass lays them (drawn by the lent raster — once a line, a size and an ink), or undefined: no
   * raster lent on this desk — the face carries no words.
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
  /** The kind's tick, always there (KindLocal's is optional): steps the morphs and the faces' clocks; true while a morph runs. */
  tick(now: number): boolean;
  /** Phones mid-morph, and morphs begun (a test's witness). */
  morphs(): { readonly running: number; readonly begun: number };
  /** What the faces did (a test's and a smoke's witness). */
  faces(): PhoneFaceStats;
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
      offers.delete(e);
      pressing.delete(e);
      release(e);
    },
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
      const drawn = host?.use?.(WORDS_RASTER)?.notice(spec);
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
    // morph remakes every record of the kind, frame after frame, until it lands
    tick(now) {
      morphs.step(now);
      live.tick(now);
      return morphs.running();
    },
    due: (now) => (morphs.running() ? now : live.due(now)),
    // words laid after their record change how the phone looks with no fact of its own moving
    landed: (e) => doors()?.made(e as number) ?? 0,
    // THE HAND (v1 is view-only): a press on the act's capsule is the act's, run on its release over it; nothing else is the kind's
    held(e, events: readonly HeldEvent[]) {
      for (const ev of events) {
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
      offers.delete(e);
      pressing.delete(e);
      release(e);
    },
    dispose() {
      for (const e of [...rows.keys()]) release(e);
      live.dispose();
      noticed.clear();
      offers.clear();
      pressing.clear();
      wired?.onNotice(undefined);
      wired = undefined;
    },
  };
}
