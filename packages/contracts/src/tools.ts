import type { z } from "zod";
import {
  ComposeAgentInterruptOutput,
  ComposeAgentReadInput,
  ComposeAgentSendInput,
  ComposeAgentSendOutput,
  ComposeAgentSessionInput,
  ComposeAgentSpawnInput,
  ComposeAgentSpawnOutput,
  ComposeAgentStopOutput,
  ComposeAgentsAvailableInput,
  ComposeAgentsAvailableOutput,
  ComposeAgentsListInput,
  ComposeAgentsListOutput,
  ComposeAgentWatchOutput,
  ComposeAskUserInput,
  ComposeAskUserOutput,
  ComposeHistoryReadInput,
  ComposeHistorySearchInput,
  ComposeHistorySearchOutput,
  ComposeNotifyInput,
  ComposeNotifyOutput,
  ComposeProjectsListInput,
  ComposeProjectsListOutput,
  ComposeReadOutput,
  NEEDS_CHOICE_WORDS,
  NEEDS_CHOICES_MAX,
  NEEDS_NOTICE_CHARS,
  NEEDS_OPEN_PER_SPARK,
  NOTIFY_PER_MINUTE,
} from "./compose";
import {
  CanvasKindsInput,
  CanvasKindsOutput,
  CanvasListInput,
  CanvasListOutput,
  CanvasPlaceInput,
  CanvasRemoveOutput,
  ObjectActInput,
  ObjectManual,
  ObjectOnlyInput,
  ObjectOpenInput,
  ObjectReadInput,
  ObjectReleaseOutput,
  ObjectToolOutput,
} from "./objects";
import {
  PagesActOutput,
  PagesClosedOutput,
  PagesEvalInput,
  PagesFillInput,
  PagesNoInput,
  PagesOpenInput,
  PagesPageInput,
  PagesPressInput,
  PagesProfilesOutput,
  PagesReadInput,
  PagesReadOutput,
  PagesRefInput,
  PagesScreenshotInput,
  PagesScreenshotOutput,
  PagesScrollInput,
  PagesSelectInput,
  PagesSnapshotInput,
  PagesTabListOutput,
  PagesTabNewInput,
  PagesTabNewOutput,
  PagesTypeInput,
  PagesWaitForLoadInput,
  PagesWaitForRefInput,
  PagesWaitForTextInput,
  PagesWaitMsInput,
} from "./pages";

// The tool plane (track MT; `draft/thinking-tool-plane.md`, ruled by James on its page 2026-10-30 21:19–21:20Z; the
// plan is `draft/tool-plane/IMPLEMENTATION.md` §3). Every tool VibeField offers an agent is ONE ROW here, served by the
// one `vibefield` server over the one floor door, and a tool with no row does not ship (MT-L1). Audience is a column,
// not a server (MT-L3): the compose rooms stay a spark's, and History and the projects list are every agent fieldd can
// name (MT-D2, MT-D5). fieldd names the caller from its process and holds each call to its row's scope whatever the
// list showed (MT-L2), and writes the audit line before the call acts (CP-L6).
//
// Served = has schemas. A row in TOOL_SCHEMAS is listed and answered; a row without one is planned, the record of
// what its slice builds, and is listed nowhere but api.html's table. Like compose.ts, the catalog is TS-only:
// field-native reads none of it.

