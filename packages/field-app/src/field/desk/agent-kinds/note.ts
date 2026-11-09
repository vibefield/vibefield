import type { AgentHalf, AgentReadApi } from "@vibefield/plugin-sdk/desk";

// THE NOTE, for an agent (OB-3c; `desk.note`). Its durable half is `desk-kinds.ts`. What it reads and writes is the note's
// `ink` cell, one conflict group, so a write always sets `text` and `seeds` together.

/** How much of a note `object_open` shows; the rest is `read_text`'s. */
const OPEN_CHARS = 2_000;

const textOf = (api: AgentReadApi): string => {
  const text = api.props()["text"];
  return typeof text === "string" ? text : "";
};

export const noteAgent: AgentHalf = {
  summary: (api) => {
    const text = textOf(api);
    return text.length <= OPEN_CHARS
      ? { text }
      : { text: text.slice(0, OPEN_CHARS), truncated: true, chars: text.length };
  },
  faces: { words: textOf },
  read: { read_text: (api) => ({ text: textOf(api) }) },
  act: {
    write_text: (api, input) => {
      const text = String(input["text"]);
      // empty seeds: every glyph takes its hand from the note's own `seed` (ICE's `seedsFor`), since none of the old
      // ones belong to these words
      api.setProps({ text, seeds: "" });
      return { value: { chars: text.length }, changed: "Rewrote the note" };
    },
  },
};
