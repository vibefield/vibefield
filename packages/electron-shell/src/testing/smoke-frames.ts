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
//   FRAME-WHEEL  — the wheel over the frame's scroller scrolls it; at its end, the host page;
//   FRAME-TYPE   — the frame's field pressed (the keys follow the focus), "héllo" typed and a syllable composed: in its
//                  field, the caret after them — and the host heard NO key meanwhile (M3, M7 H2: nothing key-like on the
//                  page's session while the frame holds the focus);
//   FRAME-NESTED — a press on the button of the frame in the frame (a third site) lands there;
//   FRAME-HALF   — the host scrolled until the frame is half out of its view: a press on the frame's part in view lands;
//   FRAME-TOUCH  — on a phone, a tap on the frame's button: its touch's start and end, and the click — and the frame
//                  told the PHONE (M6.5b): its own agent, touch points and colours the page's (before: a laptop's);
//   FRAME-GONE   — a press held in the frame and the frame sent elsewhere under it: its release goes nowhere and nothing
//                  stalls — the next press lands in the frame's new document;
//   FRAME-CLIPPED — M6.3a: the frame in a host's SCROLLER, its top half above the scroller's clip edge, under the host's
//                  header: a press on the clipped part is the host's (its header heard it; the frame nothing), a press on
//                  the part in view the frame's (before M6.3a the frame took both);
//   FRAME-COVERED — M7 H3: a FIXED header drawn over the frame's top: a press on the header there is the host's, one below
//                  it the frame's (before H3 the frame took both — a regression of PT-5d's routing); M8: and a page that
//                  hides its header from a read in its own world (its DOM's methods replaced) — still the host's;
//   FRAME-MENU   — M7 H3: the host's dropdown opened over the frame: its item's press is the host's, the frame hears
//                  nothing;
//   FRAME-PICKER — the file input in the NESTED frame pressed (M2): no panel, its `cancel` heard, main's windows as they were;
//   BACK-WRITTEN — ruling 5: a pane the document sent from A to B, the page's own ‹ back to A: the document's url is A again;
//   STUCK        — ruling 6: a page whose button starts an endless loop, pressed, then a key it never answers: the face says
//                  the page stopped responding within the host's bound; ↻ brings it back.
// Then the panes are removed and the board is as found. `--frames-pane` beside `--smoke-canvas` runs these rows alone after
// the boot's (the author's loop).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type FixtureRect, type FixtureReport, FRAMES_BOX, FRAMES_WORD } from "./live-fixture";
import { PANE, type PaneHands, paneHands } from "./smoke-browser-pane";
import type { LiveRowsDriver } from "./smoke-live-pane";
import { type HeldFrameSeen, pageOnWindow } from "./smoke-use-pane";

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
  /** STUCK: the host's bound on a command never answered (the producer's `hungInputMs`) and the margin past it */
  hungMs: 20_000,
  stuckMarginMs: 10_000,
  /** FRAME-GONE: the longest the next press may wait past the frame's going */
  goneMs: 5_000,
} as const;

/** The rows' driver: PT-2's, the shell window's IME (USE's), and main's windows. */
export interface FramesDriver extends LiveRowsDriver {
  compose(text: string, caret: number): Promise<void>;
  commit(text: string): Promise<void>;
  /** main's windows that are not offscreen (a file panel would be one more) */
  windows(): number;
}

/** A point in a frame's own CSS px. */
type Point = readonly [number, number];

/** What the rows saw — the SMOKE_CANVAS_FRAMES line, and what the judges read. */
export interface FramesSeen {
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
  };
  readonly wheel: {
    readonly scroller: readonly [number | null, number | null];
    readonly host: readonly [number | null, number | null];
  };
  readonly type: {
    readonly field: string | null;
    readonly caret: number | null;
    /** the keys the HOST page heard (on the frame's element) while the frame's field was typed in */
    readonly hostHeard: readonly string[];
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
    };
  };
  readonly gone: {
    readonly went: boolean;
    readonly nextClicks: number;
    readonly ms: number | null;
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
    readonly windows: readonly [number, number];
  };
  readonly back: { readonly a: string; readonly arrived: boolean; readonly url: string | null };
  readonly stuck: {
    readonly hung: boolean;
    readonly saidMs: number | null;
    readonly reason: string | null;
    readonly reloaded: boolean;
  };
}

