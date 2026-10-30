// @vitest-environment happy-dom
/**
 * One Frame FR-3 — the head, at the grain the repo tests chrome: the shipping
 * `HeadView` on its real controller (`Head`), with a plain fake document
 * manager (no sockets), a fake canvas door (the path and the camera), and a
 * stateful harness standing where FieldView does as the frame's ONE owner of
 * the open surface. The name pill (one name at the top, the crumbs folded in
 * a folder, FitPath, renaming on a double-click, the sync dot), the fields
 * explorer it grows into (the old file pill's cases, carried over), the zoom
 * readout and its solid menu, and the zoom's keys. The model is
 * head-model.test's; delivery from a focused pane is the godview smoke's 11i.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DocSyncStatus, FrameView, FrameZoomAct } from "@vibefield/contracts";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncQuestionDoor } from "../src/account/sync-question";
import type { DocManagerApi, DocManagerState } from "../src/doc-manager";
import { resetDocSyncStatuses, setDocSyncStatuses } from "../src/doc-sync-store";
import type { FrameSurface } from "../src/frame/frame-surface";
import { Head } from "../src/frame/Head";
import type { HeadCanvas, HeadCrumb } from "../src/frame/head-canvas";
import type { ViewKeys } from "../src/frame/views";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOC_A = "1f0d7a2e-3c44-4b8a-9e51-6d2f8c0a7b19";
const DOC_B = "2a1b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

function fakeManager(overrides?: Partial<DocManagerState>) {
  let state: DocManagerState = {
    phase: "ready",
    loading: null,
    doc: { docId: DOC_A, name: "Field" },
    docs: [
      {
        docId: DOC_A,
        name: "Field",
        updatedAt: Date.now() - 60_000,
        baseEpoch: 0,
        engineSchema: 2,
        sizeBytes: 10,
      },
      {
        docId: DOC_B,
        name: "Studio",
        updatedAt: Date.now() - 7_200_000,
        baseEpoch: 0,
        engineSchema: 2,
        sizeBytes: 10,
      },
    ],
    thumbnailUrls: { [DOC_B]: "blob:studio-thumbnail" },
    pending: null,
    ...overrides,
  };
  const listeners = new Set<() => void>();
  const manager: DocManagerApi = {
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getState: () => state,
    refreshDocs: vi.fn(async () => state.docs),
    rename: vi.fn(async (name: string) => {
      state = { ...state, doc: state.doc ? { ...state.doc, name } : null };
      for (const fn of listeners) fn();
    }),
    createDoc: vi.fn(async () => {}),
    switchTo: vi.fn(async () => {}),
    setSyncIntent: vi.fn(async (docId: string, intent: "sync" | "local") => {
      // The real manager patches from the entry the daemon returns; the fake
      // does the same so the chip is read back from the REGISTRY row, which is
      // the property under test (never from the sync stream).
      state = {
        ...state,
        docs: state.docs.map((d) => (d.docId === docId ? { ...d, syncIntent: intent } : d)),
      };
      for (const fn of listeners) fn();
    }),
  };
  return manager;
}

/** The head's canvas door over fake facts, its ops spied. */
function fakeCanvas(init: { path?: readonly HeadCrumb[]; zoom?: number } = {}) {
  let path = init.path ?? [];
  let zoom = init.zoom ?? 1;
  const pathFns = new Set<() => void>();
  const zoomFns = new Set<() => void>();
  const say = (fns: Set<() => void>): void => {
    for (const fn of [...fns]) fn();
  };
  const door = {
    path: () => path,
    subscribePath: (fn: () => void) => {
      pathFns.add(fn);
      return () => {
        pathFns.delete(fn);
      };
    },
    percent: () => Math.round(zoom * 100),
    subscribePercent: (fn: () => void) => {
      zoomFns.add(fn);
      return () => {
        zoomFns.delete(fn);
      };
    },
    zoom: () => zoom,
    zoomTo: vi.fn((next: number) => {
      zoom = next;
      say(zoomFns);
    }),
    zoomToFit: vi.fn(() => {
      zoom = 0.86;
      say(zoomFns);
    }),
    exitTo: vi.fn((depth: number) => {
      path = path.filter((crumb) => crumb.depth <= depth);
      say(pathFns);
    }),
    /** The canvas moved under the head (a test's hand on the nav stack). */
    goTo(next: readonly HeadCrumb[]) {
      path = next;
      say(pathFns);
    },
  } satisfies HeadCanvas & { goTo(next: readonly HeadCrumb[]): void };
  return door;
}

/** A C6-4 status with honest defaults; tests override what they assert. */
function syncStatus(overrides: Partial<DocSyncStatus> & { docId: string }): DocSyncStatus {
  return {
    name: "Field",
    state: "in-step",
    pendingRecords: 0,
    peers: [{ peer: "dev-b", reachable: true, lastExchangeAt: 1_700_000_000_000 }],
    reason: null,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
let pane: HTMLElement | null = null;
let surfaceNow: FrameSurface | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  pane?.remove();
  root = null;
  host = null;
  pane = null;
  surfaceNow = null;
  document.body.innerHTML = "";
  act(() => resetDocSyncStatuses());
});

