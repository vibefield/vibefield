// PT-5d (PORTALS) — THE HAND REACHES EVERY FRAME, IN THE PRODUCT (smoke:canvas; the brief PT-5d §2): a pane on the fixture's
// host page (`/frames/host`, at `localhost`), its frame of ANOTHER SITE (`127.0.0.1` — another process, reached on its own
// session), and in that a frame of a THIRD (`[::1]`). Judged by the page's own word (each frames page says what it heard,
// with every ask — testing/live-fixture.ts), the desk's (each face's row) and main's (its windows):
//   FRAME-PRESS  — a press on the frame's button: the frame hears its click within 1 CSS px of where the hand pressed, and
//                  the host nothing on the frame's element (before PT-5d: every press over the frame was the host's, on
//                  its element — PT-5d's probe — and the frame heard none); then on the button of the frame's own child of
//                  its site, the same (M6.1: that child's words, on the frame's session, once set the frame's size — every
//                  press into the frame then landed elsewhere);
//   FRAME-HOVER  — the cursor a pointer over the frame's link; the pointer then moved OUT of the frame onto the host (M7
//                  H15: a real leave) — the cursor no pointer, and the frame heard its link left (the frame's cursor comes
//                  through the page's own `cursor-changed`);
//   FRAME-DOUBLE — a double-click selects the frame's word;
//   FRAME-DRAG   — the range's thumb dragged, released OUTSIDE the frame: its value moved, and no button is left down (the
//                  next move over the frame holds none — it hovers, it does not drag);
//   FRAME-WHEEL  — the wheel over the frame's scroller scrolls it; at its end, the host page — PT-6a (M1): the whole
//                  leg drained within two bubbles past its sending (a frame's late answer moves the rest of the
//                  gesture to its parent), never one a wheel;
//   FRAME-TYPE   — M15, a STATED LIMIT: the frame's field pressed (its focus the frame's, by its own word), then "héllo"
//                  typed, a syllable composed and committed, and ⌘A: its field left EMPTY, no key heard by the host or by
//                  the frame, and main counting each leg's refusals — typing into a frame of another site is OFF (through
//                  the product's frame session it crashed main: `Electron-2026-10-12-123521.ips`); main alive after;
//   FRAME-NESTED — a press on the button of the frame in the frame (a third site) lands there;
//   FRAME-HALF   — the host scrolled until the frame is half out of its view: a press on the frame's part in view lands;
//   FRAME-ZOOMED — M7 H11: a press at a page scale not 1 — a phone's host naming no viewport (drawn whole at about 0.41),
//                  a laptop's page the desk draws larger (its page scale 2) — lands in the frame where the hand pressed;
//   FRAME-TOUCH  — on a phone, a tap on the frame's button: its touch's start and end, and the click — and the frame
//                  told the PHONE (M6.5b): its own agent, touch points and colours the page's (before: a laptop's);
//   FRAME-GONE   — a press held in the frame and the frame sent elsewhere under it: its release goes nowhere and nothing
//                  stalls — the next press lands in the frame's new document;
//   FRAME-CLIPPED — M6.3a: the frame in a host's SCROLLER, its top half above the scroller's clip edge, under the host's
//                  header: a press on the clipped part is the host's (its header heard it; the frame nothing), a press on
//                  the part in view the frame's (before M6.3a the frame took both);
//   FRAME-COVERED — M7 H3: a FIXED header drawn over the frame's top: a press on the header there is the host's, one below
//                  it the frame's (before H3 the frame took both — a regression of PT-5d's routing); M8: and a page that
//                  hides its header from a read in its own world (its DOM's methods replaced) — still the host's; M12 J5:
//                  and the frame held in an about:blank SLOT of the host (a frame of the host's own process), the header
//                  drawn over the SLOT — still the host's (before J5 the slot's own document alone was read: the frame
//                  took it), below it the frame's;
//   FRAME-MENU   — M7 H3: the host's dropdown opened over the frame: its item's press is the host's, the frame hears
//                  nothing;
//   FRAME-PICKER — the file input in the NESTED frame pressed (M2): no panel, its `cancel` heard, main's windows as they were;
//   BACK-WRITTEN — ruling 5: a pane the document sent from A to B, the page's own ‹ back to A: the document's url is A again;
//   STUCK        — ruling 6: a page whose button starts an endless loop, pressed, then a key it never answers: the face says
//                  the page stopped responding within the host's bound; ↻ brings it back. M7 H11: and WHILE the chain is
//                  stalled ↻ asks the page again at once, and an address of another site typed takes the page there — and
//                  the stalled command of the document before is let go (the page there is never said stopped).
//   FRAME-BUSY   — PT-6a (K1): a page holding an AD-LIKE frame of another site, busy after a press (a laptop's) or a tap
//                  (a phone's) on its OWN field: every key typed meanwhile lands in order — never refused (the page's own
//                  doubt holds its keys until its word, the host's bound); the page says whether the hint's word waited
//                  behind its busy task with the hint's gesture already answered (K1's path) or not; and K1's own leg —
//                  a KEY whose keydown requests a RENDER (run 11: the render runs ahead of the page's word): its down
//                  answered, its text waits on the word past the second, K1 holds it — required of that leg. (A posted
//                  task never holds the word; a press's release and a tap's end wait for the task — runs 6–11);
//   PRESS-ANSWER — PT-6a (K1, the engine's fact): a press on a FRAMELESS page whose own mousedown holds its thread — how
//                  long main's count of the hand's commands in flight stayed up after it: is a press answered before its
//                  handler (PT-5b3's probe said so), or after?
//   FRAME-OPENED — PT-6a (M4, M5 — F1): a page holding a frame of another site and a same-site EDITOR frame its script
//                  writes by open()/write()/close() after its load (whose window's listeners, the focus words' too, the
//                  open erases): its field pressed and typed — the text lands within `openedLandMs`, and the page is never
//                  said stopped over a watch past the host's bound (a document that cannot speak is never waited on);
// Then the panes are removed and the board is as found. `--frames-pane` beside `--smoke-canvas` runs these rows alone after
// the boot's (the author's loop).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type FixtureBusy,
  type FixtureRect,
  type FixtureReport,
  FRAMES_BOX,
  FRAMES_OPENED,
  FRAMES_SPIN_MS,
  FRAMES_WORD,
} from "./live-fixture";
import { PANE, type PaneHands, paneHands } from "./smoke-browser-pane";
import type { WindowsSeen } from "./smoke-honest-pane";
import type { LiveRowsDriver } from "./smoke-live-pane";
import type { HeldFrameSeen } from "./smoke-use-pane";

/** The flag beside `--smoke-canvas` that runs these rows alone after the boot's (the author's loop). */
export const FRAMES_FLAG = "--frames-pane";

export const FRAMES_ROWS = {
  /** how long a page's word or a face's turn is waited for */
  withinMs: 30_000,
  /** a laptop's pane as it is laid (the manifest's size), and the gap between two */
  laid: { w: 698.16, h: 461.94 },
  gap: 82,
  /** how far from where the hand pressed a frame may hear its click (CSS px) */
  near: 1,
  /** what FRAME-TYPE types, and what it composes then commits */
  typed: "héllo",
  composing: "か",
  composed: "か",
  /** M15: the fewest main refuses over each of FRAME-TYPE's legs — a character's down or its text (one each, at least), the
   * composition and its commit, ⌘A's command */
  refusedAtLeast: { typed: 5, composed: 2, selectAll: 1 },
  /** STUCK: the host's bound on a command never answered (the producer's `hungInputMs`) and the margin past it */
  hungMs: 20_000,
  stuckMarginMs: 10_000,
  /** FRAME-GONE: the longest the next press may wait past the frame's going */
  goneMs: 5_000,
  /** M20 F6: how many times STUCK presses its loop page's button for a leg's hang before the leg says it never ran */
  hangTries: 3,
  /** PT-6a (K1): what FRAME-BUSY types while its page is busy, a person's beat after the hint (ms); how often PRESS-ANSWER
   * looks at main's count (ms) */
  busyTyped: "abc",
  busyBeatMs: 150,
  /** PT-6a (run 6): FRAME-BUSY's key leg — how long after the press it types (the press's own word come and gone) */
  busyFocusMs: 600,
  /** PT-6a (F1): FRAME-OPENED — how soon the text typed into the opened editor must land (ms from the typing), and how long
   * the row watches the page after it (past the host's bound, `hungMs`: a page said stopped by a missing word shows) */
  openedLandMs: 3_000,
  openedWatchMs: 23_000,
  answerLookMs: 20,
  /** PT-6a (M1): FRAME-WHEEL's wheels, how far apart the hand sends them (ms), and the frame's late answers' period (run 4:
   * ~1016 ms) — the leg drains within its sending, two periods (a first late answer under the threshold is followed by one
   * sent right after it, which waits a whole period) and the slack; looked for until `drainWithinMs` from its first wheel */
  wheels: 30,
  wheelApartMs: 40,
  bubbleMs: 1_020,
  drainSlackMs: 600,
  drainWithinMs: 25_000,
} as const;

/** The rows' driver: PT-2's, the shell window's IME (USE's), and main's windows. */
export interface FramesDriver extends LiveRowsDriver {
  compose(text: string, caret: number): Promise<void>;
  commit(text: string): Promise<void>;
  /** main's windows that are not offscreen, and which has the focus (M7 H11: a BrowserWindow panel is one more; a native
   * panel is none — it takes the app's focus) */
  windows(): WindowsSeen;
  /** M12 J11: whether the system's colours are dark (main's `nativeTheme`) — what a page told nothing follows */
  systemDark(): boolean;
}

/** A point in a frame's own CSS px. */
type Point = readonly [number, number];

/** What the rows saw — the SMOKE_CANVAS_FRAMES line, and what the judges read. */
export interface FramesSeen {
  /** M16-1: where each row of the host's frame found its frame standing before it acted (the host's word of its box) */
  readonly stood?: Readonly<Record<string, FixtureRect | null>>;
  readonly press: FramePressSeen;
  /** FRAME-PRESS's second press: the button of the frame's own child of its site (M6.1) */
  readonly same: FramePressSeen;
  readonly hover: {
    readonly over: string | null;
    readonly off: string | null;
    /** the frame heard the pointer leave its link once it moved out of the frame (null: it never said) */
    readonly left: boolean | null;
  };
  readonly double: { readonly sel: string | null };
  readonly drag: {
    readonly before: number | null;
    readonly after: number | null;
    readonly buttonsAfter: number | null;
    /** M15 F3: the moves the frame heard with its primary button held over the drag (absent: not counted) */
    readonly movesHeld?: number | null;
    /** M18 B: the host's OWN range dragged on the page's session — its value before and after (absent: not dragged) */
    readonly host?: { readonly before: number | null; readonly after: number | null };
  };
  readonly wheel: {
    readonly scroller: readonly [number | null, number | null];
    readonly host: readonly [number | null, number | null];
    /** PT-6a (M1): the leg's time — over how long the hand sent its wheels, and from its first until main's count of the
     * hand's commands in flight was back where it began (the chain drained; null: not within `drainWithinMs`). Null: its
     * wheels never sent */
    readonly leg: { readonly sentMs: number; readonly drainedMs: number | null } | null;
  };
  readonly type: {
    /** the frame's field took the focus at the press — what the legs type at */
    readonly focused: boolean;
    /** M15: main's count of the key-like events refused while a frame of another site held the focus
     * (`LiveCensus.frameKeysRefused`), risen over each leg (null: unread) */
    readonly refused: {
      readonly typed: number | null;
      readonly composed: number | null;
      readonly selectAll: number | null;
    };
    /** the frame's field after the legs (M15: "" — nothing typed reaches it) */
    readonly field: string | null;
    /** the keys the HOST page heard (on the frame's element) while the frame's field was typed in */
    readonly hostHeard: readonly string[];
    /** M15: what the FRAME's own document heard meanwhile — no key goes to its session */
    readonly frameHeard: readonly string[];
    /** M12 J11: the host's asks since the last key, before its `heard` was read */
    readonly hostAsks: number | null;
    /** M15: the frame's asks since the last key, before its field and its `heard` were read */
    readonly frameAsks: number | null;
  };
  readonly nested: FramePressSeen & { readonly third: boolean };
  readonly half: FramePressSeen & { readonly top: number | null };
  readonly touch: {
    readonly heard: readonly string[] | null;
    readonly clicks: number;
    /** what the frame and its host page are told of the device (M6.5b; null: unread) */
    readonly device: {
      readonly frame: FramesDevice | null;
      readonly host: FramesDevice | null;
      /** M12 J11: whether the system's colours are dark — what a frame told nothing follows (absent: not read) */
      readonly systemDark?: boolean | null;
    };
    /** M22 D1: the tap aimed at the frame's button through the page's VISUAL viewport, its click, and A's calibration on the
     * host's own ground (its taps on the page's own session) (absent: not aimed so) */
    readonly press?: FramePressSeen;
  };
  readonly gone: {
    readonly went: boolean;
    readonly nextClicks: number;
    readonly ms: number | null;
    /** M7 H11: the leg whose frame goes to ANOTHER SITE under the held press — its session swapped (absent: not run) */
    readonly swap?: {
      readonly went: boolean;
      readonly nextClicks: number;
      readonly ms: number | null;
    } | null;
  };
  /** M7 H11: a press at a page scale not 1 — a phone host naming no viewport, the desk drawing a laptop's page larger */
  readonly zoomed: {
    readonly phone: FramePressSeen & { readonly scale: number | null };
  };
  readonly covered: {
    /** the frame's top and the header's bottom, in the host's view */
    readonly top: number | null;
    readonly edge: number | null;
    /** the press on its part under the header: what the host heard of it, and the frame's clicks */
    readonly hidden: { readonly hostHeard: readonly string[]; readonly frameClicks: number } | null;
    /** the press below the header */
    readonly shown: FramePressSeen;
    /** M8: the press on the header of a page that hides it from a read in its own world (absent: the leg not run) */
    readonly sly?: { readonly hostHeard: readonly string[]; readonly frameClicks: number } | null;
    /** M12 J5: the frame in an about:blank SLOT of the host, the header over the slot — the slot's top and the header's
     * bottom, the press on the header over it, the press below (absent: the leg not run) */
    readonly slot?: {
      readonly top: number | null;
      readonly edge: number | null;
      readonly hidden: {
        readonly hostHeard: readonly string[];
        readonly frameClicks: number;
      } | null;
      readonly shown: FramePressSeen;
    } | null;
  };
  readonly menu: {
    /** the host's dropdown open over the frame */
    readonly opened: boolean;
    /** what the host heard of its item's press, and what the frame heard meanwhile */
    readonly hostHeard: readonly string[];
    readonly frameHeard: readonly string[];
  };
  readonly clipped: {
    /** the frame's top and its scroller's, in the host's view */
    readonly top: number | null;
    readonly edge: number | null;
    /** the press on its clipped part: what the host heard of it, and the frame's clicks */
    readonly hidden: { readonly hostHeard: readonly string[]; readonly frameClicks: number } | null;
    /** the press on its part in view */
    readonly shown: FramePressSeen;
  };
  readonly picker: {
    readonly cancels: number | null;
    readonly changes: number | null;
    /** M7 H11: the app's windows it did not have before the press, and its focused window before and after */
    readonly raised: number;
    readonly focused: readonly [number | null, number | null];
  };
  readonly back: { readonly a: string; readonly arrived: boolean; readonly url: string | null };
  readonly stuck: {
    readonly hung: boolean;
    readonly saidMs: number | null;
    readonly reason: string | null;
    readonly reloaded: boolean;
    /** M7 H11: ↻ pressed while the chain was stalled asked the page's address again (null: the leg not run) */
    readonly reloadActed?: boolean | null;
    /** M7 H11: an address of another site typed while the chain was stalled — the page arrived there, and stayed live */
    readonly typed?: { readonly arrived: boolean; readonly stayed: boolean } | null;
    /** M12 J11: a key the hung page never answers was sent before those legs — the chain stalled behind it (absent: not
     * said). PT-6a (K5): MAIN's word — the census's count of the hand's commands in flight, read 300 ms after each leg's hang
     * (`inFlight`, a leg each): every leg's above none */
    readonly stalled?: boolean;
    readonly inFlight?: readonly (number | null)[];
  };
  /** PT-6a (K1): a page holding an ad-like frame of another site, busy after a press (a laptop's pane) or a tap (a
   * phone's) on its own field — the keys typed meanwhile (absent: not run; a leg null: it could not be aimed) */
  readonly busy?: {
    readonly press: FrameBusySeen | null;
    readonly tap: FrameBusySeen | null;
    /** PT-6a (run 11): the page RENDERING after a KEY on its field — K1's hold reached and required (absent: not run) */
    readonly key?: FrameBusySeen | null;
  };
  /** PT-6a (K1, the engine's fact): a press on a frameless page whose own mousedown holds its thread (absent: not run; null:
   * it could not be aimed) */
  readonly answer?: PressAnswerSeen | null;
  /** PT-6a (F1): FRAME-OPENED (absent: not run; null: its editor's field could not be aimed at) */
  readonly opened?: FrameOpenedSeen | null;
}

