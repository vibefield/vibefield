// @vitest-environment happy-dom
/**
 * History's search until the Peek lands (the search interim, ruled by James
 * 2026-10-04; DESIGN.md §8 "History"). The shipping composition — `HistoryView`
 * over fieldd's ports with rosetta's room inside, in the cover's History slot —
 * on the frame's one owner of the open surface, with the palette, the left
 * edge's drawer and ChromeLayer's ⌘K glue beside it as the window holds them.
 * The rows: the strip's pill opens the room's sheet in the room's layer as one
 * of the frame's surfaces, printing no key, and Esc closes it with nothing of
 * the frame's taking that Esc first; ⌘K keeps toggling the palette in History,
 * folding the sheet; a query lands a hit from the index and the room reports
 * the choice; ⌘G / ⇧⌘G walk the matches a hit leaves — the keys the stepper
 * prints — and are left alone when there is nothing to walk, while the sheet
 * is open, or when History is not the view; the empty transcript says
 * VibeField's words. (Through the room's lazy chunk: `history-chunk.test.tsx`.)
 * And D2 (AR-8, build-hf.md §2): a hit inside a delegated thread is listed
 * under its root, where it was dropped while the catalog held roots alone.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvasEngine } from "@vibecook/ice";
import type { FrameView, FrameViewState, ShellPlatform } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, type ReactElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isCommandPaletteChord, listenForProductChord } from "../src/field/product-chords";
import { type FrameSurface, foldSurface } from "../src/frame/frame-surface";
import { resetGodviewLineDoorForTest, resetHistoryLineDoorForTest } from "../src/frame/line-door";
import { ViewFrame } from "../src/frame/ViewFrame";
import { resetActiveViewForTest, useActiveView } from "../src/frame/view-state";
import { HistoryView } from "../src/history/HistoryView";
import { type FieldHost, setHost } from "../src/host";
import { CommandPalette } from "../src/hud/CommandPalette";
import { ClipboardStore } from "../src/hud/edge-tray/clipboard-store";
import { ClipboardTray } from "../src/hud/edge-tray/EdgeTray";
import { type RendererLogger, setRendererLogger } from "../src/logging";

vi.mock("../src/plugin-host/plugin-registry-store", () => ({
  usePluginRegistrySnapshot: () => null,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const PROJECTS = fixture("index-projects.mesh.json") as { rows: unknown[]; sources: unknown[] };
const SESSIONS = fixture("index-sessions.mesh.json") as {
  rows: Array<Record<string, unknown>>;
  sources: unknown[];
};
const SESSION = SESSIONS.rows[0] as Record<string, unknown> & {
  activity: { lastAt: number };
};
const MESH_HIT = (
  fixture("index-search-result.mesh.json").hits as Array<Record<string, unknown>>
)[0];

/** `index.search`'s answer: three messages of the one session say "catalog",
 * so a landed hit leaves a stepper with two others to walk. */
const SEARCH = {
  answered: true,
  state: { readiness: "ready", canonicalReady: true },
  hits: [
    { ...MESH_HIT, timelineId: "tl-77", kind: "agent", at: SESSION.activity.lastAt },
    {
      ...MESH_HIT,
      timelineId: "tl-60",
      kind: "user",
      at: SESSION.activity.lastAt - 600_000,
      snippet: "why does the [catalog] lag",
    },
    {
      ...MESH_HIT,
      timelineId: "tl-41",
      kind: "agent",
      at: SESSION.activity.lastAt - 1_200_000,
      snippet: "the [catalog] pages at five hundred",
    },
  ],
  clipped: false,
};

let publish: ((state: FrameViewState) => void) | null = null;
let root: Root | null = null;
let host: HTMLElement | null = null;
let dispose: (() => void) | null = null;
let surfaceNow: FrameSurface | null = null;

// The room is its own chunk; loading it once before the rows keeps each row's
// seconds for the room rather than for its first transform on a busy host.
beforeAll(async () => {
  await import("../src/history/HistoryRoomView");
}, 60_000);