interface Mounted {
  manager: DocManagerApi;
  canvas: ReturnType<typeof fakeCanvas>;
}

function mount(
  options: {
    manager?: DocManagerApi;
    canvas?: ReturnType<typeof fakeCanvas>;
    view?: FrameView;
    keys?: ViewKeys;
    open?: FrameSurface | null;
    menuZoom?: (handler: (act: FrameZoomAct) => void) => () => void;
    syncQuestion?: SyncQuestionDoor;
  } = {},
): Mounted {
  const used: Mounted = {
    manager: options.manager ?? fakeManager(),
    canvas: options.canvas ?? fakeCanvas(),
  };
  function Owner(): React.ReactElement {
    // FieldView's place: the frame's one owner of the open surface.
    const [surface, setSurface] = useState<FrameSurface | null>(options.open ?? null);
    surfaceNow = surface;
    return (
      <Head
        manager={used.manager}
        canvas={used.canvas}
        view={options.view ?? "canvas"}
        keys={options.keys ?? "mac"}
        surface={surface}
        onSurfaceChange={setSurface}
        {...(options.menuZoom !== undefined ? { menuZoom: options.menuZoom } : {})}
        {...(options.syncQuestion !== undefined ? { syncQuestion: options.syncQuestion } : {})}
      />
    );
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Owner />));
  return used;
}

const $ = <T extends Element = HTMLElement>(selector: string): T | null =>
  host?.querySelector<T>(selector) ?? null;
const $$ = (selector: string): HTMLElement[] => [
  ...(host?.querySelectorAll<HTMLElement>(selector) ?? []),
];
const button = (label: string): HTMLButtonElement => {
  const found = $$("button").find(
    (b) => b.getAttribute("aria-label") === label || b.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`no button ${label}`);
  return found as HTMLButtonElement;
};

/** A click with the count a person's clicking gives it (0: the keyboard's). */
function clickTimes(target: Element, detail: number): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
  });
}

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** The names the pill shows, as it shows them: the crumbs, then the name. */
const pathNames = (): string[] =>
  $$(".vf-head-path > :is(.vf-head-crumb, .vf-head-name, .vf-head-here)").map(
    (name) => name.textContent ?? "",
  );

