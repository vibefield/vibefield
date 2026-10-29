// THE PHONE'S LIVE SCREEN (ICE design-019 §3.3–§3.5, as the browser pane uses them — its live.ts is this one's model): a phone
// BOUND to a device (binding.ts) holds a LIVE FACE that the host's `LIVE` service opens for it, by the object's DURABLE key
// (`KindHost.keyOf` — so a reload re-attaches the same stream, never a new one), and its pass draws the face's texture. The
// kind holds a view and words, never a frame (PA-22: the host fills the texture). `LIVE` is the ONE seam the screen is fed
// through (James's choice 4, 2026-10-29): this file reads the spec it sends and the words it is told, never how the frames
// are made, so a host may change its source and nothing here changes. The seam's first source is the plugin's FIXTURE — a
// still's faces (playground/live.ts over fixture.ts) and a live desk's (fixture-live.ts); PT-S2's producer is the product's.
//  - OPENED at the phone's record (a runtime entity — a tray's specimen, a ghost — has no durable key and gets no face; an
//    unbound phone opens none), TAKEN once at the open; closed when the phone leaves, or when its binding moves (a new device
//    is a new face: the host resolves another simulator);
//  - an ARRIVAL marks the face and wakes the desk (`KindHost.wake`); the tick takes each woken face: a frame landed in the SAME
//    texture asks `redraw()` — the frame drawn again, no record remade — and a NEW texture (the first, a new size) or new WORDS
//    (the face's state, its device's name — what the record reads) ask `remake(e)`; the tick answers nothing of its own;
//  - THE DEMAND: the sight (`createSight(host.frames)`, told by the pass's prepares) feeds the phone's law (`phoneDemand` —
//    paused unseen; native at 60 and interactive in the hand; at rest the halving of native that covers the display, its rung
//    held through a wobble), sent CHANGE-ONLY. The kind is due NOW while a frame was drawn its sight has not stepped over.
//  - VIEW-ONLY (v1): nothing is ever SENT to a face — a simulator's has no input lane (`LiveFace.input` absent), and the
//    phone never asks for one.
//  - MEMORY: the face's texture is the HOST's to keep and let go (the cap shared with panes is PT-S2's); the kind charges
//    only what it makes itself (local.ts — its words' texture).

import {
  createSight,
  type Entity,
  type KindHost,
  LIVE,
  type LiveFace,
  type LiveInfo,
  type LiveSimulatorSpec,
  type LiveState,
  type Sight,
} from "@vibefield/plugin-sdk/desk";
import { PHONE, type PhoneLaw, type PhoneLiveDemand, phoneDemand, sameDemand } from "./law";

/** What the phones' faces have done since the desk was made — a test's and a smoke's witness. */
export interface PhoneFaceStats {
  readonly opened: number;
  readonly closed: number;
  /** Takes that landed (a frame or new words) — and of them, those that asked a redraw and those that asked a remake. */
  readonly landed: number;
  readonly redraws: number;
  readonly remakes: number;
  /** Demands sent (change-only). */
  readonly demands: number;
}

/** One phone's face as the faces keep it. */
interface FaceEntry {
  readonly key: string;
  readonly face: LiveFace;
  /** The device it shows, as its spec named it (a new device is a new face). */
  readonly device: string;
  /** The native framebuffer its law asks for in use — the bound device's (or the phone's model's), px. */
  native: readonly [number, number];
  /** The last demand sent. */
  demand: PhoneLiveDemand | undefined;
  /** The texture last seen (its object and epoch) and the words last read — what tells a redraw from a remake. */
  texture: unknown;
  epoch: number;
  words: string;
}

export interface PhoneFaces {
  /**
   * `e`'s face for the device `spec` names — opened (and taken once) at its first ask; reopened when the spec names another
   * device; its native framebuffer kept for its law. Undefined: no `LIVE` lent on this desk, or no durable key (a runtime
   * entity).
   */
  face(e: Entity, spec: LiveSimulatorSpec, native: readonly [number, number]): LiveFace | undefined;
  /** `e`'s face closed — it is unbound. */
  drop(e: Entity): void;
  /** The sight the pass tells (carried on the records). */
  readonly sight: Sight;
  /** The tick's half: take the woken faces (a redraw or a remake each), then send the law's demands. */
  tick(now: number): void;
  /** When the faces are next due: now while a drawn frame is owed its step, else never. */
  due(now: number): number;
  /** `e`'s words now: the face's key, state and info (the record's, the hand's readout, a smoke's witness). */
  words(
    e: Entity,
  ): { readonly key: string; readonly state: LiveState; readonly info: LiveInfo } | undefined;
  /** `e`'s face if it is open (never opens one). */
  opened(e: Entity): LiveFace | undefined;
  /** The phone a durable key's face is open for, and whether it is seen or held now. */
  entityOf(key: string): Entity | undefined;
  shown(e: Entity): boolean;
  forget(e: Entity): void;
  dispose(): void;
  stats(): PhoneFaceStats;
}

/**
 * What a face says that the record reads, as one string — its state and its info's words (never a frame). A host's ACT (a
 * function: the simulator words' `act`, a failure's `retry`) is in it by its PRESENCE: JSON drops a function, and an act that
 * appears or goes is a capsule drawn or gone — new words, the record remade (DESIGN.md §9: "offered only where the host can
 * run it").
 */
