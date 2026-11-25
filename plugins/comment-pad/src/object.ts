// The COMMENT PAD's code half — the `ObjectBinding` its manifest row names (`binding: { kind: "commentPad" }`). The
// HOST makes the `defineObject` call (spec §12.2: plugin code never owns a durable schema), compiling the
// manifest's durable half (manifest.ts — the props, the `ink` group, the size, what it provides)
// with what this export carries: the kind, whole (kind.ts); its DRIVER — the hand onto the kind's state the
// desk makes once per desk (the pad's membership and its writing); its DOM HALF, declared — its sheet, the
// TEXT PART the desk routes a tap to and lends its one editor (body.ts: the kit's written part); and its MENU —
// the kit's ink acts on its selected words, the words bar's (typing.ts; IK, 2026-11-25). Static, never registered
// from `activate`: the desk creates every kind's pass together at its mount, so the host reads this export by name.

import {
  type AgentHalf,
  type AgentReadApi,
  decodeMarks,
  encodeMarks,
  type KindDriverHost,
  type ObjectBinding,
  type ObjectDomHost,
} from "@vibefield/plugin-sdk/desk";
import { createPadSheet, type PadDriver } from "./body";
import { commentPadKind } from "./kind";
import type { PadGeometry, PadInstance } from "./layout";
import type { PadLook } from "./theme";
import { padActs } from "./typing";
import type { PadWriting } from "./writing";

/** The pad's driver on one desk: its membership and its writing — what its sheet asks of the kind host. */
export function padDriver(h: KindDriverHost): PadDriver {
  return {
    isPad: h.isKind,
    writing: () => h.local as PadWriting | undefined,
    follow: () => {},
    idle: () => true,
  };
}

/** The most a pad's `text` holds (the manifest's own `maxLength`). */
const PAD_TEXT_MAX = 20_000;

/** The words an agent's read returns of a pad's writing: all of them. */
const padText = (api: AgentReadApi): string => {
  const text = api.props()["text"];
  return typeof text === "string" ? text : "";
};

/** The pad's marks as its cell holds them (a cell stored before the marks: none). */
const padMarks = (api: AgentReadApi): string => {
  const marks = api.props()["marks"];
  return typeof marks === "string" ? marks : "";
};

const commentsOf = (text: string): number => (text === "" ? 0 : text.split("\n").length);

/** What an agent can do with a pad (OB-2): read its comments and add one. It writes the cell's `text` and `marks` together: the
 * seeds it leaves are the lines already there, each still in its own hand, and a new line draws from the pad's `seed`; the marks
 * stay on the letters they were made on, read as the cell holds them against the words it had, and the new line is unmarked
 * (IK, 2026-11-25 — the ink cell's three fields move as one). */
export const commentPadAgent: AgentHalf = {
  summary: (api) => {
    const text = padText(api);
    return { comments: commentsOf(text), text: text.slice(0, 2_000) };
  },
  faces: { words: padText },
  read: { read_text: (api) => ({ text: padText(api) }) },
  act: {
    add_comment: (api, input) => {
      const line = String(input["text"]).replaceAll("\n", " ");
      const was = padText(api);
      const text = was === "" ? line : `${was}\n${line}`;
      if (text.length > PAD_TEXT_MAX) throw new Error("this pad is full");
      // the marks of the words already there, as the cell reads them against those words — the new line's tail unmarked
      const marks = encodeMarks(decodeMarks(padMarks(api), was));
      api.setProps({ text, marks });
      return { value: { comments: commentsOf(text) }, changed: "Added a comment" };
    },
  },
};

// docs:begin binding
/** THE BINDING — the pad's kind, its driver and its sheet (the text part the desk's one editor is lent to). */
export const commentPad: ObjectBinding<PadGeometry, PadInstance, PadLook> = {
  kind: commentPadKind(),
  drivers: padDriver,
  host: {
    text: (h: ObjectDomHost) => {
      const sheet = createPadSheet(h);
      return sheet === undefined ? [] : [sheet];
    },
  },
  // the words bar's acts on the selected words (DESIGN.md §8): Pen ▾, Highlight ▾, Strike, Underline, Clear — the kit's
  menu: padActs(),
  agent: commentPadAgent,
};
// docs:end binding
