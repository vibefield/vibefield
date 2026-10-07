// Leaf import, NOT the barrel: this module is reachable from the boot path
// (wizard-ui → ThemeToggleButton → here). The barrel once pulled three + loro
// into the eager graph through the kit's GL card — the ESR splash split (269.8 KB
// initial) died that way at UA-3w. DK-17 deleted the kit's card dressing, so the
// barrel no longer reaches ICE at all, but the leaf-import rule stands (UI_SYSTEM
// "Import kit leaves"). bundle:assert (in pnpm verify) is the tripwire.
import { uiIconButtonClass } from "@vibefield/design-kit/primitives";

// v1 component class constants extracted from FieldView by 3b. Color math is
// an appearance-domain leaf so parsers and projections never import TSX UI.

export const roundButtonCls = (active: boolean) =>
  `${uiIconButtonClass} h-10 w-10${active ? " is-active" : ""}`;

export const fabCls = (active: boolean) => `absolute ${roundButtonCls(active)}`;
