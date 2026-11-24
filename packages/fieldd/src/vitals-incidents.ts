import { randomBytes } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type CallerContext, VITALS } from "@vibefield/contracts";
import {
  VITALS_INCIDENT_ID,
  type VitalsIncidentDetailV1,
  VitalsIncidentGetParams,
  type VitalsIncidentKind,
  VitalsIncidentReportParams,
  type VitalsIncidentReportResult,
  type VitalsIncidentSubjectV1,
  type VitalsIncidentSummaryV1,
  VitalsIncidentV1,
  type VitalsProcessV1,
  type VitalsSampleV1,
  vitalsIncidentId,
} from "@vibefield/contracts/vitals";
import type { Logger } from "@vibefield/logging";
import type { CrashNote } from "./crash-note";
import type { FloorExit } from "./floor-exit";
import { RpcCallError } from "./native-link";
import type { ProductApi } from "./product-api";
import type { VitalsIncidentsPort, VitalsKept } from "./vitals-service";

// VT-4b (track VT, 2026-11-24; VT-D11 A, DESIGN.md §8 "Vitals", Incidents) — THE INCIDENT KEEPER. VT-4a made every
// death reach a log; this keeps the ones that are deaths or hangs as incidents: who (a process by its census
// identity), what (a kind from the closed list, a bounded detail), when, and the recorder's readings of the half
// minute before and the half minute after, so an incident can still be read after the ring has moved on.
//
// On disk: one JSON file an incident under `LAYOUT.VITALS_INCIDENTS_DIR`, 0600, written whole (a temporary file and
// a rename, as the crash note is). The newest `VITALS.INCIDENTS_MAX` for `VITALS.INCIDENT_KEEP_MS` are kept, pruned
// at boot and at every write; an expired incident's file is removed, since keeping them bounded is the rule. A file
// that does not read is set aside by a rename and never read again. An incident is written at once with what the
// ring holds, and again, complete, once the half minute after has been recorded or at stop: two writes an incident.
//
// Where they come from: the previous fieldd's crash note; a floor this fieldd started ending with a failure code or a
// signal it did not send; rosettad, the files host or the transcripts host dying on their own while ready; a loop
// held (a census row's own `loopBusy`); and Electron main's report of the shell's own (`vitals.incident.report`).
//
// Never: a terminal's processes (group `agents`, VT-D4), a planned stop, or anything while the recorder is off. What
// is kept stays when it is turned off, until it ages out.

/** What the keeper reads of the recorder (`VitalsService`). */
export interface IncidentRecorder {
  readonly on: boolean;
  kept(from: number, to: number): VitalsKept;
  emitIncidents(summaries: VitalsIncidentSummaryV1[]): void;
}

/** A new incident, as a source says it. */
export interface IncidentRaise {
  kind: VitalsIncidentKind;
  at: number;
  endedAt?: number;
  subject: VitalsIncidentSubjectV1;
  detail?: VitalsIncidentDetailV1;
}

export interface VitalsIncidentsOptions {
  /** the folder: `LAYOUT.VITALS_INCIDENTS_DIR` under the data root */
  dir: string;
  logger: Logger;
  now?: () => number;
  /** eight hex digits for a new id; random unless a test says */
  hex8?: () => string;
}

/** An emitter of a child supervisor's health: rosettad's, the files host's, the transcripts host's. */
export interface SupervisedChild {
  health(): { phase: string; pid: number | null };
  on(
    event: "transition",
    listener: (health: { phase: string; pid: number | null }) => void,
  ): unknown;
  off(
    event: "transition",
    listener: (health: { phase: string; pid: number | null }) => void,
  ): unknown;
}

/** Raises held before the recorder is attached: the previous crash and a floor's exit can come first. */
const HELD_MAX = 16;
/** The roles Electron main may report: its own processes, never fieldd's or the floor's. */
const SHELL_ROLES = new Set([
  "main",
  "window",
  "gpu",
  "utility",
  "browser-pane",
  "studio-window",
  "vitals-window",
  "other",
]);

