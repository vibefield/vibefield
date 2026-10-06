// SP-6 (2026-10-04) — one timeline row, PROJECTED: rosetta's `TimelineEntry`
// (read against the contracts' snake_case readers, never cast) into the door's
// `IndexTimelineRow` — what a transcript's list draws and nothing a radio has
// no use for. The same projection serves the page door (`index.timeline`) and
// the tail (`index.session.subscribe`), so a row reads the same whichever way
// it arrived.
//
// Every read below is TOLERANT: the body's members are read by `typeof`, a
// shape this build never heard of yields a row of its kind with no text, and
// nothing here throws on a body — the reader that admitted the row (the
// contracts' `IndexTimelineEntryRow`) is the only gate, and it is strict about
// identity (`timeline_id`, `session_id`, `ordinal`) and nothing else.
//
// What never crosses: an asset's bytes, an asset's address on rosettad
// (`AssetRef.url` is not read — EL2, EL7), a citation's source, a tool's
// diagnostic text beyond its summary, the raw-ledger provenance.
import {
  INDEX_TIMELINE,
  type IndexTimelineAttachment,
  IndexTimelineAttachmentRow,
  type IndexTimelineEntryRow,
  type IndexTimelineRow,
  IndexTimelineTextRow,
  type IndexTimelineTool,
  IndexTimelineToolRow,
  type IndexTimelineUsage,
} from "@vibefield/contracts";

/** rosetta's `ToolStatus` values that did not complete the tool's work —
 * `failed` on the ledger line (the room's `ledgerState`, transcribed). */
const FAILED_STATUSES: ReadonlySet<string> = new Set([
  "failed",
  "denied",
  "timed_out",
  "cancelled",
  "interrupted",
]);

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict => typeof value === "object" && value !== null;
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;
const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** A text cut at `max` UTF-16 units, never through a surrogate pair. */
export function clipText(text: string, max: number): { text: string; clipped: boolean } {
  if (text.length <= max) return { text, clipped: false };
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  // a lone high surrogate at the cut is half a character: drop it
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return { text: cut, clipped: true };
}

/** rosetta `CanonicalText` as words: an `inline` text, or a `member`'s
 * preview with the whole's size. Anything else is no text. */
export function textOf(value: unknown): { text: string; byteLen?: number } | undefined {
  const parsed = IndexTimelineTextRow.safeParse(value);
  if (!parsed.success) return undefined;
  const row = parsed.data;
  if (row.type === "inline") return typeof row.text === "string" ? { text: row.text } : undefined;
  if (row.type === "member") {
    if (typeof row.preview !== "string") return undefined;
    return typeof row.byte_len === "number"
      ? { text: row.preview, byteLen: row.byte_len }
      : { text: row.preview };
  }
  return undefined;
}

/** The first line of a text, trimmed — what a ledger line's object is. */
function firstLine(text: string): string {
  const nl = text.indexOf("\n");
  return (nl === -1 ? text : text.slice(0, nl)).trim();
}

/** rosetta `ResourceRef` as a label: the path, the URL, the id. */
function resourceLabel(ref: unknown): string | undefined {
  if (!isDict(ref)) return undefined;
  switch (ref["type"]) {
    case "file":
    case "directory":
      return str(ref["path"]);
    case "url":
      return str(ref["url"]);
    case "session":
    case "task":
    case "process":
      return str(ref["id"]);
    case "asset": {
      const asset = ref["asset"];
      return isDict(asset) ? (str(asset["media_type"]) ?? "asset") : "asset";
    }
    default:
      return undefined;
  }
}

/** One attachment as a REF (the contract's `IndexTimelineAttachment`); an
 * unreadable one is dropped, which is the array-shaped tolerance. */
export function projectAttachment(value: unknown): IndexTimelineAttachment | undefined {
  const parsed = IndexTimelineAttachmentRow.safeParse(value);
  if (!parsed.success) return undefined;
  const row = parsed.data;
  const unavailable = row.source.type === "unavailable";
  const name = str(row.name) ?? str(row.label);
  const mediaType = str(row.media_type);
  const byteLen = num(row.byte_len);
  const reason = unavailable ? str(row.source.reason) : undefined;
  return {
    id: row.id,
    kind: row.kind,
    ...(name !== undefined ? { name } : {}),
    ...(mediaType !== undefined ? { mediaType } : {}),
    ...(byteLen !== undefined ? { byteLen } : {}),
    available: !unavailable,
    ...(reason !== undefined ? { reason } : {}),
  };
}

