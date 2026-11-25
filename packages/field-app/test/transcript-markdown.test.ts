/**
 * TH-1 — Vela's words, read (`chat/transcript-markdown.ts`; TH-Q35 (a); DESIGN.md §8 "Chat's thread", Vela's words):
 * the named subset as plain data, a link as its words, and nothing else read as markup. The view draws every run as
 * text, so nothing here ever reaches the DOM as HTML (thread-flow.test.tsx draws it).
 */

import { describe, expect, it } from "vitest";
import { inlineOf, markdownBlocksOf } from "../src/chat/transcript-markdown";

describe("the named subset (TH-Q35 (a))", () => {
  it("reads paragraphs, their line breaks, and a heading as a bold paragraph", () => {
    expect(markdownBlocksOf("one\ntwo\n\n## Three")).toEqual([
      {
        kind: "paragraph",
        lines: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two" }]],
      },
      { kind: "paragraph", lines: [[{ kind: "text", text: "Three" }]], strong: true },
    ]);
  });

  it("reads bold, italic and code, and nothing inside code", () => {
    expect(inlineOf("a **b** *c* `**d**` e_f_g 2*3")).toEqual([
      { kind: "text", text: "a " },
      { kind: "bold", runs: [{ kind: "text", text: "b" }] },
      { kind: "text", text: " " },
      { kind: "italic", runs: [{ kind: "text", text: "c" }] },
      { kind: "text", text: " " },
      { kind: "code", text: "**d**" },
      { kind: "text", text: " e_f_g 2*3" },
    ]);
  });

  it("reads fenced code whole, lists with their continued lines, and quotes", () => {
    expect(markdownBlocksOf("```ts\nconst a = '<b>';\n```")).toEqual([
      { kind: "code", text: "const a = '<b>';" },
    ]);
    expect(markdownBlocksOf("- one\n  more\n- two\n\n1. first")).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          [[{ kind: "text", text: "one" }], [{ kind: "text", text: "more" }]],
          [[{ kind: "text", text: "two" }]],
        ],
      },
      { kind: "list", ordered: true, items: [[[{ kind: "text", text: "first" }]]] },
    ]);
    expect(markdownBlocksOf("> quoted **here**")).toEqual([
      {
        kind: "quote",
        blocks: [
          {
            kind: "paragraph",
            lines: [
              [
                { kind: "text", text: "quoted " },
                { kind: "bold", runs: [{ kind: "text", text: "here" }] },
              ],
            ],
          },
        ],
      },
    ]);
  });

  it("draws a link as its words, inert, and an image as its words too (EL7: a link is a lure)", () => {
    expect(inlineOf("see [the log](https://evil.invalid/x) and <https://evil.invalid>")).toEqual([
      { kind: "text", text: "see the log and https://evil.invalid" },
    ]);
    expect(inlineOf("![a picture](https://evil.invalid/p.png)")).toEqual([
      { kind: "text", text: "a picture" },
    ]);
    // a target's own parentheses close with it
    expect(inlineOf("[press](javascript:alert(1)) now")).toEqual([
      { kind: "text", text: "press now" },
    ]);
  });

  it("keeps markup it does not name as words", () => {
    const [block] = markdownBlocksOf("<script>alert(1)</script> | a | table |");
    expect(block).toEqual({
      kind: "paragraph",
      lines: [[{ kind: "text", text: "<script>alert(1)</script> | a | table |" }]],
    });
    // a rule is no row
    expect(markdownBlocksOf("above\n\n---\n\nbelow").map((each) => each.kind)).toEqual([
      "paragraph",
      "paragraph",
    ]);
  });
});

const text = (words: string) => ({ kind: "text", text: words }) as const;
const code = (words: string) => ({ kind: "code", text: words }) as const;

