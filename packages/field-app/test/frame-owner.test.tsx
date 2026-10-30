// @vitest-environment happy-dom
/**
 * One Frame FR-3 (FR-4, "one surface at a time") — the frame's ONE owner of the
 * open surface, renamed from the line's when the head's three joined: Objects,
 * the fields explorer, the zoom's menu and the palette are one value,
 * so opening any one folds the rest by construction — and since HN-8 the pill's
 * sheet is one of them on two shelves, Fields and Artifacts. A stateful harness stands
 * where FieldView does and mounts the shipping head, line and palette on it,
 * with ChromeLayer's glue — the palette's create row run through the line's
 * own create (`LineActs`), so the two doors to one act are one implementation
 * and speak with one note, and History's chosen-session row through History's
 * door (`runChosenSession`, HN-7), said on the same line.
 */
import { createCanvasEngine } from "@vibecook/ice";
import type { FrameView } from "@vibefield/contracts";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeMenuView } from "../src/account/MeMenu";
import type { DocManagerApi } from "../src/doc-manager";
import { Composer, type LineActs } from "../src/frame/Composer";
import { Cards } from "../src/frame/cards/Cards";
import { CardStore } from "../src/frame/cards/cards-store";
import { type FrameSurface, foldSurface } from "../src/frame/frame-surface";
import { Head } from "../src/frame/Head";
import type { HeadCanvas, HeadCrumb } from "../src/frame/head-canvas";
import {
  type HistoryLineDoor,
  type LineViewDoor,
  publishHistoryLineDoor,
  resetHistoryLineDoorForTest,
  runChosenSession,
} from "../src/frame/line-door";
import type { FrameActRun } from "../src/frame/palette-acts";
import { ViewsTrackView } from "../src/frame/ViewsTrack";
import { type FieldHost, setHost } from "../src/host";
import { CommandPalette } from "../src/hud/CommandPalette";
import type { RendererLogger } from "../src/logging";

