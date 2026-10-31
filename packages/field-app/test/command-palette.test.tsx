// @vitest-environment happy-dom
/**
 * One Frame FR-3 (§7) — the ⌘K palette, re-cut: a solid panel under the head
 * listing every act with its key at the row's end — the frame's acts first
 * (Views, On this view, App), then the enabled plugins' palette commands under
 * each plugin's name — run through the frame's own doors (a frame act) or the
 * spine's command registry (a command), never a waiting row. The registry
 * snapshot and the command registry are mocked at their module seams; the
 * chord's delivery over a focused pane is the godview smoke's row 11e.
 */
import { createCanvasEngine } from "@vibecook/ice";
import type { FrameView } from "@vibefield/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HistoryLineDoor,
  publishHistoryLineDoor,
  resetHistoryLineDoorForTest,
} from "../src/frame/line-door";
import type { FrameActRun } from "../src/frame/palette-acts";
import {
  publishSystemControlDoor,
  resetSystemControlDoorForTest,
} from "../src/frame/system-control-door";
import type { ViewKeys } from "../src/frame/views";
import { CommandPalette } from "../src/hud/CommandPalette";

const registry = vi.hoisted(() => ({
  snapshot: null as unknown,
  bound: new Set<string>(),
  invoke: vi.fn(async () => ({ status: "ok" })),
}));

vi.mock("../src/plugin-host/plugin-registry-store", () => ({
  usePluginRegistrySnapshot: () => registry.snapshot,
}));
vi.mock("../src/plugin-host/command-registry", () => ({
  isCommandBound: (id: string) => registry.bound.has(id),
  invoke: registry.invoke,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let dispose: (() => void) | null = null;

beforeEach(() => {
  registry.snapshot = null;
  registry.bound.clear();
  registry.invoke.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  dispose?.();
  root = null;
  host = null;
  dispose = null;
  resetSystemControlDoorForTest();
  resetHistoryLineDoorForTest();
});

function mount(options: { view?: FrameView; keys?: ViewKeys } = {}) {
  const engine = createCanvasEngine({});
  dispose = () => engine.dispose();
  const onAct = vi.fn<(run: FrameActRun) => void>();
  const onClose = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <CommandPalette
        ce={engine}
        open
        onClose={onClose}
        windowId="field"
        view={options.view ?? "canvas"}
        keys={options.keys ?? "mac"}
        onAct={onAct}
      />,
    ),
  );
  return { onAct, onClose };
}

const $ = <T extends Element = HTMLElement>(selector: string): T | null =>
  host?.querySelector<T>(selector) ?? null;
const $$ = (selector: string): HTMLElement[] => [
  ...(host?.querySelectorAll<HTMLElement>(selector) ?? []),
];
const field = (): HTMLInputElement => $(".vf-palette-field input") as HTMLInputElement;

function press(target: EventTarget, init: KeyboardEventInit): void {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  });
}

