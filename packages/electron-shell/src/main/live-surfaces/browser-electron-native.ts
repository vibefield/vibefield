import { BrowserWindow, session } from "electron";
import {
  BrowserFrames,
  type FrameAncestor,
  type FrameQuad,
  type FrameRouted,
  type FrameSight,
  type FrameVisible,
} from "./browser-frames";
import {
  BrowserFrameKeysRefused,
  type BrowserSurfaceAgent,
  type BrowserSurfaceIcon,
  type BrowserSurfaceNative,
  type BrowserSurfaceNativeEmulation,
  type BrowserSurfaceNativeKeyInput,
  type BrowserSurfaceNativeMouseInput,
  type BrowserSurfaceNativeTouchInput,
  type BrowserSurfaceNativeWindow,
  type BrowserSurfaceNativeWindowOptions,
  type BrowserSurfaceNavigationState,
  type BrowserSurfacePaint,
  type BrowserSurfaceRefusal,
  engineAgentOf,
} from "./browser-producer";
import {
  installGuardedBrowserSurfaceContents,
  installGuardedBrowserSurfaceSession,
} from "./browser-security";

/** How long a favicon's fetch may take before the page is said to have none. */
const FAVICON_TIMEOUT_MS = 5_000;

/**
 * PT-5a — said to every document before its own scripts run (CDP `Page.addScriptToEvaluateOnNewDocument`): a page may not
 * close its own window (Electron destroys the WebContents under a script's `window.close()` with no event to refuse — the
 * probe), and its `prompt` answers as a cancelled one (Electron's throws "prompt() is not supported").
 */
const PAGE_GUARD_SCRIPT =
  '(() => { try { Object.defineProperty(window, "close", { value: function close() {}, writable: true, configurable: true }); } catch {} window.prompt = function prompt() { return null; }; })();';

/**
 * PT-5d (M7 H1) — THE HOST'S WORDS LIVE IN THEIR OWN WORLD: the isolated world every document of the page's and its
 * frames' sessions runs the words in (`Page.addScriptToEvaluateOnNewDocument`'s `worldName`), the only world their
 * bindings are installed in (`Runtime.addBinding`'s `executionContextName`). No page script sees, catches or calls a
 * binding — before: in the page's own world, a document that set a setter on its global before the binding's install
 * caught it, and any could `dispatchEvent` a `focus` the words said. The guard stays in the page's own world: it replaces
 * the page's own `window.close` and `prompt`.
 */
export const WORDS_WORLD = "__vibefield_words";

/**
 * PT-5c (ruling 1) — THE PAGE SAYS ITS SCALE. The binding the page's own session adds (`Runtime.addBinding` — heard only
 * with the Runtime on: PT-5c's probe) through which the guard below says the page's visual-viewport scale: nothing reads
 * the engine on the hand's path (a read of `Page.getLayoutMetrics` is the renderer's, and goes unanswered while a
 * navigation pends — a tap after a link waited for the site and landed on the next document).
 */
export const PAGE_SCALE_BINDING = "__vibefieldPageScale";

/**
 * PT-5c (ruling 1) — said to every new document of the page's own session after the guard, before its own scripts: it takes
 * the binding for itself and deletes it from the page's reach (the page's scripts never see it — the probe), then SAYS the
 * visual viewport's scale — at once, at DOMContentLoaded, at load, at its first animation frame (the first words of a
 * document — the early ones can be the scale before its layout: the last of them comes before its first paint), and at
 * every `resize` of its visual viewport (a zoom the page makes, a pinch). The top frame's alone; never the bootstrap blank.
 * PT-5c (R2): and at a `pageshow` that RESTORES the page from the back/forward cache — a document the count calls another
 * (its `did-navigate`) that runs no new-document script and says nothing else. (Electron 43.1.1's cache is off — its
 * delegate's: PT-5c's probe `bfcache.cjs` — so in this engine none comes; the word is there for one that restores.)
 */
export const PAGE_SCALE_SCRIPT = `(() => { const say = globalThis[${JSON.stringify(PAGE_SCALE_BINDING)}]; try { delete globalThis[${JSON.stringify(PAGE_SCALE_BINDING)}]; } catch {} if (typeof say !== "function" || window !== window.top || location.href === "about:blank") return; let last; const tell = (force) => { const viewport = globalThis.visualViewport; const scale = viewport ? viewport.scale : 1; if (!force && scale === last) return; last = scale; try { say(String(scale)); } catch {} }; tell(true); addEventListener("DOMContentLoaded", () => tell(true), { once: true }); addEventListener("load", () => tell(true), { once: true }); requestAnimationFrame(() => tell(true)); addEventListener("pageshow", (event) => { if (event.persisted) tell(true); }); globalThis.visualViewport?.addEventListener("resize", () => tell(false)); })();`;

/**
 * PT-5d (rulings 1, M3) — WHAT A DOCUMENT SAYS OF ITS FRAMES AND ITS FOCUS. The binding every session adds — the page's and
 * each frame's of another site (heard only with the Runtime on) — through which the script below speaks: what the hand's
 * routing reads (`BrowserFrames`), never asking the renderer on the hand's path.
 */
export const FRAME_WORDS_BINDING = "__vibefieldFrameWords";

/**
 * PT-5d (M6.3a, M7 H3) — THE FRAME'S SIGHT, as its parent's document draws it — called on the owner element (`this`):
 *  - its VISIBLE part — of its owner's content box (as drawn: a transform's scale in it), what every containing block up
 *    its chain whose overflow clips (or that contains its paint) leaves in view, and the view (the visual viewport's part
 *    of it); a positioned holder skips the static blocks between it and an absolute frame, a fixed frame is held by the
 *    view but for a transformed (or filtered, or contained) block, the root's clip — and the body's when it is the view's
 *    — is the view's;
 *  - what COVERS it (M7 H3) — what the ENGINE's own hit test (`elementFromPoint`) finds over its visible part that is
 *    neither the frame nor an ancestor of it (its rounded corner): an overlay with `pointer-events: none` is passed
 *    through as the engine passes it; the frame itself `pointer-events: none` (or not visible) is covered whole by what
 *    is under it. The hits: each cover known before (kept while its own centre is still its own); a QUICK look of 5 × 5
 *    points; the WHOLE look — every 24 CSS px (WCAG 2.2's least target size: a cover a person can aim at holds a point),
 *    widened past 600 points for a big frame — when the quick look finds a cover not known, or a second has passed since
 *    the last whole look. Each cover's exact client rect cut to the visible part (a bounding rect for another shape).
 * As fractions of the content box ([u0, v0, u1, v1]; none: [0, 0, 0, 0]): `{ visible, covers }`. With `quick`, the WORDS'
 * look instead (`moved`): the visible part and the quick look's 25 hits, a string — a clip or a cover that changes with
 * the frame not moving says `moved`. Read beside the quad (`Runtime.callFunctionOn`): a word cannot name the frame's
 * session — the read binds the sight to its owner. PT-5d (M8): read in the words' ISOLATED WORLD — the owner resolved in
 * the isolated context of the document that holds it — on that world's own DOM bindings, never the page's main world:
 * there a page can replace `elementFromPoint` or `getBoundingClientRect` to hide its own overlay, and the person's press
 * on what they see would be routed into the embed under it (clickjacking a third party's frame); the layout itself is
 * real — what is drawn is what is hit. With `quick`, and the frame's own `pointer-events` and `visibility` (M12 J10: its
 * own, or a container's it inherits — a stylesheet's rule toggling them is no mutation of it). Limits: a cover smaller
 * than the whole look's spacing, between its points, is missed (M8.3); one appearing or going between the QUICK look's
 * points with nothing else moving is found by the words' deep look (M12 J10) — within a second and a half; a cover an
 * ancestor's pseudo-element draws is none (its element is the frame's ancestor); a perspective transform's quad is taken
 * by three corners (H15); a ROTATED frame's visible part and covers are measured in its AXIS-ALIGNED box (its
 * `getBoundingClientRect`), while the hand's point is carried along the frame's own axes — over a rotated frame a clip or
 * a cover is placed by its box, not by the frame (M12 J15).
 */
