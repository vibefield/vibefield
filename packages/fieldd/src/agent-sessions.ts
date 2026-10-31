import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  AGENT_SESSION_RECORD_FORMAT,
  type AgentModelSelection,
  AgentMonitorMirror,
  type AgentSessionAttach,
  type AgentSessionOrigin,
  type AgentSessionRecord,
  AgentSessionRecord as AgentSessionRecordSchema,
  type AgentSessionSummary,
  type AgentStatus,
  type SparkId,
  type TerminalInfo,
} from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";
import type { AgentMonitorState, AgentTurnStop, TerminalKey } from "@vibefield/puppeteer-core";
import type { AgentSessionInfo } from "@vibefield/puppeteer-runtime";
import { isTypedRun, SPAWNED_BY_SHELL } from "./agent-typed-run";

// The managed-session records and the fold's projection (AR-3;
// thinking-ar-agent-plane.md §5/§7/§9 as ruled). Pure where it can be: the
// projection is a function of puppeteer's facts, the floor's inventory row
// and the record, so the seam is testable without a PTY.

/** `users/<fuid>/agents/sessions/<runtimeRunId>.json` — one record per
 * managed session (LAYOUT.AGENT_SESSIONS_DIR), 0600, private temp + durable
 * rename, the directory 0700. Read at resume and at re-attach; a record that
 * cannot be read is set aside for a human, never overwritten and never a
 * boot failure. The continuation inside is puppeteer's and opaque.
 *
 * TAMPER EVIDENCE (AR-4b, EL7): a record is a control input to the daemon's
 * own acts — the boot re-attaches to the PTY it names and resume-when-idle
 * TERMINATES that PTY — so a same-uid adversary who can drop a file here must
 * not be able to point fieldd at a terminal it never spawned. Every record
 * fieldd writes carries an HMAC-SHA256 over its canonical JSON, keyed by a
 * 32-byte secret minted once per user root (`LAYOUT.AGENT_SESSIONS_KEY_FILE`,
 * 0600, created without overwrite). A record without a signature, with a
 * signature that does not verify, or exposed to other users by its mode, is
 * SET ASIDE at read (a distinct log event each) and never acted on. The
 * pattern is puppeteer's own for its claims (`installation.key`). */
export class SessionRecordStore {
  private readonly logger: Logger;
  private key: Buffer | undefined;
  /** QL — the newest record CREATION per provider (and the run it names),
   * seeded from one `list()` at first ask and then kept by this store's own
   * `write`/`remove`, which every record passes through. Undefined = not
   * seeded, or a removal took a provider's newest (the next ask re-seeds). */
  private launched: Map<string, { at: number; runtimeRunId: string }> | undefined;

  constructor(
    private readonly opts: { dir: string; keyPath: string; now: () => Date; logger?: Logger },
  ) {
    this.logger = opts.logger ?? createNoopLogger();
  }

  path(runtimeRunId: string): string {
    return join(this.opts.dir, `${encodeURIComponent(runtimeRunId)}.json`);
  }

  /** The record, when it exists AND verifies; a record that does not verify
   * is set aside and reads as absent. */
  read(runtimeRunId: string): AgentSessionRecord | undefined {
    return this.readPath(this.path(runtimeRunId));
  }

