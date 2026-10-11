// The pane's DESK STATE — the kind's own state on ONE desk (`ObjectKind.local`): each pane's HEAD raster, drawn by the
// head service its DOM half lends (`HEAD_RASTER` — head-canvas.ts) and cached by what it says and the band it is drawn
// at (head.ts `headKey`): re-drawn when its address, its viewport or its rung moves, never on a pan or a frame. Flux,
// never a world fact: the facts are the pane's props and its size.
//
// And the desk's WAKE for a page the pass deferred (pass.ts `PAGE_REMAKE_MS` — a resize remakes the page as the hand
// pauses, not every frame): while one waits the kind is due a little later, and its tick asks for a frame, in which the
// pass makes it (K7a: nothing polled at rest — with nothing waiting the kind is never due on its own).
//
// A desk lending no head service (a Node still, a bare host) draws no head from here: the record names the committed
// raster its key names instead (head-still.ts), or none.
//
// PT-2 — and each pane's LIVE FACE (live.ts): its page, opened by the object's durable key on the host's `LIVE` service, taken
// when it says something arrived, asked of by the pane's demand law over the desk's SIGHT. Its tick takes and asks; its due is
// the sight's step owed after a drawn frame, or a held-back viewport — nothing polled at rest.
//
// PT-3 — and the pane IN USE: what the hand does with it in hand (`held` — ICE's `HeldEvent`, in its open extent's units):
// a press on its PAGE, the press's moves and its release wherever they go, the hover over it and the wheel over it, sent to the
// face in the displayed frame's logical px (the page's CSS px through the pane's own eye, scaled to `texture().logical` —
// never the texels, never the viewport the law last asked: a resize in flight shows an older frame); a press on an engraved
// CONTROL of its head acted on its release (back, forward, reload — stop while it loads — and the address, the hand's). Its
// page is NAVIGATED through the host's second service (`BROWSER_NAVIGATION`, by the face's key), never re-opened; and an
// address that moved UNDER a live page — a peer's navigation arriving through the document, an undo — is FOLLOWED: the page
// goes there (the pane shows what the document says), while the page's own navigation is never echoed back as a second.

import {
  BROWSER_NAVIGATION,
  type BrowserNavigationCommand,
  type Entity,
  type KindHost,
  type KindLocal,
  type LiveBrowserSpec,
  type LiveFace,
  type LiveInfo,
  type LiveInput,
  type LiveState,
  type Sight,
} from "@vibefield/plugin-sdk/desk";
import {
  faviconId,
  GENERIC_FAVICON,
  HEAD_RASTER,
  type HeadState,
  headKey,
  pageFavicon,
  REFUSAL_WORDS,
} from "./head";
import { BROWSER_PANE_KIND, SAMPLE_URL } from "./ids";
import {
  HELD_CONTROLS,
  type HeldPart,
  heldPagePoint,
  heldPartAt,
  type PaneGeometry,
  type PaneShape,
  wheelToPage,
} from "./law";
import type { HeadBitmap, NoticePlan } from "./layout";
import { createPaneFaces, isPageUrl, noticeBudgetKey, type PaneFaceStats } from "./live";
import { failureWords, noticeKey, noticeScale, RETRY_LABEL } from "./notice";
import { PAGE_REMAKE_MS } from "./pass";

/** The pass's doors the local reads (the root pass, once the ground has made it). */
interface PaneDoors {
  pending(): number;
  onPending(fn: (() => void) | undefined): void;
  forget(entity: number): void;
  made(entity: number): number;
  /** PT-5b — told a pane's notice texture was made (its bytes) or let go (0); and a notice let go at the budget's word. */
  onNotice?(fn: ((entity: number, bytes: number) => void) | undefined): void;
  unnotice?(entity: number): boolean;
}

/** The pane's open extent on the desk: its centre and size (law.ts `openExtent`). */
export interface PaneExtent {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
}

/** The hand's doors the desk state calls (its DOM half — hand.ts): a press on the head's capsule takes up the address. */
export interface PaneHandDoors {
  address(e: Entity): void;
}