describe("the name pill (FR-3, FC-D9)", () => {
  it("is ONE name at the field's top — no back button, no Root (F12)", () => {
    mount();
    expect(pathNames()).toEqual(["Field"]);
    expect($$(".vf-head-crumb")).toHaveLength(0);
    expect(host?.textContent).not.toContain("Root");
    expect(
      $$("button").some((b) => /back/iu.test(`${b.title} ${b.getAttribute("aria-label") ?? ""}`)),
    ).toBe(false);
  });

  it("folds the crumbs in inside a folder: earlier names go there in one flight, the last is the name", () => {
    const { canvas } = mount({
      canvas: fakeCanvas({
        path: [
          { depth: 1, label: "Launch notes" },
          { depth: 2, label: "Sketches" },
        ],
      }),
    });
    expect(pathNames()).toEqual(["Field", "Launch notes", "Sketches"]);
    expect($(".vf-head-here")?.getAttribute("aria-current")).toBe("location");
    // Esc goes up one — said on the parent's tooltip, and only there.
    const crumbs = $$(".vf-head-crumb");
    expect(crumbs.map((c) => c.title)).toEqual([
      "Back to the field's top",
      "Go up to Launch notes  Esc",
    ]);
    act(() => crumbs[0]?.click());
    expect(canvas.exitTo).toHaveBeenCalledWith(0);
    expect(pathNames()).toEqual(["Field"]);
  });

  it("follows the canvas: a folder entered shows, a folder left goes", () => {
    const { canvas } = mount();
    act(() => canvas.goTo([{ depth: 1, label: "Moodboard" }]));
    expect(pathNames()).toEqual(["Field", "Moodboard"]);
    act(() => canvas.goTo([]));
    expect(pathNames()).toEqual(["Field"]);
  });

  /** A layout stand-in for FitPath: 8px a character, and `room()` px for the
   * path. Returns the restore. */
  function stubLayout(room: () => number): () => void {
    const proto = HTMLElement.prototype;
    const client = Object.getOwnPropertyDescriptor(proto, "clientWidth");
    const scroll = Object.getOwnPropertyDescriptor(proto, "scrollWidth");
    Object.defineProperty(proto, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("vf-head-path") ? room() : 0;
      },
    });
    Object.defineProperty(proto, "scrollWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("vf-head-path") ? (this.textContent ?? "").length * 8 : 0;
      },
    });
    return () => {
      if (client !== undefined) Object.defineProperty(proto, "clientWidth", client);
      else Reflect.deleteProperty(proto, "clientWidth");
      if (scroll !== undefined) Object.defineProperty(proto, "scrollWidth", scroll);
      else Reflect.deleteProperty(proto, "scrollWidth");
    };
  }

  const LONG: readonly HeadCrumb[] = [
    { depth: 1, label: "Launch notes" },
    { depth: 2, label: "Sketches" },
  ];

  it("drops whole leading names when the path is too long — FitPath, never a name cut (F13)", () => {
    const restore = stubLayout(() => 160);
    try {
      const { canvas } = mount({ canvas: fakeCanvas({ path: LONG }) });
      // "FieldLaunch notesSketches" is 200px: the field's name goes, then
      // "Launch notes" — whole — behind one "…" that names them both.
      expect(pathNames()).toEqual(["…", "Sketches"]);
      const hidden = $$(".vf-head-crumb")[0];
      expect(hidden?.title).toBe("Field › Launch notes");
      expect(hidden?.getAttribute("aria-label")).toBe("Go up to Launch notes");
      // Nothing is left to drop, so the last name alone may now end in "…".
      expect($(".vf-head-path")?.getAttribute("data-fit")).toBe("floor");
      act(() => hidden?.click());
      expect(canvas.exitTo).toHaveBeenCalledWith(1);
      // A path that fits again shows whole.
      act(() => canvas.goTo([{ depth: 1, label: "Moodboard" }]));
      expect(pathNames()).toEqual(["Field", "Moodboard"]);
    } finally {
      restore();
    }
  });

  it("starts FitPath again when the pill's morph ends — closing the explorer leaves no name cut", () => {
    // Closing measures at the START of the shrink, with room to spare; the
    // END is where the room runs out.
    let room = 400;
    const restore = stubLayout(() => room);
    try {
      mount({ canvas: fakeCanvas({ path: LONG }) });
      expect(pathNames()).toEqual(["Field", "Launch notes", "Sketches"]);
      room = 160;
      const end = new Event("transitionend", { bubbles: true });
      Object.defineProperty(end, "propertyName", { value: "width" });
      act(() => {
        $("[data-head-place]")?.dispatchEvent(end);
      });
      expect(pathNames()).toEqual(["…", "Sketches"]);
    } finally {
      restore();
    }
  });

  it("renames on a double-click — one click does nothing — and Return commits through the manager", () => {
    const { manager } = mount();
    const name = $(".vf-head-name") as HTMLButtonElement;
    clickTimes(name, 1);
    expect($(".vf-head-rename")).toBeNull();
    clickTimes(name, 2);
    const input = $(".vf-head-rename") as HTMLInputElement;
    expect(input.value).toBe("Field");
    expect(document.activeElement).toBe(input);
    act(() => setInputValue(input, "Atelier"));
    press(input, { key: "Enter" });
    expect(manager.rename).toHaveBeenCalledTimes(1);
    expect(manager.rename).toHaveBeenCalledWith("Atelier");
    expect(pathNames()).toEqual(["Atelier"]);
  });

  it("renames from the keyboard too: Return or Space on the focused name (a click with no count)", () => {
    mount();
    clickTimes($(".vf-head-name") as HTMLButtonElement, 0);
    expect($(".vf-head-rename")).not.toBeNull();
  });

  it("puts the name back on Esc, and sends nothing unchanged or empty", () => {
    const { manager } = mount();
    clickTimes($(".vf-head-name") as HTMLButtonElement, 2);
    let input = $(".vf-head-rename") as HTMLInputElement;
    act(() => setInputValue(input, "Nope"));
    press(input, { key: "Escape" });
    expect(pathNames()).toEqual(["Field"]);
    clickTimes($(".vf-head-name") as HTMLButtonElement, 2);
    input = $(".vf-head-rename") as HTMLInputElement;
    act(() => setInputValue(input, "   "));
    press(input, { key: "Enter" });
    clickTimes($(".vf-head-name") as HTMLButtonElement, 2);
    press($(".vf-head-rename") as HTMLInputElement, { key: "Enter" });
    expect(manager.rename).not.toHaveBeenCalled();
  });

  it("holds the name and New field while a field loads — never the chevron", () => {
    mount({
      manager: fakeManager({ phase: "loading", loading: { progress: 0.5, stage: "x" } }),
    });
    expect(($(".vf-head-name") as HTMLButtonElement).disabled).toBe(true);
    expect(button("New field").disabled).toBe(true);
    expect(button("Fields").disabled).toBe(false);
  });

  // One Frame FR-3 (one plus) and FR-5 (no keycaps): the head carries neither.
  it("draws no plus and no keycap", () => {
    mount();
    expect($('[data-head-place] [data-glyph="plus"]')).toBeNull();
    expect($(".vf-head-tools [data-glyph]")).toBeNull();
    expect($(".vf-head-row")?.textContent).not.toMatch(/[⊕+⇧⌘]/u);
  });
});

