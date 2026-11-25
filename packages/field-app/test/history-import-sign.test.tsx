// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ImportSign } from "@vibefield/rosetta-room";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryImportSignPlate } from "../src/design-system/HistoryImportSignPreview";
import {
  HistoryImportSign,
  HistoryImportSignView,
  quarterFill,
  rimArc,
  SIGN_CLOSE_GRACE_MS,
  SIGN_OPEN_INTENT_MS,
} from "../src/frame/HistoryImportSign";
import { publishImportSign, readImportSign } from "../src/frame/import-sign-door";

// History's import sign (track IM, IM-1; DESIGN.md §8 "History", the import's sign; §6 the arc). The room hands the
// import out (R11, rosetta-room 0.1.9) and the frame draws it: the History circle one head gap left of search, the
// `history` glyph under the arc while the import works, a rim of four quarters (one per step, never summed), a dot
// for what needs you, and at rest after the import. Its panel opens on the pointer's intent, a press holds it, and
// Escape or a press outside closes it. The sign here is the room's own shape, written out.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, "../src/frame/history-import-sign.css"), "utf8");

const steps = (current: number, fraction: number | null): ImportSign["steps"] =>
  ["Projects and sessions", "Open any conversation", "Charts and figures", "Search everything"].map(
    (opens, index) => {
      const n = index + 1;
      const state = n < current ? "done" : n === current ? "current" : "later";
      return {
        state,
        opens,
        figure: state === "done" ? "done" : state === "later" ? "later" : "412 of 1,139",
        fraction: state === "done" ? 1 : state === "later" ? 0 : fraction,
        lines: state === "current" ? ["1.00 GB of 4.00 GB read (25%)"] : [],
      } as const;
    },
  );

const READING: ImportSign = {
  tone: "working",
  step: 2,
  fraction: 0.25,
  eyebrow: "Importing history · step 2 of 4",
  title: "Importing your newest conversations first",
  count: "412 of 1,139 conversations readable",
  detail: "Older history fills in while you browse.",
  horizon: null,
  attention: null,
  label: "Importing history · step 2 of 4: Importing your newest conversations first",
  steps: steps(2, 0.25),
  agents: [
    {
      runtimeId: "rt-1",
      kind: "claude-code",
      name: "Claude Code",
      state: "streaming",
      caption: "1.00 GB processed",
      figure: "1.00 GB of 4.00 GB",
      fraction: 0.25,
      lastNew: null,
    },
    {
      runtimeId: "rt-2",
      kind: "codex",
      name: "Codex",
      state: "done",
      caption: "Ready to browse",
      figure: "1,604 sessions",
      fraction: 1,
      lastNew: null,
    },
  ],
  space: {
    read: "1.05 GB of 5.10 GB",
    kept: "340.0 MB",
    inMemory: "2.10 GB",
    parts: [
      {
        key: "record",
        name: "Record",
        note: "3.3× smaller than read · kept for good",
        size: "300.0 MB",
        disk: 300_000_000,
        memory: 0,
      },
      {
        key: "archive",
        name: "Archive",
        note: "in memory now · written to disk at step 3",
        size: "2.10 GB",
        disk: 0,
        memory: 2_100_000_000,
      },
      { key: "search", name: "Search", note: "built at step 4", size: "—", disk: 0, memory: 0 },
      {
        key: "media",
        name: "Media",
        note: "images and files agents sent",
        size: "40.0 MB",
        disk: 40_000_000,
        memory: 0,
      },
    ],
    memory: "2.40 GB",
    measuredAt: 1,
  },
  footer: "12.0 MB/s",
  elapsed: "2m 10s elapsed",
};

const REST: ImportSign = {
  ...READING,
  tone: "rest",
  step: 4,
  fraction: 1,
  eyebrow: "History · up to date",
  title: "Up to date",
  count: null,
  label: "History · up to date: Up to date",
  steps: steps(5, null),
  footer: "Last new activity 3m ago",
  elapsed: null,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => publishImportSign(null));
  vi.useRealTimers();
});

