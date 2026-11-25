import type { ObjectAgentTool } from "./plugins";

// THE INK TOOLS (IK, 2026-11-25; ink-agent A): the three tools every WRITTEN kind gives an agent, the same on each — the
// note, the comment pad, a plugin's own sheet. An agent reads the words with their marks (`read_writing`), changes words
// (`edit_text`) and marks them (`mark_text`), and it names the words it means by QUOTING them, never by an index: a quote
// stays true while a person types elsewhere on the sheet, an index does not.
//
// Declared here, once, because a built-in kind's tools are contracts' (`desk-kinds.ts`, read by fieldd) and a plugin's are
// its manifest's, and both list these. The handlers are the SDK's (`withInkTools`, `@vibefield/plugin-sdk/desk`), written
// over ICE's ink value. Contracts imports no ICE, so the desk's pens and highlighters are named here as words, in ICE's own
// order; a test in the SDK holds the two lists to `PENS` and `HIGHLIGHTERS`.

/** The desk's pens, as ICE's kit names them (`PENS`). */
export const INK_PEN_NAMES = ["felt", "ball", "fountain", "red"] as const;

/** The desk's highlighters, as ICE's kit names them (`HIGHLIGHTERS`). */
export const INK_HIGHLIGHTER_NAMES = ["yellow", "green", "pink", "blue", "orange"] as const;

/** The highlight an agent asks for to lift one (the words' menu says None). */
export const INK_NO_HIGHLIGHT = "none";

/** The most an agent's quote holds. */
export const INK_QUOTE_MAX = 2_000;

/** The most an agent's new words hold in one edit (a kind holds no more than its own `maxLength`). */
export const INK_WORDS_MAX = 20_000;

/** The three tools' names. */
export const INK_TOOL_NAMES = {
  read: "read_writing",
  edit: "edit_text",
  mark: "mark_text",
} as const;

const QUOTE = {
  type: "string",
  minLength: 1,
  maxLength: INK_QUOTE_MAX,
  description:
    "Words written on it, copied exactly as `read_writing` gives them, spaces and line breaks included.",
} as const;

const OCCURRENCE = {
  type: "integer",
  minimum: 1,
  description:
    "Which time the quote is meant, counting from 1 at the start, when the same words are written more than once.",
} as const;

/** A strike or an underline: on in the words' own pen, off, or on in one of the pens. */
const LINE = {
  anyOf: [{ type: "boolean" }, { type: "string", enum: [...INK_PEN_NAMES] }],
} as const;

const RUN = {
  type: "object",
  properties: {
    from: { type: "integer", minimum: 0 },
    to: { type: "integer", minimum: 0 },
    text: { type: "string" },
    pen: { type: "string", enum: [...INK_PEN_NAMES] },
    highlight: { type: "string", enum: [...INK_HIGHLIGHTER_NAMES] },
    strike: LINE,
    underline: LINE,
  },
  required: ["from", "to", "text"],
} as const;

export const INK_TOOLS: readonly ObjectAgentTool[] = [
  {
    name: INK_TOOL_NAMES.read,
    readOnly: true,
    description:
      "Read everything written here and how it is marked: the text, the sheet's own pen, and each marked run of words with its pen, highlighter, strike or underline. Words not listed in a run are plain, in the sheet's own pen.",
    input: { type: "object", properties: {}, additionalProperties: false },
    output: {
      type: "object",
      properties: {
        text: { type: "string" },
        pen: { type: "string", enum: [...INK_PEN_NAMES] },
        runs: { type: "array", items: RUN },
        more: { type: "integer", minimum: 1 },
      },
      required: ["text", "runs"],
    },
  },
  {
    name: INK_TOOL_NAMES.edit,
    readOnly: false,
    description:
      "Replace some words with others. Quote the words to change exactly; the new words keep the marks the old ones all shared. If the quote is written more than once, say which with `occurrence`. The user can undo it.",
    input: {
      type: "object",
      properties: {
        quote: QUOTE,
        with: {
          type: "string",
          maxLength: INK_WORDS_MAX,
          description: "The words to write in their place. Empty removes the quoted words.",
        },
        occurrence: OCCURRENCE,
      },
      required: ["quote", "with"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: { at: { type: "integer", minimum: 0 }, chars: { type: "integer", minimum: 0 } },
      required: ["at", "chars"],
    },
  },
  {
    name: INK_TOOL_NAMES.mark,
    readOnly: false,
    description:
      "Mark some words: write them in another pen, highlight them, strike them through, underline them, or clear their marks. Quote the words exactly, and say which time with `occurrence` if they are written more than once. The user can undo it.",
    input: {
      type: "object",
      properties: {
        quote: QUOTE,
        occurrence: OCCURRENCE,
        pen: {
          type: "string",
          enum: [...INK_PEN_NAMES],
          description: "The pen to write the words in. The sheet's own pen undoes another.",
        },
        highlight: {
          type: "string",
          enum: [...INK_HIGHLIGHTER_NAMES, INK_NO_HIGHLIGHT],
          description: "The highlighter to colour them with, or none to lift a highlight.",
        },
        strike: {
          ...LINE,
          description:
            "true strikes them through in their own pen, a pen's name in that pen, false lifts it.",
        },
        underline: {
          ...LINE,
          description:
            "true underlines them in their own pen, a pen's name in that pen, false lifts it.",
        },
        clear: {
          type: "boolean",
          const: true,
          description:
            "Lift every mark first: the pen, the highlight, the strike and the underline.",
        },
      },
      required: ["quote"],
      additionalProperties: false,
    },
    output: {
      type: "object",
      properties: { at: { type: "integer", minimum: 0 }, chars: { type: "integer", minimum: 0 } },
      required: ["at", "chars"],
    },
  },
];