describe('under a cover (DESIGN.md §8 "The covers over the desk")', () => {
  const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");
  const head = read("src/frame/head.css");
  const cover = read("src/frame/view-frame.css");
  const number = (text: string, pattern: RegExp): number => Number(text.match(pattern)?.[1]);

  it("goes with the canvas under any cover, and stands in Canvas", () => {
    for (const [view, covered] of [
      ["canvas", false],
      ["godview", true],
      ["history", true],
    ] as const) {
      mount({ view });
      const wrapper = $(".vf-head");
      expect(wrapper?.hasAttribute("data-covered"), view).toBe(covered);
      // the pill and the readout inherit the wrapper's visibility: both inside it
      expect(wrapper?.contains($(".vf-head-place")), view).toBe(true);
      expect(wrapper?.contains($(".vf-head-tools")), view).toBe(true);
      act(() => root?.unmount());
      root = null;
      host?.remove();
    }
  });

  it("hides by visibility once the cover has faded in, and keeps every box", () => {
    // no box of its own, so nothing moves; `visibility` keeps the pieces' boxes,
    // so the measured side and the Peek's find width read the same
    expect(head).toMatch(/^\.vf-head \{\s*display: contents;\s*\}/m);
    expect(head).toMatch(/^\.vf-head\[data-covered\] \{\s*visibility: hidden;/m);
    // the delay is the cover's own fade, in both motions
    const fade = number(cover, /^\.vf-cover \{[^}]*?transition:\s*opacity (\d+)ms/m);
    const reducedFade = number(cover, /\.vf-cover \{\s*transition:\s*opacity (\d+)ms/);
    expect([fade, reducedFade]).toEqual([240, 120]);
    expect(
      number(head, /^\.vf-head\[data-covered\] \{[^}]*transition: visibility 0s linear (\d+)ms/m),
    ).toBe(fade);
    expect(
      number(head, /\.vf-head\[data-covered\] \{\s*transition: visibility 0s linear (\d+)ms/),
    ).toBe(reducedFade);
  });
});

describe("the fields explorer, grown from the pill", () => {
  it("asks the one owner for the fields: the pill grows into the explorer, with a fresh list", () => {
    const { manager } = mount();
    expect($("[data-head-place]")?.dataset.open).toBe("false");
    act(() => button("Fields").click());
    expect(surfaceNow).toBe("fields");
    expect($("[data-head-place]")?.dataset.open).toBe("true");
    expect(manager.refreshDocs).toHaveBeenCalled();
    // Open, its head row is the field's name and the chevron that closes it.
    expect(button("Close the fields").title).toBe("Close  Esc");
    act(() => button("Close the fields").click());
    expect(surfaceNow).toBeNull();
  });

  it("heads the sheet with the field's name alone, even inside a folder", () => {
    mount({ canvas: fakeCanvas({ path: [{ depth: 1, label: "Sketches" }] }), open: "fields" });
    expect(pathNames()).toEqual(["Field"]);
  });

  it("puts New field first, in words; it closes the explorer and creates", () => {
    const { manager } = mount({ open: "fields" });
    const first = $(".vf-head-docs")?.firstElementChild?.querySelector("button");
    expect(first?.getAttribute("title")).toBe("New field");
    expect(first?.textContent).toBe("New field");
    act(() => first?.click());
    expect(surfaceNow).toBeNull();
    expect(manager.createDoc).toHaveBeenCalledTimes(1);
  });

  it("opens a tile's field and closes; the current tile only closes", () => {
    const { manager } = mount({ open: "fields" });
    act(() => ($('button[title="Field — current"]') as HTMLButtonElement).click());
    expect(surfaceNow).toBeNull();
    expect(manager.switchTo).not.toHaveBeenCalled();
    act(() => button("Fields").click());
    act(() => ($('button[title="Open Studio"]') as HTMLButtonElement).click());
    expect(surfaceNow).toBeNull();
    expect(manager.switchTo).toHaveBeenCalledWith(DOC_B);
  });

  it("uses a persisted thumbnail URL without asking the manager to make one", () => {
    const { manager } = mount({ open: "fields" });
    expect($('img[src="blob:studio-thumbnail"]')).not.toBeNull();
    expect(manager.refreshDocs).toHaveBeenCalledTimes(1);
  });

  it("closes on Esc, on the capture phase — the canvas's own Esc never hears it", () => {
    mount({ open: "fields" });
    const canvasEsc = vi.fn();
    window.addEventListener("keydown", canvasEsc);
    try {
      press(document.body, { key: "Escape" });
    } finally {
      window.removeEventListener("keydown", canvasEsc);
    }
    expect(surfaceNow).toBeNull();
    expect(canvasEsc).not.toHaveBeenCalled();
  });

  it("closes on the dim", () => {
    mount({ open: "fields" });
    act(() => ($(".vf-head-dim") as HTMLElement).click());
    expect(surfaceNow).toBeNull();
  });

  it("says an empty explorer is empty in words, never '⊕ creates one'", () => {
    mount({ manager: fakeManager({ docs: [] }), open: "fields" });
    expect(host?.textContent).toContain("No fields yet");
    expect(host?.textContent).not.toContain("⊕");
  });
  it("lists a board from before the desk with Delete — its tile never opens it (DK-3, ruling 7)", () => {
    const manager = fakeManager({ beforeTheDesk: [DOC_B] });
    const deleteDoc = vi.fn(async () => {});
    manager.deleteDoc = deleteDoc;
    mount({ manager, open: "fields" });
    const tile = $("[data-before-the-desk]");
    expect(tile?.querySelector(".vf-head-doc-name")?.textContent).toBe("Studio");
    expect(tile?.querySelector(".vf-head-doc-time")?.textContent).toBe("before the desk");
    // not a door: no open button, no sync chip, the old thumbnail not shown
    expect($('button[title="Open Studio"]')).toBeNull();
    expect(tile?.querySelector(".vf-head-doc-sync")).toBeNull();
    expect(tile?.querySelector("img")).toBeNull();
    const remove = tile?.querySelector<HTMLButtonElement>('button[title="Delete Studio"]');
    if (remove == null) throw new Error("no Delete on the tile");
    act(() => remove.click());
    expect(deleteDoc).toHaveBeenCalledWith(DOC_B);
    expect(manager.switchTo).not.toHaveBeenCalled();
  });
});

describe("in another window's place (DK-9, the launch's board)", () => {
  it("says the board is in memory — the name, an attention dot naming whose place it stands in — and never renames it", () => {
    act(() =>
      setDocSyncStatuses([syncStatus({ docId: DOC_A, state: "peer-declined", reason: "x" })]),
    );
    const manager = fakeManager({
      doc: { docId: "", name: "Studio" },
      heldElsewhere: { docId: DOC_B, name: "Studio" },
    });
    mount({ manager });
    expect(pathNames()).toEqual(["In memory"]);
    const dot = $("[data-sync-dot]") as HTMLElement;
    expect(dot.dataset.dot).toBe("attention");
    expect(dot.title).toBe(
      "“Studio” is open in another window — this window's board is in memory and saves nothing",
    );
    expect(dot.getAttribute("aria-label")).toBe(dot.title);
    clickTimes(button("In memory"), 2);
    expect($(".vf-head-rename")).toBeNull();
    expect(manager.rename).not.toHaveBeenCalled();
  });

  it("is the board's own name and its own dot again once the window holds a board", () => {
    act(() => setDocSyncStatuses([]));
    mount({ manager: fakeManager() });
    expect(pathNames()).toEqual(["Field"]);
    expect($("[data-sync-dot]")).toBeNull();
  });
});

describe("the sync dot and the tiles' sync words (C6-4, UA-D7)", () => {
  it("stays quiet for in-step AND for transient syncing — no flicker on routine traffic", () => {
    act(() => setDocSyncStatuses([syncStatus({ docId: DOC_A, state: "in-step" })]));
    mount();
    expect($("[data-sync-dot]")).toBeNull();
    act(() => setDocSyncStatuses([syncStatus({ docId: DOC_A, state: "syncing" })]));
    expect($("[data-sync-dot]")).toBeNull();
  });

  it("shows a muted dot for peer-offline whose title claims the last exchange, not now", () => {
    act(() => setDocSyncStatuses([syncStatus({ docId: DOC_A, state: "peer-offline" })]));
    mount();
    const dot = $("[data-sync-dot]") as HTMLElement;
    expect(dot.dataset.dot).toBe("muted");
    // F-C6-22 honesty: the words say what we knew and when — never "up to date".
    expect(dot.title).toContain("offline");
    expect(dot.title).toContain("last exchange");
  });

  it("shows the attention dot for the needs-attention states", () => {
    act(() =>
      setDocSyncStatuses([
        syncStatus({ docId: DOC_A, state: "peer-declined", reason: "unknown-doc" }),
      ]),
    );
    mount();
    const dot = $("[data-sync-dot]") as HTMLElement;
    expect(dot.dataset.dot).toBe("attention");
    expect(dot.title).toContain("unknown-doc");
  });

  it("counts what pending waits on", () => {
    act(() =>
      setDocSyncStatuses([syncStatus({ docId: DOC_A, state: "pending", pendingRecords: 3 })]),
    );
    mount();
    expect(($("[data-sync-dot]") as HTMLElement).title).toContain("3 records");
  });

  it("keeps the dot to the CURRENT field; the others speak through their tiles", () => {
    act(() =>
      setDocSyncStatuses([
        syncStatus({ docId: DOC_A, state: "in-step" }),
        syncStatus({ docId: DOC_B, name: "Studio", state: "peer-offline" }),
      ]),
    );
    mount({ open: "fields" });
    expect($("[data-sync-dot]")).toBeNull();
    expect(host?.textContent).toContain("peer offline");
  });

  it("offers 'keep local' on a tile and wears 'local' on a gated one, read from the registry", () => {
    act(() => setDocSyncStatuses([]));
    const manager = fakeManager({
      docs: [
        {
          docId: DOC_A,
          name: "Field",
          updatedAt: Date.now(),
          baseEpoch: 0,
          engineSchema: 2,
          sizeBytes: 10,
        },
        {
          docId: DOC_B,
          name: "Studio",
          updatedAt: Date.now(),
          baseEpoch: 0,
          engineSchema: 2,
          sizeBytes: 10,
          syncIntent: "local",
        },
      ],
    });
    mount({ manager, open: "fields" });
    const chips = $$("[data-sync-intent]");
    expect(chips.map((c) => c.dataset.syncIntent)).toEqual(["sync", "local"]);
    expect(chips[0]?.textContent).toBe("keep local");
    expect(chips[1]?.textContent).toBe("local");
    expect(chips[1]?.title).toContain("stays on this device");
  });

  it("toggles a field's sync both ways through the manager", () => {
    const { manager } = mount({ open: "fields" });
    act(() => ($("[data-sync-intent]") as HTMLButtonElement).click());
    expect(manager.setSyncIntent).toHaveBeenCalledWith(DOC_A, "local");
    const gated = $("[data-sync-intent='local']") as HTMLButtonElement;
    expect(gated.textContent).toBe("local");
    act(() => gated.click());
    expect(manager.setSyncIntent).toHaveBeenLastCalledWith(DOC_A, "sync");
  });
});

describe("the zoom readout (FC-D8) and its solid menu (FC-D14)", () => {
  it("prints any zoom the desk allows, and disables Zoom in at the band's top (DK-3, ruling 5)", () => {
    const canvas = fakeCanvas({ zoom: 1e8 });
    const bounded = { ...canvas, bounds: () => ({ min: 1e-8, max: 1e8 }), percent: () => 1e10 };
    mount({ canvas: bounded as unknown as ReturnType<typeof fakeCanvas>, open: "zoom" });
    expect($(".vf-head-zoom")?.textContent).toBe("10,000,000,000%");
    expect(($('[data-act="in"]') as HTMLButtonElement).disabled).toBe(true);
    expect(($('[data-act="out"]') as HTMLButtonElement).disabled).toBe(false);
  });

  const readout = (): HTMLButtonElement => $(".vf-head-zoom") as HTMLButtonElement;
  const rows = (): string[] =>
    $$(".vf-head-zoom-menu .vf-menu-row").map((row) => row.textContent ?? "");

  it("says the zoom as one number, and follows the camera", () => {
    const { canvas } = mount();
    expect(readout().textContent).toBe("100%");
    act(() => canvas.zoomTo(1.25));
    expect(readout().textContent).toBe("125%");
  });

  it("grows its menu on a click — Zoom in ⌘+ · Zoom out ⌘− · Zoom to fit ⇧1 · Actual size ⌘0", () => {
    mount();
    clickTimes(readout(), 1);
    expect(surfaceNow).toBe("zoom");
    expect(readout().getAttribute("aria-expanded")).toBe("true");
    expect(rows()).toEqual(["Zoom in⌘+", "Zoom out⌘−", "Zoom to fit⇧1", "Actual size⌘0"]);
    expect($(".vf-head-zoom-menu [data-hot]")?.textContent).toBe("Zoom in⌘+");
    clickTimes(readout(), 1);
    expect(surfaceNow).toBeNull();
  });

  it("runs a row's act on the camera and folds", () => {
    const { canvas } = mount();
    const take = (name: string): void => {
      clickTimes(readout(), 1);
      const row = $$(".vf-head-zoom-menu .vf-menu-row").find((r) =>
        r.textContent?.startsWith(name),
      );
      act(() => row?.click());
      expect(surfaceNow).toBeNull();
    };
    take("Zoom in");
    expect(canvas.zoomTo).toHaveBeenLastCalledWith(1.25);
    take("Zoom out");
    expect(canvas.zoomTo).toHaveBeenLastCalledWith(1);
    take("Zoom to fit");
    expect(canvas.zoomToFit).toHaveBeenCalledOnce();
    take("Actual size");
    expect(canvas.zoomTo).toHaveBeenLastCalledWith(1);
  });

  it("fits on a double-click, and the menu its first click grew folds", () => {
    const { canvas } = mount();
    clickTimes(readout(), 1);
    clickTimes(readout(), 2);
    expect(canvas.zoomToFit).toHaveBeenCalledOnce();
    expect(surfaceNow).toBeNull();
  });

  it("walks its rows with ↑ ↓ from the readout, takes the hot one on Return, folds on Esc", () => {
    const { canvas } = mount();
    press(readout(), { key: "ArrowDown" });
    expect(surfaceNow).toBe("zoom");
    press(readout(), { key: "ArrowDown" });
    press(readout(), { key: "ArrowDown" });
    expect($(".vf-head-zoom-menu [data-hot]")?.textContent).toBe("Zoom to fit⇧1");
    press(readout(), { key: "ArrowUp" });
    press(readout(), { key: "Enter" });
    expect(canvas.zoomTo).toHaveBeenLastCalledWith(0.8);
    expect(surfaceNow).toBeNull();
    clickTimes(readout(), 1);
    press(document.body, { key: "Escape" });
    expect(surfaceNow).toBeNull();
    expect(document.activeElement).toBe(readout());
  });

  it("folds on a press anywhere else, and not on its own rows", () => {
    mount();
    clickTimes(readout(), 1);
    act(() => {
      $(".vf-head-zoom-menu .vf-menu-row")?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });
    expect(surfaceNow).toBe("zoom");
    act(() => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(surfaceNow).toBeNull();
  });

  it("says the keys the Windows way off the Mac", () => {
    mount({ keys: "other" });
    clickTimes(readout(), 1);
    expect(rows()).toEqual([
      "Zoom inCtrl+Plus",
      "Zoom outCtrl+Minus",
      "Zoom to fitShift+1",
      "Actual sizeCtrl+0",
    ]);
  });
});

describe("the zoom's keys (DK-D24) — Canvas's, on the bubble phase", () => {
  it("zooms the canvas on ⌘+ ⌘− ⌘0 ⇧1, and claims each key it takes", () => {
    const { canvas } = mount();
    expect(press(document.body, { key: "=", code: "Equal", metaKey: true }).defaultPrevented).toBe(
      true,
    );
    expect(canvas.zoomTo).toHaveBeenLastCalledWith(1.25);
    press(document.body, { key: "-", code: "Minus", metaKey: true });
    expect(canvas.zoomTo).toHaveBeenLastCalledWith(1);
    press(document.body, { key: "!", code: "Digit1", shiftKey: true });
    expect(canvas.zoomToFit).toHaveBeenCalledOnce();
    press(document.body, { key: "0", code: "Digit0", metaKey: true });
    expect(canvas.zoomTo).toHaveBeenLastCalledWith(1);
    expect($(".vf-head-zoom")?.textContent).toBe("100%");
  });

  it("never fires inside a pane that holds the keyboard — claimed, or consuming its keys", () => {
    const { canvas } = mount();
    // A terminal on the canvas: design-007's claim marker.
    const claim = document.createElement("div");
    claim.setAttribute("data-canvas-keyboard", "");
    const input = document.createElement("textarea");
    claim.appendChild(input);
    document.body.appendChild(claim);
    press(input, { key: "=", code: "Equal", metaKey: true });
    press(input, { key: "0", code: "Digit0", metaKey: true });
    claim.remove();
    // A pane that consumes its own keys at the target (ghosttea's surface).
    pane = document.createElement("div");
    pane.tabIndex = 0;
    pane.addEventListener("keydown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    document.body.appendChild(pane);
    press(pane, { key: "-", code: "Minus", metaKey: true });
    press(pane, { key: "!", code: "Digit1", shiftKey: true });
    expect(canvas.zoomTo).not.toHaveBeenCalled();
    expect(canvas.zoomToFit).not.toHaveBeenCalled();
  });

  it("never takes ⇧1 while typing — it types !; ⌘+ from a field still zooms", () => {
    const { canvas } = mount();
    const field = document.createElement("input");
    document.body.appendChild(field);
    expect(press(field, { key: "!", code: "Digit1", shiftKey: true }).defaultPrevented).toBe(false);
    expect(canvas.zoomToFit).not.toHaveBeenCalled();
    press(field, { key: "=", code: "Equal", metaKey: true });
    expect(canvas.zoomTo).toHaveBeenCalledWith(1.25);
    field.remove();
  });

  it("is Canvas's: never under a cover", () => {
    const { canvas } = mount({ view: "godview" });
    expect(press(document.body, { key: "=", code: "Equal", metaKey: true }).defaultPrevented).toBe(
      false,
    );
    press(document.body, { key: "!", code: "Digit1", shiftKey: true });
    expect(canvas.zoomTo).not.toHaveBeenCalled();
    expect(canvas.zoomToFit).not.toHaveBeenCalled();
  });

  it("leaves a key something else already took", () => {
    const { canvas } = mount();
    const taker = (event: KeyboardEvent): void => event.preventDefault();
    window.addEventListener("keydown", taker, true);
    try {
      press(document.body, { key: "=", code: "Equal", metaKey: true });
    } finally {
      window.removeEventListener("keydown", taker, true);
    }
    expect(canvas.zoomTo).not.toHaveBeenCalled();
  });
});

/** The View menu's door, as main and the preload drive it: an item's act,
 * sent to whoever listens. */
function fakeMenu() {
  const handlers = new Set<(act: FrameZoomAct) => void>();
  return {
    door: (handler: (act: FrameZoomAct) => void): (() => void) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    send(which: FrameZoomAct): void {
      act(() => {
        for (const handler of handlers) handler(which);
      });
    },
    listening: (): number => handlers.size,
  };
}

describe("the View menu's zoom (FR-4, 3b) — an act the head answers, never a page zoom", () => {
  it("answers Zoom In, Zoom Out and Actual Size on Canvas, and the readout says each", () => {
    const menu = fakeMenu();
    const { canvas } = mount({ menuZoom: menu.door });
    menu.send("in");
    expect(canvas.zoomTo).toHaveBeenLastCalledWith(1.25);
    expect($(".vf-head-zoom")?.textContent).toBe("125%");
    menu.send("in");
    menu.send("out");
    expect(canvas.zoomTo).toHaveBeenLastCalledWith(1.25);
    menu.send("actual");
    expect(canvas.zoomTo).toHaveBeenLastCalledWith(1);
    expect($(".vf-head-zoom")?.textContent).toBe("100%");
    expect(canvas.zoomToFit).not.toHaveBeenCalled();
  });

  it("does nothing under a cover — an act that raced a change of view", () => {
    for (const view of ["godview", "history"] as const) {
      const menu = fakeMenu();
      const { canvas } = mount({ view, menuZoom: menu.door });
      menu.send("in");
      menu.send("actual");
      expect(canvas.zoomTo).not.toHaveBeenCalled();
      act(() => root?.unmount());
      root = null;
      host?.remove();
    }
  });

  it("lets go of the door when it goes", () => {
    const menu = fakeMenu();
    mount({ menuZoom: menu.door });
    expect(menu.listening()).toBe(1);
    act(() => root?.unmount());
    root = null;
    expect(menu.listening()).toBe(0);
  });

  it("is handed the host's door by the chrome", () => {
    const chrome = readFileSync(join(process.cwd(), "src/field/ChromeLayer.tsx"), "utf8");
    expect(chrome).toContain("menuZoom={subscribeMenuZoom}");
  });
});

/** TS-6 — the question's door as ChromeLayer hands it over, on a live posture. */
function fakeQuestion(options: { owed?: boolean; lands?: boolean } = {}): SyncQuestionDoor {
  return {
    owed: options.owed ?? true,
    posture: {
      posture: "automatic",
      status: "live",
      unavailable: false,
      pending: false,
      writeError: null,
      set: vi.fn(async () => true),
    },
    answer: vi.fn(async () => options.lands ?? true),
  };
}

/** A field made before the link (kept on this Mac by it) and one already sent. */
function linkedManager(): DocManagerApi {
  const manager = fakeManager();
  const [field, studio] = manager.getState().docs;
  return fakeManager({
    docs: [
      { ...(field as DocManagerState["docs"][number]), syncIntent: "local" },
      { ...(studio as DocManagerState["docs"][number]), syncIntent: "sync" },
    ],
  });
}

const questionForm = (): HTMLFormElement | null =>
  $<HTMLFormElement>('form[aria-label="Sync question"]');

describe("TS-6 — New field asks the sync question while a link owes it (TS-D13)", () => {
  it("asks in the explorer, lists the fields kept here, and sends, answers, then makes the field", async () => {
    const manager = linkedManager();
    const door = fakeQuestion();
    mount({ manager, open: "fields", syncQuestion: door });
    act(() => $<HTMLButtonElement>("[data-new]")?.click());
    expect(questionForm()).not.toBeNull();
    expect($(".vf-head-docs")?.hasAttribute("hidden")).toBe(true);
    expect(manager.createDoc).not.toHaveBeenCalled();
    // the field kept on this Mac is listed, unticked; the one already sent is not
    const listed = $$(".vf-head-question-field");
    expect(listed.map((row) => row.querySelector(".vf-head-question-name")?.textContent)).toEqual([
      "Field",
    ]);
    expect(listed[0]?.querySelector<HTMLInputElement>("input")?.checked).toBe(false);

    act(() => listed[0]?.querySelector<HTMLInputElement>("input")?.click());
    const cards = $$('[role="radiogroup"] input[type="radio"]') as HTMLInputElement[];
    expect(cards.map((card) => card.checked)).toEqual([true, false]);
    act(() => cards[1]?.click());
    await act(async () => {
      questionForm()?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });
    await act(async () => {});

    expect(manager.setSyncIntent).toHaveBeenCalledWith(DOC_A, "sync");
    expect(door.answer).toHaveBeenCalledWith("opt-in");
    expect(manager.createDoc).toHaveBeenCalledTimes(1);
    const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0] ?? 0;
    expect(order(manager.setSyncIntent)).toBeLessThan(order(door.answer));
    expect(order(door.answer)).toBeLessThan(order(manager.createDoc));
    expect(questionForm()).toBeNull();
  });

  it("makes the field at once when nothing owes the question", () => {
    const manager = linkedManager();
    mount({ manager, open: "fields", syncQuestion: fakeQuestion({ owed: false }) });
    act(() => $<HTMLButtonElement>("[data-new]")?.click());
    expect(questionForm()).toBeNull();
    expect(manager.createDoc).toHaveBeenCalledTimes(1);
  });

  it("keeps the question and makes no field when the posture does not land", async () => {
    const manager = linkedManager();
    mount({ manager, open: "fields", syncQuestion: fakeQuestion({ lands: false }) });
    act(() => $<HTMLButtonElement>("[data-new]")?.click());
    await act(async () => {
      questionForm()?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });
    expect(questionForm()).not.toBeNull();
    expect(manager.createDoc).not.toHaveBeenCalled();
  });

  it("Cancel makes nothing and gives the tiles back; the question is still owed", () => {
    const manager = linkedManager();
    const door = fakeQuestion();
    mount({ manager, open: "fields", syncQuestion: door });
    act(() => $<HTMLButtonElement>("[data-new]")?.click());
    act(() => button("Cancel").click());
    expect(questionForm()).toBeNull();
    expect($(".vf-head-docs")?.hasAttribute("hidden")).toBe(false);
    expect(manager.createDoc).not.toHaveBeenCalled();
    expect(door.answer).not.toHaveBeenCalled();
  });
});
