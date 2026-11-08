import { useState } from "react";
import type { FrameSurface } from "../frame/frame-surface";
import type { Starter } from "./thread-items";

// THE FIRST JOB THE SHEET CARRIES (track ES, ES-2; ES-D2 A; DESIGN.md §8 "The New spark sheet", Its first job, the
// opening's alone) — the frame's hold on the job a starter on Chat's empty night hands it as it opens the New spark
// sheet. It stands while the sheet does and leaves with it whenever it folds (Cancel, Esc, the scrim, or another
// surface), so the night's New spark, ⌘N and the line's ✦ open the sheet with none. The sheet hands Chat what it still
// carries at Create (`chooseSpark`), and Chat sends it.

export interface FirstJob {
  /** the job the open sheet carries; null when it carries none, or the sheet is not open */
  readonly job: Starter | null;
  /** the night hands the frame its job (or none) as it opens the sheet */
  readonly carry: (job: Starter | null) => void;
}

export function useFirstJob(surface: FrameSurface | null): FirstJob {
  const [held, setHeld] = useState<Starter | null>(null);
  // the opening's alone: a sheet that folds lets it go, so none waits for the next opening (React's own pattern for
  // state a prop retires, set while rendering)
  if (surface !== "new-spark" && held !== null) setHeld(null);
  return { job: surface === "new-spark" ? held : null, carry: setHeld };
}
