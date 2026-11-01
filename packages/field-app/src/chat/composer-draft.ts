import type { AgentModelSelection } from "@vibefield/contracts";
import { stillOf } from "../frame/cards/card-text";
import type { Card } from "../frame/cards/cards-model";
import { cardName } from "../frame/cards/cards-words";

// CHAT'S DRAFT (SP-1d; DESIGN.md §8 "Chat's composer": the draft, the chips, what a send carries; D1 of 12 Sep: chips
// are inline in the sentence, the draft is an editor, not a textarea). What the composer holds between keystrokes, as
// plain data: runs of text and the chips set into them. The editor's DOM is the truth while a person types; the
// controller reads it into these parts and writes them back only when it changes the draft itself (a chip lands, a
// send clears it), so nothing here knows a DOM exists. The draft's own rules came back from the line's model in git
// (`0e2ad08bc:packages/field-app/src/frame/draft.ts`); the chips and the message are CH-D5's, and the line's aim, its
// captures, its desk chips and its clipboard road did not come back.

/** An agent taken from @ (CH-D5 A: "an agent becomes a chip with its model and effort"): the spark starts it. */
export interface AgentChip {
  readonly id: string;
  readonly kind: "agent";
  /** the catalog's id, opaque (AR-L1) — its mark, never compared */
  readonly agent: string;
  /** the catalog's label for it */
  readonly label: string;
  /** the Agent Profile whose sign-in it starts under */
  readonly profile: { readonly id: string; readonly name: string };
  /** the spark has more than one profile, so the chip and the message say which */
  readonly named: boolean;
  /** the model and effort chosen in its menu, in words (`modelWords`) and as the picker's selection; null while
   * untouched, when it starts at its own model and effort */
  readonly model: {
    readonly words: readonly string[];
    readonly selection: AgentModelSelection;
  } | null;
}

/** A session taken from @ (CH-D5 A: "a session becomes its handle"): one the spark's `agent_send` takes. */
export interface SessionChip {
  readonly id: string;
  readonly kind: "session";
  /** its run's id, the one the spark's tools address a session by (DESIGN.md §9 "Chat's words") */
  readonly session: string;
  readonly agent: string;
  readonly label: string;
  /** its name as the swarm names its body, with @'s ordinal where two share it ("vibe-field·2") */
  readonly handle: string;
  /** the project's name, without the ordinal, which is the window's own; null for a run that names none */
  readonly project: string | null;
}

/** A card played on the composer (§8 "The hand"): the whole card, and the text a pane takes of it (`paneTextOf`),
 * read once as it lands — a card that gives nothing never lands. */
export interface CardChip {
  readonly id: string;
  readonly kind: "card";
  readonly card: Card;
  readonly text: string;
}

export type DraftChip = AgentChip | SessionChip | CardChip;

export type DraftPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "chip"; readonly chip: DraftChip };

/** Adjacent runs of text joined and empty runs dropped, so two drafts that read the same are the same parts. */
export function normalizeDraft(parts: readonly DraftPart[]): DraftPart[] {
  const out: DraftPart[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (part.kind === "text") {
      if (part.text === "") continue;
      if (last?.kind === "text")
        out[out.length - 1] = { kind: "text", text: last.text + part.text };
      else out.push(part);
    } else out.push(part);
  }
  return out;
}

/** The words typed, chips left out. */
function typed(parts: readonly DraftPart[]): string {
  return parts
    .map((part) => (part.kind === "text" ? part.text : ""))
    .join("")
    .trim();
}

/** There is something to send — a chip, or a word beyond the @ still being typed (`pending`, "@cla"): a mention in
 * progress is not a message, so send stays quiet while @'s list is open over nothing else. */
export function draftSendable(parts: readonly DraftPart[], pending: string | null): boolean {
  if (parts.some((part) => part.kind === "chip")) return true;
  const words = typed(parts);
  if (pending === null || !words.endsWith(pending)) return words !== "";
  return words.slice(0, words.length - pending.length).trim() !== "";
}

