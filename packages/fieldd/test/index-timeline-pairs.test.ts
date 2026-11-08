// SP-7b's 7b-2a (D-2c (a), VF-PM 2026-11-08 05:35Z) — THE PROJECTION'S GOLDEN PAIRS: rosetta's
// `TimelineEntry` beside the `IndexTimelineRow` fieldd's projection (`src/index-timeline.ts`) makes
// of it, for the kit's Swift port to be held to (7b-2b, FieldHistory; D3 (A) of the SP-7b plan).
//
// Two halves, one file (`test/fixtures/index-timeline-pairs.golden.json`):
// - `cases`: one entry and its row per branch the projection reads — every body kind, every notice
//   and tool family it names, the bounds, the tolerances — plus the two rows of rosetta's own page
//   golden (`packages/contracts/fixtures/index-timeline-page.rosetta-26.json`).
// - `steps`: one live session as rosetta's client hands it — the snapshot, then entries changed in
//   place and a new one — with the whole projection after each. A step's `upserts` are the entries
//   as the client holds them AFTER its own patch (`patchRow`), so the port re-projects exactly
//   those rows and lands on `rows`: the incremental step equals the full projection (D-2c (a)).
//
// This file is the ONE writer, as IOS-12's goldens are: `VF_WRITE_GOLDENS=1` writes the golden;
// without it the committed file must be what the projection writes now, byte for byte (biome is
// told to leave it). The kit's copy joins `pnpm check:ios-fixtures` with 7b-2b. Every regeneration
// is a re-bless: the commit says which case or step moved and why, and a defect the pairs show is
// its own item, fixed first.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  INDEX_TIMELINE,
  IndexTimelineEntryRow,
  IndexTimelinePageResponse,
  type IndexTimelineRow,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { projectTimelineRow } from "../src/index-timeline";

const HERE = dirname(fileURLToPath(import.meta.url));

const GOLDEN = join(HERE, "fixtures", "index-timeline-pairs.golden.json");
const WRITE = process.env["VF_WRITE_GOLDENS"] === "1";
const WRITE_COMMAND = [
  "VF_WRITE_GOLDENS=1 pnpm --filter @vibefield/fieldd exec vitest run",
  "test/index-timeline-pairs.test.ts",
].join(" ");
const ROSETTA_PAGE = join(
  HERE,
  "..",
  "..",
  "contracts",
  "fixtures",
  "index-timeline-page.rosetta-26.json",
);

type Dict = Record<string, unknown>;

interface TimelinePairCase {
  name: string;
  /** a tool row rosetta's reader refuses: a `tool_use` row with no line to draw */
  refused?: true;
  entry: Dict;
  row: IndexTimelineRow;
}

interface TimelinePairStep {
  at: string;
  /** the entries this step changed or added, as rosetta's client holds them after its patch */
  upserts: Dict[];
  /** the whole session's projection after the step, by ordinal then timelineId */
  rows: IndexTimelineRow[];
}

interface TimelinePairs {
  "//": string;
  limits: { textChars: number; objectChars: number };
  cases: TimelinePairCase[];
  steps: TimelinePairStep[];
}

const HEADER = [
  "SP-7b's 7b-2a: rosetta's TimelineEntry beside fieldd's IndexTimelineRow",
  "(src/index-timeline.ts). `cases` pair one entry with its row; `steps` are one session as",
  "rosetta's client hands it, and re-projecting a step's `upserts` over the step before lands",
  `on its \`rows\`. Written by \`${WRITE_COMMAND}\`; never by hand.`,
].join(" ");

const inline = (text: string) => ({ type: "inline", text });

/** A rosetta `TimelineEntry` with every member rosetta writes, as `index-timeline.test.ts`'s. */
function entry(sessionId: string, id: string, ordinal: number, body: Dict, over: Dict = {}): Dict {
  const human = body["type"] === "user";
  return {
    timeline_id: id,
    session_id: sessionId,
    ordinal,
    group: {
      id: `turn-${Math.floor(ordinal / 10)}`,
      kind: human ? "human_turn" : "agent_cycle",
      derivation: "native",
    },
    response: human ? null : { id: `response-${Math.floor(ordinal / 10)}`, derivation: "native" },
    block_index: null,
    native_id: null,
    parent_native_id: null,
    at: 1_790_000_000_000 + ordinal * 1_000,
    model: human ? null : "claude-opus-5",
    effort: null,
    body,
    parent_tool_native_id: null,
    usage: null,
    cost: null,
    provenance: { agent_version: "2.1.241", src_cursor: 1, src_offset: ordinal },
    ...over,
  };
}

