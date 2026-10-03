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

export type DraftChip = CaptureChip;

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

/** The message a send carries until the agent seam exists (four-views §11):
 * the words as typed, and each chip as the path it cites. */
export function draftMessage(parts: readonly DraftPart[]): string {
  return parts
    .map((part) => (part.kind === "text" ? part.text : part.chip.path))
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
  | { readonly kind: "copy-refused" };

export function sendNote(outcome: SendOutcome): string {
  switch (outcome.kind) {
    case "pasted":
      return `Pasted into ${outcome.name}`;
    case "copied":
      return "Copied — no agent takes a message from here yet";
    case "copied-off-screen":
      return `Copied — ${outcome.name}'s pane is not on screen`;
    case "copy-refused":
      return "Not sent — the clipboard refused it";
  }
}

/** The create act each view puts in the line (One Frame FC-D3: the view's own
 * glyph; FR-3: only Canvas's is a bare plus). `key` is said in the tooltip,
 * never printed (FR-5). */
export interface CreateAct {
  readonly glyph: "plus" | "start" | "resume";
  readonly name: string;
  readonly key: string | null;
}

export function createActOf(view: FrameView, keys: "mac" | "other"): CreateAct {
  switch (view) {
    case "godview":
      return { glyph: "start", name: "New terminal", key: keys === "mac" ? "⌘T" : "Ctrl+T" };
    case "history":
      return { glyph: "resume", name: "Resume this session", key: null };
    default:
      return { glyph: "plus", name: "Objects", key: "B" };
  }
}
