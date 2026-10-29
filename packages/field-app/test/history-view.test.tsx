// @vitest-environment happy-dom
/**
 * AR-8c — History in the frame: the shipping composition (`HistoryView` over
 * fieldd's ports, rosetta's room inside) in the cover's History slot, exactly
 * as ChromeLayer hands it to the frame. The rows: ⌘3 shows the room and it
 * stays mounted — out to Godview and back keeps its scroll and asks the
 * catalog nothing new; the chosen session's Resume — the line's create until
 * HN-7, the palette's History row since, run here as ChromeLayer runs it
 * (`runChosenSession`) and read through the palette's own table — continues
 * the session the room has chosen by `agent.resume`'s native form with the
 * launcher's own facts, placed through Godview's door, the window moved there
 * to show it, a refusal said on the line in the launcher's words; and the
 * line's create is New terminal in the project the room shows (HN-7, LN-D2):
 * the folder ③ shows, asked of Godview's deck, the window moved there — with
 * no project, as Godview's — and a folder it cannot open in said in New
 * agent's words, the window staying. And the room's host knows the window's
 * home (AR-8 L2): a project rooted under it reads `~/…`, one outside it in
 * full.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FrameView, FrameViewState } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameSurface } from "../src/frame/frame-surface";
import {
  chosenSessionWaits,
  getHistoryLineDoor,
  type LineViewDoor,
  publishGodviewLineDoor,
  resetGodviewLineDoorForTest,
  resetHistoryLineDoorForTest,
  runChosenSession,
} from "../src/frame/line-door";
import { frameActGroups } from "../src/frame/palette-acts";
import { ViewFrame } from "../src/frame/ViewFrame";
import { resetActiveViewForTest } from "../src/frame/view-state";
import { HistoryView } from "../src/history/HistoryView";
import { type FieldHost, setHost } from "../src/host";
import { type RendererLogger, setRendererLogger } from "../src/logging";
import { configureTerminalPool } from "../src/terminal/pool";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 2026-10-11 — an act that THROWS (the acts themselves no longer do; this is
// the controller's last word on one that would): the real acts, unless a case
// names one to throw with these words.
const throwing = vi.hoisted(() => ({ act: null as "resume" | "newAgent" | null }));
vi.mock("../src/history/acts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/history/acts")>();
  return {
    ...actual,
    resumeTarget: (...args: Parameters<typeof actual.resumeTarget>) =>
      throwing.act === "resume"
        ? Promise.reject(new Error("the act threw"))
        : actual.resumeTarget(...args),
    newAgent: (...args: Parameters<typeof actual.newAgent>) =>
      throwing.act === "newAgent"
        ? Promise.reject(new Error("the act threw"))
        : actual.newAgent(...args),
  };
});

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

// PJ-4 — History lists fieldd's projects (`project.list`), each session filed
// under the key fieldd joined it to (`index.sessions`' `projectKey`)
const PROJECTS = fixture("project-list.valid.json") as {
  rows: Array<Record<string, unknown>>;
  sources: unknown[];
};
const KEYED = fixture("index-sessions.keyed.json") as {
  rows: Array<Record<string, unknown>>;
  sources: unknown[];
};
/** one session, in the first project (vibe-field) */
const SESSIONS = { rows: [KEYED.rows[0]], sources: KEYED.sources };
const SESSION = KEYED.rows[0] as Record<string, unknown>;
const STUDIO = "01J9ZK3M5Q8XR2V7N4B6C1D0EF";
const SPAWNED = fixture("agent-spawn.valid.json");

let publish: ((state: FrameViewState) => void) | null = null;
let asked: FrameView[] = [];
let root: Root | null = null;
let host: HTMLElement | null = null;

// The room is its own chunk (2026-10-04): `HistoryView` mounts it through
// `room-chunk.tsx`'s dynamic import, so these rows await that boundary as the
// product does (their `until`s). Loading the module ONCE before them keeps a
// row's five seconds for the room rather than for the room's first transform
// on a busy host; the opening face itself is `history-chunk.test.tsx`'s.
beforeAll(async () => {
  await import("../src/history/HistoryRoomView");
}, 60_000);