/** Nothing typed and nothing set: what the placeholder stands in for. Unlike `draftSendable`, a typed space is
 * something. */
export function draftBlank(parts: readonly DraftPart[]): boolean {
  return parts.every((part) => part.kind === "text" && part.text === "");
}

/** The placeholder says who it goes to (DESIGN.md §8): the spark's name. */
export function draftPlaceholder(name: string): string {
  return `Message ${name}…`;
}

/** What a chip reads in the sentence (DESIGN.md §8 "Chat's composer", the chips): an agent, its label, its model and
 * effort once chosen, and its profile when the spark has more than one; a session, its handle; a card, its name as an
 * outcome says it. */
export function chipLabel(chip: DraftChip): string {
  switch (chip.kind) {
    case "agent": {
      const line = [chip.label, ...(chip.model?.words ?? [])].join(" · ");
      return chip.named ? `${line} · ${chip.profile.name}` : line;
    }
    case "session":
      return chip.handle;
    case "card":
      return cardName(chip.card);
  }
}

/** What a chip carries into the message (DESIGN.md §8 "Chat's composer", what a send carries). */
function chipText(chip: DraftChip): string {
  switch (chip.kind) {
    case "agent": {
      const words = chip.model?.words ?? [];
      const at = words.length === 0 ? chip.label : `${chip.label} at ${words.join(" · ")}`;
      return chip.named ? `${at} under ${chip.profile.name}` : at;
    }
    case "session":
      return chip.project === null
        ? `${chip.label} (session ${chip.session})`
        : `${chip.label} in ${chip.project} (session ${chip.session})`;
    case "card":
      return chip.text;
  }
}

/** The message a send pastes (DESIGN.md §8 "Chat's composer", what a send carries), in the draft's order: the words
 * as typed and each chip as its words; a chip that carries more than one line stands on lines of its own, its line
 * breaks kept, with no space left at either side of its breaks; the whole trimmed at both ends, so it never ends
 * with a line break. */
export function draftText(parts: readonly DraftPart[]): string {
  let out = "";
  let afterBlock = false;
  for (const part of parts) {
    if (part.kind === "text") {
      out += afterBlock ? part.text.replace(/^[ \t]+/u, "") : part.text;
      afterBlock = false;
      continue;
    }
    const text = chipText(part.chip);
    if (!text.includes("\n")) {
      out += text;
      afterBlock = false;
      continue;
    }
    out = out.replace(/[ \t]+$/u, "");
    out += `${out === "" || out.endsWith("\n") ? "" : "\n"}${text}\n`;
    afterBlock = true;
  }
  return out.trim();
}

/** The snapshot stills a draft's cards name, which main must still keep before their paths are pasted. */
export function draftStills(parts: readonly DraftPart[]): string[] {
  return parts.flatMap((part) => {
    if (part.kind !== "chip" || part.chip.kind !== "card") return [];
    const still = stillOf(part.chip.card);
    return still === null ? [] : [still];
  });
}

/** What a draft keeps once `sent` was pasted from it (DESIGN.md §8 "Chat's composer", Send: what was typed or added
 * while it ran stays). A send runs for up to 20 s while its spark wakes, and the draft stays a field meanwhile, so
 * `now` may hold more than was sent: when it still begins with every part sent, what follows them stays, its leading
 * space trimmed; a draft changed within what was sent stays whole, so no word is lost. */
export function draftAfterSend(
  sent: readonly DraftPart[],
  now: readonly DraftPart[],
): readonly DraftPart[] {
  const last = sent.length - 1;
  if (last < 0) return now;
  for (let i = 0; i < last; i++) {
    if (!samePart(sent[i], now[i])) return now;
  }
  const end = sent[last];
  const at = now[last];
  let rest: DraftPart[];
  if (end?.kind === "text" && at?.kind === "text" && at.text.startsWith(end.text)) {
    rest = [{ kind: "text", text: at.text.slice(end.text.length) }, ...now.slice(last + 1)];
  } else if (samePart(end, at)) {
    rest = now.slice(last + 1);
  } else {
    return now;
  }
  const [first, ...after] = rest;
  return normalizeDraft(
    first?.kind === "text" ? [{ kind: "text", text: first.text.trimStart() }, ...after] : rest,
  );
}

