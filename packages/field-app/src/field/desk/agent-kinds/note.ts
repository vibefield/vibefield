import { NOTE_TEXT_MAX } from "@vibefield/contracts";
import { type AgentHalf, type AgentReadApi, withInkTools } from "@vibefield/plugin-sdk/desk";

// THE NOTE, for an agent (OB-3c; `desk.note`). Its durable half is `desk-kinds.ts`. What it reads and writes is the note's
// `ink` cell, one conflict group, so a write always sets `text`, `seeds` and `marks` together. Beside its own two tools it
// has the three every written kind shares (IK, 2026-11-25: `withInkTools` — read_writing, edit_text, mark_text). A note
// whose cell has no `marks` yet (ICE's note before it adopts the ink) reads unmarked and refuses a mark.

/** How much of a note `object_open` shows; the rest is `read_text`'s. */
const OPEN_CHARS = 2_000;

const textOf = (api: AgentReadApi): string => {
  const text = api.props()["text"];
  return typeof text === "string" ? text : "";
};

export const noteAgent: AgentHalf = withInkTools(
  {
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
        // ones belong to these words; and no marks, or the old ones would land on the new words (IK, 2026-11-25)
        const marks = "marks" in api.props() ? { marks: "" } : {};
        api.setProps({ text, seeds: "", ...marks });
        return { value: { chars: text.length }, changed: "Rewrote the note" };
      },
    },
  },
  { max: NOTE_TEXT_MAX, noun: "note" },
);
