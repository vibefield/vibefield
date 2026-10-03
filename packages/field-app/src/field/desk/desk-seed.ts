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

// THE FIRST-RUN BOARD (DK-3, the orchestrator's ruling 6): ONE OF EACH reference kind, laid as ICE's
// showcase lays them (`apps/desk/scripts/remount.mjs`, rig:remount's showcase — the same centres, the
// note's seed, the mini mat's name, the notebook's hand and turn, this month's calendar, a print), so
// `pnpm dev` opens on a desk, not an empty mat. The bootstrap default doc alone is seeded (the B3
// registry-open law); user-created boards open empty. The print needs a picture: the seed's sample
// goes into the byte store FIRST, and only then is the print laid naming its hash — so the desk never
// meets a print whose picture is not there yet. DK-5 rewrites the census to this seed.

/** One seeded object: its type, its CENTRE in world units (the showcase's convention), its props. */
export interface SeedObject {
  readonly type: string;
  readonly cx: number;
  readonly cy: number;
  readonly props: Readonly<Record<string, unknown>>;
}

/** The five laid at once, in the showcase's order — its three notes are one here. */
export function seedObjects(now: Date): readonly SeedObject[] {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return [
    { type: NOTE_TYPE, cx: 170, cy: 160, props: { seed: 1 } },
    { type: MINIMAT_TYPE, cx: 300, cy: 520, props: { name: "Inbox" } },
    { type: BOARD_TYPE, cx: 760, cy: 560, props: {} },
    { type: NOTEBOOK_TYPE, cx: 1040, cy: 300, props: { seed: 3, angle: 0.05 } },
    { type: CALENDAR_TYPE, cx: 640, cy: 170, props: { month } },
  ];
}

/** Where the print lies (its centre): the showcase's `kinds.print({ x: 960, y: 610 })`. */
export const SEED_PRINT_AT = { cx: 960, cy: 610 } as const;

/** The six types the seed lays, one each — the census a first-run board must hold. */
export const SEED_TYPES: readonly string[] = [
  NOTE_TYPE,
  MINIMAT_TYPE,
  BOARD_TYPE,
  NOTEBOOK_TYPE,
  CALENDAR_TYPE,
  PHOTO_TYPE,
];

/**
 * Seed a live document: the five laid now (one transaction each, not undoable — the user's first ⌘Z
 * stays clean), then the print once its picture is in `blobs`. Resolves when the print is laid; a
 * board switched away meanwhile gets no print. Each object is laid only where the root canvas places
 * it (the desk places what provides `desk.object` — all six do).
 */
export async function seedDesk(
  ce: CanvasEngine,
  session: DocSession,
  blobs: BlobStore,
  now: Date = new Date(),
): Promise<void> {
  const placeable = ce.catalog.placementFor(ce.catalog.rootCanvas.id);
  const lay = (type: string, at: { x: number; y: number; w: number; h: number }, props: object) => {
    if (!placeable.has(type)) return;
    ce.ops.spawnWidget(type, { ...at, props: { ...props }, undoable: false });
  };
  for (const s of seedObjects(now)) {
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
