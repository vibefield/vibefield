// @vitest-environment happy-dom

import type { BrowserDataClearResult } from "@vibefield/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FieldBrowserDataHost, type FieldHost, setHost } from "../src/host";
import { BrowserDataSection, clearedWords } from "../src/panels/BrowserDataSection";

// BP-D4 (thinking-browser-profile.md §3·3, 2026-10-26) — Settings › General's "Clear browsing data" on its real controller
// over a fake host: DESIGN.md's two-step destructive confirm (only the second, red click asks main), main's counts said
// as they came back, a failure said with what to do, and no door at all said too.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noopLogger: FieldHost["logger"] = {
  child: () => noopLogger,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  isLevelEnabled: () => false,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function host(browserData: FieldBrowserDataHost | null): void {
  setHost({
    logger: noopLogger,
    getConnection: async () => ({ port: 1, token: "test" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    ...(browserData === null ? {} : { browserData }),
  });
}

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(BrowserDataSection));
  });
  return container;
}

const button = (el: HTMLElement, words: string): HTMLButtonElement => {
  const found = [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === words);
  if (found === undefined) throw new Error(`no button "${words}" in: ${el.textContent}`);
  return found;
};

const click = async (target: HTMLElement): Promise<void> => {
  await act(async () => {
    target.click();
  });
};

describe("Settings › General › Browsing data (BP-D4)", () => {
  it("asks once, and only the second, red click clears — then says main's counts", async () => {
    const clear = vi.fn(async (): Promise<BrowserDataClearResult> => ({ profiles: 1, pages: 2 }));
    host({ clear });
    const el = await mount();
    await click(button(el, "Clear browsing data…"));
    expect(clear).not.toHaveBeenCalled();
    const red = button(el, "Clear and sign out");
    expect(red.dataset["variant"]).toBe("danger");
    await click(red);
    expect(clear).toHaveBeenCalledOnce();
    expect(el.querySelector('[role="status"]')?.textContent).toBe(
      "Cleared: every site on your desk is signed out · 2 open pages reloaded.",
    );
    // the card is back to its one act
    expect(button(el, "Clear browsing data…").disabled).toBe(false);
  });

  it("Cancel clears nothing", async () => {
    const clear = vi.fn(async (): Promise<BrowserDataClearResult> => ({ profiles: 1, pages: 0 }));
    host({ clear });
    const el = await mount();
    await click(button(el, "Clear browsing data…"));
    await click(button(el, "Cancel"));
    expect(clear).not.toHaveBeenCalled();
    expect(button(el, "Clear browsing data…")).toBeDefined();
  });

  it("a refusal from main is said with what to do next", async () => {
    host({
      clear: async () => {
        throw new Error("browser data clear refused: unregistered sender");
      },
    });
    const el = await mount();
    await click(button(el, "Clear browsing data…"));
    await click(button(el, "Clear and sign out"));
    expect(el.querySelector('[role="alert"]')?.textContent).toBe(
      "Browsing data was not cleared: browser data clear refused: unregistered sender. Try again; the desktop's log says why it failed (Settings › Diagnostics).",
    );
  });

  it("with no desktop shell to ask, the act is disabled and says why", async () => {
    host(null);
    const el = await mount();
    expect(button(el, "Clear browsing data…").disabled).toBe(true);
    expect(el.textContent).toContain("Unavailable here: no desktop shell answers this window.");
  });

  it("says main's counts and never more than they say", () => {
    expect(clearedWords({ profiles: 0, pages: 0 })).toBe(
      "Nothing to clear: no page on your desk has stored anything yet.",
    );
    expect(clearedWords({ profiles: 1, pages: 0 })).toBe(
      "Cleared: every site on your desk is signed out.",
    );
    expect(clearedWords({ profiles: 1, pages: 1 })).toBe(
      "Cleared: every site on your desk is signed out · 1 open page reloaded.",
    );
  });
});