function projectAttachments(value: unknown): IndexTimelineAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const refs: IndexTimelineAttachment[] = [];
  for (const item of value) {
    const ref = projectAttachment(item);
    if (ref !== undefined) refs.push(ref);
  }
  return refs.length === 0 ? undefined : refs;
}

const count = (n: number | undefined, one: string, many: string): string | undefined =>
  n === undefined ? undefined : `${n} ${n === 1 ? one : many}`;

/** The one object a tool acted on and its result in a few words, by the
 * action's family (rosetta `ToolAction.type`) — the room's vocabulary
 * transcribed to what a phone's ladder line draws. Unknown families carry
 * neither, honestly. */
function actionFacts(action: Dict): { object?: string; result?: string } {
  const family = action["type"];
  const outcome = isDict(action["outcome"]) ? action["outcome"] : undefined;
  switch (family) {
    case "shell":
    case "code_execute": {
      const source = textOf(family === "shell" ? action["command"] : action["code"]);
      const exit = num(outcome?.["exit_code"]);
      const signal = str(outcome?.["signal"]);
      return {
        ...(source !== undefined ? { object: firstLine(source.text) } : {}),
        ...(exit !== undefined
          ? { result: `exit ${exit}` }
          : signal !== undefined
            ? { result: signal }
            : {}),
      };
    }
    case "file_read": {
      const targets = Array.isArray(action["targets"]) ? action["targets"] : [];
      const first = isDict(targets[0]) ? resourceLabel(targets[0]["resource"]) : undefined;
      return {
        ...(first !== undefined ? { object: first } : {}),
        ...(targets.length > 1 ? { result: `${targets.length} files` } : {}),
      };
    }
    case "file_list": {
      const object = resourceLabel(action["directory"]);
      const result = count(num(outcome?.["entry_count"]), "entry", "entries");
      return { ...(object ? { object } : {}), ...(result ? { result } : {}) };
    }
    case "file_search":
    case "code_lookup":
    case "web_search":
    case "tool_discovery": {
      const object = str(action["query"]);
      const total =
        family === "file_search"
          ? count(num(outcome?.["match_count"]), "match", "matches")
          : family === "code_lookup"
            ? count(num(outcome?.["total_count"]), "location", "locations")
            : family === "web_search"
              ? count(num(outcome?.["total_count"]), "source", "sources")
              : count(num(action["total_count"]), "tool", "tools");
      return { ...(object ? { object } : {}), ...(total ? { result: total } : {}) };
    }
    case "file_change": {
      const changes = Array.isArray(action["changes"]) ? action["changes"] : [];
      const first = isDict(changes[0]) ? resourceLabel(changes[0]["path"]) : undefined;
      let added = 0;
      let removed = 0;
      let counted = false;
      for (const change of changes) {
        if (!isDict(change)) continue;
        const a = num(change["lines_added"]);
        const r = num(change["lines_removed"]);
        if (a !== undefined || r !== undefined) counted = true;
        added += a ?? 0;
        removed += r ?? 0;
      }
      const result =
        changes.length > 1
          ? `${changes.length} files`
          : counted
            ? [added > 0 ? `+${added}` : "", removed > 0 ? `−${removed}` : ""]
                .filter((part) => part !== "")
                .join(" ")
            : undefined;
      return {
        ...(first !== undefined ? { object: first } : {}),
        ...(result !== undefined && result !== "" ? { result } : {}),
      };
    }
    case "web_fetch":
    case "web_navigate": {
      const object = resourceLabel(action["url"]) ?? str(action["pattern"]);
      const status = num(outcome?.["http_status"]);
      return {
        ...(object ? { object } : {}),
        ...(status !== undefined ? { result: `${status}` } : {}),
      };
    }
    case "delegate":
    case "workflow":
    case "schedule": {
      const object =
        str(action["name"]) ?? textOf(action["objective"])?.text ?? str(action["reason"]);
      return object !== undefined ? { object: firstLine(object) } : {};
    }
    case "task": {
      const object = str(action["subject"]) ?? textOf(action["description"])?.text;
      const status = str(action["status"]);
      return {
        ...(object !== undefined ? { object: firstLine(object) } : {}),
        ...(status !== undefined ? { result: status } : {}),
      };
    }
    case "plan":
    case "artifact":
    case "skill": {
      const object = str(action["title"]) ?? str(action["name"]);
      return object !== undefined ? { object } : {};
    }
    case "question": {
      const questions = Array.isArray(action["questions"]) ? action["questions"] : [];
      const prompt = isDict(questions[0]) ? textOf(questions[0]["prompt"])?.text : undefined;
      return prompt !== undefined ? { object: firstLine(prompt) } : {};
    }
    case "notification": {
      const summary = textOf(action["summary"])?.text;
      return summary !== undefined ? { object: firstLine(summary) } : {};
    }
    case "external": {
      const operation = str(action["operation"]);
      const subject = str(action["subject"]);
      return operation !== undefined
        ? { object: subject !== undefined ? `${operation} ${subject}` : operation }
        : {};
    }
    case "process": {
      const object = str(action["process_id"]);
      const state = str(outcome?.["state"]);
      return { ...(object ? { object } : {}), ...(state ? { result: state } : {}) };
    }
    case "mode": {
      const mode = str(action["mode"]);
      return mode !== undefined ? { object: mode } : {};
    }
    case "finding": {
      const result = count(num(action["total_count"]), "finding", "findings");
      return result !== undefined ? { result } : {};
    }
    case "orchestration": {
      const result = count(num(action["executed_child_count"]), "child", "children");
      return result !== undefined ? { result } : {};
    }
    default:
      return {};
  }
}