/** PT-6a (K1): FRAME-BUSY's leg — what was typed, what the field holds after, what kept the page's thread and when. */
export interface FrameBusySeen {
  readonly typed: string;
  /** the field's value after the typing (null: unread) */
  readonly field: string | null;
  /** the page's own word of its spins, its timer beside each, its field's clicks (its clock) — null: unread */
  readonly busy: FixtureBusy | null;
  /** K1's path: the hint's WORD waited behind the spin (the page's own timer, beside the words', fired after it) with the
   * hint's gesture already answered (a press: its click before the spin; a tap: its end is the hint; a key: its keydown
   * before the spin) — null: unread. The page's timer is posted where the words' is (run 10), so this says the WORD was late
   * — not that a key waited on it (a release or a tap's end answered after the task holds the keys in the chain) */
  readonly held: boolean | null;
}

/** PT-6a (K1, the engine's fact): PRESS-ANSWER — the page's own mousedown, and main's count of the hand's commands in flight
 * after the press. */
export interface PressAnswerSeen {
  /** its mousedown: when it began and how long it held the thread (its clock); null: it never ran */
  readonly down: readonly [number, number] | null;
  /** how long main's count stayed above what it was before the press, from the press sent (ms; 0: never seen up — the press
   * answered within one look); null: the count never read */
  readonly answerMs: number | null;
  readonly lookMs: number;
}

/** What a page is told of its device: its own agent, touch points, whether its colours are dark. */
type FramesDevice = NonNullable<NonNullable<FixtureReport["framed"]>["device"]>;

/** A press aimed at a frame, and what came of it. */
export interface FramePressSeen {
  /** where the hand pressed, in the frame's own px (null: it could not be aimed) */
  readonly aimed: Point | null;
  /** PT-6a (ruling 3): the frame's point its ROUNDED window point presses, through the pane's own eye (absent: the aim) */
  readonly pressed?: Point;
  /** the frame's click there (null: none came) */
  readonly clicked: Point | null;
  /** what the host page heard on the frame's element over the press */
  readonly hostHeard: readonly string[];
  /** M15 A (M18): the hand's own window↔page mapping beside the frame, measured on its host (absent: not calibrated — the
   * aim is the judge's; null: the calibration could not be taken) */
  readonly calibration?: Calibration | null;
}

/** M15 F1: a press on a host's own ground: where it was aimed, the point its rounded window point presses through the pane's
 * own eye (PT-6a, ruling 3; absent: the aim), and where its click landed (null: none came). */
interface GroundSeen {
  readonly aimed: Point;
  readonly pressed?: Point;
  readonly clicked: Point | null;
}

/** M15 A (M18): a press's calibration — presses on its host's OWN ground left and right of the frame at the frame point's
 * height (the host's view px), and the frame point's x there. M22 A: and one at the frame point's SAME x (below the frame,
 * or above it) — the press's own window column. */
export interface Calibration {
  readonly left: GroundSeen | null;
  readonly right: GroundSeen | null;
  /** M22 A: the press on the host's ground at the frame point's own x (absent: the x error interpolated, M18) */
  readonly column?: GroundSeen | null;
  /** the frame point's x, in the host's view px */
  readonly at: number;
}

/** PT-6a (ruling 3): what the calibration READS — each press on the host's own ground beside the frame against the point it
 * pressed, the largest miss each way. The hand aims through the pane's own eye now, both ways: the flat aim's error is gone,
 * and with it M18's interpolation across the width and M22 A's column (the window's quantisation no longer in the aim's
 * error — each press judged at the point its rounded window point presses). What it witnesses is that READING (the
 * product's way back, re-said: `pageOfWindow`), against the page's own ear — the aim only picks the window point (run 6:
 * the aim flattened, every row green). Null: a press taken never heard, or none taken (a side out of the page's view is
 * not pressed). */
export function calibrationMiss(c: Calibration): readonly [number, number] | null {
  const taken = [c.left, c.right, c.column ?? null].filter((g) => g !== null);
  if (taken.length === 0) return null;
  let miss: [number, number] = [0, 0];
  for (const g of taken) {
    if (g.clicked === null) return null;
    const at = g.pressed ?? g.aimed;
    const dx = g.clicked[0] - at[0];
    const dy = g.clicked[1] - at[1];
    miss = [
      Math.abs(dx) > Math.abs(miss[0]) ? dx : miss[0],
      Math.abs(dy) > Math.abs(miss[1]) ? dy : miss[1],
    ];
  }
  return miss;
}

/** PT-6a (ruling 3): the pane in hand as the product draws and presses it — where the desk drew its open extent (core's held
 * frame: the desk view's CSS px, `s` of them a desk unit) and, as its kind laid it (`local(type).layout(e)`), the pane's LOCAL
 * eye, its face's centre and axes (u, v, its normal), the page's place on the face (centre, half extents), and the open
 * extent's centre the hand's points are measured from. */
export interface HeldEyeSeen extends HeldFrameSeen {
  readonly eye: { readonly ex: number; readonly ey: number; readonly h: number };
  readonly centre: Vec3;
  readonly axes: readonly [Vec3, Vec3, Vec3];
  readonly page: readonly [number, number, number, number];
  readonly ext: readonly [number, number];
}

