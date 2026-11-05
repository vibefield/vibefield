/**
 * SP-1e2's renderer half — the spark's crews, read (`chat/crews-port.ts`; SPE-Q27 (a); DESIGN.md §8 "Chat's crew
 * card"): `compose.sparks.crews.subscribe` through a scripted door, its snapshot and every frame, fieldd's honest
 * refusal asked again on reconnect, a refusal for good read as none, and a frame that does not parse kept out.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SparkId } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { type CrewsDoor, type CrewsReading, readCrews } from "../src/chat/crews-port";

const here = dirname(fileURLToPath(import.meta.url));
const FRAME: unknown = JSON.parse(
  readFileSync(join(here, "../../contracts/fixtures/compose-sparks-crews.valid.json"), "utf8"),
);
const SPARK = "sp-7k2m9q4x" as SparkId;

/** A door fieldd answers as the script says: each watch is one ask; `push` hands a frame to the open one. */
function scripted() {
  const asks: SparkId[] = [];
  const reconnects = new Set<() => void>();
  let answer: (() => unknown) | null = () => FRAME;
  let push: ((payload: unknown) => void) | null = null;
  let stopped = 0;
  const door: CrewsDoor = {
    watch: async (spark, onFrame) => {
      asks.push(spark);
      if (answer === null) throw { kind: "INTERNAL", retryable: false };
      const snapshot = answer();
      if (
        snapshot instanceof Error ||
        (typeof snapshot === "object" && snapshot !== null && "kind" in snapshot)
      )
        throw snapshot;
      onFrame(snapshot);
      push = onFrame;
      return () => {
        stopped += 1;
        push = null;
      };
    },
    onReconnected: (listener) => {
      reconnects.add(listener);
      return () => reconnects.delete(listener);
    },
  };
  return {
    door,
    asks,
    stopped: () => stopped,
    answer: (next: (() => unknown) | null) => {
      answer = next;
    },
    push: (payload: unknown) => push?.(payload),
    reconnect: () => {
      for (const listener of reconnects) listener();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const states = (readings: CrewsReading[]) => readings.map((r) => r.state);

describe("the spark's crews, read (SPE-Q27 (a))", () => {
  it("R1 · reads the snapshot, then each frame whole; a frame that does not parse keeps what it had; stopping unsubscribes", async () => {
    const s = scripted();
    const readings: CrewsReading[] = [];
    const stop = readCrews(SPARK, s.door, (r) => readings.push(r));
    await settle();
    expect(s.asks).toEqual([SPARK]);
    expect(states(readings)).toEqual(["reading", "ready"]);
    const first = readings.at(-1);
    expect(first?.state === "ready" && first.frame.crews[0]?.members).toHaveLength(4);
    s.push({ spark: SPARK, crews: [] });
    s.push({ spark: SPARK, crews: "not a list" });
    expect(states(readings)).toEqual(["reading", "ready", "ready"]);
    const last = readings.at(-1);
    expect(last?.state === "ready" && last.frame.crews).toEqual([]);
    stop();
    expect(s.stopped()).toBe(1);
  });

  it("R2 · fieldd's honest refusal reads as unreadable and is asked again when the client is connected again", async () => {
    const s = scripted();
    s.answer(() => ({
      kind: "UNAVAILABLE",
      retryable: false,
      details: { state: "records-unreadable" },
    }));
    const readings: CrewsReading[] = [];
    readCrews(SPARK, s.door, (r) => readings.push(r));
    await settle();
    expect(states(readings)).toEqual(["reading", "unreadable"]);
    s.answer(() => FRAME);
    s.reconnect();
    await settle();
    expect(s.asks).toEqual([SPARK, SPARK]);
    expect(readings.at(-1)?.state).toBe("ready");
  });

  it("R3 · a socket that closed under the ask is unreadable until the reconnect; a refusal for good is none, and never asked again", async () => {
    const closed = scripted();
    closed.answer(() => ({ kind: "UNAVAILABLE", retryable: true }));
    const readings: CrewsReading[] = [];
    readCrews(SPARK, closed.door, (r) => readings.push(r));
    await settle();
    expect(readings.at(-1)?.state).toBe("unreadable");
    const old = scripted();
    old.answer(() => ({ kind: "NOT_FOUND", retryable: false }));
    const none: CrewsReading[] = [];
    readCrews(SPARK, old.door, (r) => none.push(r));
    await settle();
    expect(states(none)).toEqual(["reading", "none"]);
    old.reconnect();
    await settle();
    expect(old.asks).toEqual([SPARK]);
  });

  it("R4 · stopped before fieldd answers, it unsubscribes the answer and tells nothing more", async () => {
    const s = scripted();
    const readings: CrewsReading[] = [];
    const stop = readCrews(SPARK, s.door, (r) => readings.push(r));
    stop();
    await settle();
    expect(s.stopped()).toBe(1);
    expect(states(readings)).toEqual(["reading"]);
  });
});
