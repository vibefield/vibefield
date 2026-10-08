// @vitest-environment happy-dom
/**
 * History's room is its own chunk (AR-8c's follow-up, 2026-10-04; DESIGN.md §8
 * "History" — "Its first open says 'Opening History'"). The shipping path,
 * exactly as ChromeLayer hands it to the frame — `HistoryView` mounting the
 * room through `room-chunk.tsx`'s one dynamic import — with that import held
 * at a gate: nothing asks for the room before History opens; the first ⌘3
 * asks, and while the chunk is on its way the view is the cover's glass with
 * the room's edges saying "Opening History", the line's door already lent;
 * once it lands the room takes the face's place, and from then on it stays.
 * The room's search (the search interim, 2026-10-04) rides the same boundary:
 * no launcher and no key before the room is here, the sheet once it is.
 * (The loader, the boundary and the prefetch: `history-chunk-loader.test.tsx`.)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FrameView, FrameViewState } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FrameSurface } from "../src/frame/frame-surface";
import { resetGodviewLineDoorForTest, resetHistoryLineDoorForTest } from "../src/frame/line-door";
import { ViewFrame } from "../src/frame/ViewFrame";
import { resetActiveViewForTest } from "../src/frame/view-state";
import { HistoryView } from "../src/history/HistoryView";
import { type FieldHost, setHost } from "../src/host";
import { type RendererLogger, setRendererLogger } from "../src/logging";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The room's module, held: every import of it waits at the gate until the
 * row opens it. A static import anywhere on the path would ask at load time,
 * before any row ran — the safety ceiling turns that into a red row rather
 * than a hung file. */
const room = vi.hoisted(() => {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { gate, open: () => open(), asked: 0 };
});

vi.mock("../src/history/HistoryRoomView", async (importOriginal) => {
  room.asked += 1;
  await Promise.race([room.gate, new Promise((resolve) => setTimeout(resolve, 20_000))]);
  return importOriginal();
});

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

let publish: ((state: FrameViewState) => void) | null = null;
let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  resetActiveViewForTest();
  resetGodviewLineDoorForTest();
  resetHistoryLineDoorForTest();
  publish = null;
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
      set: (next) => Promise.resolve({ view: next }),
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
function fieldd() {
  const projects = fixture("index-projects.mesh.json") as { rows: unknown[]; sources: unknown[] };
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    async request(method: string) {
      switch (method) {
        case "index.projects":
          return { rows: [projects.rows[0]], sources: projects.sources };
        case "index.sessions":
          return fixture("index-sessions.mesh.json");
        case "index.threads":
          return { rows: [] };
        case "index.status":
          return fixture("index-status.valid.json");
        case "index.project":
          return { ...fixture("index-project.valid.json"), projectId: "p-4f1c2a9e" };
        default:
          throw Object.assign(new Error(`${method} is not scripted`), { kind: "NOT_FOUND" });
      }
    },
    async subscribe() {
      return {
        subId: "sub-1",
        snapshot: { snapshot: { epoch: "changes-local-1", revision: 0, rows: [] } },
        unsubscribe: () => undefined,
      };
    },
  };
}

let surfaceNow: FrameSurface | null = null;

function mount(): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const client = fieldd();
  // FieldView's place: the frame's one owner of the open surface, which holds
  // History's search sheet too while the interim stands.
  function Owner(): ReactElement {
    const [surface, setSurface] = useState<FrameSurface | null>(null);
    surfaceNow = surface;
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
      </FielddProvider>
    );
  }
  act(() => root?.render(<Owner />));
}

/** ⌘G as a person presses it, aimed at whatever holds the keyboard; answers
 * whether anything claimed it. */
function commandG(): boolean {
  const event = new KeyboardEvent("keydown", {
    key: "g",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event.defaultPrevented;
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

describe("History's room, its own chunk (2026-10-04)", () => {
  it("the first ⌘3 asks for the chunk and says Opening History on the cover's glass until the room takes its place", async () => {
    mount();
    // Nothing has asked for the room: History has not opened, and a DOM with
    // no idle moment to observe gets no prefetch.
    expect(room.asked).toBe(0);
    to("history");
    await until(() => (room.asked === 1 ? true : null), "the first ⌘3 asking for the room");

    // The opening face, on the cover's glass with the room's edges.
    const face = await until(
      () => historySlot()?.querySelector<HTMLElement>('.vf-history[data-face="opening"]'),
      "the opening face",
    );
    expect(face.style.getPropertyValue("--vf-history-reserve")).toBe("88px");
    expect(face.style.getPropertyValue("--vf-history-head")).toBe("52px");
    expect(face.style.getPropertyValue("--vf-history-edge")).toBe("8px");
    const words = face.querySelector<HTMLElement>(".vf-history-room > .vf-history-face[data-late]");
    expect(words?.getAttribute("role")).toBe("status");
    expect(words?.querySelector(".vf-ui-empty-state__title")?.textContent).toBe("Opening History");
    expect(words?.querySelector(".vf-ui-empty-state__description")?.textContent).toBe(
      "rosetta's room is loading.",
    );
    expect(historySlot()?.querySelector(".ah-frame")).toBeNull();
    // The controller is here before the room: the line already holds History's
    // create, waiting for a choice.
    const create = host?.querySelector<HTMLButtonElement>(".vf-line-create");
    expect(create?.getAttribute("aria-disabled")).toBe("true");
    expect(create?.title).toContain("choose a session first");
    // The search interim rides the room's chunk: until it lands there is no
    // launcher to press, and ⌘G finds no room to walk, so it is left alone.
    expect(historySlot()?.querySelector(".ah-launcher")).toBeNull();
    expect(commandG()).toBe(false);

    // The chunk lands: the room takes the face's place, on the same glass.
    room.open();
    const frame = await until(
      () => historySlot()?.querySelector<HTMLElement>(".vf-history .ah-frame"),
      "the room in the face's place",
      30_000,
    );
    expect(frame.getAttribute("data-ah-surface")).toBe("host");
    expect(historySlot()?.querySelector("[data-face]")).toBeNull();
    expect(historySlot()?.textContent).not.toContain("Opening History");

    // …and with it the room's search: the strip's pill opens the sheet in the
    // room's layer, on the frame's one value, and Esc closes it.
    const launcher = await until(
      () => historySlot()?.querySelector<HTMLButtonElement>(".ah-launcher__open"),
      "the room's search launcher",
    );
    act(() => launcher.click());
    const sheet = await until(
      () => historySlot()?.querySelector<HTMLElement>('.vf-history-layers [role="dialog"]'),
      "the room's search sheet",
    );
    expect(surfaceNow).toBe("history-search");
    act(() => {
      (sheet.querySelector("input") ?? sheet).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    await until(
      () => (historySlot()?.querySelector('[role="dialog"]') ? null : true),
      "the sheet closed by Esc",
    );
    expect(surfaceNow).toBeNull();

    // And it stays: out and back says nothing again and asks for nothing.
    to("godview");
    to("history");
    expect(historySlot()?.querySelector("[data-face]")).toBeNull();
    expect(historySlot()?.querySelector(".ah-frame")).toBe(frame);
    expect(room.asked).toBe(1);
  }, 60_000);
});
