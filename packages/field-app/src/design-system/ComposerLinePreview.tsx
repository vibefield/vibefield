import { deskPalette } from "@vibecook/ice/desk/objects";
import type { FrameView } from "@vibefield/contracts";
import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type AtList, type AtMini, atDefaultHot, atList } from "../frame/at-list";
import { AtMenuView, ChipFlierView, ComposerLineView } from "../frame/ComposerLine";
import type { DeskChip, DraftPart, LineAim } from "../frame/draft";
import { inputRefusalNote, type LinePane, type LineViewDoor } from "../frame/line-door";
import { SEND_MOTION } from "../frame/line-send";
import { ViewsTrackView } from "../frame/ViewsTrack";
import type { ViewKeys } from "../frame/views";
import { ClipboardStore } from "../hud/edge-tray/clipboard-store";
import type { RoutedInputRefusal } from "../terminal/pool";

// The line's fixture ADAPTER (One Frame FR-2; docs/UI_SYSTEM.md): the shipping
// line — `ComposerLineView`, @'s `AtMenuView`, the views track at its left end
// — on fixture state, one plate per state the page's §03 plates draw for the
// composer. What it replaces is only what a host supplies: the panes Godview
// lends the line, the clipboard's stills, and the draft a person would have
// typed. The markup and the CSS are the product's.

/** The states the line's plates show: at rest, typing (a chip in the
 * sentence), @ open, aimed, Objects out, an object in hand (the create faint —
 * DK-13, R14), Godview's create, History's — and Send to…'s (DK-14): a note's
 * chip landed with the @ typed and the list open, the chip's faces by kind, and
 * an aimed draft that took a chip with no @, send armed — and a failure (D6): a
 * paste too large for its pane's terminal, said over send. */
export const LINE_STATES = [
  "rest",
  "typing",
  "at",
  "aimed",
  "objects",
  "held",
  "gv",
  "hx",
  "sent",
  "faces",
  "sent-aimed",
  "refused",
] as const;
export type LineState = (typeof LINE_STATES)[number];

export const LINE_STATE_LABEL: Record<LineState, string> = {
  rest: "At rest",
  typing: "Typing",
  at: "@ open",
  aimed: "Aimed",
  objects: "Objects open",
  held: "In hand — Put it down first",
  gv: "Godview",
  hx: "History",
  sent: "Send to… — a note's chip, the @ typed",
  faces: "Send to… — a kind's name, several, a missing face",
  "sent-aimed": "Send to… — aimed: no @, send armed",
  refused: "A paste too large for its pane — said over send",
};

const VIEW_OF: Record<LineState, FrameView> = {
  rest: "canvas",
  typing: "canvas",
  at: "canvas",
  aimed: "canvas",
  objects: "canvas",
  held: "canvas",
  gv: "godview",
  hx: "history",
  sent: "canvas",
  faces: "canvas",
  "sent-aimed": "canvas",
  refused: "godview",
};

/** A fixture still: an SVG drawn here, so a thumbnail shows a real image
 * without a screenshot on disk (the product's come through the shell's
 * `vibefield-still://` scheme, which the catalog does not have). */
