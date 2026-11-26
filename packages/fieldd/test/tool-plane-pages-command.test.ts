import {
  PAGES_DAEMON_ACTIONS,
  PAGES_WAIT_MAX_MS,
  type PagesDaemonAction,
  TOOL_SCHEMAS,
  TOOLS,
} from "@vibefield/contracts";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  PAGES_VERBS,
  PAGES_WINDOWS,
  type PagesCommand,
  type PagesVerbName,
  pagesCommand,
  pagesFormOf,
} from "../src/tool-plane/rooms/pages/command";

// EY-2 (2b, 2026-11-19) — the pages room's 29 rows as the pinned engine's checked JSON commands (its CLI's
// commands.rs at the pin): each row's input, as its own schema parses it, becomes exactly one command, the room's drops
// left out, every renamed field under the engine's name, and every wait bounded.

const REF = "vf:obj/page0001";
const parse = (name: PagesVerbName, input: Record<string, unknown>) =>
  TOOL_SCHEMAS[name].input.parse(input) as Record<string, unknown>;
const command = (name: PagesVerbName, input: Record<string, unknown> = {}) =>
  pagesCommand(name, parse(name, input));

describe("EY-2: the 29 rows, the room's own list", () => {
  it("names every browser row of the tools table, in its order, and nothing else", () => {
    const rows = TOOLS.filter((tool) => tool.family === "pages").map((tool) => tool.name);
    expect([...PAGES_VERBS]).toEqual(rows);
    expect(PAGES_VERBS).toHaveLength(29);
  });

  it("opens a read window for every read-only row and an act window for the rest; the profiles row asks main nothing", () => {
    for (const tool of TOOLS.filter((row) => row.family === "pages")) {
      const name = tool.name as PagesVerbName;
      if (name === "browser_tools_profiles") expect(PAGES_WINDOWS[name]).toBe("none");
      else expect(PAGES_WINDOWS[name]).toBe(tool.readOnly ? "read" : "act");
    }
  });

  it("calls for the run as a whole for a new tab, the list, the close and open with no page; for one page otherwise", () => {
    expect(pagesFormOf("browser_tab_new", {})).toBe("run");
    expect(pagesFormOf("browser_tab_list", {})).toBe("run");
    expect(pagesFormOf("browser_close", {})).toBe("run");
    expect(pagesFormOf("browser_open", {})).toBe("run");
    expect(pagesFormOf("browser_open", { page: REF })).toBe("page");
    expect(pagesFormOf("browser_click", { page: REF, ref: "@e1" })).toBe("page");
    expect(pagesFormOf("browser_tools_profiles", {})).toBe("none");
  });
});