describe("bold and italic around code (Spark QA F2, 2026-11-25)", () => {
  it("lets a bold run hold a code run, as a spark writes a verdict", () => {
    expect(inlineOf("**`review-until-clean` flow: can't be done.**")).toEqual([
      { kind: "bold", runs: [code("review-until-clean"), text(" flow: can't be done.")] },
    ]);
    expect(inlineOf("**`a` and `b`** then *see `c`*")).toEqual([
      { kind: "bold", runs: [code("a"), text(" and "), code("b")] },
      text(" then "),
      { kind: "italic", runs: [text("see "), code("c")] },
    ]);
  });

  it("still reads nothing inside a code span, and a lone `*` or `_` inside a word is the word's own", () => {
    // the code span's own asterisks close nothing
    expect(inlineOf("**a `**` b**")).toEqual([
      { kind: "bold", runs: [text("a "), code("**"), text(" b")] },
    ]);
    expect(inlineOf("`**`x`**`")).toEqual([code("**"), text("x"), code("**")]);
    expect(inlineOf("snake_`x`_case and 2*`y`*3")).toEqual([
      text("snake_"),
      code("x"),
      text("_case and 2*"),
      code("y"),
      text("*3"),
    ]);
    // a link's words may hold code; a code span in its target leaves it unread, as before
    expect(inlineOf("[`x`](https://evil.invalid) and [a](`b`)")).toEqual([
      code("x"),
      text(" and [a]("),
      code("b"),
      text(")"),
    ]);
  });

  it("keeps the line's own object replacement character as its text", () => {
    const own = String.fromCodePoint(0xfffc);
    expect(inlineOf(`a${own} **b** \`c\``)).toEqual([
      text(`a${own} `),
      { kind: "bold", runs: [text("b")] },
      text(" "),
      code("c"),
    ]);
  });
});

describe("a reply's table (Spark QA F1, 2026-11-25)", () => {
  it("reads a header, the delimiter row's alignment and the body rows, each cell as inline runs", () => {
    const reply = [
      "| Model id | Label | Effort levels | Notes |",
      "|---|:---:|--:|:--|",
      "| `default` | Default (recommended) | low, medium, high | **fast** |",
    ].join("\n");
    expect(markdownBlocksOf(reply)).toEqual([
      {
        kind: "table",
        align: [null, "center", "right", "left"],
        head: [[text("Model id")], [text("Label")], [text("Effort levels")], [text("Notes")]],
        rows: [
          [
            [code("default")],
            [text("Default (recommended)")],
            [text("low, medium, high")],
            [{ kind: "bold", runs: [text("fast")] }],
          ],
        ],
      },
    ]);
  });

  it("reads an escaped pipe as a pipe, never splits a cell at a pipe in a code span, and takes an empty first column", () => {
    const reply = [
      "| | Loro | Yjs |",
      "| --- | --- | --- |",
      "| a \\| b | `x | y` | `p\\|q` |",
    ].join("\n");
    expect(markdownBlocksOf(reply)).toEqual([
      {
        kind: "table",
        align: [null, null, null],
        head: [[], [text("Loro")], [text("Yjs")]],
        rows: [[[text("a | b")], [code("x | y")], [code("p|q")]]],
      },
    ]);
  });

  it("pads a short row and cuts a long one to the header's width, and reads rows with no outer pipes", () => {
    const [table] = markdownBlocksOf("a | b | c\n--|--|--\n1 | 2\n1 | 2 | 3 | 4\n|");
    expect(table).toEqual({
      kind: "table",
      align: [null, null, null],
      head: [[text("a")], [text("b")], [text("c")]],
      rows: [
        [[text("1")], [text("2")], []],
        [[text("1")], [text("2")], [text("3")]],
        [[], [], []],
      ],
    });
  });

  it("stands between paragraphs: it may follow a paragraph's line, and a blank line, another block or a line with no pipe ends it", () => {
    const reply =
      "Here's how they compare:\n| a | b |\n|---|---|\n| 1 | 2 |\nThat's all.\n\n| c |\n|---|\n- a list";
    expect(markdownBlocksOf(reply).map((block) => block.kind)).toEqual([
      "paragraph",
      "table",
      "paragraph",
      "table",
      "list",
    ]);
    // a header and its delimiter alone are a table with no rows
    expect(markdownBlocksOf("| a | b |\n|---|---|")).toEqual([
      { kind: "table", align: [null, null], head: [[text("a")], [text("b")]], rows: [] },
    ]);
  });

  it("keeps a line of pipes a paragraph when no delimiter row stands under it, or one of another width", () => {
    expect(markdownBlocksOf("| a | b |\n| c | d |")).toEqual([
      { kind: "paragraph", lines: [[text("| a | b |")], [text("| c | d |")]] },
    ]);
    expect(markdownBlocksOf("| a | b |\n|---|").map((block) => block.kind)).toEqual(["paragraph"]);
    // a rule with no pipe stays a rule, and `---` under words is no delimiter row
    expect(markdownBlocksOf("words\n---\nmore").map((block) => block.kind)).toEqual([
      "paragraph",
      "paragraph",
    ]);
  });

  it("keeps markup in a cell as words (EL7)", () => {
    const [table] = markdownBlocksOf(
      '| <img src=x onerror="alert(1)"> | [press](javascript:alert(1)) |\n|---|---|',
    );
    expect(table).toEqual({
      kind: "table",
      align: [null, null],
      head: [[text('<img src=x onerror="alert(1)">')], [text("press")]],
      rows: [],
    });
  });
});
