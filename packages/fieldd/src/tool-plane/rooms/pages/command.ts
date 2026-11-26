import { PAGES_WAIT_MAX_MS, type PagesDaemonAction } from "@vibefield/contracts";
import { RpcCallError } from "../../../native-link";

// EY-2 (2b, 2026-11-19) — the pages room's 29 rows as the pinned engine's checked JSON commands (BU-2 A: the pin's own
// verbs). Pure: a row's input, already held to its contracts schema, becomes the one command main's broker runs, never
// argv. Each row's arguments are the engine's own, less what the room drops: the engine's session, launch flags and file
// paths are the broker's and fieldd's, and a part of a page is the engine's `selector`. Every action that takes a
// `timeout` is sent one: the row's own, within PAGES_WAIT_MAX_MS, so no answer leans on the engine's default.

export const PAGES_VERBS = [
  "browser_tools_profiles",
  "browser_open",
  "browser_read",
  "browser_snapshot",
  "browser_back",
  "browser_forward",
  "browser_reload",
  "browser_click",
  "browser_fill",
  "browser_type",
  "browser_press",
  "browser_check",
  "browser_uncheck",
  "browser_select",
  "browser_scroll",
  "browser_wait_ms",
  "browser_wait_for_selector",
  "browser_wait_for_text",
  "browser_wait_for_load",
  "browser_screenshot",
  "browser_get_text",
  "browser_get_url",
  "browser_get_title",
  "browser_tab_new",
  "browser_tab_list",
  "browser_tab_switch",
  "browser_tab_close",
  "browser_eval",
  "browser_close",
] as const;
export type PagesVerbName = (typeof PAGES_VERBS)[number];

const VERBS = new Set<string>(PAGES_VERBS);
export const isPagesVerb = (name: string): name is PagesVerbName => VERBS.has(name);

/** The window main opens for a row's call: a read for every row the tools table calls read-only (a still and a switch
 * among them, which change nothing a later call sees), an act for the rest. The profiles row asks main nothing. */
export const PAGES_WINDOWS: Readonly<Record<PagesVerbName, "read" | "act" | "none">> = {
  browser_tools_profiles: "none",
  browser_open: "act",
  browser_read: "read",
  browser_snapshot: "read",
  browser_back: "act",
  browser_forward: "act",
  browser_reload: "act",
  browser_click: "act",
  browser_fill: "act",
  browser_type: "act",
  browser_press: "act",
  browser_check: "act",
  browser_uncheck: "act",
  browser_select: "act",
  browser_scroll: "act",
  browser_wait_ms: "read",
  browser_wait_for_selector: "read",
  browser_wait_for_text: "read",
  browser_wait_for_load: "read",
  browser_screenshot: "read",
  browser_get_text: "read",
  browser_get_url: "read",
  browser_get_title: "read",
  browser_tab_new: "act",
  browser_tab_list: "read",
  browser_tab_switch: "read",
  browser_tab_close: "act",
  browser_eval: "act",
  browser_close: "act",
};

/** A call's form: on one page (`page`, its surface named), for the run as a whole (`run`: main makes or lists the
 * run's own panes, or ends them), or fieldd's alone (`none`). */
export type PagesForm = "page" | "run" | "none";

export function pagesFormOf(
  name: PagesVerbName,
  input: Readonly<Record<string, unknown>>,
): PagesForm {
  switch (name) {
    case "browser_tools_profiles":
      return "none";
    case "browser_tab_new":
    case "browser_tab_list":
    case "browser_close":
      return "run";
    case "browser_open":
      return input.page === undefined ? "run" : "page";
    default:
      return "page";
  }
}

/** The engine's checked command: its `action`, one main's broker passes (PAGES_DAEMON_ACTIONS, 2026-11-19), and its own
 * named arguments. */
export type PagesCommand = { readonly action: PagesDaemonAction } & Readonly<
  Record<string, unknown>
>;

type Input = Readonly<Record<string, unknown>>;

/** A field the input gave, under the engine's name; nothing for one it left out. */
const some = (name: string, value: unknown): Record<string, unknown> =>
  value === undefined ? {} : { [name]: value };

