import { type CallerContext, VITALS } from "@vibefield/contracts";
import {
  type NativeVitalsReading,
  NativeVitalsSample,
  NativeVitalsSnapshot,
  type VitalsDeltaV1,
  type VitalsGroup,
  VitalsOwnV1,
  type VitalsPointV1,
  type VitalsProcessV1,
  VitalsQueryParams,
  type VitalsQueryResult,
  type VitalsRole,
  type VitalsRosterEntry,
  VitalsRosterSetParams,
  type VitalsSampleV1,
  type VitalsSeriesV1,
  type VitalsSnapshotV1,
  vitalsKey,
} from "@vibefield/contracts/vitals";
import type { Logger } from "@vibefield/logging";
import { type NativeLink, RpcCallError } from "./native-link";
import type { ProductApi } from "./product-api";

// VT-1 (track VT, 2026-11-24; `draft/thinking-vitals.md`) — the vitals recorder. The floor measures every process
// and names none but its own children (`native.vitals.*`); this service names the rest, turns the floor's cumulative
// counters into rates, keeps the last half hour, and answers the Vitals window (`vitals.*`).
//
// It decides nothing and controls nothing: it is a read model. What it knows of a process is a pid from the code
// that started it, a role from a closed list and a label that code already shows a person. It never reads a
// process's arguments, folder, environment or output (VT-D4).

/** A process one of fieldd's own parts can name: who started it knows its pid. */
export interface VitalsNamedProcess {
  pid: number;
  group: VitalsGroup;
  role: VitalsRole;
  label?: string;
  /** measure everything under it too: a terminal's process and what it runs */
  tree?: boolean;
}

/** Asked at every sample, so it answers from memory and never waits. A source that throws names nobody. */
export type VitalsSource = () => readonly VitalsNamedProcess[];

export interface VitalsServiceOptions {
  native: NativeLink;
  logger: Logger;
  sources: readonly VitalsSource[];
  /** VT-3 — what fieldd says of itself (`own-vitals.ts`): folded once a recorded sample and carried on fieldd's
   * own row; stopped with the recorder. Absent, the row carries the census alone. */
  own?: { fold(): VitalsOwnV1; dispose(): void };
}

type Emit = (payload: unknown, kind?: "delta" | "snapshot") => void;

/** What the last reading of a process said, kept to make the next one a rate. */
interface Previous {
  time: number;
  cpuUs: number;
  diskReadBytes: number | null;
  diskWrittenBytes: number | null;
  wakeups: number | null;
  energyNj: number | null;
}

interface Recorded {
  sample: VitalsSampleV1;
  /** what the floor's reading cost, microseconds */
  tookUs: number;
}

/** What a row is, beside which process it is. */
interface Identity {
  group: string;
  role: string;
  label?: string;
  tree?: true;
}

const SHELL_GROUP_OF: Partial<Record<VitalsRole, VitalsGroup>> = { "vitals-window": "observer" };

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/** A counter's growth a second; null when either reading has no figure. A counter that reads lower than before
 * (never, for one process) is no growth, not a negative rate. */
function rate(now: number | null, before: number | null, seconds: number): number | null {
  if (now === null || before === null) return null;
  return round(Math.max(0, now - before) / seconds, 1);
}

export class VitalsService {
  private readonly sources: readonly VitalsSource[];
  private roster: VitalsRosterEntry[] = [];
  private state: string = "waiting";
  private detail: string | undefined = "the floor's meter has not answered yet";
  private intervalMs: number = VITALS.SAMPLE_INTERVAL_MS;
  private memory: "footprint" | "resident" = "footprint";
  private floorBootId: string | null = null;
  private floorSeq = 0;
  private seq = 0;
  private readonly previous = new Map<string, Previous>();
  /** every process a kept sample names; `live` are those the newest names */
  private readonly known = new Map<string, VitalsProcessV1>();
  private live = new Set<string>();
  private readonly ring: Recorded[] = [];
  private readonly subscribers = new Set<Emit>();
  private watchSent: string | null = null;
  private attached = false;
  private attaching: Promise<void> | null = null;
  private disposed = false;