function hostOn(platform: ShellPlatform): void {
  setHost({
    logger: {} as RendererLogger,
    getConnection: () => Promise.resolve({ port: 1, token: "t" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    platform,
    view: {
      set: (next) => Promise.resolve({ view: next }),
      onState: (handler) => {
        publish = handler;
        return () => {
          publish = null;
        };
      },
    },
  } as FieldHost);
}

beforeEach(() => {
  resetActiveViewForTest();
  resetGodviewLineDoorForTest();
  resetHistoryLineDoorForTest();
  publish = null;
  surfaceNow = null;
  window.localStorage.clear();
  setRendererLogger({
    child: () => ({ error: () => undefined, info: () => undefined }) as unknown as RendererLogger,
    error: () => undefined,
  } as unknown as RendererLogger);
  hostOn("darwin");
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  dispose?.();
  root = null;
  host = null;
  dispose = null;
});

/** fieldd, scripted: the index's doors as AR-8b answers them, and search. */
function fieldd() {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    calls,
    async request(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params });
      switch (method) {
        case "index.projects":
          return { rows: [PROJECTS.rows[0]], sources: PROJECTS.sources };
        case "index.sessions":
          return SESSIONS;
        case "index.threads":
          return { rows: [] };
        case "index.status":
          return fixture("index-status.valid.json");
        case "index.project":
          return { ...fixture("index-project.valid.json"), projectId: "p-4f1c2a9e" };
        case "index.search":
          return SEARCH;
        case "index.recent":
          return {
            rows: [
              {
                ...SESSION,
                provider: "claude",
                profileId: "claude:9a3d",
                here: true,
                cwdExists: true,
              },
            ],
          };
        case "index.session":
          return { session: { ...SESSION, profileId: "claude:9a3d" } };
        case "agent.providers":
          return fixture("agent-providers.valid.json");
        default:
          throw Object.assign(new Error(`${method} is not scripted`), { kind: "NOT_FOUND" });
      }
    },
    async subscribe(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      return {
        subId: "sub-1",
        snapshot: { snapshot: { epoch: "changes-local-1", revision: 0, rows: [] } },
        unsubscribe: () => undefined,
      };
    },
  };
}

/** The window as it holds History: FieldView's one owner of the open
 * surface, the frame (cover + line) with History's controller in the cover,
 * the palette and the clipboard's drawer on the same value, and ChromeLayer's
 * ⌘K glue — the window's capture phase, toggling the palette. */
function mount(client: ReturnType<typeof fieldd>): void {
  const engine = createCanvasEngine({});
  const clipboard = new ClipboardStore(() => 0);
  dispose = () => engine.dispose();
  function Owner(): ReactElement {
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    const view = useActiveView();
    surfaceNow = surface;
    useEffect(
      () =>
        listenForProductChord(isCommandPaletteChord, () =>
          setSurface(surface === "palette" ? null : "palette"),
        ),
      [surface],
    );
    return (
      <FielddProvider client={client as unknown as FielddClient}>
        <ViewFrame
          godview={<div data-testid="godview-content" />}
          history={(active) => (
            <HistoryView active={active} surface={surface} onSurfaceChange={setSurface} />
          )}
          surface={surface}
          onSurfaceChange={setSurface}
        />
        <CommandPalette
          ce={engine}
          open={surface === "palette"}
          onClose={() => setSurface(foldSurface(surface, "palette"))}
          windowId="field"
          view={view}
          keys="mac"
          onAct={() => undefined}
        />
        <ClipboardTray store={clipboard} host={{}} surface={surface} onSurfaceChange={setSurface} />
      </FielddProvider>
    );
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Owner />));
}

function to(view: FrameView): void {
  act(() => publish?.({ view }));
}

