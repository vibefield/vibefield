import type { CanvasEngine, DocSession } from "@vibecook/ice";
import type { BlobStore } from "@vibecook/ice/desk/kit";
import {
  BOARD_TYPE,
  CALENDAR_TYPE,
  MINIMAT_TYPE,
  NOTE_TYPE,
  NOTEBOOK_TYPE,
  PHOTO_TYPE,
  printRect,
} from "@vibecook/ice/desk/objects";

// THE FIRST-RUN BOARD — THE PRODUCT'S (DK-3's six; rewritten at DK-8): ICE's six reference kinds and VibeField's own
// comment pad, laid as the product's composition — a WORKING COLUMN on the left (the note, the comment pad and the
// notebook side by side; the mini mat "Inbox" under them; the whiteboard; the print last) and the desk CALENDAR beside
// it on the right, its 1760 × 1852 sheet (the calendar's law; never resized) lying next to the others, never under
// them: one object among the six, not the ground (DK-6's stills had it under all of them). The column is centred on the
// calendar's height, so where the arrival band's 0.5 floor (`frameContent`) cannot hold the calendar's height (a window
// under ~930 CSS px tall) the frame trims the calendar's top and foot before the column's rows; a window under ~1250 CSS
// px wide trims both sides' edges too. The bootstrap default doc alone is seeded (the B3 registry-open
// law); user-created boards open empty. The print needs a picture: the seed's sample goes into the byte store FIRST,
// and only then is the print laid naming its hash — so the desk never meets a print whose picture is not there yet.
//
// THE EXAMPLE CLOCK is not the product's (the orchestrator's ruling 1 at DK-8: "an example is an example"): a user's
// first board never carries it. It is a DEV/SMOKE SWITCH — laid only where the run asks for the examples: a dev build
// (`pnpm dev`, the dev plugin set stages it) or a smoke that loads the renderer with `?deskSeedExamples=1`
// (`smoke:canvas`, whose CLOCK row needs it) — and, as every seeded type, only while its plugin is on.

/** One seeded object: its type, its CENTRE in world units, its props. */
export interface SeedObject {
  readonly type: string;
  readonly cx: number;
  readonly cy: number;
  readonly props: Readonly<Record<string, unknown>>;
}

/**
 * VIBEFIELD'S OWN KIND on the first board (DK-8, DK-D14): the COMMENT PAD (`plugins/comment-pad`), blank, in the
 * working column between the note and the notebook. Named by its TYPE, as a host names any plugin's kind (the
 * seed imports no plugin; `comment-pad-plugin.test.ts` holds the string to the plugin's), and laid only while its
 * plugin is on: every dev run and smoke stages it; a packaged build ships no plugin until WP8 and lays the six.
 */
export const SEED_PAD: SeedObject = {
  type: "vibefield.comment-pad",
  cx: 340,
  cy: 330,
  props: {},
};

/**
 * THE EXAMPLE PLUGIN'S CLOCK (DK-6 — the parity witness, `examples/plugins/desk-clock`): a DEV/SMOKE switch, never the
 * product's seed (ruling 1). Laid in the working column beside the whiteboard, WITHOUT its seconds hand: a minute clock
 * wakes the resting desk once a minute by its registered wake (a seconds clock, once a second), so a board still sleeps.
 */
export const SEED_CLOCK: SeedObject = {
  type: "vibefield.example.desk-clock",
  cx: 585,
  cy: 1095,
  props: { seconds: false },
};

/** The URL door a run asks for the example objects through (`smoke:canvas` loads the renderer with it). */
export const SEED_EXAMPLES = "deskSeedExamples";

/** Whether this run's first board lays the examples: a dev build, or a load that asks (`?deskSeedExamples=1`). */
export function seedsExamples(dev: boolean, search: string): boolean {
  return dev || new URLSearchParams(search).get(SEED_EXAMPLES) === "1";
}

export interface SeedOptions {
  /** Lay the example objects (the clock) — a dev build's and a smoke's; never a user's first board. */
  readonly examples?: boolean;
}

/** The product's composition, laid at once (the print follows its picture) — and the example clock where the run asks. */
export function seedObjects(now: Date, opts: SeedOptions = {}): readonly SeedObject[] {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const product: SeedObject[] = [
    { type: NOTE_TYPE, cx: 100, cy: 330, props: { seed: 1 } },
    SEED_PAD,
    { type: NOTEBOOK_TYPE, cx: 570, cy: 330, props: { seed: 3, angle: 0.05 } },
    { type: MINIMAT_TYPE, cx: 320, cy: 750, props: { name: "Inbox" } },
    { type: BOARD_TYPE, cx: 240, cy: 1180, props: {} },
    { type: CALENDAR_TYPE, cx: 1620, cy: 926, props: { month } },
  ];
  return opts.examples === true ? [...product, SEED_CLOCK] : product;
}

/** Where the print lies (its centre): the working column's foot, under the whiteboard. */
export const SEED_PRINT_AT = { cx: 200, cy: 1520 } as const;

/** The types the product's seed lays, one each — the census a first-run board holds while the product's plugins are
 * on (ICE's six and the comment pad; the example clock joins it only where the run asks for the examples). */
export const SEED_TYPES: readonly string[] = [
  NOTE_TYPE,
  MINIMAT_TYPE,
  BOARD_TYPE,
  NOTEBOOK_TYPE,
  CALENDAR_TYPE,
  PHOTO_TYPE,
  SEED_PAD.type,
];

/**
 * Seed a live document: the product's composition laid now (one transaction each, not undoable — the
 * user's first ⌘Z stays clean) and the example clock where the run asks for the examples, then the print
 * once its picture is in `blobs`. Resolves when the print is laid; a board switched away meanwhile gets no
 * print. Each object is laid only where the root canvas places it (the desk places what provides
 * `desk.object` — the six do, the pad and the clock do; a type the catalog lacks — its plugin off — is
 * passed by).
 */
export async function seedDesk(
  ce: CanvasEngine,
  session: DocSession,
  blobs: BlobStore,
  now: Date = new Date(),
  opts: SeedOptions = {},
): Promise<void> {
  const placeable = ce.catalog.placementFor(ce.catalog.rootCanvas.id);
  const lay = (type: string, at: { x: number; y: number; w: number; h: number }, props: object) => {
    if (!placeable.has(type)) return;
    ce.ops.spawnWidget(type, { ...at, props: { ...props }, undoable: false });
  };
  for (const s of seedObjects(now, opts)) {
    const size = ce.catalog.widget(s.type)?.defaultSize;
    if (size === undefined) continue;
    lay(s.type, { x: s.cx - size.w / 2, y: s.cy - size.h / 2, w: size.w, h: size.h }, s.props);
  }
  ce.world.sync(); // project the seeds before the first frame

  // The sample is a lazy module (its base64 rides its own chunk, never the boot graph).
  const { SAMPLE_PRINT, samplePrintBytes } = await import("./desk-sample-print");
  const hash = await blobs.put(samplePrintBytes(), SAMPLE_PRINT.type);
  if (ce.docs.current() !== session) return;
  const { width, height } = SAMPLE_PRINT;
  const r = printRect(SEED_PRINT_AT.cx, SEED_PRINT_AT.cy, width, height);
  lay(PHOTO_TYPE, { x: r.x, y: r.y, w: r.w, h: r.h }, { blob: hash, width, height, angle: 0 });
  ce.world.sync();
}
