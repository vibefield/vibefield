import {
  type ReactElement,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "./boot.css";
import { createFieldGlass, FieldGlassContext, type FieldGlassHost } from "./field-glass";
import {
  type FieldDoor,
  type FieldDoorEnv,
  fieldPlan,
  openFieldDoor,
  TEAR,
  tearLook,
} from "./splash/field-door";

// The field under the boot's first face (track FG; DESIGN.md §2.1, §8 "The boot splash"): the
// website's splash, one for the window's whole first face — BootGround is one node from the splash
// into the Setup Assistant, so this layer and its field run from the first paint to the reveal. Its
// first frame is the ground and the mark as a still; the live field fades in over them once its
// door has opened. A window that can't run the field (no WebGPU on the page, or `?field=still`)
// paints the field's still from its first frame, and one whose door fails falls back to it. What
// stands on the field (`children`) holds it through `FieldGlassContext`: since FG-3b the Setup
// Assistant's glass is drawn by the field in its own frame (field-glass.ts). The design catalog
// stands the shipping glass on this layer over the field's still (FG-6), asked for as a window
// asks for it. While the live field's door is open, a harness may hold it on one frame and the
// glass off it (`window.__vfField`, FG-6's frozen frame).

type FieldState = "waking" | "live" | "still";

/** The page as the field's door reads it at once (`fieldPlan`): its search and its WebGPU. */
type FieldPage = Pick<FieldDoorEnv, "search" | "gpu">;

/** How the tear went, said on the field's root as `data-tear` (FG-6c), an honest state like the
 * ground's `data-opening`: "tearing" while it opens, then "open"; or, where it did not open,
 * "bound" (its bound passed first: its frames came late or never), "lost" (its reveal failed: a
 * lost device) or "cut" (its reveal ended before the window opened: the field's own Reduce Motion,
 * or a second reveal). */
export type TearState = "tearing" | "open" | "bound" | "lost" | "cut";

/** What the boot asks of the field at the reveal (FG-2). */
export interface FieldHandle {
  /** The field is drawing (its door open on the GPU), so it can tear. */
  readonly live: boolean;
  /** The tear (DESIGN.md §6) onto what lies under the ground, in the theme's light: true once it is
   * open, false at once when the field can't tear, and false past its bound — a hidden window
   * draws no frames, and a tear never holds the boot. Open, the field stops drawing at once; not
   * open, it stays to leave with the ground's fade (the website's `.is-fading`). The field's root
   * says how it went (`TearState`). */
  tear(dark: boolean): Promise<boolean>;
}

/** The tear's bound: its length, and a second for frames that come late. */
const TEAR_BOUND_MS = TEAR.duration + 1_000;

/** The live field's door for a harness, `window.__vfField` (FG-6's frozen frame; `docs/desk-gates.md` row 32), while
 * the field's door is open on the GPU: `__vfDesk`'s bargain (desk-door.ts), reads and switches and no document
 * authority, inert unless called. */
export interface VfFieldDoor {
  /** where the field runs */
  readonly mode: FieldDoor["mode"];
  /** the field held on the frame it last drew: true once it is held */
  freeze(): Promise<boolean>;
  /** the glass drawn by the field (true), or held off it, so the browser draws the whole glass (false) */
  glass(byField: boolean): void;
  /** the held field run on from where it was held */
  thaw(): void;
}

/** Install `window.__vfField` for one open door; the returned undo removes it if it is still this one's. */
function installFieldDoor(door: FieldDoor, glass: FieldGlassHost): () => void {
  const handle: VfFieldDoor = {
    mode: door.mode,
    freeze: () => door.freeze(),
    glass: (byField) => glass.hold(!byField),
    thaw: () => door.thaw(),
  };
  const scope = globalThis as Record<string, unknown>;
  scope["__vfField"] = handle;
  return () => {
    if (scope["__vfField"] === handle) delete scope["__vfField"];
  };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** `mark`: the field's mark shows; under the Setup Assistant's glass it goes (DESIGN.md §6, the
 * glass forming), and it comes back as the glass clears (FG-5). `markMs`: how long its fade takes,
 * when not its own 400ms. `handleRef`: the boot's hold on the field at the reveal. `page`: the page
 * as the door reads it, where it is not the window's own (the catalog's `?field=still`), read once
 * at the first frame as the window's is. `children`: what stands on the field, drawn over it. */
export function FieldLayer({
  mark,
  markMs,
  handleRef,
  page: asked,
  children,
}: {
  mark: boolean;
  markMs?: number | undefined;
  handleRef?: Ref<FieldHandle>;
  page?: FieldPage | undefined;
  children?: ReactNode;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const still = useRef<HTMLDivElement>(null);
  const door = useRef<FieldDoor | null>(null);
  const undoDoor = useRef<(() => void) | null>(null);
  const shown = useRef(mark);
  const [glass] = useState(() => createFieldGlass(() => ref.current));
  const [page] = useState<FieldPage>(() => asked ?? {});
  const [field, setField] = useState<FieldState>(() =>
    "still" in fieldPlan(page) ? "still" : "waking",
  );
  const [tearState, setTearState] = useState<TearState | null>(null);

  useEffect(() => {
    const container = ref.current;
    if (container === null || "still" in fieldPlan(page)) return;
    let gone = false;
    void openFieldDoor(
      container,
      still.current,
      { reducedMotion: prefersReducedMotion(), onGlass: glass.report },
      page,
    ).then((opened) => {
      if (gone) {
        opened.destroy();
        return;
      }
      door.current = opened;
      // A door that opens under the glass takes the mark away at once.
      if (!shown.current) opened.mark(0, 0);
      glass.attach(opened);
      if (opened.mode !== "still") undoDoor.current = installFieldDoor(opened, glass);
      setField(opened.mode === "still" ? "still" : "live");
    });
    return () => {
      gone = true;
      undoDoor.current?.();
      undoDoor.current = null;
      glass.attach(null);
      door.current?.destroy();
      door.current = null;
    };
  }, [glass, page]);

  // What stands on the field sizes its logo to the still's own mark while the field is its still (FG-4b).
  useLayoutEffect(() => glass.stillness(field === "still"), [glass, field]);

  // The mark's fade: 400ms on `ease`, halved under reduced motion; as long as the glass's clearing
  // when it takes over from the logo (FG-5).
  useEffect(() => {
    shown.current = mark;
    door.current?.mark(mark ? 1 : 0, markMs ?? (prefersReducedMotion() ? 200 : 400));
  }, [mark, markMs]);

  useImperativeHandle(
    handleRef,
    () => ({
      get live() {
        return door.current !== null && door.current.mode !== "still";
      },
      tear(dark) {
        const opened = door.current;
        if (opened === null || opened.mode === "still") return Promise.resolve(false);
        setTearState("tearing");
        return new Promise<TearState>((resolve) => {
          const bound = setTimeout(() => resolve("bound"), TEAR_BOUND_MS);
          const settle = (state: TearState): void => {
            clearTimeout(bound);
            resolve(state);
          };
          // A reveal that fails (a lost device) is a tear that did not open.
          void opened.reveal(tearLook(dark)).then(
            (done) => settle(done ? "open" : "cut"),
            () => settle("lost"),
          );
        }).then((state) => {
          setTearState(state);
          if (state !== "open") return false;
          opened.destroy(); // open: nothing left to draw
          if (door.current === opened) {
            door.current = null;
            undoDoor.current?.();
            undoDoor.current = null;
            glass.attach(null);
          }
          return true;
        });
      },
    }),
    [glass],
  );

  return (
    <>
      <div
        ref={ref}
        className="vf-field"
        data-field={field}
        data-mark={mark ? "shown" : "hidden"}
        data-tear={tearState ?? undefined}
        aria-hidden="true"
      >
        <div ref={still} className="vf-field-mark" />
      </div>
      <FieldGlassContext.Provider value={glass}>{children}</FieldGlassContext.Provider>
    </>
  );
}