/** A wait's bound: the row's own, never past PAGES_WAIT_MAX_MS; the most when the row gave none. */
const boundOf = (asked: unknown): number =>
  typeof asked === "number" ? Math.min(asked, PAGES_WAIT_MAX_MS) : PAGES_WAIT_MAX_MS;

const noUrl = (): RpcCallError =>
  new RpcCallError("PRECONDITION_FAILED", "open needs a url on a page you have.", false, {
    fact: "bad-input",
    path: "url",
    expected: { type: "string", format: "uri" },
  });

/** The engine's command for a row, or nothing for the row fieldd answers alone. Throws `bad-input` for open on a page
 * with no address: a page you have goes somewhere, and only a new page starts blank. */
export function pagesCommand(name: PagesVerbName, input: Input): PagesCommand | undefined {
  switch (name) {
    case "browser_tools_profiles":
      return undefined;
    case "browser_open":
      if (input.page !== undefined && input.url === undefined) throw noUrl();
      return { action: "navigate", url: input.url ?? "about:blank" };
    case "browser_read":
      return {
        action: "read",
        timeout: PAGES_WAIT_MAX_MS,
        ...some("filter", input.filter),
        ...some("outline", input.outline),
        ...some("raw", input.raw),
      };
    case "browser_snapshot":
      return {
        action: "snapshot",
        ...some("compact", input.compact),
        ...some("delta", input.delta),
        ...some("maxDepth", input.depth),
        ...some("urls", input.includeUrls),
        ...some("interactive", input.interactive),
        ...some("selector", input.within),
        // the engine's full snapshot is a delta's whole (as its own CLI sends it)
        ...(input.full === true ? { full: true, delta: true } : some("full", input.full)),
      };
    case "browser_back":
      return { action: "back" };
    case "browser_forward":
      return { action: "forward" };
    case "browser_reload":
      return { action: "reload" };
    case "browser_click":
      return { action: "click", selector: input.ref };
    case "browser_fill":
      return { action: "fill", selector: input.ref, value: input.text };
    case "browser_type":
      return {
        action: "type",
        selector: input.ref,
        text: input.text,
        ...some("delay", input.delayMs),
      };
    case "browser_press":
      return { action: "press", key: input.key };
    case "browser_check":
      return { action: "check", selector: input.ref };
    case "browser_uncheck":
      return { action: "uncheck", selector: input.ref };
    case "browser_select":
      return { action: "select", selector: input.ref, values: input.values };
    case "browser_scroll":
      return {
        action: "scroll",
        // the engine's own CLI defaults, sent rather than left to the engine
        direction: input.direction ?? "down",
        amount: input.amount ?? 300,
        ...some("selector", input.ref),
      };
    case "browser_wait_ms":
      return { action: "wait", timeout: input.ms };
    case "browser_wait_for_selector":
      return { action: "wait", selector: input.ref, timeout: boundOf(input.waitTimeoutMs) };
    case "browser_wait_for_text":
      return { action: "wait", text: input.text, timeout: boundOf(input.waitTimeoutMs) };
    case "browser_wait_for_load":
      return {
        action: "waitforloadstate",
        state: input.state,
        timeout: boundOf(input.waitTimeoutMs),
      };
    case "browser_screenshot":
      // no path and no folder of the engine's: fieldd names the run's folder in the call, and main sets the file
      return {
        action: "screenshot",
        fullPage: input.fullPage ?? false,
        annotate: input.annotate ?? false,
        ...some("selector", input.ref),
        ...some("format", input.format),
        ...some("quality", input.quality),
        ...some("ifChanged", input.ifChanged),
        ...some("threshold", input.threshold),
      };
    case "browser_get_text":
      return { action: "gettext", selector: input.ref };
    case "browser_get_url":
      return { action: "url" };
    case "browser_get_title":
      return { action: "title" };
    case "browser_tab_new":
      return { action: "tab_new", ...some("url", input.url), ...some("label", input.label) };
    case "browser_tab_list":
      return { action: "tab_list" };
    case "browser_tab_switch":
      // each call goes to its page first (BU-20), so a switch sets nothing: it reads the page, which answers gone
      // when the page has closed
      return { action: "url" };
    case "browser_tab_close":
      return { action: "tab_close" };
    case "browser_eval":
      return { action: "evaluate", script: input.script };
    case "browser_close":
      return { action: "close" };
  }
}
