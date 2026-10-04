// @vitest-environment happy-dom
/**
 * AR-8c — History in the frame: the shipping composition (`HistoryView` over
 * fieldd's ports, rosetta's room inside) in the cover's History slot, exactly
 * as ChromeLayer hands it to the frame. The rows: ⌘3 shows the room and it
 * stays mounted — out to Godview and back keeps its scroll and asks the
 * catalog nothing new; and the line's create in History is Resume — the
 * session the room has chosen, continued by `agent.resume`'s native form with
 * the launcher's own facts, placed through Godview's door, the window moved
 * there to show it; a refusal said on the line in the launcher's words.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FrameView, FrameViewState } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const PROJECTS = fixture("index-projects.mesh.json") as { rows: unknown[]; sources: unknown[] };
const SESSIONS = fixture("index-sessions.mesh.json") as {
  rows: Array<Record<string, unknown>>;
  sources: unknown[];
};
const SESSION = SESSIONS.rows[0] as Record<string, unknown>;
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
});

/** fieldd, scripted: the index's doors as AR-8b answers them. */
function fieldd(resume: () => unknown) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = {
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
        case "index.status":
          return fixture("index-status.valid.json");
        case "index.project":
          return { ...fixture("index-project.valid.json"), projectId: "p-4f1c2a9e" };
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
  return client;
}

function mount(client: ReturnType<typeof fieldd>): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <FielddProvider client={client as unknown as FielddClient}>
        <ViewFrame
          godview={<div data-testid="godview-content" />}
          history={(active) => <HistoryView active={active} />}
          surface={null}
          onSurfaceChange={() => undefined}
        />
      </FielddProvider>,
    ),
  );
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
  const project = await until(
    () => historySlot()?.querySelector<HTMLButtonElement>("button.ah-project-list-item"),
    "the room's project row",
  );
  act(() => project.click());
  const session = await until(
    () => historySlot()?.querySelector<HTMLButtonElement>("button.ah-session-list-item"),
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
      () => historySlot()?.querySelector("button.ah-project-list-item"),
      "the catalog's rows in the room",
    );
    const scroller = await until(
      () => historySlot()?.querySelector<HTMLElement>(".ah-cols .ah-scroll"),
      "a column's scroller",
    );
    scroller.scrollTop = 120;
    const subscribed = client.calls.filter((call) => call.method === "index.changes.subscribe");
    expect(subscribed).toHaveLength(1);

    to("godview");
    expect(historySlot()?.hasAttribute("inert")).toBe(true);
    to("history");
    expect(historySlot()?.querySelector(".ah-frame")).toBe(frame);
    expect(historySlot()?.querySelector(".ah-cols .ah-scroll")).toBe(scroller);
    expect(scroller.scrollTop).toBe(120);
    expect(client.calls.filter((call) => call.method === "index.changes.subscribe")).toHaveLength(
      1,
    );
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
      throw Object.assign(new Error("terminal still running"), {
        kind: "PRECONDITION_FAILED",
        details: { state: "terminal-alive" },
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
    expect(note).toBe("Could not resume — it is already running");
    expect(asked).not.toContain("godview");
  });
});