vi.mock("../src/plugin-host/plugin-registry-store", () => ({
  usePluginRegistrySnapshot: () => null,
}));
// The hand's carried layer carries nothing here: the hand stands on the owner (HN-L7).
vi.mock("../src/frame/cards/card-drag", () => ({
  startCardDrag: () => undefined,
  useCarriedCard: () => null,
  getCarriedCard: () => null,
}));
vi.mock("../src/frame/cards/CarriedCardLayer", () => ({ CarriedCardLayer: () => null }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let dispose: (() => void) | null = null;
let surfaceNow: FrameSurface | null = null;
let setSurfaceNow: ((next: FrameSurface | null) => void) | null = null;
let setViewNow: ((view: FrameView) => void) | null = null;

const FIELD: ReturnType<DocManagerApi["getState"]> = {
  phase: "ready",
  loading: null,
  doc: { docId: "a", name: "Field" },
  docs: [],
  thumbnailUrls: {},
  pending: null,
};

const manager: DocManagerApi = {
  subscribe: () => () => undefined,
  getState: () => FIELD,
  refreshDocs: async () => [],
  rename: async () => undefined,
  createDoc: async () => undefined,
  switchTo: async () => undefined,
  setSyncIntent: async () => undefined,
};

/** At the field's top — one array, so the store's snapshot is stable. */
const TOP: readonly HeadCrumb[] = [];

const canvas: HeadCanvas = {
  path: () => TOP,
  subscribePath: () => () => undefined,
  percent: () => 100,
  subscribePercent: () => () => undefined,
  zoom: () => 1,
  zoomTo: () => undefined,
  zoomToFit: () => undefined,
  exitTo: () => undefined,
};

beforeEach(() => {
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
  dispose?.();
  root = null;
  host = null;
  dispose = null;
  surfaceNow = null;
  resetHistoryLineDoorForTest();
});

function mount(door: LineViewDoor | null = null): void {
  const engine = createCanvasEngine({});
  dispose = () => engine.dispose();
  function Owner(): React.ReactElement {
    // FieldView's place: the frame's one owner of the open surface.
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    const [view, setView] = useState<FrameView>("canvas");
    const lineActs = useRef<LineActs | null>(null);
    const [cards] = useState(() => new CardStore(() => 0));
    surfaceNow = surface;
    setSurfaceNow = setSurface;
    setViewNow = setView;
    // ChromeLayer's glue for the palette's frame acts (the create row, and
    // History's chosen session through its door, here).
    const onAct = (run: FrameActRun): void => {
      if (run.kind === "create") lineActs.current?.create();
      if (run.kind === "chosen-session") void runChosenSession();
    };
    return (
      <>
        <Head
          manager={manager}
          canvas={canvas}
          view={view}
          keys="mac"
          surface={surface}
          onSurfaceChange={setSurface}
          bindKeys={false}
          windowId="field"
        />
        <Composer
          view={view}
          keys="mac"
          track={<ViewsTrackView view={view} keys="mac" />}
          surface={surface}
          onSurfaceChange={setSurface}
          actsRef={lineActs}
          godview={door}
          host={{}}
          bindKeys={false}
        />
        <CommandPalette
          ce={engine}
          open={surface === "palette"}
          onClose={() => setSurface(foldSurface(surface, "palette"))}
          windowId="field"
          view={view}
          keys="mac"
          onAct={onAct}
        />
        {/* The hand (HN-1): raised, it is one of the surfaces (HN-L7). */}
        <Cards store={cards} host={{}} surface={surface} onSurfaceChange={setSurface} />
        {/* ChromeLayer's glue for the corner (FR-4): the Me menu asks the owner. */}
        <MeMenuView
          me={{
            userId: "me",
            name: "James",
            face: { emoji: "🦊" },
            waiting: 0,
            detail: "james@example.com",
            detailIsLogin: true,
            detailTone: "plain",
            canLink: false,
          }}
          others={[]}
          open={surface === "me"}
          onOpenChange={(open) => setSurface(open ? "me" : foldSurface(surface, "me"))}
          onOpenSettings={() => undefined}
          onOpenAccount={() => undefined}
          onLink={() => undefined}
        />
      </>
    );
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Owner />));
}

const $ = <T extends Element = HTMLElement>(selector: string): T | null =>
  host?.querySelector<T>(selector) ?? null;

function click(selector: string): void {
  act(() => {
    $(selector)?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
}

describe("the frame's one owner of the open surface", () => {
  it("holds the head's surfaces and the line's as ONE value — any one opening folds the rest", () => {
    mount();
    click(".vf-line-create");
    expect(surfaceNow).toBe("objects");
    click(".vf-head-zoom");
    expect(surfaceNow).toBe("zoom");
    expect($(".vf-line-create")?.getAttribute("aria-expanded")).toBe("false");
    click('.vf-head-chev[aria-label="Fields"]');
    expect(surfaceNow).toBe("fields");
    expect($(".vf-head-zoom-menu")).toBeNull();
    act(() => setSurfaceNow?.("palette"));
    expect($('[role="dialog"][aria-label="Command palette"]')).not.toBeNull();
    expect($("[data-head-place]")?.dataset.open).toBe("false");
  });

  it("holds the Me menu in the same one value — it folds the head's and the line's, and they fold it (FR-4)", () => {
    mount();
    click(".vf-line-create");
    expect(surfaceNow).toBe("objects");
    click(".vf-me-face");
    expect(surfaceNow).toBe("me");
    expect($(".vf-line-create")?.getAttribute("aria-expanded")).toBe("false");
    expect($(".vf-me")?.hasAttribute("data-open")).toBe(true);
    click(".vf-head-zoom");
    expect(surfaceNow).toBe("zoom");
    expect($(".vf-me")?.hasAttribute("data-open")).toBe(false);
    act(() => setSurfaceNow?.("me"));
    expect($(".vf-head-zoom-menu")).toBeNull();
    // Its own fold leaves the others alone: a second press on the face.
    click(".vf-me-face");
    expect(surfaceNow).toBeNull();
  });

  it("holds the hand raised in the same one value (F11; HN-L7)", () => {
    mount();
    click(".vf-line-create");
    expect(surfaceNow).toBe("objects");
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "V",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(surfaceNow).toBe("cards");
    expect($(".vf-line-create")?.getAttribute("aria-expanded")).toBe("false");
    expect($(".vf-cards")?.hasAttribute("data-raised")).toBe(true);
    click(".vf-head-zoom");
    expect(surfaceNow).toBe("zoom");
    expect($(".vf-cards")?.hasAttribute("data-raised")).toBe(false);
    click(".vf-me-face");
    expect(surfaceNow).toBe("me");
    expect($(".vf-head-zoom-menu")).toBeNull();
  });

  it("holds the pill's sheet as ONE surface on two shelves — turning it folds nothing, and it folds and is folded by the rest (HN-8)", () => {
    mount();
    click(".vf-head-zoom");
    expect(surfaceNow).toBe("zoom");
    // the package opens the sheet on Artifacts, folding the zoom's menu
    click(".vf-head-pack");
    expect(surfaceNow).toBe("artifacts");
    expect($(".vf-head-zoom-menu")).toBeNull();
    expect($("[data-head-place]")?.dataset.open).toBe("true");
    // the chevron turns the same sheet to Fields: one value, still open
    click('.vf-head-chev[aria-label="Fields"]');
    expect(surfaceNow).toBe("fields");
    expect($("[data-head-place]")?.dataset.open).toBe("true");
    click(".vf-me-face");
    expect(surfaceNow).toBe("me");
    expect($("[data-head-place]")?.dataset.open).toBe("false");
    click(".vf-head-pack");
    expect(surfaceNow).toBe("artifacts");
    expect($(".vf-me")?.hasAttribute("data-open")).toBe(false);
    click(".vf-line-create");
    expect(surfaceNow).toBe("objects");
    expect($("[data-head-place]")?.dataset.open).toBe("false");
    act(() => setSurfaceNow?.("artifacts"));
    act(() => setViewNow?.("godview"));
    expect(surfaceNow).toBeNull();
  });

  it("folds whatever is open when the view changes — a change of place", () => {
    mount();
    click(".vf-head-zoom");
    expect(surfaceNow).toBe("zoom");
    act(() => setViewNow?.("history"));
    expect(surfaceNow).toBeNull();
  });

  it("runs the palette's create through the line's own create: Objects on Canvas", () => {
    mount();
    act(() => setSurfaceNow?.("palette"));
    click('[data-row="create"]');
    expect(surfaceNow).toBe("objects");
    expect($(".vf-line-create")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("runs Godview's New terminal through the line, whose note says what came of it", async () => {
    const newTerminal = vi.fn(async () => ({ state: "opened" as const }));
    mount({
      panes: [],
      onScreen: true,
      newTerminal,
      pasteInto: () => false,
      whenInputOpen: async () => false,
      canPlace: true,
      place: async () => ({ state: "opened" }),
      reveal: async () => ({ state: "opened" }),
    });
    act(() => setViewNow?.("godview"));
    act(() => setSurfaceNow?.("palette"));
    expect($('[data-row="create"]')?.textContent).toContain("New terminal");
    await act(async () => {
      $('[data-row="create"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(newTerminal).toHaveBeenCalledOnce();
    expect(surfaceNow).toBeNull();
    expect($(".vf-line-note")?.textContent).toBe("Terminal opened in the active pane");
  });

  it("runs History's two rows: New terminal through the line, the chosen session's Resume through History's door — each said on the line (HN-7)", async () => {
    const newTerminal = vi.fn(async () => ({ state: "opened" as const }));
    const resume = vi.fn(async () => ({ state: "resumed" as const }));
    const door: HistoryLineDoor = {
      chosen: "ses-1",
      waits: null,
      live: false,
      resume,
      jump: async () => ({ state: "jumped" }),
      project: "vibe-field",
      newTerminal,
    };
    act(() => publishHistoryLineDoor(door));
    mount();
    act(() => setViewNow?.("history"));
    // the line's create names the project the room shows
    expect($(".vf-line-create")?.getAttribute("title")).toBe("New terminal in vibe-field  ⌘T");
    act(() => setSurfaceNow?.("palette"));
    expect($('[data-row="create"]')?.textContent).toContain("New terminal");
    expect($('[data-row="chosen-session"]')?.textContent).toContain("Resume this session");
    await act(async () => {
      $('[data-row="create"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(newTerminal).toHaveBeenCalledOnce();
    expect(resume).not.toHaveBeenCalled();
    expect(surfaceNow).toBeNull();
    expect($(".vf-line-note")?.textContent).toBe("Terminal opened in the active pane");
    // the chosen session's act — the line's create until HN-7 — from its palette row
    act(() => setSurfaceNow?.("palette"));
    await act(async () => {
      $('[data-row="chosen-session"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(resume).toHaveBeenCalledOnce();
    expect(newTerminal).toHaveBeenCalledOnce();
    expect(surfaceNow).toBeNull();
    expect($(".vf-line-note")?.textContent).toBe("Resumed in the active pane");
    expect($(".vf-line-note")?.getAttribute("data-at")).toBe("create");
  });
});