function type(text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(field(), text);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The palette as it reads: each eyebrow, then its rows' names and keys. */
const reading = (): string[] =>
  $$(".vf-palette-list > *").map((node) =>
    node.classList.contains("vf-menu-eye")
      ? `# ${node.textContent}`
      : `${node.querySelector(".vf-menu-label")?.firstChild?.textContent ?? ""}${
          node.querySelector(".vf-menu-key") === null
            ? ""
            : ` ${node.querySelector(".vf-menu-key")?.textContent}`
        }`,
  );

describe("the palette (One Frame §7)", () => {
  it("keeps its dialog's name for the ⌘K probe, and says no prose footer", () => {
    mount();
    expect($('[role="dialog"][aria-label="Command palette"]')).not.toBeNull();
    expect(host?.textContent).not.toContain("↵ to run");
    expect(host?.textContent).not.toContain("esc to close");
    expect(field().placeholder).toBe("Type a command or a view…");
  });

  it("lists every act with its key at the row's end: Views, On this view, App", () => {
    mount();
    expect(reading()).toEqual([
      "# Views",
      "Canvas ⌘1",
      "Godview ⌘2",
      "History ⌘3",
      "Assistant ⌘4",
      "# On this view",
      "Objects B",
      "Zoom in ⌘+",
      "Zoom out ⌘−",
      "Zoom to fit ⇧1",
      "Actual size ⌘0",
      "# App",
      "Settings… ⌘,",
    ]);
  });

  it("follows the view: Godview's New terminal and System control, and no zoom off Canvas", () => {
    publishSystemControlDoor({ toggle: () => undefined });
    mount({ view: "godview" });
    const onView = reading();
    expect(onView.slice(onView.indexOf("# On this view"), onView.indexOf("# App"))).toEqual([
      "# On this view",
      "New terminal ⌘T",
      // no key: the row ends on its name (GV-D1)
      "System control",
    ]);
  });

  it("follows History: New terminal ⌘T, then the chosen session's Resume — waiting until one is chosen, Jump to while it runs here (HN-7)", () => {
    // what History lends the frame, as its controller would publish it
    const door = (over: Partial<HistoryLineDoor> = {}): HistoryLineDoor => ({
      chosen: null,
      waits: null,
      live: false,
      resume: async () => ({ state: "resumed" }),
      jump: async () => ({ state: "jumped" }),
      project: "vibe-field",
      newTerminal: async () => ({ state: "opened" }),
      ...over,
    });
    act(() => publishHistoryLineDoor(door()));
    const { onAct } = mount({ view: "history" });
    const onView = reading();
    expect(onView.slice(onView.indexOf("# On this view"), onView.indexOf("# App"))).toEqual([
      "# On this view",
      // the create never waits on a chosen session (DESIGN.md §8 the palette)
      "New terminal ⌘T",
      // no key: the row ends on its name
      "Resume this session",
    ]);
    const create = (): HTMLButtonElement => $('[data-row="create"]') as HTMLButtonElement;
    const session = (): HTMLButtonElement => $('[data-row="chosen-session"]') as HTMLButtonElement;
    expect(create().hasAttribute("aria-disabled")).toBe(false);
    expect(create().querySelector("svg")?.getAttribute("data-glyph")).toBe("start");
    // nothing chosen: Resume waits, and says why in the line's own words
    expect(session().getAttribute("aria-disabled")).toBe("true");
    expect(session().textContent).toContain("choose a session first");
    expect(session().querySelector("svg")?.getAttribute("data-glyph")).toBe("resume");
    act(() => session().click());
    expect(onAct).not.toHaveBeenCalled();
    // chosen: it runs through the frame's door for the chosen session
    act(() => publishHistoryLineDoor(door({ chosen: "ses-1" })));
    expect(session().hasAttribute("aria-disabled")).toBe(false);
    act(() => session().click());
    expect(onAct).toHaveBeenLastCalledWith({ kind: "chosen-session" });
    // the launcher's reason, said under it while it cannot resume
    act(() => publishHistoryLineDoor(door({ chosen: "ses-1", waits: "its folder is gone" })));
    expect(session().textContent).toContain("its folder is gone");
    // running here: Jump to, which never waits on the launcher's reading (P3)
    act(() =>
      publishHistoryLineDoor(door({ chosen: "ses-1", waits: "its folder is gone", live: true })),
    );
    expect(session().querySelector(".vf-menu-label")?.firstChild?.textContent).toBe(
      "Jump to this session",
    );
    expect(session().querySelector("svg")?.getAttribute("data-glyph")).toBe("jump");
    expect(session().hasAttribute("aria-disabled")).toBe(false);
    // the create runs the line's own, as in every view
    act(() => create().click());
    expect(onAct).toHaveBeenLastCalledWith({ kind: "create" });
  });

  it("runs Godview's System control through the frame's door, and waits while Godview has not lent it (GV-D1)", () => {
    // no door: Godview has not published its verb yet, and the act says so
    const waiting = mount({ view: "godview" });
    const row = (): HTMLButtonElement => $('[data-row="system-control"]') as HTMLButtonElement;
    expect(row().getAttribute("aria-disabled")).toBe("true");
    expect(row().textContent).toContain("Godview is still opening");
    act(() => row().click());
    expect(waiting.onAct).not.toHaveBeenCalled();
    expect(waiting.onClose).not.toHaveBeenCalled();
    // the door arrives: the same palette lists it runnable, with no glyph and no key
    act(() => publishSystemControlDoor({ toggle: () => undefined }));
    expect(row().getAttribute("aria-disabled")).not.toBe("true");
    expect(row().textContent).toBe("System control");
    expect(row().querySelector(".vf-menu-key")).toBeNull();
    expect(row().querySelector(".vf-glyph")).toBeNull();
    act(() => row().click());
    expect(waiting.onAct).toHaveBeenCalledWith({ kind: "system-control" });
    expect(waiting.onClose).toHaveBeenCalled();
    // typed, it answers to its name
    type("system");
    expect($$("[data-row]").map((node) => node.getAttribute("data-row"))).toContain(
      "system-control",
    );
  });

  it("draws a waiting act and never runs it: the Assistant says it is not built yet", () => {
    const { onAct, onClose } = mount();
    const assistant = $('[data-row="view-assistant"]') as HTMLButtonElement;
    expect(assistant.getAttribute("aria-disabled")).toBe("true");
    expect(assistant.textContent).toContain("not built yet");
    act(() => assistant.click());
    expect(onAct).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("runs the hot row on Return through the frame's doors, and closes", () => {
    const { onAct, onClose } = mount();
    expect($("[data-hot]")?.getAttribute("data-row")).toBe("view-canvas");
    press(field(), { key: "ArrowDown" });
    press(field(), { key: "Enter" });
    expect(onAct).toHaveBeenCalledWith({ kind: "view", view: "godview" });
    expect(onClose).toHaveBeenCalled();
  });

  it("walks only the rows that can run: ↓ from History skips the waiting Assistant", () => {
    mount();
    for (let i = 0; i < 3; i++) press(field(), { key: "ArrowDown" });
    expect($("[data-hot]")?.getAttribute("data-row")).toBe("create");
    press(field(), { key: "ArrowUp" });
    expect($("[data-hot]")?.getAttribute("data-row")).toBe("view-history");
  });

  it("filters every group as you type, and a click runs a row", () => {
    const { onAct } = mount();
    type("zoom");
    expect(reading()).toEqual([
      "# On this view",
      "Zoom in ⌘+",
      "Zoom out ⌘−",
      "Zoom to fit ⇧1",
      "Actual size ⌘0",
    ]);
    act(() => ($('[data-row="zoom-fit"]') as HTMLButtonElement).click());
    expect(onAct).toHaveBeenCalledWith({ kind: "zoom", act: "fit" });
    type("qqqq");
    expect(host?.textContent).toContain("Nothing matches");
  });

  it("lists each plugin's commands under its name; one with no live handler is unavailable", () => {
    registry.snapshot = {
      plugins: [
        {
          id: "note",
          title: "Notes",
          enabled: true,
          contributions: {
            commands: [
              { id: "note.create", title: "Add note", placements: ["palette"] },
              { id: "note.hidden", title: "Not in the palette", placements: ["hud"] },
            ],
          },
        },
        {
          id: "repository",
          title: "Repository",
          enabled: true,
          contributions: {
            commands: [
              { id: "repository.open", title: "Open repository", placements: ["palette"] },
            ],
          },
        },
        {
          id: "off",
          title: "Off",
          enabled: false,
          contributions: {
            commands: [{ id: "off.go", title: "Disabled plugin", placements: ["palette"] }],
          },
        },
      ],
    };
    registry.bound.add("note.create");
    mount();
    const read = reading();
    expect(read.slice(read.indexOf("# Notes"))).toEqual([
      "# Notes",
      "Add note",
      "# Repository",
      "Open repository",
    ]);
    const open = $('[data-row="repository.open"]') as HTMLButtonElement;
    expect(open.getAttribute("aria-disabled")).toBe("true");
    expect(open.textContent).toContain("unavailable");
    act(() => open.click());
    expect(registry.invoke).not.toHaveBeenCalled();
    act(() => ($('[data-row="note.create"]') as HTMLButtonElement).click());
    expect(registry.invoke).toHaveBeenCalledWith(
      "note.create",
      undefined,
      expect.objectContaining({ source: "palette", windowId: "field", userGesture: true }),
    );
  });

  it("closes on Esc", () => {
    const { onClose } = mount();
    press(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