export const FRAME_SIGHT = `function (quick) { const el = this; const none = [0, 0, 0, 0]; const css = (e) => getComputedStyle(e); const px = (v) => parseFloat(v) || 0; const num = (v, or) => (typeof v === "number" && Number.isFinite(v) ? v : or); const r = el.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return quick ? "none" : { visible: none, covers: [] }; const s = css(el); const kx = el.offsetWidth > 0 ? r.width / el.offsetWidth : 1; const ky = el.offsetHeight > 0 ? r.height / el.offsetHeight : 1; const left = r.left + (px(s.borderLeftWidth) + px(s.paddingLeft)) * kx; const top = r.top + (px(s.borderTopWidth) + px(s.paddingTop)) * ky; const right = r.right - (px(s.borderRightWidth) + px(s.paddingRight)) * kx; const bottom = r.bottom - (px(s.borderBottomWidth) + px(s.paddingBottom)) * ky; if (!(right > left && bottom > top)) return quick ? "none" : { visible: none, covers: [] }; let x0 = left, y0 = top, x1 = right, y1 = bottom; const paints = (t) => /paint|strict|content/.test(t.contain || ""); const holdsFixed = (t) => t.transform !== "none" || t.perspective !== "none" || t.filter !== "none" || paints(t) || /layout/.test(t.contain || ""); const holder = (e) => { const position = css(e).position; for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) { const t = css(a); if (position === "fixed") { if (holdsFixed(t)) return a; } else if (position === "absolute") { if (t.position !== "static" || holdsFixed(t)) return a; } else return a; } return null; }; const root = css(document.documentElement); const bodyIsView = root.overflowX === "visible" && root.overflowY === "visible"; for (let a = holder(el); a; a = holder(a)) { if (a === document.body && bodyIsView) continue; const t = css(a); const cx = t.overflowX !== "visible" || paints(t); const cy = t.overflowY !== "visible" || paints(t); if (!cx && !cy) continue; const b = a.getBoundingClientRect(); const ax = a.offsetWidth > 0 ? b.width / a.offsetWidth : 1; const ay = a.offsetHeight > 0 ? b.height / a.offsetHeight : 1; const cl = b.left + a.clientLeft * ax; const ct = b.top + a.clientTop * ay; if (cx) { x0 = Math.max(x0, cl); x1 = Math.min(x1, cl + a.clientWidth * ax); } if (cy) { y0 = Math.max(y0, ct); y1 = Math.min(y1, ct + a.clientHeight * ay); } } const v = globalThis.visualViewport; const vx = num(v && v.offsetLeft, 0); const vy = num(v && v.offsetTop, 0); x0 = Math.max(x0, vx); y0 = Math.max(y0, vy); x1 = Math.min(x1, vx + num(v && v.width, innerWidth)); y1 = Math.min(y1, vy + num(v && v.height, innerHeight)); if (!(x1 > x0 && y1 > y0)) return quick ? "none" : { visible: none, covers: [] }; const w = right - left; const h = bottom - top; const q = (n) => Math.round(n * 1e4) / 1e4; const frac = (a, b, c, d) => [q((a - left) / w), q((b - top) / h), q((c - left) / w), q((d - top) / h)]; const visible = frac(x0, y0, x1, y1); const hit = (x, y) => { try { return document.elementFromPoint(x, y); } catch { return null; } }; const inside = (c, t) => { try { return c === t || c.contains(t); } catch { return false; } }; const over = (t) => t !== null && t !== el && !inside(t, el); const at = (i, j) => [x0 + ((i + 0.5) * (x1 - x0)) / 5, y0 + ((j + 0.5) * (y1 - y0)) / 5]; if (quick) { let bits = ""; for (let j = 0; j < 5; j += 1) for (let i = 0; i < 5; i += 1) { const [x, y] = at(i, j); bits += over(hit(x, y)) ? "1" : "0"; } return visible.join(",") + "|" + bits + "|" + s.pointerEvents + "," + s.visibility; } if (s.pointerEvents === "none" || s.visibility !== "visible") return { visible, covers: [visible] }; const key = Symbol.for("vibefield.sight"); const memo = globalThis[key] instanceof WeakMap ? globalThis[key] : (globalThis[key] = new WeakMap()); const was = memo.get(el) || { covers: [], at: -Infinity }; const covers = []; const known = (t) => covers.some((c) => inside(c, t)); const cut = (c) => { const b = c.getBoundingClientRect(); const a = [Math.max(x0, b.left), Math.max(y0, b.top), Math.min(x1, b.right), Math.min(y1, b.bottom)]; return a[2] > a[0] && a[3] > a[1] ? a : null; }; for (const c of was.covers) { if (!c.isConnected) continue; const a = cut(c); if (a === null) continue; const t = hit((a[0] + a[2]) / 2, (a[1] + a[3]) / 2); if (t !== null && inside(c, t)) covers.push(c); } let fresh = false; for (let j = 0; j < 5; j += 1) for (let i = 0; i < 5; i += 1) { const [x, y] = at(i, j); const t = hit(x, y); if (over(t) && !known(t)) { covers.push(t); fresh = true; } } const now = performance.now(); let looked = was.at; if (fresh || now - was.at >= 1000) { const step = Math.max(24, Math.sqrt(((x1 - x0) * (y1 - y0)) / 600)); for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) { const t = hit(x, y); if (over(t) && !known(t)) covers.push(t); } looked = now; } memo.set(el, { covers, at: looked }); const out = []; for (const c of covers) { const a = cut(c); if (a !== null) out.push(frac(a[0], a[1], a[2], a[3])); } return { visible, covers: out }; }`;

/**
 * PT-5d (rulings 1, M3) — said to every document of every session (the page's and its frames'): it takes the binding for
 * itself and deletes it from the page's reach, then SAYS
 *  - WHERE THE FOCUS IS (M7 H2) — `here` (in its own process: its active element, through every child it can see into, is
 *    no frame), `inner` (in a frame it cannot see into), `away` (not in it) — after every trusted press, key, tap, click
 *    and focus change in it (one word a task, once its default actions are done: a Tab's focus move, a press's): where
 *    the keys, text, a composition and a command go, and the only word of it — the ENGINE's events alone (M7 H1:
 *    `isTrusted`; a page's `dispatchEvent` says nothing);
 *  - `moved` — its frames' boxes, or their sight (`FRAME_SIGHT`'s quick look: the visible part, M6.3a, and what covers
 *    them, M7 H3), changed (a scroll of any of its scrollers, a resize, its visual viewport, a transition's or an
 *    animation's end, a load, a mutation — its nodes, a class, a style, `hidden`, `open` — and, for what no event says, a
 *    look every half second while it holds a frame), once an animation frame at most, and only when they did: main then
 *    reads their quads and sight again, off the hand's path. PT-5d (M12 J10): the half-second look is DEEP too — each
 *    frame's WHOLE sight (the read's own function, in the read's own isolated world: the covers it finds are the read's
 *    memo), its whole grid at most a second old, compared with the last: what no event says — a cover appearing or going
 *    between the quick look's points, a frame's `pointer-events` — is seen within a second and a half (before: never,
 *    until something else moved). Its cost: each frame's known covers and 25 points each half second, its whole grid
 *    (≤ ~600 points) at most once a second — and no read from main unless something changed.
 * Never the page's bootstrap blank — a frame's blank document (an editor's, an ad's slot) speaks (M7 H2: a press in it
 * must say where the focus went). Never its size (M6.1): every document of a frame's process says its words on the frame's
 * session — its own children of its site too — so a frame's viewport is READ of its local root, beside its quad.
 */
export const FRAME_WORDS_SCRIPT = `(() => { const say = globalThis[${JSON.stringify(FRAME_WORDS_BINDING)}]; try { delete globalThis[${JSON.stringify(FRAME_WORDS_BINDING)}]; } catch {} if (typeof say !== "function" || (window === window.top && location.href === "about:blank")) return; const tell = (word) => { try { say(word); } catch {} }; const where = () => { try { if (!document.hasFocus()) return "away"; let d = document; for (let i = 0; i < 32; i += 1) { const a = d.activeElement; const n = a ? a.localName : ""; if (n !== "iframe" && n !== "frame" && n !== "object" && n !== "embed" && n !== "fencedframe") return "here"; let inner = null; try { inner = a.contentDocument; } catch {} if (!inner) return "inner"; d = inner; } return "inner"; } catch { return "away"; } }; let asked = false; const ask = (e) => { if (!e.isTrusted || asked) return; asked = true; setTimeout(() => { asked = false; tell(where()); }, 0); }; for (const t of ["pointerdown", "mousedown", "keydown", "touchend", "click", "focus", "blur", "focusin", "focusout"]) addEventListener(t, ask, true); let drawn = "", sights = "", deep = false; const part = ${FRAME_SIGHT}; const seen = (f) => { try { return String(part.call(f, true)); } catch { return ""; } }; const boxes = () => { let out = ""; for (const f of document.querySelectorAll("iframe, frame")) { const r = f.getBoundingClientRect(); out += r.left + "," + r.top + "," + r.width + "," + r.height + ":" + seen(f) + ";"; } return out; }; const whole = () => { let out = ""; for (const f of document.querySelectorAll("iframe, frame")) { let v = ""; try { v = JSON.stringify(part.call(f, false)); } catch {} out += v + ";"; } return out; }; let due = false; const look = () => { due = false; const now = boxes(); let changed = now !== drawn; drawn = now; if (deep) { deep = false; const all = whole(); if (all !== sights) { sights = all; changed = true; } } if (changed) tell("moved"); }; const moved = () => { if (due) return; due = true; requestAnimationFrame(look); }; addEventListener("scroll", moved, { capture: true, passive: true }); addEventListener("resize", moved); addEventListener("load", moved); for (const t of ["DOMContentLoaded", "transitionend", "animationend"]) addEventListener(t, moved, true); globalThis.visualViewport?.addEventListener("resize", moved); globalThis.visualViewport?.addEventListener("scroll", moved); try { new MutationObserver(() => { if (document.querySelector("iframe, frame")) moved(); }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"] }); } catch {} setInterval(() => { if (document.querySelector("iframe, frame")) { deep = true; moved(); } }, 500); moved(); })();`;

/** PT-5d (M6.1): a frame's own viewport, in its own CSS px — evaluated in its session's local root. */
const FRAME_SIZE = 'innerWidth + "," + innerHeight';

/** PT-4, PT-5d (M6.5b): what a target is told of its device — the same three commands for the page and each of its frames. */
function emulationCommands(
  emulation: BrowserSurfaceNativeEmulation,
): readonly (readonly [string, Record<string, unknown>])[] {
  return [
    [
      "Emulation.setUserAgentOverride",
      {
        userAgent: emulation.userAgent,
        platform: emulation.navigatorPlatform,
        userAgentMetadata: emulation.metadata,
      },
    ],
    [
      "Emulation.setTouchEmulationEnabled",
      emulation.touchPoints > 0
        ? { enabled: true, maxTouchPoints: emulation.touchPoints }
        : { enabled: false },
    ],
    [
      "Emulation.setEmulatedMedia",
      {
        features:
          emulation.colorScheme === undefined
            ? []
            : [{ name: "prefers-color-scheme", value: emulation.colorScheme }],
      },
    ],
  ];
}

/** PT-5d (M8): a frame whose sight cannot be read in the words' world — it takes nothing (the host's, as before PT-5d). */
const UNSEEN = { visible: [0, 0, 0, 0], covers: [] } as const satisfies FrameSight;

/** PT-5d: the button a pointer's event is of — a move's none, the left: the frames' hand keeps a press by its button. */
function buttonOf(input: BrowserSurfaceNativeMouseInput): string {
  return input.button === undefined || input.button === "none" ? "left" : input.button;
}

/** PT-5d: a content quad as `DOM.getBoxModel` answers it — eight finite numbers — or none (not laid out). */
function quadOf(content: unknown): FrameQuad | undefined {
  return Array.isArray(content) && content.length === 8 && content.every(Number.isFinite)
    ? (content as unknown as FrameQuad)
    : undefined;
}

