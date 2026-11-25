// @vitest-environment happy-dom

import type { IndexStatus } from "@vibefield/contracts/agent-index";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_HISTORY_CENSUS,
  FIXTURE_HISTORY_KEPT_STATUS,
} from "../src/design-system/account-fixtures";
import { HistoryKeptView, HistorySettingsView } from "../src/panels/HistorySettings";
import { type HistoryKept, historyKeptOf, importingOf } from "../src/panels/history-space";
import type { HistoryCensus } from "../src/setup/use-history-census";

// AO-3 (AO-D9; DESIGN.md §8 "Settings → History") — the home of whose history is
// read: the switches say what History reads now (never all on, as the asking
// panes start), and Look again asks the census afresh. HD-2 — a switch that is
// on stays on: it is drawn off and takes no press, and the page says where the
// way back is (Clear History…).

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function mount(
  props: Partial<Parameters<typeof HistorySettingsView>[0]> & { census?: HistoryCensus } = {},
) {
  const handlers = { onTurnOn: vi.fn(), onLookAgain: vi.fn() };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(HistorySettingsView, {
        census: FIXTURE_HISTORY_CENSUS,
        consented: new Set(["claude-code"]),
        busy: false,
        error: null,
        now: Date.parse("2026-10-27T12:00:00Z"),
        ...handlers,
        ...props,
      }),
    );
  });
  return handlers;
}

const switches = () =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>('[role="switch"]') ?? []).map((s) => [
    s.getAttribute("aria-label"),
    s.getAttribute("aria-checked"),
  ]);

describe("Settings → History (AO-D9)", () => {
  it("says what History reads now, and where it stays", async () => {
    await mount();
    expect(switches()).toEqual([
      ["Bring in Claude Code's history", "true"],
      ["Bring in Codex's history", "false"],
      ["Bring in Grok's history", "false"],
    ]);
    expect(container?.textContent).toContain("VibeField never uploads them");
  });

  it("turns one on at once; one that is on stays on, drawn off, and takes no press (HD-2)", async () => {
    const handlers = await mount();
    const toggles = Array.from(
      container?.querySelectorAll<HTMLButtonElement>('[role="switch"]') ?? [],
    );
    // Claude Code is read: its switch is on and off to the hand; the others are free
    expect(toggles.map((toggle) => toggle.disabled)).toEqual([true, false, false]);
    expect(toggles[0]?.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggles[0]?.click());
    expect(handlers.onTurnOn).not.toHaveBeenCalled();
    await act(async () => toggles[1]?.click());
    expect(handlers.onTurnOn).toHaveBeenCalledTimes(1);
    expect(handlers.onTurnOn).toHaveBeenCalledWith("codex");
    // no question stands anywhere: there is no turning one off
    expect(container?.querySelector('[role="alertdialog"]')).toBeNull();
    expect(container?.textContent).not.toContain("Stop reading");
    expect(container?.querySelector(".vf-history-settings-locked")?.textContent).toBe(
      "An agent History reads stays on. Clear History, below, removes what was read and turns them all off.",
    );
  });

  it("with nothing read yet every switch is free and the line is not said; while a change runs none takes a press", async () => {
    await mount({ consented: new Set() });
    const free = Array.from(
      container?.querySelectorAll<HTMLButtonElement>('[role="switch"]') ?? [],
    );
    expect(free.map((toggle) => [toggle.disabled, toggle.getAttribute("aria-checked")])).toEqual([
      [false, "false"],
      [false, "false"],
      [false, "false"],
    ]);
    expect(container?.querySelector(".vf-history-settings-locked")).toBeNull();

    await act(async () => root?.unmount());
    container?.remove();
    await mount({ busy: true });
    for (const toggle of container?.querySelectorAll<HTMLButtonElement>('[role="switch"]') ?? []) {
      expect(toggle.disabled).toBe(true);
    }
  });

  it("looks again on request, and says each census state in words", async () => {
    const handlers = await mount();
    const look = Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent === "Look again",
    );
    await act(async () => look?.click());
    expect(handlers.onLookAgain).toHaveBeenCalledTimes(1);

    for (const [census, words] of [
      [{ kind: "looking" }, "Looking for past sessions…"],
      [{ kind: "unavailable" }, "History isn't available right now."],
      [{ kind: "found", rows: [], consented: [] }, "No past sessions on this Mac yet."],
    ] as const) {
      await act(async () => root?.unmount());
      container?.remove();
      await mount({ census: census as HistoryCensus });
      expect(container?.textContent).toContain(words);
    }
  });
});

