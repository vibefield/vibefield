// @vitest-environment happy-dom
/**
 * One Frame FR-2, LN-D1 — the line, at the grain the repo tests chrome: the
 * shipping composition `[views] snapshot create` on its real controller, its ONE
 * owner of the open surface (a stateful harness stands where FieldView does),
 * the snapshot's act on a fixture host dealing into a fixture hand, the frame's
 * note at its two places, the create's keys, and History's create — New
 * terminal through History's door (HN-7). The model is `line-model.test.ts`'s;
 * the delivery of B and ⌘T from a focused pane in a live window is the godview
 * smoke's row 11h.
 */
import type { FrameView, ScreenshotCaptureResult } from "@vibefield/contracts";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardLineDoor } from "../src/field/desk/pegboard/board-door";
import { Composer, type ComposerHost } from "../src/frame/Composer";
import { noteCapture, resetCaptureStateForTest } from "../src/frame/capture-state";
import { CardStore } from "../src/frame/cards/cards-store";
import type { FrameSurface } from "../src/frame/frame-surface";
import {
  claimingRefusals,
  type HistoryLineDoor,
  type LineViewDoor,
  resetHistoryLineDoorForTest,
  runChosenSession,
  sayOnHistoryLine,
  sayOnLine,
} from "../src/frame/line-door";
import { ViewsTrackView } from "../src/frame/ViewsTrack";
import type { ViewKeys } from "../src/frame/views";
import { pasteIntoPane } from "../src/godview/line-panes";
import { type FieldHost, setHost } from "../src/host";
import type { RendererLogger } from "../src/logging";
import type { RoutedInputRefusal } from "../src/terminal/pool";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let pane: HTMLElement | null = null;
let surfaceNow: FrameSurface | null = null;
let setViewNow: ((view: FrameView) => void) | null = null;
let setHeldNow: ((held: boolean) => void) | null = null;
let boardOpenNow = false;
let toggles: boolean[] = [];
/** D6 — the line's hearer of refused input, as the pool would hold it. */
let hearRefusal: ((refusal: RoutedInputRefusal) => void) | null = null;
const inputRefusals = (hear: (refusal: RoutedInputRefusal) => void): (() => void) => {
  hearRefusal = hear;
  return () => {
    if (hearRefusal === hear) hearRefusal = null;
  };
};

function door(overrides: Partial<LineViewDoor> = {}): LineViewDoor {
  return {
    panes: [
      {
        paneId: "p1",
        sessionId: "s-vibe",
        name: "vibe-field",
        runs: "Claude Code",
        state: "working",
        active: true,
      },
      {
        paneId: "p2",
        sessionId: "s-ros",
        name: "rosetta",
        runs: "Codex",
        state: "idle",
        active: false,
      },
    ],
    onScreen: true,
    newTerminal: vi.fn(async () => ({ state: "opened" as const })),
    pasteInto: vi.fn(() => true),
    whenInputOpen: vi.fn(async () => true),
    canPlace: true,
    place: vi.fn(async () => ({ state: "opened" as const })),
    reveal: vi.fn(async () => ({ state: "opened" as const })),
    ...overrides,
  };
}

/** What History lends the line (HN-7): the room shows vibe-field, and its New terminal opens. */
function historyDoor(overrides: Partial<HistoryLineDoor> = {}): HistoryLineDoor {
  return {
    chosen: null,
    waits: null,
    live: false,
    resume: vi.fn(async () => ({ state: "resumed" as const })),
    jump: vi.fn(async () => ({ state: "jumped" as const })),
    project: "vibe-field",
    newTerminal: vi.fn(async () => ({ state: "opened" as const })),
    ...overrides,
  };
}

/** What the snapshot tool kept: a region of the window, on disk and on the clipboard. */
const KEPT: ScreenshotCaptureResult = {
  status: "ok",
  path: "/stills/region.png",
  width: 600,
  height: 400,
  scale: 2,
  displayId: 1,
  bounds: { x: 100, y: 120, width: 300, height: 200 },
  screenBounds: { x: 100, y: 120, width: 300, height: 200 },
};

/** A capture door the test answers by hand: the tool is up until `answer`. */
function captureDoor(): {
  capture: () => Promise<ScreenshotCaptureResult>;
  answer: (result: ScreenshotCaptureResult) => void;
  fail: (cause: unknown) => void;
  asked: () => number;
} {
  let asked = 0;
  let settle: { ok: (r: ScreenshotCaptureResult) => void; no: (c: unknown) => void } | null = null;
  return {
    capture: () => {
      asked += 1;
      return new Promise<ScreenshotCaptureResult>((ok, no) => {
        settle = { ok, no };
      });
    },
    answer: (result) => settle?.ok(result),
    fail: (cause) => settle?.no(cause),
    asked: () => asked,
  };
}

