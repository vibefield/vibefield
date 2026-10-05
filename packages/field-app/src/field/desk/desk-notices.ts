import { sayStatus } from "../../frame/status-line";
import type { ObjectWordState, ObjectWords } from "./desk-object-words";

// THE DESK'S NOTICES ON THE STATUS LINE (DK-11; DESIGN.md §8 "The status line", "The missing face"; R12, R24):
// a type the desk cannot draw — its objects wear ICE's missing face — and a type to remount (I25) are SAID ONCE
// under the head, in the bar's words ("Clock · plugin off"), never painted onto the object as an alarm and never
// per frame. The stage asks at each mount's first frame (DESK_READY) and whenever the desk's faults move: the
// types on the board are read, each one missing is said — once for its word, in this renderer's session. A type
// said for one word is said again only for another (off → can't draw), or after it was drawn again.

/** What the line last said of each type the desk draws as missing, by type. */
const said = new Map<string, ObjectWordState>();

/**
 * Say each missing type of `types` (the board's) on the status line, once for its word: "Clock · plugin off".
 * A type drawn again — or gone from the board — is forgotten, so a later loss is said again.
 */
export function announceMissing(
  types: Iterable<string>,
  words: (type: string) => ObjectWords,
): readonly ObjectWords[] {
  const missing = new Map<string, ObjectWords>();
  for (const type of types) {
    const w = words(type);
    if (w.state !== null) missing.set(type, w);
  }
  const spoken: ObjectWords[] = [];
  for (const [type, w] of missing) {
    if (w.state === null || said.get(type) === w.state) continue;
    said.set(type, w.state);
    sayStatus({ id: `missing:${type}:${w.state}`, text: w.label });
    spoken.push(w);
  }
  for (const type of [...said.keys()]) if (!missing.has(type)) said.delete(type);
  return spoken;
}

/** Test seam: nothing said yet. */
export function resetDeskNoticesForTest(): void {
  said.clear();
}
