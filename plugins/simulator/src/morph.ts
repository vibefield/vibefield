// THE MORPH'S CLOCKS (PHONE.md §13; the PT-S1 brief) — a phone whose `model` prop CHANGES morphs from the shape it shows into
// the new model's over the law's 0.72 s, staged in its five tracks (law.ts `morphTracks`, `mixShape`). It runs ONLY on an
// explicit change of `model` — never on its own: a phone first seen settles at its model at once — and its clock is LOCAL
// state, one per desk: a collaborator's desk sees the same morph from the same prop change, at its own frame clock. A change
// arriving mid-morph morphs on from the blend (a morph is never cut short; any in-between is a real `PhoneShape`). The
// finish's colours ride the material track. A STILL pins a morph at a time instead (`SimulatorAsset.morph`, the desk's asset
// door — as the desk clock pins its hour): it never reads a clock.

import type { Entity } from "@vibefield/plugin-sdk/desk";
import {
  mixShape,
  morphTracks,
  PHONE,
  type PhoneLaw,
  type PhoneShape,
  phoneById,
  shapeOf,
  type Tracks,
} from "./law";
import { type FinishValues, mixFinish } from "./layout";
import type { PhoneModel } from "./model";

/**
 * A phone's ASSET (`ObjectContext.asset` — what a host pins through the desk's builder, `createStill`'s `pinAsset`): a morph
 * pinned at `t` (0…1) from the model `from` into the phone's own — a still draws a phone mid-morph, deterministically.
 */
export interface SimulatorAsset {
  readonly morph?: { readonly from: string; readonly t: number };
}

/** A pinned morph read off an asset, or undefined: none pinned, or not one this kind can read. */
export function pinnedMorph(
  asset: unknown,
): { readonly from: PhoneModel; readonly t: number } | undefined {
  if (typeof asset !== "object" || asset === null) return undefined;
  const morph = (asset as Readonly<Record<string, unknown>>).morph;
  if (typeof morph !== "object" || morph === null) return undefined;
  const { from, t } = morph as Readonly<Record<string, unknown>>;
  const model = typeof from === "string" ? phoneById(from) : undefined;
  if (model === undefined || typeof t !== "number" || !Number.isFinite(t)) return undefined;
  return { from: model, t: Math.min(Math.max(t, 0), 1) };
}

/** What a phone shows now: its shape, its finish's colours, and the morph's tracks while one runs. */
export interface Shown {
  readonly shape: PhoneShape;
  readonly finish: FinishValues;
  readonly tracks?: Tracks;
}

/** One phone's morph: where it comes from (its shape and finish as they stood when the change came) and when it began. */
interface Morph {
  readonly model: PhoneModel;
  readonly from: PhoneShape;
  readonly fromFinish: FinishValues;
  /** The local clock (ms) it began at; −∞: settled. */
  readonly t0: number;
}

export interface Morphs {
  /** The frame's clock (ms), from the kind's tick. */
  step(now: number): void;
  /**
   * What `e` shows now for its `model` and the colours of its finish: its model's own shape — or, from the moment its model
   * changes, the morph into it from what it showed. `finish` is the finish's colours under the record's look.
   */
  shown(e: Entity, model: PhoneModel, finish: FinishValues): Shown;
  /**
   * Is any phone mid-morph at the last step's clock? (Its records are remade every frame while one is, and on the frame it
   * lands — the kind's tick asks this before it steps: local.ts.)
   */
  running(): boolean;
  /** Phones mid-morph now (a test's witness), and morphs begun since the desk was made. */
  stats(): { readonly running: number; readonly begun: number };
  forget(e: Entity): void;
}

export function createMorphs(law: PhoneLaw = PHONE): Morphs {
  const morphs = new Map<Entity, Morph>();
  /** Each phone's last shown shape and finish — where the next morph begins. */
  const last = new Map<Entity, { readonly shape: PhoneShape; readonly finish: FinishValues }>();
  let clock = 0;
  let begun = 0;
  const progress = (m: Morph): number =>
    m.t0 === Number.NEGATIVE_INFINITY ? 1 : Math.min(Math.max((clock - m.t0) / law.morph.ms, 0), 1);
  return {
    step(now) {
      clock = now;
    },
    shown(e, model, finish) {
      let m = morphs.get(e);
      if (m === undefined) {
        // first seen: settled at its model — a morph runs only on a CHANGE of model, never on its own
        m = { model, from: shapeOf(model), fromFinish: finish, t0: Number.NEGATIVE_INFINITY };
        morphs.set(e, m);
      } else if (m.model !== model) {
        // the model changed: morph on from what it showed (mid-morph too — the blend is a real shape)
        const was = last.get(e);
        m = {
          model,
          from: was?.shape ?? shapeOf(m.model),
          fromFinish: was?.finish ?? m.fromFinish,
          t0: clock,
        };
        morphs.set(e, m);
        begun += 1;
      }
      const t = progress(m);
      const to = shapeOf(model);
      const shown: Shown =
        t >= 1
          ? { shape: to, finish }
          : (() => {
              const tracks = morphTracks(t, law.morph.staged, law);
              return {
                shape: mixShape(m.from, to, tracks),
                finish: mixFinish(m.fromFinish, finish, tracks.material),
                tracks,
              };
            })();
      last.set(e, { shape: shown.shape, finish: shown.finish });
      return shown;
    },
    running() {
      for (const m of morphs.values()) if (progress(m) < 1) return true;
      return false;
    },
    stats() {
      let running = 0;
      for (const m of morphs.values()) if (progress(m) < 1) running += 1;
      return { running, begun };
    },
    forget(e) {
      morphs.delete(e);
      last.delete(e);
    },
  };
}

/** A pinned morph's frame: the shape between `from` and the phone's model at its time, the finish from `from`'s first. */
export function pinnedShown(
  pin: { readonly from: PhoneModel; readonly t: number },
  model: PhoneModel,
  finish: FinishValues,
  fromFinish: FinishValues,
  law: PhoneLaw = PHONE,
): Shown {
  const tracks = morphTracks(pin.t, law.morph.staged, law);
  return {
    shape: mixShape(shapeOf(pin.from), shapeOf(model), tracks),
    finish: mixFinish(fromFinish, finish, tracks.material),
    tracks,
  };
}