const render = (element: Parameters<Root["render"]>[0]): void => act(() => root.render(element));
const button = (): HTMLButtonElement => {
  const found = host.querySelector<HTMLButtonElement>(".vf-history-sign-button");
  if (found === null) throw new Error("no circle");
  return found;
};
const panel = (): HTMLElement | null => host.querySelector(".vf-history-sign-panel");

describe("IM-1 — the History circle", () => {
  it("stands only under History, and only once the room has handed it a sign", () => {
    render(createElement(HistoryImportSign, { shown: true }));
    expect(host.querySelector(".vf-history-sign")).toBeNull();
    act(() => publishImportSign(READING));
    expect(readImportSign()).toBe(READING);
    expect(button().getAttribute("aria-label")).toBe(READING.label);
    render(createElement(HistoryImportSign, { shown: false }));
    expect(host.querySelector(".vf-history-sign")).toBeNull();
  });

  it("while the import reads: the glyph under the turning arc, and the rim's quarters filled to each step's own", () => {
    render(createElement(HistoryImportSignView, { sign: READING }));
    const glyph = host.querySelector(".vf-history-sign-glyph");
    expect(glyph?.hasAttribute("data-importing")).toBe(true);
    expect(glyph?.hasAttribute("data-turning")).toBe(true);
    expect(host.querySelector(".vf-history-sign-arc")).not.toBeNull();
    const quarters = [...host.querySelectorAll(".vf-history-sign-rim > g")];
    expect(quarters.map((quarter) => quarter.getAttribute("data-step"))).toEqual([
      "done",
      "current",
      "later",
      "later",
    ]);
    expect(host.querySelectorAll(".vf-history-sign-track")).toHaveLength(4);
    // the done quarter whole, the current one to its fraction, the rest empty: never one summed figure
    const fills = quarters.map((quarter) => quarter.querySelector(".vf-history-sign-fill"));
    expect(fills[0]?.getAttribute("d")).toBe(rimArc(7, 83));
    expect(fills[1]?.getAttribute("d")).toBe(rimArc(97, 97 + 76 * 0.25));
    expect(fills[2]).toBeNull();
    expect(host.querySelector(".vf-history-sign-dot")).toBeNull();
  });

  it("the mark moves only while its work does (HG-L1): paused, the arc rests; attention wears a dot", () => {
    render(createElement(HistoryImportSignView, { sign: { ...READING, tone: "paused" } }));
    const glyph = host.querySelector(".vf-history-sign-glyph");
    expect(glyph?.hasAttribute("data-importing")).toBe(true);
    expect(glyph?.hasAttribute("data-turning")).toBe(false);
    render(
      createElement(HistoryImportSignView, {
        sign: { ...READING, tone: "attention", attention: "search" },
      }),
    );
    expect(host.querySelector(".vf-history-sign-dot")?.getAttribute("data-attention")).toBe(
      "search",
    );
  });

  it("after the import it stays at rest (IM-D2): the glyph alone, no rim, no arc", () => {
    render(createElement(HistoryImportSignView, { sign: REST }));
    expect(host.querySelector(".vf-history-sign-rim")).toBeNull();
    expect(host.querySelector(".vf-history-sign-arc")).toBeNull();
    expect(host.querySelector(".vf-history-sign-glyph")?.hasAttribute("data-importing")).toBe(
      false,
    );
    expect(button().getAttribute("aria-label")).toBe("History · up to date: Up to date");
  });

  it("a quarter fills to its step, whole once done and empty before", () => {
    const [done, current, later] = steps(2, 0.4);
    expect(quarterFill(done!)).toBe(1);
    expect(quarterFill(current!)).toBe(0.4);
    expect(quarterFill(later!)).toBe(0);
    expect(quarterFill({ ...current!, fraction: null })).toBe(0);
  });

  it("stands one head gap left of the search button, on its glass, above the cover", () => {
    const rule = CSS.slice(
      CSS.indexOf("\n.vf-history-sign {"),
      CSS.indexOf("}", CSS.indexOf("\n.vf-history-sign {")),
    );
    expect(rule).toContain("right: calc(16px + var(--vf-peek-find-width, 40px) + 12px);");
    expect(rule).toContain("top: 8px;");
    expect(rule).toContain("z-index: 62;");
    expect(rule).toContain(
      "background: color-mix(in srgb, var(--vf-chrome-solid) 88%, transparent);",
    );
    expect(CSS).toContain("animation: vf-history-sign-arc 1.1s var(--vf-ease-island) infinite;");
    // M6: the arc stands still under reduced motion
    expect(CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"))).toContain(
      "animation: none;",
    );
  });
});