export function lineFixtureStill(label: string, hue: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue} 70% 62%)'/><stop offset='1' stop-color='hsl(${hue + 30} 70% 40%)'/></linearGradient></defs>` +
    `<rect width='96' height='96' fill='url(#g)'/>` +
    `<rect x='14' y='20' width='68' height='44' rx='6' fill='rgba(255,255,255,0.28)'/>` +
    `<title>${label}</title></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** The panes the fixture deck shows — the page's own three, nearest first. */
export const FIXTURE_PANES: readonly LinePane[] = [
  { sessionId: "s-vibe", name: "vibe-field", runs: "Claude Code", state: "working", active: true },
  { sessionId: "s-rosetta", name: "rosetta", runs: "Codex", state: "idle", active: false },
  { sessionId: "s-billing", name: "billing-api", runs: "Codex", state: "blocked", active: false },
];

export const FIXTURE_CLIPBOARD: readonly AtMini[] = [
  { id: "c1", label: "1440 × 900", path: "/stills/1.png", url: lineFixtureStill("swarm", 214) },
  { id: "c2", label: "820 × 512", path: "/stills/2.png", url: lineFixtureStill("terminal", 28) },
  { id: "c3", label: "1200 × 750", path: "/stills/3.png", url: lineFixtureStill("note", 48) },
];

/** D6 — what a pane's terminal answers a ⌘V too large for it, in fixture: a
 * 300 KB paste of plain text, of which one message carries 261 KB. The words
 * are the product's own (`inputRefusalNote`), never a copy of them. */
export const FIXTURE_REFUSAL: RoutedInputRefusal = {
  sessionId: "s-vibe",
  kind: "paste",
  bytes: 300_000,
  limitBytes: 261_958,
};

/** What Godview lends the line, in fixture: three panes on screen, a new
 * terminal that opens, a paste that lands, a resumed session that mounts, a
 * running one shown. */
export const FIXTURE_LINE_DOOR: LineViewDoor = {
  panes: FIXTURE_PANES,
  onScreen: true,
  newTerminal: async () => ({ state: "opened" }),
  paste: () => true,
  canPlace: true,
  place: async () => ({ state: "opened" }),
  reveal: async () => ({ state: "opened" }),
};

/** The fixture clipboard as a store the live line reads, newest first. */
export function fixtureClipboardStore(): ClipboardStore {
  const store = new ClipboardStore(() => Date.UTC(2026, 9, 3, 15, 4));
  for (const mini of [...FIXTURE_CLIPBOARD].reverse()) {
    const [width, height] = mini.label.split(" × ").map(Number);
    store.addCapture({
      status: "ok",
      path: mini.path,
      width: width ?? 1,
      height: height ?? 1,
      scale: 2,
      displayId: 1,
      bounds: { x: 0, y: 0, width: width ?? 1, height: height ?? 1 },
    });
  }
  return store;
}

/** The still a fixture path shows (the live line's `screenshotStillUrl`). */
export function fixtureStillUrl(path: string): string {
  return FIXTURE_CLIPBOARD.find((mini) => mini.path === path)?.url ?? lineFixtureStill(path, 200);
}

const TYPING: readonly DraftPart[] = [
  { kind: "text", text: "Compare " },
  {
    kind: "chip",
    chip: { id: "fx-chip", kind: "capture", label: "1440 × 900", path: "/stills/1.png" },
  },
  { kind: "text", text: " with the deck and say what moved" },
];

const AIM: LineAim = { sessionId: "s-vibe", name: "vibe-field" };

// SEND TO…'s chips (DK-14; DESIGN.md §8 "Send to…"; R15): the faces the product makes (field/desk/send/send-face.ts) —
// a note's paper and ink from the palette the desk is dressed in, `snippets` and its first 24 characters; a kind's name
// and no glyph; several, `package` and "N objects"; a missing face its type's name.
const PAPERS = deskPalette("light");
export const FIXTURE_NOTE_CHIP: DeskChip = {
  id: "fx-send-note",
  kind: "desk",
  label: "Ship the desk by Friday,…",
  glyph: "snippets",
  ...(PAPERS.papers?.["yellow"] === undefined ? {} : { paper: PAPERS.papers["yellow"].css }),
  ...(PAPERS.pens?.["fountain"] === undefined ? {} : { ink: PAPERS.pens["fountain"].css }),
  objects: [{ type: "desk.note", name: "Note", text: "Ship the desk by Friday, then the covers" }],
  still: { url: "", width: 480, height: 480, bytes: 41_000 },
};
const kindChip = (id: string, label: string, glyph: DeskChip["glyph"], n = 1): DeskChip => ({
  id,
  kind: "desk",
  label,
  glyph,
  objects: Array.from({ length: n }, () => ({ type: "x", name: label, text: null })),
  still: null,
});
const SENT: readonly DraftPart[] = [
  { kind: "chip", chip: FIXTURE_NOTE_CHIP },
  { kind: "text", text: " @" },
];
const FACES: readonly DraftPart[] = [
  { kind: "chip", chip: kindChip("fx-send-clock", "Clock", null) },
  { kind: "text", text: " " },
  { kind: "chip", chip: kindChip("fx-send-two", "2 objects", "package", 2) },
  { kind: "text", text: " " },
  // a missing face (its plugin off): its type's name, as the manifest gives it
  { kind: "chip", chip: kindChip("fx-send-missing", "Clock", null) },
  { kind: "text", text: " " },
];
const SENT_AIMED: readonly DraftPart[] = [
  { kind: "chip", chip: kindChip("fx-send-aimed", "Clock", null) },
  { kind: "text", text: " " },
];

/** @'s list as the page draws it: nothing typed after the @ yet. */
export function fixtureAtList(view: FrameView): AtList {
  return atList({
    view,
    panes: FIXTURE_PANES,
    clipboard: FIXTURE_CLIPBOARD,
    canCapture: true,
    query: "",
  });
}

/** One state of the line, at its place at a plate's foot. */
export function ComposerLinePlate({
  state,
  keys = "mac",
}: {
  state: LineState;
  keys?: ViewKeys;
}): ReactElement {
  const view = VIEW_OF[state];
  const list = state === "at" || state === "sent" ? fixtureAtList(view) : null;
  const seed: readonly DraftPart[] =
    state === "typing"
      ? TYPING
      : state === "at"
        ? [{ kind: "text", text: "@" }]
        : state === "sent"
          ? SENT
          : state === "faces"
            ? FACES
            : state === "sent-aimed"
              ? SENT_AIMED
              : [];
  // The refusal's note lives 2.4s and goes, as in the product; on its plate it
  // is said again every 2.6s, so the state can be looked at rather than caught.
  const [said, setSaid] = useState(1);
  useEffect(() => {
    if (state !== "refused") return;
    const timer = window.setInterval(() => setSaid((count) => count + 1), 2_600);
    return () => window.clearInterval(timer);
  }, [state]);
  // @'s list grows from the @ it was typed at, 10 before it — measured as the
  // controller measures it, here off the plate the line stands in.
  const plateRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const [atLeft, setAtLeft] = useState(0);
  useLayoutEffect(() => {
    const plate = plateRef.current;
    const editor = editorRef.current;
    if ((state !== "at" && state !== "sent") || plate === null || editor === null) return;
    // grown from the @: the draft's own text up to it (the sent chip stands before it)
    const at = [...editor.childNodes].find(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes("@"),
    );
    if (at !== undefined) {
      const range = document.createRange();
      range.setStart(at, (at.textContent ?? "").indexOf("@"));
      range.collapse(true);
      setAtLeft(
        Math.max(
          8,
          Math.round(range.getBoundingClientRect().left - plate.getBoundingClientRect().left - 10),
        ),
      );
      return;
    }
    setAtLeft(
      Math.max(
        8,
        Math.round(editor.getBoundingClientRect().left - plate.getBoundingClientRect().left - 10),
      ),
    );
  }, [state]);
  return (
    <div ref={plateRef} className="vf-ds-line-plate" data-state={state} data-keys={keys}>
      <ComposerLineView
        view={view}
        keys={keys}
        track={<ViewsTrackView view={view} keys={keys} />}
        objectsOpen={state === "objects"}
        createHeld={state === "held"}
        createWaits={view === "history" ? "choose a session first" : null}
        aim={state === "aimed" || state === "sent-aimed" ? AIM : null}
        seed={seed}
        revision={1}
        blank={seed.length === 0}
        canSend={state === "typing" || state === "sent-aimed" || state === "faces"}
        atOpen={list !== null}
        editorRef={editorRef}
        note={
          state === "refused"
            ? {
                seq: said,
                text: inputRefusalNote(FIXTURE_REFUSAL, FIXTURE_PANES[0]?.name),
                at: "send",
              }
            : null
        }
      />
      {list === null ? null : <AtMenuView list={list} hot={atDefaultHot(list)} left={atLeft} />}
    </div>
  );
}

/**
 * Send to…'s FLIGHT, frozen (DK-14; DESIGN.md §8 "Send to…"): the line at the plate's foot and the chip of the note's
 * face — the shipping flier, the face the draft's chip wears — on its straight line from the selection (the plate's
 * upper left) to the caret, at `t` of the 560 ms on the island curve (`ease`: the curve's progress there), its scale
 * 1.25 → 0.86 along the way. The product moves it by one CSS transition; a plate stands it still.
 */
export function SendFlightPlate({
  t = 0.3,
  ease = 0.78,
}: {
  t?: number;
  ease?: number;
}): ReactElement {
  const plateRef = useRef<HTMLDivElement>(null);
  const flierRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const plate = plateRef.current;
    const flier = flierRef.current;
    const editor = plate?.querySelector(".vf-line-input");
    if (plate === null || flier === null || editor === null || editor === undefined) return;
    const p = plate.getBoundingClientRect();
    const e = editor.getBoundingClientRect();
    const w = flier.offsetWidth;
    const h = flier.offsetHeight;
    const from = { x: 140, y: 70 };
    const to = { x: e.left - p.left + w / 2, y: e.top - p.top + e.height / 2 };
    const x = from.x + (to.x - from.x) * ease - w / 2;
    const y = from.y + (to.y - from.y) * ease - h / 2;
    const scale = SEND_MOTION.fromScale + (SEND_MOTION.toScale - SEND_MOTION.fromScale) * ease;
    flier.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;
  }, [ease]);
  return (
    <div
      ref={plateRef}
      className="vf-ds-line-plate vf-ds-send-flight"
      data-state="flight"
      data-t={t}
      style={{ "--vf-ds-flight-from": "140px 70px" } as CSSProperties}
    >
      <span className="vf-ds-send-from" aria-hidden="true" />
      <ComposerLineView
        view="canvas"
        keys="mac"
        track={<ViewsTrackView view="canvas" keys="mac" />}
        seed={[]}
        revision={1}
        blank
      />
      <ChipFlierView chip={FIXTURE_NOTE_CHIP} flierRef={flierRef} />
    </div>
  );
}
