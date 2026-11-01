import { type DraftChip, type DraftPart, draftOffset } from "./composer-draft";

// THE DRAFT'S EDITOR, AS THE DOM HOLDS IT (SP-1d; DESIGN.md §8 "Chat's composer", the draft). While a person types,
// the editor's DOM is the truth; these read it into parts and put the caret back after the controller redraws it.
// Restored from the line's controller in git (`0e2ad08bc:packages/field-app/src/frame/Composer.tsx`, its editor
// helpers); a chip is found by its `data-chip-id`, and a `<br>` the browser leaves is skipped.

/** @'s list's width (DESIGN.md §8: "316 wide", the line's). */
export const AT_WIDTH_PX = 316;

/** A caret in the draft: a run of text and an offset in it. */
export interface DraftCaret {
  readonly index: number;
  readonly offset: number;
}

/** The editor's DOM read as parts (adjacent text joined), and the caret in them when it is collapsed in a run of
 * text. */
export function readEditor(
  editor: HTMLElement,
  chips: ReadonlyMap<string, DraftChip>,
): { parts: DraftPart[]; caret: DraftCaret | null } {
  const parts: DraftPart[] = [];
  let caret: DraftCaret | null = null;
  const selection = editor.ownerDocument.getSelection();
  const anchor =
    selection !== null && selection.rangeCount > 0 && selection.isCollapsed
      ? selection.anchorNode
      : null;
  const anchorOffset = selection?.anchorOffset ?? 0;
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node as Text).data;
      const last = parts[parts.length - 1];
      const base = last?.kind === "text" ? last.text.length : 0;
      if (last?.kind === "text") parts[parts.length - 1] = { kind: "text", text: last.text + text };
      else parts.push({ kind: "text", text });
      if (node === anchor) caret = { index: parts.length - 1, offset: base + anchorOffset };
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const id = node.dataset["chipId"];
    if (id !== undefined) {
      const chip = chips.get(id);
      if (chip !== undefined) parts.push({ kind: "chip", chip });
      return;
    }
    if (node.tagName === "BR") return;
    node.childNodes.forEach(visit);
  };
  editor.childNodes.forEach(visit);
  return { parts, caret };
}

/** The caret read as one place in the draft (`draftOffset`'s count), or null when it is not in a run of text. */
export function caretPlace(read: {
  readonly parts: readonly DraftPart[];
  readonly caret: DraftCaret | null;
}): number | null {
  return read.caret === null ? null : draftOffset(read.parts, read.caret.index, read.caret.offset);
}

/** A place counted that way, back as a run of text and an offset in it — null past the draft's end, or on a chip. */
export function caretOf(parts: readonly DraftPart[], linear: number): DraftCaret | null {
  let left = linear;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    if (part === undefined) continue;
    if (part.kind === "text") {
      if (left <= part.text.length) return { index, offset: left };
      left -= part.text.length;
    } else left -= 1;
  }
  return null;
}

/** Put the caret `linear` places into the editor (`draftOffset`'s count). */
export function placeCaret(editor: HTMLElement, linear: number): void {
  const selection = editor.ownerDocument.getSelection();
  if (selection === null) return;
  const range = editor.ownerDocument.createRange();
  let left = linear;
  let placed = false;
  for (const node of Array.from(editor.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node as Text).data.length;
      if (left <= length) {
        range.setStart(node, left);
        placed = true;
        break;
      }
      left -= length;
    } else if (node instanceof HTMLElement && node.dataset["chipId"] !== undefined) {
      if (left === 0) {
        range.setStartBefore(node);
        placed = true;
        break;
      }
      left -= 1;
      if (left === 0 && node.nextSibling === null) {
        range.setStartAfter(node);
        placed = true;
        break;
      }
    }
  }
  if (!placed) {
    range.selectNodeContents(editor);
    range.collapse(false);
  } else range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Plain text at the editor's caret — a paste or a drop, never markup (DESIGN.md §8: "⌘V pastes into it as plain text
 * on one line"): its line breaks flattened to a space, since the draft is one line. Through the browser's own insert
 * where it has one, so its undo keeps it; else by a range, after which `typed` is told, as typing would tell it. */
export function insertPlainText(editor: HTMLElement, text: string, typed: () => void): void {
  const flat = text.replace(/\s*[\r\n]+\s*/gu, " ");
  if (flat === "") return;
  const doc = editor.ownerDocument;
  if (typeof doc.execCommand === "function" && doc.execCommand("insertText", false, flat)) return;
  const selection = doc.getSelection();
  if (selection === null || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = doc.createTextNode(flat);
  range.insertNode(node);
  // the caret after what was put in, as typing leaves it (an @ typed there opens @'s list)
  range.setStart(node, node.length);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  typed();
}

/** @'s box's left, in the composer's own px, for a point at window x: 10 before it, kept inside the composer. */
export function atLeftAt(composer: HTMLElement, x: number): number {
  const box = composer.getBoundingClientRect();
  const room = Math.max(8, box.width - AT_WIDTH_PX - 8);
  return Math.min(room, Math.max(8, Math.round(x - box.left - 10)));
}

/** Where @'s list grows from (DESIGN.md §8: "its left 10 before the @"): `back` characters before the caret is the
 * @. */
export function atAnchor(composer: HTMLElement, editor: HTMLElement, back: number): number {
  let x = editor.getBoundingClientRect().left;
  const selection = editor.ownerDocument.getSelection();
  const node = selection?.anchorNode;
  if (node?.nodeType === Node.TEXT_NODE && selection !== null && selection !== undefined) {
    const range = editor.ownerDocument.createRange();
    range.setStart(node, Math.max(0, selection.anchorOffset - back));
    range.collapse(true);
    const rect =
      typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
    if (rect !== null && (rect.left !== 0 || rect.width !== 0)) x = rect.left;
  }
  return atLeftAt(composer, x);
}
