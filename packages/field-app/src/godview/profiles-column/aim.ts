// DESIGN.md §8 "The reach" (2026-11-16; asked: "make it more instant") — WHERE THE POINTER IS HEADING. A card stands
// right of the pill, so a pointer travelling from its circle to it can brush a neighbouring circle on the way. Only that
// trip waits: the pointer is heading into the card while its newest point lies inside the triangle its older point
// makes with the card's near (left) edge, the edge held out by a few pixels so a trip aimed at a corner still counts.
// Everywhere else — up and down the pill, away from the card — another circle takes the card at once.

export interface AimPoint {
  x: number;
  y: number;
}

export interface AimRect {
  left: number;
  top: number;
  bottom: number;
}

/** How far past the card's corners the triangle reaches, so a trip at a corner still counts as heading in. */
export const AIM_SLACK = 12;

/** How many recent points the column keeps; the oldest of them is where the trip came from. */
export const AIM_HISTORY = 4;

function side(a: AimPoint, b: AimPoint, p: AimPoint): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** A trip into the card moves right at least this much over the trail… */
export const AIM_MIN_RIGHT = 2;
/** …and no steeper than this (rise over run): a pass up or down the pill, however it drifts, takes the card at once. */
export const AIM_MAX_SLOPE = 2;

/** Whether `to` lies inside the triangle `from` makes with the card's near edge, moving toward it. */
export function headingInto(from: AimPoint, to: AimPoint, card: AimRect): boolean {
  // a pointer that is not moving right is not on its way to a card that stands to the right, and one moving mostly up
  // or down is going along the pill
  const right = to.x - from.x;
  if (right < AIM_MIN_RIGHT || from.x >= card.left) return false;
  if (Math.abs(to.y - from.y) > AIM_MAX_SLOPE * right) return false;
  const top = { x: card.left, y: card.top - AIM_SLACK };
  const bottom = { x: card.left, y: card.bottom + AIM_SLACK };
  const d1 = side(from, top, to);
  const d2 = side(top, bottom, to);
  const d3 = side(bottom, from, to);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}
