// Leaf import, NOT the barrel: this module is reachable from the boot path
// (wizard-ui → ThemeToggleButton → here), and the barrel re-exports GlLiftGroup,
// whose @vibecook/ice/r3f import pulls three + loro into the eager graph — the
// ESR splash split (269.8 KB initial) died that way at UA-3w. The bundle assert
// in smoke:canvas is the tripwire; keep class-name imports on leaves.
import { uiIconButtonClass } from "@vibefield/design-kit/primitives";

// v1 component class constants extracted from FieldView by 3b. Color math is
// an appearance-domain leaf so parsers and projections never import TSX UI.

export const roundButtonCls = (active: boolean) =>
  `${uiIconButtonClass} h-10 w-10${active ? " is-active" : ""}`;

export const fabCls = (active: boolean) => `absolute ${roundButtonCls(active)}`;
