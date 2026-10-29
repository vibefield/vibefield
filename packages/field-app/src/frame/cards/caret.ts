/**
 * Where the caret is (HN-L3: a paste goes where the caret is). A field — an input, a text area, a
 * select, anything editable — takes a paste there, and a drop from another app there, itself;
 * unless a place registered for cards answers for it (a pane's own text area, Chat's prompt),
 * which takes a drop as the hand's (`card-drag.ts`). One test for the paste, the drop and the
 * carried card's answer.
 */

/** Is this a field, where the caret is? */
export function isField(target: EventTarget | null | undefined): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable ||
    target.closest("[contenteditable='true']") !== null
  );
}
