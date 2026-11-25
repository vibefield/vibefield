// VELA'S WORDS, READ (TH-1; TH-Q35 (a); DESIGN.md §8 "Chat's thread", Vela's words). An agent's text is the
// adversary's (EL7), so it is never markup: it is read here into plain data — paragraphs and their line breaks, bold
// and italic, inline code, fenced code, lists and quotes, a heading as a bold paragraph, a table (Spark QA F1,
// 2026-11-25) — and the view draws every run as text, which React escapes. A link is its words, inert; nothing else is
// read as markup. Pure.

/** A run of words in a line, with how it is drawn. */
export type InlineRun =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "bold"; readonly runs: readonly InlineRun[] }
  | { readonly kind: "italic"; readonly runs: readonly InlineRun[] }
  | { readonly kind: "code"; readonly text: string };

/** One line of a paragraph or a list item, or one cell of a table: its runs. */
export type InlineLine = readonly InlineRun[];

/** A table column's alignment, as the colons of its delimiter cell say it; null, none (the column's start). */
export type CellAlign = "left" | "center" | "right" | null;

export type MarkdownBlock =
  | { readonly kind: "paragraph"; readonly lines: readonly InlineLine[]; readonly strong?: true }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly InlineLine[][] }
  | { readonly kind: "quote"; readonly blocks: readonly MarkdownBlock[] }
  | {
      readonly kind: "table";
      /** one per column: the header's width */
      readonly align: readonly CellAlign[];
      readonly head: readonly InlineLine[];
      /** each as wide as the head: a short row padded with empty cells, a long one cut */
      readonly rows: readonly (readonly InlineLine[])[];
    };

const FENCE = /^\s{0,3}(```|~~~)/u;
const BULLET = /^\s{0,3}[-*+]\s+(.*)$/u;
const NUMBERED = /^\s{0,3}\d{1,9}[.)]\s+(.*)$/u;
const QUOTE = /^\s{0,3}>\s?(.*)$/u;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/u;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/u;

/** Vela's text, as blocks. */
export function markdownBlocksOf(text: string): MarkdownBlock[] {
  return blocksOf(text.replace(/\r\n?/gu, "\n").split("\n"));
}

function blocksOf(lines: readonly string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    if (line.trim() === "" || RULE.test(line)) {
      at += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1] ?? "```";
      const body: string[] = [];
      at += 1;
      while (at < lines.length && !(lines[at] ?? "").trimStart().startsWith(marker)) {
        body.push(lines[at] ?? "");
        at += 1;
      }
      at += 1; // the closing fence, or the text's end
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (at < lines.length && QUOTE.test(lines[at] ?? "")) {
        body.push(QUOTE.exec(lines[at] ?? "")?.[1] ?? "");
        at += 1;
      }
      blocks.push({ kind: "quote", blocks: blocksOf(body) });
      continue;
    }
    const bullet = BULLET.test(line);
    if (bullet || NUMBERED.test(line)) {
      const pattern = bullet ? BULLET : NUMBERED;
      const items: InlineLine[][] = [];
      while (at < lines.length) {
        const item = pattern.exec(lines[at] ?? "");
        if (item !== null) {
          items.push([inlineOf(item[1] ?? "")]);
        } else {
          // an indented line continues the item above it
          const next = lines[at] ?? "";
          const last = items[items.length - 1];
          if (last === undefined || !/^\s{2,}\S/u.test(next)) break;
          last.push(inlineOf(next.trim()));
        }
        at += 1;
      }
      blocks.push({ kind: "list", ordered: !bullet, items });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      blocks.push({ kind: "paragraph", lines: [inlineOf(heading[1] ?? "")], strong: true });
      at += 1;
      continue;
    }
    const table = tableAt(lines, at);
    if (table !== null) {
      blocks.push(table.block);
      at = table.end;
      continue;
    }
    const body: InlineLine[] = [];
    while (at < lines.length) {
      const next = lines[at] ?? "";
      // a table's header may follow a paragraph's line with no blank between them
      if (
        next.trim() === "" ||
        startsBlock(next) ||
        (body.length > 0 && tableAt(lines, at) !== null)
      )
        break;
      body.push(inlineOf(next));
      at += 1;
    }
    blocks.push({ kind: "paragraph", lines: body });
  }
  return blocks;
}

/** A delimiter row's cell: dashes, a colon at either end aligning its column. */
const DELIMITER_CELL = /^:?-+:?$/u;