export interface PaneLocal extends KindLocal {
  /** A pane's head for what it says at `tpu`: its key, and the service's raster (none lent: the key alone). */
  head(
    e: Entity,
    S: PaneShape,
    state: HeadState,
    tpu: number,
  ): { readonly key: string; readonly bitmap?: HeadBitmap };
  /** What `e`'s head says now — its address, its viewport readout — as its record last asked (a smoke's witness, read through the desk door). */
  said(e: Entity): HeadState | undefined;
  /** Heads drawn since the desk was made (a test's witness). */
  stats(): { readonly heads: number };
  /** PT-2 — `e`'s live face for the page `spec` names (opened at its first ask; undefined: no `LIVE` lent, no durable key).
   * PT-4 — a spec that MOVED under its open face (another device, another scheme, another viewport with it) is told to the
   * page through the host's `respec`, never by re-opening it; its url is not part of that (an address moves by `follow`). */
  face(e: Entity, spec: LiveBrowserSpec, S: PaneShape): LiveFace | undefined;
  /**
   * PT-4 — what `e`'s head says of its page's favicon (`HeadState.favicon`): the page's own once the head's service has
   * decoded its picture (the pane is remade when it has), the generic mark where the page has none or it cannot be read
   * — and null where the host says nothing of favicons (a still's face).
   */
  icon(e: Entity, info: LiveInfo | undefined): string | null;
  /** PT-4 — specs told to the host under an open face (a test's witness). */
  readonly respecs: number;
  /** PT-2 — `e`'s face closed: its address is no longer a page. */
  drop(e: Entity): void;
  /** PT-2 — the sight the pass tells, carried on the records of panes with a face. */
  readonly sight: Sight;
  /** PT-2 — `e`'s page's words now (its state and info), or undefined: no face. */
  page(
    e: Entity,
  ): { readonly key: string; readonly state: LiveState; readonly info: LiveInfo } | undefined;
  /** PT-2 — what the faces did (a test's and a smoke's witness). */
  faces(): PaneFaceStats;
  /** PT-3 — `e` as its record laid it IN HAND: its geometry, its open extent, the hand's zoom (CSS px a desk unit). */
  laid(e: Entity, G: PaneGeometry, ext: PaneExtent, zoom: number): void;
  /** PT-3 — `e`'s layout in hand, as its record last laid it (the hand's lease places the editor by it). */
  layout(
    e: Entity,
  ): { readonly G: PaneGeometry; readonly ext: PaneExtent; readonly zoom: number } | undefined;
  /** PT-3 — send `e`'s page an input (the hand's lease: keys, text, the IME); false — no face, or a view-only one. */
  send(e: Entity, input: LiveInput): boolean;
  /** PT-3 — navigate `e`'s page through the host's `BROWSER_NAVIGATION`, by its face's key; false — none lent, no page. */
  navigate(e: Entity, command: BrowserNavigationCommand): boolean;
  /** PT-3 — a control's act: back, forward, reload (stop while the page loads), the address (the hand's). */
  act(e: Entity, control: HeldPart): void;
  /** PT-3 — the url `e`'s record read: one that moved under its live page (a peer's, an undo) navigates the page there. */
  follow(e: Entity, url: string): void;
  /** PT-3 — the panes whose page WENT, of its own, to a web address the record has not read (from where it stood when the record
   * last read a new url): the hand writes it, not undoably (ruling 9). A page that has not yet followed the document is not one;
   * nor is a page's plumbing (its bootstrap `about:blank`, an error page). */
  addressed(): ReadonlyMap<Entity, string>;
  /** PT-3 — the hand's doors (its DOM half binds them as it joins). */
  bind(hand: PaneHandDoors | undefined): void;
  /**
   * PT-5a — a FAILED page's notice as the pass lays it (the words' light, drawn by the lent raster — once a reason, a size
   * and an ink; PT-5b: the words' BLOCK alone, its own texture), or undefined: no raster lent on this desk — the page
   * carries no words.
   */
  notice(
    e: Entity,
    S: PaneShape,
    state: Extract<LiveState, { is: "failed" }>,
    ink: string,
  ): NoticePlan | undefined;
  /** PT-5a — what `e`'s head says for a moment instead of its address (a download refused), or undefined. */
  saying(e: Entity): string | undefined;
  /** PT-5a — notices drawn since the desk was made (a test's witness). */
  readonly notices: number;
}