interface Mount {
  door: LineViewDoor | null;
  /** History's door (HN-7): a fixture door when given; undefined, the published one (none). */
  history?: HistoryLineDoor;
  /** The board's door (DK-13): a fixture board when given — undefined, the published one (no desk here: none). */
  board?: { held: boolean; open?: boolean };
  host: ComposerHost;
  cards: CardStore;
  keys: ViewKeys;
  /** Whether the line binds the window's keys (the catalog's live line does not). */
  bindKeys: boolean;
}

function mount(view: FrameView, options: Partial<Mount> = {}): Mount {
  const used: Mount = {
    door: options.door === undefined ? door() : options.door,
    ...(options.history === undefined ? {} : { history: options.history }),
    // a capture door that never answers unless a row hands its own: the snapshot at rest is
    // ready ("Snapshot  ⌃⌘A"); a row that wants no door says `host: {}`
    host: options.host ?? {
      screenshotCapture: () => new Promise<ScreenshotCaptureResult>(() => undefined),
      screenshotStillUrl: (path) => `still://${path}`,
    },
    cards: options.cards ?? new CardStore(() => 1_000),
    keys: options.keys ?? "mac",
    bindKeys: options.bindKeys ?? true,
  };
  function Owner(): React.ReactElement {
    // FieldView's place: the one owner of the line's open surface.
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    const [shown, setShown] = useState<FrameView>(view);
    const [boardOpen, setBoardOpen] = useState(options.board?.open ?? false);
    const [held, setHeld] = useState(options.board?.held ?? false);
    surfaceNow = surface;
    setViewNow = setShown;
    setHeldNow = setHeld;
    boardOpenNow = boardOpen;
    const objects: BoardLineDoor | undefined =
      options.board === undefined
        ? undefined
        : {
            open: boardOpen,
            held,
            toggle(keyboard) {
              toggles.push(keyboard);
              // the desk's own rule: refused in hand (R14)
              if (held && !boardOpen) return false;
              setBoardOpen(!boardOpen);
              return !boardOpen;
            },
          };
    return (
      <Composer
        view={shown}
        keys={used.keys}
        track={<ViewsTrackView view={shown} keys={used.keys} />}
        surface={surface}
        onSurfaceChange={setSurface}
        godview={used.door}
        {...(used.history === undefined ? {} : { history: used.history })}
        {...(objects === undefined ? {} : { objects })}
        host={used.host}
        cards={used.cards}
        inputRefusals={inputRefusals}
        bindKeys={used.bindKeys}
      />
    );
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Owner />));
  return used;
}

