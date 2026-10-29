import { type ReactElement, useEffect, useRef, useState } from "react";
import { type FieldDoor, fieldPlan, openFieldDoor } from "./splash/field-door";

// The field under the boot's first face (track FG; DESIGN.md §2.1, §8 "The boot splash"): the
// website's splash, one for the window's whole first face — BootGround is one node from the splash
// into the Setup Assistant, so this layer and its field run from the first paint to the reveal. Its
// first frame is the ground and the mark as a still; the live field fades in over them once its
// door has opened. A window that can't run the field (no WebGPU on the page, or `?field=still`)
// paints the field's still from its first frame, and one whose door fails falls back to it.

type FieldState = "waking" | "live" | "still";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** `mark`: the field's mark shows; under the Setup Assistant's glass it goes (DESIGN.md §6, the
 * glass forming). */
export function FieldLayer({ mark }: { mark: boolean }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const still = useRef<HTMLDivElement>(null);
  const door = useRef<FieldDoor | null>(null);
  const shown = useRef(mark);
  const [field, setField] = useState<FieldState>(() =>
    "still" in fieldPlan() ? "still" : "waking",
  );

  useEffect(() => {
    const container = ref.current;
    if (container === null || "still" in fieldPlan()) return;
    let gone = false;
    void openFieldDoor(container, still.current, { reducedMotion: prefersReducedMotion() }).then(
      (opened) => {
        if (gone) {
          opened.destroy();
          return;
        }
        door.current = opened;
        // A door that opens under the glass takes the mark away at once.
        if (!shown.current) opened.mark(0, 0);
        setField(opened.mode === "still" ? "still" : "live");
      },
    );
    return () => {
      gone = true;
      door.current?.destroy();
      door.current = null;
    };
  }, []);

  // The mark's fade: 400ms on `ease`, halved under reduced motion.
  useEffect(() => {
    shown.current = mark;
    door.current?.mark(mark ? 1 : 0, prefersReducedMotion() ? 200 : 400);
  }, [mark]);

  return (
    <div
      ref={ref}
      className="vf-field"
      data-field={field}
      data-mark={mark ? "shown" : "hidden"}
      aria-hidden="true"
    >
      <div ref={still} className="vf-field-mark" />
    </div>
  );
}
