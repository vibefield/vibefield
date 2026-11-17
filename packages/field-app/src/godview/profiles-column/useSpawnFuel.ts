import type { AgentAccountUsageEntry, AgentProfileSet } from "@vibefield/contracts";
import type { MonitorSpawnFuel } from "@vibefield/puppeteer-view-sdk";
import type { MonitorUsagePort } from "../monitor/remote-door";

// PU-R (DESIGN.md §8 "Hold, reach, let go") — THE SPAWN BLOOM'S FUEL, read as the profiles column reads its circles.
// RED: the hook's signature alone; it hands no fuel, so every bud is plain until the green commit.

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

/** Each profile's fuel by its set's id, or undefined. RED: always undefined. */
export function useSpawnFuel(
  _input: SpawnFuelInput,
): ReadonlyMap<string, MonitorSpawnFuel> | undefined {
  return undefined;
}
