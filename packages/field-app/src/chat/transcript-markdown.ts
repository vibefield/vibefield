// VELA'S WORDS, READ (TH-1; TH-Q35 (a); DESIGN.md §8 "Chat's thread", Vela's words). An agent's text is the
// adversary's (EL7), so it is never markup: it is read here into plain data — paragraphs and their line breaks, bold
// and italic, inline code, fenced code, lists and quotes, a heading as a bold paragraph — and the view draws every
// run as text, which React escapes. A link is its words, inert; nothing else is read as markup. Pure.

/** A run of words in a line, with how it is drawn. */
export type InlineRun =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "bold"; readonly runs: readonly InlineRun[] }
  | { readonly kind: "italic"; readonly runs: readonly InlineRun[] }
  | { readonly kind: "code"; readonly text: string };

/** One line of a paragraph or a list item: its runs. */
export type InlineLine = readonly InlineRun[];

export type MarkdownBlock =
  | { readonly kind: "paragraph"; readonly lines: readonly InlineLine[]; readonly strong?: true }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly InlineLine[][] }
  | { readonly kind: "quote"; readonly blocks: readonly MarkdownBlock[] };

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
    const body: InlineLine[] = [];
    while (at < lines.length) {
      const next = lines[at] ?? "";
      if (next.trim() === "" || startsBlock(next)) break;
      body.push(inlineOf(next));
      at += 1;
    }
    blocks.push({ kind: "paragraph", lines: body });
  }
  return blocks;
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

/** One line's runs: `code` first (nothing inside it is read), then a link as its words, then bold and italic. */
export function inlineOf(line: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let rest = line;
  for (;;) {
    const tick = /`([^`]+)`/u.exec(rest);
    if (tick === null) break;
    runs.push(...emphasisOf(linksAsWords(rest.slice(0, tick.index))));
    runs.push({ kind: "code", text: tick[1] ?? "" });
    rest = rest.slice(tick.index + tick[0].length);
  }
  runs.push(...emphasisOf(linksAsWords(rest)));
  return merged(runs);
}

/** A link is drawn as its words, never as a link: `[words](url)` is "words", `<https://…>` its address as text. */
function linksAsWords(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)/gu, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/gu, "$1");
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
