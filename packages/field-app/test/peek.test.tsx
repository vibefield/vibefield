// @vitest-environment happy-dom
/**
 * Search — the Peek, in the window (DESIGN.md §8 "Search — the Peek"; One
 * Frame §23, GV-D8/D9/D10/D3; built for History 2026-10-08, P1). The shipping
 * composition as ChromeLayer holds it — `FramePeek` over this window's fieldd
 * client, beside the frame (cover + line) with History's controller in the
 * cover, the palette and the clipboard's drawer on FieldView's one owner of
 * the open surface, and ChromeLayer's ⌘K glue. The rows: the frame's button
 * at the head's right end in History with ⌘F printed, opening the popup on
 * Everything; ⌘F as a product chord while History is the view (and only
 * then); Esc and the scrim closing it, the keyboard going back; the words
 * asked of `index.search` unscoped and local, the rows grouped by root with
 * folder · agent and their lines, the matches marked neutral (K1); ↑ ↓ ↵ and
 * a click opening the room AT THE LINE through the room's own `openAt` (the
 * hit's ids, `open-at.ts`); the palette, a drawer and a change of view
 * folding it; the honest empty and unanswered states and an open quote that
 * asks nothing; Live now's words in History (K9); a narrow window folding the
 * peek (K6); the empty transcript naming ⌘F (K2) and ⌘G walking nothing (K3);
 * and D2 (AR-8): a line inside a delegated thread rides its root's row and
 * opens the room at it. (The search interim's own rows left with it:
 * `history-search.test.tsx`, its D2 row carried over here.)
 *
 * P2 (2026-10-09): the button and ⌘F in Godview too, opening on Live now over
 * the rows Godview's monitor publishes (`find-door.ts`) — GV-D3's filters in
 * the scope row and on the button, a pick doing the view's own select — and,
 * in History, Live now on a feed of the Peek's own, open only while it shows
 * (docket PK5), a pick taking Jump to's path.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvasEngine } from "@vibecook/ice";
import type { HistoryPort, HistorySearchResponse } from "@vibecook/puppeteer-views";
import type { FrameView, FrameViewState, ShellPlatform } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, type ReactElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { isCommandPaletteChord, listenForProductChord } from "../src/field/product-chords";
import {
  type GodviewFindDoor,
  type LiveFeedSnapshot,
  type LiveFilters,
  type LiveFindAgent,
  type OpenLiveFeed,
  publishGodviewFindDoor,
  resetGodviewFindDoorForTest,
} from "../src/frame/find-door";
import { type FrameSurface, foldSurface } from "../src/frame/frame-surface";
import {
  type LineViewDoor,
  publishGodviewLineDoor,
  resetGodviewLineDoorForTest,
  resetHistoryLineDoorForTest,
} from "../src/frame/line-door";
import { FramePeek } from "../src/frame/Peek";
import { ViewFrame } from "../src/frame/ViewFrame";
import { resetActiveViewForTest, useActiveView } from "../src/frame/view-state";
import { viewKeysOf } from "../src/frame/views";
import { HistoryView } from "../src/history/HistoryView";
import { getHistoryOpenAt, resetHistoryOpenAtForTest } from "../src/history/open-at";
import { type FieldHost, getHost, setHost } from "../src/host";
import { CommandPalette } from "../src/hud/CommandPalette";
import { ClipboardStore } from "../src/hud/edge-tray/clipboard-store";
import { ClipboardTray } from "../src/hud/edge-tray/EdgeTray";
import { type RendererLogger, setRendererLogger } from "../src/logging";

vi.mock("../src/plugin-host/plugin-registry-store", () => ({
  usePluginRegistrySnapshot: () => null,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "..", "contracts", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const PROJECTS = fixture("index-projects.mesh.json") as { rows: unknown[]; sources: unknown[] };
/** PJ-4 — History's projects (`project.list`) and its keyed listing */
const PJ_PROJECTS = fixture("project-list.valid.json") as { rows: unknown[]; sources: unknown[] };
const KEYED = fixture("index-sessions.keyed.json") as {
  rows: Array<Record<string, unknown>>;
  sources: unknown[];
};
const SESSIONS = { rows: [KEYED.rows[0] as Record<string, unknown>], sources: KEYED.sources };
const SESSION = SESSIONS.rows[0] as Record<string, unknown> & {
  sessionId: string;
  nativeSessionId: string;
  title: string;
  cwd: string;
  activity: { lastAt: number };
};
const EVERYTHING = fixture("index-search-result.everything.json") as {
  hits: Array<Record<string, unknown>>;
};
const RECENT = fixture("index-recent.valid.json") as { rows: Array<{ title?: string }> };

/** The room's session — in the room's meta, so a pick can land there — as
 * `index.search` now carries its root's facts. */
const ROOT_FACTS = {
  rootSessionId: SESSION.sessionId,
  nativeSessionId: SESSION.nativeSessionId,
  title: SESSION.title,
  cwd: SESSION.cwd,
  projectId: "p-4f1c2a9e",
  provider: "claude",
};

/** "catalog": two lines of the room's session (one root, one row), and a
 * session the room does not hold (the fixture's dry run). */
