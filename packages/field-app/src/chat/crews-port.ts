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

/** Read `spark`'s crews through `door`, telling each reading; the answer stops it. Told "reading" at once; then each
 * frame whole; a frame that does not parse keeps what it had. */
export function readCrews(
  spark: SparkId,
  door: CrewsDoor,
  onReading: (reading: CrewsReading) => void,
): () => void {
  let stopped = false;
  let unsubscribe: (() => void) | null = null;
  let stopReconnects: (() => void) | null = null;
  const tell = (reading: CrewsReading) => {
    if (!stopped) onReading(reading);
  };
  const ask = () => {
    stopReconnects?.();
    stopReconnects = null;
    door
      .watch(spark, (payload) => {
        const frame = crewsFrameOf(payload);
        if (frame !== undefined) tell({ state: "ready", frame });
      })
      .then(
        (stop) => {
          if (stopped) stop();
          else unsubscribe = stop;
        },
        (refusal: unknown) => {
          if (stopped) return;
          if (!askedAgain(refusal)) {
            tell({ state: "none" });
            return;
          }
          tell({ state: "unreadable" });
          stopReconnects = door.onReconnected(() => {
            if (!stopped) ask();
          });
        },
      );
  };
  tell(CREWS_READING);
  ask();
  return () => {
    stopped = true;
    unsubscribe?.();
    unsubscribe = null;
    stopReconnects?.();
    stopReconnects = null;
  };
}

/** fieldd's honest refusal (UNAVAILABLE: its kept record cannot be read) or the connection's (retryable) is asked again
 * once the client is connected again; any other (no such spark, a malformed ask, a fieldd without the door) is for
 * good. */
function askedAgain(refusal: unknown): boolean {
  if (typeof refusal !== "object" || refusal === null) return false;
  const { kind, retryable } = refusal as { readonly kind?: unknown; readonly retryable?: unknown };
  return kind === "UNAVAILABLE" || retryable === true;
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