/** A `tool_use` body: rosetta's `ToolInteraction` with `action`, succeeded, untimed. */
function tool(name: string, action: Dict, over: Dict = {}): Dict {
  return {
    type: "tool_use",
    tool: {
      correlation: { key: `toolu_${name}`, derivation: "native_id" },
      native: { id: `toolu_${name}`, name, namespace: null, provider: null },
      status: { value: "succeeded", basis: "native_terminal_record" },
      action,
      failure: null,
      timing: null,
      ...over,
    },
  };
}

const file = (path: string) => ({ type: "file", path });

const image = {
  id: "img-1",
  kind: "image",
  label: null,
  name: "shot.png",
  media_type: "image/png",
  byte_len: 1234,
  // the asset's address on rosettad never crosses (EL2, EL7): the row carries no url
  source: {
    type: "asset",
    asset: { url: "/api/assets/abc.png", digest: "abc", media_type: "image/png", byte_len: 1234 },
  },
  dimensions: null,
  message_ranges: [],
};
const unrecorded = {
  id: "doc-1",
  kind: "document",
  label: "notes",
  name: null,
  media_type: null,
  byte_len: null,
  source: { type: "unavailable", reason: "not_recorded" },
  dimensions: null,
  message_ranges: [],
};
const reference = {
  id: "file-1",
  kind: "file",
  label: null,
  name: "README.md",
  media_type: "text/markdown",
  byte_len: null,
  source: { type: "reference", path: "/Users/someone/repo/README.md" },
  dimensions: null,
  message_ranges: [],
};

