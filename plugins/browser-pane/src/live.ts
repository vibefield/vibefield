// THE PANE'S LIVE PAGE (PT-2 — PORTALS' rulings 1–6; ICE design-019 §3.3–§3.5 as the pane uses them, after LT1's reference
// consumer, the rig's live kind): a pane whose address is a web page (http or https — the sample stays PT-1's still, and any
// other address the dark film) holds a LIVE FACE that the host's `LIVE` service opens for it, by the object's DURABLE key
// (`KindHost.keyOf` — so a reload re-attaches the same page, never a new one), and its pass draws the face's texture. The kind
// holds a view and words, never a frame (PA-22: the host fills the texture).
//  - OPENED at the pane's record (a runtime entity — a tray's ghost, a specimen — has no durable key, and gets no face), TAKEN
//    once at the open (what the host already holds lands in the frame that opens it); closed when the pane leaves, or when its
//    address stops being a page;
//  - an ARRIVAL marks the face and wakes the desk (`KindHost.wake`); the tick takes each woken face: a frame landed in the SAME
//    texture asks `redraw()` — the frame drawn again, no record remade — and a NEW texture (the first, a new size) or new WORDS
//    (the address, the loading line, the history's reach: what the head and the record read) ask `remake(e)`; the tick answers
//    nothing of its own (the local's tick stays false for it);
//  - THE DEMAND (ruling 5): the sight (`createSight(host.frames)`, told by the pass's prepares) feeds the pane's law
//    (`paneDemand` — paused unseen; native at 60 and interactive in the hand; at rest the halving of native that covers the
//    page, its rung held through a wobble, 30 fps from 320 device px and 15 under), sent CHANGE-ONLY; a new size or device asks
//    the law again with the same sight — a NEW VIEWPORT is the source's relayout, sent at most once each `PAGE_REMAKE_MS` while
//    the size moves (the still's re-cut, PT-1, is now the source's) and once more when it rests. The kind is due NOW while a
//    frame was drawn its sight has not stepped over, or when a held-back viewport falls due; never else.
//  - IN USE (PT-3): the face is SENT what the hand gives it (`send` — the local's `held`, the hand's lease) and the page's
//    CURSOR is its word (`LiveInfo.cursor`): a cursor that moves asks a frame (`redraw` — the desk's cursor is read in a frame),
//    never a remake — the record does not read it.

import {
  createSight,
  type Entity,
  type KindHost,
  LIVE,
  type LiveBrowserSpec,
  type LiveFace,
  type LiveInfo,
  type LiveInput,
  type LiveState,
  type Sight,
} from "@vibefield/plugin-sdk/desk";
import { pageFavicon } from "./head";
import {
  BROWSER,
  type BrowserLaw,
  type PaneLiveDemand,
  type PaneShape,
  paneDemand,
  sameDemand,
} from "./law";
import { PAGE_REMAKE_MS } from "./pass";

/** Is an address a web page the host's browser opens (its policy: http and https)? The sample is PT-1's still, never a page. */
export const isPageUrl = (url: string, sample: string): boolean =>
  url !== sample && /^https?:\/\//i.test(url);

/** What the pane's faces have done since the desk was made — a test's and a smoke's witness. */
export interface PaneFaceStats {
  readonly opened: number;
  readonly closed: number;
  /** Takes that landed (a frame or new words) — and of them, those that asked a redraw and those that asked a remake. */
  readonly landed: number;
  readonly redraws: number;
  readonly remakes: number;
  /** PT-3: inputs sent to the faces. */
  readonly sent: number;
  /** Demands sent (change-only), and new viewports held back while a size moved. */
  readonly demands: number;
  readonly held: number;
}

/** One pane's face as the local keeps it. */
interface FaceEntry {
  readonly key: string;
  readonly face: LiveFace;
  /** The pane's shape its law reads (its viewport, its native raster) — the latest record's. */
  shape: PaneShape;
  /** The last demand sent, and when its viewport was (the frame clock, ms). */
  demand: PaneLiveDemand | undefined;
  viewportAt: number;
  /** The texture last seen (its object and epoch) and the words last read — what tells a redraw from a remake. */
  texture: unknown;
  epoch: number;
  words: string;
}

export interface PaneFaces {
  /**
   * `e`'s face for the page `spec` names — opened (and taken once) at its first ask; the pane's shape kept for its law. Undefined:
   * no `LIVE` lent on this desk, or no durable key (a runtime entity).
   */
  face(e: Entity, spec: LiveBrowserSpec, S: PaneShape): LiveFace | undefined;
  /** `e`'s face closed — its address is no longer a page. */
  drop(e: Entity): void;
  /** The sight the pass tells (carried on the records). */
  readonly sight: Sight;
  /** The tick's half: take the woken faces (a redraw or a remake each), then send the law's demands. */
  tick(now: number): void;
  /** When the faces are next due: now while a drawn frame is owed its step, then a held-back viewport, else never. */
  due(now: number): number;
  /** `e`'s words now: the page's state and info (the head's, the hand's readout, a smoke's witness). */
  words(
    e: Entity,
  ): { readonly key: string; readonly state: LiveState; readonly info: LiveInfo } | undefined;
  /** PT-3 — `e`'s face if it is open (never opens one). */
  opened(e: Entity): LiveFace | undefined;
  /** PT-3 — send `e`'s face an input (false: no face, or a view-only one). */
  send(e: Entity, input: LiveInput): boolean;
  forget(e: Entity): void;
  dispose(): void;
  stats(): PaneFaceStats;
}

