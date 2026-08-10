import { type CanvasEngine, selectedEntities } from "@vibecook/ice";
import type { KeymapEntry } from "@vibecook/ice/react";
import { type MutableRefObject, useMemo, useRef } from "react";
import * as commandRegistry from "../plugin-host/command-registry";
import { FIELD_WINDOW_ID } from "./ChromeLayer";

// The field's keymap overrides (I1 consumed, ice 0.4.0): overrides ARE the
// engine's arbitration surface, so the C key's "selection decides" behavior
// lives here instead of a capture-phase stopPropagation racing the window
// bubble (the folklore ChromeLayer carried since the widgetlab port). Parity
// with the retired trap is exact:
//  - C with a selection wraps it in a comment — still a canvas-context
//    invocation of field-tools' DECLARED command through the SPINE registry,
//    never a plugin import (R10);
//  - C with none re-issues the engine default this entry replaces (connect
//    tool). With Settings open the comment stays suppressed (the trap's gate)
//    while the tool shortcut behaves exactly as it always did — the default
//    keymap never knew Settings existed;
//  - ⇧C keeps the old capture branch's comment-only behavior (no engine
//    default ever bound it).
// The engine keymap's own editable guard runs BEFORE overrides, so typing "c"
// into a widget's field never arrives here.

function spawnCommentAroundSelection(engine: CanvasEngine): boolean {
  const sel = selectedEntities(engine.world);
  if (sel.length === 0) return false;
  void commandRegistry.invoke("vibefield.field-tools.comment-around-selection", undefined, {
    source: "canvas-context",
    windowId: FIELD_WINDOW_ID,
    selection: sel.map((en) => String(en)),
    userGesture: true,
  });
  return true;
}

export function buildFieldKeymapOverrides(
  suppressComment: MutableRefObject<boolean>,
): readonly KeymapEntry[] {
  return [
    {
      key: "c",
      run: (engine) => {
        if (!suppressComment.current && spawnCommentAroundSelection(engine)) return;
        engine.ops.setTool("connect");
      },
    },
    {
      key: "c",
      shift: true,
      run: (engine) => {
        if (!suppressComment.current) spawnCommentAroundSelection(engine);
      },
    },
  ];
}

/** Stable entries whose runs read the live gate through a ref — the array
 * never changes identity, so the keymap attach never re-arms. */
export function useFieldKeymapOverrides(suppressComment: boolean): readonly KeymapEntry[] {
  const ref = useRef(suppressComment);
  ref.current = suppressComment;
  return useMemo(() => buildFieldKeymapOverrides(ref), [ref]);
}