  private readonly onConnected = (): void => {
    // the floor forgets its watch list with its process, and a link that came back may be a new floor's
    this.watchSent = null;
    if (!this.attached) void this.attach();
    else this.pushWatch();
  };
  private readonly onClosed = (): void => {
    this.setState("waiting", "the floor is not answering");
  };

  constructor(private readonly options: VitalsServiceOptions) {
    this.sources = options.sources;
    options.native.on("connected", this.onConnected);
    options.native.on("closed", this.onClosed);
  }

  async start(): Promise<void> {
    await this.attach();
  }

  register(api: ProductApi): void {
    api.registerSubscription("vitals.subscribe", (ctx, _params, emit) => {
      this.assertShell(ctx, false);
      return Promise.resolve(this.subscribe(emit));
    });
    api.register("vitals.query", (ctx, params) => {
      this.assertShell(ctx, false);
      return this.query(params);
    });
    api.register("vitals.roster.set", (ctx, params) => {
      this.assertShell(ctx, true);
      return this.setRoster(params);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.options.native.off("connected", this.onConnected);
    this.options.native.off("closed", this.onClosed);
    this.subscribers.clear();
    try {
      this.options.own?.dispose();
    } catch {
      // an observer that will not stop ends with the process
    }
  }

  /** The scope names the door; this holds it to the shell on this device, as the diagnostics doors are held. The
   * roster is Electron main's alone: only it knows which of its processes is which. */
  private assertShell(ctx: CallerContext, mainOnly: boolean): void {
    const kind = ctx.principal.kind;
    const allowed = mainOnly
      ? kind === "shell-main"
      : kind === "shell-main" || kind === "local-token";
    if (ctx.transport !== "ws-loopback" || !allowed) {
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "vitals are available only to the trusted local shell",
        false,
      );
    }
  }

  // -- the floor ---------------------------------------------------------------------------------------------

  private async attach(): Promise<void> {
    if (this.disposed || this.attached) return;
    if (this.attaching) return await this.attaching;
    this.attaching = (async () => {
      try {
        // `sinceSeq: 0` asks for what the floor kept while no fieldd listened: the minutes before this fieldd
        // began, an earlier fieldd's last ones among them. A replay after a reconnect asks the same, and
        // `applySnapshot` drops what it already holds.
        const { snapshot } = await this.options.native.subscribe(
          "native.vitals.subscribe",
          { sinceSeq: 0 },
          (payload, kind) => {
            if (this.disposed) return;
            if (kind === "snapshot") this.applySnapshot(payload);
            else this.applySample(payload);
          },
        );
        this.attached = true;
        this.applySnapshot(snapshot);
        this.pushWatch();
      } catch (error) {
        // A floor that predates the meter answers METHOD_NOT_FOUND; a floor that is down answers nothing. Either
        // way nothing is drawn as zero, and the next "connected" asks again.
        this.setState("waiting", "the floor's meter is not answering");
        this.options.logger.info(
          "fieldd.vitals.meter_unavailable",
          "The floor's vitals meter did not answer; fieldd will ask again when the link returns",
          { error },
        );
      } finally {
        this.attaching = null;
      }
    })();
    await this.attaching;
  }

  private applySnapshot(raw: unknown): void {
    const parsed = NativeVitalsSnapshot.safeParse(raw);
    if (!parsed.success) {
      this.rejected("snapshot", parsed.error.issues.length);
      return;
    }
    const snapshot = parsed.data;
    if (snapshot.bootId !== this.floorBootId) {
      // another floor: its counters and its sample numbers begin again, and it holds no watch list
      this.floorBootId = snapshot.bootId;
      this.floorSeq = 0;
      this.previous.clear();
      this.watchSent = null;
    }
    this.intervalMs = snapshot.intervalMs;
    if (snapshot.state === "unavailable") {
      this.setState("unavailable", snapshot.detail ?? "the floor cannot measure here");
      return;
    }
    for (const sample of snapshot.samples) this.record(sample);
    if (snapshot.samples.length === 0 && this.state !== "recording") {
      this.setState("waiting", "the floor's meter has no reading yet");
    }
    this.pushWatch();
  }

  private applySample(raw: unknown): void {
    const parsed = NativeVitalsSample.safeParse(raw);
    if (!parsed.success) {
      this.rejected("sample", parsed.error.issues.length);
      return;
    }
    this.record(parsed.data);
  }

  private rejected(what: string, issues: number): void {
    this.options.logger.warn(
      "fieldd.vitals.reading_rejected",
      "A vitals reading from the floor did not parse and was dropped",
      { what, issues },
    );
  }

  private setState(state: string, detail: string | undefined): void {
    if (this.state === state && this.detail === detail) return;
    this.state = state;
    this.detail = detail;
    const delta: VitalsDeltaV1 = { state, ...(detail !== undefined ? { detail } : {}) };
    this.emit(delta);
  }

  private emit(delta: VitalsDeltaV1): void {
    for (const emit of this.subscribers) emit(delta, "delta");
  }

  // -- naming ------------------------------------------------------------------------------------------------

  /** Everyone fieldd and the shell can name, by pid. fieldd's own parts speak first: a pid named twice keeps its
   * first name. */
  private named(): Map<number, VitalsNamedProcess> {
    const named = new Map<number, VitalsNamedProcess>();
    for (const source of this.sources) {
      let rows: readonly VitalsNamedProcess[] = [];
      try {
        rows = source();
      } catch {
        rows = [];
      }
      for (const row of rows) if (!named.has(row.pid)) named.set(row.pid, row);
    }
    for (const entry of this.roster) {
      if (named.has(entry.pid)) continue;
      named.set(entry.pid, {
        pid: entry.pid,
        group: SHELL_GROUP_OF[entry.role] ?? "shell",
        role: entry.role,
        ...(entry.label !== undefined ? { label: entry.label } : {}),
      });
    }
    return named;
  }

  /** Tell the floor whom to measure beside its own, when the list changed. */
  private pushWatch(named: Map<number, VitalsNamedProcess> = this.named()): void {
    if (this.disposed || !this.attached) return;
    const watch = [...named.values()]
      .slice(0, VITALS.WATCH_MAX)
      .map((row) => ({ pid: row.pid, tree: row.tree === true }));
    const fingerprint = watch.map((row) => `${row.pid}${row.tree ? "t" : ""}`).join(",");
    if (fingerprint === this.watchSent) return;
    this.watchSent = fingerprint;
    this.options.native.request("native.vitals.watch.set", { watch }).catch((error: unknown) => {
      // said once per list: the next change, or the next "connected", sends again
      this.watchSent = null;
      this.options.logger.info(
        "fieldd.vitals.watch_refused",
        "The floor did not take the vitals watch list",
        { error },
      );
    });
  }

  private identify(
    row: NativeVitalsReading,
    named: Map<number, VitalsNamedProcess>,
  ): Identity | null {
    if (row.origin === "floor") return { group: "floor", role: "field-native" };
    if (row.origin === "child") return { group: "floor", role: row.child ?? "other" };
    const name = named.get(row.pid);
    if (name === undefined) return null; // asked for once, named by nobody now: not drawn
    return {
      group: name.group,
      role: name.role,
      ...(name.label !== undefined ? { label: name.label.slice(0, VITALS.LABEL_MAX) } : {}),
      ...(row.tree !== undefined ? { tree: true } : {}),
    };
  }

  // -- recording ---------------------------------------------------------------------------------------------

  private record(sample: NativeVitalsSample): void {
    if (sample.seq <= this.floorSeq) return; // a replay's overlap
    this.floorSeq = sample.seq;
    const named = this.named();
    this.pushWatch(named);

    const points: VitalsPointV1[] = [];
    const arrived: VitalsProcessV1[] = [];
    const seen = new Set<string>();
    let footprintSeen = false;
    for (const row of sample.rows) {
      const identity = this.identify(row, named);
      if (identity === null) continue;
      const key = vitalsKey(row.pid, row.startedAt);
      if (seen.has(key)) continue;
      seen.add(key);
      if (row.footprintBytes !== null) footprintSeen = true;

      const process: VitalsProcessV1 = { key, pid: row.pid, startedAt: row.startedAt, ...identity };
      const before = this.known.get(key);
      if (
        before === undefined ||
        before.group !== process.group ||
        before.role !== process.role ||
        before.label !== process.label ||
        before.tree !== process.tree ||
        !this.live.has(key)
      ) {
        arrived.push(process);
      }
      this.known.set(key, process);

      const tree = row.tree;
      const cpuUs = row.cpuUserUs + row.cpuSystemUs + (tree?.cpuUs ?? 0);
      const memBytes = (row.footprintBytes ?? row.residentBytes) + (tree?.footprintBytes ?? 0);
      const last = this.previous.get(key);
      const seconds = last === undefined ? 0 : (sample.time - last.time) / 1_000;
      const measured = last !== undefined && seconds > 0;
      points.push({
        key,
        cpu: measured ? round(Math.max(0, cpuUs - last.cpuUs) / (seconds * 1_000_000), 4) : null,
        memBytes,
        diskReadBps: measured ? rate(row.diskReadBytes, last.diskReadBytes, seconds) : null,
        diskWriteBps: measured ? rate(row.diskWrittenBytes, last.diskWrittenBytes, seconds) : null,
        wakeupsPerSec: measured ? rate(row.wakeups, last.wakeups, seconds) : null,
        // nanojoules a second are nanowatts; a million of them a milliwatt
        powerMw: measured
          ? ((watts) => (watts === null ? null : round(watts / 1_000_000, 1)))(
              rate(row.energyNj, last.energyNj, seconds),
            )
          : null,
        ...(tree !== undefined ? { processes: 1 + tree.processes } : {}),
        // fieldd's own row is the one its own source names by this role
        ...(identity.role === "fieldd" ? this.ownPoint() : {}),
      });
      this.previous.set(key, {
        time: sample.time,
        cpuUs,
        diskReadBytes: row.diskReadBytes,
        diskWrittenBytes: row.diskWrittenBytes,
        wakeups: row.wakeups,
        energyNj: row.energyNj,
      });
    }

    const gone = [...this.live].filter((key) => !seen.has(key));
    for (const key of gone) this.previous.delete(key);
    this.live = seen;
    if (sample.rows.length > 0) this.memory = footprintSeen ? "footprint" : "resident";

    this.seq += 1;
    const recorded: VitalsSampleV1 = { seq: this.seq, time: sample.time, points };
    this.ring.push({ sample: recorded, tookUs: sample.tookUs });
    if (this.ring.length > VITALS.RECORDER_RING_SAMPLES) {
      this.ring.splice(0, this.ring.length - VITALS.RECORDER_RING_SAMPLES);
      this.forgetUnnamed();
    }

    const wasRecording = this.state === "recording";
    this.state = "recording";
    this.detail = undefined;
    this.emit({
      ...(wasRecording ? {} : { state: "recording" }),
      ...(arrived.length > 0 ? { processes: arrived } : {}),
      ...(gone.length > 0 ? { gone } : {}),
      sample: recorded,
    });
  }

  /** fieldd's own vitals for the sample being recorded, as a point's field. A fold that throws or does not parse
   * says nothing: the census row stands without it. */
  private ownPoint(): { own?: VitalsOwnV1 } {
    const source = this.options.own;
    if (source === undefined) return {};
    try {
      const own = VitalsOwnV1.safeParse(source.fold());
      return own.success && Object.keys(own.data).length > 0 ? { own: own.data } : {};
    } catch {
      return {};
    }
  }

  /** Drop every process no kept sample names any more, so the names cannot outgrow the ring. */
  private forgetUnnamed(): void {
    const referenced = new Set<string>(this.live);
    for (const { sample } of this.ring)
      for (const point of sample.points) referenced.add(point.key);
    for (const key of this.known.keys()) if (!referenced.has(key)) this.known.delete(key);
  }

  // -- the door ----------------------------------------------------------------------------------------------

  snapshot(): VitalsSnapshotV1 {
    const kept = this.ring.slice(-VITALS.SNAPSHOT_SAMPLES);
    const keys = new Set<string>(this.live);
    for (const { sample } of kept) for (const point of sample.points) keys.add(point.key);
    const processes: VitalsProcessV1[] = [];
    for (const key of keys) {
      const process = this.known.get(key);
      if (process !== undefined && processes.length < VITALS.FLOOR_ROWS_MAX)
        processes.push(process);
    }
    const spentUs = kept.reduce((sum, entry) => sum + entry.tookUs, 0);
    const spanUs = kept.length * this.intervalMs * 1_000;
    return {
      v: 1,
      state: this.state,
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
      intervalMs: this.intervalMs,
      memory: this.memory,
      processes,
      samples: kept.map((entry) => entry.sample),
      observer: { meterCpu: spanUs === 0 ? 0 : round(spentUs / spanUs, 5) },
    };
  }

  private subscribe(emit: Emit): { snapshot: VitalsSnapshotV1; dispose: () => void } {
    this.subscribers.add(emit);
    return { snapshot: this.snapshot(), dispose: () => this.subscribers.delete(emit) };
  }

  query(raw: unknown): VitalsQueryResult {
    const parsed = VitalsQueryParams.safeParse(raw);
    if (!parsed.success || parsed.data.to < parsed.data.from) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "expected { from, to, keys? } with from ≤ to",
        false,
      );
    }
    const { from, to, keys } = parsed.data;
    const wanted = keys === undefined ? null : new Set(keys);
    // whole intervals, as few as cover the span in QUERY_MAX_POINTS steps
    const steps = Math.max(1, Math.ceil((to - from) / this.intervalMs));
    const stepMs = this.intervalMs * Math.max(1, Math.ceil(steps / VITALS.QUERY_MAX_POINTS));
    const count = Math.min(VITALS.QUERY_MAX_POINTS, Math.max(1, Math.ceil((to - from) / stepMs)));
    const times = Array.from({ length: count }, (_, index) => from + index * stepMs);

