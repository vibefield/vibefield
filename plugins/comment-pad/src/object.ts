// The COMMENT PAD's code half — the `ObjectBinding` its manifest row names (`binding: { kind: "commentPad" }`). The
// HOST makes the `defineObject` call (spec §12.2: plugin code never owns a durable schema), compiling the
// manifest's durable half (manifest.ts — the props, the `ink` group, the size, what it provides)
// with what this export carries: the kind, whole (kind.ts); its DRIVER — the hand onto the kind's state the
// desk makes once per desk (the pad's membership and its writing); and its DOM HALF, declared — its sheet, the
// TEXT PART the desk routes a tap to and lends its one editor (body.ts). Static, never registered from
// `activate`: the desk creates every kind's pass together at its mount, so the host reads this export by name.

import type {
  AgentHalf,
  AgentReadApi,
  KindDriverHost,
  ObjectBinding,
  ObjectDomHost,
} from "@vibefield/plugin-sdk/desk";
import { createPadSheet, type PadDriver } from "./body";
import { commentPadKind } from "./kind";
import type { PadGeometry, PadInstance } from "./layout";
import type { PadLook } from "./theme";
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

const commentsOf = (text: string): number => (text === "" ? 0 : text.split("\n").length);

/** What an agent can do with a pad (OB-2): read its comments and add one. It writes only `text`: the seeds it leaves are the
 * lines already there, each still in its own hand, and a new line draws from the pad's `seed`. */
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
      api.setProps({ text });
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
  agent: commentPadAgent,
};
// docs:end binding