/** What a page is told of its device: its own agent, touch points, whether its colours are dark. */
type FramesDevice = NonNullable<NonNullable<FixtureReport["framed"]>["device"]>;

/** A press aimed at a frame, and what came of it. */
export interface FramePressSeen {
  /** where the hand pressed, in the frame's own px (null: it could not be aimed) */
  readonly aimed: Point | null;
  /** the frame's click there (null: none came) */
  readonly clicked: Point | null;
  /** what the host page heard on the frame's element over the press */
  readonly hostHeard: readonly string[];
}

const near = (a: Point, b: Point, by: number): boolean =>
  Math.abs(a[0] - b[0]) <= by && Math.abs(a[1] - b[1]) <= by;

/** FRAME-PRESS, FRAME-NESTED, FRAME-HALF: the click lands in the frame where the hand pressed; the host hears nothing of it. */
export function judgeFramePress(row: string, seen: FramePressSeen): string[] {
  if (seen.aimed === null)
    return [`${row}: the frame's part could not be aimed at — the row proved nothing`];
  const out: string[] = [];
  if (seen.clicked === null)
    out.push(
      `${row}: the frame heard no click — the press never reached a frame of another site (the host heard ${seen.hostHeard.join(", ") || "nothing"})`,
    );
  else if (!near(seen.clicked, seen.aimed, FRAMES_ROWS.near))
    out.push(
      `${row}: the frame's click landed at ${seen.clicked.join(", ")}, not where the hand pressed (${seen.aimed.map((v) => Math.round(v)).join(", ")}, ±${FRAMES_ROWS.near})`,
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
  if (seen.after < seen.before + 10)
    out.push(
      `FRAME-DRAG: the range stood at ${seen.after} after the drag (from ${seen.before}) — the drag never moved it`,
    );
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

/** FRAME-WHEEL: the frame's scroller scrolled; past its end, the host page. */
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
  return out;
}

/** FRAME-TYPE: the text and the composition in the frame's field, the caret after them; no key heard by the host. */
export function judgeFrameType(seen: FramesSeen["type"]): string[] {
  const want = FRAMES_ROWS.typed + FRAMES_ROWS.composed;
  const out: string[] = [];
  if (seen.field !== want)
    out.push(
      `FRAME-TYPE: the frame's field holds ${JSON.stringify(seen.field)}, not ${JSON.stringify(want)} — the keys never reached the frame`,
    );
  else if (seen.caret !== want.length)
    out.push(
      `FRAME-TYPE: the frame's caret stands at ${seen.caret}, not after what was typed (${want.length})`,
    );
  const keys = seen.hostHeard.filter((h) => h.startsWith("keydown"));
  if (keys.length > 0)
    out.push(
      `FRAME-TYPE: the host page heard ${keys.length} key(s) while the frame's field was typed in (${keys.join(", ")}) — they went down the page's session with a frame of another site focused (M3's banned path)`,
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
  }
  return out;
}

/** FRAME-GONE: the frame went; nothing stalled — the next press landed in its new document. */
export function judgeFrameGone(seen: FramesSeen["gone"]): string[] {
  if (!seen.went)
    return [
      "FRAME-GONE: the frame never went elsewhere under the held press — the row proved nothing",
    ];
  if (seen.nextClicks < 1 || seen.ms === null)
    return [
      "FRAME-GONE: the next press never landed in the frame's new document — the hand stalled on the gone one",
    ];
  return seen.ms > FRAMES_ROWS.goneMs
    ? [
        `FRAME-GONE: the next press landed ${seen.ms} ms after it was sent — it waited on the gone document`,
      ]
    : [];
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

/** FRAME-PICKER: the nested frame's file input: cancelled, nothing chosen, no window more. */
export function judgeFramePicker(seen: FramesSeen["picker"]): string[] {
  const out: string[] = [];
  if (seen.cancels === null)
    return ["FRAME-PICKER: the nested frame never said its file input — the row proved nothing"];
  if (seen.cancels < 1)
    out.push(
      "FRAME-PICKER: the nested frame's file input heard no `cancel` — its picker was not intercepted in a frame inside a frame",
    );
  if ((seen.changes ?? 0) > 0)
    out.push("FRAME-PICKER: a file was CHOSEN in the nested frame — a real panel answered");
  if (seen.windows[1] !== seen.windows[0])
    out.push(
      `FRAME-PICKER: main's windows went from ${seen.windows[0]} to ${seen.windows[1]} — a panel opened`,
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
  return out;
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
  ): Promise<T> => {
    const deadline = Date.now() + ms;
    let last = await read();
    while (!ok(last) && Date.now() < deadline) {
      await sleep(80);
      last = await read();
    }
    if (!ok(last)) say(`SMOKE_CANVAS_FRAMES_UNMET ${JSON.stringify({ label, last })}`);
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
  const heldFrame = (): Promise<HeldFrameSeen | null> =>
    js<HeldFrameSeen | null>("globalThis.__vfDesk.held()?.frame ?? null");
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
  /** The window point of a host page's point, the pane in hand. */
  const onWindow = async (
    held: HeldFrameSeen,
    view: readonly [number, number],
    x: number,
    y: number,
  ) => {
    const q = pageOnWindow(held, view, await h.deskAt(), x, y);
    return { x: Math.round(q.x), y: Math.round(q.y) };
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
    const view = at(HOST)?.view ?? null;
    /** a frame's own point, on the window — through the host's LATEST box of it (the host scrolls) */
    const inFrame = async (x: number, y: number) => {
      const box = at(HOST)?.framed?.parts.frame ?? null;
      return held === null || box === null || view === null
        ? null
        : onWindow(held, view, box.x + x, box.y + y);
    };
    const framed = () => at(FRAME)?.framed ?? null;
    const hostHeard = () => at(HOST)?.framed?.heard ?? [];

    // ── FRAME-PRESS ──────────────────────────────────────────────────────────────────────────────────────────────────
    const b = framed()?.parts.b ?? null;
    const aimed: Point | null = b === null ? null : centre(b);
    const clicks0 = framed()?.clicks.length ?? 0;
    const heard0 = hostHeard().length;
    if (aimed !== null) {
      const w = await inFrame(aimed[0], aimed[1]);
      if (w !== null) await h.press(w);
    }
    const afterPress = await waitFor(
      "the frame's click",
      5_000,
      () => framed(),
      (f) => (f?.clicks.length ?? 0) > clicks0,
    );
    const press: FramePressSeen = {
      aimed,
      clicked: afterPress?.clicks[clicks0] ?? null,
      hostHeard: hostHeard().slice(heard0),
    };
    said.press = press;
    problems.push(...judgeFramePress("FRAME-PRESS", press));
    // … and in the frame's own child of its site (M6.1): through the frame's box of it, its button's own point
    const c = framed()?.parts.c ?? null;
    const sb = at(SAME)?.framed?.parts.sb ?? null;
    const sameAimed: Point | null = c === null || sb === null ? null : centre(sb);
    const sameClicks0 = at(SAME)?.framed?.clicks.length ?? 0;
    const heardSame = hostHeard().length;
    if (c !== null && sameAimed !== null) {
      const w = await inFrame(c.x + sameAimed[0], c.y + sameAimed[1]);
      if (w !== null) await h.press(w);
    }
    const afterSame = await waitFor(
      "the own-site child's click",
      5_000,
      () => at(SAME)?.framed ?? null,
      (f) => (f?.clicks.length ?? 0) > sameClicks0,
    );
    const same: FramePressSeen = {
      aimed: sameAimed,
      clicked: afterSame?.clicks[sameClicks0] ?? null,
      hostHeard: hostHeard().slice(heardSame),
    };
    said.same = same;
    problems.push(...judgeFramePress("FRAME-PRESS (its own site's frame in it)", same));
    await shoot("pt-5d-frame-press.png");

    // ── FRAME-HOVER ──────────────────────────────────────────────────────────────────────────────────────────────────
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
    const word = framed()?.parts.w ?? null;
    if (word !== null) {
      const w = await inFrame(word.x + 20, word.y + word.h / 2);
      if (w !== null) await h.press(w, 2);
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
    const r = framed()?.parts.r ?? null;
    const rangeBefore = framed()?.range ?? null;
    let buttonsAfter: number | null = null;
    if (r !== null) {
      const from = await inFrame(r.x + r.w * 0.1, r.y + r.h / 2);
      const to = await inFrame(-40, r.y + r.h / 2);
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
        // released OUTSIDE the frame (past its left edge, over the host)
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
    const drag = { before: rangeBefore, after: framed()?.range ?? null, buttonsAfter };
    said.drag = drag;
    problems.push(...judgeFrameDrag(drag));

    // ── FRAME-WHEEL: over the scroller, then past its end ──────────────────────────────────────────────────────────
    const s = framed()?.parts.s ?? null;
    const scroll0 = framed()?.scroller ?? null;
    const host0 = at(HOST)?.scrollY ?? null;
    if (s !== null) {
      const w = await inFrame(s.x + s.w / 2, s.y + s.h / 2);
      if (w !== null) {
        h.move(w.x, w.y);
        await sleep(150);
        for (let i = 0; i < 30; i += 1) {
          win.webContents.sendInputEvent({
            type: "mouseWheel",
            x: w.x,
            y: w.y,
            deltaX: 0,
            deltaY: -120,
            canScroll: true,
          });
          await sleep(40);
        }
      }
    }
    await sleep(800);
    const wheel = {
      scroller: [scroll0, framed()?.scroller ?? null] as const,
      host: [host0, at(HOST)?.scrollY ?? null] as const,
    };
    said.wheel = wheel;
    problems.push(...judgeFrameWheel(wheel));
    // (the host may have scrolled: the rows after it aim through its next word of its frame's box)
    await sleep(500);

    // ── FRAME-TYPE: the field pressed, text typed, a syllable composed ─────────────────────────────────────────────
    const t = framed()?.parts.t ?? null;
    const typeHeard0 = hostHeard().length;
    if (t !== null) {
      const w = await inFrame(t.x + t.w / 2, t.y + t.h / 2);
      if (w !== null) await h.press(w);
      await waitFor(
        "the frame's field focused",
        5_000,
        () => at(FRAME),
        (rep) => rep?.focused === "t",
      );
      for (const ch of FRAMES_ROWS.typed) {
        win.webContents.sendInputEvent({ type: "keyDown", keyCode: ch });
        win.webContents.sendInputEvent({ type: "char", keyCode: ch });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode: ch });
        await sleep(30);
      }
      await d.compose(FRAMES_ROWS.composing, FRAMES_ROWS.composing.length);
      await sleep(300);
      await d.commit(FRAMES_ROWS.composed);
    }
    const typedWord = await waitFor(
      "the frame's field typed",
      5_000,
      () => at(FRAME),
      (rep) => rep?.field === FRAMES_ROWS.typed + FRAMES_ROWS.composed,
    );
    const type = {
      field: typedWord?.field ?? null,
      caret: typedWord?.framed?.caret ?? null,
      hostHeard: hostHeard().slice(typeHeard0),
    };
    said.type = type;
    problems.push(...judgeFrameType(type));

    // ── FRAME-NESTED: the button of the frame in the frame ──────────────────────────────────────────────────────────
    const n = framed()?.parts.n ?? null;
    const ib = at(INNER)?.framed?.parts.ib ?? null;
    const innerAimed: Point | null = ib === null ? null : centre(ib);
    const innerClicks0 = at(INNER)?.framed?.clicks.length ?? 0;
    const heard1 = hostHeard().length;
    if (n !== null && innerAimed !== null) {
      const w = await inFrame(n.x + innerAimed[0], n.y + innerAimed[1]);
      if (w !== null) await h.press(w);
    }
    const innerAfter = await waitFor(
      "the nested frame's click",
      5_000,
      () => at(INNER)?.framed ?? null,
      (f) => (f?.clicks.length ?? 0) > innerClicks0,
    );
    const nested = {
      aimed: innerAimed,
      clicked: innerAfter?.clicks[innerClicks0] ?? null,
      hostHeard: hostHeard().slice(heard1),
      third: d.fixture.innerOrigin !== d.fixture.hostOrigin,
    };
    said.nested = nested;
    problems.push(...judgeFrameNested(nested));

    // ── FRAME-PICKER: the nested frame's file input ─────────────────────────────────────────────────────────────────
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
    const picker = {
      cancels: pickerSaid === null || cancels0 === null ? null : pickerSaid.cancels - cancels0,
      changes: pickerSaid?.changes ?? null,
      windows: [windows0, d.windows()] as const,
    };
    said.picker = picker;
    problems.push(...judgeFramePicker(picker));
    await shoot("pt-5d-frame-nested.png");

    // ── FRAME-HALF: the host scrolled until the frame is half out of its view; a press on its low part, in view ───────
    // (the host's page wheeled outside its frame: below it)
    const below = await inFrame(FRAMES_BOX.w / 2, FRAMES_BOX.h + 60);
    if (below !== null) {
      h.move(below.x, below.y);
      await sleep(150);
      for (let i = 0; i < 4; i += 1) {
        win.webContents.sendInputEvent({
          type: "mouseWheel",
          x: below.x,
          y: below.y,
          deltaX: 0,
          deltaY: -(FRAMES_BOX.y + FRAMES_BOX.h / 2) / 4,
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
    if (bl !== null && top !== null && top + centre(bl)[1] > 0) {
      halfAimed = centre(bl);
      const w = await inFrame(halfAimed[0], halfAimed[1]);
      if (w !== null) await h.press(w);
    }
    const halfLanded = await waitFor(
      "the half frame's click",
      5_000,
      () => framed(),
      (f) => (f?.clicks.length ?? 0) > halfClicks0,
    );
    const half = {
      aimed: halfAimed,
      clicked: halfLanded?.clicks[halfClicks0] ?? null,
      hostHeard: hostHeard().slice(heard2),
      top,
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
    await sleep(600);

    // ── FRAME-GONE: a press held in the frame; the frame sent elsewhere under it; released; the next press ─────────────
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
    const gone = { went, nextClicks, ms: goneMs };
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
        : onWindow(clippedHeld, clippedHost.view, cBox.x + x, cBox.y + y);
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
    if (shownAimed !== null) {
      const w = await inClipped(shownAimed[0], shownAimed[1]);
      if (w !== null) await h.press(w);
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
        clicked: shownSaid?.clicks[shownClicks0] ?? null,
        hostHeard: cHostHeard().slice(shownHeard0),
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
        : onWindow(coveredHeld, coveredHost.view, x, y);
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
    if (coveredAimed !== null && vBox !== null) {
      const w = await onCovered(vBox.x + coveredAimed[0], vBox.y + coveredAimed[1]);
      if (w !== null) await h.press(w);
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
        clicked: coveredShown?.clicks[coveredClicks0] ?? null,
        hostHeard: vHostHeard().slice(coveredHeard0),
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
        await onWindow(slyHeld, slyHost.view, sBox.x + centre(slyB)[0], sBox.y + centre(slyB)[1]),
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
    const covered = { ...coveredSeen, sly };
    said.covered = covered;
    problems.push(...judgeFrameCovered(covered));
    await done();

    // ── FRAME-TOUCH: a phone's pane on the host; a tap on the frame's button ────────────────────────────────────────
    const phone = await lay(`${d.fixture.hostOrigin}/frames/host?p=t`, x0 + step, y0, {
      w: PANE.phoneCut.w,
      h: PANE.phoneCut.h,
      props: { device: "phone" },
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
    if (phoneHeld !== null && phoneHost !== null && pb !== null && pBox !== null) {
      const w = await onWindow(
        phoneHeld,
        phoneHost.view,
        pBox.x + centre(pb)[0],
        pBox.y + centre(pb)[1],
      );
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
      await h.press(await onWindow(loopHeld, loopWord.view, centre(lb)[0], centre(lb)[1]));
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
    const stuck = { hung, saidMs, reason, reloaded };
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