    interface Fold {
      cpuSum: number[];
      cpuCount: number[];
      cpuPeak: (number | null)[];
      memPeak: (number | null)[];
    }
    const folds = new Map<string, Fold>();
    for (const { sample } of this.ring) {
      if (sample.time < from || sample.time >= from + count * stepMs) continue;
      const step = Math.floor((sample.time - from) / stepMs);
      for (const point of sample.points) {
        if (wanted !== null && !wanted.has(point.key)) continue;
        let fold = folds.get(point.key);
        if (fold === undefined) {
          if (folds.size >= VITALS.QUERY_PROCESSES_MAX) continue;
          fold = {
            cpuSum: new Array<number>(count).fill(0),
            cpuCount: new Array<number>(count).fill(0),
            cpuPeak: new Array<number | null>(count).fill(null),
            memPeak: new Array<number | null>(count).fill(null),
          };
          folds.set(point.key, fold);
        }
        fold.memPeak[step] = Math.max(fold.memPeak[step] ?? 0, point.memBytes);
        if (point.cpu !== null) {
          fold.cpuSum[step] = (fold.cpuSum[step] ?? 0) + point.cpu;
          fold.cpuCount[step] = (fold.cpuCount[step] ?? 0) + 1;
          fold.cpuPeak[step] = Math.max(fold.cpuPeak[step] ?? 0, point.cpu);
        }
      }
    }

    const processes: VitalsProcessV1[] = [];
    const series: VitalsSeriesV1[] = [];
    for (const [key, fold] of folds) {
      const process = this.known.get(key);
      if (process === undefined) continue;
      processes.push(process);
      series.push({
        key,
        cpuMean: fold.cpuSum.map((sum, index) => {
          const readings = fold.cpuCount[index] ?? 0;
          return readings === 0 ? null : round(sum / readings, 4);
        }),
        cpuPeak: fold.cpuPeak,
        memPeak: fold.memPeak,
      });
    }
    return { v: 1, stepMs, times, processes, series };
  }

  private setRoster(raw: unknown): { accepted: number } {
    const parsed = VitalsRosterSetParams.safeParse(raw);
    if (!parsed.success) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "expected { processes: [{ pid, role, label? }] }",
        false,
        {
          issues: parsed.error.issues.length,
        },
      );
    }
    this.roster = parsed.data.processes;
    this.pushWatch();
    return { accepted: this.roster.length };
  }
}
