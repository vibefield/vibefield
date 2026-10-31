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
  ComposeHistoryReadInput,
  ComposeHistorySearchInput,
  ComposeHistorySearchOutput,
  ComposeProjectsListInput,
  ComposeProjectsListOutput,
  ComposeReadOutput,
} from "./compose";

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
  "you",
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
export const TOOL_SLICES = ["CP-1", "CP-2", "CP-3", "CP-4"] as const;
export type ToolSlice = (typeof TOOL_SLICES)[number];

export interface ToolDef {
  /** `<noun>_<verb>`, singular for one object and plural for a list: lowercase, unique on the server, never a dot or a
   * vendor's word (the MT lead's ruling 1, 2026-10-30). Short and plain, because a harness may find a tool by
   * searching its description. A rename is a retirement (the study's §8). */
  readonly name: string;
  readonly family: ToolFamily;
  readonly category: ToolCategory;
  readonly audience: ToolAudience;
  readonly scope: ToolScope;
  /** a kind room's rows only: the object kind they act on (the pages room's `vibefield.browser-pane`) */
  readonly object?: string;
  /** answers from what fieldd already knows and changes nothing (MCP's `readOnlyHint`) */
  readonly readOnly: boolean;
  /** MCP's `destructiveHint`. Stated on every acting row, because MCP's own default is `true`; a read-only row leaves it
   * out and the projection writes `false`. */
  readonly destructive?: boolean;
  /** MCP's `idempotentHint`. Stated on every acting row; a read-only row leaves it out and the projection writes `true`. */
  readonly idempotent?: boolean;
  readonly slice: ToolSlice;
  /** what the model reads in the tool list; "you" is the caller, "the user" the person it works for */
  readonly description: string;
}

// The compose rooms (TL-D1 A, narrowed by MT-D2): every spark is served every row that has landed, and a plain run none.
const SPARK_AGENTS = { category: "agents", audience: "spark", scope: "profiles" } as const;

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
      "Start an agent under one of your profiles, in a folder, with a model, an effort and a first prompt. It asks the user before it acts, as every agent does. Returns its session id, and you are woken when it finishes, asks or fails.",
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
      "Send words to a session the user or you started. They wait for its next idle moment and land there marked as yours, sent on the user's behalf.",
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
  {
    name: "canvas_place",
    family: "canvas",
    category: "desk",
    audience: "agent",
    scope: "device",
    readOnly: false,
    destructive: false,
    idempotent: false,
    slice: "CP-4",
    description:
      "Put a board or a note on the user's canvas, only when the user asked for it. The window places it, signed and undoable.",
  },
  {
    name: "canvas_update",
    family: "canvas",
    category: "desk",
    audience: "agent",
    scope: "object",
    readOnly: false,
    destructive: true,
    idempotent: true,
    slice: "CP-4",
    description: "Change a board or a note you placed, on the user's word.",
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
    description:
      "Ask the user a question with choices. Returns at once; the answer arrives as a wake.",
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
    description: "Tell the user something while they are in another view.",
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
} as const satisfies Record<string, { input: z.ZodTypeAny; output: z.ZodTypeAny }>;

export type ServedToolName = keyof typeof TOOL_SCHEMAS;
export const isServedTool = (name: string): name is ServedToolName =>
  Object.hasOwn(TOOL_SCHEMAS, name);

const BY_NAME: ReadonlyMap<string, ToolDef> = new Map(TOOLS.map((tool) => [tool.name, tool]));
/** The row of a name, served or planned; undefined for a name the catalog has no row for. */
export const toolRow = (name: string): ToolDef | undefined => BY_NAME.get(name);