const cut = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** The words an error carries, bounded for an incident. */
export function incidentErrorDetail(name: string, message: string): VitalsIncidentDetailV1 {
  const errorName = cut(name.trim(), 128);
  const said = cut(message.trim(), VITALS.INCIDENT_MESSAGE_MAX);
  return {
    ...(errorName === "" ? {} : { errorName }),
    ...(said === "" ? {} : { message: said }),
  };
}

function summaryOf(incident: VitalsIncidentV1): VitalsIncidentSummaryV1 {
  return {
    id: incident.id,
    kind: incident.kind,
    at: incident.at,
    ...(incident.endedAt !== undefined ? { endedAt: incident.endedAt } : {}),
    subject: incident.subject,
    ...(incident.detail !== undefined ? { detail: incident.detail } : {}),
    complete: incident.complete,
  };
}

/** A loop's run of held readings, one key's. */
interface LoopRun {
  since: number;
  last: number;
  count: number;
  peak: number;
  id: string | null;
}

export class VitalsIncidents implements VitalsIncidentsPort {
  private readonly now: () => number;
  private readonly hex8: () => string;
  /** every kept incident's summary, newest first */
  private list: VitalsIncidentSummaryV1[] = [];
  /** incidents still waiting for their half minute after, whole, by id */
  private readonly pending = new Map<string, VitalsIncidentV1>();
  private held: IncidentRaise[] = [];
  private recorder: IncidentRecorder | null = null;
  private newest: number | null = null;
  private intervalMs: number = VITALS.SAMPLE_INTERVAL_MS;
  private readonly runs = new Map<string, LoopRun>();
  /** floors this fieldd sent a signal to: their exit was asked for */
  private readonly signalled = new Set<number>();
  private stopped = false;

  constructor(private readonly options: VitalsIncidentsOptions) {
    this.now = options.now ?? Date.now;
    this.hex8 = options.hex8 ?? (() => randomBytes(4).toString("hex"));
  }

  // -- the folder --------------------------------------------------------------------------------------------