/** PT-5d (M7 H3): a sight as the read answers it — `{ visible, covers }`, each part four fractions — or none. */
function sightOf(value: unknown): FrameSight | undefined {
  const part = (v: unknown): v is FrameVisible =>
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n));
  if (typeof value !== "object" || value === null) return undefined;
  const { visible, covers } = value as { readonly visible?: unknown; readonly covers?: unknown };
  if (!part(visible) || !Array.isArray(covers) || !covers.every(part)) return undefined;
  return { visible, covers };
}

/** PT-5c (R3): the least time between two discards of the page's console entries. */
const CONSOLE_DISCARD_MS = 1_000;
/** PT-5d (M7 H2): how long a key, text, a composition or a command waits for a word of where the focus is, while it is in
 * doubt, before it is refused — PT-5c's second for a document's scale word, the precedent. */
const FOCUS_WORD_MS = 1_000;
/** PT-5d (M6.5b i): how long one step of a frame's start — a guard, its device, its auto-attach — may go unanswered before
 * it is abandoned: sent, never confirmed (M12 J4: every step is sent at once — one abandoned keeps none of the others
 * unsent); the frame is resumed once every step is answered or abandoned — never left paused. */
const FRAME_STEP_MS = 2_000;
/**
 * PT-5d (M6.5b i) — THE PAGE'S AUTO-ATTACH AND EACH FRAME'S: flat; each frame of another site STARTS PAUSED (waiting for the
 * debugger) until its guards and its device are on; FILTERED to frames — no worker or service worker is ever attached,
 * paused or sent anything (ruling 4).
 */
const AUTO_ATTACH = {
  autoAttach: true,
  waitForDebuggerOnStart: true,
  flatten: true,
  filter: [{ type: "iframe" }],
} as const;

/** The file picker never shown: CDP says it was asked for (`Page.fileChooserOpened`) and cancels it — the input hears `cancel`. */
const NO_FILE_PICKER = { enabled: true, cancel: true } as const;

function integerDimension(value: number): number {
  return Math.max(1, Math.min(16_384, Math.round(value)));
}

function baseRaster(options: BrowserSurfaceNativeWindowOptions): {
  width: number;
  height: number;
} {
  return {
    width: integerDimension(options.logicalViewport.width * options.deviceScaleFactor),
    height: integerDimension(options.logicalViewport.height * options.deviceScaleFactor),
  };
}

function safeEffectiveRaster(
  requested: { width: number; height: number },
  base: { width: number; height: number },
): { width: number; height: number; pageScaleFactor: number } {
  const baseAspect = base.width / base.height;
  const requestedAspect = requested.width / requested.height;
  const aspectDrift = Math.abs(requestedAspect / baseAspect - 1);
  const scale = Math.min(requested.width / base.width, requested.height / base.height);
  // Chromium clamps page scale below 1. Preserve layout/raster correctness and
  // let the WebGPU compositor downsample instead of relaying out the page.
  if (scale < 1 || aspectDrift > 0.01) {
    return { ...base, pageScaleFactor: 1 };
  }
  return {
    width: requested.width,
    height: requested.height,
    pageScaleFactor: scale,
  };
}

/** PT-5d (M9): the window of a native told it is focused — one at a time, as a browser has one focused window. */
interface FocusHolder {
  window: ElectronBrowserSurfaceWindow | undefined;
  /** PT-5d (M11.2): what its telling holds for, beside the window (`focusFor`) */
  told: number | undefined;
}

class ElectronBrowserSurfaceWindow implements BrowserSurfaceNativeWindow {
  readonly controlContents;
  #remoteLoadStarted = false;
  #debuggerAttached = false;
  /** PT-5a: the bootstrap document has been taken out of the page's history (below) — once a window's life. */
  #bootstrapPruned = false;
  /** PT-5a: the main frame's last load failed with this net error (cleared when a page commits). */
  #loadFailure: number | undefined;
  /** PT-5a: who hears what the page asked for and may not have. */
  readonly #refusedListeners = new Set<(what: BrowserSurfaceRefusal, url?: string) => void>();
  /**
   * PT-5b: a document of the PAGE's stands in the window — its first load committed (or failed: the engine's error page
   * stands in the asked address's place). Until then the window shows its bootstrap `about:blank`, for as long as the
   * page's server takes to answer: a blank that is nothing of the page (its paints are marked — `bootstrap`).
   */
  #pageDocument = false;
  /** PT-5c (ruling 1): who hears the page's word of its scale. */
  readonly #scaleListeners = new Set<(scale: number, document: number) => void>();
  /** PT-5d (M6.4b): who hears that a command of the hand went unanswered past the bound. */
  readonly #hungListeners = new Set<(frame?: string) => void>();
  /** PT-5d (M7 H2): key-like events waiting for a word of where the focus is */
  readonly #focusWaiters = new Set<() => void>();
  /** PT-5d (M6.5b): the device the page was last told — its frames are told the same */
  #emulation: BrowserSurfaceNativeEmulation | undefined;
  /** PT-5d (M6.5b): each frame's tells of the device, one behind another */
  readonly #frameTells = new Map<string, Promise<void>>();
  /** PT-5d (M6.5b i): the frames attached under this page's debugger, and not gone */
  readonly #children = new Set<string>();
  /** PT-5d (M8): by session (`""`: the page's), each document's context of the words' isolated world, by its frame */
  readonly #worlds = new Map<string, Map<string, number>>();
  /** PT-5d (M8): each frame's parent frame — the document that holds its owner element */
  readonly #parentFrames = new Map<string, string>();
  /** PT-5d (M7 H9): the page's document now has painted (true before its first: nothing waits) */
  #painted = true;
  /** PT-5d (M12 J14): the frames whose OWN document committed since the window last painted — a touch to one is timed from
   * the next paint, as the page's (H9) */
  readonly #unpainted = new Set<string>();
  /** PT-5d (M7 H9): touch commands whose bound starts at the page's next paint */
  readonly #atPaint = new Set<() => void>();
  /** PT-5d (M7 H11, M12 J12): the hand's commands in flight, by the session each went to (`undefined`: the page's) — all
   * let go at the page's commit, a frame's at its session's detach */
  readonly #inFlight = new Map<(why: string) => void, string | undefined>();
  /**
   * PT-5c (ruling 1) — TWO QUEUES, never one: the DEVICE's (its layout, what it is told — `Emulation.*`, the window's size)
   * and the HAND's (`Input.*`). A device command the renderer does not answer — every one, while a navigation pends — no
   * longer holds the hand's behind it: the probe's press, release and key behind an unanswered metrics override were
   * answered in 1–2 ms and heard by the page that stood. Each keeps its own order; between them none is kept — an event
   * is aimed at the frame the person saw, and a device's layout arrives at a later frame.
   */
  #deviceTail: Promise<void> = Promise.resolve();
  #handTail: Promise<void> = Promise.resolve();
  /** The page's session, attached with its guards — once, shared by both queues. */
  #ready: Promise<void> | undefined;
  /** PT-5c (R3): the discard of the page's console entries that is due, and when the last was sent. PT-5d: and of each
   * frame's session — every one runs its Runtime now (its words) — by session (`""`: the page's). */
  readonly #discards = new Map<
    string,
    { timer: ReturnType<typeof setTimeout> | null; at: number }
  >();
  /** PT-5d (rulings 1, 3, 4): the frames of other sites the page's tree holds — where each event of the hand goes. */
  readonly #frames = new BrowserFrames();
  /** PT-5d: each frame's owner element in its parent's document (`DOM.getFrameOwner`), asked once. */
  readonly #owners = new Map<string, number>();
  /** PT-5d (M12 J5): each same-process frame's owner element, by its frame — asked once (see `ancestorsOf`). */
  readonly #slotOwners = new Map<string, number>();
  /** PT-5d: the quad reads in flight, by frame — another asked meanwhile is read once it answers. */
  readonly #placing = new Map<string, { again: boolean }>();
  /**
   * PT-5b3 (ruling 4) — THE PAGE'S DOCUMENTS, COUNTED as the engine commits them: one more at each `did-navigate` of the
   * page's own (never the blank's) and at each main-frame load that FAILED (the engine's error page then stands in the
   * asked address's place, with no `did-navigate` — PT-5a's probe); never at a move WITHIN a document
   * (`did-navigate-in-page`: a hash, `pushState`, `replaceState`), a load that only began, or one that was aborted. Said
   * with every navigation state: whoever asks "is this another document?" asks this, not the address.
   * PT-5c2 (F1) — AN ERROR PAGE IS COUNTED BY ITS OWN WORD: `did-fail-provisional-load` on the main frame (code ≠ −3),
   * which Electron says only where the engine's error page COMMITTED. A `did-fail-load` with no such word before it is a
   * committed document's load failing LATE — its body cut mid-stream (−101, −355, −337): the SAME document, standing,
   * showing what came (PT-5c2's probe `f1.cjs`: a refused connection says `did-fail-provisional-load −102` then
   * `did-fail-load −102`, the same millisecond; a cut body says `did-navigate`, then `did-fail-load −355` alone). (Before:
   * counted at every main-frame `did-fail-load` — a cut body was another document, and what was down in the page that
   * stood was forgotten: a key held across it was never let up.)
   */
  #documents = 0;

