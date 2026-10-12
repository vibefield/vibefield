// @vitest-environment happy-dom
/**
 * One Frame FR-2 — the line, at the grain the repo tests chrome: the shipping
 * composition `[views] create │ draft mic send` on its real controller, its
 * ONE owner of the open surface (a stateful harness stands where FieldView
 * does), @ typed into the draft, chips in the sentence, the interim send, and
 * the create's keys. The model is `line-model.test.ts`'s; the delivery of B and
 * ⌘T from a focused pane in a live window is the godview smoke's row 11h.
 */
import type { FrameView } from "@vibefield/contracts";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardLineDoor } from "../src/field/desk/pegboard/board-door";
import { Composer } from "../src/frame/Composer";
import type { DeskChip } from "../src/frame/draft";
import type { FrameSurface } from "../src/frame/frame-surface";
import type { LineViewDoor } from "../src/frame/line-door";
import {
  type LineSendTicket,
  lineSendPhase,
  sendToLine,
  setLineSendPhase,
} from "../src/frame/line-send";
import { ViewsTrackView } from "../src/frame/ViewsTrack";
import { pasteIntoPane } from "../src/godview/line-panes";
import { type FieldHost, setHost } from "../src/host";
import { ClipboardStore } from "../src/hud/edge-tray/clipboard-store";
import type { RendererLogger } from "../src/logging";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let pane: HTMLElement | null = null;
let surfaceNow: FrameSurface | null = null;
let setViewNow: ((view: FrameView) => void) | null = null;
let setHeldNow: ((held: boolean) => void) | null = null;
let boardOpenNow = false;
let toggles: boolean[] = [];

function door(overrides: Partial<LineViewDoor> = {}): LineViewDoor {
  return {
    panes: [
      {
        sessionId: "s-vibe",
        name: "vibe-field",
        runs: "Claude Code",
        state: "working",
        active: true,
      },
      { sessionId: "s-ros", name: "rosetta", runs: "Codex", state: "idle", active: false },
    ],
    onScreen: true,
    newTerminal: vi.fn(async () => ({ state: "opened" as const })),
    paste: vi.fn(() => true),
    canPlace: true,
    place: vi.fn(async () => ({ state: "opened" as const })),
    reveal: vi.fn(async () => ({ state: "opened" as const })),
    ...overrides,
  };
}

function store(): ClipboardStore {
  const clipboard = new ClipboardStore(() => 0);
  clipboard.addCapture({
    status: "ok",
    path: "/stills/one.png",
    width: 1440,
    height: 900,
    scale: 2,
    displayId: 1,
    bounds: { x: 0, y: 0, width: 1440, height: 900 },
  });
  return clipboard;
}

interface Mount {
  door: LineViewDoor | null;
  /** The board's door (DK-13): a fixture board when given — undefined, the published one (no desk here: none). */
  board?: { held: boolean; open?: boolean };
  write: (text: string) => Promise<void>;
  clipboard: ClipboardStore;
}

function mount(view: FrameView, options: Partial<Mount> = {}): Mount {
  const used: Mount = {
    door: options.door === undefined ? door() : options.door,
    write: options.write ?? vi.fn(async () => undefined),
    clipboard: options.clipboard ?? store(),
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
        keys="mac"
        track={<ViewsTrackView view={shown} keys="mac" />}
        surface={surface}
        onSurfaceChange={setSurface}
        godview={used.door}
        {...(objects === undefined ? {} : { objects })}
        clipboard={used.clipboard}
        host={{ screenshotStillUrl: (path) => `still://${path}` }}
        writeClipboard={used.write}
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
  vi.useRealTimers();
});

const q = <T extends Element = HTMLElement>(selector: string): T => {
  const element = host?.querySelector<T>(selector);
  if (!element) throw new Error(`nothing matches ${selector}`);
  return element;
};
const editor = (): HTMLElement => q(".vf-line-input");
const create = (): HTMLButtonElement => q<HTMLButtonElement>(".vf-line-create");
const shownGlyph = (): string | null =>
  create().querySelector("[data-shown] [data-glyph]")?.getAttribute("data-glyph") ?? null;

