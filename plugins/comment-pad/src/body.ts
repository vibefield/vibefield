// THE PAD'S SHEET — its TEXT PART (ICE K8a, `defineObject({ host: { text } })`): the part of a pad the desk's ONE
// editor is lent to, exactly as the note's body and the calendar's day line lease it. A TAP on a pad — a press and
// release within the drag slop, the primary button, no modifier, the pad not carried — puts the editor on it,
// the caret where the tap fell in its writing (the end below the last line). The pad under the tap is the
// interaction stack's exact hit (the editor's `tapHit`); a tap whose pointer is gone takes nothing.
//
// The editor is the DESK's and invisible (transparent text and caret): it takes what the platform does best —
// keys, key repeat, IME, dictation, the caret's index — and the pad draws the rest (its draft, its caret) from its
// writing. The lease: `value` (the cell's text between sessions, so a peer's or an undo's reaches the field; null
// while a session is open — the field is the truth), `input` (the session's draft), `caret`, `place` (the
// writing box on screen, from the camera — the door's `Camera`), `idle` (a session's end), `ended` (the pad let
// go), `live` (still alive and in the frame — the door's `Active`; a delete or a nav cut ends it).

import {
  Active,
  Camera,
  type EditorLease,
  type Entity,
  type KindDriver,
  type ObjectDomHost,
  PEN_FACES,
  type TextPart,
} from "@vibefield/plugin-sdk/desk";
import { COMMENT_PAD_PART } from "./ids";
import { PAD, PAD_FACE, PAD_HAND, writingBox } from "./law";
import type { PadGeometry } from "./layout";
import { createPadTyping, type PadCell, type PadTyping } from "./typing";
import type { PadWriting } from "./writing";

/** The pad's driver (`ObjectBinding.drivers`): what its text part asks of the desk's kind host. */
export interface PadDriver extends KindDriver {
  /** Is `e` a comment pad? */
  readonly isPad: (e: Entity) => boolean;
  /** The pad's writing on this desk (its local). */
  readonly writing: () => PadWriting | undefined;
}

/** The pad's sheet: its text part (the desk routes taps to it) and the doors a smoke or a key uses. */
export interface PadSheet extends TextPart {
  /** Put the editor on pad `e`, the caret before glyph `index` (the end by default). False for a non-pad or a read-only document. */
  focus(e: Entity, index?: number): boolean;
  /** The pad being written, or undefined (the editor lent elsewhere, or to nothing). */
  editing(): Entity | undefined;
  /** The session under it (a test's witness). */
  readonly typing: PadTyping;
}

/** A cell of the compiled object by its group's name (`ink`, `props`). */
function cellOf(host: ObjectDomHost, name: string): PadCell | undefined {
  return host.object.groups.find((g) => g.name === name)?.component;
}

/** The pad's text part, or undefined where the desk gave it nothing to lease from (no driver: no sheet). */
export function createPadSheet(host: ObjectDomHost): PadSheet | undefined {
  const driver = host.driver as PadDriver | undefined;
  const ink = cellOf(host, "ink");
  const props = cellOf(host, "props");
  if (driver === undefined || ink === undefined || props === undefined) return undefined;
  const { editor, world } = host;
  const writing = (): PadWriting | undefined => driver.writing();
  const typing = createPadTyping({ world, docs: host.docs, ink, props, writing });
  const font = PEN_FACES[PAD_FACE] ?? { family: "Caveat", weight: 500 };
  /** The pad being written and ITS lease — one lease a pad, so a tap on the same pad keeps it and a tap on another hands over. */
  let current: { readonly entity: Entity; readonly lease: EditorLease } | undefined;

  const leaseFor = (e: Entity): EditorLease => {
    const lease: EditorLease = {
      part: COMMENT_PAD_PART,
      label: "write on the comment pad",
      // between sessions the cell's text reaches the field (a peer, an undo); while a session is open the field is the truth
      value: () => (typing.open() ? null : (typing.committed(e)?.text ?? "")),
      input(value) {
        typing.input(value);
        writing()?.setCaret(e, editor.element.selectionStart);
      },
      // Escape lets the pad go (the keymap's gate 1 stands down; the release is ours)
      keydown(ev) {
        if (ev.key !== "Escape") return false;
        editor.release(lease);
        return true;
      },
      caret(index) {
        writing()?.setCaret(e, index);
      },
      place() {
        const G = host.geometryOf(e) as PadGeometry | undefined;
        const cam = world.getResource(Camera);
        if (G === undefined || cam === undefined) return null;
        const z = cam.zoom;
        const s = G.scale;
        const box = writingBox(G.size.w, G.size.h, PAD);
        // the writing box on screen: pad units → world (about the sheet's centre, the lift's scale in) → container px
        const wx = G.centre[0] + (box.x - G.size.w / 2) * s;
        const wy = G.centre[1] + (box.y - G.size.h / 2) * s;
        return {
          x: (wx - cam.x) * z,
          y: (wy - cam.y) * z,
          w: box.w * s * z,
          h: box.h * s * z,
          fontPx: PAD_HAND.size * s * z,
          lineHeight: PAD_HAND.size * PAD_HAND.lineHeight * s * z,
          wrap: true,
          font,
        };
      },
      idle() {
        typing.commit();
      },
      ended() {
        if (typing.editing() === e) typing.end();
        if (current?.entity === e) {
          current = undefined;
          writing()?.setCaret(undefined);
        }
      },
      // a delete or a nav cut ends the writing
      live: () => world.isAlive(e) && world.hasTag(e, Active),
    };
    return lease;
  };

  /** The lease a pad takes, its session begun — or undefined: refused (dead, not a pad, a read-only document). */
  const take = (e: Entity): EditorLease | undefined => {
    if (!world.isAlive(e) || !driver.isPad(e)) return undefined;
    if (!typing.begin(e)) return undefined;
    if (current?.entity === e && editor.lease() === current.lease) return current.lease;
    current = { entity: e, lease: leaseFor(e) };
    return current.lease;
  };

  /** Where a tap at world (wx, wy) puts the caret in `e`'s writing: by its last layout, else at the end. */
  const caretAtTap = (e: Entity, wx: number, wy: number): number => {
    const end = typing.text(e).length;
    const G = host.geometryOf(e) as PadGeometry | undefined;
    if (G === undefined) return end;
    const x = (wx - G.centre[0]) / G.scale + G.size.w / 2;
    const y = (wy - G.centre[1]) / G.scale + G.size.h / 2;
    return writing()?.caretIndexAt(e, x, y) ?? end;
  };

  return {
    part: COMMENT_PAD_PART,
    tap({ wx, wy, found, hit }) {
      if (!found || hit === undefined || !driver.isPad(hit)) return undefined;
      const lease = take(hit);
      if (lease === undefined) return undefined;
      return { lease, caret: caretAtTap(hit, wx, wy) };
    },
    focus(e, index) {
      const lease = take(e);
      if (lease === undefined) return false;
      editor.lend(lease, index ?? typing.text(e).length);
      return true;
    },
    editing: () =>
      current !== undefined && editor.lease() === current.lease ? current.entity : undefined,
    typing,
  };
}
