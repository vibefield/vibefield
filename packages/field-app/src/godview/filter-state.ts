// THE FILTERS FOR THE RUN (docket N4 (a), 2026-10-12). Godview's two filters —
// the desktop and the profile chosen in search's Live now (GV-D3) — are kept
// while the app runs and cleared at launch, as the terminals' state is
// (`deck-state.ts`, L3): the window's session storage, so closing Godview (which
// unmounts its monitor) or a renderer reload keeps what was chosen, and a new
// window or a launch starts on everything.
//
// What is kept is the CHOICE, never its standing: an id the board or the
// profiles feed no longer has falls back where it is read (`standingChoice`,
// `chosenProfile`), so a stale one shows no filter rather than a false token.
// Only the window's own stage — the one that lends the Peek its door — reads or
// writes it; a catalog's stages never touch it.

/** For the run, not the viewer: the window's session storage. */
export const GODVIEW_FILTERS_STORAGE_KEY = "vf-godview-filters-v1";

export interface GodviewFilters {
  desk: string | null;
  profile: string | null;
}

const NONE: GodviewFilters = { desk: null, profile: null };

const idOrNone = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** What this run left, or none — what a launch opens with. */
export function storedGodviewFilters(): GodviewFilters {
  try {
    const raw = sessionStorage.getItem(GODVIEW_FILTERS_STORAGE_KEY);
    if (raw === null) return NONE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return NONE;
    const { desk, profile } = parsed as Record<string, unknown>;
    return { desk: idOrNone(desk), profile: idOrNone(profile) };
  } catch {
    return NONE;
  }
}

export function storeGodviewFilters(filters: GodviewFilters): void {
  try {
    if (filters.desk === null && filters.profile === null) {
      sessionStorage.removeItem(GODVIEW_FILTERS_STORAGE_KEY);
    } else {
      sessionStorage.setItem(
        GODVIEW_FILTERS_STORAGE_KEY,
        JSON.stringify({ desk: filters.desk, profile: filters.profile }),
      );
    }
  } catch {
    // A storage that refuses costs a reopen its memory, never the filter.
  }
}
