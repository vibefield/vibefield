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
//  - A STILL (PT-5b): the host may lay the page's last still into the face's texture (before its first frame, while its page
//    is at rest, under a failure's words) and says so (`LiveInfo.extra.still` — head.ts `pageStill`): that it IS one is a
//    word the record reads (the photograph's dim, the head's rest mark), so its coming and going remakes the pane — its
//    age never does.
//  - MEMORY (PT-5b ruling 4; design-019 §7): each face's texture is CHARGED to the desk's raster budget under the kind's
//    name (`live <key>`, its `bytes` — charged again when the texture or its size moves, touched at each frame that lands),
//    KEPT while its pane is seen or held (`keeps`), and at the budget's eviction the host is asked to let it go
//    (`evict` — `BROWSER_NAVIGATION.evict`): the pane shows its film, or its still when it is next seen.

import {
  createSight,
  type Entity,
  type KindHost,
  LIVE,
  type LiveBrowserRefusal,
  type LiveBrowserSpec,
  type LiveFace,
  type LiveInfo,
  type LiveInput,
  type LiveState,
  type Sight,
} from "@vibefield/plugin-sdk/desk";
import { pageFavicon, pageRefusal, pageStill, REFUSAL_SAY_MS } from "./head";
import { BROWSER_PANE_KIND } from "./ids";
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
  /** PT-5b — charges made to the desk's budget for a face's texture (a new texture, a new size), and textures the budget
   * evicted. */
  readonly charges: number;
  readonly evictions: number;
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
  /** PT-5a — the serial of the last refusal the page's words carried, and until when (the frame clock, ms) the head says it. */
  refusal: number;
  sayUntil: number;
  said: LiveBrowserRefusal["what"] | undefined;
  /** PT-5b — the bytes charged to the desk's budget for its texture (0: none charged), and the texture they were for. */
  charged: number;
  chargedFor: unknown;
  /** PT-6a (M7 C1) — when the face was last STIRRED: a frame of its page arrived, or an input was sent it
   * (`performance.now()`, ms; −∞: never) — what the hand's driver reads to let a held, still page's desk sleep. */
  stirredAt: number;
}

/** The budget's key for a face's texture, and for a pane's notice (the kind's two rows a pane). */
export const liveBudgetKey = (key: string): string => `live ${key}`;
export const noticeBudgetKey = (key: string): string => `notice ${key}`;

/** What the faces ask of the kind's local (its second service is the local's): a texture the budget evicted is let go. */
export interface PaneFaceDoors {
  evict?(key: string): void;
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
  /** PT-6a (M7 C1) — when `e`'s face was last stirred (a frame arrived, an input sent; `performance.now()` ms), or undefined:
   * no face. */
  stirred(e: Entity): number | undefined;
  /** PT-3 — send `e`'s face an input (false: no face, a view-only one — or, PT-5a, a FAILED one: nothing is sent to a page
   * nobody sees). */
  send(e: Entity, input: LiveInput): boolean;
  /** PT-5a — what `e`'s head says for a moment: something its page asked for and was refused, while the moment lasts. */
  saying(e: Entity): LiveBrowserRefusal["what"] | undefined;
  /** PT-5b — the pane a durable key's face is open for, and whether it is seen or held now (what `keeps` answers by). */
  entityOf(key: string): Entity | undefined;
  shown(e: Entity): boolean;
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
    // PT-5b: THAT the texture is a still (never its age — it would remake the pane at every read)
    pageStill(info) !== undefined,
  ]);
};