type Vec3 = readonly [number, number, number];
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * PT-6a (ruling 3) — a point of the PAGE (the CSS px of the part it shows) on the window, THROUGH THE PANE'S OWN EYE, as the
 * product presses it, inverted: the page point onto the face (the law's `faceOfPage`, at the size the page shows — the kind
 * scales its `pagePoint` by the displayed frame's size), the face into the world (`pointAt`, on its top face), the world as
 * the eye sees it on the desk (`seen`), the desk into the hand's frame and onto the desk's view (core's held input:
 * `(screen − c) / s` from the open extent's centre). Before: `pageOnWindow`, as if flat — the face rides a lift above the
 * mat, and its eye draws and presses it ~0.9 % farther from the eye's foot (run 1: +4 px at the laptop page's left, −2 at
 * its right).
 */
export function pageThroughEye(
  held: HeldEyeSeen,
  view: readonly [number, number],
  deskOff: { readonly left: number; readonly top: number },
  px: number,
  py: number,
): { readonly x: number; readonly y: number } {
  const [pcx, pcy, phx, phy] = held.page;
  const u = pcx - phx + (px / view[0]) * 2 * phx;
  const v = pcy - phy + (py / view[1]) * 2 * phy;
  const [ex, ey] = held.axes;
  const P: Vec3 = [
    held.centre[0] + ex[0] * u + ey[0] * v,
    held.centre[1] + ex[1] * u + ey[1] * v,
    held.centre[2] + ex[2] * u + ey[2] * v,
  ];
  const k = held.eye.h / Math.max(held.eye.h - P[2], 1e-3);
  const dx = held.eye.ex + (P[0] - held.eye.ex) * k;
  const dy = held.eye.ey + (P[1] - held.eye.ey) * k;
  return {
    x: deskOff.left + held.cx + (dx - held.ext[0]) * held.s,
    y: deskOff.top + held.cy + (dy - held.ext[1]) * held.s,
  };
}

/** PT-6a (ruling 3) — the product's own way back: a window point → the hand's point (core's held input) → the desk → the face,
 * cast from the pane's eye (the law's `facePoint`) → the page (`pagePoint`, at the size the page shows). Where a press at a
 * WHOLE window point lands on the page — the aim's own rounding, judged. */
export function pageOfWindow(
  held: HeldEyeSeen,
  view: readonly [number, number],
  deskOff: { readonly left: number; readonly top: number },
  wx: number,
  wy: number,
): Point {
  const x = held.ext[0] + (wx - deskOff.left - held.cx) / Math.max(held.s, 1e-9);
  const y = held.ext[1] + (wy - deskOff.top - held.cy) / Math.max(held.s, 1e-9);
  const [ax, ay, n] = held.axes;
  const O: Vec3 = [
    held.eye.ex - held.centre[0],
    held.eye.ey - held.centre[1],
    held.eye.h - held.centre[2],
  ];
  const D: Vec3 = [x - held.eye.ex, y - held.eye.ey, -held.eye.h];
  const dz = dot3(D, n);
  const t = Math.abs(dz) > 1e-9 ? -dot3(O, n) / dz : 0;
  const u = dot3(O, ax) + dot3(D, ax) * t;
  const v = dot3(O, ay) + dot3(D, ay) * t;
  const [pcx, pcy, phx, phy] = held.page;
  return [((u - pcx + phx) / (2 * phx)) * view[0], ((v - pcy + phy) / (2 * phy)) * view[1]];
}

/** M16-1: a row of the host's frame acts only on a frame standing where it aims — at `FRAMES_BOX`, the host at its top; a
 * frame anywhere else (run 1: FRAME-WHEEL's chain left the host at its end, every row after it aimed at a frame out of
 * view) and the row proved nothing, never a pass. */
export function judgeStood(row: string, box: FixtureRect | null): string[] {
  if (box === null)
    return [`${row}: its frame stood nowhere the host said — the row proved nothing`];
  return Math.abs(box.x - FRAMES_BOX.x) <= 1 && Math.abs(box.y - FRAMES_BOX.y) <= 1
    ? []
    : [
        `${row}: its frame stood at ${box.x}, ${box.y}, not at ${FRAMES_BOX.x}, ${FRAMES_BOX.y} where the row aims — the row proved nothing`,
      ];
}

/** PT-5d (M22 D1), PT-6a (K7): the part of a page a row aims through — its VISUAL viewport, as the pane shows it. */
export interface VisibleView {
  /** its width and height (CSS px) */
  readonly size: readonly [number, number];
  /** where it stands in the page's layout (its offset, CSS px): a page's client point is shown at that point less it */
  readonly offset: readonly [number, number];
}

/** PT-5d (M22 D1): the page size a row aims by — the VISUAL viewport, as the pane shows it: a phone's page that overflows its
 * layout shows 402 CSS px of an 800-px layout at scale 1 (product run 5) — never its `innerWidth`; a page that says no
 * visible size, its view. PT-6a (K7): and its OFFSET — a pinch-panned page shows its layout from there (M23: "less its
 * offset"; dropped, every aim on such a page was off by it). */
export function visibleView(report: Pick<FixtureReport, "view" | "vv">): VisibleView {
  const width = report.vv?.[3];
  const height = report.vv?.[4];
  const shown = width !== undefined && height !== undefined && width > 0 && height > 0;
  return {
    size: shown ? [width, height] : report.view,
    offset: shown ? [report.vv?.[1] ?? 0, report.vv?.[2] ?? 0] : [0, 0],
  };
}

const near = (a: Point, b: Point, by: number): boolean =>
  Math.abs(a[0] - b[0]) <= by && Math.abs(a[1] - b[1]) <= by;

/** FRAME-PRESS, FRAME-NESTED, FRAME-HALF: the click lands in the frame where the hand pressed; the host hears nothing of it. */
export function judgeFramePress(
  row: string,
  seen: FramePressSeen,
  by: number = FRAMES_ROWS.near,
): string[] {
  if (seen.aimed === null)
    return [`${row}: the frame's part could not be aimed at — the row proved nothing`];
  const out: string[] = [];
  // PT-6a (ruling 3): where the hand pressed — the point its rounded window point presses, through the pane's own eye
  const pressed = seen.pressed ?? seen.aimed;
  const miss =
    seen.calibration === undefined || seen.calibration === null
      ? null
      : calibrationMiss(seen.calibration);
  if (seen.clicked === null)
    out.push(
      `${row}: the frame heard no click — the press never reached a frame of another site (the host heard ${seen.hostHeard.join(", ") || "nothing"})`,
    );
  // (calibrated: the smoke's READING of the hand witnessed on the host's own ground beside the frame — each of its clicks
  // within ±1 of where the reading says it pressed; the aim only picks a whole window point — run 6's R3)
  else if (seen.calibration !== undefined && miss === null)
    out.push(
      `${row}: the host's calibration beside the frame never landed — the click proved nothing`,
    );
  else if (miss !== null && (Math.abs(miss[0]) > by || Math.abs(miss[1]) > by))
    out.push(
      `${row}: the host's own clicks beside the frame landed ${miss.map((v) => v.toFixed(1)).join(", ")} from where the hand pressed them (±${by}) — the smoke's reading of the hand is off: the click proved nothing`,
    );
  else if (!near(seen.clicked, pressed, by))
    out.push(
      `${row}: the frame's click landed at ${seen.clicked.join(", ")}, not where the hand pressed (${pressed.map((v) => v.toFixed(1)).join(", ")}, ±${by}${miss === null ? "" : `; the host's calibration beside it within ${miss.map((v) => v.toFixed(1)).join(", ")}`}): the routing carried the point elsewhere`,
    );
  if (seen.hostHeard.length > 0)
    out.push(
      `${row}: the host page heard the press on the frame's element (${seen.hostHeard.join(", ")}) — it went down the page's own session`,
    );
  return out;
}

/** FRAME-HOVER: the frame's link's cursor over it; out of the frame, not — and the frame heard its link left. */
export function judgeFrameHover(seen: FramesSeen["hover"]): string[] {
  const out: string[] = [];
  if (seen.over !== "pointer")
    out.push(
      `FRAME-HOVER: over the frame's link the cursor is ${seen.over ?? "nothing"}, not a pointer — the hover never reached the frame`,
    );
  if (seen.off === "pointer")
    out.push(
      "FRAME-HOVER: out of the frame the cursor is still a pointer — the hover's leave never reached the frame",
    );
  if (seen.left === null)
    out.push("FRAME-HOVER: the frame never said what it heard — the leave proved nothing");
  else if (!seen.left)
    out.push(
      "FRAME-HOVER: the frame never heard the pointer leave its link — the hover's leave never reached it",
    );
  return out;
}

/** FRAME-DOUBLE: the word selected. */
export function judgeFrameDouble(seen: FramesSeen["double"]): string[] {
  return seen.sel?.trim() === FRAMES_WORD
    ? []
    : [
        `FRAME-DOUBLE: a double-click selected ${JSON.stringify(seen.sel)} in the frame, not "${FRAMES_WORD}" — its count never reached it`,
      ];
}

/** FRAME-DRAG: the thumb moved; no button left down after a release outside the frame. */
export function judgeFrameDrag(seen: FramesSeen["drag"]): string[] {
  if (seen.before === null || seen.after === null)
    return ["FRAME-DRAG: the frame never said its range — the row proved nothing"];
  const out: string[] = [];
  // (M15 F3: which half failed, by the moves the frame heard with its button held)
  if (seen.after < seen.before + 10)
    out.push(
      `FRAME-DRAG: the range stood at ${seen.after} after the drag (from ${seen.before}) — ${
        seen.movesHeld === undefined || seen.movesHeld === null
          ? "the drag never moved it"
          : seen.movesHeld === 0
            ? "the frame heard no move with its button held: the drag's moves never reached it"
            : `the frame heard ${seen.movesHeld} moves with its button held and its thumb never followed: they reached it and did not drag`
      }`,
    );
  // (M18 B: the host's own range — a drag on the page's own session, the defect every page had)
  if (seen.host !== undefined) {
    if (seen.host.before === null || seen.host.after === null)
      out.push(
        "FRAME-DRAG (the host's own range): the host never said its range — that leg proved nothing",
      );
    else if (seen.host.after < seen.host.before + 10)
      out.push(
        `FRAME-DRAG (the host's own range): it stood at ${seen.host.after} after the drag (from ${seen.host.before}) — a drag on the page's own session never moved it`,
      );
  }
  if (seen.buttonsAfter === null)
    out.push(
      "FRAME-DRAG: the frame heard no move after the release — the row proved nothing of what was left down",
    );
  else if (seen.buttonsAfter !== 0)
    out.push(
      `FRAME-DRAG: after the release outside the frame its next move held buttons ${seen.buttonsAfter} — a button left down in the frame (every hover a drag)`,
    );
  return out;
}

/** FRAME-WHEEL: the frame's scroller scrolled; past its end, the host page — PT-6a (M1): and the leg's whole time bounded,
 * one bubble, never one a wheel. */
export function judgeFrameWheel(seen: FramesSeen["wheel"]): string[] {
  const [s0, s1] = seen.scroller;
  const [h0, h1] = seen.host;
  if (s0 === null || s1 === null || h0 === null || h1 === null)
    return ["FRAME-WHEEL: the scroller or the host never said its scroll — the row proved nothing"];
  const out: string[] = [];
  if (s1 <= s0)
    out.push(
      `FRAME-WHEEL: the frame's scroller stood at ${s1} (from ${s0}) — the wheel never reached the frame`,
    );
  if (h1 <= h0)
    out.push(
      `FRAME-WHEEL: past the scroller's end the host stood at ${h1} (from ${h0}) — the wheel did not chain to the page`,
    );
  const leg = seen.leg;
  if (leg === null) out.push("FRAME-WHEEL: its wheels were never sent — the row proved nothing");
  else {
    const bound = leg.sentMs + 2 * FRAMES_ROWS.bubbleMs + FRAMES_ROWS.drainSlackMs;
    if (leg.drainedMs === null || leg.drainedMs > bound)
      out.push(
        `FRAME-WHEEL: the hand's chain drained ${leg.drainedMs === null ? `not within ${FRAMES_ROWS.drainWithinMs}` : leg.drainedMs} ms after the first wheel (its wheels sent over ${leg.sentMs} ms; at most ${bound}: two bubbles past the sending) — the frame held the chain a bubble a wheel`,
      );
  }
  return out;
}

/** FRAME-TYPE (M15, a stated limit): typing into a frame of another site is OFF — its field left empty, no key heard by the
 * host or by the frame, and each leg's refusals counted by main. */
export function judgeFrameType(seen: FramesSeen["type"]): string[] {
  if (!seen.focused)
    return ["FRAME-TYPE: the frame's field never took the focus — the row proved nothing"];
  const out: string[] = [];
  if (seen.field !== "")
    out.push(
      `FRAME-TYPE: the frame's field holds ${JSON.stringify(seen.field)} — typing reached a frame of another site (M15: refused, a stated limit — through the product's frame session it crashed main)`,
    );
  for (const leg of ["typed", "composed", "selectAll"] as const) {
    const refused = seen.refused[leg];
    const least = FRAMES_ROWS.refusedAtLeast[leg];
    if (refused === null)
      out.push(
        `FRAME-TYPE (${leg}): main's count of the refused was never read — the leg proved nothing`,
      );
    else if (refused < least)
      out.push(
        `FRAME-TYPE (${leg}): main refused ${refused} key-like event(s), not ${least} or more — the rest went somewhere, or never reached main`,
      );
  }
  const keys = seen.hostHeard.filter((h) => h.startsWith("keydown"));
  if (keys.length > 0)
    out.push(
      `FRAME-TYPE: the host page heard ${keys.length} key(s) while the frame's field was typed in (${keys.join(", ")}) — they went down the page's session with a frame of another site focused (M3's banned path)`,
    );
  const frameKeys = seen.frameHeard.filter((h) => h.startsWith("keydown"));
  if (frameKeys.length > 0)
    out.push(
      `FRAME-TYPE: the frame heard ${frameKeys.length} key(s) (${frameKeys.join(", ")}) — they went down its own session (M15: typing into a frame of another site is off)`,
    );
  // M12 J11: each page's word taken after the last key — its asks come every quarter second: one taken before would miss a
  // key sent late
  if (seen.hostAsks === null || seen.hostAsks < 2)
    out.push(
      `FRAME-TYPE: the host's word was read before one taken after the last key (${seen.hostAsks ?? 0} ask since) — its host-heard half proved nothing`,
    );
  if (seen.frameAsks === null || seen.frameAsks < 2)
    out.push(
      `FRAME-TYPE: the frame's word was read before one taken after the last key (${seen.frameAsks ?? 0} ask since) — its empty field and its keys heard proved nothing`,
    );
  return out;
}

/** FRAME-TOUCH: the touch's start and end, and the click; the frame told the page's device (M6.5b). */
export function judgeFrameTouch(seen: FramesSeen["touch"]): string[] {
  if (seen.heard === null)
    return ["FRAME-TOUCH: the frame never said what it heard — the row proved nothing"];
  const out: string[] = [];
  if (!seen.heard.includes("touchstart #b") || !seen.heard.includes("touchend #b"))
    out.push(
      `FRAME-TOUCH: the frame heard ${seen.heard.join(", ") || "nothing"} — no touch of the phone's finger on its button`,
    );
  if (seen.clicks < 1) out.push("FRAME-TOUCH: the tap made no click in the frame");
  // (M22 D1: where it landed, against the hand's own mapping — and the page's own taps on its ground, where aimed)
  if (seen.press !== undefined) out.push(...judgeFramePress("FRAME-TOUCH", seen.press));
  const { frame, host } = seen.device;
  if (frame === null || host === null)
    out.push("FRAME-TOUCH: the frame or its host never said its device — that half proved nothing");
  else if (host.touch < 1)
    out.push(
      "FRAME-TOUCH: the host page was told no touch — not a phone: that half proved nothing",
    );
  else {
    if (frame.ua !== host.ua)
      out.push(
        `FRAME-TOUCH: the frame was told another agent (${JSON.stringify(frame.ua)}), not the page's (${JSON.stringify(host.ua)})`,
      );
    if (frame.touch !== host.touch)
      out.push(`FRAME-TOUCH: the frame says ${frame.touch} touch points, the page ${host.touch}`);
    if (frame.dark !== host.dark)
      out.push(
        `FRAME-TOUCH: the frame's colour scheme is not the page's (dark ${frame.dark}, the page's ${host.dark})`,
      );
    // M12 J11: colours that match prove something only where the page's are not the SYSTEM's — a frame told nothing
    // follows the system's
    else if (
      seen.device.systemDark !== undefined &&
      (seen.device.systemDark === null || host.dark === seen.device.systemDark)
    )
      out.push(
        `FRAME-TOUCH: the page was told the system's own colours (dark ${host.dark}) — a frame told nothing would match them: the colour half proved nothing`,
      );
  }
  return out;
}

/** FRAME-GONE: the frame went; nothing stalled — the next press landed in its new document. */
export function judgeFrameGone(seen: FramesSeen["gone"]): string[] {
  const leg = (
    row: string,
    went: boolean,
    nextClicks: number,
    ms: number | null,
    nothing: string,
    stalled: string,
  ): string[] => {
    if (!went) return [`${row}: ${nothing}`];
    if (nextClicks < 1 || ms === null) return [`${row}: ${stalled}`];
    return ms > FRAMES_ROWS.goneMs
      ? [
          `${row}: the next press landed ${ms} ms after it was sent — it waited on the gone document`,
        ]
      : [];
  };
  const out = leg(
    "FRAME-GONE",
    seen.went,
    seen.nextClicks,
    seen.ms,
    "the frame never went elsewhere under the held press — the row proved nothing",
    "the next press never landed in the frame's new document — the hand stalled on the gone one",
  );
  const swap = seen.swap;
  if (swap !== undefined) {
    const row = "FRAME-GONE (to another site — its session swapped)";
    if (swap === null) out.push(`${row}: its press could not be aimed — that leg proved nothing`);
    else
      out.push(
        ...leg(
          row,
          swap.went,
          swap.nextClicks,
          swap.ms,
          "the frame never went there under the held press — that leg proved nothing",
          "the next press never landed in its new document — the hand stalled on the gone session",
        ),
      );
  }
  return out;
}

/** FRAME-ZOOMED (M7 H11): a press at a page scale not 1 lands in the frame where the hand pressed. */
export function judgeFrameZoomed(seen: FramesSeen["zoomed"]): string[] {
  const out: string[] = [];
  const leg = (
    seenLeg: FramesSeen["zoomed"]["phone"],
    row: (scale: number | null) => string,
  ): void => {
    if (seenLeg.scale === null || Math.abs(seenLeg.scale - 1) < 0.05)
      out.push(
        `${row(null)}: the page stood at scale ${seenLeg.scale ?? "nothing"} — not drawn at another: that leg proved nothing`,
      );
    // (calibrated — M22 A — against the hand's own mapping, ±1; else: a window px is 1/scale of the page's own, the hand
    // presses no nearer than that)
    else
      out.push(
        ...judgeFramePress(
          row(seenLeg.scale),
          seenLeg,
          seenLeg.calibration !== undefined
            ? FRAMES_ROWS.near
            : Math.max(FRAMES_ROWS.near, Math.ceil(1 / seenLeg.scale)),
        ),
      );
  };
  leg(seen.phone, (scale) =>
    scale === null || Math.abs(scale - 1) < 0.05
      ? "FRAME-ZOOMED (a phone, its page at its own scale)"
      : `FRAME-ZOOMED (a phone, its page at ${Math.round(scale * 100) / 100})`,
  );
  // (M18 E: the desk's leg is gone — no door gives a laptop's page a scale past 1 from the smoke; mouse at s ≠ 1 into a
  // frame is ÷ s by the touch evidence on the same path, unwitnessed for mouse — carried to PT-6)
  return out;
}

/** FRAME-CLIPPED (M6.3a): a press on the frame's clipped part is the host's — it draws there; on its part in view, the
 * frame's. */
export function judgeFrameClipped(seen: FramesSeen["clipped"]): string[] {
  if (seen.top === null || seen.edge === null || seen.top >= seen.edge)
    return [
      `FRAME-CLIPPED: the frame's top stood at ${seen.top ?? "nothing"}, its scroller's at ${seen.edge ?? "nothing"} — it was not clipped: the row proved nothing`,
    ];
  const out: string[] = [];
  if (seen.hidden === null)
    out.push(
      "FRAME-CLIPPED: the frame's clipped part could not be aimed at — that half proved nothing",
    );
  else {
    if (seen.hidden.frameClicks > 0)
      out.push(
        `FRAME-CLIPPED: the press on the frame's clipped part went to the FRAME (${seen.hidden.frameClicks} click) — the host draws there`,
      );
    if (!seen.hidden.hostHeard.includes("click #hd"))
      out.push(
        `FRAME-CLIPPED: the host heard ${seen.hidden.hostHeard.join(", ") || "nothing"} — not the press on its header, which it draws over the frame's clipped part`,
      );
  }
  out.push(...judgeFramePress("FRAME-CLIPPED (its part in view)", seen.shown));
  return out;
}

/** FRAME-COVERED (M7 H3): a fixed header drawn over the frame's top — a press on it there is the host's; below it, the
 * frame's. */
export function judgeFrameCovered(seen: FramesSeen["covered"]): string[] {
  if (seen.top === null || seen.edge === null || seen.top >= seen.edge)
    return [
      `FRAME-COVERED: the frame's top stood at ${seen.top ?? "nothing"}, the header's bottom at ${seen.edge ?? "nothing"} — the header was not over it: the row proved nothing`,
    ];
  const out: string[] = [];
  if (seen.hidden === null)
    out.push(
      "FRAME-COVERED: the frame's covered part could not be aimed at — that half proved nothing",
    );
  else {
    if (seen.hidden.frameClicks > 0)
      out.push(
        `FRAME-COVERED: the press on the header over the frame went INTO the frame (${seen.hidden.frameClicks} click) — the host draws its header there`,
      );
    if (!seen.hidden.hostHeard.includes("click #hd"))
      out.push(
        `FRAME-COVERED: the host heard ${seen.hidden.hostHeard.join(", ") || "nothing"} — not the press on its header, drawn over the frame`,
      );
  }
  out.push(...judgeFramePress("FRAME-COVERED (below the header)", seen.shown));
  if (seen.sly === null)
    out.push(
      "FRAME-COVERED (a page hiding its header from the read): its press could not be aimed — that leg proved nothing",
    );
  else if (seen.sly !== undefined) {
    if (seen.sly.frameClicks > 0)
      out.push(
        `FRAME-COVERED (a page hiding its header from the read): the press on the header went INTO the frame (${seen.sly.frameClicks} click) — the read believed the page's own world`,
      );
    if (!seen.sly.hostHeard.includes("click #hd"))
      out.push(
        `FRAME-COVERED (a page hiding its header from the read): the host heard ${seen.sly.hostHeard.join(", ") || "nothing"} — not the press on its header`,
      );
  }
  // M12 J5: the frame in an about:blank slot of the host — the header drawn over the SLOT
  const slot = seen.slot;
  if (slot === null)
    out.push(
      "FRAME-COVERED (the frame in an about:blank slot): its presses could not be aimed — that leg proved nothing",
    );
  else if (slot !== undefined) {
    if (slot.top === null || slot.edge === null || slot.top >= slot.edge)
      out.push(
        `FRAME-COVERED (the frame in an about:blank slot): the slot's top stood at ${slot.top ?? "nothing"}, the header's bottom at ${slot.edge ?? "nothing"} — the header was not over it: that half proved nothing`,
      );
    else if (slot.hidden === null)
      out.push(
        "FRAME-COVERED (the frame in an about:blank slot): its covered part could not be aimed at — that half proved nothing",
      );
    else {
      if (slot.hidden.frameClicks > 0)
        out.push(
          `FRAME-COVERED (the frame in an about:blank slot): the press on the header over the slot went INTO the frame (${slot.hidden.frameClicks} click) — the page draws its header over the slot (M12 J5)`,
        );
      if (!slot.hidden.hostHeard.includes("click #hd"))
        out.push(
          `FRAME-COVERED (the frame in an about:blank slot): the host heard ${slot.hidden.hostHeard.join(", ") || "nothing"} — not the press on its header, drawn over the slot`,
        );
    }
    out.push(
      ...judgeFramePress(
        "FRAME-COVERED (the frame in an about:blank slot, below the header)",
        slot.shown,
      ),
    );
  }
  return out;
}

/** FRAME-MENU (M7 H3): the host's dropdown opened over the frame — its item's press is the host's; the frame hears nothing. */
export function judgeFrameMenu(seen: FramesSeen["menu"]): string[] {
  if (!seen.opened)
    return ["FRAME-MENU: the host's menu never opened over the frame — the row proved nothing"];
  const out: string[] = [];
  if (!seen.hostHeard.includes("click #mi"))
    out.push(
      `FRAME-MENU: the host heard ${seen.hostHeard.join(", ") || "nothing"} — not its menu item's press`,
    );
  if (seen.frameHeard.length > 0)
    out.push(
      `FRAME-MENU: the frame heard ${seen.frameHeard.join(", ")} — the item's press went INTO the frame under the menu`,
    );
  return out;
}

/**
 * FRAME-PICKER: the nested frame's file input — cancelled, nothing chosen. What can see a native panel (M7 H11): its
 * `cancel` never heard (the panel may be up), the app's focused window moved (a native panel takes it), a window more (a
 * BrowserWindow panel — a native NSOpenPanel is none: this alone cannot see one).
 */
export function judgeFramePicker(seen: FramesSeen["picker"]): string[] {
  const out: string[] = [];
  if (seen.cancels === null)
    return ["FRAME-PICKER: the nested frame never said its file input — the row proved nothing"];
  if (seen.cancels < 1)
    out.push(
      "FRAME-PICKER: the nested frame's file input heard no `cancel` — its picker was not intercepted in a frame inside a frame (a panel may be up)",
    );
  if ((seen.changes ?? 0) > 0)
    out.push("FRAME-PICKER: a file was CHOSEN in the nested frame — a real panel answered");
  if (seen.raised !== 0)
    out.push(
      `FRAME-PICKER: the app has ${seen.raised} window${seen.raised === 1 ? "" : "s"} it did not have before — a panel opened`,
    );
  if (seen.focused[1] !== seen.focused[0])
    out.push(
      `FRAME-PICKER: the focused window is ${seen.focused[1] ?? "none"}, not ${seen.focused[0] ?? "none"} as before the press — a panel took the app's focus`,
    );
  return out;
}

/** BACK-WRITTEN: the page's own ‹ back to A is written — the document's url is A again. */
export function judgeBackWritten(seen: FramesSeen["back"]): string[] {
  if (!seen.arrived)
    return [
      "BACK-WRITTEN: the page never arrived where the document sent it — the row proved nothing",
    ];
  return seen.url === seen.a
    ? []
    : [
        `BACK-WRITTEN: after the page's own ‹ the document's url is ${seen.url ?? "nothing"}, not ${seen.a} — a page that went back by itself was never written`,
      ];
}

/** STUCK: said stopped within the host's bound; ↻ brings it back. */
export function judgeStuck(seen: FramesSeen["stuck"]): string[] {
  if (!seen.hung) return ["STUCK: the page never stopped answering — the row proved nothing"];
  const out: string[] = [];
  // (the face's reason leads with the host's word: `unresponsive` — "This page stopped responding" on its film)
  if (seen.saidMs === null || (seen.reason ?? "").split(": ")[0] !== "unresponsive")
    out.push(
      `STUCK: the face never said the page stopped responding (it said ${seen.reason ?? "nothing"}) — the hand's chain stalled behind a command never answered`,
    );
  else if (seen.saidMs > FRAMES_ROWS.hungMs + FRAMES_ROWS.stuckMarginMs)
    out.push(
      `STUCK: it was said ${seen.saidMs} ms after the key — past the host's bound (${FRAMES_ROWS.hungMs} ms) and its margin`,
    );
  if (!seen.reloaded) out.push("STUCK: ↻ did not bring the page back");
  // M7 H11: ↻ and an address typed WHILE the chain was stalled — never on the hand's chain
  if (seen.reloadActed === null && seen.typed === null)
    out.push("STUCK: its legs while stalled (↻, an address typed) never ran — they proved nothing");
  // M12 J11: with nothing in flight they act with or without the let-go — PT-6a (K5): by MAIN's count
  else if (seen.stalled === false)
    out.push(
      "STUCK: its legs while stalled (↻, an address typed) ran with nothing of the hand in flight (main's count) — no command left unanswered: they proved nothing",
    );
  else {
    // M20 F6: EACH leg runs (its hang tried again, bounded) — one that never ran proved nothing: no leg passes by timing
    if (seen.reloadActed === null)
      out.push(
        "STUCK: ↻ while the chain was stalled never ran (the page never hung again) — that leg proved nothing",
      );
    else if (seen.reloadActed === false)
      out.push(
        "STUCK: ↻ pressed while the chain was stalled asked nothing of the page (its address not asked again) — it waited behind the stalled chain",
      );
    if (seen.typed === null)
      out.push(
        "STUCK: an address typed while the chain was stalled never ran (the page never hung again) — that leg proved nothing",
      );
    else if (seen.typed !== undefined) {
      if (!seen.typed.arrived)
        out.push("STUCK: an address typed while the chain was stalled never took the page there");
      else if (!seen.typed.stayed)
        out.push(
          "STUCK: the page at the address typed while stalled was said stopped after — the stalled command of the document before outlived it",
        );
    }
  }
  return out;
}

/** PT-6a (K1): FRAME-BUSY — each leg's keys, typed while the page was busy after the hint on its field, land in order. */
export function judgeFrameBusy(seen: NonNullable<FramesSeen["busy"]>): string[] {
  const out: string[] = [];
  for (const [leg, hint, s] of [
    ["press", "a press", seen.press],
    ["tap", "a tap", seen.tap],
    ...(seen.key === undefined ? [] : [["key", "a key", seen.key] as const]),
  ] as const) {
    if (s === null) {
      out.push(`FRAME-BUSY (${leg}): its field could not be aimed at — the leg proved nothing`);
      continue;
    }
    if ((s.busy?.spins?.length ?? 0) === 0)
      out.push(
        `FRAME-BUSY (${leg}): the page never got busy after ${hint} on its field — the leg proved nothing`,
      );
    else if (s.field !== s.typed)
      out.push(
        `FRAME-BUSY (${leg}): the keys typed while the page was busy after ${hint} on its field landed as "${s.field ?? "nothing"}", not "${s.typed}" in order — refused, or lost`,
      );
    // (run 11: the key's leg is K1's witness — its render held the page's word past the second, its down answered first)
    else if (leg === "key" && s.held !== true)
      out.push(
        "FRAME-BUSY (key): the page's word did not wait behind its render (or was never read) — K1's hold was never reached: the leg proved nothing",
      );
  }
  return out;
}

/** PT-6a (K1, the engine's fact): PRESS-ANSWER says how long a press waited for its page — judged only for having measured. */
/** PT-6a (F1): FRAME-OPENED — what was typed into the opened editor, what its field held, when the text landed and when
 * (if ever) the page was said stopped, both from the typing (ms; null: not within the watch), and how often the page wrote
 * its editor. */
export interface FrameOpenedSeen {
  readonly typed: string;
  readonly value: string | null;
  readonly landedMs: number | null;
  readonly stoppedMs: number | null;
  readonly watchedMs: number;
  readonly opens: number | null;
}

/** PT-6a (M4, M5 — F1): FRAME-OPENED — the text typed into an editor frame that cannot speak lands, and its page is never said
 * stopped for a missing word. */
export function judgeFrameOpened(seen: FrameOpenedSeen | null): string[] {
  if (seen === null)
    return ["FRAME-OPENED: its editor's field could not be aimed at — the row proved nothing"];
  if ((seen.opens ?? 0) < 1)
    return [
      "FRAME-OPENED: the page never wrote its editor frame (open, write, close) — the row proved nothing",
    ];
  const out: string[] = [];
  if (seen.landedMs === null || seen.landedMs > FRAMES_ROWS.openedLandMs)
    out.push(
      `FRAME-OPENED: the keys typed into the opened editor ${seen.landedMs === null ? `had not landed ${seen.watchedMs} ms after the typing (its field holds ${JSON.stringify(seen.value)})` : `landed ${seen.landedMs} ms after the typing`}, not within ${FRAMES_ROWS.openedLandMs} — a document that cannot speak was waited on`,
    );
  if (seen.stoppedMs !== null)
    out.push(
      `FRAME-OPENED: the page was said stopped ${seen.stoppedMs} ms after the typing — a missing word taken for a hang`,
    );
  return out;
}

export function judgePressAnswer(seen: PressAnswerSeen | null): string[] {
  if (seen === null)
    return ["PRESS-ANSWER: the page's button could not be aimed at — the row proved nothing"];
  if (seen.down === null)
    return ["PRESS-ANSWER: the page's own mousedown never ran — the press proved nothing"];
  if (seen.answerMs === null)
    return ["PRESS-ANSWER: main's count was never read — the row proved nothing"];
  return [];
}

/** FRAME-NESTED: a third site's frame in the frame — its button's click where the hand pressed. */
export function judgeFrameNested(seen: FramesSeen["nested"]): string[] {
  return seen.third
    ? judgeFramePress("FRAME-NESTED", seen)
    : [
        "FRAME-NESTED: the nested frame is not of a third site (no IPv6 loopback) — the row proved nothing",
      ];
}

/** FRAME-HALF: the frame half out of the host's view — a press on its part in view lands. */
export function judgeFrameHalf(seen: FramesSeen["half"]): string[] {
  return seen.top === null || seen.top >= 0
    ? [
        `FRAME-HALF: the frame's top stood at ${seen.top ?? "nothing"} — it was not half out of the view: the row proved nothing`,
      ]
    : judgeFramePress("FRAME-HALF", seen);
}

/** A face's row by its key, as these rows read it: its state's words and its cursor. */
const FACE = (key: string): string => `(() => {
  const f = (globalThis.__vfDesk.live()?.faces ?? []).find((x) => x.key === ${JSON.stringify(key)});
  return f === undefined ? null : {
    state: f.state.is, reason: f.state.reason ?? null, address: f.info?.address ?? null,
    loading: f.info?.loading !== undefined, presented: f.presented, cursor: f.info?.cursor ?? null,
  };
})()`;
interface FramesFace {
  readonly state: string;
  readonly reason: string | null;
  readonly address: string | null;
  readonly loading: boolean;
  readonly presented: number;
  readonly cursor: string | null;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const centre = (r: FixtureRect): Point => [r.x + r.w / 2, r.y + r.h / 2];

/** PT-5d's rows (above). Returns the problems, each in words. */
export async function framesRows(d: FramesDriver): Promise<string[]> {
  const { say, win } = d;
  const h: PaneHands = paneHands(d);
  const problems: string[] = [];
  const said: Partial<Record<keyof FramesSeen, unknown>> = {};
  const js = <T>(expression: string): Promise<T> => h.js<T>(expression);
  const before = await h.census();
  const laid = new Set<string>();
  interface Pane {
    readonly key: string;
    readonly address: string;
    readonly path: string;
  }
  type Rect4 = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  const rowsNow = (): Promise<
    { entity: number; key: string | null; rect: Rect4; props: Record<string, unknown> }[]
  > => js(`globalThis.__vfDesk.objects(${JSON.stringify(PANE.type)})`);
  const entityOf = async (p: Pane): Promise<number | null> =>
    (await rowsNow()).find((r) => r.key === p.key)?.entity ?? null;
  const face = (p: Pane): Promise<FramesFace | null> => js<FramesFace | null>(FACE(p.key));
  const waitFor = async <T>(
    label: string,
    ms: number,
    read: () => Promise<T> | T,
    ok: (v: T) => boolean,
    /** PT-6a: a NEGATIVE wait — what it waits for must NOT come: its timing out is the pass (said as held, never UNMET) */
    negative = false,
  ): Promise<T> => {
    const deadline = Date.now() + ms;
    let last = await read();
    while (!ok(last) && Date.now() < deadline) {
      await sleep(80);
      last = await read();
    }
    if (!ok(last))
      say(
        `${negative ? "SMOKE_CANVAS_FRAMES_HELD" : "SMOKE_CANVAS_FRAMES_UNMET"} ${JSON.stringify({ label, last })}`,
      );
    return last;
  };
  const camera = (): Promise<{ x: number; y: number; zoom: number }> =>
    js("globalThis.__vfDesk.camera()");
  const settledCamera = async (): Promise<void> => {
    let last = "";
    for (let i = 0; i < 24; i += 1) {
      const now = JSON.stringify(await camera());
      if (now === last) return;
      last = now;
      await sleep(200);
    }
  };
  const frame = async (panes: readonly Pane[]): Promise<void> => {
    const ids: number[] = [];
    for (const p of panes) {
      const e = await entityOf(p);
      if (e !== null) ids.push(e);
    }
    await js(`globalThis.__vfFieldSmoke.frame(${JSON.stringify(ids.map(String))})`);
    await settledCamera();
    await sleep(400);
  };
  const select = async (p: Pane): Promise<void> => {
    await h.key("Escape");
    await settledCamera();
    const row = (await rowsNow()).find((r) => r.key === p.key);
    if (row === undefined) throw new Error(`the pane at ${p.path} left the board`);
    const c = await camera();
    const off = await h.deskAt();
    await h.press({
      x: off.left + (row.rect.x + row.rect.w / 2 - c.x) * c.zoom,
      y: off.top + (row.rect.y + row.rect.h / 2 - c.y) * c.zoom,
    });
    await h.until("the pane selected", 10_000, "(globalThis.__vfDesk.anchor()?.count ?? 0) === 1");
    await sleep(250);
  };
  const pickUp = async (p: Pane): Promise<void> => {
    await select(p);
    await h.key("Return");
    const e = await entityOf(p);
    await h.until("the pane in hand", 10_000, `globalThis.__vfDesk.held()?.entity === ${e}`);
    await h.until(
      "the pick-up settled",
      10_000,
      "globalThis.__vfDesk.held()?.frame?.settled === true",
    );
    await sleep(300);
  };
  const done = async (): Promise<void> => {
    await h.pressSelector('[data-selection-bar] [data-act="done"]');
    await h.until("the pane put down by Done", 5_000, "globalThis.__vfDesk.held() === null");
    await settledCamera();
  };
  /** the pane in hand: where the desk drew it — and (PT-6a, ruling 3) its own geometry as its kind laid it, what its own
   * `held` presses through (null: nothing held, or not laid yet) */
  const heldFrame = (): Promise<HeldEyeSeen | null> =>
    js<HeldEyeSeen | null>(`(() => {
      const d = globalThis.__vfDesk;
      const h = d.held();
      if (h === null || h.frame === null) return null;
      const l = d.local(${JSON.stringify(PANE.type)})?.layout?.(h.entity);
      if (l === undefined) return null;
      const G = l.G;
      return { ...h.frame, eye: { ex: G.eye.ex, ey: G.eye.ey, h: G.eye.h }, centre: G.centre, axes: [G.ex, G.ey, G.n], page: G.shape.page, ext: [l.ext.cx, l.ext.cy] };
    })()`);
  const pressTool = (tool: string): Promise<void> =>
    h.pressSelector(`[data-selection-bar] [data-face-row="hand"] [data-tool="${tool}"]`);
  const shoot = async (name: string): Promise<void> => {
    if (d.shotDir === undefined) return;
    mkdirSync(d.shotDir, { recursive: true });
    writeFileSync(join(d.shotDir, name), (await win.capturePage()).toPNG());
  };
  /** A pane laid at a world point, pointed at an address; its key once the document names it. */
  const lay = async (
    address: string,
    x: number,
    y: number,
    over: { w?: number; h?: number; props?: Record<string, string> } = {},
  ): Promise<Pane> => {
    const e = Number(
      await js<string>(
        `globalThis.__vfFieldSmoke.spawnWidget(${JSON.stringify(PANE.type)}, { x: ${x}, y: ${y}, w: ${over.w ?? FRAMES_ROWS.laid.w}, h: ${over.h ?? FRAMES_ROWS.laid.h}, props: ${JSON.stringify({ url: address, ...(over.props ?? {}) })} })`,
      ),
    );
    const key = await waitFor(
      `the pane at ${address}: its durable key`,
      10_000,
      async () => (await rowsNow()).find((r) => r.entity === e)?.key ?? null,
      (k) => k !== null,
    );
    if (key === null) throw new Error(`the door gives the pane at ${address} no durable key`);
    laid.add(key);
    return { key, address, path: new URL(address).pathname + new URL(address).search };
  };
  const at = (path: string): FixtureReport | null => d.fixture.reportAt(path);
  const live = async (p: Pane): Promise<void> => {
    await waitFor(
      `the page at ${p.path} live`,
      FRAMES_ROWS.withinMs,
      () => face(p),
      (f) => f !== null && f.state === "live" && f.presented >= 1,
    );
  };
  /** The window point of a host page's point (its client coordinates), the pane in hand — through the part it shows, less
   * that part's offset (PT-6a, K7), and through the pane's own eye (ruling 3) — with `at`, the page's point its WHOLE
   * window point presses (the same eye, back). */
  const onWindow = async (held: HeldEyeSeen, view: VisibleView, x: number, y: number) => {
    const off = await h.deskAt();
    const q = pageThroughEye(held, view.size, off, x - view.offset[0], y - view.offset[1]);
    const w = { x: Math.round(q.x), y: Math.round(q.y) };
    const p = pageOfWindow(held, view.size, off, w.x, w.y);
    return { ...w, at: [p[0] + view.offset[0], p[1] + view.offset[1]] as Point };
  };

  try {
    // ── clear ground: right of everything on the board ──────────────────────────────────────────────────────────────
    const others = await js<Rect4[]>(`(() => {
      const d = globalThis.__vfDesk; const out = [];
      for (const type of Object.keys(d.census())) for (const o of d.objects(type)) out.push(o.rect);
      return out;
    })()`);
    const x0 = Math.max(0, ...others.map((r) => r.x + r.w)) + 900;
    const y0 = others.length === 0 ? 0 : Math.min(...others.map((r) => r.y));
    const step = FRAMES_ROWS.laid.w + FRAMES_ROWS.gap;

    // ── the host page and its frames ───────────────────────────────────────────────────────────────────────────────
    const host = await lay(`${d.fixture.hostOrigin}/frames/host?p=f`, x0, y0);
    await frame([host]);
    await live(host);
    const HOST = "/frames/host?p=f";
    const FRAME = "/frames/frame?p=f";
    const INNER = "/frames/inner?p=f";
    const SAME = "/frames/same?p=f";
    await waitFor(
      "the host's word",
      FRAMES_ROWS.withinMs,
      () => at(HOST),
      (r) => r?.framed?.parts.frame !== undefined,
    );
    await waitFor(
      "the frame's word",
      FRAMES_ROWS.withinMs,
      () => at(FRAME),
      (r) => r?.framed?.parts.b !== undefined,
    );
    await waitFor(
      "the nested frame's word",
      FRAMES_ROWS.withinMs,
      () => at(INNER),
      (r) => r?.framed?.parts.ib !== undefined,
    );
    await waitFor(
      "the frame's own child's word",
      FRAMES_ROWS.withinMs,
      () => at(SAME),
      (r) => r?.framed?.parts.sb !== undefined,
    );
    await pickUp(host);
    // (the frames' places are read off the hand's path: give them a moment once the pane is in hand)
    await sleep(800);
    const held = await heldFrame();
    // (M22 D1: through the page's VISUAL viewport, as the pane shows it)
    const hostWord = at(HOST);
    const view = hostWord === null ? null : visibleView(hostWord);
    /** a frame's own point, on the window — through the host's LATEST box of it (the host scrolls); `at` in the frame's own
     * px (ruling 3) */
    const inFrame = async (x: number, y: number) => {
      const box = at(HOST)?.framed?.parts.frame ?? null;
      if (held === null || box === null || view === null) return null;
      const w = await onWindow(held, view, box.x + x, box.y + y);
      return { ...w, at: [w.at[0] - box.x, w.at[1] - box.y] as Point };
    };
    const framed = () => at(FRAME)?.framed ?? null;
    const hostHeard = () => at(HOST)?.framed?.heard ?? [];
    /** M15 F4: the host wheeled back to its top over its own ground right of the frame (never over the frame: its scroller
     * would take the wheel), until it says it stands at 0 */
    const hostToTop = async (): Promise<void> => {
      if (held === null || view === null) return;
      const ground = await onWindow(
        held,
        view,
        FRAMES_BOX.x + FRAMES_BOX.w + 200,
        view.offset[1] + view.size[1] / 2,
      );
      h.move(ground.x, ground.y);
      await sleep(150);
      for (let i = 0; i < 12; i += 1) {
        win.webContents.sendInputEvent({
          type: "mouseWheel",
          x: ground.x,
          y: ground.y,
          deltaX: 0,
          deltaY: 200,
          canScroll: true,
        });
        await sleep(60);
      }
      await waitFor(
        "the host back at its top",
        5_000,
        () => at(HOST)?.scrollY ?? null,
        (y) => y === 0,
      );
      await sleep(400);
    };

    /** M15 A (M18): the hand's own mapping beside a frame — a press on the host's OWN ground LEFT and RIGHT of the frame's
     * box at the frame point's height (the host's view px), where the host's own listener heard each — PT-6a (ruling 3): each
     * against the point its whole window point presses through the pane's own eye */
    const calibrate = async (
      hostPath: string,
      heldNow: HeldEyeSeen | null,
      hostView: VisibleView | null | undefined,
      box: FixtureRect | null,
      point: Point | null,
    ): Promise<Calibration | null> => {
      if (heldNow === null || hostView == null || box === null || point === null) return null;
      const ground = async (x: number, y: number): Promise<GroundSeen> => {
        const grounds0 = at(hostPath)?.framed?.grounds.length ?? 0;
        const w = await onWindow(heldNow, hostView, x, y);
        await h.press(w);
        const landed = await waitFor(
          "the host's click on its own ground",
          5_000,
          () => at(hostPath)?.framed?.grounds ?? null,
          (g) => (g?.length ?? 0) > grounds0,
        );
        return { aimed: [x, y], pressed: w.at, clicked: landed?.[grounds0] ?? null };
      };
      // (a side out of the page's view is not pressed — FRAME-TOUCH's phone shows 402 of its host's 800)
      const left = box.x - 20 > hostView.offset[0] + 4 ? await ground(box.x - 20, point[1]) : null;
      const right =
        box.x + box.w + 20 < hostView.offset[0] + hostView.size[0] - 4
          ? await ground(box.x + box.w + 20, point[1])
          : null;
      // (M22 A: the press's own window COLUMN — the host's ground below the frame at its x; above it if below is out of
      // the page's view)
      const below = box.y + box.h + 20;
      const column = await ground(
        point[0],
        below < hostView.offset[1] + hostView.size[1] - 4 ? below : box.y - 20,
      );
      return { left, right, column, at: point[0] };
    };

    /** M16-1: each row of the host's frame starts from a KNOWN state — the host at its top — and says where its frame
     * stands before it acts; a frame not where the row aims is "proved nothing" */
    const stood: Record<string, FixtureRect | null> = {};
    said.stood = stood;
    const standFrame = async (row: string): Promise<void> => {
      if ((at(HOST)?.scrollY ?? 0) !== 0) await hostToTop();
      const box = at(HOST)?.framed?.parts.frame ?? null;
      stood[row] = box;
      problems.push(...judgeStood(row, box));
    };

    // ── FRAME-PRESS ──────────────────────────────────────────────────────────────────────────────────────────────────
    await standFrame("FRAME-PRESS");
    const b = framed()?.parts.b ?? null;
    const aimed: Point | null = b === null ? null : centre(b);
    const clicks0 = framed()?.clicks.length ?? 0;
    const heard0 = hostHeard().length;
    let pressed: Point | undefined;
    if (aimed !== null) {
      const w = await inFrame(aimed[0], aimed[1]);
      if (w !== null) {
        pressed = w.at;
        await h.press(w);
      }
    }
    const afterPress = await waitFor(
      "the frame's click",
      5_000,
      () => framed(),
      (f) => (f?.clicks.length ?? 0) > clicks0,
    );
    // (A: the hand's own mapping beside it — the host's ground left and right of the frame, at the button's height)
    const hostBox = at(HOST)?.framed?.parts.frame ?? null;
    const press: FramePressSeen = {
      aimed,
      ...(pressed === undefined ? {} : { pressed }),
      clicked: afterPress?.clicks[clicks0] ?? null,
      hostHeard: hostHeard().slice(heard0),
      calibration: await calibrate(
        HOST,
        held,
        view,
        hostBox,
        aimed === null || hostBox === null ? null : [hostBox.x + aimed[0], hostBox.y + aimed[1]],
      ),
    };
    said.press = press;
    problems.push(...judgeFramePress("FRAME-PRESS", press));
    // … and in the frame's own child of its site (M6.1): through the frame's box of it, its button's own point
    const c = framed()?.parts.c ?? null;
    const sb = at(SAME)?.framed?.parts.sb ?? null;
    const sameAimed: Point | null = c === null || sb === null ? null : centre(sb);
    const sameClicks0 = at(SAME)?.framed?.clicks.length ?? 0;
    const heardSame = hostHeard().length;
    let samePressed: Point | undefined;
    if (c !== null && sameAimed !== null) {
      const w = await inFrame(c.x + sameAimed[0], c.y + sameAimed[1]);
      if (w !== null) {
        samePressed = [w.at[0] - c.x, w.at[1] - c.y];
        await h.press(w);
      }
    }
    const afterSame = await waitFor(
      "the own-site child's click",
      5_000,
      () => at(SAME)?.framed ?? null,
      (f) => (f?.clicks.length ?? 0) > sameClicks0,
    );
    // (A: beside it — the host's ground left and right of the frame, at the child's button's height)
    const same: FramePressSeen = {
      aimed: sameAimed,
      ...(samePressed === undefined ? {} : { pressed: samePressed }),
      clicked: afterSame?.clicks[sameClicks0] ?? null,
      hostHeard: hostHeard().slice(heardSame),
      calibration: await calibrate(
        HOST,
        held,
        view,
        hostBox,
        c === null || sameAimed === null || hostBox === null
          ? null
          : [hostBox.x + c.x + sameAimed[0], hostBox.y + c.y + sameAimed[1]],
      ),
    };
    said.same = same;
    problems.push(...judgeFramePress("FRAME-PRESS (its own site's frame in it)", same));
    await shoot("pt-5d-frame-press.png");

    // ── FRAME-HOVER ──────────────────────────────────────────────────────────────────────────────────────────────────
    await standFrame("FRAME-HOVER");
    const l = framed()?.parts.l ?? null;
    let over: string | null = null;
    let off: string | null = null;
    let left: boolean | null = null;
    if (l !== null) {
      const w = await inFrame(l.x + l.w / 2, l.y + l.h / 2);
      if (w !== null) h.move(w.x, w.y);
      over =
        (
          await waitFor(
            "the link's cursor",
            5_000,
            () => face(host),
            (f) => f?.cursor === "pointer",
          )
        )?.cursor ?? null;
      // (M7 H15: OUT of the frame — onto the host's ground beside it: a real leave)
      const heard0 = framed()?.heard.length ?? 0;
      const beside = await inFrame(-60, l.y + l.h / 2);
      if (beside !== null) h.move(beside.x, beside.y);
      off =
        (
          await waitFor(
            "the host's own cursor",
            5_000,
            () => face(host),
            (f) => f?.cursor !== "pointer",
          )
        )?.cursor ?? null;
      const leftWord = await waitFor(
        "the frame's link left",
        5_000,
        () => framed()?.heard ?? null,
        (heard) => heard?.slice(heard0).includes("mouseout #l") === true,
      );
      left = leftWord === null ? null : leftWord.slice(heard0).includes("mouseout #l");
    }
    said.hover = { over, off, left };
    problems.push(...judgeFrameHover({ over, off, left }));

    // ── FRAME-DOUBLE ─────────────────────────────────────────────────────────────────────────────────────────────────
    await standFrame("FRAME-DOUBLE");
    const word = framed()?.parts.w ?? null;
    if (word !== null) {
      const w = await inFrame(word.x + 20, word.y + word.h / 2);
      // (M15 F2: a double-click is TWO presses — the second with its count of 2, as USE's DOUBLE)
      if (w !== null) {
        await h.press(w, 1);
        await h.press(w, 2);
      }
    }
    const sel =
      (
        await waitFor(
          "the frame's word selected",
          5_000,
          () => at(FRAME),
          (r) => r?.sel.trim() === FRAMES_WORD,
        )
      )?.sel ?? null;
    said.double = { sel };
    problems.push(...judgeFrameDouble({ sel }));

    // ── FRAME-DRAG: the thumb from its left, released OUTSIDE the frame; then a hover over it ──────────────────────
    await standFrame("FRAME-DRAG");
    const r = framed()?.parts.r ?? null;
    const rangeBefore = framed()?.range ?? null;
    const movesHeld0 = framed()?.movesHeld ?? null;
    let buttonsAfter: number | null = null;
    if (r !== null) {
      const from = await inFrame(r.x + r.w * 0.1, r.y + r.h / 2);
      // (M15 F3: released RIGHT of the frame, on the host's ground past its right edge — a drag that works ends at the
      // top whether or not a move outside the frame reaches it; before: released left of it, where a drag that works
      // ends at 0 and its judge wants a rise)
      const to = await inFrame(FRAMES_BOX.w + 40, r.y + r.h / 2);
      const through = await inFrame(r.x + r.w * 0.9, r.y + r.h / 2);
      if (from !== null && to !== null && through !== null) {
        h.move(from.x, from.y);
        await sleep(40);
        win.webContents.sendInputEvent({
          type: "mouseDown",
          x: from.x,
          y: from.y,
          button: "left",
          clickCount: 1,
        });
        await sleep(60);
        for (const [i, at2] of [through, to].entries())
          for (let k = 1; k <= 6; k += 1) {
            const prev = i === 0 ? from : through;
            win.webContents.sendInputEvent({
              type: "mouseMove",
              x: Math.round(prev.x + ((at2.x - prev.x) * k) / 6),
              y: Math.round(prev.y + ((at2.y - prev.y) * k) / 6),
              modifiers: ["leftbuttondown"],
            });
            await sleep(30);
          }
        // released OUTSIDE the frame (past its right edge, over the host)
        win.webContents.sendInputEvent({
          type: "mouseUp",
          x: to.x,
          y: to.y,
          button: "left",
          clickCount: 1,
        });
        await sleep(200);
        const hover = await inFrame(r.x + r.w * 0.5, r.y + r.h + 40);
        if (hover !== null) {
          h.move(hover.x, hover.y);
          await sleep(80);
          h.move(hover.x + 6, hover.y + 2);
        }
        buttonsAfter =
          (
            await waitFor(
              "a move over the frame after the release",
              3_000,
              () => framed(),
              (f) => f?.moveButtons === 0,
            )
          )?.moveButtons ?? null;
      }
    }
    const movesHeld1 = framed()?.movesHeld ?? null;
    const frameRangeAfter = framed()?.range ?? null;
    // (M18 B: the host's OWN range dragged — a drag on the page's own session, the defect every page had: a move carried
    // `button: "none"`)
    const hostRange0 = at(HOST)?.framed?.range ?? null;
    const hr = at(HOST)?.framed?.parts.r ?? null;
    if (hr !== null && held !== null && view !== null)
      await h.drag(
        await onWindow(held, view, hr.x + hr.w * 0.1, hr.y + hr.h / 2),
        await onWindow(held, view, hr.x + hr.w * 0.9, hr.y + hr.h / 2),
        8,
      );
    // (PT-6a K7: its value AFTER the release — two more of the host's asks once the drag is over; the first report past
    // +10 could be one taken mid-drag)
    const dragAsked = d.fixture.reports(HOST);
    await waitFor(
      "two of the host's asks after the drag",
      3_000,
      () => d.fixture.reports(HOST),
      (n) => n >= dragAsked + 2,
    );
    const hostRange1 = at(HOST)?.framed?.range ?? null;
    const drag = {
      before: rangeBefore,
      after: frameRangeAfter,
      buttonsAfter,
      movesHeld: movesHeld0 === null || movesHeld1 === null ? null : movesHeld1 - movesHeld0,
      host: { before: hostRange0, after: hostRange1 },
    };
    said.drag = drag;
    problems.push(...judgeFrameDrag(drag));

    // ── FRAME-WHEEL: over the scroller, then past its end ──────────────────────────────────────────────────────────
    await standFrame("FRAME-WHEEL");
    const s = framed()?.parts.s ?? null;
    const scroll0 = framed()?.scroller ?? null;
    const host0 = at(HOST)?.scrollY ?? null;
    let wheelLeg: FramesSeen["wheel"]["leg"] = null;
    if (s !== null) {
      const w = await inFrame(s.x + s.w / 2, s.y + s.h / 2);
      if (w !== null) {
        h.move(w.x, w.y);
        await sleep(150);
        const base = d.custody()?.handInFlight ?? null;
        const first = Date.now();
        for (let i = 0; i < FRAMES_ROWS.wheels; i += 1) {
          win.webContents.sendInputEvent({
            type: "mouseWheel",
            x: w.x,
            y: w.y,
            deltaX: 0,
            deltaY: -120,
            canScroll: true,
          });
          await sleep(FRAMES_ROWS.wheelApartMs);
        }
        const sentMs = Date.now() - first;
        // PT-6a (M1): the chain drained — main's count back where it began three looks running, once the desk has handed
        // on the last wheel (at its next frame)
        await sleep(100);
        let drainedMs: number | null = null;
        let quietSince = 0;
        let quietLooks = 0;
        while (
          base !== null &&
          drainedMs === null &&
          Date.now() - first < FRAMES_ROWS.drainWithinMs
        ) {
          const n = d.custody()?.handInFlight ?? null;
          if (n === null) break;
          if (n > base) quietLooks = 0;
          else if (quietLooks++ === 0) quietSince = Date.now();
          if (quietLooks === 3) drainedMs = quietSince - first;
          await sleep(FRAMES_ROWS.answerLookMs);
        }
        wheelLeg = { sentMs, drainedMs };
      }
    }
    await sleep(800);
    const wheel = {
      scroller: [scroll0, framed()?.scroller ?? null] as const,
      host: [host0, at(HOST)?.scrollY ?? null] as const,
      leg: wheelLeg,
    };
    said.wheel = wheel;
    problems.push(...judgeFrameWheel(wheel));
    // (M15 F4: the chain leg left the host at its END — every row after it aimed at a frame out of view: it is wheeled
    // back to its top over its OWN ground, right of the frame, never over it — its scroller would take the wheel)
    await hostToTop();

    // ── FRAME-TYPE (M15, a stated limit): the field pressed — the typing, the IME and ⌘A each REFUSED ─────────────────
    await standFrame("FRAME-TYPE");
    const t = framed()?.parts.t ?? null;
    const typeHeard0 = hostHeard().length;
    const frameHeard0 = framed()?.heard.length ?? 0;
    let focused = false;
    const refused: { typed: number | null; composed: number | null; selectAll: number | null } = {
      typed: null,
      composed: null,
      selectAll: null,
    };
    /** main's count of the key-like events refused while a frame of another site held the focus (null: unread) */
    const refusedNow = (): number | null => d.custody()?.frameKeysRefused ?? null;
    /** how far main's count rose over a leg — waited for until it rose by the leg's least */
    const refusedOver = async (
      leg: keyof typeof FRAMES_ROWS.refusedAtLeast,
      act: () => Promise<void>,
    ): Promise<void> => {
      const before = refusedNow();
      await act();
      const least = FRAMES_ROWS.refusedAtLeast[leg];
      const after = await waitFor(
        `main's refusals of the ${leg} leg`,
        5_000,
        refusedNow,
        (n) => before !== null && n !== null && n >= before + least,
      );
      refused[leg] = before === null || after === null ? null : after - before;
    };
    if (t !== null) {
      const w = await inFrame(t.x + t.w / 2, t.y + t.h / 2);
      if (w !== null) await h.press(w);
      focused =
        (
          await waitFor(
            "the frame's field focused",
            5_000,
            () => at(FRAME),
            (rep) => rep?.focused === "t",
          )
        )?.focused === "t";
      await refusedOver("typed", async () => {
        for (const ch of FRAMES_ROWS.typed) {
          win.webContents.sendInputEvent({ type: "keyDown", keyCode: ch });
          win.webContents.sendInputEvent({ type: "char", keyCode: ch });
          win.webContents.sendInputEvent({ type: "keyUp", keyCode: ch });
          await sleep(30);
        }
      });
      await refusedOver("composed", async () => {
        await d.compose(FRAMES_ROWS.composing, FRAMES_ROWS.composing.length);
        await sleep(300);
        await d.commit(FRAMES_ROWS.composed);
      });
      await refusedOver("selectAll", () =>
        h.key("a", [process.platform === "darwin" ? "meta" : "control"]),
      );
    }
    // (M12 J11, M15: each page's word taken AFTER the last key — two more of its asks: the first may have been said
    // before it)
    const hostAsked = d.fixture.reports(HOST);
    const frameAsked = d.fixture.reports(FRAME);
    await waitFor(
      "the pages' words after the typing",
      5_000,
      () => [d.fixture.reports(HOST), d.fixture.reports(FRAME)] as const,
      ([host, frame]) => host >= hostAsked + 2 && frame >= frameAsked + 2,
    );
    const type: FramesSeen["type"] = {
      focused,
      refused,
      field: at(FRAME)?.field ?? null,
      hostHeard: hostHeard().slice(typeHeard0),
      frameHeard: (framed()?.heard ?? []).slice(frameHeard0),
      hostAsks: d.fixture.reports(HOST) - hostAsked,
      frameAsks: d.fixture.reports(FRAME) - frameAsked,
    };
    said.type = type;
    problems.push(...judgeFrameType(type));

    // ── FRAME-NESTED: the button of the frame in the frame ──────────────────────────────────────────────────────────
    await standFrame("FRAME-NESTED");
    const n = framed()?.parts.n ?? null;
    const ib = at(INNER)?.framed?.parts.ib ?? null;
    const innerAimed: Point | null = ib === null ? null : centre(ib);
    const innerClicks0 = at(INNER)?.framed?.clicks.length ?? 0;
    const heard1 = hostHeard().length;
    let innerPressed: Point | undefined;
    if (n !== null && innerAimed !== null) {
      const w = await inFrame(n.x + innerAimed[0], n.y + innerAimed[1]);
      if (w !== null) {
        innerPressed = [w.at[0] - n.x, w.at[1] - n.y];
        await h.press(w);
      }
    }
    const innerAfter = await waitFor(
      "the nested frame's click",
      5_000,
      () => at(INNER)?.framed ?? null,
      (f) => (f?.clicks.length ?? 0) > innerClicks0,
    );
    const nested = {
      aimed: innerAimed,
      ...(innerPressed === undefined ? {} : { pressed: innerPressed }),
      clicked: innerAfter?.clicks[innerClicks0] ?? null,
      hostHeard: hostHeard().slice(heard1),
      third: d.fixture.innerOrigin !== d.fixture.hostOrigin,
    };
    said.nested = nested;
    problems.push(...judgeFrameNested(nested));

    // ── FRAME-PICKER: the nested frame's file input ─────────────────────────────────────────────────────────────────
    await standFrame("FRAME-PICKER");
    const fileInput = at(INNER)?.framed?.parts.if ?? null;
    const windows0 = d.windows();
    const cancels0 = at(INNER)?.framed?.cancels ?? null;
    if (n !== null && fileInput !== null) {
      const w = await inFrame(
        n.x + fileInput.x + fileInput.w / 2,
        n.y + fileInput.y + fileInput.h / 2,
      );
      if (w !== null) await h.press(w);
    }
    const pickerSaid = await waitFor(
      "the nested frame's file input cancelled",
      5_000,
      () => at(INNER)?.framed ?? null,
      (f) => (f?.cancels ?? 0) > (cancels0 ?? 0),
    );
    const windows1 = d.windows();
    const picker = {
      cancels: pickerSaid === null || cancels0 === null ? null : pickerSaid.cancels - cancels0,
      changes: pickerSaid?.changes ?? null,
      raised: windows1.ids.filter((id) => !windows0.ids.includes(id)).length,
      focused: [windows0.focused, windows1.focused] as const,
    };
    said.picker = picker;
    problems.push(...judgeFramePicker(picker));
    await shoot("pt-5d-frame-nested.png");

    // ── FRAME-HALF: the host scrolled until the frame is half out of its view; a press on its low part, in view ───────
    // (the host's page wheeled outside its frame: below it. M15 C: a wheel's travel is the WINDOW's — the page scrolls by
    // it over the pane's scale (USE's WHEEL): each wheel the page's share × that scale; before, the page's px as the
    // window's — the host scrolled 530 for 330, the frame's low part out of view)
    const below = await inFrame(FRAMES_BOX.w / 2, FRAMES_BOX.h + 60);
    const paneScale = held === null || view === null ? 1 : (2 * held.hx) / view.size[0];
    if (below !== null) {
      h.move(below.x, below.y);
      await sleep(150);
      for (let i = 0; i < 4; i += 1) {
        win.webContents.sendInputEvent({
          type: "mouseWheel",
          x: below.x,
          y: below.y,
          deltaX: 0,
          deltaY: (-(FRAMES_BOX.y + FRAMES_BOX.h / 2) / 4) * paneScale,
          canScroll: true,
        });
        await sleep(60);
      }
    }
    const halfWord = await waitFor(
      "the frame half out of the host's view",
      5_000,
      () => at(HOST),
      (rep) => (rep?.framed?.parts.frame?.y ?? 0) < 0,
    );
    await sleep(500);
    const top = halfWord?.framed?.parts.frame?.y ?? null;
    const bl = framed()?.parts.bl ?? null;
    const halfClicks0 = framed()?.clicks.length ?? 0;
    const heard2 = hostHeard().length;
    let halfAimed: Point | null = null;
    let halfPressed: Point | undefined;
    if (bl !== null && top !== null && top + centre(bl)[1] > 0) {
      halfAimed = centre(bl);
      const w = await inFrame(halfAimed[0], halfAimed[1]);
      if (w !== null) {
        halfPressed = w.at;
        await h.press(w);
      }
    }
    const halfLanded = await waitFor(
      "the half frame's click",
      5_000,
      () => framed(),
      (f) => (f?.clicks.length ?? 0) > halfClicks0,
    );
    // (A: the hand's own mapping beside it, the host as it stands scrolled)
    const halfBox = at(HOST)?.framed?.parts.frame ?? null;
    const half = {
      aimed: halfAimed,
      ...(halfPressed === undefined ? {} : { pressed: halfPressed }),
      clicked: halfLanded?.clicks[halfClicks0] ?? null,
      hostHeard: hostHeard().slice(heard2),
      top,
      calibration: await calibrate(
        HOST,
        held,
        view,
        halfBox,
        halfAimed === null || halfBox === null
          ? null
          : [halfBox.x + halfAimed[0], halfBox.y + halfAimed[1]],
      ),
    };
    said.half = half;
    problems.push(...judgeFrameHalf(half));
    await shoot("pt-5d-frame-half.png");
    // (the host back at its top: wheeled up below its frame)
    const back0 = await inFrame(FRAMES_BOX.w / 2, FRAMES_BOX.h + 60);
    if (back0 !== null)
      for (let i = 0; i < 6; i += 1) {
        win.webContents.sendInputEvent({
          type: "mouseWheel",
          x: back0.x,
          y: back0.y,
          deltaX: 0,
          deltaY: 200,
          canScroll: true,
        });
        await sleep(60);
      }
    // (M15 F4: … until the host says it stands at its top)
    await waitFor(
      "the host back at its top",
      5_000,
      () => at(HOST)?.scrollY ?? null,
      (y) => y === 0,
    );
    await sleep(600);

    // ── FRAME-GONE: a press held in the frame; the frame sent elsewhere under it; released; the next press ─────────────
    await standFrame("FRAME-GONE");
    let went = false;
    let nextClicks = 0;
    let goneMs: number | null = null;
    const b2Path = "/frames/next?p=f";
    if (b !== null) {
      const w = await inFrame(centre(b)[0], centre(b)[1]);
      if (w !== null) {
        h.move(w.x, w.y);
        await sleep(40);
        win.webContents.sendInputEvent({
          type: "mouseDown",
          x: w.x,
          y: w.y,
          button: "left",
          clickCount: 1,
        });
        await sleep(100);
        d.fixture.goFrame(FRAME, b2Path);
        went =
          (await waitFor(
            "the frame gone elsewhere",
            10_000,
            () => at(b2Path),
            (rep) => rep !== null,
          )) !== null;
        win.webContents.sendInputEvent({
          type: "mouseUp",
          x: w.x,
          y: w.y,
          button: "left",
          clickCount: 1,
        });
        await sleep(300);
        const b2 = at(b2Path)?.framed?.parts.b2 ?? null;
        if (b2 !== null) {
          const w2 = await inFrame(centre(b2)[0], centre(b2)[1]);
          if (w2 !== null) {
            const sent = Date.now();
            await h.press(w2);
            const landed = await waitFor(
              "the next press in the frame's new document",
              FRAMES_ROWS.goneMs * 2,
              () => at(b2Path)?.framed ?? null,
              (f) => (f?.clicks.length ?? 0) >= 1,
            );
            nextClicks = landed?.clicks.length ?? 0;
            goneMs = nextClicks > 0 ? Date.now() - sent : null;
          }
        }
      }
    }
    // M7 H11: … and to ANOTHER SITE under a held press — its session swapped: the release goes nowhere, nothing stalls
    let swap: FramesSeen["gone"]["swap"] = null;
    const heldB2 = at(b2Path)?.framed?.parts.b2 ?? null;
    if (heldB2 !== null) {
      const w = await inFrame(centre(heldB2)[0], centre(heldB2)[1]);
      if (w !== null) {
        const swapPath = "/frames/next?p=fx";
        h.move(w.x, w.y);
        await sleep(40);
        win.webContents.sendInputEvent({
          type: "mouseDown",
          x: w.x,
          y: w.y,
          button: "left",
          clickCount: 1,
        });
        await sleep(100);
        d.fixture.goFrame(b2Path, `${d.fixture.innerOrigin}${swapPath}`);
        const swapped =
          (await waitFor(
            "the frame gone to another site",
            10_000,
            () => at(swapPath),
            (rep) => rep !== null,
          )) !== null;
        win.webContents.sendInputEvent({
          type: "mouseUp",
          x: w.x,
          y: w.y,
          button: "left",
          clickCount: 1,
        });
        await sleep(300);
        let swapClicks = 0;
        let swapMs: number | null = null;
        const sb2 = at(swapPath)?.framed?.parts.b2 ?? null;
        if (sb2 !== null) {
          const w2 = await inFrame(centre(sb2)[0], centre(sb2)[1]);
          if (w2 !== null) {
            const sent = Date.now();
            await h.press(w2);
            const landed = await waitFor(
              "the next press in its new site's document",
              FRAMES_ROWS.goneMs * 2,
              () => at(swapPath)?.framed ?? null,
              (f) => (f?.clicks.length ?? 0) >= 1,
            );
            swapClicks = landed?.clicks.length ?? 0;
            swapMs = swapClicks > 0 ? Date.now() - sent : null;
          }
        }
        swap = { went: swapped, nextClicks: swapClicks, ms: swapMs };
      }
    }
    const gone = { went, nextClicks, ms: goneMs, swap };
    said.gone = gone;
    problems.push(...judgeFrameGone(gone));

    await done();

    // ── FRAME-CLIPPED (M6.3a): the frame in a scroller, its top half clipped under the host's header ───────────────────
    const clippedPane = await lay(`${d.fixture.hostOrigin}/frames/clipped?p=c`, x0 + 4 * step, y0);
    await frame([clippedPane]);
    await live(clippedPane);
    const CLIPPED_HOST = "/frames/clipped?p=c";
    const CLIPPED_FRAME = "/frames/frame?p=c";
    await waitFor(
      "the clipped host's word",
      FRAMES_ROWS.withinMs,
      () => at(CLIPPED_HOST),
      (rep) => rep?.framed?.parts.frame !== undefined && rep?.framed?.parts.sc !== undefined,
    );
    await waitFor(
      "the clipped frame's word",
      FRAMES_ROWS.withinMs,
      () => at(CLIPPED_FRAME),
      (rep) => rep?.framed?.parts.b !== undefined,
    );
    await pickUp(clippedPane);
    await sleep(800);
    const clippedHeld = await heldFrame();
    const clippedHost = at(CLIPPED_HOST);
    const cBox = clippedHost?.framed?.parts.frame ?? null;
    const cFramed = () => at(CLIPPED_FRAME)?.framed ?? null;
    const cHostHeard = () => at(CLIPPED_HOST)?.framed?.heard ?? [];
    const inClipped = async (x: number, y: number) =>
      clippedHeld === null || clippedHost === null || cBox === null
        ? null
        : onWindow(clippedHeld, visibleView(clippedHost), cBox.x + x, cBox.y + y);
    // its button, in its clipped half — under the header: the host's
    const cb = cFramed()?.parts.b ?? null;
    let hidden: FramesSeen["clipped"]["hidden"] = null;
    if (cb !== null) {
      const hiddenClicks0 = cFramed()?.clicks.length ?? 0;
      const hiddenHeard0 = cHostHeard().length;
      const w = await inClipped(centre(cb)[0], centre(cb)[1]);
      if (w !== null) {
        await h.press(w);
        const heard = await waitFor(
          "the header's click",
          5_000,
          () => cHostHeard().slice(hiddenHeard0),
          (got) => got.includes("click #hd"),
        );
        // (a click in the frame, had it gone there, says so in its next ask)
        await sleep(600);
        hidden = { hostHeard: heard, frameClicks: (cFramed()?.clicks.length ?? 0) - hiddenClicks0 };
      }
    }
    // its low button, in view: the frame's
    const cbl = cFramed()?.parts.bl ?? null;
    const shownAimed: Point | null = cbl === null ? null : centre(cbl);
    const shownClicks0 = cFramed()?.clicks.length ?? 0;
    const shownHeard0 = cHostHeard().length;
    let shownPressed: Point | undefined;
    if (shownAimed !== null && cBox !== null) {
      const w = await inClipped(shownAimed[0], shownAimed[1]);
      if (w !== null) {
        shownPressed = [w.at[0] - cBox.x, w.at[1] - cBox.y];
        await h.press(w);
      }
    }
    const shownSaid = await waitFor(
      "the clipped frame's click in view",
      5_000,
      () => cFramed(),
      (f) => (f?.clicks.length ?? 0) > shownClicks0,
    );
    const clipped = {
      top: cBox?.y ?? null,
      edge: clippedHost?.framed?.parts.sc?.y ?? null,
      hidden,
      shown: {
        aimed: shownAimed,
        ...(shownPressed === undefined ? {} : { pressed: shownPressed }),
        clicked: shownSaid?.clicks[shownClicks0] ?? null,
        hostHeard: cHostHeard().slice(shownHeard0),
        // (A: the hand's own mapping beside it — CLIPPED's right side lands in its scroller, its own ground)
        calibration: await calibrate(
          CLIPPED_HOST,
          clippedHeld,
          clippedHost === null ? null : visibleView(clippedHost),
          cBox,
          shownAimed === null || cBox === null
            ? null
            : [cBox.x + shownAimed[0], cBox.y + shownAimed[1]],
        ),
      },
    };
    said.clipped = clipped;
    problems.push(...judgeFrameClipped(clipped));
    await shoot("pt-5d-frame-clipped.png");
    await done();

    // ── FRAME-COVERED, FRAME-MENU (M7 H3): a fixed header over the frame's top; a dropdown opened over it ──────────────
    const coveredPane = await lay(`${d.fixture.hostOrigin}/frames/covered?p=v`, x0 + 5 * step, y0);
    await frame([coveredPane]);
    await live(coveredPane);
    const COVERED_HOST = "/frames/covered?p=v";
    const COVERED_FRAME = "/frames/frame?p=v";
    await waitFor(
      "the covered host's word",
      FRAMES_ROWS.withinMs,
      () => at(COVERED_HOST),
      (rep) => rep?.framed?.parts.frame !== undefined && rep?.framed?.parts.hd !== undefined,
    );
    await waitFor(
      "the covered frame's word",
      FRAMES_ROWS.withinMs,
      () => at(COVERED_FRAME),
      (rep) => rep?.framed?.parts.b !== undefined,
    );
    await pickUp(coveredPane);
    await sleep(800);
    const coveredHeld = await heldFrame();
    const coveredHost = at(COVERED_HOST);
    const vBox = coveredHost?.framed?.parts.frame ?? null;
    const vFramed = () => at(COVERED_FRAME)?.framed ?? null;
    const vHostHeard = () => at(COVERED_HOST)?.framed?.heard ?? [];
    const onCovered = async (x: number, y: number) =>
      coveredHeld === null || coveredHost === null
        ? null
        : onWindow(coveredHeld, visibleView(coveredHost), x, y);
    // the frame's button, under the header: the host's
    const vb = vFramed()?.parts.b ?? null;
    let coveredHidden: FramesSeen["covered"]["hidden"] = null;
    if (vb !== null && vBox !== null) {
      const clicks0 = vFramed()?.clicks.length ?? 0;
      const heard0 = vHostHeard().length;
      const w = await onCovered(vBox.x + centre(vb)[0], vBox.y + centre(vb)[1]);
      if (w !== null) {
        await h.press(w);
        const heard = await waitFor(
          "the header's click",
          5_000,
          () => vHostHeard().slice(heard0),
          (got) => got.includes("click #hd"),
        );
        await sleep(600);
        coveredHidden = {
          hostHeard: heard,
          frameClicks: (vFramed()?.clicks.length ?? 0) - clicks0,
        };
      }
    }
    // its low button, below the header: the frame's
    const vbl = vFramed()?.parts.bl ?? null;
    const coveredAimed: Point | null = vbl === null ? null : centre(vbl);
    const coveredClicks0 = vFramed()?.clicks.length ?? 0;
    const coveredHeard0 = vHostHeard().length;
    let coveredPressed: Point | undefined;
    if (coveredAimed !== null && vBox !== null) {
      const w = await onCovered(vBox.x + coveredAimed[0], vBox.y + coveredAimed[1]);
      if (w !== null) {
        coveredPressed = [w.at[0] - vBox.x, w.at[1] - vBox.y];
        await h.press(w);
      }
    }
    const coveredShown = await waitFor(
      "the covered frame's click below the header",
      5_000,
      () => vFramed(),
      (f) => (f?.clicks.length ?? 0) > coveredClicks0,
    );
    const coveredSeen = {
      top: vBox?.y ?? null,
      edge: (() => {
        const hd = coveredHost?.framed?.parts.hd ?? null;
        return hd === null ? null : hd.y + hd.h;
      })(),
      hidden: coveredHidden,
      shown: {
        aimed: coveredAimed,
        ...(coveredPressed === undefined ? {} : { pressed: coveredPressed }),
        clicked: coveredShown?.clicks[coveredClicks0] ?? null,
        hostHeard: vHostHeard().slice(coveredHeard0),
        // (A: the hand's own mapping beside it)
        calibration: await calibrate(
          COVERED_HOST,
          coveredHeld,
          coveredHost === null ? null : visibleView(coveredHost),
          vBox,
          coveredAimed === null || vBox === null
            ? null
            : [vBox.x + coveredAimed[0], vBox.y + coveredAimed[1]],
        ),
      },
    };
    // FRAME-MENU: the host's menu opened over the frame; its item pressed
    const mb = at(COVERED_HOST)?.framed?.parts.mb ?? null;
    let opened = false;
    let menuHostHeard: readonly string[] = [];
    let menuFrameHeard: readonly string[] = [];
    if (mb !== null) {
      const w = await onCovered(centre(mb)[0], centre(mb)[1]);
      if (w !== null) await h.press(w);
      const open = await waitFor(
        "the host's menu open",
        5_000,
        () => at(COVERED_HOST)?.framed?.parts.mn ?? null,
        (mn) => mn !== null && mn.w > 0,
      );
      opened = open !== null && open.w > 0;
      // (its look sees the menu over its frame — a mutation: the next frame — and the sight is read again)
      await sleep(800);
      const mi = at(COVERED_HOST)?.framed?.parts.mi ?? null;
      if (opened && mi !== null) {
        const heard0 = vHostHeard().length;
        const frameHeard0 = vFramed()?.heard.length ?? 0;
        const wi = await onCovered(centre(mi)[0], centre(mi)[1]);
        if (wi !== null) await h.press(wi);
        menuHostHeard = await waitFor(
          "the menu item's click",
          5_000,
          () => vHostHeard().slice(heard0),
          (got) => got.includes("click #mi"),
        );
        await sleep(600);
        menuFrameHeard = (vFramed()?.heard ?? []).slice(frameHeard0);
      }
    }
    const menu = { opened, hostHeard: menuHostHeard, frameHeard: menuFrameHeard };
    said.menu = menu;
    problems.push(...judgeFrameMenu(menu));
    await shoot("pt-5d-frame-covered.png");
    await done();

    // ── FRAME-COVERED's sly leg (M8): the page hides its header from a read in its own world ─────────────────────────
    const slyPane = await lay(
      `${d.fixture.hostOrigin}/frames/covered?p=s&sly=1`,
      x0 + 6 * step,
      y0,
    );
    await frame([slyPane]);
    await live(slyPane);
    const SLY_HOST = "/frames/covered?p=s&sly=1";
    const SLY_FRAME = "/frames/frame?p=s";
    await waitFor(
      "the sly host's word",
      FRAMES_ROWS.withinMs,
      () => at(SLY_HOST),
      (rep) => rep?.framed?.parts.frame !== undefined,
    );
    await waitFor(
      "the sly host's frame's word",
      FRAMES_ROWS.withinMs,
      () => at(SLY_FRAME),
      (rep) => rep?.framed?.parts.b !== undefined,
    );
    await pickUp(slyPane);
    await sleep(800);
    const slyHeld = await heldFrame();
    const slyHost = at(SLY_HOST);
    const sBox = slyHost?.framed?.parts.frame ?? null;
    const slyB = at(SLY_FRAME)?.framed?.parts.b ?? null;
    let sly: FramesSeen["covered"]["sly"] = null;
    if (slyHeld !== null && slyHost !== null && sBox !== null && slyB !== null) {
      const clicks0 = at(SLY_FRAME)?.framed?.clicks.length ?? 0;
      const heard0 = at(SLY_HOST)?.framed?.heard.length ?? 0;
      await h.press(
        await onWindow(
          slyHeld,
          visibleView(slyHost),
          sBox.x + centre(slyB)[0],
          sBox.y + centre(slyB)[1],
        ),
      );
      const heard = await waitFor(
        "the sly header's click",
        5_000,
        () => (at(SLY_HOST)?.framed?.heard ?? []).slice(heard0),
        (got) => got.includes("click #hd"),
      );
      await sleep(600);
      sly = {
        hostHeard: heard,
        frameClicks: (at(SLY_FRAME)?.framed?.clicks.length ?? 0) - clicks0,
      };
    }
    await done();

    // ── FRAME-COVERED's slot leg (M12 J5): the frame in an about:blank SLOT of the host (a frame of the host's own
    // process), the host's header drawn over the slot ───────────────────────────────────────────────────────────────
    const slotPane = await lay(
      `${d.fixture.hostOrigin}/frames/covered?p=o&slot=1`,
      x0 + 9 * step,
      y0,
    );
    await frame([slotPane]);
    await live(slotPane);
    const SLOT_HOST = "/frames/covered?p=o&slot=1";
    const SLOT_FRAME = "/frames/frame?p=o";
    await waitFor(
      "the slot host's word",
      FRAMES_ROWS.withinMs,
      () => at(SLOT_HOST),
      (rep) => rep?.framed?.parts.frame !== undefined && rep?.framed?.parts.hd !== undefined,
    );
    await waitFor(
      "the slot's frame's word",
      FRAMES_ROWS.withinMs,
      () => at(SLOT_FRAME),
      (rep) => rep?.framed?.parts.b !== undefined,
    );
    await pickUp(slotPane);
    await sleep(800);
    const slotHeld = await heldFrame();
    const slotHost = at(SLOT_HOST);
    // (the frame stands at the slot's own 0, 0: the slot's box is the frame's)
    const oBox = slotHost?.framed?.parts.frame ?? null;
    const oFramed = () => at(SLOT_FRAME)?.framed ?? null;
    const oHostHeard = () => at(SLOT_HOST)?.framed?.heard ?? [];
    let slot: FramesSeen["covered"]["slot"] = null;
    if (slotHeld !== null && slotHost !== null && oBox !== null) {
      // the frame's button, under the header drawn over the slot: the host's
      const ob = oFramed()?.parts.b ?? null;
      let hidden: NonNullable<FramesSeen["covered"]["slot"]>["hidden"] = null;
      if (ob !== null) {
        const clicks0 = oFramed()?.clicks.length ?? 0;
        const heard0 = oHostHeard().length;
        await h.press(
          await onWindow(
            slotHeld,
            visibleView(slotHost),
            oBox.x + centre(ob)[0],
            oBox.y + centre(ob)[1],
          ),
        );
        const heard = await waitFor(
          "the header's click over the slot",
          5_000,
          () => oHostHeard().slice(heard0),
          (got) => got.includes("click #hd"),
        );
        await sleep(600);
        hidden = { hostHeard: heard, frameClicks: (oFramed()?.clicks.length ?? 0) - clicks0 };
      }
      // its low button, below the header: the frame's
      const obl = oFramed()?.parts.bl ?? null;
      const aimed: Point | null = obl === null ? null : centre(obl);
      const clicks0 = oFramed()?.clicks.length ?? 0;
      const heard0 = oHostHeard().length;
      let slotPressed: Point | undefined;
      if (aimed !== null) {
        const w = await onWindow(
          slotHeld,
          visibleView(slotHost),
          oBox.x + aimed[0],
          oBox.y + aimed[1],
        );
        slotPressed = [w.at[0] - oBox.x, w.at[1] - oBox.y];
        await h.press(w);
      }
      const shown = await waitFor(
        "the slot's frame's click below the header",
        5_000,
        () => oFramed(),
        (f) => (f?.clicks.length ?? 0) > clicks0,
      );
      const hd = slotHost.framed?.parts.hd ?? null;
      slot = {
        top: oBox.y,
        edge: hd === null ? null : hd.y + hd.h,
        hidden,
        shown: {
          aimed,
          ...(slotPressed === undefined ? {} : { pressed: slotPressed }),
          clicked: shown?.clicks[clicks0] ?? null,
          hostHeard: oHostHeard().slice(heard0),
          // (A: the hand's own mapping beside the slot)
          calibration: await calibrate(
            SLOT_HOST,
            slotHeld,
            visibleView(slotHost),
            oBox,
            aimed === null ? null : [oBox.x + aimed[0], oBox.y + aimed[1]],
          ),
        },
      };
    }
    await shoot("pt-5d-frame-covered-slot.png");
    const covered = { ...coveredSeen, sly, slot };
    said.covered = covered;
    problems.push(...judgeFrameCovered(covered));
    await done();

    // ── FRAME-ZOOMED (M7 H11): a press at a page scale not 1 ───────────────────────────────────────────────────────────
    /** a pane on a frames host, live, its words in, in hand; its host's word and box of its frame */
    const zoomedPane = async (name: string, at0: number, phone: boolean, query = "") => {
      const pane = await lay(
        `${d.fixture.hostOrigin}/frames/host?p=${name}${query}`,
        at0,
        y0,
        phone ? { w: PANE.phoneCut.w, h: PANE.phoneCut.h, props: { device: "phone" } } : {},
      );
      await frame([pane]);
      await live(pane);
      const hostPath = `/frames/host?p=${name}${query}`;
      const framePath = `/frames/frame?p=${name}`;
      await waitFor(
        `the ${name} host's word`,
        FRAMES_ROWS.withinMs,
        () => at(hostPath),
        (rep) => rep?.framed?.parts.frame !== undefined,
      );
      await waitFor(
        `the ${name} frame's word`,
        FRAMES_ROWS.withinMs,
        () => at(framePath),
        (rep) => rep?.framed?.parts.bm !== undefined,
      );
      await pickUp(pane);
      await sleep(800);
      return { pane, hostPath, framePath };
    };
    /** a press on a frame's part, where the host draws it now; its click, the host's word of its scale */
    const pressPart = async (
      hostPath: string,
      framePath: string,
      part: string,
      tap: boolean,
    ): Promise<FramesSeen["zoomed"]["phone"]> => {
      const heldNow = await heldFrame();
      const host = at(hostPath);
      const box = host?.framed?.parts.frame ?? null;
      const target = at(framePath)?.framed?.parts[part] ?? null;
      const scale = host?.vv?.[0] ?? null;
      if (heldNow === null || host === null || box === null || target === null)
        return { aimed: null, clicked: null, hostHeard: [], scale };
      const aimed = centre(target);
      const clicks0 = at(framePath)?.framed?.clicks.length ?? 0;
      const heard0 = host.framed?.heard.length ?? 0;
      const w = await onWindow(heldNow, visibleView(host), box.x + aimed[0], box.y + aimed[1]);
      if (tap) {
        h.move(w.x, w.y);
        await sleep(40);
        win.webContents.sendInputEvent({
          type: "mouseDown",
          x: w.x,
          y: w.y,
          button: "left",
          clickCount: 1,
        });
        await sleep(30);
        win.webContents.sendInputEvent({
          type: "mouseUp",
          x: w.x,
          y: w.y,
          button: "left",
          clickCount: 1,
        });
      } else await h.press(w);
      const landed = await waitFor(
        `the ${part} click at its scale`,
        5_000,
        () => at(framePath)?.framed ?? null,
        (f) => (f?.clicks.length ?? 0) > clicks0,
      );
      return {
        aimed,
        pressed: [w.at[0] - box.x, w.at[1] - box.y],
        clicked: landed?.clicks[clicks0] ?? null,
        hostHeard: (at(hostPath)?.framed?.heard ?? []).slice(heard0),
        scale,
        // (M22 A: against the hand's own mapping — at 0.41 a window px is about 4 of the page's)
        calibration: await calibrate(hostPath, heldNow, visibleView(host), box, [
          box.x + aimed[0],
          box.y + aimed[1],
        ]),
      };
    };
    // a phone's host naming no viewport: laid out at 980 px, drawn whole at about 0.41
    const zp = await zoomedPane("zp", x0 + 7 * step, true, "&noviewport=1");
    const zoomedPhone = await pressPart(zp.hostPath, zp.framePath, "bm", true);
    await done();
    // (M18 E: the leg of a laptop's page the desk drew LARGER is gone — the desk's zoom never raises a page's scale, and
    // no door from the smoke does (runs 2, 3: six zooms, the scale 1): mouse at s ≠ 1 into a frame is ÷ s by the touch
    // evidence on the same path, unwitnessed for mouse — carried to PT-6)
    const zoomed = { phone: zoomedPhone };
    said.zoomed = zoomed;
    problems.push(...judgeFrameZoomed(zoomed));

    // ── FRAME-TOUCH: a phone's pane on the host; a tap on the frame's button ────────────────────────────────────────
    // (M12 J11: on the scheme OPPOSITE the system's — a frame told nothing follows the system's: on the same, the colour
    // half could not fail)
    const systemDark = d.systemDark();
    const phone = await lay(`${d.fixture.hostOrigin}/frames/host?p=t`, x0 + step, y0, {
      w: PANE.phoneCut.w,
      h: PANE.phoneCut.h,
      props: { device: "phone", scheme: systemDark ? "light" : "dark" },
    });
    await frame([phone]);
    await live(phone);
    const PHONE_FRAME = "/frames/frame?p=t";
    const PHONE_HOST = "/frames/host?p=t";
    await waitFor(
      "the phone's frame's word",
      FRAMES_ROWS.withinMs,
      () => at(PHONE_FRAME),
      (rep) => rep?.framed?.parts.b !== undefined,
    );
    await pickUp(phone);
    await sleep(800);
    const phoneHeld = await heldFrame();
    const phoneHost = at(PHONE_HOST);
    const pb = at(PHONE_FRAME)?.framed?.parts.b ?? null;
    const pBox = phoneHost?.framed?.parts.frame ?? null;
    const touchHeard0 = at(PHONE_FRAME)?.framed?.heard.length ?? 0;
    const touchClicks0 = at(PHONE_FRAME)?.framed?.clicks.length ?? 0;
    const touchHostHeard0 = phoneHost?.framed?.heard.length ?? 0;
    const touchAimed: Point | null = pb === null ? null : centre(pb);
    let touchPressed: Point | undefined;
    if (phoneHeld !== null && phoneHost !== null && pb !== null && pBox !== null) {
      const w = await onWindow(
        phoneHeld,
        visibleView(phoneHost),
        pBox.x + centre(pb)[0],
        pBox.y + centre(pb)[1],
      );
      touchPressed = [w.at[0] - pBox.x, w.at[1] - pBox.y];
      h.move(w.x, w.y);
      await sleep(40);
      win.webContents.sendInputEvent({
        type: "mouseDown",
        x: w.x,
        y: w.y,
        button: "left",
        clickCount: 1,
      });
      await sleep(30);
      win.webContents.sendInputEvent({
        type: "mouseUp",
        x: w.x,
        y: w.y,
        button: "left",
        clickCount: 1,
      });
    }
    const touchSaid = await waitFor(
      "the phone's frame's click",
      5_000,
      () => at(PHONE_FRAME)?.framed ?? null,
      (f) => (f?.clicks.length ?? 0) > touchClicks0,
    );
    const touch = {
      heard: touchSaid?.heard.slice(touchHeard0) ?? null,
      clicks: (touchSaid?.clicks.length ?? 0) - touchClicks0,
      device: {
        frame: at(PHONE_FRAME)?.framed?.device ?? null,
        host: at(PHONE_HOST)?.framed?.device ?? null,
        systemDark,
      },
      // (M22 D1: aimed through the page's VISUAL viewport; where it landed against the hand's own mapping — its taps on the
      // host's own ground, the page's session's, M22-3)
      press: {
        aimed: touchAimed,
        ...(touchPressed === undefined ? {} : { pressed: touchPressed }),
        clicked: touchSaid?.clicks[touchClicks0] ?? null,
        hostHeard: (at(PHONE_HOST)?.framed?.heard ?? []).slice(touchHostHeard0),
        calibration: await calibrate(
          PHONE_HOST,
          phoneHeld,
          phoneHost === null ? null : visibleView(phoneHost),
          pBox,
          touchAimed === null || pBox === null
            ? null
            : [pBox.x + touchAimed[0], pBox.y + touchAimed[1]],
        ),
      },
    };
    said.touch = touch;
    problems.push(...judgeFrameTouch(touch));
    await done();

    // ── BACK-WRITTEN: the document sends a pane from A to B; the page's own ‹ ────────────────────────────────────────
    const a = `${d.fixture.origin}/page?back=a`;
    const bAddress = `${d.fixture.origin}/next?back=b`;
    const backPane = await lay(a, x0 + 2 * step, y0);
    await frame([backPane]);
    await live(backPane);
    const backEntity = await entityOf(backPane);
    if (backEntity !== null)
      await js(
        `globalThis.__vfDesk.writeProps(${backEntity}, { url: ${JSON.stringify(bAddress)} })`,
      );
    const arrived =
      (
        await waitFor(
          "the page at B",
          FRAMES_ROWS.withinMs,
          () => face(backPane),
          (f) => f?.address === bAddress,
        )
      )?.address === bAddress;
    await pickUp(backPane);
    await pressTool("back");
    await waitFor(
      "the page back at A",
      FRAMES_ROWS.withinMs,
      () => face(backPane),
      (f) => f?.address === a,
    );
    const backUrl = await waitFor(
      "the document's url back at A",
      10_000,
      async () => (await rowsNow()).find((row) => row.key === backPane.key)?.props.url ?? null,
      (u) => u === a,
    );
    const back = { a, arrived, url: typeof backUrl === "string" ? backUrl : null };
    said.back = back;
    problems.push(...judgeBackWritten(back));
    await done();

    // ── PRESS-ANSWER (PT-6a, K1: the engine's fact): a press on a FRAMELESS page whose own mousedown holds its thread ─
    // (its press alone — its release after — so main's count of the hand's commands in flight is the press's own)
    const spinPane = await lay(`${d.fixture.origin}/frames/spin?p=a`, x0 + 4 * step, y0);
    await frame([spinPane]);
    await live(spinPane);
    const SPIN = "/frames/spin?p=a";
    await waitFor(
      "the spin page's word",
      FRAMES_ROWS.withinMs,
      () => at(SPIN),
      (rep) => rep?.framed?.parts.b !== undefined,
    );
    await pickUp(spinPane);
    await sleep(600);
    const spinHeld = await heldFrame();
    const spinWord = at(SPIN);
    const spinButton = spinWord?.framed?.parts.b ?? null;
    let answer: PressAnswerSeen | null = null;
    if (spinHeld !== null && spinWord !== null && spinButton !== null) {
      const p = await onWindow(
        spinHeld,
        visibleView(spinWord),
        centre(spinButton)[0],
        centre(spinButton)[1],
      );
      h.move(p.x, p.y);
      await sleep(300);
      const base = d.custody()?.handInFlight ?? null;
      const sent = Date.now();
      win.webContents.sendInputEvent({
        type: "mouseDown",
        x: p.x,
        y: p.y,
        button: "left",
        clickCount: 1,
      });
      let lastUp: number | null = null;
      let read = base !== null;
      while (Date.now() - sent < FRAMES_SPIN_MS + 1_500) {
        const n = d.custody()?.handInFlight ?? null;
        if (n === null) read = false;
        else if (base !== null && n > base) lastUp = Date.now() - sent;
        await sleep(FRAMES_ROWS.answerLookMs);
      }
      win.webContents.sendInputEvent({
        type: "mouseUp",
        x: p.x,
        y: p.y,
        button: "left",
        clickCount: 1,
      });
      const downs = await waitFor(
        "the spin page's word of its mousedown",
        10_000,
        () => at(SPIN)?.busy?.downs ?? [],
        (ds) => ds.length > 0,
      );
      answer = {
        down: downs[0] ?? null,
        answerMs: read ? (lastUp ?? 0) : null,
        lookMs: FRAMES_ROWS.answerLookMs,
      };
    }
    said.answer = answer;
    problems.push(...judgePressAnswer(answer));
    await done();

    // ── FRAME-BUSY (PT-6a, K1): a page holding an ad-like frame of another site, busy after a press or a tap on its own field ─
    /** the hint's word waited behind the spin (the page's own timer, beside the words', after it) with the hint's gesture
     * answered before it (a press: its click before the spin) */
    const heldOf = (
      busy: FixtureBusy | null | undefined,
      why: "press" | "tap" | "key",
    ): boolean | null => {
      const spin = busy?.spins?.find((s) => s[2] === why);
      const timer = busy?.timers?.[0];
      if (spin === undefined || timer === undefined) return null;
      const [began, ms] = spin;
      if (why === "tap") return timer >= began + ms;
      // (a key's keydown and the spin it posts can fall in one millisecond of the page's clock)
      if (why === "key") {
        const keyed = busy?.keys?.[0];
        return timer >= began + ms && keyed !== undefined && keyed <= began;
      }
      const clicked = busy?.clicks?.[0];
      return timer >= began + ms && clicked !== undefined && clicked < began;
    };
    const busyLeg = async (
      name: string,
      phone: boolean,
      lane: number,
      on: "press" | "key" = "press",
    ): Promise<FrameBusySeen | null> => {
      const BUSY = `/frames/busy?p=${name}${on === "key" ? "&on=key" : ""}`;
      const pane = await lay(
        `${d.fixture.hostOrigin}${BUSY}`,
        x0 + lane * step,
        y0,
        phone ? { w: PANE.phoneCut.w, h: PANE.phoneCut.h, props: { device: "phone" } } : {},
      );
      await frame([pane]);
      await live(pane);
      await waitFor(
        `the busy page's word (${name})`,
        FRAMES_ROWS.withinMs,
        () => at(BUSY),
        (rep) => rep?.framed?.parts.t !== undefined,
      );
      // (its ad: a frame of another site attached — the page's own doubt is the one that holds its keys)
      await waitFor(
        `its ad's word (${name})`,
        FRAMES_ROWS.withinMs,
        () => at(`/frames/next?p=${name}`),
        (rep) => rep !== null,
      );
      await pickUp(pane);
      await sleep(800);
      const heldNow = await heldFrame();
      const word = at(BUSY);
      const field = word?.framed?.parts.t ?? null;
      let leg: FrameBusySeen | null = null;
      if (heldNow !== null && word !== null && field !== null) {
        await h.press(
          await onWindow(heldNow, visibleView(word), centre(field)[0], centre(field)[1]),
        );
        // typed after a person's beat — the hint's gesture whole at main (the desk delivers a pointer's up at its next frame,
        // keys at once: typed 0 ms after, a phone's first key reached the page before its tap's end focused the field —
        // run 3) — while the page is still busy after the hint; a key's leg: once the press's own word has come (the field
        // focused, the page not busy), the first key making it busy
        await sleep(on === "key" ? FRAMES_ROWS.busyFocusMs : FRAMES_ROWS.busyBeatMs);
        for (const ch of FRAMES_ROWS.busyTyped) {
          win.webContents.sendInputEvent({ type: "keyDown", keyCode: ch });
          win.webContents.sendInputEvent({ type: "char", keyCode: ch });
          win.webContents.sendInputEvent({ type: "keyUp", keyCode: ch });
          await sleep(30);
        }
        // (its word taken once its field holds what was typed — bounded: a key refused or lost reads short at the bound.
        // Run 4: two of its asks counted from the typing fell before the last key reached a page busy until then — "ab")
        await waitFor(
          `the busy page's field holding what was typed (${name})`,
          5_000,
          () => at(BUSY)?.field ?? null,
          (v) => v === FRAMES_ROWS.busyTyped,
        );
        const after = at(BUSY);
        leg = {
          typed: FRAMES_ROWS.busyTyped,
          field: after?.field ?? null,
          busy: after?.busy ?? null,
          held: heldOf(after?.busy, on === "key" ? "key" : phone ? "tap" : "press"),
        };
      }
      await done();
      return leg;
    };
    const busy = {
      press: await busyLeg("k", false, 5),
      tap: await busyLeg("m", true, 6),
      key: await busyLeg("q", false, 8, "key"),
    };
    said.busy = busy;
    problems.push(...judgeFrameBusy(busy));

    // ── FRAME-OPENED (PT-6a, M4/M5 — F1): an editor frame written by open()/write()/close(), its field pressed and typed ──
    const openedRow = async (): Promise<FrameOpenedSeen | null> => {
      const OPENED = "/frames/opened?p=e1";
      const pane = await lay(`${d.fixture.hostOrigin}${OPENED}`, x0 + 11 * step, y0);
      await frame([pane]);
      await live(pane);
      await waitFor(
        "the opened page's editor written",
        FRAMES_ROWS.withinMs,
        () => at(OPENED),
        (rep) => (rep?.opened?.opens ?? 0) >= 1 && rep?.framed?.parts.ed !== undefined,
      );
      await waitFor(
        "its ad's word (opened)",
        FRAMES_ROWS.withinMs,
        () => at("/frames/next?p=e1"),
        (rep) => rep !== null,
      );
      await pickUp(pane);
      await sleep(800);
      const heldNow = await heldFrame();
      const word = at(OPENED);
      const editor = word?.framed?.parts.ed ?? null;
      if (heldNow === null || word === null || editor === null) {
        await done();
        return null;
      }
      const f = FRAMES_OPENED.field;
      await h.press(
        await onWindow(
          heldNow,
          visibleView(word),
          editor.x + f.x + f.w / 2,
          editor.y + f.y + f.h / 2,
        ),
      );
      // (typed once the press's own word could have come — a person's pause before typing)
      await sleep(FRAMES_ROWS.busyFocusMs);
      const sent = Date.now();
      for (const ch of FRAMES_ROWS.busyTyped) {
        win.webContents.sendInputEvent({ type: "keyDown", keyCode: ch });
        win.webContents.sendInputEvent({ type: "char", keyCode: ch });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode: ch });
        await sleep(30);
      }
      // (watched past the host's bound: when the text lands, and whether the page is ever said stopped)
      let value: string | null = null;
      let landedMs: number | null = null;
      let stoppedMs: number | null = null;
      while (Date.now() - sent < FRAMES_ROWS.openedWatchMs) {
        value = at(OPENED)?.opened?.value ?? null;
        if (landedMs === null && value === FRAMES_ROWS.busyTyped) landedMs = Date.now() - sent;
        if (stoppedMs === null && (await face(pane))?.state === "failed")
          stoppedMs = Date.now() - sent;
        await sleep(100);
      }
      const opens = at(OPENED)?.opened?.opens ?? null;
      await done();
      return {
        typed: FRAMES_ROWS.busyTyped,
        value,
        landedMs,
        stoppedMs,
        watchedMs: FRAMES_ROWS.openedWatchMs,
        opens,
      };
    };
    const openedSeen = await openedRow();
    said.opened = openedSeen;
    problems.push(...judgeFrameOpened(openedSeen));

    // ── STUCK: a page whose button starts an endless loop; a key it never answers; ↻ ───────────────────────────────
    const loop = await lay(`${d.fixture.origin}/frames/loop?p=s`, x0 + 3 * step, y0);
    await frame([loop]);
    await live(loop);
    const LOOP = "/frames/loop?p=s";
    await waitFor(
      "the loop page's word",
      FRAMES_ROWS.withinMs,
      () => at(LOOP),
      (rep) => rep?.framed?.parts.b !== undefined,
    );
    await pickUp(loop);
    const loopHeld = await heldFrame();
    const loopWord = at(LOOP);
    const lb = loopWord?.framed?.parts.b ?? null;
    let hung = false;
    let saidMs: number | null = null;
    let reason: string | null = null;
    let reloaded = false;
    if (loopHeld !== null && loopWord !== null && lb !== null) {
      await h.press(await onWindow(loopHeld, visibleView(loopWord), centre(lb)[0], centre(lb)[1]));
      await sleep(600);
      // a key the looping page never answers — the hand's chain waits on it
      const sent = Date.now();
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "q" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "q" });
      // its own asks stop: it hangs
      const asked = d.fixture.reports(LOOP);
      await sleep(1_500);
      hung = d.fixture.reports(LOOP) === asked;
      const stopped = await waitFor(
        "the face saying the page stopped",
        FRAMES_ROWS.hungMs + FRAMES_ROWS.stuckMarginMs,
        () => face(loop),
        (f) => f?.state === "failed",
      );
      if (stopped?.state === "failed") saidMs = Date.now() - sent;
      reason = stopped?.reason ?? null;
      await pressTool("reload");
      reloaded =
        (
          await waitFor(
            "the page back after ↻",
            FRAMES_ROWS.withinMs,
            () => face(loop),
            (f) => f?.state === "live",
          )
        )?.state === "live";
    }
    // M7 H11: ↻ and an address typed WHILE the chain is stalled — never on the hand's chain: they act
    let reloadActed: boolean | null = null;
    let typed: FramesSeen["stuck"]["typed"] = null;
    /** PT-6a (K5): MAIN's count of the hand's commands in flight, 300 ms after each leg's hang */
    const inFlight: (number | null)[] = [];
    /** the loop page live, its button pressed: the page hangs (its asks stop) — and a key it never answers, the chain
     * stalled behind it (M12 J11: a press is answered — with nothing in flight the legs act with or without H11's let-go) */
    const hangAgain = async (): Promise<boolean> => {
      // (M20 F6: tried again, BOUNDED — a press that did not start the loop (its document not ready yet) is pressed once
      // more: no leg runs, or is skipped, by chance — runs 2 and 3 ran one leg each)
      for (let attempt = 0; attempt < FRAMES_ROWS.hangTries; attempt += 1) {
        const back = await waitFor(
          "the loop page live again",
          FRAMES_ROWS.withinMs,
          () => face(loop),
          (f) => f?.state === "live",
        );
        const word = await waitFor(
          "the loop page's word again",
          FRAMES_ROWS.withinMs,
          () => at(LOOP),
          (rep) => rep?.framed?.parts.b !== undefined,
        );
        const heldNow = await heldFrame();
        const lbNow = word?.framed?.parts.b ?? null;
        if (back?.state !== "live" || heldNow === null || word === null || lbNow === null) continue;
        await sleep(600);
        await h.press(
          await onWindow(heldNow, visibleView(word), centre(lbNow)[0], centre(lbNow)[1]),
        );
        const asked = d.fixture.reports(LOOP);
        await sleep(1_500);
        if (d.fixture.reports(LOOP) !== asked) continue;
        win.webContents.sendInputEvent({ type: "keyDown", keyCode: "q" });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode: "q" });
        await sleep(300);
        // (PT-6a K5: stalled by MAIN's word — a command of the hand the hung page has not answered; here the click's
        // release, its loop in its click — never the smoke's own word that it sent a key)
        inFlight.push(d.custody()?.handInFlight ?? null);
        return true;
      }
      return false;
    };
    if (reloaded && (await hangAgain())) {
      // ↻ at once, the chain stalled: the page's address asked again within three seconds (served once more)
      const served0 = d.fixture.framesServed(LOOP);
      const asked0 = d.fixture.reports(LOOP);
      await pressTool("reload");
      reloadActed =
        (await waitFor(
          "the loop page asked again by ↻",
          3_000,
          () => d.fixture.framesServed(LOOP),
          (n) => n > served0,
        )) > served0;
      // (whatever the engine made of it: the page back — or said stopped at the host's bound, then ↻)
      const after = await waitFor(
        "the loop page back or said stopped",
        FRAMES_ROWS.hungMs + FRAMES_ROWS.stuckMarginMs,
        () => face(loop),
        (f) => f?.state === "failed" || (f?.state === "live" && d.fixture.reports(LOOP) > asked0),
      );
      if (after?.state === "failed") await pressTool("reload");
    }
    if (reloaded && (await hangAgain())) {
      // an address of ANOTHER site typed (⌘L, the address, ⏎), the chain stalled: the page goes there, and stays live
      const typedPath = "/page?stuck=typed";
      await h.key("l", [process.platform === "darwin" ? "meta" : "control"]);
      await sleep(400);
      for (const ch of `${d.fixture.innerOrigin}${typedPath}`) {
        win.webContents.sendInputEvent({ type: "char", keyCode: ch });
        await sleep(8);
      }
      await sleep(200);
      await h.key("Return");
      const arrived =
        (await waitFor(
          "the page at the address typed while stalled",
          FRAMES_ROWS.withinMs,
          () => at(typedPath),
          (rep) => rep !== null,
        )) !== null;
      let stayed = false;
      if (arrived) {
        const failed = await waitFor(
          "the page at the typed address said stopped",
          FRAMES_ROWS.hungMs + FRAMES_ROWS.stuckMarginMs,
          () => face(loop),
          (f) => f?.state === "failed",
          true,
        );
        stayed = failed?.state !== "failed";
      }
      typed = { arrived, stayed };
    }
    const stalled = inFlight.length > 0 && inFlight.every((n) => n !== null && n > 0);
    const stuck = { hung, saidMs, reason, reloaded, reloadActed, typed, stalled, inFlight };
    said.stuck = stuck;
    problems.push(...judgeStuck(stuck));
    await done();
  } catch (error) {
    problems.push(`PT-5d FRAMES: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    say(`SMOKE_CANVAS_FRAMES ${JSON.stringify(said)}`);
    try {
      if ((await js<number | null>("globalThis.__vfDesk.held()?.entity ?? null")) !== null)
        await done();
      await js("globalThis.__vfDesk.liveGrace(300)");
      for (const row of await rowsNow())
        if (row.key !== null && laid.has(row.key))
          await js(`globalThis.__vfFieldSmoke.removeWidget(${JSON.stringify(String(row.entity))})`);
      await sleep(900);
      await js("globalThis.__vfDesk.liveGrace(null)");
      await js("globalThis.__vfFieldSmoke.frame([])");
    } catch {
      /* a row that cannot go on ends the rows, never what the earlier rows found */
    }
    const after = await h.census().catch(() => -1);
    if (after !== before)
      problems.push(
        `CLEARED: ${after} panes on the board after the frames rows, not the ${before} found`,
      );
    say(`SMOKE_CANVAS_FRAMES_CLEARED ${JSON.stringify({ before, after })}`);
  }
  return problems;
}
