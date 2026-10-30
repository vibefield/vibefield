import type { FrameView } from "@vibefield/contracts";
import { type ReactElement, useCallback, useEffect, useRef } from "react";
import { useReducedMotion } from "../field/desk/bar/bar-motion";
import { artifactsWords, useArtifactsStanding } from "./artifacts-standing";
import { useGodviewDeckMaximized } from "./deck-door";
import { type FrameSurface, foldSurface } from "./frame-surface";
import { PackageCircleView } from "./PackageCircleView";
import { useFindStep } from "./Peek";

// THE PACKAGE CIRCLE'S CONTROLLER (DESIGN.md §8 "The head" — the package
// circle; PL-D2, HN-8). It owns what the circle DOES — that it stands under a
// cover only (on Canvas the pill holds the package), where it stands (the
// head's left, or the terminals' title bar while they are maximized, stepping
// with search), what its press asks, and where the keyboard goes when its
// sheet folds — and nothing it shows, which is `PackageCircleView`'s. The sheet
// it grows is NOT its own: it is the pill's (`Head.tsx`), on its Artifacts
// shelf, and which shelf shows is the frame's one value (`frame-surface.ts`,
// `artifacts`), which this reads and asks — so under a cover the sheet holds
// Artifacts alone, and opening it folds whatever else was open.

export interface PackageCircleProps {
  readonly view: FrameView;
  /** The frame's open surface, from its one owner. */
  readonly surface: FrameSurface | null;
  readonly onSurfaceChange: (next: FrameSurface | null) => void;
  /** The titles of the artifacts whose source is unavailable: the head's own
   * reading of the catalog, which the pill's package wears too. */
  readonly unavailable: readonly string[];
}

export function PackageCircle({
  view,
  surface,
  onSurfaceChange,
  unavailable,
}: PackageCircleProps): ReactElement | null {
  const open = surface === "artifacts";
  // GV-D11 with PL-D2: while Godview's terminals are maximized the same button
  // stands at their title bar's left end, and it steps out of the bar and back
  // to the head on search's own two steps, so the two never step apart
  const deckMaximized = useGodviewDeckMaximized();
  const place = useFindStep(view === "godview", deckMaximized, useReducedMotion());
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Escape gives the keyboard back to the button that opened the sheet (§8
  // "Artifacts — the Artifacts shelf's contents"): this one, when it did.
  const opened = useRef(false);

  const press = useCallback(() => {
    if (open) {
      onSurfaceChange(foldSurface(surface, "artifacts"));
      return;
    }
    opened.current = true;
    onSurfaceChange("artifacts");
  }, [open, onSurfaceChange, surface]);

  // The sheet folded: if the keyboard was inside it, it has nowhere to be — the
  // folded sheet is inert — and it comes back here. Anything else that took it
  // as the sheet folded (the palette's field, a press elsewhere) keeps it.
  useEffect(() => {
    if (open || !opened.current) return;
    opened.current = false;
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
      words={artifactsWords(unavailable)}
      dot={unavailable.length > 0}
      onPress={press}
      buttonRef={buttonRef}
      bar={place.bar}
      step={place.step}
    />
  );
}

/** The circle as the frame holds it (ChromeLayer): its dot and its words from
 * the head's reading of the catalog over this window's fieldd client
 * (`artifacts-standing.ts`), so the dot stands while the sheet is shut and
 * whether the Hub is running or not. */
export function FramePackageCircle({
  view,
  surface,
  onSurfaceChange,
}: Omit<PackageCircleProps, "unavailable">): ReactElement | null {
  const standing = useArtifactsStanding();
  return (
    <PackageCircle
      view={view}
      surface={surface}
      onSurfaceChange={onSurfaceChange}
      unavailable={standing.unavailable}
    />
  );
}
