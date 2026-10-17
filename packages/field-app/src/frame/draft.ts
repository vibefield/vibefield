import type { FrameView } from "@vibefield/contracts";

// THE DRAFT (DESIGN.md §8 "The line"; the composer record's D1 of 12 Sep:
// chips are inline in the prompt, the draft is an editor, not a textarea).
// What the line holds between keystrokes, as plain data: runs of text and the
// chips set into them, plus the aim — who it goes to — which leads the draft
// outside the sentence (CB-1: the target is always named). The editor's DOM is
// the truth while a person types; the controller reads it into these parts and
// writes them back only when it changes the draft itself (a chip lands, a send
// clears it), so nothing here knows a DOM exists.

/** A capture from the clipboard, set into the sentence (the clipboard stays
 * the store; a chip is a citation of one of its stills). */
export interface CaptureChip {
  readonly id: string;
  readonly kind: "capture";
  /** What the chip reads: "1440 × 900". */
  readonly label: string;
  /** The still on disk — what a send carries, since vendors read image paths. */
  readonly path: string;
}

/** One object a desk chip carries (DK-D26): its type, its human name, its durable text (null when it keeps none). */
export interface ChipObject {
  readonly type: string;
  readonly name: string;
  readonly text: string | null;
}

/** The still a desk chip carries: the selection through the desk's capture door (ICE I23), as PNG bytes kept in the
 * renderer under a `blob:` URL, at its own size in device px. */
export interface ChipStill {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  /** The PNG's size in bytes. */
  readonly bytes: number;
}

/**
 * The selection sent from the desk (DK-14; DESIGN.md §8 "Send to…"; R15, DK-D26): ONE chip for the whole selection.
 * Its FACE — a note's paper and ink, `snippets` and its first 24 characters; any other kind its name and no glyph;
 * several, `package` and "N objects"; a missing face its type's name — and what it CARRIES: the objects' names, their
 * durable text, and a still (attached once the capture resolves; null until then, or when the desk had none to give).
 */
export interface DeskChip {
  readonly id: string;
  readonly kind: "desk";
  readonly label: string;
  /** `snippets` (a note) or `package` (several); a kind's chip wears none (R15 amended). */
  readonly glyph: "snippets" | "package" | null;
  /** A note's paper and ink — its props through the palette's CSS colours. */
  readonly paper?: string;
  readonly ink?: string;
  readonly objects: readonly ChipObject[];
  readonly still: ChipStill | null;
}

export type DraftChip = CaptureChip | DeskChip;

export type DraftPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "chip"; readonly chip: DraftChip };

/** Who the draft goes to: a Send to row taken. One per draft, kept across
 * sends until it is changed or removed. */
export interface LineAim {
  /** The floor session of the pane it names. */
  readonly sessionId: string;
  /** As the swarm names its body: the folder. */
  readonly name: string;
}

/** Adjacent runs of text joined and empty runs dropped, so two drafts that
 * read the same are the same parts. */
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

/** There is something to send — a chip, or a word beyond the @ still being
 * typed (`pending`, "@vib"): a mention in progress is not a message, so send
 * stays quiet while @'s list is open over nothing else. */
export function draftSendable(parts: readonly DraftPart[], pending: string | null): boolean {
  if (parts.some((part) => part.kind === "chip")) return true;
  const message = draftMessage(parts);
  if (pending === null || !message.endsWith(pending)) return message !== "";
  return message.slice(0, message.length - pending.length).trim() !== "";
}

/** Nothing typed and nothing set: what the placeholder stands in for. Unlike
 * `draftSendable`, a typed space is something. */
export function draftBlank(parts: readonly DraftPart[]): boolean {
  return parts.every((part) => part.kind === "text" && part.text === "");
}

/** One object as a message cites it: its name, and its durable text quoted after it when it keeps any. */
const objectCited = (object: ChipObject): string =>
  object.text === null || object.text.trim() === ""
    ? object.name
    : `${object.name}: "${object.text.replace(/\s+/gu, " ").trim()}"`;

/**
 * What a chip says in a message (four-views §11's interim send): a capture, the still's path (vendors read image
 * paths); a desk chip, what it carries in words — its objects' names and their durable text (`Note: "…"`, `Clock`,
 * `2 objects (Note: "…"; Clock)`). The desk chip's still rides on the chip: no door yet carries it into a message.
 */
export function chipMessage(chip: DraftChip): string {
  if (chip.kind === "capture") return chip.path;
  const [one, ...rest] = chip.objects;
  if (one === undefined) return chip.label;
  if (rest.length === 0) return objectCited(one);
  return `${chip.objects.length} objects (${chip.objects.map(objectCited).join("; ")})`;
}

