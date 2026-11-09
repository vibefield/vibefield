/**
 * THE CARD'S BLOOM, WHERE IT STANDS (OB-D2, OB-D12 A; DESIGN.md §8 "The hand"). Pure. The numbers are the spawn bloom's
 * (puppeteer's `views/swarm/bloom/constants`, which the package does not export; `card-bloom-geometry.test` reads that file
 * so the two cannot drift); the hub's scale and the arc's limit are this bloom's own.
 */

export const CARD_BLOOM = {
  /** The card, standing where it landed. */
  hubScale: 0.42,
  ring: 92,
  bud: 48,
  step: 42,
  /** The most the buds may span. */
  arc: 220,
  dead: 22,
  sector: 26,
  slack: 64,
  settle: 90,
  hot: 1.16,
  pop: 280,
  stagger: 26,
  retract: 180,
  reveal: 140,
  sayMax: 72,
  sayMin: 22,
  /** The words' size, against the window's longer side. */
  sayShare: 0.066,
  sayGap: 40,
  /** How near a bud's centre may come to the window's sides, top and foot. */
  edgeSide: 70,
  edgeTop: 44,
  edgeFoot: 30,
} as const;

export interface BloomPoint {
  readonly x: number;
  readonly y: number;
}

export interface BloomField {
  readonly width: number;
  readonly height: number;
}

export interface PlacedBud extends BloomPoint {
  /** the bud's direction from the hub, degrees, −90 straight up */
  readonly deg: number;
}

export interface PlacedRing {
  readonly turn: number;
  /** degrees between buds; 0 for one bud */
  readonly step: number;
  readonly buds: readonly PlacedBud[];
}

/** Straight up first, then 15° at a time either way, all the way round for a card let go against the window's top. */
const TURNS: readonly number[] = [
  0,
  ...Array.from({ length: 12 }, (_, i) => [(i + 1) * 15, -(i + 1) * 15]).flat(),
];

function ringAt(count: number, at: BloomPoint, step: number, turn: number): PlacedBud[] {
  return Array.from({ length: count }, (_, i) => {
    const deg = -90 + (i - (count - 1) / 2) * step + turn;
    const a = (deg * Math.PI) / 180;
    return {
      deg,
      x: at.x + Math.cos(a) * CARD_BLOOM.ring,
      y: at.y + Math.sin(a) * CARD_BLOOM.ring,
    };
  });
}

/** The ring for `count` faces about `at`: opening up, turned only as far as the window's edges force it. */
export function placeBuds(count: number, at: BloomPoint, field: BloomField): PlacedRing {
  const step = count > 1 ? Math.min(CARD_BLOOM.step, CARD_BLOOM.arc / (count - 1)) : 0;
  const fits = (b: PlacedBud): boolean =>
    b.x > CARD_BLOOM.edgeSide &&
    b.x < field.width - CARD_BLOOM.edgeSide &&
    b.y > CARD_BLOOM.edgeTop &&
    b.y < field.height - CARD_BLOOM.edgeFoot;
  for (const turn of TURNS) {
    const buds = ringAt(count, at, step, turn);
    if (buds.every(fits)) return { turn, step, buds };
  }
  return { turn: 0, step, buds: ringAt(count, at, step, 0) };
}

/** What a pointer at `p` points at: "hub" inside the dead zone, a bud's index in its sector, null on open ground. */
export function pickAt(p: BloomPoint, at: BloomPoint, ring: PlacedRing): number | "hub" | null {
  const dx = p.x - at.x;
  const dy = p.y - at.y;
  const r = Math.hypot(dx, dy);
  if (r < CARD_BLOOM.dead) return "hub";
  if (r > CARD_BLOOM.ring + CARD_BLOOM.slack) return null;
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  let best = -1;
  let nearest = Number.POSITIVE_INFINITY;
  ring.buds.forEach((b, i) => {
    const off = Math.abs(((deg - b.deg + 540) % 360) - 180);
    if (off < nearest) {
      nearest = off;
      best = i;
    }
  });
  const sector = ring.step > 0 ? Math.min(CARD_BLOOM.sector, ring.step / 2 + 2) : CARD_BLOOM.sector;
  return best >= 0 && nearest <= sector ? best : null;
}

/** The words' size: a share of the window's longer side, between the spawn bloom's two limits. */
export function sayPx(field: BloomField): number {
  const size = Math.max(field.width, field.height) * CARD_BLOOM.sayShare;
  return Math.max(CARD_BLOOM.sayMin, Math.min(CARD_BLOOM.sayMax, size));
}

/** The words' top: clear above the bloom, or clear below it where they don't fit above, else at the window's top. */
export function wordsTop(at: BloomPoint, field: BloomField, height: number): number {
  const reach = CARD_BLOOM.ring + CARD_BLOOM.bud / 2 + CARD_BLOOM.sayGap;
  const above = at.y - reach - height;
  if (above >= 8) return above;
  const below = at.y + reach;
  return below + height <= field.height - 8 ? below : 16;
}
