// @vitest-environment happy-dom
/**
 * AR-8c — History in the frame: the shipping composition (`HistoryView` over
 * fieldd's ports, rosetta's room inside) in the cover's History slot, exactly
 * as ChromeLayer hands it to the frame. The rows: ⌘3 shows the room and it
 * stays mounted — out to Godview and back keeps its scroll and asks the
 * catalog nothing new; and the line's create in History is Resume — the
 * session the room has chosen, continued by `agent.resume`'s native form with
 * the launcher's own facts, placed through Godview's door, the window moved
 * there to show it; a refusal said on the line in the launcher's words. And
 * the room's host knows the window's home (AR-8 L2): a project rooted under it
 * reads `~/…`, one outside it in full.
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
  type LineViewDoor,
  publishGodviewLineDoor,
  resetGodviewLineDoorForTest,
  resetHistoryLineDoorForTest,
} from "../src/frame/line-door";
import { ViewFrame } from "../src/frame/ViewFrame";
import { resetActiveViewForTest } from "../src/frame/view-state";
import { HistoryView } from "../src/history/HistoryView";
import { type FieldHost, setHost } from "../src/host";
import { type RendererLogger, setRendererLogger } from "../src/logging";
import { configureTerminalPool } from "../src/terminal/pool";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
 * fold's `agent.list` (P3), unanswered when left out. */
function fieldd(resume: () => unknown, list?: () => unknown) {
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
      onFrame = frame;
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

/** Choose the scripted session in the room, the way a person does: its
 * project, then the session. */
async function choose(): Promise<void> {
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

const create = (): HTMLButtonElement => {
  const button = host?.querySelector<HTMLButtonElement>(".vf-line-create");
  if (!button) throw new Error("the line's create did not render");
  return button;
};

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

  it("Resume continues the chosen session by its native id with the launcher's facts, placed in Godview's pane", async () => {
    const client = fieldd(() => SPAWNED);
    const place = vi.fn<LineViewDoor["place"]>(async () => ({ state: "opened" }));
    publishGodviewLineDoor({
      panes: [],
      onScreen: false,
      newTerminal: async () => ({ state: "opened" }),
      paste: () => false,
      canPlace: true,
      place,
      reveal: async () => ({ state: "opened" }),
    });
    mount(client);
    to("history");
    expect(create().getAttribute("aria-disabled")).toBe("true");
    expect(create().title).toContain("choose a session first");
    await choose();
    await until(() => (create().hasAttribute("aria-disabled") ? null : true), "Resume to wake");
    await act(async () => {
      create().click();
    });
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
    await until(() => (create().hasAttribute("aria-disabled") ? null : true), "Resume to wake");
    await act(async () => {
      create().click();
    });
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
    expect(create().title).not.toContain("choose a session first");
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
  const glyphShown = (): string | null | undefined =>
    create().querySelector("[data-shown]")?.getAttribute("data-glyph");
  const says = (name: string) => () => (create().getAttribute("aria-label") === name ? true : null);
  const noteNow = (): string | null | undefined =>
    host?.querySelector(".vf-line-note")?.textContent;
  const deck = (overrides: Partial<LineViewDoor> = {}): LineViewDoor => ({
    panes: [],
    onScreen: false,
    newTerminal: async () => ({ state: "opened" }),
    paste: () => false,
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
    await until(says("Jump to this session"), "the create to say Jump to");
    expect(glyphShown()).toBe("jump");
    expect(create().title).toBe("Jump to this session");
    expect(create().hasAttribute("aria-disabled")).toBe(false);
    // one plain request: nothing subscribes to the board for it (PF6)
    expect(client.calls.some((call) => call.method === "agent.list")).toBe(true);
    expect(client.calls.some((call) => call.method === "agent.subscribe")).toBe(false);

    // the run ended (its record stamped with the exit, its pane still on the
    // floor): History showing again asks again, and the create is Resume
    fold = running(ENDED);
    to("godview");
    to("history");
    await until(says("Resume this session"), "the create to say Resume again");
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
    await until(says("Jump to this session"), "the create to say Jump to");
    await act(async () => {
      create().click();
    });
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
    await until(says("Resume this session"), "the create to say Resume");
    await until(() => (create().hasAttribute("aria-disabled") ? null : true), "Resume to wake");
    // the run started since the line's reading (in Godview, on the phone…)
    fold = running();
    await act(async () => {
      create().click();
    });
    expect(await until(noteNow, "the line's note")).toBe("This session is running — Jump to it");
    expect(client.calls.some((call) => call.method === "agent.resume")).toBe(false);
    expect(place).not.toHaveBeenCalled();
    expect(asked).not.toContain("godview");
    await until(says("Jump to this session"), "the create to become Jump to");
    expect(glyphShown()).toBe("jump");
  });

  it("fieldd's one-run refusal is said in the same words, and the create becomes Jump to", async () => {
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
    await until(() => (create().hasAttribute("aria-disabled") ? null : true), "Resume to wake");
    // a fold that has not seen the run yet: the press goes as far as fieldd
    await act(async () => {
      create().click();
    });
    expect(await until(noteNow, "the line's note")).toBe("This session is running — Jump to it");
    expect(client.calls.filter((call) => call.method === "agent.resume")).toHaveLength(1);
    expect(asked).not.toContain("godview");
    await until(says("Jump to this session"), "the create to become Jump to");
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
    await until(says("Jump to this session"), "the create to say Jump to");
    fold = { sessions: [] };
    await act(async () => {
      create().click();
    });
    expect(await until(noteNow, "the line's note")).toBe("This session has ended — Resume it");
    expect(reveal).not.toHaveBeenCalled();
    expect(asked).not.toContain("godview");
    await until(says("Resume this session"), "the create to become Resume");
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
    await until(says("Jump to this session"), "the create to say Jump to");
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
    // the ask is out and unanswered: the create still says what it said
    for (let tick = 0; tick < 5; tick++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      expect(create().getAttribute("aria-label")).toBe("Jump to this session");
      expect(glyphShown()).toBe("jump");
    }
    await act(async () => {
      release(running(ENDED));
    });
    await until(says("Resume this session"), "the create to say Resume once answered");
  });
});
