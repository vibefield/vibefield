import { ComposeSparksCrewsFrame, type SparkId } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { useEffect, useState } from "react";
import { onReconnectedOver } from "../reconnect";

// THE SPARK'S CREWS, READ (SP-1e2's renderer half; SPE-Q27 (a), SPE-Q40; DESIGN.md §8 "Chat's crew card"). While Chat
// shows a spark's thread, the window holds `compose.sparks.crews.subscribe {spark}`: its snapshot, then the whole list
// at each change, never edges. fieldd's honest refusal (UNAVAILABLE: its kept record cannot be read), or a socket that
// closed under the ask, reads as unreadable, and is asked again when the window's client is connected again; a refusal
// for good (a fieldd without the door) reads as none, and the card stands on the board's rows alone. Every effect comes
// through the door, so a test drives it without a window.
// (red: a skeleton — `readCrews` reads nothing)

/** What the crew cards read of the spark's crews. */
export type CrewsReading =
  /** asked, no answer yet: the act lines stand alone */
  | { readonly state: "reading" }
  /** the spark's crews whole, and `waiting` for its members on the board */
  | { readonly state: "ready"; readonly frame: ComposeSparksCrewsFrame }
  /** fieldd could not read them, or the connection closed under the ask: asked again on reconnect */
  | { readonly state: "unreadable" }
  /** a fieldd without the door: the card stands on the board's rows alone, and says nothing of it */
  | { readonly state: "none" };

export const CREWS_READING: CrewsReading = { state: "reading" };

/** The window's door to a spark's crews: fieldd's subscription, and the client's reconnects. */
export interface CrewsDoor {
  /** The spark's crews: the snapshot, then each frame, in order. Resolves to the way to stop; rejects with fieldd's
   * refusal (a FielddRpcError's `kind` and `retryable`). */
  watch(spark: SparkId, onFrame: (payload: unknown) => void): Promise<() => void>;
  /** Heard each time the window's client is connected again; the answer stops it. */
  onReconnected(listener: () => void): () => void;
}

export function crewsDoorOver(client: FielddClient): CrewsDoor {
  return {
    watch: async (spark, onFrame) => {
      let ready = false;
      const early: unknown[] = [];
      const subscription = await client.subscribe(
        "compose.sparks.crews.subscribe",
        { spark },
        (payload) => {
          if (ready) onFrame(payload);
          else early.push(payload);
        },
      );
      onFrame(subscription.snapshot);
      ready = true;
      for (const payload of early) onFrame(payload);
      return () => subscription.unsubscribe();
    },
    onReconnected: onReconnectedOver(client),
  };
}

/** Read `spark`'s crews through `door`, telling each reading; the answer stops it. (red: a skeleton) */
export function readCrews(
  _spark: SparkId,
  _door: CrewsDoor,
  _onReading: (reading: CrewsReading) => void,
): () => void {
  return () => undefined;
}

/** The shown spark's crews, read while Chat shows its thread (`spark` null: none is read). */
export function useSparkCrews(spark: SparkId | null, door: CrewsDoor | null): CrewsReading | null {
  const [reading, setReading] = useState<{
    readonly spark: SparkId;
    readonly reading: CrewsReading;
  } | null>(null);
  useEffect(() => {
    if (spark === null || door === null) return;
    return readCrews(spark, door, (next) => setReading({ spark, reading: next }));
  }, [spark, door]);
  if (spark === null || door === null) return null;
  return reading?.spark === spark ? reading.reading : CREWS_READING;
}

/** The frame as fieldd sends it, or undefined when it does not parse (the tolerant reader keeps what it had). */
export function crewsFrameOf(payload: unknown): ComposeSparksCrewsFrame | undefined {
  const parsed = ComposeSparksCrewsFrame.safeParse(payload);
  return parsed.success ? parsed.data : undefined;
}