  /** Every readable, VERIFIED record, newest first. */
  list(): AgentSessionRecord[] {
    let names: string[];
    try {
      names = readdirSync(this.opts.dir).filter((name) => name.endsWith(".json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: AgentSessionRecord[] = [];
    for (const name of names) {
      const record = this.readPath(join(this.opts.dir, name));
      if (record !== undefined) records.push(record);
    }
    return records.sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    );
  }

  /** Sign and publish: the directory made (and kept) owner-only, the bytes
   * written to a private temp file that cannot pre-exist (`wx`, a random
   * suffix — a temp name an adversary could plant first would inherit its
   * mode), renamed durably, the mode re-asserted on the result. */
  write(record: AgentSessionRecord): void {
    mkdirSync(this.opts.dir, { recursive: true, mode: 0o700 });
    ownerOnly(this.opts.dir, 0o700);
    const { signature: _previous, ...unsigned } = record;
    const signed: AgentSessionRecord = { ...unsigned, signature: this.sign(unsigned) };
    const path = this.path(record.runtimeRunId);
    const tmp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(signed, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    durableRenameSync(tmp, path);
    ownerOnly(path, 0o600);
    if (this.launched !== undefined) noteLaunch(this.launched, signed);
  }

  /** Stamp the exit onto an existing record; a missing record is left missing. */
  stampExit(runtimeRunId: string, exit: NonNullable<AgentSessionRecord["exited"]>): boolean {
    const record = this.read(runtimeRunId);
    if (record === undefined) return false;
    this.write({ ...record, exited: exit, updatedAt: this.opts.now().toISOString() });
    return true;
  }

  remove(runtimeRunId: string): void {
    rmSync(this.path(runtimeRunId), { force: true });
    if (this.launched === undefined) return;
    for (const held of this.launched.values()) {
      if (held.runtimeRunId === runtimeRunId) {
        // the newest went: the one before it is on disk, not in the map
        this.launched = undefined;
        return;
      }
    }
  }

  /** QL — when each provider was last launched on this device: the newest
   * `createdAt` (epoch ms) across the verified records, any `spawnedBy`. BY
   * CREATION, not by `list()`'s order (`updatedAt` moves at every exit stamp).
   * Read on every `agent.providers`, so it is NOT a directory scan: one
   * `list()` seeds it (a throw propagates and leaves it unseeded), and this
   * store's own writes and removals keep it. */
  newestCreatedByProvider(): ReadonlyMap<string, number> {
    if (this.launched === undefined) {
      const seeded = new Map<string, { at: number; runtimeRunId: string }>();
      for (const record of this.list()) noteLaunch(seeded, record);
      this.launched = seeded;
    }
    return new Map([...this.launched].map(([provider, held]) => [provider, held.at]));
  }

  /** Whether the record's signature verifies against this root's key — what
   * the daemon's own acts require of a record before they trust its terminal. */
  verifies(record: AgentSessionRecord): boolean {
    if (record.signature === undefined) return false;
    const { signature, ...unsigned } = record;
    const expected = Buffer.from(this.sign(unsigned), "hex");
    const given = Buffer.from(signature, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private sign(unsigned: Omit<AgentSessionRecord, "signature">): string {
    return createHmac("sha256", this.signingKey()).update(canonicalJson(unsigned)).digest("hex");
  }

  /** The root's signing key: read, or minted once (32 random bytes, base64,
   * 0600, created without overwrite so two writers cannot both mint). A key
   * that other users could read is worthless as evidence: set aside, re-minted,
   * and every record signed with it reads as untrusted from then on. */
  private signingKey(): Buffer {
    if (this.key !== undefined) return this.key;
    const path = this.opts.keyPath;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (exposed(path)) {
          const aside = `${path}.exposed-${Date.now()}`;
          this.logger.error(
            "fieldd.agents.session_key_exposed",
            "The session-record signing key was readable by other users; set aside and re-minted",
            undefined,
            { aside },
          );
          renameSync(path, aside);
          continue;
        }
        const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
        if (key.length === 32) {
          this.key = key;
          return key;
        }
        const aside = `${path}.unreadable-${Date.now()}`;
        this.logger.error(
          "fieldd.agents.session_key_unreadable",
          "The session-record signing key is malformed; set aside and re-minted",
          undefined,
          { aside },
        );
        renameSync(path, aside);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        writeFileSync(path, `${randomBytes(32).toString("base64")}\n`, {
          mode: 0o600,
          flag: "wx",
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // another writer minted it first: read theirs on the next pass
      }
    }
    throw new Error(`the session-record signing key at ${path} could not be read or minted`);
  }

  private readPath(path: string): AgentSessionRecord | undefined {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const record = AgentSessionRecordSchema.safeParse(parsed);
    if (!record.success) {
      this.setAside(path, "unreadable", "fieldd.agents.session_record_unreadable", {
        issue: record.error.issues[0]?.message ?? "invalid json",
      });
      return undefined;
    }
    if (exposed(path)) {
      this.setAside(path, "exposed", "fieldd.agents.session_record_exposed", {
        runtimeRunId: record.data.runtimeRunId,
      });
      return undefined;
    }
    if (record.data.signature === undefined) {
      this.setAside(path, "unsigned", "fieldd.agents.session_record_unsigned", {
        runtimeRunId: record.data.runtimeRunId,
      });
      return undefined;
    }
    if (!this.verifies(record.data)) {
      this.setAside(path, "forged", "fieldd.agents.session_record_forged", {
        runtimeRunId: record.data.runtimeRunId,
      });
      return undefined;
    }
    return record.data;
  }

  /** A record fieldd will not act on is moved out of the listing for a human
   * to look at; never deleted, never overwritten, never silently ignored. */
  private setAside(
    path: string,
    why: "unreadable" | "exposed" | "unsigned" | "forged",
    event: string,
    attrs: Record<string, unknown>,
  ): void {
    const aside = `${path}.${why}-${Date.now()}`;
    this.logger.error(
      event,
      `A managed-session record is ${why}; set aside, never acted on`,
      undefined,
      { aside, ...attrs },
    );
    try {
      renameSync(path, aside);
    } catch {
      // nothing else to do: the next write of this id replaces it
    }
  }
}

/** Stable bytes for the signature: object keys sorted at every level (records
 * are plain JSON; arrays keep their order). */
function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const inner = (value as Record<string, unknown>)[key];
      if (inner !== undefined) out[key] = sortKeys(inner);
    }
    return out;
  }
  return value;
}

/** Whether a path's mode lets group or others at it (never true on win32,
 * where the mode bits say nothing). */
function exposed(path: string): boolean {
  if (process.platform === "win32") return false;
  return (statSync(path).mode & 0o077) !== 0;
}

/** Re-assert an owner-only mode: a directory or file that pre-existed with a
 * looser mode keeps it through `mkdirSync`/`writeFileSync` (both leave an
 * existing mode alone), so the mode is set explicitly after the fact. */
/** Keep `record`'s creation if it is its provider's newest. */
function noteLaunch(
  newest: Map<string, { at: number; runtimeRunId: string }>,
  record: Pick<AgentSessionRecord, "provider" | "createdAt" | "runtimeRunId">,
): void {
  const at = Date.parse(record.createdAt);
  if (!Number.isFinite(at)) return;
  const held = newest.get(record.provider);
  if (held === undefined || at > held.at) {
    newest.set(record.provider, { at, runtimeRunId: record.runtimeRunId });
  }
}

function ownerOnly(path: string, mode: 0o700 | 0o600): void {
  if (process.platform === "win32") return;
  if ((statSync(path).mode & 0o777) !== mode) chmodSync(path, mode);
}

/** A fresh record for a run puppeteer just started (spawned or resumed). */
export function recordForRun(input: {
  info: AgentSessionInfo;
  cwd: string;
  title?: string | undefined;
  now: string;
  /** AR-4 — the durable identity the run was born with (puppeteer's creation
   * request, the claim under `agents/runs/`) and the loopback ingress the
   * adapter bound for it, when it has one (the bearer is a per-session
   * secret; the record is 0600) */
  creationRequestId?: string | undefined;
  ingress?: { port: number; token: string } | undefined;
  /** RA-D3 — the adapter's attach record (opaque; the same custody as the
   * ingress bearer), the latest it reported before the launch */
  attach?: AgentSessionAttach | undefined;
  /** AR-4 — the floor session this run replaced at a resume-when-idle */
  replaced?: string | undefined;
  /** AR-7 — a run ADOPTED in a terminal the person's own shell owns: the
   * process that became the agent and when it started, which a later boot
   * compares before it re-attaches. The record then says where the run came
   * from; a run a door started says nothing, which reads `app`. */
  adopted?: { pid: number; startedAt: string } | undefined;
  /** PJ-6 (Q4) — the model the launch started at (its three keys, as
   * puppeteer took them), so a Resume starts at it again */
  modelSelection?: AgentModelSelection | undefined;
  /** CP-D15 — who started the run (a spark's `agent_spawn`, a flow's step); absent reads `you` */
  origin?: AgentSessionOrigin | undefined;
  /** CP-1c — the spark the run is the own session of */
  spark?: SparkId | undefined;
}): AgentSessionRecord {
  const { info } = input;
  return {
    format: AGENT_SESSION_RECORD_FORMAT,
    runtimeRunId: info.runtimeRunId,
    runtimeEpoch: info.runtimeEpoch,
    provider: info.provider.id,
    ...(info.profileId !== undefined ? { profileId: info.profileId } : {}),
    ...(info.profileSetId !== undefined ? { profileSet: info.profileSetId } : {}),
    cwd: input.cwd,
    ...(input.title !== undefined ? { title: input.title } : {}),
    terminalSessionId: info.terminalSessionId,
    continuation: { ...info.continuation },
    workspace: workspaceOf(info),
    ...(input.creationRequestId !== undefined
      ? { creationRequestId: input.creationRequestId }
      : {}),
    ...(input.ingress !== undefined
      ? { ingress: { port: input.ingress.port, token: input.ingress.token } }
      : {}),
    ...(input.attach !== undefined ? { attach: input.attach } : {}),
    ...(input.replaced !== undefined ? { replaced: input.replaced } : {}),
    createdAt: input.now,
    updatedAt: input.now,
    ...(input.adopted !== undefined
      ? {
          spawnedBy: SPAWNED_BY_SHELL,
          process: { pid: input.adopted.pid, startedAt: input.adopted.startedAt },
        }
      : {}),
    ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
    ...(input.origin !== undefined ? { origin: input.origin } : {}),
    ...(input.spark !== undefined ? { spark: input.spark } : {}),
  };
}

function workspaceOf(info: AgentSessionInfo): AgentSessionSummary["workspace"] {
  const { workspace } = info;
  return {
    mode: workspace.mode,
    root: workspace.root,
    sourcePath: workspace.sourcePath,
    ...(workspace.branch !== undefined ? { branch: workspace.branch } : {}),
  };
}

/** The one derived status (AR-D4): puppeteer's headline, `unknown` when
 * there is no state yet or the headline is a word this contract does not
 * know (the mirror keeps `status` open; the fold folds). */
export function foldStatus(monitor: AgentMonitorMirror | undefined): AgentStatus {
  if (monitor === undefined) return "unknown";
  switch (monitor.status) {
    case "idle":
    case "working":
    case "blocked":
      return monitor.status;
    default:
      return "unknown";
  }
}

/** puppeteer's monitor state as the contract's mirror, or undefined (logged
 * once per run by the caller) when the pinned shape and the running one
 * disagree — the row still exists, with `status: unknown`. */
export function mirrorOf(state: AgentMonitorState | undefined): {
  mirror: AgentMonitorMirror | undefined;
  issue?: string | undefined;
} {
  if (state === undefined) return { mirror: undefined };
  const parsed = AgentMonitorMirror.safeParse(state);
  if (parsed.success) return { mirror: parsed.data };
  return {
    mirror: undefined,
    issue: parsed.error.issues[0]?.message ?? "monitor state did not parse",
  };
}

export interface SummarizeInput {
  info: AgentSessionInfo;
  monitor: AgentMonitorMirror | undefined;
  observationLevel: string;
  device: string;
  /** the floor's inventory row for the run's terminal, when observed */
  terminal: TerminalInfo | undefined;
  /** whether the terminal is (still) known to be hosted here */
  hosted: boolean;
  /** the row's continuation claim (AR-3's two facts; AR-4's `reattached`) */
  record: NonNullable<AgentSessionSummary["continuation"]>;
  /** AR-4 — the floor session this run replaced at a resume-when-idle */
  replaced?: string | undefined;
  createdAt: string;
  stateChangedAt: string;
  lastActivityAt?: string | undefined;
  title?: string | undefined;
  /** AR-7 — where the run came from, when it did not come from one of our
   * doors (`user-shell`); a spawned row says nothing, which reads `app` */
  spawnedBy?: string | undefined;
  /** Q08 — the key `agent.interrupt` presses for this run (`stopKeyOf`) */
  stopKey?: string | undefined;
  /** CP-D15 — who started the run, as its record says */
  origin?: AgentSessionOrigin | undefined;
  /** CP-1c — the spark this run is the own session of */
  spark?: SparkId | undefined;
  /** Item 124 — this process was born without its briefing (its executable takes no door) */
  door?: "off" | undefined;
}

/** Q08 — the floor's own interrupt, which is ⌃C (ghosttea encodes it `\x03`),
 * in puppeteer's word for that key. */
export const FLOOR_INTERRUPT_KEY: TerminalKey = "ctrl-c";

/** Q08 — the key the stop verb presses for a run, from the turn stop its
 * adapter names (puppeteer's `Agent.turnStop`): that key; none when the stop
 * is the agent's own control; and the floor's ⌃C while the adapter names no
 * stop, because that is what `agent.interrupt` then sends. Pure, and blind to
 * which agent it is (AR-L1): the adapter says, fieldd repeats it. */
export function stopKeyOf(stop: AgentTurnStop | undefined): string | undefined {
  if (stop === undefined) return FLOOR_INTERRUPT_KEY;
  return stop.kind === "key" ? stop.key : undefined;
}

/** SessionSummary v2 for a managed run — pure. */
export function summarizeManaged(input: SummarizeInput): AgentSessionSummary {
  const { info, monitor } = input;
  // puppeteer's own claim about the native id and how it was learned
  // (configured at launch → observed from the vendor's evidence); never
  // inferred here from a field's presence
  return {
    sessionId: info.nativeSession.id,
    sessionIdBasis: info.nativeSession.basis,
    kind: info.provider.id,
    label: info.provider.label,
    device: input.device,
    tier: "managed",
    runtimeRunId: info.runtimeRunId,
    runtimeEpoch: info.runtimeEpoch,
    ...(info.profileId !== undefined ? { profileId: info.profileId } : {}),
    ...(info.profileSetId !== undefined ? { profileSet: info.profileSetId } : {}),
    terminal: input.hosted
      ? {
          hosted: "local",
          runtimeSessionId: info.terminalSessionId,
          ...cellOf(input.terminal),
          ...(input.replaced !== undefined ? { replaced: input.replaced } : {}),
        }
      : { hosted: "none" },
    workspace: workspaceOf(info),
    ...(monitor !== undefined ? { monitor } : {}),
    status: foldStatus(monitor),
    observationLevel: input.observationLevel,
    createdAt: input.createdAt,
    stateChangedAt: input.stateChangedAt,
    ...(input.lastActivityAt !== undefined ? { lastActivityAt: input.lastActivityAt } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    continuation: input.record,
    ...(input.spawnedBy !== undefined ? { spawnedBy: input.spawnedBy } : {}),
    ...(input.stopKey !== undefined ? { stopKey: input.stopKey } : {}),
    ...(input.origin !== undefined ? { origin: input.origin } : {}),
    ...(input.spark !== undefined ? { spark: input.spark } : {}),
    ...(input.door !== undefined ? { door: input.door } : {}),
  };
}

/** The inventory row's cell tag, as the row carries it (absent on a legacy floor). */
function cellOf(
  terminal: TerminalInfo | undefined,
): Pick<NonNullable<AgentSessionSummary["terminal"]>, "cellBootId" | "workloadClass"> {
  if (terminal?.cell === undefined) return {};
  return {
    cellBootId: terminal.cell.cellBootId,
    ...(terminal.cell.workloadClass !== undefined
      ? { workloadClass: terminal.cell.workloadClass }
      : {}),
  };
}

/** MF-1f — a run whose PROCESS ended while its PTY is still on the floor, as
 * a LATER BOOT finds it: the record is stamped with an exit, and this device's
 * floor still lists the terminal it named. Nothing observed this run (a new
 * fieldd never held its adapter), so the status is `unknown` and the level is
 * `none` — what the row carries is the dead pane and the verb that ends it.
 * Pure. The same run seen exit by THIS fieldd keeps its mirror instead and
 * goes through `summarizeManaged` with `exited: true`. */
export function summarizeExitedRecord(input: SummarizeExitedInput): AgentSessionSummary {
  const { record } = input;
  return {
    sessionId: record.continuation.nativeSessionId,
    sessionIdBasis: "recorded",
    kind: record.provider,
    label: input.label,
    device: input.device,
    tier: "managed",
    runtimeRunId: record.runtimeRunId,
    runtimeEpoch: record.runtimeEpoch,
    ...(record.profileId !== undefined ? { profileId: record.profileId } : {}),
    ...(record.profileSet !== undefined ? { profileSet: record.profileSet } : {}),
    // the pane is the whole reason this row exists, so the join is exact
    terminal: {
      hosted: "local",
      runtimeSessionId: input.terminalSessionId,
      ...cellOf(input.terminal),
    },
    ...(record.workspace !== undefined ? { workspace: record.workspace } : {}),
    status: "unknown",
    observationLevel: "none",
    createdAt: record.createdAt,
    stateChangedAt: record.exited?.at ?? input.since,
    ...(record.title !== undefined ? { title: record.title } : {}),
    continuation: { persisted: true, resumable: input.resumable ?? true, exited: true },
    ...(record.origin !== undefined ? { origin: record.origin } : {}),
    ...(record.spark !== undefined ? { spark: record.spark } : {}),
  };
}

export interface SummarizeExitedInput {
  record: AgentSessionRecord;
  /** the adapter's own label for the provider (the record keeps only the id) */
  label: string;
  device: string;
  /** the floor session the record named, still listed by this device's floor */
  terminalSessionId: string;
  /** the floor's inventory row for it, when observed */
  terminal: TerminalInfo | undefined;
  /** when this boot found it */
  since: string;
  /** AR-D25 — false when the account it ran under is signed out (default true) */
  resumable?: boolean;
}

export interface SummarizePendingInput {
  record: AgentSessionRecord;
  /** the adapter's own label for the provider (the record keeps only the id) */
  label: string;
  device: string;
  /** the floor's inventory row for the run's terminal, when observed */
  terminal: TerminalInfo | undefined;
  /** why this boot could not re-attach (the adapter's or the runtime's words) */
  reason: string;
  /** when this boot found it */
  since: string;
  /** AR-D25 — false when the account it runs under is signed out: it keeps
   * running until it ends, and nothing continues it (default true) */
  resumable?: boolean;
}

/** SessionSummary v2 for a run whose PTY outlived a fieldd that could NOT
 * re-attach to it (AR-4): a live terminal nothing observes — `status`
 * unknown, `observationLevel` none, the continuation resumable and PENDING a
 * resume at the session's next idle (or by hand through `agent.resume`).
 * The native id is the record's, so `sessionIdBasis` says so. Pure.
 *
 * AR-7c — a TYPED run held this way is pending NOTHING: its pane is the
 * person's shell, so it is never replaced, at idle or by hand. The row says it
 * is unobserved and why, offers no resume, and says where the run came from. */
export function summarizePending(input: SummarizePendingInput): AgentSessionSummary {
  const { record } = input;
  const typed = isTypedRun(record);
  return {
    sessionId: record.continuation.nativeSessionId,
    sessionIdBasis: "recorded",
    kind: record.provider,
    label: input.label,
    device: input.device,
    tier: "managed",
    runtimeRunId: record.runtimeRunId,
    runtimeEpoch: record.runtimeEpoch,
    ...(record.profileId !== undefined ? { profileId: record.profileId } : {}),
    ...(record.profileSet !== undefined ? { profileSet: record.profileSet } : {}),
    terminal:
      record.terminalSessionId !== undefined
        ? {
            hosted: "local",
            runtimeSessionId: record.terminalSessionId,
            ...cellOf(input.terminal),
          }
        : { hosted: "none" },
    ...(record.workspace !== undefined ? { workspace: record.workspace } : {}),
    status: "unknown",
    observationLevel: "none",
    createdAt: record.createdAt,
    stateChangedAt: input.since,
    ...(record.title !== undefined ? { title: record.title } : {}),
    continuation: typed
      ? { persisted: true, resumable: false, reason: input.reason }
      : {
          persisted: true,
          resumable: input.resumable ?? true,
          pending: "resume-when-idle",
          reason: input.reason,
        },
    ...(record.spawnedBy !== undefined ? { spawnedBy: record.spawnedBy } : {}),
    ...(record.origin !== undefined ? { origin: record.origin } : {}),
    ...(record.spark !== undefined ? { spark: record.spark } : {}),
  };
}