const CATALOG_HITS = [
  {
    sessionId: SESSION.sessionId,
    ...ROOT_FACTS,
    timelineId: "tl-77",
    kind: "agent",
    at: SESSION.activity.lastAt,
    snippet: "the [catalog] travels; the transcripts stay home",
  },
  {
    sessionId: SESSION.sessionId,
    ...ROOT_FACTS,
    timelineId: "tl-60",
    kind: "user",
    at: SESSION.activity.lastAt - 600_000,
    snippet: "why does the [catalog] lag",
  },
  { ...EVERYTHING.hits[2], snippet: "the dry run moved the [catalog] in 41 s" },
];

const ANSWERED = (hits: unknown[], clipped = false) => ({
  answered: true,
  state: { readiness: "ready", canonicalReady: true },
  hits,
  clipped,
});

let publish: ((state: FrameViewState) => void) | null = null;
let root: Root | null = null;
let host: HTMLElement | null = null;
let dispose: (() => void) | null = null;
let surfaceNow: FrameSurface | null = null;
/** Every view the frame asked the shell for. */
let viewAsked: FrameView[] = [];

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
      set: (next) => {
        viewAsked.push(next);
        return Promise.resolve({ view: next });
      },
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
  resetHistoryOpenAtForTest();
  resetGodviewFindDoorForTest();
  publish = null;
  surfaceNow = null;
  viewAsked = [];
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
  Reflect.deleteProperty(window, "innerWidth");
});

/** fieldd, scripted: History's doors as AR-8b answers them, and the Peek's
 * three — the words (by query), your latest sessions, the projects. */