/** One code span in a row, read as `inlineOf` reads one, so a pipe in it divides nothing. */
const ROW_CODE = /`[^`]+`/uy;

/** A table at this line (Spark QA F1, 2026-11-25; GitHub's): its header row, the delimiter row under it with as many
 * cells, then its body rows, down to a blank line, another block, or a line with no pipe. Null when there is none: a
 * line of pipes with no delimiter row under it is a paragraph's. */
function tableAt(
  lines: readonly string[],
  at: number,
): { readonly block: MarkdownBlock; readonly end: number } | null {
  const delimiter = cellsOf(lines[at + 1] ?? "");
  if (delimiter === null || delimiter.length === 0) return null;
  if (!delimiter.every((cell) => DELIMITER_CELL.test(cell))) return null;
  const head = cellsOf(lines[at] ?? "");
  if (head === null || head.length !== delimiter.length) return null;
  const rows: InlineLine[][] = [];
  let end = at + 2;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    const cells = line.trim() === "" || startsBlock(line) ? null : cellsOf(line);
    if (cells === null) break;
    // as wide as the head: padded with empty cells, or cut
    rows.push(head.map((_, column) => inlineOf(cells[column] ?? "")));
    end += 1;
  }
  const block: MarkdownBlock = {
    kind: "table",
    align: delimiter.map(alignOf),
    head: head.map(inlineOf),
    rows,
  };
  return { block, end };
}

function alignOf(cell: string): CellAlign {
  const start = cell.startsWith(":");
  const end = cell.endsWith(":");
  if (start && end) return "center";
  if (end) return "right";
  return start ? "left" : null;
}

/** A row's cells, trimmed, between its pipes: never a pipe inside a code span, nor an escaped `\|`, which is a pipe in
 * the cell's words. A pipe at the row's start or end bounds it and makes no cell. Null: the line has no pipe. */
function cellsOf(line: string): string[] | null {
  const text = line.trim();
  const cells: string[] = [];
  let cell = "";
  // the row so far ends on a pipe
  let closed = false;
  let at = 0;
  while (at < text.length) {
    const char = text.charAt(at);
    if (char === "|") {
      cells.push(cell);
      cell = "";
      closed = true;
      at += 1;
      continue;
    }
    closed = false;
    if (char === "\\" && text.charAt(at + 1) === "|") {
      cell += "|";
      at += 2;
      continue;
    }
    ROW_CODE.lastIndex = at;
    const span = char === "`" ? ROW_CODE.exec(text) : null;
    if (span !== null) {
      cell += span[0].replaceAll("\\|", "|");
      at += span[0].length;
      continue;
    }
    cell += char;
    at += 1;
  }
  if (cells.length === 0) return null;
  if (!closed) cells.push(cell);
  if (text.startsWith("|")) cells.shift();
  return cells.map((each) => each.trim());
}

function startsBlock(line: string): boolean {
  return (
    FENCE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    HEADING.test(line) ||
    RULE.test(line)
  );
}

/** Where a code span stands while a line's markup is read: U+FFFC, the object replacement character, which no markup
 * reads (it is no space, no word and no delimiter). The line's own U+FFFC stands the same way, as its own text. */
const HOLE = "\uFFFC";

/** A code span, or the line's own U+FFFC: each is held out of the line while its markup is read. */
const HELD = /`([^`]+)`|\uFFFC/gu;

/** One line's runs: `code` first (nothing inside it is read), then a link as its words, then bold and italic, which
 * may hold code (Spark QA F2, 2026-11-25: a bold verdict that opens on a code span is bold). Each code span stands in
 * the line as a hole while its markup is read, so its words close nothing and open nothing. */
export function inlineOf(line: string): InlineRun[] {
  const held: InlineRun[] = [];
  const holed = line.replace(HELD, (whole: string, code: string | undefined) => {
    held.push(code === undefined ? { kind: "text", text: whole } : { kind: "code", text: code });
    return HOLE;
  });
  return filled(emphasisOf(linksAsWords(holed)), held);
}

/** The runs with each hole filled again, in the line's order: a code span, or the line's own U+FFFC as its text.
 * Nothing drops a hole (a link's target never holds one), so the n-th hole is the n-th held. */
function filled(runs: readonly InlineRun[], held: readonly InlineRun[]): InlineRun[] {
  let next = 0;
  const fill = (each: readonly InlineRun[]): InlineRun[] =>
    merged(
      each.flatMap((run): InlineRun[] => {
        if (run.kind === "bold") return [{ kind: "bold", runs: fill(run.runs) }];
        if (run.kind === "italic") return [{ kind: "italic", runs: fill(run.runs) }];
        if (run.kind === "code") return [run];
        return run.text.split(HOLE).flatMap((piece, index): InlineRun[] => {
          const hole = index === 0 ? undefined : held[next++];
          const words: InlineRun = { kind: "text", text: piece };
          return hole === undefined ? [words] : [hole, words];
        });
      }),
    );
  return fill(runs);
}

/** A link is drawn as its words, never as a link: `[words](url)` is "words", `<https://…>` its address as text. A
 * target that holds a code span is no link's, as it was while code split the line first. */
function linksAsWords(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\((?:[^()\s\uFFFC]|\([^()\s\uFFFC]*\))*(?:\s+"[^"\uFFFC]*")?\)/gu, "$1")
    .replace(/<((?:https?|mailto):[^>\s\uFFFC]+)>/gu, "$1");
}

function emphasisOf(text: string): InlineRun[] {
  if (text === "") return [];
  const strong = /(\*\*|__)(?=\S)([\s\S]*?\S)\1/u.exec(text);
  if (strong !== null) {
    return [
      ...emphasisOf(text.slice(0, strong.index)),
      { kind: "bold", runs: emphasisOf(strong[2] ?? "") },
      ...emphasisOf(text.slice(strong.index + strong[0].length)),
    ];
  }
  // a lone `*` or `_` inside a word (snake_case, 2*3) is the word's own
  const em = /(^|[^\w*])([*_])(?=\S)([\s\S]*?\S)\2(?![\w*])/u.exec(text);
  if (em !== null) {
    const start = em.index + (em[1]?.length ?? 0);
    return [
      ...emphasisOf(text.slice(0, start)),
      { kind: "italic", runs: emphasisOf(em[3] ?? "") },
      ...emphasisOf(text.slice(em.index + em[0].length)),
    ];
  }
  return [{ kind: "text", text }];
}

/** Adjacent runs of text joined. */
function merged(runs: readonly InlineRun[]): InlineRun[] {
  const out: InlineRun[] = [];
  for (const run of runs) {
    const last = out[out.length - 1];
    if (run.kind === "text" && last?.kind === "text") {
      out[out.length - 1] = { kind: "text", text: last.text + run.text };
    } else if (run.kind !== "text" || run.text !== "") {
      out.push(run);
    }
  }
  return out;
}