// HD-7 (DESIGN.md §8 "Settings → History", While an agent is brought in) — a second agent turned on here showed
// nothing: its row now says the import where its last use stood, from the status the page already reads.
describe("Settings → History, while an agent is brought in (HD-7)", () => {
  const [first, second] = FIXTURE_HISTORY_CENSUS.rows;
  if (first === undefined || second === undefined) throw new Error("the census fixture lists two");
  const runtime = (kind: string, state: string, bytesStreamed: number) => ({
    runtimeId: `rt_${kind}`,
    kind,
    provenance: "discovered" as const,
    watched: true,
    backfill: {
      state,
      filesTotal: 535,
      bytesTotal: 0,
      filesSkimmed: 535,
      bytesStreamed,
      sessionsTotal: 248,
      records: 0,
    },
  });
  const status = (
    phase: IndexStatus["phase"],
    runtimes: ReturnType<typeof runtime>[],
  ): IndexStatus => ({
    ...FIXTURE_HISTORY_KEPT_STATUS,
    phase,
    runtimes,
  });

  it("says what the agent being read has read, and nothing of one that stands", () => {
    const reading = importingOf(
      status("backfilling", [
        runtime(first.kind, "done", 0),
        runtime(second.kind, "streaming", 188_000_000),
      ]),
    );
    expect([...reading]).toEqual([[second.kind, "Importing · 188 MB read"]]);
    // found and not yet read: no figure to say
    expect(
      importingOf(status("backfilling", [runtime(second.kind, "queued", 0)])).get(second.kind),
    ).toBe("Importing…");
    // a board row outlives its import: once the index is live nothing imports, whatever a row says
    expect(importingOf(status("live", [runtime(second.kind, "queued", 0)])).size).toBe(0);
    expect(importingOf(status("awaiting_consent", [])).size).toBe(0);
    const kept = historyKeptOf(
      status("backfilling", [runtime(second.kind, "streaming", 188_000_000)]),
    );
    expect(kept.kind === "read" && kept.importing.get(second.kind)).toBe("Importing · 188 MB read");
  });

  it("the row says the import where its last use stood, and its facts again once it is in", async () => {
    const facts = (): string[] =>
      Array.from(container?.querySelectorAll(".vf-history-consent-facts") ?? []).map(
        (line) => line.textContent ?? "",
      );
    await mount({
      consented: new Set([first.kind, second.kind]),
      importing: new Map([[second.kind, "Importing · 188 MB read"]]),
    });
    expect(facts()[0]).toContain("last used");
    expect(facts()[1]).toContain("Importing · 188 MB read");
    expect(facts()[1]).not.toContain("last used");
    await act(async () => root?.unmount());
    container?.remove();
    await mount({ consented: new Set([first.kind, second.kind]), importing: new Map() });
    expect(facts()[1]).toContain("last used");
  });
});

// HD-1 (DESIGN.md §8 "Settings → History", On this Mac) — what History keeps on this Mac, drawn as the import
// sign's panel draws it, and Clear History…: asked once, saying what goes and what stays.

const KEPT = historyKeptOf(FIXTURE_HISTORY_KEPT_STATUS);

async function mountKept(props: Partial<Parameters<typeof HistoryKeptView>[0]> = {}) {
  const handlers = { onAsk: vi.fn(), onConfirm: vi.fn(), onCancel: vi.fn() };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(HistoryKeptView, {
        kept: KEPT,
        asking: false,
        clearing: false,
        error: null,
        ...handlers,
        ...props,
      }),
    );
  });
  return handlers;
}

const clearButton = () =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
    (b) => b.textContent === "Clear History…",
  );

