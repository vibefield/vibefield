import type { AgentAccountUsageEntry, AgentProfileSet } from "@vibefield/contracts";
import type { MonitorSpawnFuel } from "@vibefield/puppeteer-view-sdk";
import { BLOOM } from "@vibefield/puppeteer-views";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { spawnFuelMap } from "../../usage/spawn-fuel";
import type { MonitorUsagePort } from "../monitor/remote-door";
import { columnCircles } from "./ProfilesColumn";

// PU-R (DESIGN.md §8 "Hold, reach, let go") — THE SPAWN BLOOM'S FUEL, read as the profiles column reads its circles:
// the same sets, the same usage rows through the port's one subscription, the same "cannot be read" and This Mac's
// installs, asked once per port (ruling 8). Each profile's bud wears that circle at the bloom's two sizes, a first
// ring's and a second's (puppeteer's `BLOOM.bud1` and `bud2`: 48 and 42).
//
// The clock: a reading's notch moves by the minute, so the map is read again each minute, but the stage hears of it
// only when the map has changed (its key), never because a minute passed. A new map is a new spawn menu, which reaches
// the view as new capabilities, never a remount; a bloom already open keeps the drawing it opened with.
//
// A read that throws gives no map at all: every bud is plain, never an old reading under a frozen age while the column
// shows its failed card. The throw stays here, so the column's own boundary is the one that names it.

/** The bloom's bud sizes, a first ring's then a second's. */
export const SPAWN_FUEL_SIZES: readonly number[] = [BLOOM.bud1, BLOOM.bud2];

const CLOCK_MS = 60_000;

export interface SpawnFuelInput {
  /** the profile filter's sets; null until the feed has answered, or with no profiles door: no fuel */
  sets: readonly AgentProfileSet[] | null;
  /** the usage rows (the port's one subscription); null until they have answered */
  rows: readonly AgentAccountUsageEntry[] | null;
  /** the usage feed could not be read (ruling 10): each plan that would read is the retry's thread */
  usageUnavailable: boolean;
  /** the stage's usage port: This Mac's installs */
  port?: MonitorUsagePort | undefined;
}

type Fuel = ReadonlyMap<string, MonitorSpawnFuel> | undefined;

const keyOf = (fuel: Fuel): string => (fuel === undefined ? "" : JSON.stringify([...fuel]));

/** Each profile's fuel by its set's id, or undefined (no sets yet, or a read that threw). */
export function useSpawnFuel({ sets, rows, usageUnavailable, port }: SpawnFuelInput): Fuel {
  const [installed, setInstalled] = useState<ReadonlySet<string> | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    port
      ?.installs?.()
      .then((answer) => {
        if (!cancelled) setInstalled(answer);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [port]);
  // the read the clock asks each minute, with what the stage holds now
  const read = useCallback(
    (now: Date): Fuel => readFuel(sets, rows, now, installed, usageUnavailable),
    [sets, rows, installed, usageUnavailable],
  );
  // the clock's last tick that moved the map: new facts are read now, a quiet minute is not a render
  const [at, setAt] = useState(() => Date.now());
  const held = useMemo(() => {
    const fuel = read(new Date(Math.max(at, Date.now())));
    return { fuel, key: keyOf(fuel) };
  }, [read, at]);
  const heldRef = useRef(held);
  heldRef.current = held;
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (keyOf(readRef.current(new Date(now))) !== heldRef.current.key) setAt(now);
    }, CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return held.fuel;
}

function readFuel(
  sets: readonly AgentProfileSet[] | null,
  rows: readonly AgentAccountUsageEntry[] | null,
  now: Date,
  installed: ReadonlySet<string> | undefined,
  usageUnavailable: boolean,
): Fuel {
  if (sets === null) return undefined;
  try {
    return spawnFuelMap(
      columnCircles(sets, rows, now, { installed, usageUnavailable }),
      SPAWN_FUEL_SIZES,
    );
  } catch {
    return undefined;
  }
}