/** The message a send carries until the agent seam exists (four-views §11):
 * the words as typed, and each chip as it cites itself (`chipMessage`). */
export function draftMessage(parts: readonly DraftPart[]): string {
  return parts
    .map((part) => (part.kind === "text" ? part.text : chipMessage(part.chip)))
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The @ being typed before the caret, if there is one: an @ at the start of a
 * word, and the word after it so far (`query`). `at` is the @'s offset in
 * `before`. An @ inside a word (an address) opens nothing. */
export function atQueryBefore(before: string): { at: number; query: string } | null {
  const match = /(^|\s)@([^\s@]*)$/u.exec(before);
  if (match === null) return null;
  return { at: match.index + (match[1]?.length ?? 0), query: match[2] ?? "" };
}

/** `parts` with the text from `start` to `end` of part `index` taken out and,
 * when `chip` is given, the chip set in its place with a space after it — a
 * chip never splits a word, so the caret lands after that space. */
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

/** Where Send to…'s chip will be set for this caret (`insertChipAt`'s place, before its space): the end of the word
 * the caret stands in, or the draft's end with no caret — `draftOffset`'s count. */
export function chipPlace(
  parts: readonly DraftPart[],
  caret: { readonly index: number; readonly offset: number } | null,
): number {
  const target = caret === null ? undefined : parts[caret.index];
  if (caret === null || target?.kind !== "text") return draftOffset(parts, parts.length, 0);
  return draftOffset(parts, caret.index, wordEnd(target.text, caret.offset));
}

/**
 * Send to…'s chip set in the draft (DESIGN.md §8 "Send to…": inserted at the caret; "it never splits a word"): at
 * the caret in part `caret.index` — moved on to the end of the word it stands in — as a token, a space set before it
 * when it would touch a word and `spliceDraft`'s after it; the caret after the chip and its space. With no caret (the
 * draft never held one), at the draft's end. Returns the new parts and the caret (`draftOffset`'s count).
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

/** The placeholder says who it goes to, not a slogan (DESIGN.md §8): at rest it
 * teaches the one way in, in every view; aimed, it names the target. */
export function linePlaceholder(aim: LineAim | null): string {
  return aim === null ? "Message, or type @ to add…" : `Message ${aim.name}…`;
}

/** What the line's note says after a send — what happened, and why when it is
 * not what was aimed at (DESIGN.md §9: say what happened). */
export type SendOutcome =
  | { readonly kind: "pasted"; readonly name: string }
  | { readonly kind: "copied" }
  | { readonly kind: "copied-off-screen"; readonly name: string }
  | { readonly kind: "copied-input-closed"; readonly name: string }
  /** D6 — the pane's terminal refused the paste for its size; `why` is its
   * numbers, in the line's words (`inputRefusalWhy`). */
  | { readonly kind: "copied-too-large"; readonly name: string; readonly why: string }
  | { readonly kind: "copy-refused" };

export function sendNote(outcome: SendOutcome): string {
  switch (outcome.kind) {
    case "pasted":
      return `Pasted into ${outcome.name}`;
    case "copied":
      return "Copied — no agent takes a message from here yet";
    case "copied-off-screen":
      return `Copied — ${outcome.name}'s pane is not on screen`;
    case "copied-input-closed":
      return `Copied — ${outcome.name}'s pane is not taking input`;
    case "copied-too-large":
      return `Copied — too large for ${outcome.name}: ${outcome.why}`;
    case "copy-refused":
      return "Not sent — the clipboard refused it";
  }
}

/** The create act each view puts in the line (One Frame FC-D3: the view's own
 * glyph; FR-3: only Canvas's is a bare plus). `key` is said in the tooltip,
 * never printed (FR-5). */
export interface CreateAct {
  readonly glyph: "plus" | "start" | "resume" | "jump";
  readonly name: string;
  readonly key: string | null;
}

/** `live`: History's chosen session runs on this desktop, so its create is
 * Jump to (P3) — History's line door says so. */
export function createActOf(view: FrameView, keys: "mac" | "other", live = false): CreateAct {
  switch (view) {
    case "godview":
      return { glyph: "start", name: "New terminal", key: keys === "mac" ? "⌘T" : "Ctrl+T" };
    case "history":
      return live
        ? { glyph: "jump", name: "Jump to this session", key: null }
        : { glyph: "resume", name: "Resume this session", key: null };
    default:
      return { glyph: "plus", name: "Objects", key: "B" };
  }
}