const doorsOf = (host: KindHost | undefined): PaneDoors | undefined => {
  const pass = host?.pass() as Partial<PaneDoors> | undefined;
  return typeof pass?.pending === "function" && typeof pass.onPending === "function"
    ? (pass as PaneDoors)
    : undefined;
};

export function createPaneLocal(host: KindHost | undefined): PaneLocal {
  const nav = host?.use?.(BROWSER_NAVIGATION);
  // PT-5b — a face's texture the desk's budget evicted is the HOST's to let go (a host older than PT-5b lends no `evict`:
  // its texture stands, uncharged until its next frame)
  const live = createPaneFaces(host, undefined, { evict: (key) => nav?.evict?.(key) });
  /** PT-3 — each pane's layout in hand, its press (on its page, or on a control until its release), and the url its record read. */
  const laidOut = new Map<
    Entity,
    { readonly G: PaneGeometry; readonly ext: PaneExtent; readonly zoom: number }
  >();
  const pressing = new Map<Entity, HeldPart>();
  const urls = new Map<Entity, string>();
  /** PT-4 — each open face's spec less its address, as one string: what a `respec` is told when it moves. */
  const specs = new Map<Entity, string>();
  let respecs = 0;
  /** Where each page stood when its record read a NEW url — what the page does from there is its own navigation. */
  const stoodAt = new Map<Entity, string | undefined>();
  let hand: PaneHandDoors | undefined;
  const navigate = (e: Entity, command: BrowserNavigationCommand): boolean => {
    const key = live.words(e)?.key;
    return key !== undefined && nav?.navigate(key, command) === true;
  };
  const act = (e: Entity, control: HeldPart): void => {
    const words = live.words(e);
    // PT-5a — a FAILED page: "Try again" on its film, and ↻ on its head and on the bar, are the face's own retry (a reload
    // of the address that failed, a stopped page loaded again, a lost one opened again); with nothing to try, nothing
    if (control === "retry" || (control === "reload" && words?.state.is === "failed")) {
      if (words?.state.is === "failed") words.state.retry?.();
      return;
    }
    if (control === "back" || control === "forward") {
      // nowhere to go: nothing is asked (the bar's slot is disabled, the head's chevron a hairline — and its chord the same)
      if ((control === "back" ? words?.info.back : words?.info.forward) !== true) return;
      navigate(e, { action: control });
    } else if (control === "reload")
      navigate(e, { action: words?.info.loading !== undefined ? "stop" : "reload" });
    else if (control === "address") hand?.address(e);
  };
  /** PT-5a — each failed pane's notice, by what it is drawn from. */
  const noticed = new Map<Entity, NoticePlan>();
  /**
   * PT-5b (ruling 4) — a failed pane's NOTICE charged to the desk's budget: the pass says when its texture is made (its
   * bytes on the device, mips and all) or let go; evicted, the pass lets it go (it is laid again from its record when the
   * pane is next drawn — and charged again).
   */
  /** PT-5b2 (ruling 7): the notice rows charged, by pane — a row is named by its face's key, and must be found again when
   * the face is gone (the pane deleted, its address no page any more): it goes WITH ITS PANE, as the face's row does. */
  const noticeRows = new Map<Entity, string>();
  const releaseNotice = (e: Entity): void => {
    const row = noticeRows.get(e);
    if (row === undefined) return;
    noticeRows.delete(e);
    host?.budget?.release(BROWSER_PANE_KIND, row);
  };
  const chargeNotice = (entity: number, bytes: number): void => {
    const e = entity as Entity;
    if (bytes <= 0) {
      releaseNotice(e);
      return;
    }
    const key = live.words(e)?.key;
    if (key === undefined || host?.budget === undefined) return;
    const row = noticeBudgetKey(key);
    noticeRows.set(e, row);
    host.budget.charge(BROWSER_PANE_KIND, row, bytes, () => {
      // (the ledger has dropped the row itself)
      noticeRows.delete(e);
      doors()?.unnotice?.(entity);
    });
  };
  let notices = 0;
  const heads = new Map<Entity, { readonly key: string; readonly bitmap: HeadBitmap }>();
  const saying = new Map<Entity, HeadState>();
  let drawn = 0;
  let wired: PaneDoors | undefined;
  /** The root pass's doors, its deferral wired to the desk's wake the first time they are there. */
  const doors = (): PaneDoors | undefined => {
    const d = doorsOf(host);
    if (d !== undefined && d !== wired) {
      d.onPending(() => host?.wake?.());
      d.onNotice?.(chargeNotice);
      wired = d;
    }
    return d;
  };
  const waiting = (): boolean => (doors()?.pending() ?? 0) > 0;
  return {
    head(e, S, state, tpu) {
      doors();
      saying.set(e, state);
      const key = headKey(S, state, tpu);
      const had = heads.get(e);
      if (had?.key === key) return had;
      const bitmap = host?.use?.(HEAD_RASTER)?.raster(S, state, tpu);
      if (bitmap === undefined) return { key };
      const next = { key, bitmap };
      heads.set(e, next);
      drawn += 1;
      return next;
    },
    said: (e) => saying.get(e),
    stats: () => ({ heads: drawn }),
    face(e, spec, S) {
      const face = live.face(e, spec, S);
      if (face === undefined) return undefined;
      // the spec less its address (an address moves by `follow`): the device, the scheme, the viewport, the density, the label
      const { url: _url, ...shape } = spec;
      const now = JSON.stringify(shape);
      const was = specs.get(e);
      specs.set(e, now);
      if (was !== undefined && was !== now) {
        const key = live.words(e)?.key;
        // (a host older than PT-4 lends a navigation with no `respec`: the page keeps the device it was opened on)
        if (key !== undefined && nav?.respec?.(key, { ...spec }) === true) respecs += 1;
      }
      return face;
    },
    icon(e, info) {
      const favicon = pageFavicon(info);
      if (favicon === undefined) return null;
      if (favicon === null) return GENERIC_FAVICON;
      const printed = host?.use?.(HEAD_RASTER)?.picture?.(favicon, () => {
        // its picture is decoded: the head is made again, saying it
        host?.remake?.(e);
        host?.wake?.();
      });
      return printed === true ? faviconId(favicon.key) : GENERIC_FAVICON;
    },
    get respecs() {
      return respecs;
    },
    notice(e, S, state, ink) {
      doors();
      const spec = {
        viewport: S.viewport,
        scale: noticeScale(S.viewport),
        words: failureWords(state.reason),
        retry: state.retry === undefined ? null : RETRY_LABEL,
        ink,
      };
      const key = noticeKey(spec);
      const had = noticed.get(e);
      if (had?.key === key) return had;
      const drawn = host?.use?.(HEAD_RASTER)?.notice?.(spec);
      if (drawn === undefined) return undefined;
      const plan: NoticePlan = { key, viewport: S.viewport, ...drawn };
      noticed.set(e, plan);
      notices += 1;
      return plan;
    },
    saying(e) {
      const what = live.saying(e);
      return what === undefined ? undefined : REFUSAL_WORDS[what];
    },
    get notices() {
      return notices;
    },
    drop(e) {
      live.drop(e);
      urls.delete(e);
      specs.delete(e);
      pressing.delete(e);
      noticed.delete(e);
      releaseNotice(e);
    },
    sight: live.sight,
    // PT-5b — the kind's word on a raster it charged (`live <key>`, `notice <key>`): kept while its pane is seen or held
    keeps(key) {
      const at = key.indexOf(" ");
      const e = at < 0 ? undefined : live.entityOf(key.slice(at + 1));
      return e !== undefined && live.shown(e);
    },
    page: (e) => live.words(e),
    faces: () => live.stats(),
    // the faces' takes and asks answer nothing of their own: a landed frame asks a redraw, new words a remake of its pane
    tick: (now) => {
      live.tick(now);
      return waiting();
    },
    due: (now) =>
      Math.min(waiting() ? now + PAGE_REMAKE_MS / 3 : Number.POSITIVE_INFINITY, live.due(now)),
    // a page made after its record (a deferred one) changes how the pane looks with no fact of its own moving
    landed: (e) => doors()?.made(e as number) ?? 0,
    laid(e, G, ext, zoom) {
      laidOut.set(e, { G, ext, zoom });
    },
    layout: (e) => laidOut.get(e),
    send: (e, input) => live.send(e, input),
    navigate,
    act,
    // THE HAND'S INPUT (ruling 3): its page's press, the press's moves and release wherever they go, the hover and the wheel over
    // the page — in the displayed frame's logical px; a control's press is the control's, acted on its release over it
    held(e, events) {
      const at = laidOut.get(e);
      if (at === undefined) return;
      const S = at.G.shape;
      const logical = live.opened(e)?.texture()?.logical ?? S.viewport;
      const sx = logical[0] / S.viewport[0];
      const sy = logical[1] / S.viewport[1];
      const page = (x: number, y: number): readonly [number, number] => {
        const [px, py] = heldPagePoint(at.G, at.ext, x, y);
        return [px * sx, py * sy];
      };
      for (const ev of events) {
        if (ev.type === "wheel") {
          if (heldPartAt(at.G, at.ext.cx + ev.x, at.ext.cy + ev.y) !== "page") continue;
          const [x, y] = page(ev.x, ev.y);
          live.send(e, {
            kind: "wheel",
            x,
            y,
            dx: wheelToPage(ev.dx, at.zoom, S) * sx,
            dy: wheelToPage(ev.dy, at.zoom, S) * sy,
          });
          continue;
        }
        const pressed = pressing.get(e);
        // a control's press: its moves are its own, its release over it acts
        if (pressed !== undefined && pressed !== "page") {
          if (ev.phase === "up") {
            pressing.delete(e);
            if (ev.part === pressed) act(e, pressed);
          }
          continue;
        }
        const part = ev.part as HeldPart | "content" | null;
        if (ev.phase === "down" && part !== "page") {
          if (part !== null && HELD_CONTROLS.includes(part as HeldPart))
            pressing.set(e, part as HeldPart);
          continue;
        }
        // a hover off the page with nothing pressed is not the page's
        if (part !== "page" && pressed !== "page") continue;
        if (ev.phase === "down") pressing.set(e, "page");
        else if (ev.phase === "up") pressing.delete(e);
        const [x, y] = page(ev.x, ev.y);
        live.send(e, {
          kind: "pointer",
          x,
          y,
          button: ev.button,
          buttons: ev.buttons,
          count: ev.count,
          phase: ev.phase,
        });
      }
    },
    // the document's word over the page's: an address that moved under a live page is followed, the page's own never echoed back
    follow(e, url) {
      const was = urls.get(e);
      if (was === url) return;
      urls.set(e, url);
      const at = live.words(e)?.info.address;
      stoodAt.set(e, at);
      if (was === undefined || at === url) return;
      navigate(e, { action: "go", url });
    },
    addressed() {
      const out = new Map<Entity, string>();
      for (const [e, url] of urls) {
        const at = live.words(e)?.info.address;
        if (at === undefined || at === url || at === stoodAt.get(e) || !isPageUrl(at, SAMPLE_URL))
          continue;
        out.set(e, at);
      }
      return out;
    },
    bind(next) {
      hand = next;
    },
    forget(e) {
      heads.delete(e);
      saying.delete(e);
      doors()?.forget(e as number);
      live.forget(e);
      laidOut.delete(e);
      pressing.delete(e);
      urls.delete(e);
      specs.delete(e);
      stoodAt.delete(e);
      noticed.delete(e);
      releaseNotice(e);
    },
    dispose() {
      for (const e of [...noticeRows.keys()]) releaseNotice(e);
      live.dispose();
      heads.clear();
      saying.clear();
      laidOut.clear();
      pressing.clear();
      urls.clear();
      noticed.clear();
      hand = undefined;
      wired?.onPending(undefined);
      wired?.onNotice?.(undefined);
      wired = undefined;
    },
  };
}