/** What a face says that the record reads, as one string — never its cursor (the desk reads that in a frame, not a record),
 * and its favicon by its KEY (PT-4): the bytes are not words to spell at every frame. */
const wordsOf = (face: LiveFace): string => {
  const s = face.state();
  const info = face.info();
  const { cursor: _cursor, extra: _extra, ...said } = info;
  const favicon = pageFavicon(info);
  return JSON.stringify([
    s.is,
    s.is === "failed" ? s.reason : null,
    said,
    favicon === undefined ? null : (favicon?.key ?? ""),
  ]);
};

export function createPaneFaces(host: KindHost | undefined, law: BrowserLaw = BROWSER): PaneFaces {
  const live = host?.use?.(LIVE);
  const sight = createSight(host?.frames);
  const faces = new Map<Entity, FaceEntry>();
  /** Panes whose face said something arrived since the last tick (arrivals coalesce: one take each). */
  const woken = new Set<Entity>();
  /** Panes whose shape moved since their last demand: the law is asked again with the sight it has. */
  const relaw = new Set<Entity>();
  const counts = {
    opened: 0,
    closed: 0,
    landed: 0,
    redraws: 0,
    remakes: 0,
    demands: 0,
    held: 0,
    sent: 0,
  };

  const close = (e: Entity): void => {
    const f = faces.get(e);
    if (f === undefined) return;
    f.face.close();
    faces.delete(e);
    woken.delete(e);
    relaw.delete(e);
    counts.closed += 1;
  };

  /** A take that landed: a redraw for a frame in the same texture (or a cursor that moved), a remake for a new texture or new words. */
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
    face(e, spec, S) {
      const had = faces.get(e);
      if (had !== undefined) {
        if (
          had.shape.viewport[0] !== S.viewport[0] ||
          had.shape.viewport[1] !== S.viewport[1] ||
          had.shape.device.dpr !== S.device.dpr
        )
          relaw.add(e);
        had.shape = S;
        return had.face;
      }
      const key = host?.keyOf?.(e);
      if (live === undefined || key === undefined) return undefined;
      const face = live.open(key, { ...spec }, () => {
        woken.add(e);
        host?.wake?.();
      });
      const f: FaceEntry = {
        key,
        face,
        shape: S,
        demand: undefined,
        viewportAt: Number.NEGATIVE_INFINITY,
        texture: undefined,
        epoch: -1,
        words: wordsOf(face),
      };
      faces.set(e, f);
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
    drop: (e) => {
      close(e);
      sight.forget(e);
    },
    tick(now) {
      let redraw = false;
      for (const e of woken) {
        const f = faces.get(e);
        if (f === undefined || !f.face.take()) continue;
        if (landed(e, f) === "redraw") redraw = true;
      }
      woken.clear();
      // the frame drawn again, no record remade: the pane's record stands and its pass reads the face's new texture
      if (redraw) {
        counts.redraws += 1;
        host?.redraw?.();
      }
      const asked = new Set<Entity>(relaw);
      for (const [e] of sight.step()) asked.add(e);
      for (const e of asked) {
        const f = faces.get(e);
        const s = sight.of(e);
        if (f === undefined || s === undefined) {
          relaw.delete(e);
          continue;
        }
        const held =
          f.demand?.mode === "live" && !f.demand.interactive ? f.demand.raster[0] : undefined;
        const d = paneDemand(s, f.shape, held, law);
        if (sameDemand(f.demand, d)) {
          relaw.delete(e);
          continue;
        }
        // a new viewport is the source's relayout: once each PAGE_REMAKE_MS while the size moves, and once more when it rests
        const moved =
          f.demand?.viewport !== undefined &&
          d.viewport !== undefined &&
          (f.demand.viewport[0] !== d.viewport[0] || f.demand.viewport[1] !== d.viewport[1]);
        if (moved && now - f.viewportAt < PAGE_REMAKE_MS) {
          relaw.add(e);
          counts.held += 1;
          continue;
        }
        relaw.delete(e);
        if (moved || f.demand === undefined) f.viewportAt = now;
        f.demand = d;
        counts.demands += 1;
        f.face.demand(d);
      }
    },
    due(now) {
      if (sight.owed()) return now;
      let next = Number.POSITIVE_INFINITY;
      for (const e of relaw) {
        const f = faces.get(e);
        if (f !== undefined) next = Math.min(next, Math.max(now, f.viewportAt + PAGE_REMAKE_MS));
      }
      return next;
    },
    words(e) {
      const f = faces.get(e);
      return f === undefined
        ? undefined
        : { key: f.key, state: f.face.state(), info: f.face.info() };
    },
    opened: (e) => faces.get(e)?.face,
    send(e, input) {
      const f = faces.get(e)?.face;
      if (f?.input === undefined) return false;
      counts.sent += 1;
      f.input(input);
      return true;
    },
    forget(e) {
      close(e);
      sight.forget(e);
    },
    dispose() {
      for (const e of [...faces.keys()]) close(e);
      woken.clear();
      relaw.clear();
    },
    stats: () => ({ ...counts }),
  };
}