const wordsOf = (face: LiveFace): string => {
  const s = face.state();
  const { cursor: _cursor, ...said } = face.info();
  return JSON.stringify(
    [s.is, s.is === "failed" ? [s.reason, s.retry !== undefined] : null, said],
    (_key: string, value: unknown) => (typeof value === "function" ? true : value),
  );
};

/** The device a spec names, as one string (its binding and the name it says). */
const deviceOf = (spec: LiveSimulatorSpec): string => `${spec.deviceType}|${spec.runtime}`;

export function createPhoneFaces(host: KindHost | undefined, law: PhoneLaw = PHONE): PhoneFaces {
  const live = host?.use?.(LIVE);
  const sight = createSight(host?.frames);
  const faces = new Map<Entity, FaceEntry>();
  const byKey = new Map<string, Entity>();
  /** Phones whose face said something arrived since the last tick (arrivals coalesce: one take each). */
  const woken = new Set<Entity>();
  /** Phones whose native framebuffer moved since their last demand: the law is asked again with the sight it has. */
  const relaw = new Set<Entity>();
  const counts = { opened: 0, closed: 0, landed: 0, redraws: 0, remakes: 0, demands: 0 };

  const close = (e: Entity): void => {
    const f = faces.get(e);
    if (f === undefined) return;
    if (byKey.get(f.key) === e) byKey.delete(f.key);
    f.face.close();
    faces.delete(e);
    woken.delete(e);
    relaw.delete(e);
    counts.closed += 1;
  };

  /** A take that landed: a redraw for a frame in the same texture, a remake for a new texture or new words. */
  const landed = (e: Entity, f: FaceEntry): "redraw" | "remake" => {
    counts.landed += 1;
    const t = f.face.texture();
    const words = wordsOf(f.face);
    const remade = t !== f.texture || (t?.epoch ?? -1) !== f.epoch || words !== f.words;
    f.texture = t;
    f.epoch = t?.epoch ?? -1;
    f.words = words;
    if (!remade) return "redraw";
    host?.remake?.(e);
    counts.remakes += 1;
    return "remake";
  };

  return {
    sight,
    face(e, spec, native) {
      const had = faces.get(e);
      if (had !== undefined && had.device === deviceOf(spec)) {
        if (had.native[0] !== native[0] || had.native[1] !== native[1]) relaw.add(e);
        had.native = native;
        return had.face;
      }
      // another device: another face (the host resolves another simulator for it)
      if (had !== undefined) close(e);
      const key = host?.keyOf?.(e);
      if (live === undefined || key === undefined) return undefined;
      const face = live.open(key, { ...spec }, () => {
        woken.add(e);
        host?.wake?.();
      });
      const f: FaceEntry = {
        key,
        face,
        device: deviceOf(spec),
        native,
        demand: undefined,
        texture: undefined,
        epoch: -1,
        words: wordsOf(face),
      };
      faces.set(e, f);
      byKey.set(key, e);
      counts.opened += 1;
      // what the host already holds lands in the frame that opens it: the record being made reads it
      if (face.take()) {
        counts.landed += 1;
        const t = face.texture();
        f.texture = t;
        f.epoch = t?.epoch ?? -1;
        f.words = wordsOf(face);
      }
      return face;
    },
    drop(e) {
      close(e);
      sight.forget(e);
    },
    tick(_now) {
      let redraw = false;
      for (const e of woken) {
        const f = faces.get(e);
        if (f === undefined || !f.face.take()) continue;
        if (landed(e, f) === "redraw") redraw = true;
      }
      woken.clear();
      // the frame drawn again, no record remade: the phone's record stands and its pass reads the face's new texture
      if (redraw) {
        counts.redraws += 1;
        host?.redraw?.();
      }
      const asked = new Set<Entity>(relaw);
      relaw.clear();
      for (const [e] of sight.step()) asked.add(e);
      for (const e of asked) {
        const f = faces.get(e);
        const s = sight.of(e);
        if (f === undefined || s === undefined) continue;
        const held =
          f.demand?.mode === "live" && !f.demand.interactive ? f.demand.raster[0] : undefined;
        const d = phoneDemand(s, f.native, held, law);
        if (sameDemand(f.demand, d)) continue;
        f.demand = d;
        counts.demands += 1;
        f.face.demand(d);
      }
    },
    due: (now) => (sight.owed() ? now : Number.POSITIVE_INFINITY),
    words(e) {
      const f = faces.get(e);
      return f === undefined
        ? undefined
        : { key: f.key, state: f.face.state(), info: f.face.info() };
    },
    opened: (e) => faces.get(e)?.face,
    entityOf: (key) => byKey.get(key),
    // seen or held: the sight's last fact, or — before its first step — the law's last ask
    shown(e) {
      const s = sight.of(e);
      return s?.seen === true || s?.held === true || faces.get(e)?.demand?.mode === "live";
    },
    forget(e) {
      close(e);
      sight.forget(e);
    },
    dispose() {
      for (const e of [...faces.keys()]) close(e);
      woken.clear();
      relaw.clear();
      byKey.clear();
    },
    stats: () => ({ ...counts }),
  };
}