/** Type into the draft the way the browser leaves it: the text in the editor,
 * the caret at its end, and an input event. */
function typeText(text: string): void {
  act(() => {
    const field = editor();
    field.focus();
    field.textContent = text;
    const node = field.firstChild;
    const range = document.createRange();
    if (node !== null) range.setStart(node, text.length);
    else range.setStart(field, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("the line's composition (DESIGN.md §8)", () => {
  it("draws [views] create │ draft mic send, the views track at its left end", () => {
    mount("canvas");
    const line = q(".vf-line");
    expect(line.getAttribute("aria-label")).toBe("The composer");
    expect([...line.children].map((child) => child.className)).toEqual([
      "vf-views-line",
      "vf-line-create",
      "vf-line-rule",
      "vf-line-draft",
      "vf-line-mic",
      "vf-line-send",
    ]);
    // FC-D1: no @ button, no attach button — four cells, create, mic, send
    const buttons = [...line.querySelectorAll("button")];
    expect(buttons).toHaveLength(4 + 3);
    expect(buttons.some((button) => /^@$|attach|mention/i.test(button.textContent ?? ""))).toBe(
      false,
    );
    expect(
      buttons.some((button) => /attach|mention/i.test(button.getAttribute("aria-label") ?? "")),
    ).toBe(false);
  });

  it("gives each view its own create — only Canvas's is a bare plus (FR-3, FC-D3)", () => {
    mount("canvas");
    expect(shownGlyph()).toBe("plus");
    expect(create().getAttribute("title")).toBe("Objects  B");
    expect(create().getAttribute("aria-expanded")).toBe("false");
    act(() => setViewNow?.("godview"));
    expect(shownGlyph()).toBe("start");
    expect(create().getAttribute("title")).toBe("New terminal  ⌘T");
    expect(create().getAttribute("aria-keyshortcuts")).toBe("Meta+T");
    expect(create().hasAttribute("aria-expanded")).toBe(false);
    act(() => setViewNow?.("history"));
    expect(shownGlyph()).toBe("resume");
    expect(create().getAttribute("aria-disabled")).toBe("true");
    expect(create().getAttribute("title")).toBe("Resume this session — choose a session first");
  });

  it("draws the mic waiting and says why — the desktop has no dictation door", () => {
    mount("canvas");
    const mic = q(".vf-line-mic");
    expect(mic.getAttribute("aria-disabled")).toBe("true");
    expect(mic.getAttribute("title")).toBe("Dictation — not on the desktop yet");
  });

  it("teaches the one way in at rest, and inverts send once there is something to send", () => {
    mount("canvas");
    expect(q(".vf-line-ph").textContent).toBe("Message, or type @ to add…");
    expect(q(".vf-line-send").getAttribute("aria-disabled")).toBe("true");
    typeText("ship it");
    expect(host?.querySelector(".vf-line-ph")).toBeNull();
    expect(q(".vf-line-send").getAttribute("data-armed")).toBe("true");
  });
});

describe("send stays quiet over a mention still being typed", () => {
  it("is not armed by a lone @, and is by a word beside it", () => {
    mount("canvas");
    typeText("@");
    expect(q(".vf-line-send").getAttribute("aria-disabled")).toBe("true");
    typeText("ask @");
    expect(q(".vf-line-send").getAttribute("data-armed")).toBe("true");
  });
});

describe("one owner of the line's open surface (FR-4)", () => {
  it("opens @'s list when @ is typed at a word's start, as the line's surface", () => {
    mount("canvas");
    typeText("ask @");
    expect(surfaceNow).toBe("at");
    expect(host?.querySelector(".vf-at-menu")).not.toBeNull();
    typeText("mail a@b");
    expect(surfaceNow).toBeNull();
    expect(host?.querySelector(".vf-at-menu")).toBeNull();
  });

  it("folds @'s list when Objects opens, and Objects when @ is typed — one value", () => {
    mount("canvas");
    typeText("@");
    expect(surfaceNow).toBe("at");
    act(() => create().click());
    expect(surfaceNow).toBe("objects");
    expect(create().getAttribute("aria-expanded")).toBe("true");
    expect(create().getAttribute("title")).toBe("Close  Esc");
    expect(host?.querySelector(".vf-at-menu")).toBeNull();
    typeText("@");
    expect(surfaceNow).toBe("at");
    expect(create().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes @'s list on Esc and keeps what was typed", () => {
    mount("canvas");
    typeText("ping @ro");
    const esc = press(editor(), { key: "Escape" });
    expect(esc.defaultPrevented).toBe(true);
    expect(surfaceNow).toBeNull();
    expect(editor().textContent).toBe("ping @ro");
  });

  it("folds what the line had open when the view changes", () => {
    mount("canvas");
    act(() => create().click());
    expect(surfaceNow).toBe("objects");
    act(() => setViewNow?.("godview"));
    expect(surfaceNow).toBeNull();
  });
});

describe("@'s list (FC-D1, FC-D14)", () => {
  it("leads with the panes in Godview, nearest against the line, the active one hot", () => {
    mount("godview");
    typeText("@");
    const menu = q(".vf-at-menu");
    expect(menu.getAttribute("role")).toBe("menu");
    expect([...menu.querySelectorAll(".vf-at-eye")].map((eye) => eye.textContent)).toEqual([
      "Add",
      "Send to a pane",
    ]);
    const rows = [...menu.querySelectorAll<HTMLElement>(".vf-at-row.is-aim")];
    expect(rows.map((row) => row.querySelector("b")?.textContent)).toEqual([
      "rosetta",
      "vibe-field",
    ]);
    expect(rows.at(-1)?.getAttribute("data-hot")).toBe("true");
    expect(menu.textContent).toContain("No file door on the desktop yet");
    expect(menu.textContent).toContain("No past-session door on the line yet");
  });

  it("takes the hot row on Return: a pane aims the draft, and the @ goes", () => {
    mount("canvas");
    typeText("@");
    press(editor(), { key: "ArrowUp" });
    expect(q(".vf-at-row.is-aim[data-hot]").textContent).toContain("rosetta");
    press(editor(), { key: "ArrowDown" });
    press(editor(), { key: "Enter" });
    expect(q('.vf-line-chip[data-chip="aim"]').textContent).toContain("@vibe-field");
    expect(q(".vf-line-ph").textContent).toBe("Message vibe-field…");
    expect(editor().textContent).toBe("");
    expect(surfaceNow).toBeNull();
  });

  it("filters both groups by the word after the @", () => {
    mount("godview");
    typeText("@ros");
    const menu = q(".vf-at-menu");
    expect([...menu.querySelectorAll(".vf-at-row")].map((row) => row.textContent)).toEqual([
      expect.stringContaining("rosetta"),
    ]);
  });

  it("sets the clipboard's still where the @ was, as a chip in the sentence", () => {
    mount("canvas");
    typeText("compare @");
    act(() => q<HTMLButtonElement>('[data-row="clipboard"]').click());
    const chip = q('.vf-line-input .vf-line-chip[data-chip="capture"]');
    expect(chip.textContent).toContain("1440 × 900");
    expect(chip.getAttribute("contenteditable")).toBe("false");
    expect(editor().textContent).toContain("compare");
    expect(editor().textContent).not.toContain("@");
  });
});

describe("the interim send (thinking-four-views §11)", () => {
  it("pastes into the aimed pane the deck shows, and says so", async () => {
    const used = mount("godview");
    typeText("@");
    press(editor(), { key: "Enter" });
    typeText("run the tests");
    await act(async () => {
      press(editor(), { key: "Enter" });
    });
    expect(used.door?.paste).toHaveBeenCalledWith("s-vibe", "run the tests");
    expect(used.write).not.toHaveBeenCalled();
    expect(q(".vf-line-note").textContent).toBe("Pasted into vibe-field");
    expect(q(".vf-line-note").getAttribute("data-at")).toBe("send");
    // the words go, the aim stays (CB-1)
    expect(editor().textContent).toBe("");
    expect(q('.vf-line-chip[data-chip="aim"]').textContent).toContain("vibe-field");
  });

  it("copies when nothing can take it, says why, and carries a chip as its path", async () => {
    const used = mount("canvas");
    typeText("compare @");
    act(() => q<HTMLButtonElement>('[data-row="clipboard"]').click());
    await act(async () => q<HTMLButtonElement>(".vf-line-send").click());
    expect(used.write).toHaveBeenCalledWith("compare /stills/one.png");
    expect(q(".vf-line-note").textContent).toBe("Copied — no agent takes a message from here yet");
    expect(editor().textContent).toBe("");
  });

  it("copies an aim at a pane that is not on screen, and says that is why", async () => {
    const used = mount("canvas", { door: door({ onScreen: false }) });
    typeText("@");
    press(editor(), { key: "Enter" });
    typeText("hello");
    await act(async () => {
      press(editor(), { key: "Enter" });
    });
    expect(used.door?.paste).not.toHaveBeenCalled();
    expect(used.write).toHaveBeenCalledWith("hello");
    expect(q(".vf-line-note").textContent).toBe("Copied — vibe-field's pane is not on screen");
  });

  it("copies an aim at a shown pane that would drop the paste, and says its input is why", async () => {
    // the deck's door answers false while the pane's input is closed
    const used = mount("godview", { door: door({ paste: vi.fn(() => false) }) });
    typeText("@");
    press(editor(), { key: "Enter" });
    typeText("run the tests");
    await act(async () => {
      press(editor(), { key: "Enter" });
    });
    expect(used.door?.paste).toHaveBeenCalledWith("s-vibe", "run the tests");
    expect(used.write).toHaveBeenCalledWith("run the tests");
    expect(q(".vf-line-note").textContent).toBe("Copied — vibe-field's pane is not taking input");
    // sent all the same: the words go, the aim stays
    expect(editor().textContent).toBe("");
    expect(q('.vf-line-chip[data-chip="aim"]').textContent).toContain("vibe-field");
  });

  it("keeps the draft when the clipboard refuses it, and says so", async () => {
    mount("canvas", { write: vi.fn(async () => Promise.reject(new Error("denied"))) });
    typeText("keep me");
    await act(async () => {
      press(editor(), { key: "Enter" });
    });
    expect(q(".vf-line-note").textContent).toBe("Not sent — the clipboard refused it");
    expect(editor().textContent).toBe("keep me");
  });
});

describe("the create's keys (DESIGN.md §10; One Frame §11)", () => {
  it("B toggles Objects on Canvas — never while typing in the draft, never under a cover", () => {
    mount("canvas");
    press(document.body, { key: "b" });
    expect(surfaceNow).toBe("objects");
    press(document.body, { key: "b" });
    expect(surfaceNow).toBeNull();
    typeText("abc");
    press(editor(), { key: "b" });
    expect(surfaceNow).toBeNull();
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

  it("leaves ⌘T alone outside Godview, and Ctrl+T on the Mac", () => {
    const used = mount("canvas");
    expect(press(document.body, { key: "t", metaKey: true }).defaultPrevented).toBe(false);
    act(() => setViewNow?.("godview"));
    expect(press(document.body, { key: "t", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(used.door?.newTerminal).not.toHaveBeenCalled();
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

describe("the interim send's paste (the deck's half)", () => {
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
    typeText("@");
    expect(surfaceNow).toBe("at");
    expect(create().getAttribute("aria-expanded")).toBe("true");
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

// ── DK-14 — SEND TO… INTO THE LINE (DESIGN.md §8 "Send to…"; R15; FC-D1) ────────────────────────────────────────────
// The desk's chrome hands the line ONE chip (`sendToLine`); the line sets it at the caret, the draft focused, after a
// flight from the selection (1.25 → 0.86, 560 ms on the island curve) — or, under reduced motion, a fade at the caret —
// then TYPES the @ 180 ms after it lands so @'s list opens as typing opens it, the caret after the chip. A draft already
// aimed takes it with no @ and send arms. The phase the bar steps aside for follows the list.
describe("Send to… lands ONE chip in the draft (DK-14)", () => {
  const FROM = { x0: 400, y0: 300, x1: 600, y1: 440 };
  const deskChip = (over: Partial<DeskChip> = {}): DeskChip => ({
    id: `dk14-${Math.random().toString(36).slice(2, 8)}`,
    kind: "desk",
    label: "Ship the desk by Friday,…",
    glyph: "snippets",
    paper: "#f6e7a9",
    ink: "#264a9a",
    objects: [
      { type: "desk.note", name: "Note", text: "Ship the desk by Friday, then the covers" },
    ],
    still: null,
    ...over,
  });
  const withoutPaper = ({ paper: _p, ink: _i, ...rest }: DeskChip): DeskChip => rest;
  const flier = (): HTMLElement | null => host?.querySelector(".vf-line-flier") ?? null;
  const chips = (): HTMLElement[] => [
    ...(host?.querySelectorAll<HTMLElement>('.vf-line-input .vf-line-chip[data-chip="desk"]') ??
      []),
  ];

  afterEach(() => {
    setLineSendPhase("idle");
  });

  it("flies the chip's face to the caret, sets it there, and TYPES the @ 180 ms after it lands — @'s list open, the caret after it", () => {
    vi.useFakeTimers();
    mount("canvas");
    typeText("look at ");
    act(() => editor().blur());
    let ticket: LineSendTicket | null = null;
    act(() => {
      ticket = sendToLine(deskChip(), FROM);
    });
    expect(ticket).not.toBeNull();
    expect(lineSendPhase()).toBe("flying");
    // the draft focused at once; the flier carries the chip's own face
    expect(document.activeElement).toBe(editor());
    const f = flier();
    expect(f?.querySelector(".vf-line-chip")?.getAttribute("data-glyph")).toBe("snippets");
    expect(f?.textContent).toBe("Ship the desk by Friday,…");
    expect(f?.style.transition).toBe("transform 560ms var(--vf-ease-island), opacity 140ms ease");
    expect(f?.style.transform).toMatch(/scale\(0\.86\)$/u);
    expect(chips()).toHaveLength(0);
    // no transitions run here: the landing is taken a beat past the flight's 560
    act(() => vi.advanceTimersByTime(659));
    expect(chips()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(flier()).toBeNull();
    expect(chips()).toHaveLength(1);
    expect(editor().textContent).toBe("look at Ship the desk by Friday,… ");
    expect(surfaceNow).toBeNull();
    act(() => vi.advanceTimersByTime(179));
    expect(host?.querySelector(".vf-at-menu")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    // the @, typed: @'s list open as typing opens it, the line's own surface
    expect(surfaceNow).toBe("at");
    expect(host?.querySelector(".vf-at-menu")).not.toBeNull();
    expect(editor().textContent).toBe("look at Ship the desk by Friday,… @");
    expect(lineSendPhase()).toBe("listing");
    // the caret after the chip and its @
    const selection = window.getSelection();
    const landed = chips()[0] as HTMLElement;
    const between = document.createRange();
    between.setStartAfter(landed);
    between.setEnd(selection?.anchorNode as Node, selection?.anchorOffset ?? 0);
    expect(between.toString()).toBe(" @");
    const rest = document.createRange();
    rest.selectNodeContents(editor());
    rest.setStart(selection?.anchorNode as Node, selection?.anchorOffset ?? 0);
    expect(rest.toString()).toBe("");
    // the list folds: the act is over, the bar may come back
    press(editor(), { key: "Escape" });
    expect(surfaceNow).toBeNull();
    expect(lineSendPhase()).toBe("idle");
  });

  it("wears a note's paper and ink, and carries its words in a message — the still's size once it comes", async () => {
    vi.useFakeTimers();
    const used = mount("canvas");
    let ticket: LineSendTicket | null = null;
    act(() => {
      ticket = sendToLine(deskChip({ id: "dk14-note" }), FROM);
    });
    // the still comes while it flies
    act(() =>
      (ticket as LineSendTicket | null)?.attach({
        url: "blob:x",
        width: 376,
        height: 276,
        bytes: 900,
      }),
    );
    act(() => vi.advanceTimersByTime(660));
    const [chip] = chips();
    expect(chip?.hasAttribute("data-paper")).toBe(true);
    expect(chip?.style.getPropertyValue("--vf-chip-paper")).toBe("#f6e7a9");
    expect(chip?.style.getPropertyValue("--vf-chip-ink")).toBe("#264a9a");
    expect(chip?.getAttribute("data-still")).toBe("376 × 276");
    expect(chip?.getAttribute("title")).toBe(
      'Note: "Ship the desk by Friday, then the covers" · a still 376 × 276',
    );
    act(() => vi.advanceTimersByTime(180));
    press(editor(), { key: "Escape" });
    vi.useRealTimers();
    await act(async () => q<HTMLButtonElement>(".vf-line-send").click());
    expect(used.write).toHaveBeenCalledWith('Note: "Ship the desk by Friday, then the covers" @');
  });

  it("a still that comes after the landing is set on the chip where it stands", () => {
    vi.useFakeTimers();
    mount("canvas");
    let ticket: LineSendTicket | null = null;
    act(() => {
      ticket = sendToLine(
        { ...withoutPaper(deskChip()), id: "dk14-late", label: "Clock", glyph: null },
        FROM,
      );
    });
    act(() => vi.advanceTimersByTime(660));
    expect(chips()[0]?.hasAttribute("data-still")).toBe(false);
    act(() =>
      (ticket as LineSendTicket | null)?.attach({
        url: "blob:y",
        width: 200,
        height: 100,
        bytes: 9,
      }),
    );
    expect(chips()[0]?.getAttribute("data-still")).toBe("200 × 100");
    expect(chips()[0]?.getAttribute("data-glyph")).toBe("none");
    expect(chips()[0]?.querySelector(":scope > svg")).toBeNull();
  });

  it("takes no second chip while one is still landing", () => {
    vi.useFakeTimers();
    mount("canvas");
    act(() => {
      sendToLine(deskChip(), FROM);
    });
    let second: LineSendTicket | null = null;
    act(() => {
      second = sendToLine(deskChip(), FROM);
    });
    expect(second).toBeNull();
    act(() => vi.advanceTimersByTime(660));
    expect(chips()).toHaveLength(1);
  });

  it("an AIMED draft takes the chip with no @ — and send arms", () => {
    vi.useFakeTimers();
    mount("godview");
    typeText("@");
    press(editor(), { key: "Enter" });
    expect(q('.vf-line-chip[data-chip="aim"]').textContent).toContain("vibe-field");
    act(() => setViewNow?.("canvas"));
    expect(q(".vf-line-send").hasAttribute("data-armed")).toBe(false);
    act(() => {
      sendToLine(deskChip(), FROM);
    });
    act(() => vi.advanceTimersByTime(660));
    expect(chips()).toHaveLength(1);
    expect(lineSendPhase()).toBe("idle");
    act(() => vi.advanceTimersByTime(1_000));
    expect(editor().textContent).not.toContain("@");
    expect(surfaceNow).toBeNull();
    expect(q(".vf-line-send").getAttribute("data-armed")).toBe("true");
  });

  it("REDUCED MOTION: no flight — the chip fades in at the caret, the @ 90 ms after (M6)", () => {
    vi.useFakeTimers();
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
    try {
      mount("canvas");
      act(() => {
        sendToLine(deskChip(), FROM);
      });
      expect(flier()).toBeNull();
      expect(chips()).toHaveLength(1);
      expect(chips()[0]?.style.transition).toBe("opacity 120ms ease");
      expect(chips()[0]?.style.opacity).toBe("1");
      act(() => vi.advanceTimersByTime(89));
      expect(surfaceNow).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(surfaceNow).toBe("at");
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});