/** The hand cases, by name: every branch `projectTimelineRow` reads. */
function handCases(): Array<{ name: string; refused?: true; body: Dict; over?: Dict }> {
  const shell = (command: string, outcome: Dict | null) => ({
    type: "shell",
    command: inline(command),
    cwd: null,
    timeout_ms: null,
    background: false,
    outcome,
  });
  return [
    {
      name: "user: inline words; an asset, an unrecorded doc, a reference; an unreadable one gone",
      body: {
        type: "user",
        text: inline("fix the build"),
        attachments: [image, unrecorded, reference, { kind: "file", source: { type: "asset" } }],
      },
    },
    {
      name: "agent: a member text is its preview with the whole's size; no attachments is none",
      body: {
        type: "agent",
        text: { type: "member", preview: "The first lines of a long reply", byte_len: 48_213 },
        attachments: [],
        citations: [],
      },
    },
    {
      name: "agent: a member text with no preview carries no words",
      body: { type: "agent", text: { type: "member", byte_len: 9_000 }, attachments: [] },
    },
    {
      name: "agent: words past TEXT_CHARS are cut there, and textClipped says so",
      body: { type: "agent", text: inline("x".repeat(INDEX_TIMELINE.TEXT_CHARS + 500)) },
    },
    {
      name: "agent: a cut that would split a surrogate pair drops its high half",
      body: {
        type: "agent",
        text: inline(`${"a".repeat(INDEX_TIMELINE.TEXT_CHARS - 1)}\u{1f600} and after`),
      },
    },
    {
      name: "agent: a text of a shape this build never heard of carries no words",
      body: { type: "agent", text: { type: "hologram", text: "unseen" }, attachments: [] },
    },
    { name: "thinking: inline words", body: { type: "thinking", text: inline("the lean") } },
    {
      name: "summary: its purpose and its words",
      body: { type: "summary", purpose: "compaction", text: inline("the story so far") },
    },
    {
      name: "notice: a command's output is its words",
      body: {
        type: "notice",
        notice: { type: "command_output", command: "/cost", output: inline("$0.42 so far") },
      },
    },
    {
      name: "notice: a runtime error's summary",
      body: { type: "notice", notice: { type: "runtime_error", summary: "the socket closed" } },
    },
    {
      name: "notice: an async task's summary",
      body: { type: "notice", notice: { type: "async_task", summary: "the build finished" } },
    },
    {
      name: "notice: a compaction's reason",
      body: { type: "notice", notice: { type: "compaction", reason: "the context was full" } },
    },
    {
      name: "notice: a kind this build never heard of carries its kind alone",
      body: { type: "notice", notice: { type: "model_changed", from: null, to: "claude-opus-5" } },
    },
    {
      name: "collaboration: the event's summary",
      body: { type: "collaboration", event: { type: "message", summary: "a teammate's note" } },
    },
    {
      name: "collaboration: no summary is the event's body, with its attachments",
      body: {
        type: "collaboration",
        event: { type: "message", body: inline("see the shot"), attachments: [image] },
      },
    },
    { name: "a body kind this build never heard of: its kind, no words", body: { type: "aurora" } },
    {
      name: "the row's facts: its usage read, a priced cost, its effort and response",
      body: { type: "agent", text: inline("done"), attachments: [] },
      over: {
        effort: "high",
        usage: { input: 10, output: 5, cache_read: 3, cache_write: null, thinking: 2 },
        cost: { status: "priced", micro_usd: 175, long_context: false },
      },
    },
    {
      name: "the row's facts: an unread usage, an unpriced cost: neither; no time, no model",
      body: { type: "agent", text: inline("done"), attachments: [] },
      over: {
        at: null,
        model: null,
        response: null,
        usage: { input: null, output: null, cache_read: null, cache_write: null, thinking: null },
        cost: { status: "unpriced", reason: "unknown_model" },
      },
    },
    {
      name: "tool shell: the command's first line and its exit; a duration from start and end",
      body: tool("Bash", shell("pnpm test\nsecond line", { exit_code: 0, signal: null }), {
        timing: { started_at: 1_000, completed_at: 3_500, duration_ms: null },
      }),
    },
    {
      name: "tool shell: a signal when there is no exit; interrupted is failed",
      body: tool("Bash", shell("sleep 100", { exit_code: null, signal: "SIGTERM" }), {
        status: { value: "interrupted", basis: "native_terminal_record" },
      }),
    },
    {
      name: "tool shell: an object past OBJECT_CHARS is cut, and objectClipped says so",
      body: tool("Bash", shell(`echo ${"y".repeat(INDEX_TIMELINE.OBJECT_CHARS + 100)}`, null)),
    },
    {
      name: "tool code_execute: its code; a failure's summary; the stated duration wins",
      body: tool(
        "python",
        { type: "code_execute", code: inline("print(1/0)"), outcome: { exit_code: 1 } },
        {
          status: { value: "failed", basis: "native_terminal_record" },
          failure: { kind: "nonzero_exit", summary: "ZeroDivisionError" },
          timing: { started_at: 1_000, completed_at: 9_000, duration_ms: 420 },
        },
      ),
    },
    {
      name: "tool denied: a failure with no summary is its kind",
      body: tool(
        "Write",
        { type: "file_change", changes: [] },
        {
          status: { value: "denied", basis: "permission" },
          failure: { kind: "permission_denied", summary: null },
        },
      ),
    },
    {
      name: "tool file_read: the first target, and how many when more than one",
      body: tool("Read", {
        type: "file_read",
        targets: [{ resource: file("src/a.ts") }, { resource: file("src/b.ts") }],
      }),
    },
    {
      name: "tool file_list: its directory and one entry",
      body: tool("LS", {
        type: "file_list",
        directory: { type: "directory", path: "src" },
        outcome: { entry_count: 1 },
      }),
    },
    {
      name: "tool file_search: its query and its matches",
      body: tool("Grep", { type: "file_search", query: "restUrl", outcome: { match_count: 12 } }),
    },
    {
      name: "tool code_lookup: its query and its locations",
      body: tool("LSP", { type: "code_lookup", query: "projectTool", outcome: { total_count: 3 } }),
    },
    {
      name: "tool web_search: its query and one source",
      body: tool("WebSearch", {
        type: "web_search",
        query: "rosetta swift",
        outcome: { total_count: 1 },
      }),
    },
    {
      name: "tool tool_discovery: its query and the action's own count",
      body: tool("ToolSearch", { type: "tool_discovery", query: "docs", total_count: 4 }),
    },
    {
      name: "tool file_change: one file counted is its lines added and removed",
      body: tool("Edit", {
        type: "file_change",
        changes: [{ path: file("src/x.ts"), lines_added: 3, lines_removed: 1 }],
      }),
    },
    {
      name: "tool file_change: more than one file is how many",
      body: tool("MultiEdit", {
        type: "file_change",
        changes: [
          { path: file("src/x.ts"), lines_added: 3, lines_removed: 0 },
          { path: file("src/y.ts"), lines_added: 0, lines_removed: 2 },
        ],
      }),
    },
    {
      name: "tool file_change: an uncounted change is its path alone",
      body: tool("Write", {
        type: "file_change",
        changes: [{ path: file("src/new.ts"), lines_added: null, lines_removed: null }],
      }),
    },
    {
      name: "tool web_fetch: its URL and its HTTP status",
      body: tool("WebFetch", {
        type: "web_fetch",
        url: { type: "url", url: "https://example.com/a" },
        outcome: { http_status: 200 },
      }),
    },
    {
      name: "tool web_navigate: a pattern when there is no URL",
      body: tool("Navigate", { type: "web_navigate", url: null, pattern: "*.example.com" }),
    },
    {
      name: "tool delegate: its name",
      body: tool("Agent", { type: "delegate", name: "reviewer", objective: inline("review it") }),
    },
    {
      name: "tool workflow: its objective's first line when there is no name",
      body: tool("Workflow", { type: "workflow", objective: inline("Ship it\nthen the records") }),
    },
    {
      name: "tool schedule: its reason when there is neither name nor objective",
      body: tool("Cron", { type: "schedule", reason: "nightly" }),
    },
    {
      name: "tool task: its subject and its status",
      body: tool("Task", { type: "task", subject: "Write the pairs", status: "in_progress" }),
    },
    {
      name: "tool task: its description's first line when there is no subject",
      body: tool("Task", { type: "task", description: inline("Port the projection\nin Swift") }),
    },
    { name: "tool plan: its title", body: tool("Plan", { type: "plan", title: "The plan" }) },
    {
      name: "tool artifact: its name when there is no title",
      body: tool("Artifact", { type: "artifact", name: "page.html" }),
    },
    { name: "tool skill: its name", body: tool("Skill", { type: "skill", name: "pdf" }) },
    {
      name: "tool question: the first question's first line",
      body: tool("Ask", {
        type: "question",
        questions: [{ prompt: inline("Which lean?\n(a) or (b)") }, { prompt: inline("And?") }],
      }),
    },
    {
      name: "tool notification: its summary",
      body: tool("Notify", { type: "notification", summary: inline("Build done") }),
    },
    {
      name: "tool external: its operation and its subject",
      body: tool("mcp__gh__issue", { type: "external", operation: "create_issue", subject: "#1" }),
    },
    {
      name: "tool external: an operation alone",
      body: tool("mcp__gh__list", { type: "external", operation: "list_issues" }),
    },
    {
      name: "tool process: its process and its state",
      body: tool("Output", { type: "process", process_id: "p-7", outcome: { state: "running" } }),
    },
    { name: "tool mode: the mode", body: tool("ExitPlanMode", { type: "mode", mode: "default" }) },
    {
      name: "tool finding: how many findings",
      body: tool("Review", { type: "finding", total_count: 2 }),
    },
    {
      name: "tool orchestration: one child",
      body: tool("Fleet", { type: "orchestration", executed_child_count: 1 }),
    },
    {
      name: "tool: a family this build never heard of carries neither object nor result",
      body: tool("Telepathy", { type: "telepathy", thought: "unseen" }),
    },
    {
      name: "tool: its own attachments, as refs",
      body: tool("Capture", { type: "external", operation: "capture" }, { attachments: [image] }),
    },
    {
      name: "tool: one rosetta's reader refuses is a tool_use row with no line",
      refused: true,
      body: { type: "tool_use", tool: { status: { value: "running" }, action: { type: "shell" } } },
    },
  ];
}