describe("EY-2: each row's command", () => {
  it("open goes to its address on a page, a new page starts blank, and a page you have with no address is bad input", () => {
    expect(command("browser_open", { page: REF, url: "https://example.com/" })).toEqual({
      action: "navigate",
      url: "https://example.com/",
    });
    expect(command("browser_open", {})).toEqual({ action: "navigate", url: "about:blank" });
    expect(() => command("browser_open", { page: REF })).toThrow(
      expect.objectContaining({ details: expect.objectContaining({ fact: "bad-input" }) }),
    );
  });

  it("read reads the page's own tab, always bounded, and never fetches", () => {
    expect(command("browser_read", { page: REF })).toEqual({
      action: "read",
      timeout: PAGES_WAIT_MAX_MS,
    });
    expect(
      command("browser_read", { page: REF, filter: "price", outline: true, raw: false }),
    ).toEqual({
      action: "read",
      timeout: PAGES_WAIT_MAX_MS,
      filter: "price",
      outline: true,
      raw: false,
    });
  });

  it("snapshot takes the engine's names: depth is maxDepth, includeUrls is urls, within is selector, and full is a delta's whole", () => {
    expect(
      command("browser_snapshot", {
        page: REF,
        compact: true,
        depth: 4,
        includeUrls: true,
        interactive: true,
        within: "#main",
      }),
    ).toEqual({
      action: "snapshot",
      compact: true,
      maxDepth: 4,
      urls: true,
      interactive: true,
      selector: "#main",
    });
    expect(command("browser_snapshot", { page: REF, full: true, delta: false })).toEqual({
      action: "snapshot",
      full: true,
      delta: true,
    });
  });

  it("acts on a part name it the engine's selector, and fill's text is its value", () => {
    expect(command("browser_click", { page: REF, ref: "@e3" })).toEqual({
      action: "click",
      selector: "@e3",
    });
    expect(command("browser_fill", { page: REF, ref: "@e3", text: "hi" })).toEqual({
      action: "fill",
      selector: "@e3",
      value: "hi",
    });
    expect(command("browser_type", { page: REF, ref: "@e3", text: "hi", delayMs: 20 })).toEqual({
      action: "type",
      selector: "@e3",
      text: "hi",
      delay: 20,
    });
    expect(command("browser_check", { page: REF, ref: "@e4" })).toEqual({
      action: "check",
      selector: "@e4",
    });
    expect(command("browser_uncheck", { page: REF, ref: "@e4" })).toEqual({
      action: "uncheck",
      selector: "@e4",
    });
    expect(command("browser_get_text", { page: REF, ref: "@e5" })).toEqual({
      action: "gettext",
      selector: "@e5",
    });
  });

  it("select always sends its values as a list, one value included", () => {
    expect(command("browser_select", { page: REF, ref: "@e6", values: ["red"] })).toEqual({
      action: "select",
      selector: "@e6",
      values: ["red"],
    });
  });

  it("scroll sends the engine's own defaults rather than leaning on them, and a part as its selector", () => {
    expect(command("browser_scroll", { page: REF })).toEqual({
      action: "scroll",
      direction: "down",
      amount: 300,
    });
    expect(
      command("browser_scroll", { page: REF, ref: "#list", direction: "up", amount: 40 }),
    ).toEqual({ action: "scroll", direction: "up", amount: 40, selector: "#list" });
  });

  it("every wait sends its own bound, and the most when it gave none", () => {
    expect(command("browser_wait_ms", { page: REF, ms: 500 })).toEqual({
      action: "wait",
      timeout: 500,
    });
    expect(command("browser_wait_for_selector", { page: REF, ref: "#x" })).toEqual({
      action: "wait",
      selector: "#x",
      timeout: PAGES_WAIT_MAX_MS,
    });
    expect(
      command("browser_wait_for_text", { page: REF, text: "Done", waitTimeoutMs: 1_000 }),
    ).toEqual({ action: "wait", text: "Done", timeout: 1_000 });
    expect(
      command("browser_wait_for_load", { page: REF, state: "networkidle", waitTimeoutMs: 2_000 }),
    ).toEqual({ action: "waitforloadstate", state: "networkidle", timeout: 2_000 });
  });

  it("a still names no file and no folder of the engine's: fieldd names the run's folder in the call", () => {
    const still = command("browser_screenshot", { page: REF, ref: "#chart", format: "jpeg" });
    expect(still).toEqual({
      action: "screenshot",
      fullPage: false,
      annotate: false,
      selector: "#chart",
      format: "jpeg",
    });
    expect(still).not.toHaveProperty("path");
    expect(still).not.toHaveProperty("screenshotDir");
  });

  it("the page's history, its reads of itself, the tabs, eval and the close are the engine's own verbs", () => {
    expect(command("browser_back", { page: REF })).toEqual({ action: "back" });
    expect(command("browser_forward", { page: REF })).toEqual({ action: "forward" });
    expect(command("browser_reload", { page: REF })).toEqual({ action: "reload" });
    expect(command("browser_press", { page: REF, key: "Enter" })).toEqual({
      action: "press",
      key: "Enter",
    });
    expect(command("browser_get_url", { page: REF })).toEqual({ action: "url" });
    expect(command("browser_get_title", { page: REF })).toEqual({ action: "title" });
    expect(command("browser_tab_new", { url: "https://example.com/", label: "docs" })).toEqual({
      action: "tab_new",
      url: "https://example.com/",
      label: "docs",
    });
    expect(command("browser_tab_list")).toEqual({ action: "tab_list" });
    expect(command("browser_tab_close", { page: REF })).toEqual({ action: "tab_close" });
    expect(command("browser_eval", { page: REF, script: "1+1" })).toEqual({
      action: "evaluate",
      script: "1+1",
    });
    expect(command("browser_close")).toEqual({ action: "close" });
  });

  it("a switch sets nothing: it reads the page's address, which answers gone for a closed page", () => {
    expect(command("browser_tab_switch", { page: REF })).toEqual({ action: "url" });
  });

  it("the profiles row is fieldd's alone", () => {
    expect(command("browser_tools_profiles")).toBeUndefined();
  });

  it("drops what the room never forwards, even where a passthrough input carries it", () => {
    expect(
      pagesCommand("browser_click", { page: REF, ref: "@e1", newTab: true, human: true }),
    ).toEqual({ action: "click", selector: "@e1" });
    expect(pagesCommand("browser_type", { page: REF, ref: "@e1", text: "x", clear: true })).toEqual(
      { action: "type", selector: "@e1", text: "x" },
    );
    expect(
      pagesCommand("browser_screenshot", {
        page: REF,
        path: "/Users/u/x.png",
        screenshotDir: "/Users/u",
      }),
    ).toEqual({ action: "screenshot", fullPage: false, annotate: false });
  });

  it("no row, with any input, builds main's rebind: only fieldd's own resume sends it, since it moves another run's pages", () => {
    const tries: Record<string, unknown>[] = [
      {},
      { page: REF, url: "https://example.com/", action: "rebind", from: "run-other" },
      { page: REF, ref: "@e1", command: { action: "rebind", from: "run-other" } },
      { page: REF, script: "1", key: "Enter", text: "x", values: ["a"], from: "run-other" },
    ];
    for (const name of PAGES_VERBS)
      for (const input of tries) {
        let built: ReturnType<typeof pagesCommand>;
        try {
          built = pagesCommand(name, input);
        } catch {
          continue;
        }
        if (built === undefined) continue;
        expect(built.action).not.toBe("rebind");
        expect(built).not.toHaveProperty("from");
      }
  });

  it("names its action from the engine actions main's broker passes, and only those, in its type and in what it builds", () => {
    expectTypeOf<PagesCommand["action"]>().toEqualTypeOf<PagesDaemonAction>();
    const tries: Record<string, unknown>[] = [
      {},
      { page: REF },
      { page: REF, url: "https://example.com/" },
      { page: REF, ref: "@e1", text: "x", key: "Enter", values: ["a"], script: "1", ms: 10 },
    ];
    const allowed = new Set<string>(PAGES_DAEMON_ACTIONS);
    for (const name of PAGES_VERBS)
      for (const input of tries) {
        let built: ReturnType<typeof pagesCommand>;
        try {
          built = pagesCommand(name, input);
        } catch {
          continue;
        }
        if (built === undefined) continue;
        expect(allowed.has(built.action), `${name} builds ${built.action}`).toBe(true);
      }
  });
});
