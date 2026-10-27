// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_HISTORY_CENSUS } from "../src/design-system/account-fixtures";
import { HistorySettingsView } from "../src/panels/HistorySettings";
import type { HistoryCensus } from "../src/setup/use-history-census";

// AO-3 (AO-D9; DESIGN.md §8 "Settings → History") — the home of whose history is
// read: the switches say what History reads now (never all on, as the asking
// panes start), turning one off is asked once and keeps what was read, and
// Look again asks the census afresh.

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
  const handlers = {
    onToggle: vi.fn(),
    onConfirmStop: vi.fn(),
    onCancelStop: vi.fn(),
    onLookAgain: vi.fn(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(HistorySettingsView, {
        census: FIXTURE_HISTORY_CENSUS,
        consented: new Set(["claude-code"]),
        stopping: null,
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

  it("turns one on at once, and asks once before it stops reading one", async () => {
    const handlers = await mount();
    const toggles = container?.querySelectorAll<HTMLButtonElement>('[role="switch"]');
    await act(async () => toggles?.[1]?.click());
    expect(handlers.onToggle).toHaveBeenCalledWith("codex", true);

    await act(async () => root?.unmount());
    container?.remove();
    const stopping = FIXTURE_HISTORY_CENSUS.rows[0] ?? null;
    const asked = await mount({ stopping });
    const dialog = container?.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Stop reading Claude Code's history?");
    expect(dialog?.textContent).toContain("What was read stays in History");
    // nothing else changes while it asks
    for (const toggle of container?.querySelectorAll<HTMLButtonElement>('[role="switch"]') ?? []) {
      expect(toggle.disabled).toBe(true);
    }
    const [stop, cancel] = Array.from(dialog?.querySelectorAll("button") ?? []);
    expect(stop?.textContent).toBe("Stop reading");
    await act(async () => stop?.click());
    await act(async () => cancel?.click());
    expect(asked.onConfirmStop).toHaveBeenCalledTimes(1);
    expect(asked.onCancelStop).toHaveBeenCalledTimes(1);
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
