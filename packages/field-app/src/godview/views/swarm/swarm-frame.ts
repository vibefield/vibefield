import {
  FRAME_COUNT_INDEX,
  FRAME_GENERATION_INDEX,
  FRAME_HEADER_FLOATS,
  FRAME_STRIDE,
} from "./swarm-physics";

// THE MAIN THREAD'S READ OF ONE FRAME (GT-3c, GT-D16).
//
// Extracted from the swarm view's `onFrame` so the ORDER it imposes is testable
// against a real detach. The view reads this frame and then hands the buffer
// back with its ArrayBuffer in the transfer list, which DETACHES this thread's
// view of it — after which the array reads as length zero rather than throwing,
// so reading second is not an error anybody sees. It is a swarm that stops
// moving. Under the inline driver the transfer list is dropped and both orders
// pass, which is exactly why the discipline needed its own fixture.

/** What the last two frames said about one bubble, and what was last written
 * for it. The physics owns the positions; this is the render's own copy,
 * because a transferred frame goes straight back to the sender. */
export interface BubbleState {
  /** The newest solved position, and the one before it — the two ends of the
   * blend the renderer draws between (GT-D15.2). */
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  radius: number;
  /** What was last WRITTEN to the DOM, so a frame that changed nothing writes
   * nothing (GT-D15.3). Nine bubbles × three properties × 120Hz is 3,240 style
   * writes a second to say the same thing when the swarm has settled. */
  writtenX: number;
  writtenY: number;
  writtenRadius: number;
}

/** The id table the frames arriving now are addressed by. */
export interface SwarmIdTable {
  generation: number;
  ids: readonly string[];
}

/**
 * Fold one frame into the render's bubble states, in place.
 *
 * Returns whether the frame was APPLIED. False means it was written under a
 * different id table — a frame that crossed a membership change in flight — and
 * reading it against the current ids would put one agent's position on
 * another's bubble. The caller still hands the buffer back either way; a stale
 * frame is not a damaged one.
 */
export function readSwarmFrame(
  frame: Float32Array,
  table: SwarmIdTable,
  states: Map<string, BubbleState>,
): boolean {
  if (frame[FRAME_GENERATION_INDEX] !== table.generation) return false;
  const { ids } = table;
  const count = frame[FRAME_COUNT_INDEX] ?? 0;
  for (let index = 0; index < count; index += 1) {
    const id = ids[index];
    if (id === undefined) break;
    const offset = FRAME_HEADER_FLOATS + index * FRAME_STRIDE;
    const x = frame[offset] ?? 0;
    const y = frame[offset + 1] ?? 0;
    const radius = frame[offset + 2] ?? 0;
    const state = states.get(id);
    if (state) {
      state.previousX = state.x;
      state.previousY = state.y;
      state.x = x;
      state.y = y;
      state.radius = radius;
    } else {
      states.set(id, {
        x,
        y,
        // A new body has no history, so its first blend must be a no-op: from
        // where it is, to where it is. Seeding these with the spawn position is
        // what stops a bubble's first frame from being a streak out of (0, 0).
        previousX: x,
        previousY: y,
        radius,
        // Deliberately NaN rather than the spawn position: the damage gate's
        // first comparison must be guaranteed to fail so the opening write
        // happens, and every comparison against NaN is false.
        writtenX: Number.NaN,
        writtenY: Number.NaN,
        writtenRadius: Number.NaN,
      });
    }
  }
  return true;
}
