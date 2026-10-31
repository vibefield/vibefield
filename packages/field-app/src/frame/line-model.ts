import type { FrameView } from "@vibefield/contracts";
import type { ViewKeys } from "./views";

// THE LINE'S MODEL (DESIGN.md §8 "The line", §10; One Frame FC-D3, FR-3; LN-D1,
// HN-L6). Since LN-D1 the line is `[views] snapshot create` in every view: the
// views track, SNAP's door, and the view's one act. The draft, @'s list, the mic
// and send left it for the thread they write into (LN-D3, Chat's composer), and
// their model went with them. What stays is plain data — the view's act and its
// key, the snapshot's words, a key as `aria-keyshortcuts` spells it — and
// nothing here knows a DOM exists.

/** The create act each view puts in the line (One Frame FC-D3: the view's own
 * glyph; FR-3: only Canvas's is a bare plus). `key` is said in the tooltip,
 * never printed (FR-5); `title`, when the act says where it acts, is the name
 * the tooltip says in its place (HN-7: "New terminal in vibe-field"). */
export interface CreateAct {
  readonly glyph: "plus" | "start";
  readonly name: string;
  readonly key: string | null;
  readonly title?: string;
}

/** New terminal (One Frame FR-2, §11): Godview's create, and History's since
 * HN-7 — its glyph and its key in both. */
function newTerminalAct(keys: ViewKeys): CreateAct {
  return { glyph: "start", name: "New terminal", key: keys === "mac" ? "⌘T" : "Ctrl+T" };
}

/** The view's one act, or null where the view has none on the line yet: the
 * Assistant is not built (FC-D2), so no window is ever in it, and its act comes
 * with Chat (SP-1) — never Canvas's Objects drawn in its place. `project`: the
 * project History's room shows (its name), where History's create opens its
 * terminal — History's line door says so. */
export function createActOf(
  view: FrameView,
  keys: ViewKeys,
  project: string | null = null,
): CreateAct | null {
  switch (view) {
    case "canvas":
      return { glyph: "plus", name: "Objects", key: "B" };
    case "godview":
      return newTerminalAct(keys);
    case "history": {
      // LN-D2 (HN-7): Godview's act, in the folder of the project the room
      // shows — which its tooltip names. Resume and Jump to are the chosen
      // session's acts now: its row's, ④'s head's and the palette's.
      const act = newTerminalAct(keys);
      return project === null ? act : { ...act, title: `${act.name} in ${project}` };
    }
    case "assistant":
      return null;
  }
}

const ARIA_MODIFIERS: Readonly<Record<string, string>> = {
  "⌃": "Control+",
  "⌥": "Alt+",
  "⇧": "Shift+",
  "⌘": "Meta+",
};

/** A key as the frame says it ("⌘T", "Ctrl+T", "⌃⌘A", "B") in the spelling
 * `aria-keyshortcuts` reads ("Meta+T", "Control+T", "Control+Meta+A", "B") — one
 * reading for every key the line prints, so a new act's key is never spelled
 * by hand a second time. */
export function ariaKeys(said: string): string {
  return said
    .replace(/[⌃⌥⇧⌘]/gu, (mark) => ARIA_MODIFIERS[mark] ?? "")
    .replace(/\bCtrl\b/gu, "Control");
}

// ── THE SNAPSHOT (HN-D2; DESIGN.md §8 "The line"; SNAP-D3) ─────────────────────
// SNAP's door on the line, between the views and the view's act: it opens the
// snapshot tool as ⌃⌘A does, and what the tool keeps is dealt into the hand as a
// picture card from its region (`cards-sources.ts`). The clipboard drawer's
// capture door retired with the drawer; this is where it moved.

/** Its name, as its tooltip and its accessible name say it. */
export const SNAPSHOT = "Snapshot";

/** Why it waits on a host with no capture door (a browser harness, the
 * catalog): the clipboard drawer's honest word for the same door (SNAP-D5 —
 * present, disabled, honest). */
export const SNAPSHOT_NO_DOOR = "no capture here";

/** Why it waits once the tool has answered that no capture helper exists here
 * — a platform with none, or a tree before its first `build:screenshot-helper`
 * (`capture-state.ts`; R-B 4): the Snap tile's words, as `captureRefusal` says
 * the same refusal on the note. */
export const SNAPSHOT_NO_HELPER = "no capture helper on this platform";

/** Its key as the frame says it: MAIN's, taken above the page in
 * `before-input-event` (`window-chords.ts`; the View menu's Take Screenshot) —
 * ⌃⌘A on the Mac, Alt+A elsewhere. The page never hears it, so the line binds
 * none; the tooltip only says it. */
export function snapshotKey(keys: ViewKeys): string {
  return keys === "mac" ? "⌃⌘A" : "Alt+A";
}