export const TOOL_CATEGORIES = ["desk", "agents", "artifacts", "you"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const TOOL_FAMILIES = [
  "agents",
  "watch",
  "talk",
  "flows",
  "history",
  "projects",
  "canvas",
  "object",
  "you",
  "pages",
] as const;
export type ToolFamily = (typeof TOOL_FAMILIES)[number];

/** MT-D2 — the least caller that sees a row: `agent` is any run fieldd can name, a spark's own session among them;
 * `spark` is a spark's session alone. */
export const TOOL_AUDIENCES = ["agent", "spark"] as const;
export type ToolAudience = (typeof TOOL_AUDIENCES)[number];

/** What fieldd holds a call to (the study's §6): the caller's Agent Profiles, this device, a desk object the caller
 * placed or was handed (MT-L4), or the caller's own session. */
export const TOOL_SCOPES = ["profiles", "device", "object", "self"] as const;
export type ToolScope = (typeof TOOL_SCOPES)[number];

/** The slice that builds a row (the compose plane's order; MT-1 onward adds its own). */
export const TOOL_SLICES = ["CP-1", "CP-2", "CP-3", "CP-4", "OB-3", "EY-2"] as const;
export type ToolSlice = (typeof TOOL_SLICES)[number];

/** The facts a refusal names in its `fact`, so the model can act on it (the study's §8). The first eight are the
 * ones fieldd answers today. fieldd's plane reads this list beside the desk room's own, OBJECT_FACTS (`objects.ts`,
 * OB-3b), which already says four of the pages room's words: not-handed, held, gone and needs-you. The pages room's
 * eight follow (EY; `draft/thinking-agents-eyes.md`, its facts table):
 * - `gone` is a pane that closed or a page that was replaced. It is not the app quitting: a grant is kept across a
 *   quit (EY-D9 B). While the app's window is down, a page answers `unavailable`.
 * - `held` answers reads and stills as well as acts (BU-9 A). */
export const TOOL_FACTS = [
  "unknown-tool",
  "forbidden",
  "bad-input",
  "outside",
  "not-found",
  "unavailable",
  "limit",
  "failed",
  "not-handed",
  "held",
  "off-site",
  "stale-ref",
  "loading",
  "parked",
  "gone",
  "needs-you",
] as const;
export type ToolFact = (typeof TOOL_FACTS)[number];

export interface ToolDef {
  /** `<noun>_<verb>`, singular for one object and plural for a list: lowercase, unique on the server, never a dot or a
   * vendor's word (the MT lead's ruling 1, 2026-10-30). Short and plain, because a harness may find a tool by
   * searching its description. A rename is a retirement (the study's §8). Dated 2026-11-19 (EY-0's follow-up): the
   * pages room keeps the pin's own verbs as `browser_<verb>` (plan §6.1), so `browser_get_text` and `browser_tab_list`
   * keep the engine's order of words, one to one with the pin. */
  readonly name: string;
  readonly family: ToolFamily;
  readonly category: ToolCategory;
  readonly audience: ToolAudience;
  readonly scope: ToolScope;
  /** a kind room's rows only: the object kind they act on (the pages room's `vibefield.browser-pane`) */
  readonly object?: string;
  /** answers from what fieldd already knows and changes nothing (MCP's `readOnlyHint`). Dated 2026-11-19 (EY-0's
   * follow-up): nothing outside the caller's own run folder, where a still (`browser_screenshot`) is saved as its
   * answer. */
  readonly readOnly: boolean;
  /** MCP's `destructiveHint`. Stated on every acting row, because MCP's own default is `true`; a read-only row leaves it
   * out and the projection writes `false`. */
  readonly destructive?: boolean;
  /** MCP's `idempotentHint`. Stated on every acting row; a read-only row leaves it out and the projection writes `true`. */
  readonly idempotent?: boolean;
  /** MCP's `openWorldHint` (EY, 2026-11-19): the row reaches whatever site a page shows, the open web. Stated on
   * every pages row; every other room is closed-world (the desk, the profiles, this device), leaves it out, and
   * the projection writes `false`. */
  readonly openWorld?: boolean;
  readonly slice: ToolSlice;
  /** what the model reads in the tool list; "you" is the caller, "the user" the person it works for */
  readonly description: string;
}

// The compose rooms (TL-D1 A, narrowed by MT-D2): every spark is served every row that has landed, and a plain run none.
const SPARK_AGENTS = { category: "agents", audience: "spark", scope: "profiles" } as const;

const DESK_DEVICE = { category: "desk", audience: "agent", scope: "device" } as const;
const DESK_OBJECT = { category: "desk", audience: "agent", scope: "object" } as const;

// EY — the pages room (`draft/tool-plane/browser-use.md`, BU-1 and BU-2 A). The map was signed on 2026-11-17
// (EY-0, plan §2.1). The rows are the pinned engine's core profile, in its order, named `browser_<verb>`. They are
// every agent's (MT-D2), each on the browser pane. EY-2 serves them. `pages-record.ts` records the pin, and
// a test holds these rows to it. Read a second time on 2026-11-19 (EY-0's follow-up), which changed four things:
// - browser_open keeps the object scope, and the room holds both its forms: on a page, by the grant; with none, as
//   the run's own new pane, minted and granted as canvas_place's object is, and so every pane a call makes;
// - browser_tab_switch is a read: each call goes to its page first (BU-20), so a switch sets nothing;
// - check, uncheck and select may destroy, as a click may: a settings page saves as it changes;
// - a handed page goes back at browser_tab_close and browser_close, and the person's pane stays open.
// Served since 2a (2026-11-19): each row's input and output are pages.ts's, the pin's own arguments less those the
// room drops.
const PAGES = {
  family: "pages",
  category: "desk",
  audience: "agent",
  object: "vibefield.browser-pane",
  slice: "EY-2",
} as const;

/** Every row, in the version 2 page's order with the new rooms after it. History and the projects list are the `agent`
 * rows; projects_list reads no profile and answers this desktop's projects, so its scope is the device (the MT lead's
 * ruling 11). */
export const TOOLS: readonly ToolDef[] = [
  {
    name: "agents_available",
    family: "agents",
    ...SPARK_AGENTS,
    readOnly: true,
    slice: "CP-1",
    description:
      "List the agents you can start: each agent signed in under your Agent Profiles, with its models and their efforts.",
  },
  {
    name: "agent_spawn",
    family: "agents",
    ...SPARK_AGENTS,
    readOnly: false,
    destructive: false,
    idempotent: false,
    slice: "CP-2",
    description:
      "Start an agent under one of your profiles, in a folder, with a model, an effort and a first prompt. It asks the user before it acts, as every agent does. Returns its session id, or past your cap of live agents the item it waits in for the user's OK; you are woken when it finishes, asks or fails.",
  },
  {
    name: "agents_list",
    family: "watch",
    ...SPARK_AGENTS,
    readOnly: true,
    slice: "CP-1",
    description:
      "List the agent sessions under your profiles: each one's agent, state, folder, model, cost, and who started it.",
  },
  {
    name: "agent_read",
    family: "watch",
    ...SPARK_AGENTS,
    readOnly: true,
    slice: "CP-1",
    description:
      "Read the latest turns of one session: what it was asked and what it answered. Bounded; pass `before` for older turns.",
  },
  {
    name: "agent_watch",
    family: "watch",
    ...SPARK_AGENTS,
    readOnly: false,
    destructive: false,
    idempotent: true,
    slice: "CP-2",
    description:
      "Be woken when a session you did not start finishes, asks the user, fails or ends.",
  },
  {
    name: "agent_unwatch",
    family: "watch",
    ...SPARK_AGENTS,
    readOnly: false,
    destructive: false,
    idempotent: true,
    slice: "CP-2",
    description: "Stop being woken by a session you watch.",
  },
  {
    name: "agent_send",
    family: "talk",
    ...SPARK_AGENTS,
    readOnly: false,
    destructive: false,
    idempotent: false,
    slice: "CP-2",
    description:
      "Send words to a session the user or you started. They wait for its next idle moment and land there marked as yours, sent on the user's behalf. Your first words to a session the user started wait for the user's OK.",
  },
  {
    name: "agent_interrupt",
    family: "talk",
    ...SPARK_AGENTS,
    readOnly: false,
    destructive: true,
    idempotent: true,
    slice: "CP-2",
    description:
      "Stop a session's current turn. The session stays, and the stop counts as the user's.",
  },
  {
    name: "agent_stop",
    family: "talk",
    ...SPARK_AGENTS,
    readOnly: false,
    destructive: true,
    idempotent: true,
    slice: "CP-2",
    description: "End a session you started.",
  },
  {
    name: "flow_run",
    family: "flows",
    ...SPARK_AGENTS,
    readOnly: false,
    destructive: false,
    idempotent: false,
    slice: "CP-4",
    description:
      "Run a flow the user approved, with its input. You are woken when the run asks or ends.",
  },
  {
    name: "flow_read",
    family: "flows",
    ...SPARK_AGENTS,
    readOnly: true,
    slice: "CP-4",
    description: "Read a run's steps, rounds and spend.",
  },
  {
    name: "flow_stop",
    family: "flows",
    ...SPARK_AGENTS,
    readOnly: false,
    destructive: true,
    idempotent: true,
    slice: "CP-4",
    description: "Stop a run. Its journal stays, and its agents' turns stop.",
  },
  {
    name: "flow_propose",
    family: "flows",
    ...SPARK_AGENTS,
    readOnly: false,
    destructive: false,
    idempotent: false,
    slice: "CP-4",
    description:
      "Propose a flow file you wrote. It goes to the user with what it does, which agents it starts and what it may spend, and it never runs before the user approves it.",
  },
  {
    name: "history_search",
    family: "history",
    category: "agents",
    audience: "agent",
    scope: "profiles",
    readOnly: true,
    slice: "CP-1",
    description:
      "Search past agent sessions under your profiles. Returns the matching turns with their session, agent, folder and time.",
  },
  {
    name: "history_read",
    family: "history",
    category: "agents",
    audience: "agent",
    scope: "profiles",
    readOnly: true,
    slice: "CP-1",
    description:
      "Read a past session's turns from History. Bounded; pass `before` for older turns.",
  },
  {
    name: "projects_list",
    family: "projects",
    category: "agents",
    audience: "agent",
    scope: "device",
    readOnly: true,
    slice: "CP-1",
    description: "List the user's projects, each with its name and folders.",
  },
  // The desk's eight (track OB; `draft/thinking-objects-at-work.md` §5.2, OB-D5 A): every agent holds these whatever is
  // installed, and a kind's own tools arrive in its manual (OB-L3). The read/act split keeps the harness's gate (MT-D7).
  {
    name: "canvas_kinds",
    family: "canvas",
    ...DESK_DEVICE,
    readOnly: true,
    slice: "OB-3",
    description:
      "List what you can place on the user's desk: each kind's name, what it is for, and whether it gives you tools once placed.",
  },
  {
    name: "canvas_list",
    family: "canvas",
    ...DESK_DEVICE,
    readOnly: true,
    slice: "OB-3",
    description:
      "List the objects on the user's desk: each one's ref, kind, title and place, which agents are working on it, and whether it is yours to work (you placed it, or the user handed it to you). The contents of objects that are not yours stay closed.",
  },
  {
    name: "canvas_place",
    family: "canvas",
    ...DESK_DEVICE,
    readOnly: false,
    destructive: false,
    idempotent: false,
    slice: "OB-3",
    description:
      "Place a new object on the user's desk, only when the user asked for one. It is yours to work at once: the answer carries its ref and its tools, as object_open's does. The user sees it arrive and can undo it.",
  },
  {
    name: "canvas_remove",
    family: "canvas",
    ...DESK_OBJECT,
    readOnly: false,
    destructive: true,
    idempotent: true,
    slice: "OB-3",
    description:
      "Remove an object you placed. The user can undo it. Objects the user made or handed you stay theirs to remove.",
  },
  {
    name: "object_open",
    family: "object",
    ...DESK_OBJECT,
    readOnly: true,
    slice: "OB-3",
    description:
      "Start working on an object you placed or the user handed you. Returns what it is, what it holds now (bounded), and its tools with their inputs. Call it before its tools, and again if you no longer have them in front of you (tools: false leaves them out). The user sees you have it open.",
  },
  {
    name: "object_read",
    family: "object",
    ...DESK_OBJECT,
    readOnly: true,
    slice: "OB-3",
    description:
      "Run one of an object's read tools, as object_open lists them, with its input. It changes nothing.",
  },
  {
    name: "object_act",
    family: "object",
    ...DESK_OBJECT,
    readOnly: false,
    destructive: false,
    idempotent: false,
    slice: "OB-3",
    description:
      "Run one of an object's acting tools, as object_open lists them, with its input. Say in doing, in a few words the user will read, what this act changes. Each act is one change the user can undo, marked with your name. While the user is holding the object it answers held; try again later.",
  },
  {
    name: "object_release",
    family: "object",
    ...DESK_OBJECT,
    readOnly: false,
    destructive: false,
    idempotent: true,
    slice: "OB-3",
    description:
      "Stop working on an object. One the user handed you goes back to them; one you placed stays yours.",
  },
  {
    name: "ask_user",
    family: "you",
    category: "you",
    audience: "spark",
    scope: "self",
    readOnly: false,
    destructive: false,
    idempotent: false,
    slice: "CP-3",
    description: `Ask the user a question with 1 to ${NEEDS_CHOICES_MAX} choices of your own; VibeField adds ${NEEDS_CHOICE_WORDS.notNow} after them, so no choice may be ${NEEDS_CHOICE_WORDS.notNow}. Returns at once, and the answer arrives as a wake. At most ${NEEDS_OPEN_PER_SPARK} of your questions, held sends and spawns wait for the user at a time.`,
  },
  {
    name: "notify",
    family: "you",
    category: "you",
    audience: "agent",
    scope: "self",
    readOnly: false,
    destructive: false,
    idempotent: false,
    slice: "CP-3",
    description: `Tell the user something, on one line of at most ${NEEDS_NOTICE_CHARS} characters: every VibeField window's status line says it, and a notification does while no VibeField window is in front. It returns once handed on, never that they read it. At most ${NOTIFY_PER_MINUTE} a minute from you.`,
  },
  {
    name: "browser_tools_profiles",
    ...PAGES,
    scope: "self",
    readOnly: true,
    openWorld: false,
    description:
      "List the browser tools you hold, and how to reach the browser's other commands from your pane. VibeField answers it, and it touches no page.",
  },
  {
    name: "browser_open",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: true,
    description:
      "Open a page in a browser pane on the user's VibeField desk, not another browser on their computer. With no page, it opens your own, without the user's sign-ins. A url moves a page you have; a handed page stays inside its site, or answers off-site. While the user holds the page, it answers held.",
  },
  {
    name: "browser_read",
    ...PAGES,
    scope: "object",
    readOnly: true,
    openWorld: true,
    description:
      "Read a page you opened or the user handed you, as text. While the user holds the page, it answers held. A page that has not settled answers loading: read it again.",
  },
  {
    name: "browser_snapshot",
    ...PAGES,
    scope: "object",
    readOnly: true,
    openWorld: true,
    description:
      "Read a page you opened or the user handed you, as its parts, each with a ref you can act on. While the user holds the page, it answers held.",
  },
  {
    name: "browser_back",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: true,
    description:
      "Go back one step in a page's history. A page the user handed you stays inside its site, or answers off-site. While the user holds the page, it answers held.",
  },
  {
    name: "browser_forward",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: true,
    description:
      "Go forward one step in a page's history. A page the user handed you stays inside its site, or answers off-site. While the user holds the page, it answers held.",
  },
  {
    name: "browser_reload",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: true,
    description:
      "Reload a page you opened or the user handed you. While the user holds the page, it answers held.",
  },
  {
    name: "browser_click",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: true,
    description:
      "Click a part of a page by the ref a snapshot gave you. A ref the page no longer has answers stale-ref: take a new snapshot. A page the user handed you stays inside its site, or answers off-site. While the user holds the page, it answers held.",
  },
  {
    name: "browser_fill",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: true,
    description:
      "Clear a field on a page and fill it with your text, by its ref. A ref the page no longer has answers stale-ref. A field only the user may fill, such as a password, answers needs-you. While the user holds the page, it answers held.",
  },
  {
    name: "browser_type",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
    description:
      "Type text into a part of a page by its ref, after what it already holds. A ref the page no longer has answers stale-ref. A field only the user may fill, such as a password, answers needs-you. While the user holds the page, it answers held.",
  },
  {
    name: "browser_press",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: true,
    description:
      "Press a key on a page, where its focus is. A field only the user may fill, such as a password, answers needs-you. A page the user handed you stays inside its site, or answers off-site. While the user holds the page, it answers held.",
  },
  {
    name: "browser_check",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: true,
    description:
      "Check a checkbox or a switch on a page, by its ref. A ref the page no longer has answers stale-ref: take a new snapshot. While the user holds the page, it answers held.",
  },
  {
    name: "browser_uncheck",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: true,
    description:
      "Uncheck a checkbox or a switch on a page, by its ref. A ref the page no longer has answers stale-ref: take a new snapshot. While the user holds the page, it answers held.",
  },
  {
    name: "browser_select",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: true,
    description:
      "Pick one or more options in a list on a page, by its ref. A ref the page no longer has answers stale-ref: take a new snapshot. While the user holds the page, it answers held.",
  },
  {
    name: "browser_scroll",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
    description:
      "Scroll a page, or one part of it by its ref. While the user holds the page, it answers held.",
  },
  {
    name: "browser_wait_ms",
    ...PAGES,
    scope: "object",
    readOnly: true,
    openWorld: true,
    description:
      "Wait a set number of milliseconds on a page, within a bound, before your next call. A page that closed answers gone.",
  },
  {
    name: "browser_wait_for_selector",
    ...PAGES,
    scope: "object",
    readOnly: true,
    openWorld: true,
    description:
      "Wait until a part of a page appears, within a bound. Past the bound it answers loading: read the page again.",
  },
  {
    name: "browser_wait_for_text",
    ...PAGES,
    scope: "object",
    readOnly: true,
    openWorld: true,
    description:
      "Wait until some text appears on a page, within a bound. Past the bound it answers loading: read the page again.",
  },
  {
    name: "browser_wait_for_load",
    ...PAGES,
    scope: "object",
    readOnly: true,
    openWorld: true,
    description:
      "Wait until a page has loaded, within a bound. Past the bound it answers loading: read the page again.",
  },
  {
    name: "browser_screenshot",
    ...PAGES,
    scope: "object",
    readOnly: true,
    openWorld: true,
    description:
      "Take a still of a page, or of one part of it. It is saved as a file and answered as its path, which you can read. With ifChanged, a page that has not changed answers unchanged, with no file. While the user holds the page, it answers held.",
  },
  {
    name: "browser_get_text",
    ...PAGES,
    scope: "object",
    readOnly: true,
    openWorld: true,
    description:
      "Read the visible text of one part of a page, by its ref. A ref the page no longer has answers stale-ref. While the user holds the page, it answers held.",
  },
  {
    name: "browser_get_url",
    ...PAGES,
    scope: "object",
    readOnly: true,
    openWorld: true,
    description: "Read the address a page is at now. A page that closed answers gone.",
  },
  {
    name: "browser_get_title",
    ...PAGES,
    scope: "object",
    readOnly: true,
    openWorld: true,
    description: "Read a page's title. A page that closed answers gone.",
  },
  {
    name: "browser_tab_new",
    ...PAGES,
    scope: "device",
    readOnly: false,
    destructive: false,
    idempotent: false,
    openWorld: true,
    description:
      "Open a new page of your own, without the user's sign-ins, in a pane the window places on the desk. When the desk parks one of your pages to stay within its cap, that page answers parked.",
  },
  {
    name: "browser_tab_list",
    ...PAGES,
    scope: "self",
    readOnly: true,
    openWorld: false,
    description: "List the pages you have: those you opened and those the user handed you.",
  },
  {
    name: "browser_tab_switch",
    ...PAGES,
    scope: "object",
    readOnly: true,
    openWorld: false,
    description:
      "Answer which of your pages is current. Each call on a page goes to that page first, so a switch sets nothing for later calls. A page that closed answers gone: list your pages again.",
  },
  {
    name: "browser_tab_close",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: false,
    description:
      "Close one of your own pages. A page the user handed you goes back to them instead, and its pane stays open. A page that already closed answers gone: list your pages again.",
  },
  {
    name: "browser_eval",
    ...PAGES,
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: false,
    openWorld: true,
    description:
      "Run your own script on a page and read what it returns. On a page with the user's sign-ins it runs only if the user allowed your scripts there. A page the user handed you stays inside its site, or answers off-site. While the user holds the page, it answers held.",
  },
  {
    name: "browser_close",
    ...PAGES,
    scope: "self",
    readOnly: false,
    destructive: true,
    idempotent: true,
    openWorld: false,
    description:
      "Close the pages you opened. Pages the user handed you go back to them, their panes left open. You can open a page again later.",
  },
];

/** Each served row's input and output: a row the server lists has an entry here, and the rest arrive with their slices. */
export const TOOL_SCHEMAS = {
  agents_available: { input: ComposeAgentsAvailableInput, output: ComposeAgentsAvailableOutput },
  agents_list: { input: ComposeAgentsListInput, output: ComposeAgentsListOutput },
  agent_read: { input: ComposeAgentReadInput, output: ComposeReadOutput },
  history_search: { input: ComposeHistorySearchInput, output: ComposeHistorySearchOutput },
  history_read: { input: ComposeHistoryReadInput, output: ComposeReadOutput },
  projects_list: { input: ComposeProjectsListInput, output: ComposeProjectsListOutput },
  // CP-2 (start and talk; `draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31)
  agent_spawn: { input: ComposeAgentSpawnInput, output: ComposeAgentSpawnOutput },
  agent_watch: { input: ComposeAgentSessionInput, output: ComposeAgentWatchOutput },
  agent_unwatch: { input: ComposeAgentSessionInput, output: ComposeAgentWatchOutput },
  agent_send: { input: ComposeAgentSendInput, output: ComposeAgentSendOutput },
  agent_interrupt: { input: ComposeAgentSessionInput, output: ComposeAgentInterruptOutput },
  agent_stop: { input: ComposeAgentSessionInput, output: ComposeAgentStopOutput },
  // CP-3 (the person; `draft/compose-plane/cp3-the-person.md`, ruled 2026-10-31)
  ask_user: { input: ComposeAskUserInput, output: ComposeAskUserOutput },
  notify: { input: ComposeNotifyInput, output: ComposeNotifyOutput },
  // OB-3 (the desk's eight; `draft/thinking-objects-at-work.md` §5.2)
  canvas_kinds: { input: CanvasKindsInput, output: CanvasKindsOutput },
  canvas_list: { input: CanvasListInput, output: CanvasListOutput },
  canvas_place: { input: CanvasPlaceInput, output: ObjectManual },
  canvas_remove: { input: ObjectOnlyInput, output: CanvasRemoveOutput },
  object_open: { input: ObjectOpenInput, output: ObjectManual },
  object_read: { input: ObjectReadInput, output: ObjectToolOutput },
  object_act: { input: ObjectActInput, output: ObjectToolOutput },
  object_release: { input: ObjectOnlyInput, output: ObjectReleaseOutput },
  // EY-2 (the pages room's 29, in the pin's order; their shapes are pages.ts's, 2a)
  browser_tools_profiles: { input: PagesNoInput, output: PagesProfilesOutput },
  browser_open: { input: PagesOpenInput, output: PagesActOutput },
  browser_read: { input: PagesReadInput, output: PagesReadOutput },
  browser_snapshot: { input: PagesSnapshotInput, output: PagesReadOutput },
  browser_back: { input: PagesPageInput, output: PagesActOutput },
  browser_forward: { input: PagesPageInput, output: PagesActOutput },
  browser_reload: { input: PagesPageInput, output: PagesActOutput },
  browser_click: { input: PagesRefInput, output: PagesActOutput },
  browser_fill: { input: PagesFillInput, output: PagesActOutput },
  browser_type: { input: PagesTypeInput, output: PagesActOutput },
  browser_press: { input: PagesPressInput, output: PagesActOutput },
  browser_check: { input: PagesRefInput, output: PagesActOutput },
  browser_uncheck: { input: PagesRefInput, output: PagesActOutput },
  browser_select: { input: PagesSelectInput, output: PagesActOutput },
  browser_scroll: { input: PagesScrollInput, output: PagesActOutput },
  browser_wait_ms: { input: PagesWaitMsInput, output: PagesReadOutput },
  browser_wait_for_selector: { input: PagesWaitForRefInput, output: PagesReadOutput },
  browser_wait_for_text: { input: PagesWaitForTextInput, output: PagesReadOutput },
  browser_wait_for_load: { input: PagesWaitForLoadInput, output: PagesReadOutput },
  browser_screenshot: { input: PagesScreenshotInput, output: PagesScreenshotOutput },
  browser_get_text: { input: PagesRefInput, output: PagesReadOutput },
  browser_get_url: { input: PagesPageInput, output: PagesReadOutput },
  browser_get_title: { input: PagesPageInput, output: PagesReadOutput },
  browser_tab_new: { input: PagesTabNewInput, output: PagesTabNewOutput },
  browser_tab_list: { input: PagesNoInput, output: PagesTabListOutput },
  browser_tab_switch: { input: PagesPageInput, output: PagesReadOutput },
  browser_tab_close: { input: PagesPageInput, output: PagesClosedOutput },
  browser_eval: { input: PagesEvalInput, output: PagesActOutput },
  browser_close: { input: PagesNoInput, output: PagesClosedOutput },
} as const satisfies Record<string, { input: z.ZodTypeAny; output: z.ZodTypeAny }>;

export type ServedToolName = keyof typeof TOOL_SCHEMAS;
export const isServedTool = (name: string): name is ServedToolName =>
  Object.hasOwn(TOOL_SCHEMAS, name);

const BY_NAME: ReadonlyMap<string, ToolDef> = new Map(TOOLS.map((tool) => [tool.name, tool]));
/** The row of a name, served or planned; undefined for a name the catalog has no row for. */
export const toolRow = (name: string): ToolDef | undefined => BY_NAME.get(name);