describe("IM-1 — its panel", () => {
  it("opens on the pointer resting 120ms and closes 220ms after it leaves", () => {
    vi.useFakeTimers();
    render(createElement(HistoryImportSignView, { sign: READING }));
    const circle = host.querySelector(".vf-history-sign");
    act(() => {
      circle?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      circle?.dispatchEvent(new PointerEvent("pointerenter"));
    });
    act(() => vi.advanceTimersByTime(SIGN_OPEN_INTENT_MS - 1));
    expect(panel()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(panel()).not.toBeNull();
    expect(button().getAttribute("aria-expanded")).toBe("true");
    act(() => {
      circle?.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
      circle?.dispatchEvent(new PointerEvent("pointerleave"));
    });
    act(() => vi.advanceTimersByTime(SIGN_CLOSE_GRACE_MS - 1));
    expect(panel()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(panel()).toBeNull();
  });

  it("a press holds it open past the pointer, and Escape closes it", () => {
    vi.useFakeTimers();
    render(createElement(HistoryImportSignView, { sign: READING }));
    act(() => button().click());
    expect(panel()).not.toBeNull();
    const circle = host.querySelector(".vf-history-sign");
    act(() => {
      circle?.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
      circle?.dispatchEvent(new PointerEvent("pointerleave"));
    });
    act(() => vi.advanceTimersByTime(SIGN_CLOSE_GRACE_MS * 2));
    expect(panel()).not.toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(panel()).toBeNull();
  });

  it("says what each step opens, each agent, and what is read and kept on this Mac", () => {
    render(createElement(HistoryImportSignView, { sign: READING, initiallyOpen: true }));
    const shown = panel();
    expect(shown?.querySelector(".vf-history-sign-eye")?.textContent).toBe(READING.eyebrow);
    expect(shown?.querySelector(".vf-history-sign-title")?.textContent).toBe(READING.title);
    expect(shown?.querySelector(".vf-history-sign-count")?.textContent).toBe(READING.count);
    const stepRows = [...(shown?.querySelectorAll(".vf-history-sign-step") ?? [])];
    expect(stepRows.map((row) => row.getAttribute("data-state"))).toEqual([
      "done",
      "current",
      "later",
      "later",
    ]);
    expect(stepRows[1]?.textContent).toContain("Open any conversation");
    expect(stepRows[1]?.textContent).toContain("1.00 GB of 4.00 GB read (25%)");
    // the current step's fraction is a colourless hairline (HG-W3)
    expect(stepRows[1]?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe(
      "25",
    );
    // the agent still reading on its own row, the one done on the Ready to browse line
    expect(shown?.querySelector(".vf-history-sign-agent")?.textContent).toContain("Claude Code");
    expect(shown?.querySelector(".vf-history-sign-done")?.textContent).toContain("Codex");
    const space = shown?.querySelector('[aria-label="On this Mac"]');
    expect(space?.textContent).toContain("Read from your agents");
    expect(space?.textContent).toContain("1.05 GB of 5.10 GB");
    expect(space?.textContent).toContain("+ 2.10 GB in memory");
    expect(space?.textContent).toContain("Memory in use");
    // the archive still in memory is hatched, on the one scale of the four parts
    const memory = space?.querySelector(".vf-history-space-bar > i[data-memory]");
    expect(memory?.getAttribute("data-part")).toBe("archive");
    expect(shown?.querySelector(".vf-history-sign-foot")?.textContent).toContain("12.0 MB/s");
  });
});

describe("HD-1 — the panel's one act: History Settings…", () => {
  const row = (): HTMLButtonElement | null =>
    panel()?.querySelector<HTMLButtonElement>(".vf-history-sign-acts > .vf-menu-row") ?? null;

  it("a menu row at the panel's end opens Settings → History, and the panel goes first", () => {
    const onOpenSettings = vi.fn();
    render(
      createElement(HistoryImportSignView, { sign: REST, initiallyOpen: true, onOpenSettings }),
    );
    expect(row()?.textContent).toBe("History Settings…");
    // it stands after what is kept and before the foot
    const order = [...(panel()?.children ?? [])].map((child) => child.className);
    expect(order.slice(-2)).toEqual(["vf-history-sign-acts", "vf-history-sign-foot"]);
    act(() => row()?.click());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(panel()).toBeNull();
    expect(button().getAttribute("aria-expanded")).toBe("false");
  });

  it("stands while the import runs too, and a panel handed no door draws no act", () => {
    render(
      createElement(HistoryImportSignView, {
        sign: READING,
        initiallyOpen: true,
        onOpenSettings: () => undefined,
      }),
    );
    expect(row()).not.toBeNull();
    render(
      createElement(HistoryImportSignView, { key: "none", sign: READING, initiallyOpen: true }),
    );
    expect(panel()).not.toBeNull();
    expect(row()).toBeNull();
  });

  it("the frame's circle passes its door through", () => {
    const onOpenSettings = vi.fn();
    render(createElement(HistoryImportSign, { shown: true, onOpenSettings }));
    act(() => publishImportSign(REST));
    act(() => button().click());
    act(() => row()?.click());
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

/** Let the room's status ask and its effects land, a turn at a time, until `ready` holds (or the tries run out). */
async function settle(ready: () => boolean, tries = 80): Promise<void> {
  for (let turn = 0; turn < tries && !ready(); turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

describe("IM-1 — the catalog's plates: the room's own reading over the package's simulated cold import", () => {
  it("while it reads: the room hands out step 2, the archive still in memory, and the circle draws it", async () => {
    render(createElement(HistoryImportSignPlate, { moment: "reading" }));
    await settle(() => panel() !== null);
    expect(button().getAttribute("aria-label")).toMatch(/^Importing history · step 2 of 4: /u);
    expect(host.querySelector(".vf-history-sign-glyph")?.hasAttribute("data-turning")).toBe(true);
    const space = panel()?.querySelector('[aria-label="On this Mac"]');
    expect(space?.textContent).toContain("Read from your agents");
    expect(space?.textContent).toContain("in memory");
    expect(
      space?.querySelector(".vf-history-space-bar > i[data-memory]")?.getAttribute("data-part"),
    ).toBe("archive");
    // the room's own import card retires under the sign (IM-D3); the frame says the import alone
    expect(host.querySelector(".ah-ingest-status")).toBeNull();
  });

  it("building search: step 4, the archive written to disk", async () => {
    render(createElement(HistoryImportSignPlate, { moment: "search" }));
    await settle(() => panel() !== null);
    expect(button().getAttribute("aria-label")).toMatch(/^Importing history · step 4 of 4: /u);
    expect(panel()?.querySelector(".vf-history-space-bar > i[data-memory]")).toBeNull();
  });

  it("after the import the circle stays, at rest (IM-D2)", async () => {
    render(createElement(HistoryImportSignPlate, { moment: "rest" }));
    await settle(() => panel() !== null);
    expect(button().getAttribute("aria-label")).toBe("History · up to date: Up to date");
    expect(host.querySelector(".vf-history-sign-rim")).toBeNull();
  });
});
