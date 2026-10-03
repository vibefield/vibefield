// Two registers from ONE verdict object (P8-D8): NDJSON for whatever is going
// to branch on the answer, a table for whoever is going to read it. Neither is
// generated from the other's text — both project the same records, so the
// human line can never say something the machine line does not.
import type { RunResult, Verdict } from "./verdict";

export function toNdjson(result: RunResult): string {
  return [...result.verdicts, result.summary].map((v) => `${JSON.stringify(v)}\n`).join("");
}

const MARK: Record<string, string> = { pass: "PASS", note: "SKIP", refused: "FAIL" };

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/** The short name a reader actually scans for: the plugin id prefix is on every
 * row and carries no information once the header has said it. */
function shortType(type: string, plugin: string): string {
  return type === plugin
    ? type
    : type.startsWith(`${plugin}.`)
      ? type.slice(plugin.length + 1)
      : type;
}

interface Row {
  readonly mark: string;
  readonly type: string;
  readonly state: string;
  readonly note: string;
  /** the pointer/expected/console lines that belong UNDER this row */
  readonly under: readonly string[];
}

function rowsOf(result: RunResult): Row[] {
  const { plugin } = result.summary;
  const rows: Row[] = [];
  for (const v of result.verdicts) {
    if (v.kind === "summary") continue;
    if (v.kind === "object") {
      // DK-5: an object kind is LISTED — its export, its declared states, the
      // refusal this build answers (none: the desk draws it). DK-7 judges it.
      rows.push({
        mark: v.refusal === null ? "KIND" : "FAIL",
        type: shortType(v.type, plugin),
        state: "—",
        note: `export ${v.binding} · ${v.states} state${v.states === 1 ? "" : "s"} for the kind harness (DK-7) · refusal: ${v.refusal ?? "none"}`,
        under: [],
      });
      continue;
    }
    const under: string[] = [];
    // Everything a refusal knows goes directly beneath its own row — an author
    // fixing a state should neither re-run with --json to see the pointer nor
    // match it back to a row by eye.
    if (v.status === "refused") {
      if (v.pointer !== undefined) under.push(`at ${v.pointer}`);
      if (v.expected !== undefined) under.push(`expected: ${v.expected}`);
    }
    if (v.kind === "state" && v.consoleErrors !== undefined) {
      for (const line of v.consoleErrors) under.push(`console.error: ${line.split("\n")[0] ?? ""}`);
    }
    rows.push({
      mark: MARK[v.status] ?? v.status.toUpperCase(),
      type: v.kind === "plugin" ? "(plugin)" : shortType(v.type, plugin),
      state: v.kind === "state" ? v.state : "—",
      note:
        v.status === "pass"
          ? (v.detail ?? "")
          : `${"code" in v && v.code !== undefined ? `${v.code}: ` : ""}${v.detail ?? ""}`,
      under,
    });
  }
  return rows;
}

export function toTable(result: RunResult): string {
  const { summary } = result;
  const rows = rowsOf(result);
  const typeWidth = Math.max(6, ...rows.map((r) => r.type.length));
  const stateWidth = Math.max(5, ...rows.map((r) => r.state.length));
  const lines = [`plugin-playground ${summary.plugin}`];
  for (const row of rows) {
    lines.push(
      `  ${row.mark}  ${pad(row.type, typeWidth)}  ${pad(row.state, stateWidth)}  ${row.note}`,
    );
    for (const line of row.under) lines.push(`          ${line}`);
  }
  if (summary.widgets === 0 && summary.objects === 0 && summary.refused === 0) {
    lines.push("  no canvas widgets or objects declared — nothing to judge, and that is a pass");
  }
  lines.push(
    `  ${summary.passed} passed · ${summary.skipped} skipped · ${summary.refused} refused ` +
      `(${summary.widgets} widget${summary.widgets === 1 ? "" : "s"}, ${summary.states} state${summary.states === 1 ? "" : "s"}, ` +
      `${summary.objects} object${summary.objects === 1 ? "" : "s"})`,
  );
  return `${lines.join("\n")}\n`;
}

/** For a caller that wants the rows without the process. */
export function isRefusal(v: Verdict): boolean {
  if (v.kind === "summary") return false;
  return v.kind === "object" ? v.refusal !== null : v.status === "refused";
}