/** The same run of text, or the very chip (one whose model was chosen again since is another). */
function samePart(a: DraftPart | undefined, b: DraftPart | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a.kind === "text") return b.kind === "text" && a.text === b.text;
  return b.kind === "chip" && a.chip === b.chip;
}

/** The @ being typed before the caret, if there is one: an @ at the start of a word, and the word after it so far
 * (`query`). `at` is the @'s offset in `before`. An @ inside a word (an address) opens nothing. */
export function atQueryBefore(before: string): { at: number; query: string } | null {
  const match = /(^|\s)@([^\s@]*)$/u.exec(before);
  if (match === null) return null;
  return { at: match.index + (match[1]?.length ?? 0), query: match[2] ?? "" };
}

/** `parts` with the text from `start` to `end` of part `index` taken out and, when `chip` is given, the chip set in
 * its place with a space after it — a chip never splits a word, so the caret lands after that space. */
export function spliceDraft(
  parts: readonly DraftPart[],
  index: number,
  start: number,
  end: number,
  chip?: DraftChip,
): DraftPart[] {
  const target = parts[index];
  if (target === undefined || target.kind !== "text") return [...parts];
  const before = target.text.slice(0, start);
  const after = target.text.slice(end);
  const middle: DraftPart[] =
    chip === undefined
      ? []
      : [
          { kind: "chip", chip },
          { kind: "text", text: after.startsWith(" ") ? "" : " " },
        ];
  return normalizeDraft([
    ...parts.slice(0, index),
    { kind: "text", text: before },
    ...middle,
    { kind: "text", text: after },
    ...parts.slice(index + 1),
  ]);
}

/** Where a place in the draft is, counted the way the caret moves: one per character, one per chip. */
export function draftOffset(parts: readonly DraftPart[], index: number, offset: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) {
    const part = parts[i];
    at += part === undefined ? 0 : part.kind === "text" ? part.text.length : 1;
  }
  return at + offset;
}

/** The end of the word `offset` stands in (itself between words, or past the text's end clamped to it). */
function wordEnd(text: string, offset: number): number {
  let at = Math.min(Math.max(0, offset), text.length);
  while (at < text.length && !/\s/u.test(text.charAt(at))) at += 1;
  return at;
}

/**
 * A chip set in the draft where the caret is (a card played on the composer, DESIGN.md §8 "Chat's composer": "at the
 * caret, or at the draft's end when the draft holds no caret"; "it never splits a word"): at the caret in part
 * `caret.index` — moved on to the end of the word it stands in — as a token, a space set before it when it would touch
 * a word and `spliceDraft`'s after it; the caret after the chip and its space. Returns the new parts and the caret
 * (`draftOffset`'s count).
 */
export function insertChipAt(
  parts: readonly DraftPart[],
  caret: { readonly index: number; readonly offset: number } | null,
  chip: DraftChip,
): { parts: DraftPart[]; caret: number } {
  let base: DraftPart[] = [...parts];
  let index = caret?.index ?? base.length - 1;
  let offset = caret?.offset ?? Number.POSITIVE_INFINITY;
  if (base[index]?.kind !== "text") {
    // no caret, or one at a chip: the end of the draft, in a run of text
    if (base[base.length - 1]?.kind !== "text") base.push({ kind: "text", text: "" });
    index = base.length - 1;
    offset = Number.POSITIVE_INFINITY;
  }
  const target = base[index] as { kind: "text"; text: string };
  let at = wordEnd(target.text, offset);
  const before = target.text.slice(0, at);
  const touches = before === "" ? index > 0 : !/\s$/u.test(before);
  if (touches) {
    base = base.map((part, i) =>
      i === index ? { kind: "text", text: `${before} ${target.text.slice(at)}` } : part,
    );
    at += 1;
  }
  return {
    parts: spliceDraft(base, index, at, at, chip),
    caret: draftOffset(base, index, at) + 2,
  };
}