beforeEach(() => {
  surfaceNow = null;
  toggles = [];
  boardOpenNow = false;
  setHost({
    logger: {} as RendererLogger,
    getConnection: () => Promise.resolve({ port: 1, token: "t" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    platform: "darwin",
  } as FieldHost);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  pane?.remove();
  root = null;
  host = null;
  pane = null;
  resetHistoryLineDoorForTest();
  resetCaptureStateForTest();
  vi.useRealTimers();
});

const q = <T extends Element = HTMLElement>(selector: string): T => {
  const element = host?.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const create = (): HTMLButtonElement => q<HTMLButtonElement>(".vf-line-create");
const snapshot = (): HTMLButtonElement => q<HTMLButtonElement>(".vf-line-snapshot");
const shownGlyph = (): string | null =>
  create().querySelector("[data-shown] [data-glyph]")?.getAttribute("data-glyph") ?? null;

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("the line's composition (DESIGN.md §8; LN-D1)", () => {
  it("draws [views] snapshot create — no draft, no mic, no send — and the note after them when the frame speaks", () => {
    mount("canvas");
    const line = q(".vf-line");
    expect(line.getAttribute("aria-label")).toBe("The line");
    expect([...line.children].map((child) => child.className)).toEqual([
      "vf-views-line",
      "vf-line-snapshot",
      "vf-line-create",
    ]);
    // the four view cells, the snapshot and the create: nothing to type into, nothing to send
    expect(line.querySelectorAll("button")).toHaveLength(4 + 2);
    expect(line.querySelector("[contenteditable], input, textarea")).toBeNull();
    for (const gone of [".vf-line-input", ".vf-line-mic", ".vf-line-send", ".vf-line-rule"]) {
      expect(host?.querySelector(gone)).toBeNull();
    }
    act(() => {
      sayOnLine("Could not jump — its pane is gone from the deck");
    });
    expect([...line.children].map((child) => child.className)).toEqual([
      "vf-views-line",
      "vf-line-snapshot",
      "vf-line-create",
      "vf-line-note",
    ]);
  });

  it("gives each view its own create — only Canvas's is a bare plus (FR-3, FC-D3)", () => {
    mount("canvas");
    expect(shownGlyph()).toBe("plus");
    expect(create().getAttribute("title")).toBe("Objects  B");
    expect(create().getAttribute("aria-keyshortcuts")).toBe("B");
    expect(create().getAttribute("aria-expanded")).toBe("false");
    act(() => setViewNow?.("godview"));
    expect(shownGlyph()).toBe("start");
    expect(create().getAttribute("title")).toBe("New terminal  ⌘T");
    expect(create().getAttribute("aria-keyshortcuts")).toBe("Meta+T");
    expect(create().hasAttribute("aria-expanded")).toBe(false);
    // HN-7 (LN-D2): History's create is Godview's act — no longer Resume, waiting on a choice
    // (the chosen session's Resume is the palette's row now: command-palette.test.tsx)
    act(() => setViewNow?.("history"));
    expect(shownGlyph()).toBe("start");
    expect(create().getAttribute("aria-label")).toBe("New terminal");
    expect(create().hasAttribute("aria-disabled")).toBe(false);
    expect(create().getAttribute("title")).toBe("New terminal  ⌘T");
    expect(create().getAttribute("aria-keyshortcuts")).toBe("Meta+T");
  });

  it("reads each key off the act it names, the platform's way — never a letter hard-coded", () => {
    mount("godview", { keys: "other" });
    expect(create().getAttribute("title")).toBe("New terminal  Ctrl+T");
    expect(create().getAttribute("aria-keyshortcuts")).toBe("Control+T");
    expect(snapshot().getAttribute("title")).toBe("Snapshot  Alt+A");
    expect(snapshot().getAttribute("aria-keyshortcuts")).toBe("Alt+A");
  });
});

describe("the snapshot (HN-D2; SNAP's door on the line)", () => {
  it("stands between the views and the act, a ghost that says main's key: Snapshot  ⌃⌘A", () => {
    mount("canvas");
    expect(snapshot().getAttribute("aria-label")).toBe("Snapshot");
    expect(snapshot().getAttribute("title")).toBe("Snapshot  ⌃⌘A");
    expect(snapshot().getAttribute("aria-keyshortcuts")).toBe("Control+Meta+A");
    expect(snapshot().hasAttribute("aria-disabled")).toBe(false);
    expect(snapshot().hasAttribute("data-on")).toBe(false);
    expect(snapshot().querySelector("svg")?.getAttribute("data-glyph")).toBe("capture");
  });

  it("deals what the tool kept into the hand as ONE picture card, from its region — filled until the tool answers", async () => {
    const tool = captureDoor();
    const used = mount("canvas", {
      host: { screenshotCapture: tool.capture, screenshotStillUrl: (path) => `still://${path}` },
    });
    act(() => snapshot().click());
    expect(tool.asked()).toBe(1);
    expect(snapshot().getAttribute("data-on")).toBe("true");
    // the tool is modal, one at a time: a second press while it is up asks nothing
    act(() => snapshot().click());
    expect(tool.asked()).toBe(1);
    expect(used.cards.snapshot().cards).toEqual([]);
    await act(async () => tool.answer(KEPT));
    expect(snapshot().hasAttribute("data-on")).toBe(false);
    const { cards, arriving } = used.cards.snapshot();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      kind: "pict",
      origin: { view: "canvas", how: "snapshot" },
      at: 1_000,
      title: "Snapshot",
      width: 600,
      height: 400,
      src: "still:///stills/region.png",
      path: "/stills/region.png",
      paste: "/stills/region.png",
    });
    // it leaves the region it was taken of (window px: the region less the window's screen origin)
    const from = arriving.get(cards[0]?.id ?? "");
    expect(from).toEqual({ left: 100, top: 120, width: 300, height: 200 });
    expect(host?.querySelector(".vf-line-note")).toBeNull();
  });

  it("deals the card as taken in the view it was pressed in", async () => {
    const tool = captureDoor();
    const used = mount("godview", { host: { screenshotCapture: tool.capture } });
    act(() => snapshot().click());
    await act(async () => tool.answer(KEPT));
    expect(used.cards.snapshot().cards[0]?.origin).toEqual({ view: "godview", how: "snapshot" });
  });

  it("fills for its own press only: a capture main ran (⌃⌘A, the View menu) is heard as its result and fills nothing (LC-17)", () => {
    const tool = captureDoor();
    mount("canvas", { host: { screenshotCapture: tool.capture } });
    // the hand's subscription hears main's capture when it is over — its result, never its start —
    // so the tool's own overlay is that capture's signal, and the line's snapshot stays a ghost
    act(() => noteCapture(KEPT));
    expect(snapshot().hasAttribute("data-on")).toBe(false);
    expect(tool.asked()).toBe(0);
  });

  it("says a capture that failed on the line, from its left — and nothing at all of a cancel", async () => {
    const tool = captureDoor();
    const used = mount("canvas", { host: { screenshotCapture: tool.capture } });
    act(() => snapshot().click());
    await act(async () => tool.answer({ status: "cancel" }));
    expect(host?.querySelector(".vf-line-note")).toBeNull();
    expect(snapshot().hasAttribute("data-on")).toBe(false);
    act(() => snapshot().click());
    await act(async () =>
      tool.answer({
        status: "error",
        code: "permission-denied",
        message: "Screen Recording is off",
      }),
    );
    // the Snap tile's honest words, which moved to the line with the door
    expect(q(".vf-line-note").textContent).toBe(
      "Screen Recording is off — System Settings › Privacy & Security",
    );
    expect(q(".vf-line-note").getAttribute("data-at")).toBe("line");
    act(() => snapshot().click());
    await act(async () => tool.fail(new Error("the helper went away")));
    expect(q(".vf-line-note").textContent).toBe("Not captured — the helper went away");
    expect(snapshot().hasAttribute("data-on")).toBe(false);
    expect(used.cards.snapshot().cards).toEqual([]);
  });

  it("waits, faint, where the host lends no capture door — and its tooltip says why", () => {
    const used = mount("canvas", { host: {} });
    expect(snapshot().getAttribute("aria-disabled")).toBe("true");
    expect(snapshot().getAttribute("title")).toBe("Snapshot — no capture here");
    act(() => snapshot().click());
    expect(snapshot().hasAttribute("data-on")).toBe(false);
    expect(used.cards.snapshot().cards).toEqual([]);
  });

  // R-B 4 — the door can be there and the tool still unable to capture: what it answered is kept
  // (capture-state.ts), from the line's own press and from main's ⌃⌘A alike
  it("waits, faint, once the tool says no capture helper is here — until a still is kept again", async () => {
    const tool = captureDoor();
    mount("canvas", { host: { screenshotCapture: tool.capture } });
    act(() => snapshot().click());
    await act(async () =>
      tool.answer({ status: "error", code: "helper-missing", message: "no helper was built" }),
    );
    expect(q(".vf-line-note").textContent).toBe(
      "Not captured — no capture helper on this platform",
    );
    expect(snapshot().getAttribute("aria-disabled")).toBe("true");
    expect(snapshot().getAttribute("title")).toBe("Snapshot — no capture helper on this platform");
    act(() => snapshot().click());
    expect(tool.asked()).toBe(1);
    // ⌃⌘A, run by main once the helper is built, kept a still: the hand's subscription notes it
    act(() => noteCapture(KEPT));
    expect(snapshot().hasAttribute("aria-disabled")).toBe(false);
    expect(snapshot().getAttribute("title")).toBe("Snapshot  ⌃⌘A");
  });

  it("says Screen Recording is off in its tooltip and stays pressable — a press asks the system again", async () => {
    const tool = captureDoor();
    mount("canvas", { host: { screenshotCapture: tool.capture } });
    act(() => snapshot().click());
    await act(async () =>
      tool.answer({
        status: "error",
        code: "permission-denied",
        message: "Screen Recording is off",
      }),
    );
    expect(snapshot().hasAttribute("aria-disabled")).toBe(false);
    expect(snapshot().getAttribute("title")).toBe(
      "Snapshot — Screen Recording is off — System Settings › Privacy & Security",
    );
    act(() => snapshot().click());
    expect(tool.asked()).toBe(2);
    await act(async () => tool.answer(KEPT));
    expect(snapshot().getAttribute("title")).toBe("Snapshot  ⌃⌘A");
  });

  it("hears what main's ⌃⌘A learned of the tool, and keeps it through one at a time", () => {
    mount("canvas");
    act(() => {
      noteCapture({ status: "error", code: "unsupported-platform", message: "no helper here" });
    });
    expect(snapshot().getAttribute("aria-disabled")).toBe("true");
    act(() => {
      noteCapture({ status: "error", code: "busy", message: "one capture at a time" });
    });
    expect(snapshot().getAttribute("title")).toBe("Snapshot — no capture helper on this platform");
  });
});

describe("the hand's lab door (cards-lab.ts; R-T 2)", () => {
  it("is lent while the line owns the window — a smoke's hands for the window's hand — and taken back with it", () => {
    const used = mount("godview");
    const lab = window.__vfCards;
    if (lab === undefined) throw new Error("the line lent no lab door");
    act(() => {
      lab.deal("echo hn4 > /tmp/hn4.txt");
    });
    expect(used.cards.snapshot().cards.map((card) => card.paste)).toEqual([
      "echo hn4 > /tmp/hn4.txt",
    ]);
    act(() => root?.unmount());
    root = null;
    expect(window.__vfCards).toBeUndefined();
  });

  it("is never lent by a line that binds no window keys (the catalog's live line)", () => {
    mount("canvas", { bindKeys: false });
    expect(window.__vfCards).toBeUndefined();
  });
});

describe("one owner of the line's open surface (FR-4)", () => {
  it("folds what the line had open when the view changes", () => {
    mount("canvas");
    act(() => create().click());
    expect(surfaceNow).toBe("objects");
    expect(create().getAttribute("aria-expanded")).toBe("true");
    expect(create().getAttribute("title")).toBe("Close  Esc");
    act(() => setViewNow?.("godview"));
    expect(surfaceNow).toBeNull();
  });
});

describe("the frame's note on the line (DESIGN.md §8, §9)", () => {
  it("says the create's outcome and History's acts over the create, and what the frame says from the line's left", () => {
    mount("history");
    act(() => {
      sayOnHistoryLine("Resumed in the active pane");
    });
    expect(q(".vf-line-note").textContent).toBe("Resumed in the active pane");
    expect(q(".vf-line-note").getAttribute("data-at")).toBe("create");
    act(() => {
      sayOnLine("Waiting in Godview — restore the last run, or start clean");
    });
    expect(q(".vf-line-note").textContent).toBe(
      "Waiting in Godview — restore the last run, or start clean",
    );
    expect(q(".vf-line-note").getAttribute("data-at")).toBe("line");
  });

  it("lets a note go after 2.4 s, and says the same words twice when they are said twice", () => {
    vi.useFakeTimers();
    mount("canvas");
    act(() => {
      sayOnLine("Could not jump — its pane is gone from the deck");
    });
    const first = q(".vf-line-note");
    act(() => {
      sayOnLine("Could not jump — its pane is gone from the deck");
    });
    // a fresh note, keyed by its count: its animation starts again
    expect(q(".vf-line-note")).not.toBe(first);
    act(() => vi.advanceTimersByTime(2_399));
    expect(host?.querySelector(".vf-line-note")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(host?.querySelector(".vf-line-note")).toBeNull();
  });
});

// D6 — a paste a terminal refuses for its size: the runtime says nothing of an
// input it was not handed, so the line says it, in the note the frame speaks in
// (DESIGN.md §8, §9).
describe("what a terminal could not take (D6)", () => {
  it("says a refused paste on the line: the pane, its size, and how much of it one paste carries", () => {
    mount("godview");
    act(() => {
      hearRefusal?.({ sessionId: "s-vibe", kind: "paste", bytes: 300_000, limitBytes: 261_958 });
    });
    expect(q(".vf-line-note").textContent).toBe(
      "Not pasted into vibe-field — 300 KB, and one paste carries 261 KB of it",
    );
    expect(q(".vf-line-note").getAttribute("data-at")).toBe("line");
  });

  it("leaves every refusal heard while the frame's own paste runs to that paste's outcome — said once (HN-L5)", () => {
    mount("godview");
    const refused = (sessionId: string): RoutedInputRefusal => ({
      sessionId,
      kind: "paste",
      bytes: 300_000,
      limitBytes: 261_958,
    });
    // a card played onto vibe-field's pane: its paste claims what is refused while it runs
    act(() => {
      claimingRefusals(() => hearRefusal?.(refused("s-vibe")));
    });
    expect(host?.querySelector(".vf-line-note")).toBeNull();
    // whatever session the refusal names: the pane may show another by now (⌘T or a Resume while
    // the card waited for its input), and a refusal heard inside the paste is still the paste's
    act(() => {
      claimingRefusals(() => hearRefusal?.(refused("s-ros")));
    });
    expect(host?.querySelector(".vf-line-note")).toBeNull();
    // only while its paste runs: a refusal after it is the line's to say
    act(() => {
      hearRefusal?.(refused("s-vibe"));
    });
    expect(q(".vf-line-note").textContent).toBe(
      "Not pasted into vibe-field — 300 KB, and one paste carries 261 KB of it",
    );
  });

  it("names the terminal plainly when no pane shows it, and says typed text in its own words", () => {
    mount("canvas");
    act(() => {
      hearRefusal?.({ sessionId: "s-gone", kind: "text", bytes: 299_001, limitBytes: 261_958 });
    });
    // 299,001 bytes is said as 300 KB: a size is rounded up, what fits down, never equal
    expect(q(".vf-line-note").textContent).toBe(
      "Not typed into the terminal — 300 KB, and typed text carries 261 KB of it",
    );
  });

  it("says a paste past what the parts carry in tenths of a megabyte", () => {
    mount("godview");
    act(() => {
      hearRefusal?.({ sessionId: "s-ros", kind: "paste", bytes: 4_194_306, limitBytes: 4_194_304 });
    });
    expect(q(".vf-line-note").textContent).toBe(
      "Not pasted into rosetta — 4.2 MB, and one paste carries 4.1 MB of it",
    );
  });

  it("keeps each refusal under 70 characters beside the pane's name, to be read before it fades", () => {
    // The note lives 2.4s (DESIGN.md §8) as one nowrap line from the line's
    // left edge (composer.css) — a longer sentence is gone before it is read.
    const name = "vibe-field";
    const said: number[] = [];
    mount("godview");
    // Sizes as the units roll over (999.9 MB is the longest a clipboard says),
    // and what fits as it can be: a message's room of plain text, of nothing
    // but control characters (six bytes each), a paste in parts.
    for (const kind of ["paste", "text"] as const) {
      for (const bytes of [300_000, 999_999, 4_194_306, 999_850_000, 2_500_000_001]) {
        for (const limitBytes of [43_690, 261_958, 4_194_304]) {
          act(() => {
            hearRefusal?.({ sessionId: "s-vibe", kind, bytes, limitBytes });
          });
          said.push((q(".vf-line-note").textContent ?? "").length - name.length);
        }
      }
    }
    expect(Math.max(...said)).toBeLessThan(70);
  });

  it("stops hearing when the line goes", () => {
    mount("godview");
    expect(hearRefusal).not.toBeNull();
    act(() => root?.unmount());
    root = null;
    expect(hearRefusal).toBeNull();
  });
});

describe("the create's keys (DESIGN.md §10; One Frame §11)", () => {
  it("B toggles Objects on Canvas — never while typing, never under a cover", () => {
    mount("canvas");
    press(document.body, { key: "b" });
    expect(surfaceNow).toBe("objects");
    press(document.body, { key: "b" });
    expect(surfaceNow).toBeNull();
    // a field anywhere in the window keeps its b (the palette's, a note's)
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    press(field, { key: "b" });
    expect(surfaceNow).toBeNull();
    field.remove();
    // …but a control a person does not type in holds no caret: B is Objects' (the one field
    // test, cards/caret.ts)
    const box = document.createElement("input");
    box.type = "checkbox";
    document.body.appendChild(box);
    box.focus();
    press(box, { key: "b" });
    expect(surfaceNow).toBe("objects");
    press(box, { key: "b" });
    expect(surfaceNow).toBeNull();
    box.remove();
    act(() => setViewNow?.("godview"));
    press(document.body, { key: "b" });
    expect(surfaceNow).toBeNull();
    // ⌘B and the like are not B
    act(() => setViewNow?.("canvas"));
    press(document.body, { key: "b", metaKey: true });
    expect(surfaceNow).toBeNull();
  });

  it("⌘T asks Godview's deck for a new terminal from a focused pane, which never hears it", async () => {
    const used = mount("godview");
    const heard: string[] = [];
    pane = document.createElement("div");
    pane.tabIndex = 0;
    pane.addEventListener("keydown", (event) => {
      heard.push(event.key);
      event.stopPropagation();
    });
    document.body.appendChild(pane);
    pane.focus();
    let event: KeyboardEvent | null = null;
    await act(async () => {
      event = press(pane as HTMLElement, { key: "t", code: "KeyT", metaKey: true });
    });
    expect((event as KeyboardEvent | null)?.defaultPrevented).toBe(true);
    expect(used.door?.newTerminal).toHaveBeenCalledTimes(1);
    expect(heard).toEqual([]);
    expect(q(".vf-line-note").textContent).toBe("Terminal opened in the active pane");
    expect(q(".vf-line-note").getAttribute("data-at")).toBe("create");
  });

  it("⌘T in History asks History's door from a focused pane, which never hears it (HN-7)", async () => {
    const history = historyDoor();
    const used = mount("history", { history });
    const heard: string[] = [];
    pane = document.createElement("div");
    pane.tabIndex = 0;
    pane.addEventListener("keydown", (event) => {
      heard.push(event.key);
      event.stopPropagation();
    });
    document.body.appendChild(pane);
    pane.focus();
    let event: KeyboardEvent | null = null;
    await act(async () => {
      event = press(pane as HTMLElement, { key: "t", code: "KeyT", metaKey: true });
    });
    expect((event as KeyboardEvent | null)?.defaultPrevented).toBe(true);
    // History's own door — never Godview's deck asked directly from History
    expect(history.newTerminal).toHaveBeenCalledTimes(1);
    expect(used.door?.newTerminal).not.toHaveBeenCalled();
    expect(heard).toEqual([]);
    expect(q(".vf-line-note").textContent).toBe("Terminal opened in the active pane");
    expect(q(".vf-line-note").getAttribute("data-at")).toBe("create");
  });

  it("leaves ⌘T alone on Canvas, and Ctrl+T on the Mac in Godview and History", () => {
    const history = historyDoor();
    const used = mount("canvas", { history });
    expect(press(document.body, { key: "t", metaKey: true }).defaultPrevented).toBe(false);
    act(() => setViewNow?.("godview"));
    expect(press(document.body, { key: "t", ctrlKey: true }).defaultPrevented).toBe(false);
    act(() => setViewNow?.("history"));
    expect(press(document.body, { key: "t", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(used.door?.newTerminal).not.toHaveBeenCalled();
    expect(history.newTerminal).not.toHaveBeenCalled();
  });

  it("says a new terminal cannot open while the deck has no connection", async () => {
    mount("godview", { door: null });
    expect(create().getAttribute("aria-disabled")).toBe("true");
    expect(create().getAttribute("title")).toBe("New terminal — the deck is not connected yet");
    await act(async () => {
      press(document.body, { key: "t", metaKey: true });
    });
    expect(q(".vf-line-note").textContent).toBe(
      "Terminal could not be opened — the deck is not connected yet",
    );
  });
});

// HN-7 (LN-D2; DESIGN.md §8 "The line", §8 "History"): History's create is New terminal in the
// project the room shows. The line asks History's door, which finds the folder as New agent does
// and moves the window to Godview (history-view.test.tsx, history-host.test.tsx); the line names
// the project in its tooltip and says what came of it in Godview's words.
describe("History's create: New terminal in the project the room shows (HN-7)", () => {
  it("names the project in its tooltip, and a press asks History's door — the note in Godview's words, over the create", async () => {
    const history = historyDoor();
    const used = mount("history", { history });
    expect(shownGlyph()).toBe("start");
    expect(create().getAttribute("aria-label")).toBe("New terminal");
    expect(create().getAttribute("title")).toBe("New terminal in vibe-field  ⌘T");
    expect(create().hasAttribute("aria-disabled")).toBe(false);
    await act(async () => {
      create().click();
    });
    expect(history.newTerminal).toHaveBeenCalledTimes(1);
    expect(used.door?.newTerminal).not.toHaveBeenCalled();
    // the chosen session's acts are not the create's any more
    expect(history.resume).not.toHaveBeenCalled();
    expect(history.jump).not.toHaveBeenCalled();
    expect(q(".vf-line-note").textContent).toBe("Terminal opened in the active pane");
    expect(q(".vf-line-note").getAttribute("data-at")).toBe("create");
  });

  it("says a folder it could not open in, in the words History's door refused it with", async () => {
    const history = historyDoor({
      newTerminal: vi.fn(async () => ({
        state: "refused" as const,
        reason: "its volume is not connected",
      })),
    });
    mount("history", { history });
    await act(async () => {
      create().click();
    });
    expect(q(".vf-line-note").textContent).toBe(
      "Terminal could not be opened — its volume is not connected",
    );
  });

  it("names no project while the room shows none: its tooltip is Godview's create's", () => {
    mount("history", { history: historyDoor({ project: null }) });
    expect(create().getAttribute("title")).toBe("New terminal  ⌘T");
  });

  it("says so, rather than nothing, when pressed before History has lent its door", async () => {
    // History publishes its door as it mounts; a press in the moment before is said in words
    mount("history");
    expect(create().getAttribute("title")).toBe("New terminal  ⌘T");
    expect(create().hasAttribute("aria-disabled")).toBe(false);
    await act(async () => {
      create().click();
    });
    expect(q(".vf-line-note").textContent).toBe(
      "Terminal could not be opened — History is still opening",
    );
  });
});

// The chosen session's act — Resume, or Jump to while it runs here (P3) — was the line's create
// until HN-7; the palette's History row runs it since (`runChosenSession`, ChromeLayer's glue), and
// what it comes to is said where it always was: over the create, in the same words.
describe("History's chosen session, as the palette's row runs it (HN-7)", () => {
  it("resumes it, or jumps to it while it runs here, and says what came of it over the create", async () => {
    mount("history", { history: historyDoor() });
    const chosen = historyDoor({ chosen: "ses-1" });
    await act(async () => {
      await runChosenSession(chosen);
    });
    expect(chosen.resume).toHaveBeenCalledTimes(1);
    expect(chosen.newTerminal).not.toHaveBeenCalled();
    expect(q(".vf-line-note").textContent).toBe("Resumed in the active pane");
    expect(q(".vf-line-note").getAttribute("data-at")).toBe("create");
    // running here it is Jump to, whatever the launcher read of a resume (P3)
    const live = historyDoor({ chosen: "ses-1", live: true, waits: "its folder is gone" });
    await act(async () => {
      await runChosenSession(live);
    });
    expect(live.jump).toHaveBeenCalledTimes(1);
    expect(live.resume).not.toHaveBeenCalled();
    expect(q(".vf-line-note").textContent).toBe("Jumped to its pane");
  });

  it("says why it waits in Resume's words, and asks nothing — no choice, or the launcher's reason", async () => {
    mount("history", { history: historyDoor() });
    const none = historyDoor();
    await act(async () => {
      await runChosenSession(none);
    });
    expect(none.resume).not.toHaveBeenCalled();
    expect(q(".vf-line-note").textContent).toBe("Could not resume — choose a session first");
    const waits = historyDoor({ chosen: "ses-1", waits: "its folder is gone" });
    await act(async () => {
      await runChosenSession(waits);
    });
    expect(waits.resume).not.toHaveBeenCalled();
    expect(waits.jump).not.toHaveBeenCalled();
    expect(q(".vf-line-note").textContent).toBe("Could not resume — its folder is gone");
    // History's door not lent at all (the published one, none here): the same words
    await act(async () => {
      await runChosenSession();
    });
    expect(q(".vf-line-note").textContent).toBe("Could not resume — choose a session first");
  });
});

describe("the deck's paste (line-panes.ts): what a pane takes", () => {
  it("pastes through the pane's own input — focused, as ⌘V would — and reports the take", () => {
    const deck = document.createElement("div");
    deck.innerHTML = `<div data-pane-id="p1"><textarea class="terminal-input"></textarea></div>`;
    document.body.appendChild(deck);
    const input = deck.querySelector("textarea") as HTMLTextAreaElement;
    const pasted: string[] = [];
    input.addEventListener("paste", (event) => {
      pasted.push((event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "");
      event.preventDefault();
    });
    expect(pasteIntoPane(deck, "p1", "run the tests")).toBe(true);
    expect(pasted).toEqual(["run the tests"]);
    expect(document.activeElement).toBe(input);
    expect(pasteIntoPane(deck, "p2", "nowhere")).toBe(false);
    deck.remove();
  });
});

describe('the create is the pegboard\'s door (DK-13; DESIGN.md §8 "The pegboard"; R14)', () => {
  /** A press by the pointer: a click with a press behind it (detail 1) — `click()` alone is the keys' (detail 0). */
  const pointerClick = (): void => {
    act(() => {
      create().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
  };
  it("calls the board's toggle and mirrors the board's open — the plus turned into ✕, Close  Esc", () => {
    mount("canvas", { board: { held: false } });
    pointerClick();
    expect(toggles).toEqual([false]);
    expect(boardOpenNow).toBe(true);
    expect(surfaceNow).toBe("objects");
    expect(create().getAttribute("aria-expanded")).toBe("true");
    expect(create().getAttribute("title")).toBe("Close  Esc");
    pointerClick();
    expect(boardOpenNow).toBe(false);
    expect(surfaceNow).toBeNull();
    expect(create().getAttribute("aria-expanded")).toBe("false");
  });

  it("mirrors the BOARD's open, not the surface's: a board out before the owner hears of it wears its ✕", () => {
    // the desk's own door opened it (a rig's), the frame's surface not yet told
    mount("canvas", { board: { held: false, open: true } });
    expect(surfaceNow).toBeNull();
    expect(create().getAttribute("aria-expanded")).toBe("true");
    expect(create().getAttribute("title")).toBe("Close  Esc");
  });

  it("asks the board for the focus when the keyboard raised it — B, or the create's own keys", () => {
    mount("canvas", { board: { held: false } });
    press(document.body, { key: "b" });
    expect(toggles).toEqual([true]);
    expect(surfaceNow).toBe("objects");
    press(document.body, { key: "b" });
    expect(toggles).toEqual([true, true]);
    expect(surfaceNow).toBeNull();
    // a click with no pointer behind it (Enter or Space on the create): detail 0
    act(() => {
      create().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    expect(toggles).toEqual([true, true, true]);
    act(() => {
      create().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(toggles).toEqual([true, true, true, false]);
  });

  it('is faint in hand — "Put it down first" — and neither its press nor B asks the board', () => {
    mount("canvas", { board: { held: true } });
    expect(create().getAttribute("title")).toBe("Put it down first");
    expect(create().getAttribute("aria-disabled")).toBe("true");
    expect(create().getAttribute("data-held")).toBe("true");
    const said = vi.spyOn(console, "log").mockImplementation(() => undefined);
    pointerClick();
    press(document.body, { key: "b" });
    expect(toggles).toEqual([]);
    expect(surfaceNow).toBeNull();
    expect(said.mock.calls.map((c) => String(c[0]))).toContain(
      'LINE_KEY {"key":"B","view":"canvas","outcome":"refused"}',
    );
    said.mockRestore();
    // put down: the create is the board's door again
    act(() => setHeldNow?.(false));
    expect(create().hasAttribute("aria-disabled")).toBe(false);
    expect(create().getAttribute("title")).toBe("Objects  B");
  });

  it("is never faint for the hand outside Canvas — Godview's create is its own", () => {
    mount("godview", { board: { held: true } });
    expect(create().hasAttribute("data-held")).toBe(false);
    expect(create().getAttribute("title")).not.toBe("Put it down first");
  });
});