async function until<T>(read: () => T | null | undefined, label: string, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

const slot = (): HTMLElement | null =>
  host?.querySelector<HTMLElement>('[data-cover-view="history"]') ?? null;
const sheet = (): HTMLElement | null =>
  slot()?.querySelector<HTMLElement>('.vf-history-layers [role="dialog"]') ?? null;
const stepper = (): string | null =>
  slot()?.querySelector(".ah-stepper .tnum")?.textContent?.trim() ?? null;

/** A key as a person presses it, aimed at `target`; answers the event, so a
 * row can read whether anything claimed it. */
function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function typeInto(input: HTMLInputElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** ⌘3, and the room's rows in it. */
async function openHistory(): Promise<void> {
  to("history");
  await until(() => slot()?.querySelector("button.ah-project-list-item"), "the room's rows");
}

/** The strip's pill, pressed; answers the sheet's field. */
async function openSheet(): Promise<HTMLInputElement> {
  const launcher = await until(
    () => slot()?.querySelector<HTMLButtonElement>(".ah-launcher__open"),
    "the strip's search pill",
  );
  act(() => launcher.click());
  const dialog = await until(sheet, "the room's sheet");
  const input = dialog.querySelector<HTMLInputElement>("input");
  if (input === null) throw new Error("the sheet has no field");
  return input;
}

/** Search "catalog" and open its first hit: the sheet leaves, the session
 * opens, and the stepper stands in the transcript's head. */
async function landHit(): Promise<void> {
  const input = await openSheet();
  typeInto(input, "catalog");
  await until(
    () => (sheet()?.querySelectorAll('[role="option"]').length === 3 ? true : null),
    "three hits in the sheet",
  );
  press(input, { key: "Enter" });
  await until(() => (sheet() === null ? true : null), "the sheet leaving as the hit opens");
  await until(stepper, "the stepper in the transcript's head");
}

/** The stepper's place after walking `delta` from "at of total". */
function walked(from: string, delta: number): string {
  const [at, , total] = from.split(" ").map(Number) as [number, unknown, number];
  return `${((at - 1 + delta + total) % total) + 1} of ${total}`;
}

const create = (): HTMLButtonElement => {
  const button = host?.querySelector<HTMLButtonElement>(".vf-line-create");
  if (!button) throw new Error("the line's create did not render");
  return button;
};

/** The room's own platform reading (its `shortcutLabel`) is the page's
 * navigator; the host's is main's. Electron's agree — happy-dom's names no
 * Mac — so a row that reads the printed label sets the page's to match. */
function pagePlatform(platform: string): () => void {
  Object.defineProperty(window.navigator, "platform", { value: platform, configurable: true });
  return () => {
    Reflect.deleteProperty(window.navigator, "platform");
  };
}

describe("History's search until the Peek lands (the search interim)", () => {
  it("the strip's pill opens the room's sheet in the room's layer, printing no key, and Esc closes it", async () => {
    mount(fieldd());
    await openHistory();
    const launcher = slot()?.querySelector<HTMLButtonElement>(".ah-launcher__open");
    // `shortcut: null`: no key is spent on opening the sheet, so none is printed.
    expect(launcher?.querySelector("kbd")).toBeNull();
    expect(launcher?.textContent).toContain("Search");
    // The layer it hangs from starts at the head band's foot and ends at the
    // reserve: the frame's numbers, projected (the rule: ui-system-boundaries).
    const glass = slot()?.querySelector<HTMLElement>(".vf-history:has(.ah-frame)");
    expect(glass?.style.getPropertyValue("--vf-history-head")).toBe("52px");
    expect(glass?.style.getPropertyValue("--vf-history-reserve")).toBe("88px");
    const input = await openSheet();
    // The sheet portals into the room's layer, and it is the frame's surface.
    expect(sheet()?.closest(".vf-history-layers")).not.toBeNull();
    expect(surfaceNow).toBe("history-search");
    expect(document.activeElement).toBe(input);
    press(input, { key: "Escape" });
    await until(() => (sheet() === null ? true : null), "the sheet closed by Esc");
    expect(surfaceNow).toBeNull();
  });

  it("a change of view folds the sheet, and ⌘3 back finds the room without it", async () => {
    mount(fieldd());
    await openHistory();
    await openSheet();
    expect(surfaceNow).toBe("history-search");
    to("godview");
    await until(() => (sheet() === null ? true : null), "the sheet folded by the change of view");
    expect(surfaceNow).toBeNull();
    to("history");
    expect(sheet()).toBeNull();
    expect(slot()?.querySelector(".ah-launcher__open")).not.toBeNull();
  });

  it("nothing of the frame's takes the sheet's Esc first: opening the sheet folds an open drawer", async () => {
    mount(fieldd());
    await openHistory();
    // The clipboard's drawer, pinned open from its notch: while open it takes
    // Esc on the window's capture phase, before anything else.
    act(() => {
      host
        ?.querySelector(".vf-edge-tray__nub")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(surfaceNow).toBe("clipboard");
    expect(host?.querySelector<HTMLElement>(".vf-edge-tray")?.dataset.open).toBe("true");
    const input = await openSheet();
    expect(surfaceNow).toBe("history-search");
    expect(host?.querySelector<HTMLElement>(".vf-edge-tray")?.dataset.open).toBe("false");
    press(input, { key: "Escape" });
    await until(() => (sheet() === null ? true : null), "the sheet closed by Esc");
    expect(surfaceNow).toBeNull();
  });

  it("⌘K keeps toggling the palette in History, and the palette folds the sheet", async () => {
    mount(fieldd());
    await openHistory();
    expect(press(document.body, { key: "k", metaKey: true }).defaultPrevented).toBe(true);
    expect(surfaceNow).toBe("palette");
    press(document.body, { key: "k", metaKey: true });
    expect(surfaceNow).toBeNull();
    // Over the room's sheet: the palette opens and the sheet folds.
    const input = await openSheet();
    expect(press(input, { key: "k", metaKey: true }).defaultPrevented).toBe(true);
    expect(surfaceNow).toBe("palette");
    await until(() => (sheet() === null ? true : null), "the sheet folded by the palette");
    expect(host?.querySelector('[role="dialog"][aria-label="Command palette"]')).not.toBeNull();
    press(document.activeElement ?? document.body, { key: "k", metaKey: true });
    expect(surfaceNow).toBeNull();
  });

  it("a query lands a hit from the index, the room reports the choice, and the search is remembered under vf.history.", async () => {
    const client = fieldd();
    mount(client);
    await openHistory();
    expect(create().getAttribute("aria-disabled")).toBe("true");
    await landHit();
    expect(client.calls.find((call) => call.method === "index.search")?.params).toMatchObject({
      q: "catalog",
    });
    expect(surfaceNow).toBeNull();
    expect(stepper()).toMatch(/^[123] of 3$/u);
    // The room told its host what it chose: Resume wakes for the landed session.
    await until(() => (create().hasAttribute("aria-disabled") ? null : true), "Resume to wake");
    expect(JSON.parse(window.localStorage.getItem("vf.history.search.recent") ?? "null")).toEqual([
      "catalog",
    ]);
  });

  it("⌘G and ⇧⌘G walk the landed session's matches — the keys the stepper prints — and are left alone with nothing to walk, the sheet open, or History not the view", async () => {
    const restore = pagePlatform("MacIntel");
    try {
      mount(fieldd());
      await openHistory();
      // Nothing to walk yet: the key falls through, unclaimed.
      expect(press(document.body, { key: "g", metaKey: true }).defaultPrevented).toBe(false);
      await landHit();
      const start = stepper() ?? "";
      // The stepper prints the two keys VibeField binds.
      expect(
        slot()
          ?.querySelector('.ah-stepper button[aria-label^="Next match"]')
          ?.getAttribute("aria-label"),
      ).toBe("Next match (⌘G)");
      expect(
        slot()
          ?.querySelector('.ah-stepper button[aria-label^="Previous match"]')
          ?.getAttribute("aria-label"),
      ).toBe("Previous match (⌘⇧G)");
      expect(press(document.body, { key: "g", metaKey: true }).defaultPrevented).toBe(true);
      expect(stepper()).toBe(walked(start, 1));
      expect(
        press(document.body, { key: "G", metaKey: true, shiftKey: true }).defaultPrevented,
      ).toBe(true);
      expect(stepper()).toBe(start);
      press(document.body, { key: "G", metaKey: true, shiftKey: true });
      expect(stepper()).toBe(walked(start, -1));
      // Not the key: the other platform's modifier, or ⌥ with it.
      expect(press(document.body, { key: "g", ctrlKey: true }).defaultPrevented).toBe(false);
      expect(press(document.body, { key: "g", metaKey: true, altKey: true }).defaultPrevented).toBe(
        false,
      );
      expect(stepper()).toBe(walked(start, -1));
      // While the sheet is open the key is the sheet's, and the stepper waits.
      const input = await openSheet();
      expect(press(input, { key: "g", metaKey: true }).defaultPrevented).toBe(false);
      press(input, { key: "Escape" });
      await until(() => (sheet() === null ? true : null), "the sheet closed by Esc");
      expect(stepper()).toBe(walked(start, -1));
      // In Godview the key is not History's.
      to("godview");
      expect(press(document.body, { key: "g", metaKey: true }).defaultPrevented).toBe(false);
      to("history");
      expect(press(document.body, { key: "g", metaKey: true }).defaultPrevented).toBe(true);
      expect(stepper()).toBe(start);
    } finally {
      restore();
    }
  });

  it("the empty transcript says where the search is, and names no key", async () => {
    mount(fieldd());
    await openHistory();
    const transcript = slot()?.querySelector(".ah-col--measure");
    expect(transcript?.textContent).toContain("No session open");
    expect(transcript?.textContent).toContain("Pick a session, or search above.");
    expect(slot()?.textContent).not.toContain("⌘K");
    expect(slot()?.textContent).not.toContain("front door");
  });
});

describe("AR-8 (D2) — a hit inside a delegated thread", () => {
  it("is listed in the room's sheet under its root — the thread rides the meta (`index.threads`), so the room's grouping keeps it", async () => {
    // a subagent of the scripted session, as `index.threads` answers it
    const thread = (fixture("index-threads.valid.json").rows as Array<Record<string, unknown>>)[0];
    const client = fieldd();
    const ask = client.request.bind(client);
    client.request = async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "index.threads") return { rows: [thread] };
      if (method === "index.search") {
        await ask(method, params);
        return {
          ...SEARCH,
          hits: [
            ...SEARCH.hits,
            {
              ...MESH_HIT,
              sessionId: thread?.["sessionId"],
              rootSessionId: SESSION["sessionId"],
              timelineId: "tl-c1",
              kind: "agent",
              at: SESSION.activity.lastAt - 300_000,
              snippet: "the subagent read the [catalog] doors",
            },
          ],
        };
      }
      return ask(method, params);
    };
    mount(client);
    await openHistory();
    const input = await openSheet();
    typeInto(input, "catalog");
    const listed = (): Element[] => [...(sheet()?.querySelectorAll('[role="option"]') ?? [])];
    await until(() => listed().length >= 3, "the root's own three hits in the sheet");
    const options = await until(
      () => (listed().length === 4 ? listed() : null),
      "the thread's hit beside them — a fourth, never dropped",
      2_000,
    );
    expect(options.some((option) => option.textContent?.includes("the subagent read the"))).toBe(
      true,
    );
  }, 15_000);
});

describe("off the Mac (the search interim)", () => {
  it("Ctrl G and Ctrl Shift G walk the matches — what the stepper prints there — and ⌘G is not the key", async () => {
    hostOn("win32");
    const restore = pagePlatform("Win32");
    try {
      mount(fieldd());
      await openHistory();
      await landHit();
      const start = stepper() ?? "";
      expect(
        slot()
          ?.querySelector('.ah-stepper button[aria-label^="Next match"]')
          ?.getAttribute("aria-label"),
      ).toBe("Next match (Ctrl G)");
      expect(
        slot()
          ?.querySelector('.ah-stepper button[aria-label^="Previous match"]')
          ?.getAttribute("aria-label"),
      ).toBe("Previous match (Ctrl Shift G)");
      expect(press(document.body, { key: "g", metaKey: true }).defaultPrevented).toBe(false);
      expect(stepper()).toBe(start);
      expect(press(document.body, { key: "g", ctrlKey: true }).defaultPrevented).toBe(true);
      expect(stepper()).toBe(walked(start, 1));
      expect(
        press(document.body, { key: "G", ctrlKey: true, shiftKey: true }).defaultPrevented,
      ).toBe(true);
      expect(stepper()).toBe(start);
    } finally {
      restore();
    }
  });
});
