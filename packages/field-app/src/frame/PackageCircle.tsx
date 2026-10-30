import type { FrameView } from "@vibefield/contracts";
import { type ReactElement, useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "../field/desk/bar/bar-motion";
import { useGodviewDeckMaximized } from "./deck-door";
import { type FrameSurface, foldSurface, type SheetShelf } from "./frame-surface";
import { useArtifactsDot } from "./head-artifacts";
import { PackageCircleView } from "./PackageCircleView";
import { useFindStep } from "./Peek";

// THE PACKAGE CIRCLE'S CONTROLLER (DESIGN.md §8 "The head" — the package
// circle; PL-D2, HN-8). It owns what the circle DOES — that it stands under a
// cover only (on Canvas the pill holds the package), where it stands (the
// head's left, or the terminals' title bar while they are maximized, stepping
// with search), what its press asks, and where the keyboard goes as its sheet
// grows and folds — and nothing it shows, which is `PackageCircleView`'s. The
// sheet it grows is NOT its own: it is the pill's (`Head.tsx`), on its
// Artifacts shelf, and which shelf shows is the frame's one value
// (`frame-surface.ts`, `artifacts`), which this asks — and reads as the owner
// reads it for the view (`useShownShelf`), the head's own reading — so under a
// cover the sheet holds Artifacts alone, and opening it folds whatever else was
// open. Its dot is the head's reading of the catalog (`head-artifacts.ts`), the
// pill's package's own, so the two never say different things.

export interface PackageCircleProps {
  readonly view: FrameView;
  /** The frame's open surface, from its one owner. */
  readonly surface: FrameSurface | null;
  /** The shelf the sheet shows: the owner's one reading of `surface` for the
   * view (`useShownShelf`), the head's — so the circle steps aside exactly
   * while its sheet shows, never for the frame between a change of view and
   * the line's fold. */
  readonly shelf: SheetShelf | null;
  readonly onSurfaceChange: (next: FrameSurface | null) => void;
}

/** The covered sheet's own package (`HeadView`'s): where a keyboard's open
 * takes the keyboard. */
const SHEET_PACKAGE = ".vf-head-sheet .vf-head-pack";

export function PackageCircle({
  view,
  surface,
  shelf,
  onSurfaceChange,
}: PackageCircleProps): ReactElement | null {
  const open = shelf === "artifacts";
  const dot = useArtifactsDot();
  // GV-D11 with PL-D2: while Godview's terminals are maximized the same button
  // stands at their title bar's left end, and it steps out of the bar and back
  // to the head on search's own two steps, so the two never step apart
  const deckMaximized = useGodviewDeckMaximized();
  const place = useFindStep(view === "godview", deckMaximized, useReducedMotion());
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Escape and the fold give the keyboard back to the button that opened the
  // sheet (§8 "The head"): this one, when it did.
  const opened = useRef(false);
  // A keyboard's open takes the keyboard on into the sheet, to its own package
  // (§8 "The head"): the circle steps aside under the sheet, and a focus left
  // on it would be a focus no one sees.
  const intoSheet = useRef(false);

  const press = useCallback(
    (keyboard: boolean) => {
      if (open) {
        onSurfaceChange(foldSurface(surface, "artifacts"));
        return;
      }
      opened.current = true;
      intoSheet.current = keyboard;
      onSurfaceChange("artifacts");
    },
    [open, onSurfaceChange, surface],
  );

  // The sheet shows, opened from the keyboard: it is no longer inert, and its
  // own package takes the keyboard.
  useEffect(() => {
    if (!open || !intoSheet.current) return;
    intoSheet.current = false;
    document.querySelector<HTMLElement>(SHEET_PACKAGE)?.focus({ preventScroll: true });
  }, [open]);

  // The sheet folded: if the keyboard was inside it, it has nowhere to be — the
  // folded sheet is inert — and it comes back here, on Esc as on any fold (the
  // head keeps no opener of its own under a cover). Anything else that took it
  // as the sheet folded (the palette's field, a press elsewhere) keeps it.
  useEffect(() => {
    if (open || !opened.current) return;
    opened.current = false;
    intoSheet.current = false;
    const holder = document.activeElement;
    if (holder === null || holder === document.body || holder.closest("[inert]") !== null) {
      buttonRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // On Canvas there is no circle: the pill holds the package (PL-D1).
  if (view === "canvas") return null;
  return (
    <PackageCircleView
      open={open}
      dot={dot}
      onPress={press}
      buttonRef={buttonRef}
      bar={place.bar}
      step={place.step}
    />
  );
}
