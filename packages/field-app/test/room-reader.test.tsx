// @vitest-environment happy-dom
/**
 * PK3 (docket v9, ruled (a) 2026-10-09: "rosetta's own reader") — the room
 * exports a READ-ONLY transcript reader, `TranscriptReader`, over the same
 * ports as `HistoryRoom` (rosetta `vf/room-host-slots`). Its address is
 * `{sessionId, timelineId?, query?}`: it lands at the matched line and keeps it
 * marked, and marks the query's words in the prose. It draws no head band and
 * no acts (no session-work launchers, no day menu, no "Latest" pill, no
 * dialog), binds no keys, and writes nothing back to any room. The mark's look
 * is a host input — `--ah-match`, `--ah-match-weight`, `--ah-match-line` —
 * whose defaults are the room's own neutral match, never the select hue (K1).
 * Mounted here over the room's demo ports, as the Peek's past pane will
 * mount it (lane pj4, W2).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { MetaSubscriptionHandlers } from "@vibefield/rosetta-protocol";
import { type ReaderAddress, TranscriptReader } from "@vibefield/rosetta-room";
import { createDemoPorts, createRoomDemo } from "@vibefield/rosetta-room/fixtures";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeAll(async () => {
  await import("@vibefield/rosetta-room");
}, 60_000);

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

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

async function pause(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function mount(element: ReactElement): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(element));
  return host;
}

describe("the room's reader (PK3)", () => {
  it("lands on the matched line and keeps it marked, its words marked, with no head band and no acts", async () => {
    const ports = createDemoPorts(createRoomDemo());
    const at: ReaderAddress = { sessionId: "s0", timelineId: "s0-t9", query: "plus" };
    const el = mount(<TranscriptReader {...ports} storage={null} at={at} />);

    const landed = await until(
      () => el.querySelector('.tr-prompt-message.is-landed[data-timeline-id="s0-t9"]'),
      "the prompt at s0-t9 is landed",
    );
    expect(landed.textContent).toContain("Show me the line with one plus.");
    // the root is the reader's, inside the room's own frame class
    expect(el.querySelector(".ah-frame.ah-reader")).not.toBeNull();
    // the words: every "plus" in the prose is marked, nothing else is
    const marks = [...el.querySelectorAll("mark.tr-match")].map((mark) =>
      mark.textContent?.toLowerCase(),
    );
    expect(marks.length).toBeGreaterThanOrEqual(3);
    expect(new Set(marks)).toEqual(new Set(["plus"]));
    // no head band, no acts, no dialogs
    expect(el.querySelector(".ah-col > header")).toBeNull();
    expect(el.querySelector(".tr-meta")).toBeNull();
    expect(el.querySelector(".ah-newpill")).toBeNull();
    expect(el.querySelector(".ah-tail-announcement")).toBeNull();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(el.querySelector('.tr-day__pill[aria-haspopup="menu"]')).toBeNull();
    // the landing stays: the room's ring clears after 1.5 s, the reader's does not
    await pause(1_800);
    expect(
      el.querySelector('.tr-prompt-message.is-landed[data-timeline-id="s0-t9"]'),
    ).not.toBeNull();
  });

  it("a phrase in quotes is marked as one", async () => {
    const ports = createDemoPorts(createRoomDemo());
    const el = mount(
      <TranscriptReader
        {...ports}
        storage={null}
        at={{ sessionId: "s0", query: '"two plus buttons"' }}
      />,
    );
    const mark = await until(() => el.querySelector("mark.tr-match"), "a marked phrase");
    expect(mark.textContent?.toLowerCase()).toBe("two plus buttons");
  });

  it("re-lands by value: the same line in a new object does not move it; a new line lands", async () => {
    const ports = createDemoPorts(createRoomDemo());
    const el = mount(
      <TranscriptReader {...ports} storage={null} at={{ sessionId: "s0", timelineId: "s0-t9" }} />,
    );
    await until(() => el.querySelector('.is-landed[data-timeline-id="s0-t9"]'), "s0-t9 landed");
    act(() =>
      root?.render(
        <TranscriptReader
          {...ports}
          storage={null}
          at={{ sessionId: "s0", timelineId: "s0-t9" }}
        />,
      ),
    );
    await pause(100);
    expect(el.querySelector('.is-landed[data-timeline-id="s0-t9"]')).not.toBeNull();
    act(() =>
      root?.render(
        <TranscriptReader
          {...ports}
          storage={null}
          at={{ sessionId: "s0", timelineId: "s0-t1" }}
        />,
      ),
    );
    await until(() => el.querySelector('.is-landed[data-timeline-id="s0-t1"]'), "s0-t1 landed");
    expect(el.querySelector('.is-landed[data-timeline-id="s0-t9"]')).toBeNull();
  });

  it("reads through the room's ports and asks nothing else: no search, no boost, one open and one close", async () => {
    const ports = createDemoPorts(createRoomDemo());
    const search = vi.spyOn(ports.catalog, "search");
    const status = vi.spyOn(ports.catalog, "status");
    const stats = vi.spyOn(ports.catalog, "projectStats");
    const opened: string[] = [];
    const closed: string[] = [];
    const sessions = {
      open: (id: string) => {
        opened.push(id);
        return ports.sessions.open(id);
      },
      close: (id: string) => {
        closed.push(id);
      },
    };
    const listeners = vi.spyOn(document, "addEventListener");
    const windowListeners = vi.spyOn(window, "addEventListener");
    const el = mount(
      <TranscriptReader
        {...ports}
        sessions={sessions}
        storage={null}
        at={{ sessionId: "s8", query: "package" }}
      />,
    );
    await until(() => el.querySelector("mark.tr-match"), "s8's prose");
    expect(opened).toEqual(["s8"]);
    expect(search).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(stats).not.toHaveBeenCalled();
    // no key bound on the host's behalf
    const keyed = [...listeners.mock.calls, ...windowListeners.mock.calls].filter(([type]) =>
      String(type).startsWith("key"),
    );
    expect(keyed).toEqual([]);
    act(() => root?.unmount());
    root = null;
    expect(closed).toEqual(["s8"]);
  });

  it("says so when the index does not have the session, and when it cannot answer", async () => {
    const ports = createDemoPorts(createRoomDemo());
    const el = mount(<TranscriptReader {...ports} storage={null} at={{ sessionId: "nope" }} />);
    await until(
      () => el.textContent?.includes("That session is not in this index"),
      "not in this index",
    );

    act(() => root?.unmount());
    host?.remove();
    const closedCatalog = {
      ...ports.catalog,
      subscribeMeta(handlers: MetaSubscriptionHandlers) {
        queueMicrotask(() => handlers.onStatus?.("closed"));
        return { close: () => undefined };
      },
      unavailable: () => "Fieldd is not answering.",
    };
    const again = mount(
      <TranscriptReader
        {...ports}
        catalog={closedCatalog}
        storage={null}
        at={{ sessionId: "s0" }}
      />,
    );
    await until(() => again.textContent?.includes("The index is not answering"), "not answering");
    expect(again.textContent).toContain("Fieldd is not answering.");
  });

  it("the mark's look is the host's: three tokens whose defaults are neutral, never the select hue (K1)", () => {
    const css = readFileSync(
      createRequire(import.meta.url)
        .resolve("@vibefield/rosetta-room/styles/room.css")
        .replace(/history-room\.css$/, "reader.css"),
      "utf8",
    );
    expect(css).toContain("var(--ah-match, var(--vf-fill-hover))");
    expect(css).toContain("var(--ah-match-weight, 500)");
    expect(css).toContain("var(--ah-match-line, var(--vf-text-tertiary))");
    expect(css).not.toContain("--vf-select");
    expect(css).not.toContain("--vf-orange");
  });
});