beforeEach(() => {
  resetActiveViewForTest();
  resetGodviewLineDoorForTest();
  resetHistoryLineDoorForTest();
  throwing.act = null;
  publish = null;
  asked = [];
  setRendererLogger({
    child: () => ({ error: () => undefined, info: () => undefined }) as unknown as RendererLogger,
    error: () => undefined,
  } as unknown as RendererLogger);
  setHost({
    logger: {} as RendererLogger,
    getConnection: () => Promise.resolve({ port: 1, token: "t" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    platform: "darwin",
    view: {
      set: (next) => {
        asked.push(next);
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
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  configureTerminalPool(undefined);
});

/** fieldd, scripted: the index's doors as AR-8b answers them; `list` is the
 * fold's `agent.list` (P3), unanswered when left out; `more` answers the doors
 * a case scripts beside them (PJ-6's), `undefined` leaving one unscripted. */
function fieldd(
  resume: () => unknown,
  list?: () => unknown,
  more?: (method: string, params: Record<string, unknown>) => unknown,
) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let onFrame: ((payload: unknown, kind?: "snapshot" | "delta") => void) | null = null;
  const client = {
    status: "ready",
    onStatusChange: () => () => undefined,
    calls,
    /** a `project.subscribe` ping (PJ-4) */
    ping(payload: Record<string, unknown>): void {
      onFrame?.(
        { epoch: "projects-1", since: 0, revision: 1, upserts: [], removed: [], ...payload },
        "delta",
      );
    },
    async request(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params });
      const scripted = more?.(method, params);
      if (scripted !== undefined) return scripted;
      switch (method) {
        case "project.list":
          return { rows: [PROJECTS.rows[0]], sources: PROJECTS.sources, groupingVersion: 2 };
        case "index.sessions":
          return SESSIONS;
        case "index.threads":
          return { rows: [] };
        case "index.status":
          return fixture("index-status.valid.json");
        case "project.figures":
          return fixture("project-figures.valid.json");
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
        case "agent.resume":
          return resume();
        case "agent.list":
          if (list !== undefined) return list();
          throw Object.assign(new Error("agent.list is not scripted"), { kind: "NOT_FOUND" });
        default:
          throw Object.assign(new Error(`${method} is not scripted`), { kind: "NOT_FOUND" });
      }
    },
    async subscribe(
      method: string,
      params: Record<string, unknown>,
      frame: (payload: unknown, kind?: "snapshot" | "delta") => void,
    ) {
      calls.push({ method, params });
      // the pings are project.subscribe's; the frame's own feed (AO-4b's
      // index.status.subscribe) opens beside it and must not take them
      if (method === "project.subscribe") onFrame = frame;
      return {
        subId: "sub-1",
        snapshot: { snapshot: { epoch: "projects-1", revision: 0, rows: [] } },
        unsubscribe: () => undefined,
      };
    },
  };
  return client;
}

function mount(client: ReturnType<typeof fieldd>): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // FieldView's place: the frame's one owner of the open surface.
  function Owner(): ReactElement {
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    return (
      <FielddProvider client={client as unknown as FielddClient}>
        <ViewFrame
          godview={<div data-testid="godview-content" />}
          history={(active) => <HistoryView active={active} />}
          surface={surface}
          onSurfaceChange={setSurface}
        />
      </FielddProvider>
    );
  }
  act(() => root?.render(<Owner />));
}

function to(view: FrameView): void {
  act(() => publish?.({ view }));
}

async function until<T>(read: () => T | null | undefined, label: string, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

const historySlot = (): HTMLElement | null =>
  host?.querySelector<HTMLElement>('[data-cover-view="history"]') ?? null;

/** Show the scripted project in the room, the way a person does: its row. */
async function showProject(): Promise<void> {
  // PJ-4 (ROOM API v3, H4): a project row with a host act (pin, hide) is a
  // box whose covering button is the selection; one without is the button
  const project = await until(
    () =>
      historySlot()?.querySelector<HTMLButtonElement>(
        ".ah-project-list-item__hit, button.ah-project-list-item",
      ),
    "the room's project row",
  );
  act(() => project.click());
}

/** Choose the scripted session in the project the room shows. */
async function chooseSession(): Promise<void> {
  // PJ-4 (ROOM API v2): a row with a host act is a box whose covering button
  // is the selection; a row without one is the button itself
  const session = await until(
    () =>
      historySlot()?.querySelector<HTMLButtonElement>(
        ".ah-session-list-item .ah-session-list-item__hit, button.ah-session-list-item",
      ),
    "the room's session row",
  );
  act(() => session.click());
}

/** Choose the scripted session in the room, the way a person does: its
 * project, then the session. */
async function choose(): Promise<void> {
  await showProject();
  await chooseSession();
}

const create = (): HTMLButtonElement => {
  const button = host?.querySelector<HTMLButtonElement>(".vf-line-create");
  if (!button) throw new Error("the line's create did not render");
  return button;
};

/** The chosen session's act as the palette's History row draws it (HN-7: the line's create
 * until then) — the door History's controller published, read through the palette's own table,
 * as `CommandPalette` reads it. */
const sessionRow = () => {
  const door = getHistoryLineDoor();
  return frameActGroups("history", "mac", chosenSessionWaits(door), door?.live === true)
    .flatMap((group) => group.acts)
    .find((entry) => entry.id === "chosen-session");
};

/** Its press, as the palette's row runs it (ChromeLayer's glue). */
async function pressSessionRow(): Promise<void> {
  await act(async () => {
    await runChosenSession();
  });
}

describe("History in the frame (AR-8c)", () => {
  it("⌘3 shows rosetta's room on the cover's glass, and out and back keeps it mounted — its scroll and its feed", async () => {
    const client = fieldd(() => SPAWNED);
    mount(client);
    expect(historySlot()?.querySelector(".ah-frame")).toBeNull();
    to("history");
    const frame = await until(
      () => historySlot()?.querySelector<HTMLElement>(".ah-frame"),
      "the room",
    );
    expect(frame.closest(".vf-history")).not.toBeNull();
    expect(frame.getAttribute("data-ah-surface")).toBe("host");
    await until(
      () => historySlot()?.querySelector(".ah-project-list-item"),
      "the catalog's rows in the room",
    );
    const scroller = await until(
      () => historySlot()?.querySelector<HTMLElement>(".ah-cols .ah-scroll"),
      "a column's scroller",
    );
    scroller.scrollTop = 120;
    const subscribed = client.calls.filter((call) => call.method === "project.subscribe");
    expect(subscribed).toHaveLength(1);

    to("godview");
    expect(historySlot()?.hasAttribute("inert")).toBe(true);
    to("history");
    expect(historySlot()?.querySelector(".ah-frame")).toBe(frame);
    expect(historySlot()?.querySelector(".ah-cols .ah-scroll")).toBe(scroller);
    expect(scroller.scrollTop).toBe(120);
    expect(client.calls.filter((call) => call.method === "project.subscribe")).toHaveLength(1);
  });

  it("Resume, the palette's History row, continues the chosen session by its native id with the launcher's facts, placed in Godview's pane", async () => {
    const client = fieldd(() => SPAWNED);
    const place = vi.fn<LineViewDoor["place"]>(async () => ({ state: "opened" }));
    publishGodviewLineDoor({
      panes: [],
      onScreen: false,
      newTerminal: async () => ({ state: "opened" }),
      pasteInto: () => false,
      whenInputOpen: async () => false,
      canPlace: true,
      place,
      reveal: async () => ({ state: "opened" }),
    });
    mount(client);
    to("history");
    expect(sessionRow()).toMatchObject({
      name: "Resume this session",
      waits: "choose a session first",
    });
    await choose();
    await until(() => (sessionRow()?.waits === null ? true : null), "Resume to wake");
    await pressSessionRow();
    await until(() => host?.querySelector(".vf-line-note")?.textContent, "the line's note");
    expect(client.calls.find((call) => call.method === "agent.resume")?.params).toEqual({
      provider: "claude",
      nativeSessionId: SESSION["nativeSessionId"],
      cwd: SESSION["cwd"],
      profileId: "claude:9a3d",
      title: SESSION["title"],
    });
    expect(asked).toContain("godview");
    expect(place).toHaveBeenCalledWith((SPAWNED as { terminal: unknown }).terminal);
    expect(host?.querySelector(".vf-line-note")?.textContent).toBe("Resumed in the active pane");
  });

  it("PJ-6 (Q4): a Resume fieldd answers at the agent's own model — the session's launch model not taken by its resume — says so on the line", async () => {
    const own = "at Claude Code's own model — it can't start a resumed session at a chosen one";
    const client = fieldd(() => ({ ...SPAWNED, modelSelection: { state: "own", reason: own } }));
    publishGodviewLineDoor({
      panes: [],
      onScreen: false,
      newTerminal: async () => ({ state: "opened" }),
      pasteInto: () => false,
      whenInputOpen: async () => false,
      canPlace: true,
      place: async () => ({ state: "opened" }),
      reveal: async () => ({ state: "opened" }),
    });
    mount(client);
    to("history");
    await choose();
    await until(() => (sessionRow()?.waits === null ? true : null), "Resume to wake");
    await pressSessionRow();
    expect(await until(() => host?.querySelector(".vf-line-note")?.textContent, "the note")).toBe(
      `Resumed in the active pane, ${own}`,
    );
  });

  it("a refusal is said on the line in the launcher's words, and the window stays in History", async () => {
    const client = fieldd(() => {
      throw Object.assign(new Error("persona signed out"), {
        kind: "PRECONDITION_FAILED",
        details: { state: "signed-out" },
      });
    });
    mount(client);
    to("history");
    await choose();
    await until(() => (sessionRow()?.waits === null ? true : null), "Resume to wake");
    await pressSessionRow();
    const note = await until(
      () => host?.querySelector(".vf-line-note")?.textContent,
      "the line's note",
    );
    expect(note).toBe("Could not resume — its profile is signed out");
    expect(asked).not.toContain("godview");
  });

  it("writes a project rooted under the window's home as ~/…, and one outside it in full (AR-8 L2)", async () => {
    // main's bootstrap names the OS user's home — the user rosettad indexes
    configureTerminalPool({ transport: "routed", defaultShell: "/bin/zsh", home: "/Users/me" });
    const client = fieldd(() => SPAWNED);
    const ask = client.request.bind(client);
    const outside = {
      ...(PROJECTS.rows[0] as Record<string, unknown>),
      key: "p1:t00ls",
      name: "tools",
      places: [
        {
          ref: { device: STUDIO, placeId: "pl_tools" },
          name: "tools",
          path: "/opt/build/tools",
          class: "folder",
          exists: true,
          mounted: true,
          sessions: 0,
        },
      ],
      anchors: ["place:pl_tools"],
    };
    client.request = async (method: string, params: Record<string, unknown> = {}) =>
      method === "project.list"
        ? { rows: [PROJECTS.rows[0], outside], sources: PROJECTS.sources, groupingVersion: 2 }
        : ask(method, params);
    mount(client);
    to("history");
    const paths = await until(() => {
      const shown = [
        ...(historySlot()?.querySelectorAll(".ah-project-list-item__path small") ?? []),
      ].map((path) => path.textContent);
      return shown.length === 2 ? shown.sort() : null;
    }, "both projects' paths");
    // a project's roots are its places' absolute paths here: the home is the room's to fold
    expect(paths).toEqual(["/opt/build/tools", "~/Projects/vibe-field"]);
  });
});

// PJ-4 — `project.subscribe`'s `regrouped {from, to}` re-keys the room's
// selection: the room lets go of a project id it no longer holds, so History
// opens the chosen session again where it is filed now.
describe("a regroup keeps the chosen session chosen (PJ-4)", () => {
  it("re-keys the selection when the chosen session's project moves to a new key", async () => {
    const client = fieldd(() => SPAWNED);
    mount(client);
    to("history");
    await choose();
    const chosen = (): string | null => {
      const row = historySlot()?.querySelector(".ah-session-list-item.is-selected");
      return (
        row?.querySelector(".ah-session-list-item__hit")?.getAttribute("aria-label") ??
        row?.getAttribute("aria-label") ??
        null
      );
    };
    const before = await until(chosen, "the chosen session");
    expect(historySlot()?.querySelector(".ah-project-list-item.is-selected")).not.toBeNull();
    // the project's first record re-keys it p1: → r: (D9), and fieldd files
    // its sessions under the new key
    const from = PROJECTS.rows[0]?.["key"] as string;
    const record = "r:01JA0B1C2D3E4F5G6H7J8K9M0N";
    const ask = client.request.bind(client);
    client.request = async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "project.list" || method === "index.sessions")
        client.calls.push({ method, params });
      if (method === "project.list")
        return {
          rows: [{ ...PROJECTS.rows[0], key: record }],
          sources: PROJECTS.sources,
          groupingVersion: 2,
        };
      if (method === "index.sessions")
        return { ...SESSIONS, rows: [{ ...SESSION, projectKey: record }] };
      return ask(method, params);
    };
    await act(async () => {
      client.ping({ regrouped: [{ from, to: record }] });
    });
    // the room holds the new key, and the same session is chosen in it
    await until(
      () =>
        client.calls.filter((call) => call.method === "project.list").length >= 2 ? true : null,
      "the regrouped listing",
      2_000,
    );
    await until(
      () => (chosen() === before ? true : null),
      "the same session chosen again under its new key",
      2_000,
    );
    expect(historySlot()?.querySelector(".ah-project-list-item.is-selected")).not.toBeNull();
    // the palette's Resume row (the line's create until HN-7) has its session still
    expect(sessionRow()?.waits).not.toBe("choose a session first");
  }, 20_000);
});

// HN-7 (LN-D2; DESIGN.md §8 "History" — its create is New terminal): the line's
// create opens a fresh shell in the folder of the project the room shows — the
// folder ③ shows, kept as the room reports it and found as New agent finds it —
// asked of Godview's deck, the window moved there as Resume moves it; with no
// project shown, as Godview's create opens one — and so in a project the room
// shows with no folders of fieldd's (rosetta's unassigned bucket); a folder it
// cannot open in is said in New agent's words, one on another desktop in
// History's own, and the window stays. (The other refusal — none here — is
// `startPlaceOf`'s, history-host.)
describe("History's create: New terminal in the project the room shows (HN-7)", () => {
  const VIBE = PROJECTS.rows[0] as Record<string, unknown> & {
    places: Array<Record<string, unknown>>;
  };
  const HERE = VIBE.places[0] as Record<string, unknown>;
  const ELSEWHERE = VIBE.places[1] as Record<string, unknown>;
  /** a second folder of vibe-field on this desktop, after its usual place */
  const WORKTREE = {
    ...HERE,
    ref: { device: STUDIO, placeId: "pl_wt" },
    name: "feature",
    path: "/Users/me/wt/feature",
    branch: "feature",
    sessions: 1,
  };
  /** `project.list`, vibe-field holding these folders */
  const listed = (places: readonly unknown[]) => ({
    rows: [{ ...VIBE, places }],
    sources: PROJECTS.sources,
    groupingVersion: 2,
  });
  /** Godview's door, its new terminal answered as `newTerminal` says */
  const deck = (newTerminal: LineViewDoor["newTerminal"]): LineViewDoor => ({
    panes: [],
    onScreen: false,
    newTerminal,
    pasteInto: () => false,
    whenInputOpen: async () => false,
    canPlace: true,
    place: async () => ({ state: "opened" }),
    reveal: async () => ({ state: "opened" }),
  });
  const noteNow = (): string | null | undefined =>
    host?.querySelector(".vf-line-note")?.textContent;
  /** the create's tooltip names the project ③ shows (DESIGN.md §8 "The line") */
  const namesProject = () => (create().title === "New terminal in vibe-field  ⌘T" ? true : null);
  /** Show the project the room lists as `name`, the way a person does: its row (the room names
   * the row's selection by the project's name first). */
  async function showNamed(name: string): Promise<void> {
    const rows = (): HTMLButtonElement[] => [
      ...(historySlot()?.querySelectorAll<HTMLButtonElement>(
        ".ah-project-list-item__hit, button.ah-project-list-item",
      ) ?? []),
    ];
    const row = await until(
      () => rows().find((button) => button.getAttribute("aria-label")?.startsWith(`${name} · `)),
      `the room's ${name} row`,
    );
    act(() => row.click());
  }

  it("opens in the folder ③ shows — the usual one, then the chosen session's own — asked of Godview's deck, the window moved there", async () => {
    const newTerminal = vi.fn<LineViewDoor["newTerminal"]>(async () => ({ state: "opened" }));
    publishGodviewLineDoor(deck(newTerminal));
    // the one session ran in the worktree, vibe-field's second folder here
    const inWorktree = {
      rows: [{ ...SESSION, cwd: WORKTREE.path, place: WORKTREE.ref }],
      sources: KEYED.sources,
    };
    const client = fieldd(
      () => SPAWNED,
      () => ({ sessions: [] }),
      (method) =>
        method === "project.list"
          ? listed([HERE, WORKTREE, ELSEWHERE])
          : method === "index.sessions"
            ? inWorktree
            : undefined,
    );
    mount(client);
    to("history");
    await showProject();
    await until(namesProject, "the create to name the project ③ shows");
    expect(create().getAttribute("aria-label")).toBe("New terminal");
    expect(create().hasAttribute("aria-disabled")).toBe(false);
    await act(async () => {
      create().click();
    });
    expect(await until(noteNow, "the line's note")).toBe("Terminal opened in the active pane");
    // ③ opens on the usual place while no session is chosen
    expect(newTerminal).toHaveBeenCalledExactlyOnceWith({ cwd: "/Users/me/Projects/vibe-field" });
    expect(asked).toContain("godview");
    // a session chosen: ③ follows it to its own folder — the key History keeps — and the
    // create opens there
    await chooseSession();
    await act(async () => {
      create().click();
    });
    await until(() => (newTerminal.mock.calls.length === 2 ? true : null), "the second ask");
    expect(newTerminal).toHaveBeenLastCalledWith({ cwd: "/Users/me/wt/feature" });
    // the create is no longer the chosen session's act: nothing was resumed
    expect(client.calls.some((call) => call.method === "agent.resume")).toBe(false);
  }, 20_000);

  it("with no project shown, opens as Godview's create does — no folder asked — the window moved there", async () => {
    const newTerminal = vi.fn<LineViewDoor["newTerminal"]>(async () => ({ state: "opened" }));
    publishGodviewLineDoor(deck(newTerminal));
    mount(fieldd(() => SPAWNED));
    to("history");
    await until(() => historySlot()?.querySelector(".ah-project-list-item"), "the room's rows");
    expect(create().title).toBe("New terminal  ⌘T");
    await act(async () => {
      create().click();
    });
    expect(await until(noteNow, "the line's note")).toBe("Terminal opened in the active pane");
    expect(newTerminal).toHaveBeenCalledExactlyOnceWith();
    expect(asked).toContain("godview");
  });

  // the behaviour lens's 4: the room tells its host what ③ shows only while the host lists the
  // project's folders, and fieldd lists none for rosetta's own bucket — the create kept the last
  // project's name and opened there
  it("follows the room to a project with no folders of fieldd's — rosetta's unassigned bucket — and opens there as Godview's create does", async () => {
    const newTerminal = vi.fn<LineViewDoor["newTerminal"]>(async () => ({ state: "opened" }));
    publishGodviewLineDoor(deck(newTerminal));
    // a second session no place holds yet (the fixture's third): the room files it in its own
    // bucket, which is no project of fieldd's
    const client = fieldd(
      () => SPAWNED,
      () => ({ sessions: [] }),
      (method) =>
        method === "index.sessions"
          ? { rows: [KEYED.rows[0], KEYED.rows[2]], sources: KEYED.sources }
          : undefined,
    );
    mount(client);
    to("history");
    await showNamed("vibe-field");
    await until(namesProject, "the create to name vibe-field");
    await showNamed("Unassigned sessions");
    await until(
      () => (create().title === "New terminal  ⌘T" ? true : null),
      "the create to name no project",
    );
    await act(async () => {
      create().click();
    });
    expect(await until(noteNow, "the line's note")).toBe("Terminal opened in the active pane");
    // no folder asked: the bucket reads as no project shown
    expect(newTerminal).toHaveBeenCalledExactlyOnceWith();
    expect(asked).toContain("godview");
    // fieldd is asked a project's suggestions for vibe-field alone, never for the bucket
    const suggested = client.calls
      .filter((call) => call.method === "project.get")
      .map((call) => call.params["key"]);
    expect(new Set(suggested)).toEqual(new Set([VIBE["key"]]));
  }, 20_000);

  /** ③ showing vibe-field's one folder here, with `fact` true of it: a press is refused in
   * `words` — New agent's — before anything moves. */
  async function refusedIn(fact: Record<string, unknown>, words: string): Promise<void> {
    const newTerminal = vi.fn<LineViewDoor["newTerminal"]>(async () => ({ state: "opened" }));
    publishGodviewLineDoor(deck(newTerminal));
    mount(
      fieldd(
        () => SPAWNED,
        () => ({ sessions: [] }),
        (method) => (method === "project.list" ? listed([{ ...HERE, ...fact }]) : undefined),
      ),
    );
    to("history");
    await showProject();
    await until(namesProject, "the create to name the project ③ shows");
    await act(async () => {
      create().click();
    });
    const said = await until(noteNow, "the line's note");
    expect(said).toBe(`Terminal could not be opened — ${words}`);
    // the deck asked nothing, and the window stays in History
    expect(newTerminal).not.toHaveBeenCalled();
    expect(asked).not.toContain("godview");
  }

  it("a folder gone is said in New agent's words, the deck asked nothing, and the window stays in History", async () => {
    await refusedIn({ exists: false }, "the folder is gone");
  }, 20_000);

  it("a folder whose volume is not connected is said the same way, and the window stays", async () => {
    await refusedIn({ mounted: false }, "its volume is not connected");
  }, 20_000);

  // the design lens's 9: History's own reason names the desktop, never New agent's track code
  // ("— not from here until routed acts (DS-2)": ~100 characters for a 2.4 s note that asks
  // under 70)
  it("a folder on another desktop names the desktop in History's own words, the deck asked nothing, and the window stays", async () => {
    const newTerminal = vi.fn<LineViewDoor["newTerminal"]>(async () => ({ state: "opened" }));
    publishGodviewLineDoor(deck(newTerminal));
    // the one session ran in vibe-field's folder on the laptop: ③ follows it there once chosen
    const onLaptop = {
      rows: [{ ...SESSION, cwd: ELSEWHERE["path"], place: ELSEWHERE["ref"] }],
      sources: KEYED.sources,
    };
    mount(
      fieldd(
        () => SPAWNED,
        () => ({ sessions: [] }),
        (method) =>
          method === "project.list"
            ? listed([HERE, ELSEWHERE])
            : method === "index.sessions"
              ? onLaptop
              : undefined,
      ),
    );
    to("history");
    await showProject();
    await until(namesProject, "the create to name the project ③ shows");
    await chooseSession();
    await act(async () => {
      create().click();
    });
    expect(await until(noteNow, "the line's note")).toBe(
      "Terminal could not be opened — vibe-field is on laptop",
    );
    expect(newTerminal).not.toHaveBeenCalled();
    expect(asked).not.toContain("godview");
  }, 20_000);
});

// P3 — Jump to (DESIGN.md §8 "History"; AR-D43, K11). Whether the chosen
// session runs here is fieldd's fold, asked with one plain `agent.list` and
// joined on the room's native id; the run's floor session is what Godview's
// deck reveals.
describe("Jump to, while the chosen session runs here (P3)", () => {
  const SUMMARY = fixture("agent-session-summary.valid.json");
  const NATIVE = SESSION["nativeSessionId"] as string;
  /** The fold with the chosen conversation's run in it (and another run). */
  const running = (overrides: Record<string, unknown> = {}) => ({
    sessions: [
      {
        ...SUMMARY,
        sessionId: "another-conversation",
        runtimeRunId: "run-other",
        terminal: { hosted: "local", runtimeSessionId: "pty-other" },
      },
      {
        ...SUMMARY,
        sessionId: NATIVE,
        runtimeRunId: "run-agent",
        terminal: { hosted: "local", runtimeSessionId: "pty-agent" },
        ...overrides,
      },
    ],
  });
  const ENDED = { continuation: { persisted: true, resumable: true, exited: true } };
  // the chosen session's act: the palette's History row since HN-7, the line's create before
  const glyphShown = (): string | null | undefined => sessionRow()?.glyph;
  const says = (name: string) => () => (sessionRow()?.name === name ? true : null);
  const noteNow = (): string | null | undefined =>
    host?.querySelector(".vf-line-note")?.textContent;
  const deck = (overrides: Partial<LineViewDoor> = {}): LineViewDoor => ({
    panes: [],
    onScreen: false,
    newTerminal: async () => ({ state: "opened" }),
    pasteInto: () => false,
    whenInputOpen: async () => false,
    canPlace: true,
    place: async () => ({ state: "opened" }),
    reveal: async () => ({ state: "opened" }),
    ...overrides,
  });

  it("says Jump to under `jump` while the session runs here, and Resume once its run has ended", async () => {
    let fold: unknown = running();
    const client = fieldd(
      () => SPAWNED,
      () => fold,
    );
    mount(client);
    to("history");
    await choose();
    await until(says("Jump to this session"), "the act to say Jump to");
    expect(glyphShown()).toBe("jump");
    expect(sessionRow()?.key).toBeNull();
    expect(sessionRow()?.waits).toBeNull();
    // the line's create is New terminal whatever the chosen session does (HN-7)
    expect(create().getAttribute("aria-label")).toBe("New terminal");
    // one plain request: nothing subscribes to the board for it (PF6)
    expect(client.calls.some((call) => call.method === "agent.list")).toBe(true);
    expect(client.calls.some((call) => call.method === "agent.subscribe")).toBe(false);

    // the run ended (its record stamped with the exit, its pane still on the
    // floor): History showing again asks again, and the create is Resume
    fold = running(ENDED);
    to("godview");
    to("history");
    await until(says("Resume this session"), "the act to say Resume again");
    expect(glyphShown()).toBe("resume");
  });

  it("a press asks Godview for the view, then reveals the run's floor session — nothing is resumed", async () => {
    let askedAtReveal: FrameView[] = [];
    const reveal = vi.fn<LineViewDoor["reveal"]>(async () => {
      askedAtReveal = [...asked];
      return { state: "opened" };
    });
    publishGodviewLineDoor(deck({ reveal }));
    const client = fieldd(
      () => SPAWNED,
      () => running(),
    );
    mount(client);
    to("history");
    await choose();
    await until(says("Jump to this session"), "the act to say Jump to");
    await pressSessionRow();
    expect(await until(noteNow, "the line's note")).toBe("Jumped to its pane");
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith("pty-agent");
    expect(askedAtReveal, "the deck was asked before the frame moved").toContain("godview");
    expect(client.calls.some((call) => call.method === "agent.resume")).toBe(false);
  });

  it("Resume on a session that runs here refuses in Jump to's words, resumes nothing, and becomes Jump to", async () => {
    let fold: unknown = { sessions: [] };
    const place = vi.fn<LineViewDoor["place"]>(async () => ({ state: "opened" }));
    publishGodviewLineDoor(deck({ place }));
    const client = fieldd(
      () => SPAWNED,
      () => fold,
    );
    mount(client);
    to("history");
    await choose();
    await until(says("Resume this session"), "the act to say Resume");
    await until(() => (sessionRow()?.waits === null ? true : null), "Resume to wake");
    // the run started since the act's reading (in Godview, on the phone…)
    fold = running();
    await pressSessionRow();
    expect(await until(noteNow, "the line's note")).toBe("This session is running — Jump to it");
    expect(client.calls.some((call) => call.method === "agent.resume")).toBe(false);
    expect(place).not.toHaveBeenCalled();
    expect(asked).not.toContain("godview");
    await until(says("Jump to this session"), "the act to become Jump to");
    expect(glyphShown()).toBe("jump");
  });

  it("fieldd's one-run refusal is said in the same words, and the act becomes Jump to", async () => {
    let fold: unknown = { sessions: [] };
    const client = fieldd(
      () => {
        // the run the fold had not shown yet
        fold = running();
        throw Object.assign(new Error("the conversation is already running in another session"), {
          kind: "PRECONDITION_FAILED",
          details: { runtimeRunId: "run-agent", state: "terminal-alive" },
        });
      },
      () => fold,
    );
    mount(client);
    to("history");
    await choose();
    await until(() => (sessionRow()?.waits === null ? true : null), "Resume to wake");
    // a fold that has not seen the run yet: the press goes as far as fieldd
    await pressSessionRow();
    expect(await until(noteNow, "the line's note")).toBe("This session is running — Jump to it");
    expect(client.calls.filter((call) => call.method === "agent.resume")).toHaveLength(1);
    expect(asked).not.toContain("godview");
    await until(says("Jump to this session"), "the act to become Jump to");
  });

  it("Jump to after the run ended says so, shows nothing, and becomes Resume", async () => {
    let fold: unknown = running();
    const reveal = vi.fn<LineViewDoor["reveal"]>(async () => ({ state: "opened" }));
    publishGodviewLineDoor(deck({ reveal }));
    const client = fieldd(
      () => SPAWNED,
      () => fold,
    );
    mount(client);
    to("history");
    await choose();
    await until(says("Jump to this session"), "the act to say Jump to");
    fold = { sessions: [] };
    await pressSessionRow();
    expect(await until(noteNow, "the line's note")).toBe("This session has ended — Resume it");
    expect(reveal).not.toHaveBeenCalled();
    expect(asked).not.toContain("godview");
    await until(says("Resume this session"), "the act to become Resume");
  });

  it("keeps saying Jump to while a new answer is on its way — no flicker through Resume", async () => {
    let answer: () => Promise<unknown> = async () => running();
    const client = fieldd(
      () => SPAWNED,
      () => answer(),
    );
    mount(client);
    to("history");
    await choose();
    await until(says("Jump to this session"), "the act to say Jump to");
    let release: (fold: unknown) => void = () => undefined;
    answer = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const asks = client.calls.filter((call) => call.method === "agent.list").length;
    to("godview");
    to("history");
    await until(
      () =>
        client.calls.filter((call) => call.method === "agent.list").length > asks ? true : null,
      "History showing again to ask again",
    );
    // the ask is out and unanswered: the act still says what it said
    for (let tick = 0; tick < 5; tick++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(sessionRow()?.name).toBe("Jump to this session");
      expect(glyphShown()).toBe("jump");
    }
    await act(async () => {
      release(running(ENDED));
    });
    await until(says("Resume this session"), "the act to say Resume once answered");
  });
});

// 2026-10-11 — two `smoke:godview` reds: New agent was pressed, fieldd started
// the run, the window moved to Godview, and the line said nothing — the act's
// promise rejected into a `void` with no handler. Every act's outcome is said:
// one that throws is refused on the line in its own words, and logged.
describe("an act that throws is said and logged (2026-10-11)", () => {
  /** What the controller logged, by event. */
  function captureLog(): Array<{ event: string; error?: unknown; attrs?: unknown }> {
    const logged: Array<{ event: string; error?: unknown; attrs?: unknown }> = [];
    const child = {
      error: (event: string, _message: string, error?: unknown, attrs?: unknown) =>
        logged.push({ event, error, attrs }),
      info: (event: string, _message: string, attrs?: unknown) => logged.push({ event, attrs }),
    };
    setRendererLogger({ child: () => child, error: () => undefined } as unknown as RendererLogger);
    return logged;
  }
  const noteNow = (): string | null | undefined =>
    host?.querySelector(".vf-line-note")?.textContent;

  it("a session row's Resume that throws says Could not resume, with the throw's words", async () => {
    const logged = captureLog();
    throwing.act = "resume";
    mount(fieldd(() => SPAWNED));
    to("history");
    await choose();
    const resume = await until(
      () =>
        historySlot()?.querySelector<HTMLButtonElement>(
          '.ah-session-list-item .ah-hostact[data-place="row"][data-act="resume"]',
        ),
      "the session row's Resume",
    );
    await act(async () => {
      resume.click();
    });
    expect(await until(noteNow, "the line's note", 3_000)).toBe("Could not resume — the act threw");
    expect(logged.filter((entry) => entry.event === "renderer.history.act_failed")).toEqual([
      {
        event: "renderer.history.act_failed",
        error: new Error("the act threw"),
        attrs: { act: "resume" },
      },
    ]);
  }, 20_000);

  it("the palette's Resume — the line's until HN-7 — that throws is said the same way", async () => {
    const logged = captureLog();
    throwing.act = "resume";
    mount(fieldd(() => SPAWNED));
    to("history");
    await choose();
    await until(() => (sessionRow()?.waits === null ? true : null), "Resume to wake");
    await pressSessionRow();
    expect(await until(noteNow, "the line's note", 3_000)).toBe("Could not resume — the act threw");
    expect(logged.filter((entry) => entry.event === "renderer.history.act_failed")).toEqual([
      {
        event: "renderer.history.act_failed",
        error: new Error("the act threw"),
        attrs: { act: "resume" },
      },
    ]);
  }, 20_000);

  it("New agent that throws says Could not start, with the throw's words", async () => {
    const logged = captureLog();
    throwing.act = "newAgent";
    mount(fieldd(() => SPAWNED));
    to("history");
    await choose();
    const start = await until(
      () =>
        historySlot()?.querySelector<HTMLButtonElement>(
          '.ah-hostact[data-place="head"][data-act="new-agent"]',
        ),
      "New agent in ②'s head",
    );
    await act(async () => {
      start.click();
    });
    const row = await until(
      () =>
        [
          ...(historySlot()?.querySelectorAll<HTMLButtonElement>(
            ".ah-menu [role=menu] .ah-menu__item",
          ) ?? []),
        ].find(
          (item) => (item.getAttribute("data-key") ?? "").startsWith("claude") && !item.disabled,
        ),
      "New agent's row for an agent",
    );
    await act(async () => {
      row.click();
    });
    expect(await until(noteNow, "the line's note", 3_000)).toBe("Could not start — the act threw");
    expect(logged.filter((entry) => entry.event === "renderer.history.act_failed")).toEqual([
      {
        event: "renderer.history.act_failed",
        error: new Error("the act threw"),
        attrs: { act: "newAgent" },
      },
    ]);
  }, 20_000);
});

describe("PJ-6 — New agent's pages turn in place, over the real room", () => {
  /** Work holds the fixture's agent's sign-in (the contract's Work holds two
   * others), and the agent's own picker under it is the contract's */
  const SETS = (() => {
    const listed = fixture("agents-profile-sets.valid.json") as {
      sets: Array<{ id: string; personas: unknown[] }>;
    };
    const persona =
      ((fixture("agent-providers.valid.json") as { providers: Array<{ personas: unknown[] }> })
        .providers[0]?.personas[0] as Record<string, unknown>) ?? {};
    return {
      ...listed,
      sets: listed.sets.map((set) =>
        set.id === "work"
          ? {
              ...set,
              personas: [...set.personas, { ...persona, profileId: "claude:work", set: "work" }],
            }
          : set,
      ),
    };
  })();
  const PICKER = fixture("agent-models.valid.json");

  function launching() {
    return fieldd(
      () => SPAWNED,
      () => ({ sessions: [] }),
      (method) =>
        method === "agents.profileSets.list"
          ? SETS
          : method === "agent.models"
            ? PICKER
            : method === "agent.spawn"
              ? SPAWNED
              : undefined,
    );
  }
  const menuRows = (): HTMLButtonElement[] => [
    ...(historySlot()?.querySelectorAll<HTMLButtonElement>(".ah-menu [role=menu] .ah-menu__item") ??
      []),
  ];
  const rowKeyed = (key: string) => () =>
    menuRows().find((row) => row.getAttribute("data-key") === key) ?? null;
  const trigger = () =>
    historySlot()?.querySelector<HTMLButtonElement>(
      '.ah-hostact[data-place="head"][data-act="new-agent"]',
    ) ?? null;

  beforeEach(() => {
    publishGodviewLineDoor({
      panes: [],
      onScreen: false,
      newTerminal: async () => ({ state: "opened" }),
      pasteInto: () => false,
      whenInputOpen: async () => false,
      canPlace: true,
      place: async () => ({ state: "opened" }),
      reveal: async () => ({ state: "opened" }),
    });
  });

  it("Another model… turns the open rows to the agent's own picker, a model to its efforts, and a value starts it there — each page opening where the last one was", async () => {
    const client = launching();
    mount(client);
    to("history");
    await choose();
    const start = await until(trigger, "New agent in ②'s head");
    await act(async () => {
      start.click();
    });
    // Claude Code under Work, its Another model… beside it
    const work = await until(
      () =>
        historySlot()?.querySelector<HTMLButtonElement>(
          `.ah-menu__row[data-key="claude\u001fwork"] .ah-menu__act[data-act="another"]`,
        ) ?? null,
      "Another model… beside Claude Code under Work",
    );
    await act(async () => {
      work.click();
    });
    // the rows closed on the choice and opened again on the models page
    const opus = await until(rowKeyed("model\u001fopus"), "the picker's Opus row");
    expect(start.getAttribute("aria-expanded")).toBe("true");
    expect(rowKeyed("back")()?.textContent).toContain("All agents");
    expect(client.calls.find((call) => call.method === "agent.models")?.params).toEqual({
      provider: "claude",
      profileSet: "work",
    });
    await act(async () => {
      opus.click();
    });
    const max = await until(rowKeyed("value\u001fmax"), "Opus's effort values");
    expect(start.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      max.click();
    });
    await until(
      () => client.calls.find((call) => call.method === "agent.spawn") ?? null,
      "the start",
    );
    expect(client.calls.find((call) => call.method === "agent.spawn")?.params).toEqual({
      provider: "claude",
      cwd: expect.any(String),
      profileSet: "work",
      modelSelection: { modelId: "opus", controls: { effort: "max" } },
    });
    expect(
      await until(() => host?.querySelector(".vf-line-note")?.textContent, "the note"),
    ).toMatch(/^Started in /);
    // a start closes the rows: the next press opens on the first page
    await until(() => (start.getAttribute("aria-expanded") === "true" ? null : true), "closed");
    await act(async () => {
      start.click();
    });
    await until(
      () => historySlot()?.querySelector(`.ah-menu__row[data-key="claude\u001fwork"]`) ?? null,
      "the first page again",
    );
    expect(rowKeyed("back")()).toBeNull();
  }, 30_000);

  it("rows closed on a page without a choice (Escape) open on the first page again", async () => {
    mount(launching());
    to("history");
    await choose();
    const start = await until(trigger, "New agent in ②'s head");
    await act(async () => {
      start.click();
    });
    const another = await until(
      () =>
        historySlot()?.querySelector<HTMLButtonElement>(
          `.ah-menu__row[data-key="claude\u001fwork"] .ah-menu__act[data-act="another"]`,
        ) ?? null,
      "Another model…",
    );
    await act(async () => {
      another.click();
    });
    await until(rowKeyed("model\u001fopus"), "the models page");
    await act(async () => {
      (document.activeElement ?? document.body).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await until(() => (start.getAttribute("aria-expanded") === "true" ? null : true), "closed");
    await act(async () => {
      start.click();
    });
    await until(
      () => historySlot()?.querySelector(`.ah-menu__row[data-key="claude\u001fwork"]`) ?? null,
      "the first page",
    );
    expect(rowKeyed("model\u001fopus")()).toBeNull();
  }, 30_000);
});
