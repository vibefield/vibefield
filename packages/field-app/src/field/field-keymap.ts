import type { KeymapEntry } from "@vibecook/ice/react";
import { useMemo } from "react";
import { setFieldTool } from "../field-engine";

// The field's keymap overrides (I1 consumed, ice 0.4.0): overrides ARE the
// engine's arbitration surface. DK-8: `vibefield.field-tools` retired, and with
// it the comment command `c` and ⇧C invoked on a selection — VibeField's comment
// seam is the comment pad now, an object laid on the desk (`plugins/comment-pad`;
// the bar's menu is DK-11's, DK-D24). What stays is the DK-2 guard: the engine's
// own `c` is the connect tool's shortcut, and the desk's canvas allows only
// `desk.select` and `pan` — ICE THROWS for an illegal tool — so `c` is REFUSED
// (logged once, `setFieldTool`), never a throw out of the keymap (DK-D24: `c` no
// longer connects). The desk keymap's own entries are `<Desk>`'s.

export function buildFieldKeymapOverrides(): readonly KeymapEntry[] {
  return [
    {
      key: "c",
      run: (engine) => {
        setFieldTool(engine, "connect");
      },
    },
  ];
}

/** Stable entries — the array never changes identity, so the keymap attach never re-arms. */
export function useFieldKeymapOverrides(): readonly KeymapEntry[] {
  return useMemo(() => buildFieldKeymapOverrides(), []);
}