/** A tool interaction's facts; undefined when rosetta's own reader refuses it
 * (the row is still a `tool_use` row, with no line to draw). */
export function projectTool(value: unknown): IndexTimelineTool | undefined {
  const parsed = IndexTimelineToolRow.safeParse(value);
  if (!parsed.success) return undefined;
  const tool = parsed.data;
  const failure = tool.failure ?? null;
  const facts = actionFacts(tool.action as Dict);
  const object =
    facts.object === undefined ? undefined : clipText(facts.object, INDEX_TIMELINE.OBJECT_CHARS);
  const failureText =
    failure === null ? undefined : (str(failure.summary) ?? str(failure.kind) ?? undefined);
  const failureClipped =
    failureText === undefined ? undefined : clipText(failureText, INDEX_TIMELINE.OBJECT_CHARS);
  const timing = tool.timing ?? null;
  const started = num(timing?.started_at);
  const completed = num(timing?.completed_at);
  const durationMs =
    num(timing?.duration_ms) ??
    (started !== undefined && completed !== undefined && completed >= started
      ? completed - started
      : undefined);
  const attachments = projectAttachments(tool.attachments);
  return {
    name: tool.native.name,
    family: tool.action.type,
    status: tool.status.value,
    failed: FAILED_STATUSES.has(tool.status.value) || failure !== null,
    ...(failureClipped !== undefined ? { failure: failureClipped.text } : {}),
    ...(object !== undefined ? { object: object.text } : {}),
    ...(object?.clipped ? { objectClipped: true } : {}),
    ...(facts.result !== undefined ? { result: facts.result } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(attachments !== undefined ? { attachments } : {}),
  };
}

function projectUsage(row: IndexTimelineEntryRow["usage"]): IndexTimelineUsage | undefined {
  if (row === null || row === undefined) return undefined;
  const usage: IndexTimelineUsage = {
    ...(num(row.input) !== undefined ? { input: num(row.input) } : {}),
    ...(num(row.output) !== undefined ? { output: num(row.output) } : {}),
    ...(num(row.cache_read) !== undefined ? { cacheRead: num(row.cache_read) } : {}),
    ...(num(row.cache_write) !== undefined ? { cacheWrite: num(row.cache_write) } : {}),
    ...(num(row.thinking) !== undefined ? { thinking: num(row.thinking) } : {}),
  };
  return Object.keys(usage).length === 0 ? undefined : usage;
}

/** The words of a body, by its kind: a prompt's or reply's text, a thought, a
 * summary, a notice's own text (a command's output, a runtime error's
 * summary, an async task's summary, a compaction's reason), a collaboration's
 * summary or body. Undefined when the kind carries none — a tool row. */
function bodyText(body: Dict): { text: string; byteLen?: number } | undefined {
  switch (body["type"]) {
    case "user":
    case "agent":
    case "thinking":
    case "summary":
      return textOf(body["text"]);
    case "notice": {
      const notice = isDict(body["notice"]) ? body["notice"] : undefined;
      if (notice === undefined) return undefined;
      switch (notice["type"]) {
        case "command_output":
          return textOf(notice["output"]);
        case "runtime_error":
        case "async_task": {
          const summary = str(notice["summary"]);
          return summary === undefined ? undefined : { text: summary };
        }
        case "compaction": {
          const reason = str(notice["reason"]);
          return reason === undefined ? undefined : { text: reason };
        }
        default:
          return undefined;
      }
    }
    case "collaboration": {
      const event = isDict(body["event"]) ? body["event"] : undefined;
      if (event === undefined) return undefined;
      const summary = str(event["summary"]);
      return summary !== undefined ? { text: summary } : textOf(event["body"]);
    }
    default:
      return undefined;
  }
}

function bodyAttachments(body: Dict): IndexTimelineAttachment[] | undefined {
  switch (body["type"]) {
    case "user":
    case "agent":
      return projectAttachments(body["attachments"]);
    case "collaboration": {
      const event = isDict(body["event"]) ? body["event"] : undefined;
      return event === undefined ? undefined : projectAttachments(event["attachments"]);
    }
    default:
      return undefined;
  }
}

/** One of rosetta's rows as the door answers it. */
export function projectTimelineRow(entry: IndexTimelineEntryRow): IndexTimelineRow {
  const body = entry.body as Dict;
  const kind = entry.body.type;
  const words = bodyText(body);
  const text = words === undefined ? undefined : clipText(words.text, INDEX_TIMELINE.TEXT_CHARS);
  const attachments = bodyAttachments(body);
  const tool = kind === "tool_use" ? projectTool(body["tool"]) : undefined;
  const notice =
    kind === "notice" && isDict(body["notice"]) ? str(body["notice"]["type"]) : undefined;
  const summaryPurpose = kind === "summary" ? str(body["purpose"]) : undefined;
  const usage = projectUsage(entry.usage);
  const cost = entry.cost ?? null;
  const costMicroUsd = cost !== null && cost.status === "priced" ? num(cost.micro_usd) : undefined;
  const at = num(entry.at);
  const model = str(entry.model);
  const effort = str(entry.effort);
  const responseId = entry.response === null ? undefined : entry.response?.id;
  return {
    timelineId: entry.timeline_id,
    sessionId: entry.session_id,
    ordinal: entry.ordinal,
    kind,
    ...(at !== undefined ? { at } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(effort !== undefined ? { effort } : {}),
    group: { id: entry.group.id, kind: entry.group.kind },
    ...(responseId !== undefined ? { responseId } : {}),
    ...(text !== undefined ? { text: text.text } : {}),
    ...(text?.clipped ? { textClipped: true } : {}),
    ...(words?.byteLen !== undefined ? { textByteLen: words.byteLen } : {}),
    ...(attachments !== undefined ? { attachments } : {}),
    ...(tool !== undefined ? { tool } : {}),
    ...(notice !== undefined ? { notice } : {}),
    ...(summaryPurpose !== undefined ? { summaryPurpose } : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(costMicroUsd !== undefined ? { costMicroUsd } : {}),
  };
}

/** The newest `bound` rows of a table ordered by ordinal (a tailnet
 * subscriber's snapshot); the whole table when it fits. */
export function newestRows(rows: readonly IndexTimelineRow[], bound: number): IndexTimelineRow[] {
  if (rows.length <= bound) return [...rows];
  const sorted = [...rows].sort(
    (a, b) => a.ordinal - b.ordinal || a.timelineId.localeCompare(b.timelineId),
  );
  return sorted.slice(sorted.length - bound);
}