export function createPaneFaces(
  host: KindHost | undefined,
  law: BrowserLaw = BROWSER,
  doors: PaneFaceDoors = {},
): PaneFaces {
  const live = host?.use?.(LIVE);
  const budget = host?.budget;
  const sight = createSight(host?.frames);
  const faces = new Map<Entity, FaceEntry>();
  /** The pane each durable key's face is open for (the budget speaks in keys). */
  const byKey = new Map<string, Entity>();
  /** Panes whose face said something arrived since the last tick (arrivals coalesce: one take each). */
  const woken = new Set<Entity>();
  /** Panes whose shape moved since their last demand: the law is asked again with the sight it has. */
  const relaw = new Set<Entity>();
  /** PT-5a — panes whose head is saying a refusal (each remade once more when its moment ends), and the frame clock. */
  const speaking = new Set<Entity>();
  let clock = 0;
  const counts = {
    opened: 0,
    closed: 0,
    landed: 0,
    redraws: 0,
    remakes: 0,
    demands: 0,
    held: 0,
    sent: 0,
    charges: 0,
    evictions: 0,
  };

  /**
   * PT-5b — THE FACE'S TEXTURE CHARGED to the desk's budget: its bytes under the kind's name, charged again when the
   * texture or its size moves, touched when a frame lands in it, released when the face has none. Evicted, the host is
   * asked to let it go.
   */
  const account = (f: FaceEntry): void => {
    if (budget === undefined) return;
    const name = liveBudgetKey(f.key);
    const t = f.face.texture();
    if (t === undefined) {
      if (f.charged !== 0) budget.release(BROWSER_PANE_KIND, name);
      f.charged = 0;
      f.chargedFor = undefined;
      return;
    }
    if (f.chargedFor === t && f.charged === t.bytes) {
      budget.touch(BROWSER_PANE_KIND, name);
      return;
    }
    f.charged = t.bytes;
    f.chargedFor = t;
    counts.charges += 1;
    budget.charge(BROWSER_PANE_KIND, name, t.bytes, () => {
      // the ledger has dropped the row: the host lets the texture go (its face says so, and the pane is remade)
      f.charged = 0;
      f.chargedFor = undefined;
      counts.evictions += 1;
      doors.evict?.(f.key);
    });
  };

  const close = (e: Entity): void => {
    const f = faces.get(e);
    if (f === undefined) return;
    if (f.charged !== 0) budget?.release(BROWSER_PANE_KIND, liveBudgetKey(f.key));
    if (byKey.get(f.key) === e) byKey.delete(f.key);
    f.face.close();
    faces.delete(e);
    woken.delete(e);
    relaw.delete(e);
    speaking.delete(e);
    counts.closed += 1;
  };

  /** A take that landed: a redraw for a frame in the same texture (or a cursor that moved), a remake for a new texture or new words. */
  const landed = (e: Entity, f: FaceEntry): "redraw" | "remake" => {
    counts.landed += 1;
    const t = f.face.texture();
    const words = wordsOf(f.face);
    // PT-5a — the page asked for something it may not have (a download): a serial that MOVED under the open face is said
    // on the head for a moment (one already there at the open is an old one's)
    const refusal = pageRefusal(f.face.info());
    const refused = refusal !== undefined && refusal.serial > f.refusal;
    if (refusal !== undefined) f.refusal = Math.max(f.refusal, refusal.serial);
    if (refused) {
      f.said = refusal.what;
      f.sayUntil = clock + REFUSAL_SAY_MS;
      speaking.add(e);
    }
    const remade = t !== f.texture || (t?.epoch ?? -1) !== f.epoch || words !== f.words || refused;
    f.texture = t;
    f.epoch = t?.epoch ?? -1;
    f.words = words;
    account(f);
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
        const opened = faces.get(e);
        if (opened !== undefined) opened.stirredAt = performance.now();
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
        refusal: 0,
        sayUntil: Number.NEGATIVE_INFINITY,
        said: undefined,
        charged: 0,
        chargedFor: undefined,
        stirredAt: Number.NEGATIVE_INFINITY,
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
        account(f);
      }
      // a refusal the page's words already carry is an old one's: never said at the open
      f.refusal = pageRefusal(face.info())?.serial ?? 0;
      return face;
    },
    drop: (e) => {
      close(e);
      sight.forget(e);
    },
    tick(now) {
      clock = now;
      // a head that has said its refusal for its moment says its address again
      for (const e of speaking) {
        const f = faces.get(e);
        if (f !== undefined && now < f.sayUntil) continue;
        speaking.delete(e);
        if (f === undefined) continue;
        f.said = undefined;
        host?.remake?.(e);
        counts.remakes += 1;
      }
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
      // a head saying a refusal is due when its moment ends
      for (const e of speaking) {
        const f = faces.get(e);
        if (f !== undefined) next = Math.min(next, Math.max(now, f.sayUntil));
      }
      return next;
    },
    saying(e) {
      const f = faces.get(e);
      return f !== undefined && clock < f.sayUntil ? f.said : undefined;
    },
    entityOf: (key) => byKey.get(key),
    // seen or held: the sight's last fact, or — before its first step — the law's last ask
    shown(e) {
      const s = sight.of(e);
      return s?.seen === true || s?.held === true || faces.get(e)?.demand?.mode === "live";
    },
    words(e) {
      const f = faces.get(e);
      return f === undefined
        ? undefined
        : { key: f.key, state: f.face.state(), info: f.face.info() };
    },
    opened: (e) => faces.get(e)?.face,
    stirred: (e) => faces.get(e)?.stirredAt,
    send(e, input) {
      const entry = faces.get(e);
      const f = entry?.face;
      // (a failed page is not sent anything: what is there — the engine's own error page — is seen by nobody)
      if (entry === undefined || f?.input === undefined || f.state().is === "failed") return false;
      counts.sent += 1;
      f.input(input);
      entry.stirredAt = performance.now();
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
      speaking.clear();
      byKey.clear();
    },
    stats: () => ({ ...counts }),
  };
}
