import type { ObjectRef, ObjectsHandResult } from "@vibefield/contracts";

// THE GRANT'S SEAM (OB-L1, §4.3). Playing a card's Live face on one agent is the grant: the window asks fieldd
// (`objects.hand {ref, run}`) and pastes the ref's words only once it is handed. One small door, so every place that
// plays a ref goes through the same call. Until `objects.hand` lands (OB-3a) there is nothing to grant through, so the
// seam says so honestly and nothing is pasted.

/** What the door says: handed, or the reason it was not. */
export type HandOverDoor = (ref: ObjectRef, run: string) => Promise<ObjectsHandResult>;

export const HAND_OVER_WORDS = {
  /** there is no door to the desk's objects in this build yet */
  noDoor: "Not handed over — desk objects can't be handed to agents yet",
  /** Chat: the spark has no session to hand it to */
  noRun: "Not handed over \u2014 this spark has no session yet",
} as const;

let door: HandOverDoor | null = null;

/** OB-3a installs `objects.hand` here. Returns the undo. */
export function setHandOverDoor(next: HandOverDoor): () => void {
  door = next;
  return () => {
    if (door === next) door = null;
  };
}

/** Grant `run` the object `ref`: the person's play, through VibeField's own window (OB-L1). */
export function handOver(ref: ObjectRef, run: string): Promise<ObjectsHandResult> {
  if (door === null) return Promise.resolve({ handed: false, reason: HAND_OVER_WORDS.noDoor });
  return door(ref, run);
}

/** Test seam: no door. */
export function resetHandOverForTest(): void {
  door = null;
}