describe("Settings → History, On this Mac (HD-1)", () => {
  it("reads rosetta's measure into the four parts, sized as Settings says a size", () => {
    expect(KEPT).toMatchObject({
      kind: "read",
      keptBytes: 5_396_000_000,
      waiting: false,
      profiles: 0,
    });
    if (KEPT.kind !== "read" || KEPT.space === null) throw new Error("no space");
    expect(KEPT.space.kept).toBe("5.4 GB");
    expect(KEPT.space.read).toBeNull();
    expect(KEPT.space.inMemory).toBeNull();
    expect(KEPT.space.memory).toBe("212 MB");
    expect(KEPT.space.parts.map((part) => [part.key, part.size, part.disk, part.memory])).toEqual([
      ["record", "1.2 GB", 1_180_000_000, 0],
      ["archive", "3.7 GB", 3_700_000_000, 0],
      ["search", "420 MB", 420_000_000, 0],
      ["media", "96 MB", 96_000_000, 0],
    ]);
    // while an import still holds the archive in memory, the part says so and the bar hatches it
    const importing = historyKeptOf({
      ...FIXTURE_HISTORY_KEPT_STATUS,
      storage: { ...FIXTURE_HISTORY_KEPT_STATUS.storage, archiveBytes: 0 } as never,
      memory: { footprintBytes: 2_400_000_000, archiveBytes: 2_100_000_000 },
    });
    if (importing.kind !== "read" || importing.space === null) throw new Error("no space");
    expect(importing.space.inMemory).toBe("2.1 GB");
    expect(importing.space.parts[1]).toMatchObject({
      note: "in memory while the import runs",
      disk: 0,
      memory: 2_100_000_000,
    });
  });

  it("says each state the index can be in: down, unmeasured, waiting for consent, with profiles", () => {
    const base = FIXTURE_HISTORY_KEPT_STATUS;
    expect(historyKeptOf({ ...base, rosettad: { ...base.rosettad, phase: "restarting" } })).toEqual(
      { kind: "unavailable" },
    );
    const { storage: _storage, memory: _memory, ...unmeasured } = base;
    expect(historyKeptOf(unmeasured)).toEqual({
      kind: "read",
      space: null,
      keptBytes: null,
      waiting: false,
      profiles: 0,
      importing: new Map(),
    });
    expect(
      historyKeptOf({
        ...base,
        phase: "awaiting_consent",
        enrollment: { ...base.enrollment, runtimes: [{ kind: "claude-code", label: "Work" }] },
      }),
    ).toMatchObject({ kind: "read", waiting: true, profiles: 1 });
  });

  it("draws the sign's own space: the figure, one bar of the four parts, their legend, memory in use", async () => {
    await mountKept();
    const section = container?.querySelector(".vf-history-settings-space");
    expect(section?.querySelector(".vf-history-space-figures")?.textContent).toBe(
      "Kept on disk5.4 GB",
    );
    expect(
      Array.from(section?.querySelectorAll(".vf-history-space-bar > i") ?? []).map((part) =>
        part.getAttribute("data-part"),
      ),
    ).toEqual(["record", "archive", "search", "media"]);
    expect(
      Array.from(section?.querySelectorAll(".vf-history-space-legend > li") ?? []).map(
        (row) => row.textContent,
      ),
    ).toEqual([
      "Record · kept for good1.2 GB",
      "Archive · what you browse · rebuilt from the record3.7 GB",
      "Search · rebuilt from the archive420 MB",
      "Media · images and files agents sent96 MB",
    ]);
    expect(section?.querySelector(".vf-history-space-memory")?.textContent).toBe(
      "Memory in use212 MB",
    );
    expect(container?.textContent).toContain("Your agents' own files are not part of it.");
    expect(container?.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("Clear History… asks once, says what goes and what stays, and runs only on its confirm", async () => {
    const idle = await mountKept();
    await act(async () => clearButton()?.click());
    expect(idle.onAsk).toHaveBeenCalledTimes(1);
    expect(idle.onConfirm).not.toHaveBeenCalled();

    await act(async () => root?.unmount());
    container?.remove();
    const asked = await mountKept({ asking: true });
    const dialog = container?.querySelector('[role="alertdialog"][aria-label="Clear History"]');
    expect(dialog?.textContent).toContain("Clear everything History read on this Mac?");
    expect(dialog?.textContent).toContain("Its copy of your past sessions (5.4 GB) is removed");
    expect(dialog?.textContent).toContain("History asks before it reads again");
    expect(dialog?.textContent).toContain("Your agents' own files stay where they are.");
    expect(dialog?.textContent).not.toContain("agent profiles");
    // the question stands: its trigger is off
    expect(clearButton()?.disabled).toBe(true);
    const [confirm, cancel] = Array.from(dialog?.querySelectorAll("button") ?? []);
    expect(confirm?.textContent).toBe("Clear History");
    expect(confirm?.getAttribute("data-variant")).toBe("danger");
    await act(async () => confirm?.click());
    await act(async () => cancel?.click());
    expect(asked.onConfirm).toHaveBeenCalledTimes(1);
    expect(asked.onCancel).toHaveBeenCalledTimes(1);
  });

  it("while it clears the act says so and cannot be pressed twice; a refusal is said under it", async () => {
    await mountKept({ asking: true, clearing: true, error: "History could not be cleared." });
    const dialog = container?.querySelector('[role="alertdialog"]');
    const [confirm, cancel] = Array.from(dialog?.querySelectorAll("button") ?? []);
    expect(confirm?.textContent).toBe("Clearing…");
    expect(confirm?.disabled).toBe(true);
    expect(confirm?.hasAttribute("data-running")).toBe(true);
    expect(cancel?.disabled).toBe(true);
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "History could not be cleared.",
    );
  });

  it("a profile's own folder is read again, and the question says so", async () => {
    await mountKept({
      asking: true,
      kept: { ...(KEPT as Extract<HistoryKept, { kind: "read" }>), profiles: 2 },
    });
    expect(container?.querySelector('[role="alertdialog"]')?.textContent).toContain(
      "Sessions from your agent profiles are read again right away.",
    );
  });

  it("says the states with nothing to draw, and offers no clear where there is nothing to clear", async () => {
    for (const [kept, words, off] of [
      [{ kind: "looking" }, "Measuring…", true],
      [{ kind: "unavailable" }, "History isn't available right now.", true],
      [
        {
          kind: "read",
          space: null,
          keptBytes: null,
          waiting: false,
          profiles: 0,
          importing: new Map(),
        },
        "History hasn't measured its space yet.",
        false,
      ],
      [
        {
          ...(KEPT as Extract<HistoryKept, { kind: "read" }>),
          keptBytes: 0,
          waiting: true,
        },
        "History keeps nothing on this Mac.",
        true,
      ],
    ] as const) {
      await mountKept({ kept: kept as HistoryKept });
      expect(container?.textContent).toContain(words);
      expect(container?.querySelector(".vf-history-space-bar")).toBeNull();
      expect(clearButton()?.disabled).toBe(off);
      await act(async () => root?.unmount());
      container?.remove();
    }
  });
});