/** The one live session: its snapshot, then what the client hands after each change. */
function liveSteps(): Array<{ at: string; upserts: Dict[] }> {
  const s = "s-live";
  const running = tool(
    "Bash",
    { type: "shell", command: inline("pnpm build"), outcome: null },
    {
      status: { value: "running", basis: "native_progress" },
      timing: { started_at: 1_790_000_003_000, completed_at: null, duration_ms: null },
    },
  );
  const done = tool(
    "Bash",
    { type: "shell", command: inline("pnpm build"), outcome: { exit_code: 0, signal: null } },
    { timing: { started_at: 1_790_000_003_000, completed_at: 1_790_000_007_500 } },
  );
  const reply = (text: string) => ({ type: "agent", text: inline(text), attachments: [] });
  const usage = {
    input: 1_200,
    output: 80,
    cache_read: 900,
    cache_write: null,
    thinking: null,
    scope: "request",
  };
  const priced = { status: "priced", micro_usd: 3_150, long_context: false };
  return [
    {
      at: "open",
      upserts: [
        entry(s, "l1", 1, { type: "user", text: inline("fix the build"), attachments: [] }),
        entry(s, "l2", 2, { type: "thinking", text: inline("the build first") }),
        entry(s, "l3", 3, running),
        entry(s, "l4", 4, reply("Looking")),
      ],
    },
    { at: "tool_updated: the build finished", upserts: [entry(s, "l3", 3, done)] },
    {
      at: "usage: the reply's usage and its cost",
      upserts: [entry(s, "l4", 4, reply("Looking"), { usage, cost: priced })],
    },
    {
      at: "message: the reply whole, and a new row after it",
      upserts: [
        entry(s, "l4", 4, reply("Looking. The build is green."), { usage, cost: priced }),
        entry(s, "l5", 5, reply("Anything else?")),
      ],
    },
  ];
}