  constructor(
    readonly window: BrowserWindow,
    readonly options: BrowserSurfaceNativeWindowOptions,
    readonly bootstrapReady: Promise<void>,
    /** PT-5d (M9): its native's focused window */
    readonly focus: FocusHolder = { window: undefined, told: undefined },
  ) {
    this.controlContents = window.webContents;
    window.webContents.debugger.on("message", (_event, method, params, sessionId) =>
      this.heard(method, params as Readonly<Record<string, unknown>>, sessionId),
    );
    // (registered before any navigation listener: the count has moved when a state is said)
    const committed = (): void => {
      this.#pageDocument = true;
      this.#documents += 1;
      // (M7 H9: the new document has not painted yet)
      this.#painted = false;
      // (M7 H11: a command the document before never answered is let go — its turn refused; the chain goes on)
      for (const letGo of [...this.#inFlight.keys()]) letGo("Browser input's document is gone");
      this.#inFlight.clear();
      // PT-5d: the frames of the document before go with it
      this.#frames.pageCommitted(this.#documents);
      this.#owners.clear();
      this.#slotOwners.clear();
      // (M7 H15: the frames of the document before — a detach that never came keeps no discard of theirs)
      for (const session of [...this.#discards.keys()])
        if (session !== "") this.forgetDiscard(session);
      this.#frameTells.clear();
      this.#parentFrames.clear();
      this.focusMoved();
    };
    // PT-5d (M7 H9): the page's document painted — a touch waiting for it is timed from now. PT-5d (M12 J14): and a frame's
    // committed since — the window paints as ONE image (the offscreen view composites every frame): a paint after a
    // frame's commit is taken as the frame's (one whose own first paint is held while the host paints is timed from the
    // host's paint — a stated limit)
    window.webContents.on("paint", () => {
      if (this.#painted && this.#unpainted.size === 0) return;
      this.#painted = true;
      this.#unpainted.clear();
      for (const arm of [...this.#atPaint]) arm();
      this.#atPaint.clear();
    });
    window.webContents.on("did-navigate", (_event, url) => {
      if (this.#remoteLoadStarted && url !== "about:blank") committed();
    });
    window.webContents.on(
      "did-fail-provisional-load",
      (_event, code, _description, _url, isMainFrame) => {
        if (this.#remoteLoadStarted && isMainFrame && code !== -3) committed();
      },
    );
  }

  /** PT-5a: the page asked for what it may not have — told to the producer (the guards have already answered the page). */
  refused(what: BrowserSurfaceRefusal, url?: string): void {
    for (const listener of [...this.#refusedListeners]) listener(what, url);
  }

  onRefused(listener: (what: BrowserSurfaceRefusal, url?: string) => void): () => void {
    this.#refusedListeners.add(listener);
    return () => this.#refusedListeners.delete(listener);
  }

  /**
   * PT-5a — what CDP says of the page's asks. A dialog is WebContents-wide and said on every session with its Page domain on,
   * so it is counted on the page's own session alone (`alert`, `confirm`; `beforeunload` is `will-prevent-unload`'s to say);
   * a file picker is its frame's. A frame in ANOTHER process is a target of its own (`Target.attachedToTarget`): the same
   * guards are put on its session as it attaches — the page's own session does not reach it (the probe).
   */
  private heard(
    method: string,
    params: Readonly<Record<string, unknown>>,
    sessionId: string | undefined,
  ): void {
    // PT-5c (ruling 1): the page's word of its scale — on its OWN session, by its own binding; tagged with the document the
    // window counts as it arrives (every word came after its document's `did-navigate`: the probe)
    if (method === "Runtime.bindingCalled") {
      // PT-5d: a document's word of its frames and its focus — the page's or a frame's, on its own session
      if (params["name"] === FRAME_WORDS_BINDING) {
        this.frameWord(sessionId === "" ? undefined : sessionId, String(params["payload"]));
        return;
      }
      if ((sessionId !== undefined && sessionId !== "") || params["name"] !== PAGE_SCALE_BINDING)
        return;
      const scale = Number(params["payload"]);
      if (!Number.isFinite(scale) || scale <= 0) return;
      for (const listener of [...this.#scaleListeners]) listener(scale, this.#documents);
      return;
    }
    // PT-5c (R3) — THE RUNTIME'S COST IS MEMORY: with it on, every object the page logs (or throws) is held by the session
    // until its entries are DISCARDED — V8's store of 1,000 messages frees none of them (PT-5c's probe `console.cjs`: 24 MB
    // after five minutes of an object logged ten times a second, against 1 MB discarded as they came). Discarded as they
    // come: at once, then at most once a second; sent straight on the page's session — never on the hand's queue nor the
    // device's (its answer is awaited by nobody, and while a navigation pends the engine answers no renderer command).
    if (method === "Runtime.consoleAPICalled" || method === "Runtime.exceptionThrown") {
      // (PT-5d: a frame's session runs its Runtime too — its console is discarded on it, the same way)
      this.discardConsole(sessionId ?? "");
      return;
    }
    // PT-5d (ruling 3): a frame's session went — the frame removed, its process gone, it moved to another process: no event
    // of the hand goes to it again, and nothing waits on it
    if (method === "Target.detachedFromTarget") {
      const gone = params["sessionId"];
      if (typeof gone === "string") {
        this.#children.delete(gone);
        this.#frames.detached(gone);
        // (M12 J12: a command in flight on a session the detach took — its, and the frames' in it — is let go, as at a
        // commit: the engine may never answer a session torn down mid-command, and the chain stalled to the bound said the
        // WHOLE page stopped, naming no frame, for a frame that merely went)
        const standing = new Set(this.#frames.frames().map((f) => f.session));
        for (const [letGo, session] of [...this.#inFlight])
          if (session !== undefined && !standing.has(session))
            letGo("Browser input's frame is gone");
        this.#owners.delete(gone);
        this.#placing.delete(gone);
        // (M7 H15: its console's discard, if one is due, sent nowhere)
        this.forgetDiscard(gone);
        this.#frameTells.delete(gone);
        this.#worlds.delete(gone);
        this.focusMoved();
      }
      return;
    }
    // PT-5d (ruling 3): A FRAME'S DOCUMENTS, COUNTED BY ITS OWN WORD — CDP's `Page.frameNavigated` of the frame its own
    // session is for (its target's id): a commit there, an error page's too; a late failure, an abort, a move within its
    // document say none. The page's count never moves for a frame's (the page's is counted at its own `did-navigate`).
    if (method === "Page.frameNavigated") {
      const frame = params["frame"] as
        | { readonly id?: unknown; readonly url?: unknown }
        | undefined;
      if (sessionId === undefined || sessionId === "" || frame === undefined) return;
      if (this.#frames.frames().find((f) => f.session === sessionId)?.targetId === frame.id) {
        this.#frames.committed(sessionId, typeof frame.url === "string" ? frame.url : undefined);
        // (M12 J14: its new document has not painted yet)
        this.#unpainted.add(sessionId);
      }
      return;
    }
    // PT-5d (M8): THE WORDS' ISOLATED WORLD, by document — where a frame's sight and size are read: never the page's main
    // world, where its scripts can replace the DOM's methods (a page hiding its own overlay from the read would send the
    // person's press into the embed under it). Each document's context of the words' world, kept by its frame; and each
    // frame's parent frame (the document that holds its owner element).
    if (method === "Runtime.executionContextCreated") {
      const context = params["context"] as
        | {
            readonly id?: unknown;
            readonly name?: unknown;
            readonly auxData?: { readonly frameId?: unknown };
          }
        | undefined;
      const frameId = context?.auxData?.frameId;
      if (
        context?.name !== WORDS_WORLD ||
        typeof context.id !== "number" ||
        typeof frameId !== "string"
      )
        return;
      const key = sessionId ?? "";
      let worlds = this.#worlds.get(key);
      if (worlds === undefined) {
        worlds = new Map();
        this.#worlds.set(key, worlds);
      }
      worlds.set(frameId, context.id);
      // (a frame's own document's world, at last: its size can be read in it)
      if (key !== "" && this.#frames.frames().find((f) => f.session === key)?.targetId === frameId)
        this.placeFrame(key);
      return;
    }
    if (method === "Runtime.executionContextDestroyed") {
      const worlds = this.#worlds.get(sessionId ?? "");
      for (const [frameId, id] of [...(worlds ?? [])])
        if (id === params["executionContextId"]) worlds?.delete(frameId);
      return;
    }
    if (method === "Runtime.executionContextsCleared") {
      this.#worlds.delete(sessionId ?? "");
      return;
    }
    if (method === "Page.frameAttached") {
      const frameId = params["frameId"];
      const parentFrameId = params["parentFrameId"];
      if (typeof frameId === "string" && typeof parentFrameId === "string")
        this.#parentFrames.set(frameId, parentFrameId);
      return;
    }
    if (method === "Page.fileChooserOpened") {
      this.refused("file-picker");
      return;
    }
    if (method === "Page.javascriptDialogOpening") {
      const type = params["type"];
      if ((sessionId === undefined || sessionId === "") && (type === "alert" || type === "confirm"))
        this.refused(type);
      return;
    }
    if (method !== "Target.attachedToTarget") return;
    const info = params["targetInfo"] as
      | { readonly type?: unknown; readonly targetId?: unknown; readonly url?: unknown }
      | undefined;
    const child = params["sessionId"];
    // PT-5d (ruling 4): a FRAME of the page's tree alone — never a worker, a service worker, another page
    if (info?.type !== "iframe" || typeof child !== "string" || this.isDestroyed()) return;
    const parent = sessionId === undefined || sessionId === "" ? undefined : sessionId;
    if (typeof info.targetId === "string")
      this.#frames.attached(
        child,
        info.targetId,
        parent,
        typeof info.url === "string" ? info.url : undefined,
      );
    const cdp = this.window.webContents.debugger;
    this.#children.add(child);
    /** one step: sent if the frame is still attached, and waited for until it is answered, refused, or unanswered past
     * `FRAME_STEP_MS` (abandoned: unconfirmed, not unsent). Each its own (M2): every step is sent before any is waited for
     * (M12 J4), so none — refused or late — keeps another unsent, the nested frames' auto-attach least of all. */
    const step = async (work: () => Promise<unknown>): Promise<void> => {
      if (!this.#children.has(child) || this.isDestroyed()) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        work().catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, FRAME_STEP_MS);
        }),
      ]);
      clearTimeout(timer);
    };
    const send = (method: string, params: Record<string, unknown> = {}) =>
      step(() => cdp.sendCommand(method, params, child));
    // PT-5d (M6.5b i) — A FRAME STARTS PAUSED (its auto-attach waits for the debugger): its guards, its device and its own
    // auto-attach are on before its first document runs a line — its agent goes out with its first request, its scripts
    // read the page's device — THEN it is resumed; in a `finally`, and every step before it bounded: a frame is never
    // left paused (a dead embed). A frame whose session went meanwhile is sent nothing more.
    void (async () => {
      try {
        // PT-5d (M12 J4): every step sent at once, each with its own bound — one the engine never answers keeps none of the
        // others from going (before: the steps after it were abandoned, the frame resumed unguarded); the resume after
        // them all. The residual: a guard the engine never answers is unconfirmed, not unsent.
        await Promise.all([
          send("Page.enable"),
          send("Page.setInterceptFileChooserDialog", NO_FILE_PICKER),
          // PT-5d: its words (its focus, its frames) through its own binding — heard with its Runtime on; the binding and
          // the words in the words' own world (M7 H1), the guard in its own
          send("Runtime.enable"),
          send("Runtime.addBinding", {
            name: FRAME_WORDS_BINDING,
            executionContextName: WORDS_WORLD,
          }),
          // (PT-5d: and at once in the document it holds as it attaches, whatever it is)
          send("Page.addScriptToEvaluateOnNewDocument", {
            source: PAGE_GUARD_SCRIPT,
            runImmediately: true,
          }),
          send("Page.addScriptToEvaluateOnNewDocument", {
            source: FRAME_WORDS_SCRIPT,
            worldName: WORDS_WORLD,
            runImmediately: true,
          }),
          // PT-5d (M6.5b): the page's device — its agent and hints, touch, the colour scheme (per target: never inherited)
          step(() => this.tellFrame(child)),
          // PT-5d (M2) — A FRAME IN A FRAME is guarded too: auto-attach is per session, so this child's own, as the page's
          send("Target.setAutoAttach", AUTO_ATTACH),
        ]);
      } finally {
        if (this.#children.has(child) && !this.isDestroyed())
          void cdp.sendCommand("Runtime.runIfWaitingForDebugger", {}, child).catch(() => undefined);
      }
    })();
    // where it is drawn — off the hand's path
    this.placeFrame(child);
  }

  /**
   * PT-5d (rulings 1, M3) — a document's word, on its own session (`undefined`: the page's): where the focus is (M7 H2) —
   * where the keys go; its frames moved — their quads read again. (No other word moves anything: a frame's size is READ —
   * M6.1.)
   */
  private frameWord(session: string | undefined, word: string): void {
    if (word === "here" || word === "inner" || word === "away") {
      this.#frames.where(session, word);
      this.focusMoved();
      return;
    }
    if (word === "moved")
      for (const frame of this.#frames.frames())
        if (frame.parent === session) this.placeFrame(frame.session);
  }

  /**
   * PT-5d (ruling 1) — WHERE A FRAME IS DRAWN, read OFF the hand's path and kept: its owner element in its parent's
   * document (`DOM.getFrameOwner`, once) and that element's content quad (`DOM.getBoxModel`: its scroll and its transform
   * in it) on the parent's session. One read in flight a frame; another asked meanwhile is read once it answers. A
   * frame not laid out (`display: none`) has no quad: nothing lands in it. (While a navigation pends the renderer answers
   * none of it: the quad kept is the last read.) PT-5d (M6.1): and with the quad, the frame's OWN viewport — read of its
   * session's local root (`Runtime.evaluate` in its own frame), never said by a document of it: every document of its
   * process speaks on its session, its own children of its site too. Not awaited by the placement (a frame busy with its
   * own load, or hung, holds no placement up): until it answers the frame is taken at its quad's own size, and an answer
   * for a quad no longer current is dropped. PT-5d (M6.3a, M7 H3): and its SIGHT (`FRAME_SIGHT`, called on its owner in
   * its parent's document — the object released after) — its visible part and what covers it — placed with the quad: a
   * point on a part an ancestor clips, or the host draws over, is the parent's. Unread (refused), the whole box. PT-5d
   * (M12 J5): and the sight of every SAME-PROCESS frame its owner's document is in, up to its session's root
   * (`ancestorsOf`) — what the page draws over an about:blank slot holding the frame, or clips of it, is the page's.
   */
  private placeFrame(session: string): void {
    const inFlight = this.#placing.get(session);
    if (inFlight !== undefined) {
      inFlight.again = true;
      return;
    }
    const frame = this.#frames.frames().find((f) => f.session === session);
    if (frame === undefined || this.isDestroyed()) return;
    const mark = { again: false };
    this.#placing.set(session, mark);
    const cdp = this.window.webContents.debugger;
    void (async () => {
      let owner = this.#owners.get(session);
      if (owner === undefined) {
        const found = (await cdp.sendCommand(
          "DOM.getFrameOwner",
          { frameId: frame.targetId },
          frame.parent,
        )) as { readonly backendNodeId?: unknown };
        if (typeof found.backendNodeId !== "number") throw new Error("no owner");
        owner = found.backendNodeId;
        this.#owners.set(session, owner);
      }
      const box = (await cdp.sendCommand(
        "DOM.getBoxModel",
        { backendNodeId: owner },
        frame.parent,
      )) as { readonly model?: { readonly content?: unknown } };
      const quad = quadOf(box.model?.content);
      // (M8: in the isolated world of the document that holds its owner — that world unknown, or the read refused: the
      // frame takes nothing, the host's as before PT-5d — never a sight the page's own scripts could have written)
      const world = this.#worlds
        .get(frame.parent ?? "")
        ?.get(this.#parentFrames.get(frame.targetId) ?? "");
      const sight =
        quad === undefined
          ? undefined
          : ((world === undefined ? undefined : await this.sightOf(frame.parent, owner, world)) ??
            UNSEEN);
      // (M12 J5: and each same-process frame its owner's document is in — one unreadable, the frame takes nothing, by M8's
      // rule)
      const ancestors = quad === undefined || sight === UNSEEN ? [] : await this.ancestorsOf(frame);
      const placement = this.#frames.placed(
        session,
        quad,
        ancestors === undefined ? UNSEEN : sight,
        ancestors ?? [],
      );
      if (quad === undefined) return;
      // (M8: its own size in its own document's isolated world — not known yet: the quad's own until it is)
      const own = this.#worlds.get(session)?.get(frame.targetId);
      if (own === undefined) return;
      void cdp
        .sendCommand(
          "Runtime.evaluate",
          { expression: FRAME_SIZE, contextId: own, returnByValue: true },
          session,
        )
        .then(
          (answer) => {
            const value = (answer as { readonly result?: { readonly value?: unknown } }).result
              ?.value;
            if (typeof value !== "string") return;
            const [w, h] = value.split(",").map(Number);
            if (w !== undefined && h !== undefined) this.#frames.sized(session, w, h, placement);
          },
          () => undefined,
        );
    })()
      .catch(() => this.#frames.placed(session, undefined))
      .finally(() => {
        if (this.#placing.get(session) !== mark) return;
        this.#placing.delete(session);
        if (mark.again) this.placeFrame(session);
      });
  }

  /**
   * PT-5d (M12 J5) — THE SAME-PROCESS FRAMES A FRAME IS IN: from the frame whose document holds its owner, up the frames'
   * parents (`Page.frameAttached`) to its session's ROOT — a frame session's own frame, or a frame with no parent heard
   * (the page's main frame); each between them a frame of that session's process with no session of its own (an
   * about:blank ad slot, a `srcdoc`, a same-origin widget). Each read as the frame's own is: its owner (`DOM.getFrameOwner`,
   * once), its quad and its SIGHT, on the frame's parent session, in the isolated world of the document holding that
   * owner (M8). All read: the list (none: its owner is in the root's document); one unread — its world unknown, a read
   * refused, not laid out: undefined (the frame takes nothing). (Before: the slot's own document alone was read — the
   * page's header over an ad slot sent its press, hover and wheel into the ad inside: H3's defect, and M8's door, one
   * level down.)
   */
  private async ancestorsOf(frame: {
    readonly targetId: string;
    readonly parent: string | undefined;
  }): Promise<readonly FrameAncestor[] | undefined> {
    const cdp = this.window.webContents.debugger;
    const root =
      frame.parent === undefined
        ? undefined
        : this.#frames.frames().find((f) => f.session === frame.parent)?.targetId;
    const ancestors: FrameAncestor[] = [];
    try {
      for (let at = this.#parentFrames.get(frame.targetId); at !== undefined && at !== root; ) {
        const above = this.#parentFrames.get(at);
        if (above === undefined) break;
        let owner = this.#slotOwners.get(at);
        if (owner === undefined) {
          const found = (await cdp.sendCommand(
            "DOM.getFrameOwner",
            { frameId: at },
            frame.parent,
          )) as { readonly backendNodeId?: unknown };
          if (typeof found.backendNodeId !== "number") return undefined;
          owner = found.backendNodeId;
          this.#slotOwners.set(at, owner);
        }
        const box = (await cdp.sendCommand(
          "DOM.getBoxModel",
          { backendNodeId: owner },
          frame.parent,
        )) as { readonly model?: { readonly content?: unknown } };
        const quad = quadOf(box.model?.content);
        const world = this.#worlds.get(frame.parent ?? "")?.get(above);
        if (quad === undefined || world === undefined) return undefined;
        const sight = await this.sightOf(frame.parent, owner, world);
        if (sight === undefined) return undefined;
        ancestors.push({ quad, sight });
        at = above;
      }
    } catch {
      return undefined;
    }
    return ancestors;
  }

  /** PT-5d (M6.3a, M7 H3, M8): the sight of a frame's owner, read in its parent's document's isolated world; unread
   * (refused), none said. */
  private async sightOf(
    parent: string | undefined,
    owner: number,
    world: number,
  ): Promise<FrameSight | undefined> {
    const cdp = this.window.webContents.debugger;
    try {
      // (M8: resolved in the words' isolated world — the sight runs there, on that world's own DOM bindings)
      const node = (await cdp.sendCommand(
        "DOM.resolveNode",
        { backendNodeId: owner, executionContextId: world },
        parent,
      )) as { readonly object?: { readonly objectId?: unknown } };
      const objectId = node.object?.objectId;
      if (typeof objectId !== "string") return undefined;
      try {
        const out = (await cdp.sendCommand(
          "Runtime.callFunctionOn",
          {
            objectId,
            functionDeclaration: FRAME_SIGHT,
            arguments: [{ value: false }],
            returnByValue: true,
          },
          parent,
        )) as { readonly result?: { readonly value?: unknown } };
        return sightOf(out.result?.value);
      } finally {
        void cdp.sendCommand("Runtime.releaseObject", { objectId }, parent).catch(() => undefined);
      }
    } catch {
      return undefined;
    }
  }

  /** PT-5d (M7 H15): a session gone — its discard, if one is due, never sent. */
  private forgetDiscard(session: string): void {
    const due = this.#discards.get(session);
    if (due?.timer !== null && due?.timer !== undefined) clearTimeout(due.timer);
    this.#discards.delete(session);
  }

  /** PT-5c (R3): one discard of a session's console entries (`""`: the page's) — now, or when a second has passed since
   * its last. */
  private discardConsole(session: string): void {
    if (this.isDestroyed()) return;
    let due = this.#discards.get(session);
    if (due === undefined) {
      due = { timer: null, at: Number.NEGATIVE_INFINITY };
      this.#discards.set(session, due);
    }
    if (due.timer !== null) return;
    const entry = due;
    entry.timer = setTimeout(
      () => {
        entry.timer = null;
        entry.at = Date.now();
        const cdp = this.window.webContents.debugger;
        if (this.isDestroyed() || !cdp.isAttached()) return;
        void cdp
          .sendCommand("Runtime.discardConsoleEntries", {}, session === "" ? undefined : session)
          .catch(() => undefined);
      },
      Math.max(0, entry.at + CONSOLE_DISCARD_MS - Date.now()),
    );
  }

  loadURL(url: string): Promise<void> {
    this.#remoteLoadStarted = true;
    return this.window.loadURL(url);
  }

  isDestroyed(): boolean {
    return this.window.isDestroyed() || this.window.webContents.isDestroyed();
  }

  destroy(): void {
    for (const due of this.#discards.values()) if (due.timer !== null) clearTimeout(due.timer);
    this.#discards.clear();
    if (this.isDestroyed()) return;
    if (this.#debuggerAttached && this.window.webContents.debugger.isAttached()) {
      try {
        this.window.webContents.debugger.detach();
      } catch {
        // WebContents teardown owns the target now.
      }
    }
    this.#debuggerAttached = false;
    this.window.destroy();
  }

  setFrameRate(fps: number): void {
    this.window.webContents.setFrameRate(fps);
  }

  startPainting(): void {
    this.window.webContents.startPainting();
  }

  stopPainting(): void {
    this.window.webContents.stopPainting();
  }

  setAudioMuted(muted: boolean): void {
    if (this.isDestroyed()) return;
    this.window.webContents.setAudioMuted(muted);
  }

  invalidate(): void {
    this.window.webContents.invalidate();
  }

  setBackingRaster(
    requested: { width: number; height: number },
    logicalViewport: { width: number; height: number },
    deviceScaleFactor: number,
    mobile = false,
  ): Promise<{ width: number; height: number }> {
    // The base derives from THIS call's viewport (DT-3f), never the
    // construction-time one: the viewport now follows the card, and a raster
    // judged against a stale base would reject every request whose aspect had
    // legitimately moved with the layout.
    const effective = safeEffectiveRaster(requested, {
      width: integerDimension(logicalViewport.width * deviceScaleFactor),
      height: integerDimension(logicalViewport.height * deviceScaleFactor),
    });
    return this.device(async () => {
      if (this.isDestroyed()) throw new Error("Browser surface was destroyed during resize");
      await this.bootstrapReady;
      await this.ensureDebugger();
      await this.window.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
        width: integerDimension(logicalViewport.width),
        height: integerDimension(logicalViewport.height),
        deviceScaleFactor,
        mobile,
        screenWidth: integerDimension(logicalViewport.width),
        screenHeight: integerDimension(logicalViewport.height),
      });
      // PT-5b (ruling 5b): never forced on a `mobile` page — a phone's page lays itself out at its OWN width (one that
      // names no viewport: 980 px) and is shown whole at its own scale; forced to 1 it showed its top-left corner (PT-4)
      if (!mobile) {
        await this.window.webContents.debugger.sendCommand("Emulation.setPageScaleFactor", {
          pageScaleFactor: effective.pageScaleFactor,
        });
      }
      const contentWidth = integerDimension(effective.width / this.options.deviceScaleFactor);
      const contentHeight = integerDimension(effective.height / this.options.deviceScaleFactor);
      this.window.setContentSize(contentWidth, contentHeight, false);
    }).then(() => ({ width: effective.width, height: effective.height }));
  }

  /**
   * PT-4 — what the page is told of its device, over CDP's Emulation: its agent (`navigator.userAgent`, `navigator.platform`,
   * the request header) WITH its client hints — an overridden agent's are empty otherwise; touch on or off with its points;
   * the colour scheme, or the system's when none is named. Never `setEmitTouchEventsForMouse`: under it a dispatched mouse
   * event is swallowed and its command never answers, and this window's commands run one behind another.
   */
  setEmulation(emulation: BrowserSurfaceNativeEmulation): Promise<void> {
    return this.device(async () => {
      if (this.isDestroyed()) throw new Error("Browser surface was destroyed during emulation");
      await this.bootstrapReady;
      await this.ensureDebugger();
      const cdp = this.window.webContents.debugger;
      for (const [method, params] of emulationCommands(emulation))
        await cdp.sendCommand(method, params);
      // PT-5d (M6.5b): the page is told — each frame of another site is told again, in the device queue's order
      this.#emulation = emulation;
      for (const frame of this.#frames.frames()) void this.tellFrame(frame.session);
    });
  }

  /**
   * PT-5d (M6.5b) — WHAT A FRAME OF ANOTHER SITE IS TOLD OF THE DEVICE: the page's, as last answered (emulation is per
   * target: the page's agent, touch and colour scheme never reach a frame's own — a phone's page told its embed was a
   * laptop). At its attach (after its guards) and at each switch the page's own answered; a frame's tells one behind
   * another, each reading the device last answered — the last it is told is the latest. Each command its own: one
   * refused keeps none after it off. No device told yet: none.
   */
  private tellFrame(session: string): Promise<void> {
    const prior = this.#frameTells.get(session) ?? Promise.resolve();
    const next = prior.then(async () => {
      const emulation = this.#emulation;
      if (emulation === undefined || this.isDestroyed()) return;
      const cdp = this.window.webContents.debugger;
      for (const [method, params] of emulationCommands(emulation))
        await cdp.sendCommand(method, params, session).catch(() => undefined);
    });
    this.#frameTells.set(session, next);
    return next;
  }

  /** PT-5c (ruling 1): the page's word of its visual viewport's scale, with the document the window counted as it came. */
  onScale(listener: (scale: number, document: number) => void): () => void {
    this.#scaleListeners.add(listener);
    return () => this.#scaleListeners.delete(listener);
  }

  /**
   * PT-5d (rulings 1, 3, M3) — THE HAND'S EVENTS GO TO THE TARGET THAT TAKES THEM (`BrowserFrames`, decided at the event's
   * turn on the hand's queue, from what is kept — never a read): a pointer's to the frame drawn under it (a frame of
   * another site on its own session, at the point carried into its viewport), its drag and its release to its press's;
   * a finger the same; a key, text, a composition and a command to the FOCUSED document's session — nothing key-like on
   * the page's while a frame of another site is focused (M3: PT-5d's probe crashed main with keys into such a frame,
   * `Electron-2026-10-12-070259.ips`). PT-5d (M15) — and NOTHING key-like to such a frame either: typing into a frame of
   * another site is OFF, a stated limit (James's ruling) — through the product's frame session it crashed main
   * (`Electron-2026-10-12-123521.ips`, the same signature): refused at once (`BrowserFrameKeysRefused`), sent to no
   * session; pointer input to frames unchanged. An event whose target is gone is sent nowhere — never a command to a gone
   * session.
   * A page with no frame of another site: everything on the page's session, as before. PT-5d (M7 H2): which document
   * holds the focus is its own word alone — a press, a key's down and a tap's end are HINTS: each puts the focus in doubt
   * until a word heard with or after its answer settles it; key-like events wait for it (`FOCUS_WORD_MS`), then are
   * refused — never sent on the page's session while a frame may hold the focus.
   */
  dispatchTouch(input: BrowserSurfaceNativeTouchInput): Promise<void> {
    return this.hand(async () => {
      await this.ensureDebugger();
      if (input.type === "touchStart" || input.type === "touchMove") {
        const point = input.touchPoints[0];
        if (point === undefined) {
          await this.handCommand("Input.dispatchTouchEvent", input, undefined);
          return;
        }
        const routed =
          input.type === "touchStart"
            ? this.#frames.touchStart(point.x, point.y)
            : this.#frames.touchMove(point.x, point.y);
        if (routed === null) return;
        await this.handCommand(
          "Input.dispatchTouchEvent",
          { ...input, touchPoints: [{ ...point, x: routed.x, y: routed.y }] },
          routed.target.session,
        );
        return;
      }
      const target = this.#frames.touchEnd();
      if (target === null) return;
      // (a tap's end: its document may move the focus — a hint)
      await this.hinted(input.type === "touchEnd", () =>
        this.handCommand("Input.dispatchTouchEvent", input, target.session),
      );
    });
  }

  dispatchMouse(input: BrowserSurfaceNativeMouseInput): Promise<void> {
    // PT-5d (M12 J9): when it ARRIVED — a wheel's gesture is measured by the hand's spacing, never by its turn's (a page
    // answering each wheel late spaces the turns by its answers: every wheel a new gesture, H7's defect back)
    const arrived = performance.now();
    return this.hand(async () => {
      await this.ensureDebugger();
      for (const routed of this.routeMouse(input, arrived))
        await this.hinted(input.type === "mousePressed", () =>
          this.handCommand(
            "Input.dispatchMouseEvent",
            { ...input, x: routed.x, y: routed.y },
            routed.target.session,
          ),
        ).catch((error: unknown) => {
          // PT-5d (M12 J12): a press refused — let go at its frame's detach, or refused by the engine — is down for
          // nobody: the producer never told it down, and no release follows it; nothing holds its button (kept, every move
          // after it went to a press target that no longer stands, until the next press)
          if (input.type === "mousePressed") this.#frames.unpressed(buttonOf(input));
          throw error;
        });
    });
  }

  dispatchKey(input: BrowserSurfaceNativeKeyInput): Promise<void> {
    return this.hand(async () => {
      await this.ensureDebugger();
      await this.focusSettled();
      const target =
        input.type === "keyUp" ? this.#frames.keyUp(input.code) : this.#frames.keyDown(input.code);
      if (target === null) return;
      // PT-5d (M15): a frame of another site holding the focus — the key's down or up REFUSED, sent to no session: typing
      // there is off (a key's up so refused, J13's stated limit: the page keeps that key down until its next up)
      if (target.session !== undefined) throw new BrowserFrameKeysRefused();
      await this.hinted(input.type !== "keyUp", () =>
        this.handCommand("Input.dispatchKeyEvent", input, target.session),
      );
    });
  }

  dispatchText(text: string): Promise<void> {
    return this.hand(async () => {
      await this.ensureDebugger();
      await this.focusSettled();
      const target = this.#frames.focused();
      // (M15: text into a frame of another site — refused)
      if (target.session !== undefined) throw new BrowserFrameKeysRefused();
      await this.handCommand("Input.insertText", { text }, target.session);
    });
  }

  dispatchCompose(text: string, caret: number): Promise<void> {
    return this.hand(async () => {
      await this.ensureDebugger();
      await this.focusSettled();
      const target = this.#frames.focused();
      // (M15: a composition into a frame of another site — refused)
      if (target.session !== undefined) throw new BrowserFrameKeysRefused();
      await this.handCommand(
        "Input.imeSetComposition",
        { text, selectionStart: caret, selectionEnd: caret },
        target.session,
      );
    });
  }

  /** PT-5d (M7 H2): a command that may move the focus (a press, a key's down, a tap's end) — a HINT: the focus in doubt from
   * its send until a word heard with or after its answer says where it went. */
  private async hinted(hint: boolean, send: () => Promise<void>): Promise<void> {
    if (!hint) return send();
    this.#frames.handSent();
    try {
      await send();
    } finally {
      this.#frames.handAnswered();
      this.focusMoved();
    }
  }

  /** PT-5d (M7 H2): the focus known — at once, or when a word settles it; refused once `FOCUS_WORD_MS` have passed. */
  private focusSettled(): Promise<void> {
    if (!this.#frames.inDoubt()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const known = (): void => {
        if (this.#frames.inDoubt()) return;
        clearTimeout(timer);
        this.#focusWaiters.delete(known);
        resolve();
      };
      const timer = setTimeout(() => {
        this.#focusWaiters.delete(known);
        reject(new Error("Browser input's focus is in doubt"));
      }, FOCUS_WORD_MS);
      this.#focusWaiters.add(known);
    });
  }

  /** PT-5d (M7 H2): where the focus is may have changed — each waiting key-like event looks again. */
  private focusMoved(): void {
    for (const known of [...this.#focusWaiters]) known();
  }

  /** PT-5d (M6.4b): a command of the hand the page never answered, said (see `handCommand`). */
  onInputHung(listener: (frame?: string) => void): () => void {
    this.#hungListeners.add(listener);
    return () => this.#hungListeners.delete(listener);
  }

  /**
   * PT-5d (M6.4b) — EVERY COMMAND OF THE HAND goes through here: timed from its SEND to its answer — never its wait in the
   * hand's queue behind another (the clock starts again at each answer, as the engine's own ack timeout does); unanswered
   * past the window's `hungInputMs`, said hung once (`onInputHung`) with the origin of the frame it went to (M6.4a). Born
   * without the bound (a page that does not say when it stops), nothing is timed. PT-5d (M7 H9): a TOUCH sent to a
   * document that has not painted since it committed is timed from that paint — the engine answers a touch at a paint
   * (F7): a page whose first paint a stylesheet holds is loading, not stopped. PT-5d (M12 J14): the TARGET's document —
   * the page's, or the frame's own (its commit, by its own word) — never the page's alone.
   */
  private async handCommand(
    method: string,
    params: object,
    session: string | undefined,
  ): Promise<void> {
    const bound = this.options.hungInputMs;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = (): void => {
      if (bound === undefined) return;
      timer = setTimeout(() => {
        const frame = this.#frames.originOf(session);
        for (const listener of [...this.#hungListeners]) listener(frame);
      }, bound);
    };
    const atPaint =
      method === "Input.dispatchTouchEvent" &&
      (session === undefined ? !this.#painted : this.#unpainted.has(session));
    if (atPaint) this.#atPaint.add(arm);
    else arm();
    // PT-5d (M7 H11): the page's commit lets it go — a document that hung and was left (an address typed, ↻ at last) keeps
    // the chain stalled no longer, and its command's bound says nothing of the document after it; PT-5d (M12 J12): and a
    // frame's command, its frame's detach
    let letGo: ((why: string) => void) | undefined;
    const gone = new Promise<never>((_, reject) => {
      letGo = (why) => reject(new Error(why));
    });
    if (letGo !== undefined) this.#inFlight.set(letGo, session);
    try {
      await Promise.race([
        this.window.webContents.debugger.sendCommand(method, params, session),
        gone,
      ]);
    } finally {
      this.#atPaint.delete(arm);
      if (letGo !== undefined) this.#inFlight.delete(letGo);
      if (timer !== null) clearTimeout(timer);
    }
  }

  /** PT-5d: a pointer's event, routed — a hover that crosses into another target first tells the one it left; a wheel by
   * when it `arrived` (M12 J9). */
  private routeMouse(
    input: BrowserSurfaceNativeMouseInput,
    arrived: number,
  ): readonly FrameRouted[] {
    const button = buttonOf(input);
    if (input.type === "mousePressed") return [this.#frames.press(button, input.x, input.y)];
    if (input.type === "mouseReleased") {
      const routed = this.#frames.release(button, input.x, input.y);
      return routed === null ? [] : [routed];
    }
    if (input.type === "mouseWheel") return [this.#frames.wheel(input.x, input.y, arrived)];
    return this.#frames.move(input.x, input.y);
  }

  navigate(action: "back" | "forward" | "reload" | "stop"): void {
    if (this.isDestroyed()) return;
    const contents = this.window.webContents;
    if (action === "back") {
      if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      return;
    }
    if (action === "forward") {
      if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
      return;
    }
    if (action === "reload") {
      contents.reload();
      return;
    }
    contents.stop();
  }

  onNavigationState(listener: (state: BrowserSurfaceNavigationState) => void): () => void {
    const contents = this.window.webContents;
    const emit = (): void => {
      // The about:blank bootstrap document is plumbing, not navigation truth.
      if (this.isDestroyed() || !this.#remoteLoadStarted) return;
      listener({
        url: contents.getURL(),
        title: contents.getTitle(),
        loading: contents.isLoading(),
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
        document: this.#documents,
        ...(this.#loadFailure === undefined ? {} : { failure: this.#loadFailure }),
      });
    };
    // PT-5a — A LOAD THAT FAILED (probed): Electron says it with the net error and the address ASKED for, and commits its
    // own error page under that address with NO `did-navigate`; `getURL()` stays the asked address. So a failure stands
    // from then until the next `did-navigate` (a page that committed). −3 is an aborted load (a stop, a download, a
    // navigation that replaced it): not a failure.
    // PT-5c2 (F1) — said at the error page's own word, `did-fail-provisional-load` (its `did-fail-load` follows in the same
    // millisecond). A `did-fail-load` alone is a committed document's LATE failure (its body cut): no failure of the page —
    // the document stands, showing what came, as Chrome shows it, and `did-stop-loading` says its load ended. (Before: said
    // at every `did-fail-load` — over a page that stood.)
    const failed = (
      _event: Electron.Event,
      code: number,
      _description: string,
      _url: string,
      isMainFrame: boolean,
    ): void => {
      if (!isMainFrame || code === -3) return;
      this.#loadFailure = code;
      emit();
    };
    const committed = (): void => {
      this.#loadFailure = undefined;
      emit();
    };
    // PT-5a — A FRESH PAGE HAS NOWHERE TO GO BACK TO: the bootstrap `about:blank` is an entry of the window's history, so a
    // page's first load said `canGoBack: true` and ‹ went to a blank film (probed; the BAR row's first read). It is pruned
    // once the first remote load has stopped — a load that failed too (its error page stands in the asked address's entry).
    const stopped = (): void => {
      if (!this.#bootstrapPruned && this.#remoteLoadStarted && !this.isDestroyed()) {
        this.#bootstrapPruned = true;
        try {
          contents.navigationHistory.clear();
        } catch {
          // a history that cannot be pruned now keeps its first entry: ‹ stays lit, as before
        }
      }
      emit();
    };
    contents.on("did-navigate", committed);
    contents.on("did-fail-provisional-load", failed);
    contents.on("did-navigate-in-page", emit);
    contents.on("page-title-updated", emit);
    contents.on("did-start-loading", emit);
    contents.on("did-stop-loading", stopped);
    return () => {
      contents.off("did-navigate", committed);
      contents.off("did-fail-provisional-load", failed);
      contents.off("did-navigate-in-page", emit);
      contents.off("page-title-updated", emit);
      contents.off("did-start-loading", emit);
      contents.off("did-stop-loading", stopped);
    };
  }

  onFavicon(listener: (urls: readonly string[]) => void): () => void {
    const contents = this.window.webContents;
    // (the bootstrap document's is plumbing: nothing is said of it)
    const updated = (_event: Electron.Event, urls: string[]): void => {
      if (this.#remoteLoadStarted && !this.isDestroyed()) listener(urls);
    };
    contents.on("page-favicon-updated", updated);
    return () => {
      contents.off("page-favicon-updated", updated);
    };
  }

  /** Through the page's OWN session — its cookies, and the session's request guard (http and https alone at the top). */
  async fetchIcon(url: string, maxBytes: number): Promise<BrowserSurfaceIcon | null> {
    if (this.isDestroyed()) return null;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), FAVICON_TIMEOUT_MS);
    try {
      const response = await this.window.webContents.session.fetch(url, { signal: abort.signal });
      if (!response.ok || response.body === null) return null;
      const declared = Number(response.headers.get("content-length") ?? Number.NaN);
      if (Number.isFinite(declared) && declared > maxBytes) return null;
      const chunks: Uint8Array[] = [];
      let size = 0;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) return null;
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      return { mediaType: response.headers.get("content-type") ?? "", bytes };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }

  onCursor(listener: (cursor: string) => void): () => void {
    const handler = (_event: Electron.Event, type: string): void => listener(type);
    this.window.webContents.on("cursor-changed", handler);
    return () => this.window.webContents.off("cursor-changed", handler);
  }

  onPaint(listener: (paint: BrowserSurfacePaint) => void): () => void {
    const handler = (
      details: Electron.Event<Electron.WebContentsPaintEventParams>,
      _dirtyRect: Electron.Rectangle,
      image: Electron.NativeImage,
    ): void => {
      if (!this.#remoteLoadStarted) {
        details.texture?.release();
        return;
      }
      // Electron 43 can report a runtime `null` here even though its d.ts only
      // models the texture as optional. Normalize that native boundary before
      // handing the paint to the producer.
      const texture = details.texture ?? undefined;
      listener({
        ...(texture === undefined ? {} : { texture }),
        // PT-5b: the page's own document has not committed yet — this is the window's blank first one
        ...(this.#pageDocument ? {} : { bootstrap: true }),
        image: {
          getSize: () => image.getSize(),
          toBitmap: (targetSize) => {
            const current = image.getSize();
            if (
              targetSize === undefined ||
              (targetSize.width === current.width && targetSize.height === current.height)
            ) {
              return image.toBitmap();
            }
            return image
              .resize({ width: targetSize.width, height: targetSize.height, quality: "good" })
              .toBitmap();
          },
        },
      });
    };
    this.window.webContents.on("paint", handler);
    return () => this.window.webContents.off("paint", handler);
  }

  onUnresponsive(listener: (unresponsive: boolean) => void): () => void {
    const hung = (): void => listener(true);
    const answering = (): void => listener(false);
    this.window.webContents.on("unresponsive", hung);
    this.window.webContents.on("responsive", answering);
    return () => {
      this.window.webContents.off("unresponsive", hung);
      this.window.webContents.off("responsive", answering);
    };
  }

  onRenderProcessGone(listener: (reason: string) => void): () => void {
    const handler = (_event: Electron.Event, details: Electron.RenderProcessGoneDetails): void =>
      listener(details.reason);
    this.window.webContents.on("render-process-gone", handler);
    return () => this.window.webContents.off("render-process-gone", handler);
  }

  onDestroyed(listener: () => void): () => void {
    this.window.webContents.on("destroyed", listener);
    return () => this.window.webContents.off("destroyed", listener);
  }

  /** PT-5c (ruling 1): the DEVICE's queue — its layout and what it is told, one behind another. */
  private device<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#deviceTail.then(operation, operation);
    this.#deviceTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** PT-5c (ruling 1): the HAND's queue — its input, one behind another, never behind the device's. */
  /**
   * PT-5d (M9) — see `BrowserSurfaceNativeWindow.setFocused`: `Emulation.setFocusEmulationEnabled` on the PAGE's session —
   * the page behaves as focused (`document.hasFocus()`, its window's `focus`), whatever the app's own activation — on its
   * DEVICE queue (M12 J1: never holding the hand, outside its bound). Another window of the native told before is untold
   * first (on its own device queue: never waited on — a page that hangs keeps no other from its focus). A frame of another site is not told: its own renderer holds its focus,
   * and the run's F-h says whether each frame's session needs its own (M9).
   */
  setFocused(focused: boolean): Promise<void> {
    const holder = this.focus;
    if (focused) {
      const told = this.focusFor();
      if (holder.window === this && holder.told === told) return Promise.resolve();
      const was = holder.window;
      holder.window = this;
      holder.told = told;
      if (was !== undefined && was !== this) void was.tellFocus(false).catch(() => undefined);
      return this.tellFocus(true);
    }
    if (holder.window !== this) return Promise.resolve();
    holder.window = undefined;
    holder.told = undefined;
    return this.tellFocus(false);
  }

  /**
   * PT-5d (M11.2) — WHAT A TELLING HOLDS FOR, beside its window: nothing while the page's focus emulation survives its
   * commits. If run 4's F-h2 says a commit drops it, this is the one line that changes — `return this.#documents;` — and
   * the first taking after each commit tells the page again (its row waits in a `describe.skip` named for the run).
   */
  private focusFor(): number {
    return 0;
  }

  private tellFocus(enabled: boolean): Promise<void> {
    // (a window destroyed meanwhile: `ensureDebugger` refuses it — nothing sent. PT-5d (M12 J1): on the DEVICE queue, as
    // the page's other emulation — never holding the hand, outside its bound: a page hung by itself is said stopped by
    // the hand's own command, sent at once behind it)
    return this.device(async () => {
      await this.bootstrapReady;
      await this.ensureDebugger();
      await this.window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {
        enabled,
      });
    });
  }

  private hand<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#handTail.then(operation, operation);
    this.#handTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * The page's CDP session — and, PT-5a, its GUARDS, put on as it attaches (before the page's first load: the window's first
   * layout asks for it, after the bootstrap document): the file picker intercepted and cancelled, `window.close` and
   * `prompt` replaced in every new document, frames in other processes attached so they are guarded too. A guard that
   * cannot be set fails the command that asked for the session — the page is never loaded without them.
   */
  private ensureDebugger(): Promise<void> {
    if (this.isDestroyed())
      return Promise.reject(new Error("Browser surface target is unavailable"));
    const cdp = this.window.webContents.debugger;
    // (one attach, both queues wait on it: neither sends a command before the guards are on)
    if (this.#ready === undefined || !cdp.isAttached()) {
      const ready = (async () => {
        cdp.attach("1.3");
        try {
          await cdp.sendCommand("Page.enable");
          await cdp.sendCommand("Page.setInterceptFileChooserDialog", NO_FILE_PICKER);
          // PT-5c (ruling 1): the page's word of its scale — a binding, heard only with the Runtime on (its cost: each
          // console line of the page is one message more to main — PT-5c's probe)
          await cdp.sendCommand("Runtime.enable");
          // (PT-5d, M7 H1: each binding the words' world's alone)
          await cdp.sendCommand("Runtime.addBinding", {
            name: PAGE_SCALE_BINDING,
            executionContextName: WORDS_WORLD,
          });
          // PT-5d: the page's own words of its frames and its focus
          await cdp.sendCommand("Runtime.addBinding", {
            name: FRAME_WORDS_BINDING,
            executionContextName: WORDS_WORLD,
          });
          await cdp.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
            source: PAGE_GUARD_SCRIPT,
          });
          await cdp.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
            source: `${PAGE_SCALE_SCRIPT}${FRAME_WORDS_SCRIPT}`,
            worldName: WORDS_WORLD,
          });
          await cdp.sendCommand("Target.setAutoAttach", AUTO_ATTACH);
        } catch (error) {
          cdp.detach();
          throw error;
        }
        this.#debuggerAttached = true;
      })();
      this.#ready = ready;
      ready.catch(() => {
        if (this.#ready === ready) this.#ready = undefined;
      });
    }
    return this.#ready;
  }
}

/** Pinned Electron 43 Browser OSR adapter. */
export class ElectronBrowserSurfaceNative implements BrowserSurfaceNative {
  /** PT-5d (M9): the one window of this native told it is focused */
  readonly #focus: FocusHolder = { window: undefined, told: undefined };

  createWindow(options: BrowserSurfaceNativeWindowOptions): BrowserSurfaceNativeWindow {
    // PT-4: a persistent profile lives under its USER's data (`LAYOUT.BROWSER_PROFILES_DIR`) when the runtime names where;
    // else — and for a memory profile — Electron's own partition by name
    const targetSession =
      options.profilePath !== undefined
        ? session.fromPath(options.profilePath, { cache: true })
        : session.fromPartition(options.partition, { cache: options.persistent });
    installGuardedBrowserSurfaceSession(targetSession);
    const initial = baseRaster(options);
    const window = new BrowserWindow({
      show: false,
      frame: false,
      paintWhenInitiallyHidden: true,
      width: integerDimension(initial.width / options.deviceScaleFactor),
      height: integerDimension(initial.height / options.deviceScaleFactor),
      webPreferences: {
        session: targetSession,
        offscreen: {
          useSharedTexture: options.requestSharedTexture,
          sharedTexturePixelFormat: "argb",
          deviceScaleFactor: options.deviceScaleFactor,
        },
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        autoplayPolicy: "document-user-activation-required",
        // PT-5a: a page never raises a native dialog — `alert` returns at once, `confirm` answers false (ruling 7)
        disableDialogs: true,
      },
    });
    // the guards are installed BEFORE the bootstrap document; what they refuse is told to the window made just below
    const told: { refused?: (what: BrowserSurfaceRefusal, url?: string) => void } = {};
    installGuardedBrowserSurfaceContents(window.webContents, (what, url) =>
      told.refused?.(what, url),
    );
    const bootstrapReady = window.loadURL("about:blank");
    const surface = new ElectronBrowserSurfaceWindow(window, options, bootstrapReady, this.#focus);
    told.refused = (what, url) => surface.refused(what, url);
    return surface;
  }

  monotonicNowUs(): bigint {
    return process.hrtime.bigint() / 1_000n;
  }

  engineAgent(): BrowserSurfaceAgent {
    return engineAgentOf({
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
      systemVersion: process.getSystemVersion(),
    });
  }
}

export const browserElectronRasterPolicy = {
  baseRaster,
  safeEffectiveRaster,
};
