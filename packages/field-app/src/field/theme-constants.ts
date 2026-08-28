// Leaf import, NOT the barrel: this module is reachable from the boot path
// (wizard-ui → ThemeToggleButton → here). The barrel USED to re-export
// GlLiftGroup, whose @vibecook/ice/r3f import pulled three + loro into the
// eager graph — the ESR splash split (269.8 KB initial) died that way at
// UA-3w; since 2026-08-28 the GL surface lives behind design-kit's /gl entry,
// but the barrel still reaches @vibecook/ice core through CardShell, so the
// leaf-import rule stands. bundle:assert (in pnpm verify) is the tripwire.
import { uiIconButtonClass } from "@vibefield/design-kit/primitives";

// v1 component class constants extracted from FieldView by 3b. Color math is
// an appearance-domain leaf so parsers and projections never import TSX UI.

export const roundButtonCls = (active: boolean) =>
  `${uiIconButtonClass} h-10 w-10${active ? " is-active" : ""}`;

export const fabCls = (active: boolean) => `absolute ${roundButtonCls(active)}`;