const byOrder = (a: IndexTimelineRow, b: IndexTimelineRow) =>
  a.ordinal - b.ordinal || a.timelineId.localeCompare(b.timelineId);

/** One entry through rosetta's reader (the contracts', strict on identity) and the projection. */
function projectEntry(raw: Dict): IndexTimelineRow {
  return projectTimelineRow(IndexTimelineEntryRow.parse(raw));
}

/** The rows after `upserts` over `before`, re-projecting ONLY the upserted rows (D-2c (a)). */
function rowsAfter(before: readonly IndexTimelineRow[], upserts: readonly Dict[]) {
  const rows = new Map(before.map((row) => [row.timelineId, row]));
  for (const raw of upserts) {
    const row = projectEntry(raw);
    rows.set(row.timelineId, row);
  }
  return [...rows.values()].sort(byOrder);
}

function computeTimelinePairs(): TimelinePairs {
  const hand = handCases().map((c, index) => {
    const id = `c${String(index + 1).padStart(2, "0")}`;
    const raw = entry("s-pairs", id, index + 1, c.body, c.over);
    return { name: c.name, ...(c.refused ? { refused: c.refused } : {}), entry: raw };
  });
  // rosetta's entries as rosetta wrote them: a parse would reorder their members
  const page = JSON.parse(readFileSync(ROSETTA_PAGE, "utf8")) as { entries: Dict[] };
  IndexTimelinePageResponse.parse(page);
  const rosetta = page.entries.map((raw) => ({
    name: `rosetta's page golden (rosetta-26): ${String(raw["timeline_id"])}`,
    entry: raw,
  }));
  const cases = [...hand, ...rosetta].map((c) => ({ ...c, row: projectEntry(c.entry) }));
  // each step's rows are the WHOLE table projected, never the incremental path the test checks
  const table = new Map<string, Dict>();
  const steps = liveSteps().map(({ at, upserts }) => {
    for (const raw of upserts) table.set(String(raw["timeline_id"]), raw);
    return { at, upserts, rows: [...table.values()].map(projectEntry).sort(byOrder) };
  });
  return {
    "//": HEADER,
    limits: { textChars: INDEX_TIMELINE.TEXT_CHARS, objectChars: INDEX_TIMELINE.OBJECT_CHARS },
    cases,
    steps,
  };
}

/** The golden's bytes: two-space JSON and a final newline, so a diff reads by member. */
function timelinePairsBytes(pairs: TimelinePairs): string {
  return `${JSON.stringify(pairs, null, 2)}\n`;
}

const PAIRS = computeTimelinePairs();

describe("SP-7b's 7b-2a — the projection's golden pairs, which the kit's Swift port is held to", () => {
  it("the committed pairs are byte for byte what the projection writes now (a regeneration is a re-bless)", () => {
    const bytes = timelinePairsBytes(PAIRS);
    if (WRITE) {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, bytes);
    }
    // an absent golden says what to run, never a bare ENOENT
    expect(existsSync(GOLDEN), `the pairs are not committed: run ${WRITE_COMMAND}`).toBe(true);
    expect(
      readFileSync(GOLDEN, "utf8"),
      [
        "the pairs are not what the projection writes now. If the move is meant, run",
        WRITE_COMMAND,
        "and name the case or step that moved, and why, in the commit body",
      ].join(" "),
    ).toBe(bytes);
  });

  it("every entry is one rosetta's reader admits, each name is one pair, and a tool row draws its line", () => {
    expect(PAIRS.cases.length).toBeGreaterThan(50);
    expect(new Set(PAIRS.cases.map((c) => c.name)).size, "the port pairs by name").toBe(
      PAIRS.cases.length,
    );
    for (const c of PAIRS.cases) {
      expect(IndexTimelineEntryRow.safeParse(c.entry).success, c.name).toBe(true);
      // a hand tool entry the reader refused would pin a pair with no line: only the one meant to
      if (c.row.kind === "tool_use")
        expect(c.row.tool === undefined, c.name).toBe(c.refused === true);
    }
  });

  it("a step re-projects only its upserts over the step before, and lands where the whole table does", () => {
    expect(PAIRS.steps.map((step) => step.at)[0]).toBe("open");
    let rows: IndexTimelineRow[] = [];
    for (const step of PAIRS.steps) {
      const before = rows;
      rows = rowsAfter(before, step.upserts);
      expect(rows, step.at).toEqual(step.rows);
      expect(rows, `${step.at} moves the session`).not.toEqual(before);
    }
  });
});