function fieldd(
  search: (params: Record<string, unknown>) => unknown = () => ANSWERED(CATALOG_HITS),
  threads: unknown[] = [],
) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    calls,
    async request(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params });
      switch (method) {
        // the Peek's dropdown still names rosetta's projects (its own port)
        case "index.projects":
          return { rows: [PROJECTS.rows[0]], sources: PROJECTS.sources };
        // PJ-4 — History's room lists fieldd's
        case "project.list":
          return { rows: [PJ_PROJECTS.rows[0]], sources: PJ_PROJECTS.sources, groupingVersion: 2 };
        case "project.figures":
          return fixture("project-figures.valid.json");
        case "index.sessions":
          return SESSIONS;
        case "index.threads":
          return { rows: threads };
        case "index.status":
          return fixture("index-status.valid.json");
        case "index.project":
          return { ...fixture("index-project.valid.json"), projectId: "p-4f1c2a9e" };
        case "index.search":
          return search(params);
        case "index.recent":
          return RECENT;
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

/** The window as ChromeLayer holds History and its search: FieldView's one
 * owner of the open surface, the frame with History's controller in the
 * cover, the palette and the clipboard's drawer on the same value, ⌘K's glue,
 * and the frame's Peek over the window's client. */
function mount(
  client: ReturnType<typeof fieldd>,
  opts: { openLiveFeed?: OpenLiveFeed } = {},
): void {
  const engine = createCanvasEngine({});
  const clipboard = new ClipboardStore(() => 0);
  dispose = () => engine.dispose();
  function Owner(): ReactElement {
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    const view = useActiveView();
    const [keys] = useState(() => viewKeysOf(getHost().platform));
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
        <FramePeek
          view={view}
          keys={keys}
          surface={surface}
          onSurfaceChange={setSurface}
          {...(opts.openLiveFeed !== undefined ? { openLiveFeed: opts.openLiveFeed } : {})}
        />
        <ViewFrame
          godview={<div data-testid="godview-content" />}
          history={(active) => <HistoryView active={active} />}
          surface={surface}
          onSurfaceChange={setSurface}
        />
        <CommandPalette
          ce={engine}
          open={surface === "palette"}
          onClose={() => setSurface(foldSurface(surface, "palette"))}
          windowId="field"
          view={view}
          keys={keys}
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
const button = (): HTMLButtonElement | null =>
  host?.querySelector<HTMLButtonElement>(".vf-peek-button") ?? null;
const pop = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.vf-peek-pop[role="dialog"]');
const field = (): HTMLInputElement | null =>
  pop()?.querySelector<HTMLInputElement>(".vf-peek-field input") ?? null;
const options = (): HTMLElement[] => [
  ...(pop()?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
];
const foot = (): string => pop()?.querySelector(".vf-peek-said")?.textContent ?? "";

/** A key as a person presses it, aimed at `target`; answers the event. */
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

/** The frame's button, pressed; answers the popup's field. */
async function openPeek(): Promise<HTMLInputElement> {
  const at = await until(button, "the frame's search button");
  act(() => at.click());
  await until(pop, "the popup");
  return await until(field, "the popup's field");
}

/** "catalog", typed and answered. */
async function searchCatalog(input: HTMLInputElement): Promise<void> {
  typeInto(input, "catalog");
  await until(() => (options().length === 2 ? true : null), "two rows for “catalog”");
}

describe("Search — the Peek, in History (GV-D8/D9/D10)", () => {
  it("the frame's button stands at the head's right end in History with ⌘F printed, opens the popup on Everything over your latest sessions, and Esc gives the keyboard back", async () => {
    mount(fieldd());
    // not on the canvas; in the views that search, History and Godview (P2)
    expect(button()).toBeNull();
    to("godview");
    expect(button()).not.toBeNull();
    await openHistory();
    const at = button();
    expect(at?.querySelector("kbd")?.textContent).toBe("⌘F");
    expect(at?.getAttribute("aria-keyshortcuts")).toBe("Meta+F");
    expect(at?.getAttribute("aria-haspopup")).toBe("dialog");
    act(() => at?.focus());
    const input = await openPeek();
    expect(surfaceNow).toBe("search");
    // drawn on the document's body, outside the window's tree, over the scrim
    expect(pop()?.closest(".vf-peek")?.parentElement).toBe(document.body);
    expect(document.querySelector('.vf-peek[data-open="true"] .vf-peek-scrim')).not.toBeNull();
    expect(pop()?.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(input);
    // Everything, History's own scope (GV-D9)
    expect(pop()?.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      "Everything",
    );
    expect(input.placeholder).toBe("Search your whole agentic past…");
    // before a word: your latest sessions, newest first
    await until(() => (options().length === RECENT.rows.length ? true : null), "latest sessions");
    expect(options()[0]?.querySelector(".vf-peek-title")?.textContent).toBe(RECENT.rows[0]?.title);
    expect(foot()).toBe("Your latest sessions · every word you type must match");
    // esc printed on close, ↵ printed on Open
    expect(pop()?.querySelector(".vf-peek-esc kbd")?.textContent).toBe("esc");
    expect(pop()?.querySelector(".vf-peek-open")?.textContent).toBe("Open the session↵");
    press(input, { key: "Escape" });
    expect(surfaceNow).toBeNull();
    expect(pop()).toBeNull();
    expect(document.querySelector('.vf-peek[data-open="false"]')).not.toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("⌘F opens it while History or Godview is the view and puts the caret back while it is open — and is left alone on the canvas", async () => {
    mount(fieldd());
    expect(press(document.body, { key: "f", metaKey: true }).defaultPrevented).toBe(false);
    expect(surfaceNow).toBeNull();
    to("godview");
    // P2: Godview's own Find left; the Peek takes ⌘F there, opening on Live now
    expect(press(document.body, { key: "f", metaKey: true }).defaultPrevented).toBe(true);
    expect(surfaceNow).toBe("search");
    expect(pop()?.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      "Live now",
    );
    press(await until(field, "Godview's popup field"), { key: "Escape" });
    expect(surfaceNow).toBeNull();
    await openHistory();
    // not the key: the other platform's modifier, ⇧ or ⌥ with it
    expect(press(document.body, { key: "f", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(document.body, { key: "f", metaKey: true, shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(surfaceNow).toBeNull();
    expect(press(document.body, { key: "f", metaKey: true }).defaultPrevented).toBe(true);
    expect(surfaceNow).toBe("search");
    const input = await until(field, "the popup's field");
    expect(document.activeElement).toBe(input);
    // the caret wandered (to close); ⌘F brings it back, and the popup stays
    const close = pop()?.querySelector<HTMLButtonElement>(".vf-peek-esc");
    act(() => close?.focus());
    expect(document.activeElement).toBe(close);
    expect(press(close ?? document.body, { key: "f", metaKey: true }).defaultPrevented).toBe(true);
    expect(surfaceNow).toBe("search");
    expect(document.activeElement).toBe(input);
  });

  it("asks index.search for Everything — unscoped, this desktop's — and draws a row per session: folder · agent, its lines, the matches marked neutral (K1)", async () => {
    const client = fieldd();
    mount(client);
    await openHistory();
    const input = await openPeek();
    await searchCatalog(input);
    const asked = client.calls.filter((call) => call.method === "index.search");
    expect(asked.at(-1)?.params).toEqual({ q: "catalog", limit: 300, scope: "local" });
    const [first, second] = options();
    // one root, one row: its title, folder · agent, two lines newest first
    expect(first?.querySelector(".vf-peek-title")?.textContent).toBe(SESSION.title);
    expect(first?.querySelector(".vf-peek-sub")?.textContent).toBe("vibe-field · Claude Code");
    expect(
      [...(first?.querySelectorAll(".vf-peek-ev") ?? [])].map((line) => [
        line.querySelector(".vf-peek-who")?.textContent,
        line.querySelector(".vf-peek-tx")?.textContent,
      ]),
    ).toEqual([
      ["agent", "the catalog travels; the transcripts stay home"],
      ["you", "why does the catalog lag"],
    ]);
    expect([...(first?.querySelectorAll("mark") ?? [])].map((mark) => mark.textContent)).toEqual([
      "catalog",
      "catalog",
    ]);
    expect(second?.querySelector(".vf-peek-sub")?.textContent).toBe("scratch · Claude Code");
    expect(foot()).toBe("2 sessions · 3 lines matched");
    expect(first?.getAttribute("aria-selected")).toBe("true");
    expect(field()?.getAttribute("aria-activedescendant")).toBe(first?.id);
    // the peek: the hot session's lines in reading order, the landing one lit
    const peek = pop()?.querySelector(".vf-peek-past");
    expect(peek?.querySelector(".vf-peek-past-head b")?.textContent).toBe(SESSION.title);
    expect(
      [...(peek?.querySelectorAll(".vf-peek-past-line") ?? [])].map((line) =>
        line.getAttribute("data-lands"),
      ),
    ).toEqual([null, "true"]);
    expect(pop()?.querySelector(".vf-peek-open")?.textContent).toBe("Open at the line↵");
    // K1 — a match is neutral: the text's own ink, never orange or the select blue
    const css = readFileSync(join(HERE, "..", "src", "frame", "peek.css"), "utf8");
    const mark = css.match(/^\.vf-peek-pop mark \{([^}]*)\}/mu)?.[1] ?? "";
    expect(mark).toContain("color: var(--vf-text-primary);");
    expect(mark).toContain("var(--vf-text-primary) 11%");
    // (a live run's state dot is the one orange — waiting, §2.5 — and never a match)
    expect(css.match(/--vf-orange/gu)?.length).toBe(1);
    const ink = css.replace(/^\.vf-peek-dot\[data-state="blocked"\] \{[^}]*\}/mu, "");
    expect(ink).not.toMatch(/--vf-orange|--vf-select\)\s*\d|#[\da-f]{3,8}\b/iu);
  });

  it("↑ ↓ move the hot row and ↵ opens it: the popup folds and History's room opens at the line — the hit's own ids, through the room's openAt", async () => {
    mount(fieldd());
    await openHistory();
    const input = await openPeek();
    await searchCatalog(input);
    press(input, { key: "ArrowDown" });
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(pop()?.querySelector(".vf-peek-past-head b")?.textContent).toBe("Migration dry run");
    press(input, { key: "ArrowDown" });
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");
    press(input, { key: "ArrowUp" });
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
    expect(slot()?.querySelector(".ah-col--measure")?.textContent).toContain("No session open");
    press(input, { key: "Enter" });
    expect(surfaceNow).toBeNull();
    expect(pop()).toBeNull();
    // the place, as the door hands it to the room: the newest matched line
    expect(getHistoryOpenAt()).toEqual({ sessionId: SESSION.sessionId, timelineId: "tl-77" });
    await until(
      () =>
        slot()?.querySelector(".ah-col--measure")?.textContent?.includes("No session open")
          ? null
          : true,
      "the room opening the picked session",
    );
  }, 20_000);

  it("a click on a row opens it, Open opens the hot one, and a click on the scrim only closes", async () => {
    mount(fieldd());
    await openHistory();
    let input = await openPeek();
    await searchCatalog(input);
    act(() => options()[1]?.click());
    expect(surfaceNow).toBeNull();
    expect(getHistoryOpenAt()).toEqual({ sessionId: "ses-c2d0", timelineId: "tl-9" });
    const first = getHistoryOpenAt();

    input = await openPeek();
    // the words stay between opens (the kit's); the list is the answer again
    expect(input.value).toBe("catalog");
    await until(() => (options().length === 2 ? true : null), "the rows again");
    act(() => pop()?.querySelector<HTMLButtonElement>(".vf-peek-open")?.click());
    expect(getHistoryOpenAt()).toEqual({ sessionId: SESSION.sessionId, timelineId: "tl-77" });
    // a fresh object per pick, so the room's effect opens it again
    expect(getHistoryOpenAt()).not.toBe(first);

    await openPeek();
    const before = getHistoryOpenAt();
    act(() => {
      document.querySelector<HTMLElement>(".vf-peek-scrim")?.click();
    });
    expect(surfaceNow).toBeNull();
    expect(getHistoryOpenAt()).toBe(before);
  });

  it("one surface at a time: ⌘K over the Peek opens the palette, ⌘F over the palette opens the Peek, a drawer folds it, and a change of view folds it", async () => {
    mount(fieldd());
    await openHistory();
    const input = await openPeek();
    expect(press(input, { key: "k", metaKey: true }).defaultPrevented).toBe(true);
    expect(surfaceNow).toBe("palette");
    expect(pop()).toBeNull();
    expect(host?.querySelector('[role="dialog"][aria-label="Command palette"]')).not.toBeNull();
    expect(
      press(document.activeElement ?? document.body, { key: "f", metaKey: true }).defaultPrevented,
    ).toBe(true);
    expect(surfaceNow).toBe("search");
    // the palette folds (after its own fade)
    await until(
      () => (host?.querySelector('[role="dialog"][aria-label="Command palette"]') ? null : true),
      "the palette folded by ⌘F",
    );
    // the clipboard's drawer, pinned open from its notch, folds the Peek
    act(() => {
      host
        ?.querySelector(".vf-edge-tray__nub")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    expect(surfaceNow).toBe("clipboard");
    expect(pop()).toBeNull();
    // …and opening the Peek folds the drawer, whose Esc then is not in the way
    const again = await openPeek();
    expect(host?.querySelector<HTMLElement>(".vf-edge-tray")?.dataset.open).toBe("false");
    press(again, { key: "Escape" });
    expect(surfaceNow).toBeNull();
    // a change of view folds it
    await openPeek();
    to("godview");
    await until(() => (surfaceNow === null ? true : null), "the Peek folded by ⌘2");
    expect(pop()).toBeNull();
  });

  it("says what it found in words: nothing matching, an index with no answer (keeping what it showed), a door that refused — and an open quote asks nothing", async () => {
    const building = fixture("index-search-result.building.json");
    const client = fieldd((params) => {
      if (params["q"] === "zeppelin") return ANSWERED([]);
      if (params["q"] === "catalog building") return building;
      if (params["q"] === "refused") throw new Error("the agent index answered 500");
      return ANSWERED(CATALOG_HITS);
    });
    mount(client);
    await openHistory();
    const input = await openPeek();
    typeInto(input, "zeppelin");
    await until(() => (foot() === "0 sessions · 0 lines matched" ? true : null), "the answer");
    expect(pop()?.querySelector(".vf-peek-none")?.textContent).toBe(
      "Nothing in your past holds every word of “zeppelin”. Try fewer words, or a phrase in quotes.",
    );
    await searchCatalog(input);
    // unanswered: the rows it showed stay, and the foot says why
    typeInto(input, "catalog building");
    await until(() => (foot().startsWith("No answer yet") ? true : null), "the unanswered foot");
    expect(foot()).toBe("No answer yet — the index is being built · 21%");
    expect(options()).toHaveLength(2);
    typeInto(input, "refused");
    await until(() => (foot().startsWith("Search could not") ? true : null), "the refusal");
    expect(foot()).toBe("Search could not ask the index — the agent index answered 500");
    // a quote still open asks nothing
    const asked = client.calls.filter((call) => call.method === "index.search").length;
    typeInto(input, '"cargo te');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(foot()).toBe("Close the quote to search for the phrase");
    expect(client.calls.filter((call) => call.method === "index.search").length).toBe(asked);
    typeInto(input, '"cargo test"');
    await until(
      () =>
        client.calls.some(
          (call) => call.method === "index.search" && call.params["q"] === '"cargo test"',
        ),
      "the closed phrase, asked whole",
    );
  });

  it("the dropdowns narrow Everything — a project, a side (asked of the index), an agent — and Esc closes a menu before the popup", async () => {
    const client = fieldd();
    mount(client);
    await openHistory();
    const input = await openPeek();
    await searchCatalog(input);
    const dropdown = (which: string) =>
      pop()?.querySelector<HTMLButtonElement>(`[data-peek-dd="${which}"] .vf-peek-dd`);
    expect(
      [...(pop()?.querySelectorAll(".vf-peek-dd-label") ?? [])].map((label) => label.textContent),
    ).toEqual(["Every project", "Prompts and replies", "Any agent"]);
    // the project: rows outside it leave
    act(() => dropdown("project")?.click());
    const menu = await until(() => pop()?.querySelector('[role="menu"]'), "the project menu");
    expect(
      [...menu.querySelectorAll('[role="menuitemradio"]')].map((row) => row.textContent),
    ).toEqual(["Every project", "vibe-field"]);
    // Esc folds the menu first, and the popup stays
    press(input, { key: "Escape" });
    expect(pop()?.querySelector('[role="menu"]')).toBeNull();
    expect(surfaceNow).toBe("search");
    act(() => dropdown("project")?.click());
    act(() => pop()?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[1]?.click());
    expect(dropdown("project")?.textContent).toBe("vibe-field");
    expect(options()).toHaveLength(1);
    // the side: asked of the index
    act(() => dropdown("kind")?.click());
    act(() =>
      [...(pop()?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
        .find((row) => row.textContent === "Prompts only")
        ?.click(),
    );
    await until(
      () =>
        client.calls.some(
          (call) => call.method === "index.search" && call.params["kind"] === "user",
        ),
      "the side asked of the index",
    );
    expect(dropdown("kind")?.textContent).toBe("Prompts only");
    // the agent: Codex holds none of these rows
    act(() => dropdown("agent")?.click());
    act(() =>
      [...(pop()?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
        .find((row) => row.textContent === "Codex")
        ?.click(),
    );
    expect(dropdown("agent")?.textContent).toBe("Codex");
    await until(() => (options().length === 0 ? true : null), "no row left");
    expect(pop()?.querySelector(".vf-peek-none")?.textContent).toMatch(
      /^Nothing the filters keep holds every word of “catalog”/u,
    );
  });

  it("Live now, in History, is live while it shows (PK5): the feed opens with the tab and closes on a change of scope, the popup's close, a change of view and unmount", async () => {
    const feed = liveFeedFake();
    mount(fieldd(), { openLiveFeed: feed.open });
    await openHistory();
    let input = await openPeek();
    // Everything, History's own: no feed
    expect(feed.live()).toBe(0);
    liveNowTab();
    expect(feed.live()).toBe(1);
    expect(input.placeholder).toBe("Words said in a live session, a folder, an agent…");
    expect(foot()).toBe("Asking what runs…");
    feed.push({ runs: LIVE_RUNS, state: { kind: "live" } });
    await until(() => (options().length === 2 ? true : null), "two live rows");
    expect(foot()).toBe("2 live sessions, waiting first");
    // waiting first; where a peer's run runs (K10); no dropdowns in History
    expect(options().map((row) => row.querySelector(".vf-peek-title")?.textContent)).toEqual([
      "deploy",
      "vibe-field",
    ]);
    expect(options()[0]?.querySelector(".vf-peek-when")?.textContent).toBe("waiting");
    expect(options()[0]?.querySelector(".vf-peek-os")?.textContent).toBe("studio");
    expect(pop()?.querySelector(".vf-peek-dds")).toBeNull();
    // K9's words retired with the feed
    expect(pop()?.textContent).not.toContain("searched in Godview");
    // a change of scope closes it, Live now opens it again
    everythingTab();
    expect(feed.live()).toBe(0);
    liveNowTab();
    expect(feed.live()).toBe(1);
    // the popup's close closes it
    press(input, { key: "Escape" });
    expect(feed.live()).toBe(0);
    // each open starts on Everything again (GV-D9) — and opens nothing
    input = await openPeek();
    expect(pop()?.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      "Everything",
    );
    expect(feed.live()).toBe(0);
    // a change of view folds the popup, and closes the feed with it
    liveNowTab();
    expect(feed.live()).toBe(1);
    to("canvas");
    await until(() => (surfaceNow === null ? true : null), "the popup folded by the view");
    expect(feed.live()).toBe(0);
    // unmount closes it
    await openHistory();
    await openPeek();
    liveNowTab();
    expect(feed.live()).toBe(1);
    act(() => root?.unmount());
    root = null;
    expect(feed.live()).toBe(0);
    expect(feed.opened()).toBe(4);
  });

  it("History's Live now asks rosetta through its own feed, and a pick takes Jump to's path — Godview, and the deck reveals the run's pane", async () => {
    const feed = liveFeedFake();
    const reveal = vi.fn(async () => ({ state: "opened" as const }));
    publishGodviewLineDoor({ canPlace: true, reveal } as unknown as LineViewDoor);
    mount(fieldd(), { openLiveFeed: feed.open });
    await openHistory();
    const input = await openPeek();
    liveNowTab();
    feed.push({ runs: LIVE_RUNS, state: { kind: "live" } });
    typeInto(input, "catalog");
    await until(() => (options().length === 1 ? true : null), "the run whose words matched");
    expect(feed.searched.at(-1)).toMatchObject({
      query: "catalog",
      nativeSessionIds: ["native-local"],
      prefix: true,
    });
    expect(options()[0]?.querySelector(".vf-peek-tx")?.textContent).toBe("the catalog doors");
    expect(foot()).toBe("1 session · 1 line matched");
    expect(pop()?.querySelector(".vf-peek-open")?.textContent).toBe("Open in the terminals↵");
    press(input, { key: "Enter" });
    expect(surfaceNow).toBeNull();
    await until(() => (reveal.mock.calls.length > 0 ? true : null), "the deck's reveal");
    expect(viewAsked).toEqual(["godview"]);
    expect(reveal).toHaveBeenCalledExactlyOnceWith("pty-local");
    expect(feed.live()).toBe(0);
  });

  it("History's Live now with nothing matching offers everything for the words, keeping them", async () => {
    const feed = liveFeedFake();
    mount(fieldd(), { openLiveFeed: feed.open });
    await openHistory();
    const input = await openPeek();
    liveNowTab();
    feed.push({ runs: LIVE_RUNS, state: { kind: "live" } });
    typeInto(input, "zzz");
    await until(() => pop()?.querySelector(".vf-peek-none p")?.textContent, "the empty sentence");
    expect(pop()?.querySelector(".vf-peek-none p")?.textContent).toBe(
      "No live session holds every word of “zzz”.",
    );
    act(() => pop()?.querySelector<HTMLButtonElement>(".vf-peek-widen")?.click());
    expect(pop()?.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      "Everything",
    );
    expect(field()?.value).toBe("zzz");
    expect(feed.live()).toBe(0);
  });

  it("a narrow window (K6): the popup clamps 24 clear of each side, the peek folds and the list fills", async () => {
    Object.defineProperty(window, "innerWidth", { value: 600, configurable: true });
    mount(fieldd());
    await openHistory();
    const input = await openPeek();
    await searchCatalog(input);
    expect(pop()?.style.width).toBe("552px");
    expect(pop()?.getAttribute("data-folded")).toBe("true");
    expect(pop()?.querySelector(".vf-peek-split")?.getAttribute("data-folded")).toBe("true");
    expect(pop()?.querySelector(".vf-peek-past")).toBeNull();
    // the window grows back: the peek returns
    Object.defineProperty(window, "innerWidth", { value: 1180, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(pop()?.style.width).toBe("900px");
    expect(pop()?.querySelector(".vf-peek-past")).not.toBeNull();
  });

  it("the empty transcript names the key the button prints (K2), and nothing walks a stepper any more (K3)", async () => {
    mount(fieldd());
    await openHistory();
    const transcript = slot()?.querySelector(".ah-col--measure");
    expect(transcript?.textContent).toContain("Pick a session, or search with ⌘F.");
    expect(slot()?.querySelector(".ah-launcher")).toBeNull();
    expect(press(document.body, { key: "g", metaKey: true }).defaultPrevented).toBe(false);
    expect(press(document.body, { key: "G", metaKey: true, shiftKey: true }).defaultPrevented).toBe(
      false,
    );
  });
});

// ---- P2 — Live now: Godview's door, History's own feed ---------------------

const LIVE_READY = {
  reachable: true,
  readiness: "ready" as const,
  checkedAt: "2026-10-09T12:00:00Z",
};

function liveRun(id: string, extra: Partial<LiveFindAgent>): LiveFindAgent {
  return {
    id,
    createdAtMs: Date.now() - 60_000,
    status: "working",
    project: id,
    detail: "",
    color: "#000",
    desk: { id: "here", name: "MacBook Pro", os: "macos", self: true },
    ...extra,
  };
}

/** This desktop's Claude in vibe-field, on floor session pty-local; a peer's
 * Codex in deploy on studio, waiting. */
const LIVE_RUNS: readonly LiveFindAgent[] = [
  liveRun("row-local", {
    project: "vibe-field",
    floorSessionId: "pty-local",
    agent: { provider: { id: "claude", label: "Claude Code" }, nativeSessionId: "native-local" },
  }),
  liveRun("row-peer", {
    project: "deploy",
    status: "blocked",
    desk: { id: "studio", name: "studio", os: "linux", self: false },
    agent: { provider: { id: "codex", label: "Codex" } },
  }),
];

/** rosetta, as Live now asks it: "catalog" is said in the local run. */
function liveHistory(searched: unknown[]): HistoryPort {
  return {
    status: async () => LIVE_READY,
    facts: async () => [],
    search: async (request): Promise<HistorySearchResponse> => {
      searched.push(request);
      return {
        status: LIVE_READY,
        answered: true,
        clipped: false,
        hits:
          request.query === "catalog"
            ? [
                {
                  sessionId: "rs-local",
                  rootSessionId: "rs-local",
                  nativeSessionId: "native-local",
                  timelineId: "tl-1",
                  kind: "agent",
                  at: Date.now(),
                  snippet: "the [catalog] doors",
                },
              ]
            : [],
      };
    },
  };
}

/** History's feed, scripted: how many are open, and what they answer. */
function liveFeedFake() {
  const listeners = new Set<() => void>();
  const searched: unknown[] = [];
  let snapshot: LiveFeedSnapshot = { runs: [], state: { kind: "connecting" } };
  let opened = 0;
  let disposed = 0;
  const history = liveHistory(searched);
  const open: OpenLiveFeed = () => {
    opened += 1;
    let gone = false;
    return {
      read: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      history,
      dispose: () => {
        if (gone) return;
        gone = true;
        disposed += 1;
      },
    };
  };
  return {
    open,
    searched: searched as Array<Record<string, unknown>>,
    push(next: LiveFeedSnapshot) {
      snapshot = next;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
    live: () => opened - disposed,
    opened: () => opened,
  };
}

const scopeTab = (name: string): void =>
  act(() =>
    [...(pop()?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])]
      .find((radio) => radio.textContent === name)
      ?.click(),
  );
const liveNowTab = (): void => scopeTab("Live now");
const everythingTab = (): void => scopeTab("Everything");

/** Godview's monitor, as it publishes Live now's door: its rows, rosetta's
 * port, its select, and the two filters — which republish the door as the
 * monitor would. */
function godviewDoor(): {
  door: () => GodviewFindDoor;
  select: ReturnType<typeof vi.fn>;
  searched: Array<Record<string, unknown>>;
} {
  const select = vi.fn();
  const searched: unknown[] = [];
  const history = liveHistory(searched);
  let filters: LiveFilters = {
    desks: [
      { id: "here", name: "MacBook Pro", os: "macos", here: true, note: "1 agent", quiet: false },
      { id: "studio", name: "studio", os: "linux", here: false, note: "1 agent", quiet: false },
    ],
    desk: null,
    profiles: [
      { id: "native", label: "This Mac", kind: "native", isDefault: true },
      { id: "work", label: "Work", kind: "managed", glyph: "briefcase", blocked: true },
    ],
    profile: null,
  };
  let current: GodviewFindDoor;
  const republish = (): void => {
    current = {
      rows: LIVE_RUNS,
      history,
      select,
      filters,
      setDesk: (id) => {
        filters = { ...filters, desk: id };
        act(() => republish());
      },
      setProfile: (id) => {
        filters = { ...filters, profile: id };
        act(() => republish());
      },
    };
    publishGodviewFindDoor(current);
  };
  republish();
  return { door: () => current, select, searched: searched as Array<Record<string, unknown>> };
}

const liveDropdown = (id: string): HTMLButtonElement | null =>
  pop()?.querySelector<HTMLButtonElement>(`[data-peek-dd="${id}"] .vf-peek-dd`) ?? null;
const menuRow = (label: string): HTMLButtonElement | undefined =>
  [
    ...(pop()?.querySelectorAll<HTMLButtonElement>('.vf-peek-menu [role="menuitemradio"]') ?? []),
  ].find((row) => row.querySelector(".vf-menu-label")?.textContent === label);

describe("Search — the Peek, in Godview: Live now (P2)", () => {
  it("opens on Live now over the monitor's rows, waiting first, a peer's run saying where it runs (K10), Open in the terminals", async () => {
    const godview = godviewDoor();
    mount(fieldd());
    to("godview");
    expect(press(document.body, { key: "f", metaKey: true }).defaultPrevented).toBe(true);
    const input = await until(field, "the popup's field");
    expect(pop()?.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toBe(
      "Live now",
    );
    expect(input.placeholder).toBe("Words said in a live session, a folder, an agent…");
    await until(() => (options().length === 2 ? true : null), "the live rows");
    expect(
      options().map((row) => [
        row.getAttribute("data-kind"),
        row.querySelector(".vf-peek-title")?.textContent,
        row.querySelector(".vf-peek-dot")?.getAttribute("data-state"),
        row.querySelector(".vf-peek-when")?.textContent,
        row.querySelector(".vf-peek-sub")?.textContent,
      ]),
    ).toEqual([
      ["live", "deploy", "blocked", "waiting", "deploy · Codexstudio"],
      ["live", "vibe-field", "working", "working", "vibe-field · Claude Code"],
    ]);
    expect(foot()).toBe("2 live sessions, waiting first");
    // the peer's run cannot be watched from here: the peek says where it runs
    expect(pop()?.querySelector(".vf-peek-live-words")?.textContent).toContain(
      "It runs on studio.",
    );
    // this desktop's run: its own pane (the watch-only pane; this window has no pool)
    press(input, { key: "ArrowDown" });
    expect(pop()?.querySelector("[data-live-peek]")?.getAttribute("data-live-peek")).toBe(
      "unavailable",
    );
    expect(pop()?.querySelector(".vf-peek-open")?.textContent).toBe("Open in the terminals↵");
    // the words: asked of rosetta through the monitor's port, scoped to the live runs
    typeInto(input, "catalog");
    await until(() => (options().length === 1 ? true : null), "the run that said it");
    expect(godview.searched.at(-1)).toMatchObject({
      query: "catalog",
      nativeSessionIds: ["native-local"],
    });
    // ↵: the view's own select, and the popup folds
    press(input, { key: "Enter" });
    expect(surfaceNow).toBeNull();
    expect(godview.select).toHaveBeenCalledExactlyOnceWith("row-local");
    expect(viewAsked).toEqual([]);
  });

  it("carries the view's filters in the scope row (GV-D3), and the button wears the one that is on — its × clears it", async () => {
    const godview = godviewDoor();
    mount(fieldd());
    to("godview");
    // at rest: no token, the plain circle
    expect(host?.querySelector(".vf-peek-token")).toBeNull();
    await openPeek();
    expect(liveDropdown("desk")?.textContent).toBe("All desktops");
    expect(liveDropdown("profile")?.textContent).toBe("Every profile");
    act(() => liveDropdown("desk")?.click());
    expect(
      [...(pop()?.querySelectorAll(".vf-peek-menu [role='menuitemradio']") ?? [])].map((row) =>
        row.textContent?.trim(),
      ),
    ).toEqual(["All desktops", "MacBook Pro · here1 agent", "studio1 agent"]);
    act(() => menuRow("studio")?.click());
    expect(godview.door().filters.desk).toBe("studio");
    expect(liveDropdown("desk")?.textContent).toBe("studio");
    act(() => liveDropdown("profile")?.click());
    expect(menuRow("Work")?.textContent).toBe("Workwaiting");
    act(() => menuRow("Work")?.click());
    expect(godview.door().filters.profile).toBe("work");
    // the button says so at rest, with the popup closed too
    press(field() ?? document.body, { key: "Escape" });
    const parts = [...(host?.querySelectorAll(".vf-peek-token-part") ?? [])].map(
      (part) => part.textContent,
    );
    expect(parts).toEqual(["studio", "Work"]);
    expect(button()?.getAttribute("aria-label")).toBe("Search, filtered to studio · Work");
    act(() => host?.querySelector<HTMLButtonElement>(".vf-peek-token-clear")?.click());
    expect(godview.door().filters.desk).toBeNull();
    expect(godview.door().filters.profile).toBeNull();
    expect(host?.querySelector(".vf-peek-token")).toBeNull();
    // in History the button wears no filter: they are Godview's
    act(() => godview.door().setDesk("studio"));
    await openHistory();
    expect(host?.querySelector(".vf-peek-token")).toBeNull();
  });

  it("asks nothing of a feed of its own in Godview — the monitor's rows are the ones it reads (PF6 stays Godview's)", async () => {
    godviewDoor();
    const feed = liveFeedFake();
    mount(fieldd(), { openLiveFeed: feed.open });
    to("godview");
    await openPeek();
    await until(() => (options().length === 2 ? true : null), "the live rows");
    expect(feed.opened()).toBe(0);
  });
});

describe("AR-8 (D2) — a line inside a delegated thread", () => {
  it("rides its root's row, and a pick opens the room there — the thread is in the room's meta (`index.threads`), never 'not in this index'", async () => {
    // a subagent of the scripted session, as `index.threads` answers it
    const thread = (fixture("index-threads.valid.json").rows as Array<Record<string, unknown>>)[0];
    const child = {
      ...CATALOG_HITS[0],
      sessionId: thread?.["sessionId"],
      timelineId: "tl-c1",
      kind: "agent",
      // the newest matched line: where the row opens
      at: SESSION.activity.lastAt + 60_000,
      snippet: "the subagent read the [catalog] doors",
    };
    mount(fieldd(() => ANSWERED([...CATALOG_HITS, child]), [thread]));
    await openHistory();
    const input = await openPeek();
    await searchCatalog(input);
    const [root] = options();
    // one row for the root: the child's line is its evidence, newest first
    expect(root?.querySelector(".vf-peek-title")?.textContent).toBe(SESSION.title);
    expect(root?.querySelector(".vf-peek-ev .vf-peek-tx")?.textContent).toBe(
      "the subagent read the catalog doors",
    );
    press(input, { key: "Enter" });
    expect(getHistoryOpenAt()).toEqual({ sessionId: thread?.["sessionId"], timelineId: "tl-c1" });
    await until(
      () =>
        slot()?.querySelector(".ah-col--measure")?.textContent?.includes("No session open")
          ? null
          : true,
      "the room opening the thread's root",
    );
    expect(slot()?.textContent).not.toContain("That session is not in this index");
  }, 20_000);
});

describe("off the Mac (the Peek)", () => {
  it("Ctrl+F is the key — printed on the button, opening the popup — and ⌘F is not; the empty transcript says Ctrl+F", async () => {
    hostOn("win32");
    mount(fieldd());
    await openHistory();
    expect(button()?.querySelector("kbd")?.textContent).toBe("CtrlF");
    expect(button()?.getAttribute("aria-keyshortcuts")).toBe("Control+F");
    expect(slot()?.querySelector(".ah-col--measure")?.textContent).toContain(
      "Pick a session, or search with Ctrl+F.",
    );
    expect(press(document.body, { key: "f", metaKey: true }).defaultPrevented).toBe(false);
    expect(surfaceNow).toBeNull();
    expect(press(document.body, { key: "f", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(surfaceNow).toBe("search");
  });
});
