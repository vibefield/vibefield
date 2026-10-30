/**
 * Where the caret is (HN-L3: a paste goes where the caret is). ONE test for every key and act the
 * frame leaves to a field — B (Objects), ⌫ (the hand at rest), ⌘V with no caret and a drop from
 * another app: a field a person types in holds the caret — an input for text, a text area,
 * anything editable. A select, a checkbox, a button, a range and the like hold none: a key there
 * is the frame's, and a paste there the hand's. A drop also passes over a field that takes no
 * insert, disabled or read-only. A place registered for cards (a pane's own text area, Chat's
 * prompt) outranks the field, and takes a drop as the hand's (`card-drag.ts`). Its own module, so
 * the suites that stand in for the drag machine (cards, frame-owner, peek) keep the real test.
 */

/** The inputs a person types text into, with a caret. An input with no type, or a type this
 * browser does not know, reads as "text"; a number takes typed and pasted digits as text does. */
const TEXT_ENTRY: ReadonlySet<string> = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
]);

/** Is this a field, where the caret is: an input for text, a text area, anything editable? */
export function isField(target: EventTarget | null | undefined): boolean {
  if (target instanceof HTMLInputElement) return TEXT_ENTRY.has(target.type);
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "TEXTAREA" ||
    target.isContentEditable ||
    target.closest("[contenteditable='true']") !== null
  );
}

/** Does this field take a drop as its own insert: a field, neither disabled nor read-only? */
export function isDropField(target: EventTarget | null | undefined): boolean {
  if (!isField(target)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return !target.matches(":disabled") && !target.readOnly;
  }
  return true;
}
