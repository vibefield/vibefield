import { type RefObject, useCallback, useEffect, useRef } from "react";
import { setMonitorHoldsKeys } from "../monitor/launcher-keys";
import { AIM_HISTORY, type AimPoint, headingIntoSide } from "./aim";
import { type ColumnParts, standOf } from "./column-parts";

// A COLUMN'S HOLD ON ITS CARDS (DESIGN.md §8 "Godview's profiles column": "The reach", "Focus is pointing", "Pinned";
// since WL-1, 2026-11-23, "Godview's work column", which keeps the same hold). Three pieces of the profiles column's
// controller, moved here unchanged so its twin holds its cards the same way: which focus is the keyboard's, where the
// pointer is heading, and what a pinned card holds.

/** UM-R-F (fix, the review's F1; §8 "Focus is pointing"): only the keyboard's focus points. Chromium focuses a button
 * the pointer presses, and the window hands that focus back when it returns. So after a press, focus is the pointer's
 * until a key is pressed with no ⌘, ⌃ or ⌥ held (⌘Tab leaves the window; it is not a walk). True while the last focus
 * came from a press. */
export function usePressedFocus(): RefObject<boolean> {
  const pressed = useRef(false);
  useEffect(() => {
    const onPress = (): void => {
      pressed.current = true;
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      pressed.current = false;
    };
    window.addEventListener("pointerdown", onPress, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  return pressed;
}

/** §8 "The reach" (2026-11-16): the pointer's last few points while a card shows, read as it crosses into a target
 * (`pointerover` comes before the target's enter), so the column knows whether it is on its way into the card (`aim.ts`,
 * on the side its cards stand). Answers `useColumnPointer`'s `headingTo`, the same function while its inputs are. */
export function useCardAim(
  showing: string | null,
  layer: HTMLElement | null | undefined,
  column: RefObject<HTMLElement | null>,
  parts: ColumnParts,
): (shown: string) => boolean {
  const trail = useRef<AimPoint[]>([]);
  useEffect(() => {
    trail.current = [];
    if (showing === null) return;
    const note = (event: PointerEvent): void => {
      const points = trail.current;
      points.push({ x: event.clientX, y: event.clientY });
      if (points.length > AIM_HISTORY) points.shift();
    };
    window.addEventListener("pointermove", note, { capture: true, passive: true });
    window.addEventListener("pointerover", note, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointermove", note, { capture: true });
      window.removeEventListener("pointerover", note, { capture: true });
    };
  }, [showing]);
  return useCallback(
    (shown: string): boolean => {
      const points = trail.current;
      const from = points[0];
      const to = points[points.length - 1];
      if (from === undefined || to === undefined || from === to) return false;
      const stand = standOf(layer ?? column.current, parts, shown);
      const card = stand?.firstElementChild ?? stand;
      if (!card) return false;
      const rect = card.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      return headingIntoSide(from, to, rect, parts.side);
    },
    [layer, column, parts],
  );
}

/** Ruling 11 (UM-3): a pinned card holds Godview's keys, so Esc closes it before a pane hears it (`close`, the column's
 * one close), and a press outside `inside` (the pill and its stands) lets go of the pin (`release`). Both must keep
 * their identity while the pin stands. */
export function usePinHold(
  pinned: string | null,
  close: () => void,
  release: () => void,
  inside: string,
): void {
  useEffect(() => {
    if (pinned === null) return;
    setMonitorHoldsKeys(true);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target;
      // the cards stand in their own layer, so "inside" is the pill or a stand
      if (target instanceof Element && target.closest(inside)) return;
      release();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      setMonitorHoldsKeys(false);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [pinned, close, release, inside]);
}
