// EY-1 (2026-11-24) — the engine's allow list: what main's broker passes, by action and by argument.
//
// Contracts names the actions (PAGES_DAEMON_ACTIONS: "Main's broker passes these and the run form's own, and refuses
// any other"). This table names each action's arguments: exactly the ones fieldd's rows send
// (rooms/pages/command.ts), held to that builder's text by a row of this package. fieldd builds each command from
// named keys, so nothing here is reachable by an agent while fieldd is whole; this is main's own wall behind it.
//
// Why by argument, and not a list of forbidden names: the pinned engine reads more keys than any row sends, and
// several name a place. `screenshot` writes at `path` or under `screenshotDir`; `read` given a `url` fetches it by
// itself, past the page and the bridge, with `headers` of the caller's; `click` given `newTab` opens one; `wait`
// given a `function` runs it. A key the engine learns to read tomorrow is refused here until a row sends it.
// A still's file is never an argument: main mints its path in the folder fieldd names on the call
// (core/still-folder.ts).
//
// Pure: contracts' lists and nothing else.
import {
  PAGES_DAEMON_ACTIONS,
  type PagesDaemonAction,
  SHELL_SURFACES_RUN_ACTIONS,
  type ShellSurfacesRunAction,
} from "@vibefield/contracts";

/** Each action the rows send, and the arguments it may carry. Sorted, each once. */
export const PAGES_COMMAND_ARGUMENTS = {
  back: [],
  check: ["selector"],
  click: ["selector"],
  close: [],
  evaluate: ["script"],
  fill: ["selector", "value"],
  forward: [],
  gettext: ["selector"],
  navigate: ["url"],
  press: ["key"],
  read: ["filter", "outline", "raw", "timeout"],
  reload: [],
  screenshot: ["annotate", "format", "fullPage", "ifChanged", "quality", "selector", "threshold"],
  scroll: ["amount", "direction", "selector"],
  select: ["selector", "values"],
  snapshot: ["compact", "delta", "full", "interactive", "maxDepth", "selector", "urls"],
  tab_close: [],
  tab_list: [],
  tab_new: ["label", "url"],
  title: [],
  type: ["delay", "selector", "text"],
  uncheck: ["selector"],
  url: [],
  wait: ["selector", "text", "timeout"],
  waitforloadstate: ["state", "timeout"],
} as const satisfies Readonly<Record<PagesDaemonAction, readonly string[]>>;

/** The run form's own actions (main's alone, never the engine's), and what each may carry. */
export const PAGES_RUN_ARGUMENTS = {
  close: [],
  rebind: ["from"],
  tab_list: [],
} as const satisfies Readonly<Record<ShellSurfacesRunAction, readonly string[]>>;

const DAEMON_ACTIONS: readonly string[] = PAGES_DAEMON_ACTIONS;
const RUN_ACTIONS: readonly string[] = SHELL_SURFACES_RUN_ACTIONS;

/** What a command may carry on its form, or null for an action that form does not take. An own-key read: an
 * action named like something every object has (`constructor`) is on no list. */
function argumentsOf(form: "page" | "run", action: string): readonly string[] | null {
  if (form === "run" && RUN_ACTIONS.includes(action)) {
    return PAGES_RUN_ARGUMENTS[action as ShellSurfacesRunAction];
  }
  if (DAEMON_ACTIONS.includes(action)) return PAGES_COMMAND_ARGUMENTS[action as PagesDaemonAction];
  return null;
}

/** Why a command is refused, or null for one that passes: its `action` is not on its form's list, or it carries
 * an `argument` that is not the action's own. Values are not read here: the engine and the bridge hold those. */
export function refusedCommand(
  form: "page" | "run",
  command: { readonly action: string; readonly [field: string]: unknown },
): "action" | "argument" | null {
  const allowed = argumentsOf(form, command.action);
  if (allowed === null) return "action";
  for (const key of Object.keys(command)) {
    if (key !== "action" && !allowed.includes(key)) return "argument";
  }
  return null;
}
