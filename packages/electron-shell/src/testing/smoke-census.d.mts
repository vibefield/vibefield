// Types for smoke-census.mjs (item 116): the in-app teardown (`smoke-daemons.ts`) imports it from TypeScript.

/** The variable `run-smoke.mjs` marks a run with (its profile's name). */
export declare const SMOKE_RUN_ENV: "VF_SMOKE_RUN";

/** One of the run's processes, as `ps` lists it. */
export type CensusProcess = {
  pid: number;
  ppid: number;
  /** what it is, read off its command line (never its environment): `field-native`, `fieldd`, `electron-helper`, … */
  name: string;
  /** one of Electron's own Chromium children (its GPU, renderer, network or utility process, its crash handler) */
  helper: boolean;
  /** the plain table's command line, or null when the plain table had no line for it */
  command: string | null;
};

/** The census's spawner: one `ps` with these arguments, its stdout; it throws as `execFileSync` does. */
export type Ps = (args: string[]) => string;

/** `ps` in a platform's own spelling, for the census's three reads. */
export type PsSpelling = { table: string[]; one: string[]; oneWithEnv: string[] };

export declare function processName(command: string): string;
export declare function runProcesses(withEnv: string, plain: string, mark: string): CensusProcess[];
export declare function psTables(platform?: NodeJS.Platform): PsSpelling;
export declare function listRunProcesses(
  mark: string,
  ps?: Ps,
  spelling?: PsSpelling,
): CensusProcess[];
export declare function stillRunning(
  mark: string,
  pids: readonly number[],
  ps?: Ps,
  spelling?: PsSpelling,
): number[];
