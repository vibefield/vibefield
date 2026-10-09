// The browser pane's IDS — durable: its type lives in boards. Pure (no import), so the manifest's emit (plain Node,
// before any bundle exists) and the kind read the same strings.

/**
 * The pane's durable type id — its plugin's id itself (an object may take the bare id: `isOwnedName`). Not
 * `vibefield.browser`: that is the Artifacts panel's plugin, untouched (PT-1 ruling 1).
 */
export const BROWSER_PANE_TYPE = "vibefield.browser-pane";

/**
 * The pane's KIND name — its key in the desk's registry, in every slot's objects and in `handle.local(…)`. The host's
 * rule (DK-6 input (b)): a kind's registry name IS its type, one id and no second namespace.
 */
export const BROWSER_PANE_KIND = BROWSER_PANE_TYPE;

/** The pane's category on the pegboard — a new chip, the portals' (thinking-the-desk §1: a portal is a window onto something live). */
export const BROWSER_PANE_CATEGORY = "portals";

/** The glasses a pane is cut from (BROWSER.md §3): low-iron (the default), float, smoke, bronze. */
export const PANE_FINISHES = ["low-iron", "float", "smoke", "bronze"] as const;
export type PaneFinishName = (typeof PANE_FINISHES)[number];

/** Whose colour scheme the page takes: the desk's (it follows the desk into dark, the default), or fixed per pane. */
export const PANE_SCHEMES = ["desk", "light", "dark"] as const;
export type PaneScheme = (typeof PANE_SCHEMES)[number];

/**
 * The page a new pane opens on — the sample web's landing page (BROWSER.md §6's Lumen), under a reserved name
 * (RFC 2606's `.example`: never a real host). In PT-1 every page is a STILL drawn by the plugin's own generator
 * (sample-page.ts); PT-2 brings live frames.
 */
export const SAMPLE_URL = "https://lumen.example/";

/** The longest address a pane keeps, characters. */
export const URL_MAX = 2048;
