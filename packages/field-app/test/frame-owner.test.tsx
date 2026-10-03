// @vitest-environment happy-dom
/**
 * One Frame FR-3 (FR-4, "one surface at a time") — the frame's ONE owner of the
 * open surface, renamed from the line's when the head's three joined: Objects,
 * @'s list, the fields explorer, the zoom's menu and the palette are one value,
 * so opening any one folds the rest by construction. A stateful harness stands
 * where FieldView does and mounts the shipping head, line and palette on it,
 * with ChromeLayer's one piece of glue — the palette's create row run through
 * the line's own create (`LineActs`), so the two doors to one act are one
 * implementation and speak with one note.
 */
import { createCanvasEngine } from "@vibecook/ice";
import type { FrameView } from "@vibefield/contracts";
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocManagerApi } from "../src/doc-manager";
import { Composer, type LineActs } from "../src/frame/Composer";
import { type FrameSurface, foldSurface } from "../src/frame/frame-surface";
import { Head } from "../src/frame/Head";
import type { HeadCanvas, HeadCrumb } from "../src/frame/head-canvas";
import type { LineViewDoor } from "../src/frame/line-door";
import type { FrameActRun } from "../src/frame/palette-acts";
import { ViewsTrackView } from "../src/frame/ViewsTrack";
import { type FieldHost, setHost } from "../src/host";
import { CommandPalette } from "../src/hud/CommandPalette";
import { ClipboardStore } from "../src/hud/edge-tray/clipboard-store";
import type { RendererLogger } from "../src/logging";

vi.mock("../src/plugin-host/plugin-registry-store", () => ({
  usePluginRegistrySnapshot: () => null,
}));

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
});

function mount(door: LineViewDoor | null = null): void {
  const engine = createCanvasEngine({});
  dispose = () => engine.dispose();
  function Owner(): React.ReactElement {
    // FieldView's place: the frame's one owner of the open surface.
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    const [view, setView] = useState<FrameView>("canvas");
    const lineActs = useRef<LineActs | null>(null);
    const [clipboard] = useState(() => new ClipboardStore(() => 0));
    surfaceNow = surface;
    setSurfaceNow = setSurface;
    setViewNow = setView;
    // ChromeLayer's glue for the palette's frame acts (the create row here).
    const onAct = (run: FrameActRun): void => {
      if (run.kind === "create") lineActs.current?.create();
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
        />
        <Composer
          view={view}
          keys="mac"
          track={<ViewsTrackView view={view} keys="mac" />}
          surface={surface}
          onSurfaceChange={setSurface}
          actsRef={lineActs}
          godview={door}
          clipboard={clipboard}
          host={{}}
          writeClipboard={async () => undefined}
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
    mount({ panes: [], onScreen: true, newTerminal, paste: () => false });
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
});
