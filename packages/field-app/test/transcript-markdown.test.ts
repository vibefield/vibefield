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