  /** Read what earlier boots kept, set aside what does not read, and prune. Never throws. */
  load(): void {
    const dir = this.options.dir;
    let names: string[];
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      names = readdirSync(dir);
    } catch (error) {
      this.options.logger.warn(
        "fieldd.vitals.incidents_unreadable",
        "The kept incidents' folder could not be read; none are listed",
        { error },
      );
      return;
    }
    const kept: VitalsIncidentSummaryV1[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue; // a temporary or a set-aside file
      const id = name.slice(0, -".json".length);
      if (!VITALS_INCIDENT_ID.test(id)) continue;
      const incident = this.readFile(id);
      if (incident === null) {
        this.setAside(name);
        continue;
      }
      kept.push(summaryOf(incident));
      // a fieldd that ended before the half minute after was recorded: the floor's backfill may still hold it
      if (!incident.complete) this.pending.set(id, incident);
    }
    this.list = kept.sort((a, b) => b.at - a.at);
    this.prune();
  }

  private pathOf(id: string): string {
    return join(this.options.dir, `${id}.json`);
  }

  private readFile(id: string): VitalsIncidentV1 | null {
    try {
      const parsed = VitalsIncidentV1.safeParse(JSON.parse(readFileSync(this.pathOf(id), "utf8")));
      return parsed.success && parsed.data.id === id ? parsed.data : null;
    } catch {
      return null;
    }
  }

  /** A file that does not read is renamed out of the list's way, never removed: someone may want to read it. */
  private setAside(name: string): void {
    const from = join(this.options.dir, name);
    try {
      renameSync(from, `${from}.${this.now()}.broken`);
      this.options.logger.warn(
        "fieldd.vitals.incident_set_aside",
        "A kept incident did not read and was set aside",
        { file: name },
      );
    } catch {
      // it is skipped all the same
    }
  }

  /** Written whole: a temporary file, 0600, renamed over the incident's own. */
  private write(incident: VitalsIncidentV1): boolean {
    const path = this.pathOf(incident.id);
    const partial = join(this.options.dir, `.${incident.id}.${process.pid}.tmp`);
    try {
      mkdirSync(this.options.dir, { recursive: true, mode: 0o700 });
      writeFileSync(partial, JSON.stringify(incident), { mode: 0o600 });
      chmodSync(partial, 0o600);
      renameSync(partial, path);
      return true;
    } catch (error) {
      this.options.logger.warn(
        "fieldd.vitals.incident_unwritten",
        "An incident could not be written; it is listed until fieldd stops",
        { id: incident.id, error },
      );
      return false;
    }
  }

  /** The newest `INCIDENTS_MAX` within `INCIDENT_KEEP_MS` stay; the rest are removed with their files. */
  private prune(): void {
    const oldest = this.now() - VITALS.INCIDENT_KEEP_MS;
    const stay: VitalsIncidentSummaryV1[] = [];
    for (const summary of this.list) {
      if (summary.at >= oldest && stay.length < VITALS.INCIDENTS_MAX) {
        stay.push(summary);
        continue;
      }
      this.pending.delete(summary.id);
      try {
        unlinkSync(this.pathOf(summary.id));
      } catch {
        // already gone
      }
    }
    this.list = stay;
  }

  // -- the recorder ------------------------------------------------------------------------------------------

  /** Attach the recorder: raises held until now are kept if it records. */
  attach(recorder: IncidentRecorder): void {
    this.recorder = recorder;
    const held = this.held;
    this.held = [];
    for (const raise of held) this.raise(raise);
    this.say();
  }

  summaries(): VitalsIncidentSummaryV1[] {
    return this.list.map((summary) => ({ ...summary }));
  }

  private say(): void {
    try {
      this.recorder?.emitIncidents(this.summaries());
    } catch {
      // a subscriber that cannot take it does not stop the keeper
    }
  }

  /** Keep a new incident. Null when nothing was kept: a terminal's process, the recorder off, or fieldd stopping. */
  raise(raise: IncidentRaise): string | null {
    if (this.stopped || raise.subject.group === "agents") return null;
    const recorder = this.recorder;
    if (recorder === null) {
      this.held.push(raise);
      if (this.held.length > HELD_MAX) this.held.splice(0, this.held.length - HELD_MAX);
      return null;
    }
    if (!recorder.on) return null;
    const subject = this.identify(raise.subject, raise.at, recorder);
    if (subject === null) return null;
    const incident: VitalsIncidentV1 = {
      v: 1,
      id: vitalsIncidentId(raise.at, this.hex8()),
      kind: raise.kind,
      at: raise.at,
      ...(raise.endedAt !== undefined ? { endedAt: raise.endedAt } : {}),
      subject,
      ...(raise.detail !== undefined && Object.keys(raise.detail).length > 0
        ? { detail: raise.detail }
        : {}),
      complete: false,
      intervalMs: this.intervalMs,
      memory: "footprint",
      processes: [],
      samples: [],
    };
    this.fill(incident, recorder);
    const end = incident.at + VITALS.INCIDENT_SPAN_MS;
    incident.complete =
      (this.newest !== null && this.newest >= end) ||
      recorder.kept(end, Number.MAX_SAFE_INTEGER).samples.length > 0;
    if (!incident.complete) this.pending.set(incident.id, incident);
    this.write(incident);
    this.list = [summaryOf(incident), ...this.list].sort((a, b) => b.at - a.at);
    this.prune();
    this.options.logger.info("fieldd.vitals.incident_kept", "An incident was kept", {
      id: incident.id,
      kind: incident.kind,
      group: subject.group,
      role: subject.role,
      ...(subject.pid !== undefined ? { subjectPid: subject.pid } : {}),
    });
    this.say();
    return incident.id;
  }

  /** The census's row for a pid, where the ring holds one near the moment; and never a terminal's. */
  private identify(
    subject: VitalsIncidentSubjectV1,
    at: number,
    recorder: IncidentRecorder,
  ): VitalsIncidentSubjectV1 | null {
    if (subject.pid === undefined || subject.key !== undefined) return subject;
    const near = recorder.kept(at - VITALS.INCIDENT_SPAN_MS, at + VITALS.INCIDENT_SPAN_MS);
    const row = near.processes.find((process) => process.pid === subject.pid);
    if (row === undefined) return subject;
    if (row.group === "agents") return null; // a pid that is a terminal's is never an incident's subject
    return { ...subject, key: row.key };
  }

  /** Merge the ring's readings around the moment into what the incident already holds, by time. */
  private fill(incident: VitalsIncidentV1, recorder: IncidentRecorder): void {
    const span = VITALS.INCIDENT_SPAN_MS;
    const kept = recorder.kept(incident.at - span, incident.at + span);
    if (kept.samples.length === 0) return;
    incident.intervalMs = kept.intervalMs;
    incident.memory = kept.memory;
    const byTime = new Map<number, VitalsSampleV1>();
    for (const sample of incident.samples) byTime.set(sample.time, sample);
    for (const sample of kept.samples)
      if (!byTime.has(sample.time)) byTime.set(sample.time, sample);
    let samples = [...byTime.values()];
    if (samples.length > VITALS.INCIDENT_SAMPLES_MAX) {
      // the readings nearest the moment stay
      samples = samples
        .sort((a, b) => Math.abs(a.time - incident.at) - Math.abs(b.time - incident.at))
        .slice(0, VITALS.INCIDENT_SAMPLES_MAX);
    }
    incident.samples = samples.sort((a, b) => a.time - b.time);
    const named = new Set<string>();
    for (const sample of incident.samples) for (const point of sample.points) named.add(point.key);
    const processes = new Map<string, VitalsProcessV1>();
    for (const process of [...incident.processes, ...kept.processes]) {
      if (named.has(process.key) && processes.size < VITALS.FLOOR_ROWS_MAX)
        processes.set(process.key, process);
    }
    incident.processes = [...processes.values()];
  }

  /** A sample was recorded: complete what waited for it, and follow every loop that says its own. */
  recorded(sample: VitalsSampleV1, processOf: (key: string) => VitalsProcessV1 | undefined): void {
    if (this.newest !== null && sample.time > this.newest) {
      this.intervalMs = Math.max(1, Math.min(60_000, sample.time - this.newest));
    }
    this.newest = Math.max(this.newest ?? sample.time, sample.time);
    this.followLoops(sample, processOf);
    const recorder = this.recorder;
    if (recorder === null) return;
    for (const incident of [...this.pending.values()]) {
      if (sample.time < incident.at + VITALS.INCIDENT_SPAN_MS) continue;
      this.complete(incident, recorder);
    }
  }

  private complete(incident: VitalsIncidentV1, recorder: IncidentRecorder): void {
    this.fill(incident, recorder);
    incident.complete = true;
    this.pending.delete(incident.id);
    this.write(incident);
    this.replaceSummary(incident);
  }

  private replaceSummary(incident: VitalsIncidentV1): void {
    this.list = this.list.map((summary) =>
      summary.id === incident.id ? summaryOf(incident) : summary,
    );
    this.say();
  }

  // -- a loop held -------------------------------------------------------------------------------------------

  /** One incident an episode: a row's own `loopBusy` at or over the threshold for the count of readings in a row.
   * Its moment is the start of the first held second, its end the last held reading. */
  private followLoops(
    sample: VitalsSampleV1,
    processOf: (key: string) => VitalsProcessV1 | undefined,
  ): void {
    const seen = new Set<string>();
    for (const point of sample.points) {
      const busy = point.own?.loopBusy;
      const process = processOf(point.key);
      if (process === undefined || process.group === "agents") continue;
      seen.add(point.key);
      const run = this.runs.get(point.key);
      if (busy !== undefined && busy * 100 >= VITALS.LOOP_HELD_PERCENT) {
        const next = run ?? { since: sample.time, last: sample.time, count: 0, peak: 0, id: null };
        next.count += 1;
        next.last = sample.time;
        next.peak = Math.max(next.peak, busy);
        this.runs.set(point.key, next);
        if (next.id === null && next.count === VITALS.LOOP_HELD_SAMPLES) {
          next.id = this.raise({
            kind: "loop-held",
            at: next.since - this.intervalMs,
            subject: {
              group: process.group,
              role: process.role,
              ...(process.label !== undefined ? { label: process.label } : {}),
              pid: process.pid,
              key: process.key,
            },
            detail: { peak: Math.round(next.peak * 10_000) / 10_000 },
          });
        }
      } else if (run !== undefined) {
        this.endRun(point.key, run);
      }
    }
    for (const [key, run] of this.runs) if (!seen.has(key)) this.endRun(key, run);
  }

  private endRun(key: string, run: LoopRun): void {
    this.runs.delete(key);
    if (run.id !== null)
      this.update(run.id, { endedAt: run.last, peak: Math.round(run.peak * 10_000) / 10_000 });
  }

  /** Say how an incident ended (and a held loop's peak) on its record, pending or written. */
  private update(id: string, change: { endedAt: number; peak?: number }): boolean {
    const incident = this.pending.get(id) ?? this.readFile(id);
    if (incident === null) return false;
    incident.endedAt = Math.max(incident.at, change.endedAt);
    if (change.peak !== undefined) incident.detail = { ...incident.detail, peak: change.peak };
    this.write(incident);
    this.replaceSummary(incident);
    return true;
  }

  // -- the sources -------------------------------------------------------------------------------------------

  /** The previous fieldd's crash note, read at boot (`fieldd.lifecycle.previous_crash`). */
  previousCrash(note: CrashNote): string | null {
    return this.raise({
      kind: "crash",
      at: note.at,
      subject: { group: "fieldd", role: "fieldd", ...(note.pid > 0 ? { pid: note.pid } : {}) },
      detail: incidentErrorDetail(note.name, note.message),
    });
  }

  /** This fieldd is about to signal a floor (its drain ladder): that exit was asked for, and is not an incident. */
  noteSignalled(pid: number): void {
    this.signalled.add(pid);
    if (this.signalled.size > HELD_MAX) {
      const first = this.signalled.values().next().value;
      if (first !== undefined) this.signalled.delete(first);
    }
  }

  /** A floor this fieldd started ended (`floor-exit.ts`). A clean exit, or one fieldd signalled, is not an incident. */
  floorExited(exit: FloorExit): string | null {
    if (exit.code === 0) return null;
    if (exit.pid !== null && this.signalled.has(exit.pid)) return null;
    return this.raise({
      kind: "exit",
      at: exit.at,
      subject: {
        group: "floor",
        role: "field-native",
        ...(exit.pid !== null ? { pid: exit.pid } : {}),
      },
      detail: {
        ...(exit.code !== null ? { code: exit.code } : {}),
        ...(exit.signal !== null ? { signal: cut(exit.signal, 32) } : {}),
      },
    });
  }

  /** Follow one of fieldd's supervised children. Its death on its own is the supervisor's `ready` → `restarting`
   * with no pid, in one step; a stop, a restart a person asked for, or a failure fieldd ended takes other steps and
   * is not an incident. Returns how to stop following. */
  followChild(
    child: SupervisedChild,
    role: "rosettad" | "files-host" | "transcripts-host",
  ): () => void {
    let before: { phase: string; pid: number | null } | null = null;
    try {
      const now = child.health();
      before = { phase: now.phase, pid: now.pid };
    } catch {
      // the first transition is its baseline
    }
    const listener = (health: { phase: string; pid: number | null }): void => {
      const last = before;
      before = { phase: health.phase, pid: health.pid };
      if (
        last !== null &&
        last.phase === "ready" &&
        typeof last.pid === "number" &&
        health.phase === "restarting" &&
        health.pid === null
      ) {
        this.raise({
          kind: "exit",
          at: this.now(),
          subject: { group: "fieldd", role, pid: last.pid },
        });
      }
    };
    child.on("transition", listener);
    return () => child.off("transition", listener);
  }

  /** Electron main's report (`vitals.incident.report`). */
  report(raw: unknown): VitalsIncidentReportResult {
    const parsed = VitalsIncidentReportParams.safeParse(raw);
    if (!parsed.success || !SHELL_ROLES.has(parsed.data.role)) {
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        "expected { kind, role (one of the shell's), pid?, at, detail? }",
        false,
        { issues: parsed.success ? 0 : parsed.error.issues.length },
      );
    }
    const report = parsed.data;
    const group = report.role === "vitals-window" ? "observer" : "shell";
    const open = (): VitalsIncidentSummaryV1 | undefined =>
      this.list.find(
        (summary) =>
          summary.kind === "unresponsive" &&
          summary.endedAt === undefined &&
          summary.subject.group === group &&
          summary.subject.role === report.role &&
          (report.pid === undefined || summary.subject.pid === report.pid),
      );
    if (report.kind === "responsive") {
      const standing = open();
      if (standing === undefined) return { accepted: false };
      return { accepted: this.update(standing.id, { endedAt: report.at }), id: standing.id };
    }
    // a page that is already said to not respond is not said twice
    if (report.kind === "unresponsive") {
      const standing = open();
      if (standing !== undefined) return { accepted: false, id: standing.id };
    }
    const id = this.raise({
      kind: report.kind,
      at: report.at,
      subject: {
        group,
        role: report.role,
        ...(report.label !== undefined ? { label: report.label } : {}),
        ...(report.pid !== undefined ? { pid: report.pid } : {}),
      },
      ...(report.detail !== undefined ? { detail: report.detail } : {}),
    });
    return id === null ? { accepted: false } : { accepted: true, id };
  }

  /** One incident whole, or null when it is not kept. */
  get(id: string): VitalsIncidentV1 | null {
    if (!VITALS_INCIDENT_ID.test(id) || !this.list.some((summary) => summary.id === id))
      return null;
    const pending = this.pending.get(id);
    if (pending !== undefined && this.recorder !== null) {
      // what it holds so far, with what the ring has since: nothing is written for a read
      const copy: VitalsIncidentV1 = structuredClone(pending);
      this.fill(copy, this.recorder);
      return copy;
    }
    return pending ?? this.readFile(id);
  }

  // -- the doors ---------------------------------------------------------------------------------------------

  register(api: Pick<ProductApi, "register">): void {
    api.register("vitals.incidents.get", (ctx, params) => {
      assertLocalShell(ctx, false);
      const parsed = VitalsIncidentGetParams.safeParse(params);
      if (!parsed.success) {
        throw new RpcCallError("PRECONDITION_FAILED", "expected { id } of a kept incident", false);
      }
      const incident = this.get(parsed.data.id);
      if (incident === null) {
        throw new RpcCallError("NOT_FOUND", "no incident is kept by that id", false);
      }
      return incident;
    });
    api.register("vitals.incident.report", (ctx, params) => {
      assertLocalShell(ctx, true);
      return this.report(params);
    });
  }

  /** fieldd is stopping: what waits for its half minute after is written with what it has. */
  stop(): void {
    if (this.stopped) return;
    for (const [key, run] of [...this.runs]) this.endRun(key, run);
    this.stopped = true;
    const recorder = this.recorder;
    for (const incident of [...this.pending.values()]) {
      if (recorder !== null) this.fill(incident, recorder);
      incident.complete = true;
      this.pending.delete(incident.id);
      this.write(incident);
    }
    this.recorder = null;
  }
}

/** The scope names the door; this holds it to the shell on this device, as `vitals.*` is held
 * (`VitalsService`): a report is Electron main's alone. */
function assertLocalShell(ctx: CallerContext, mainOnly: boolean): void {
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
