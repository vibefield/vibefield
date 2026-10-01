import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  AGENT_CATALOG,
  type AgentCatalogEntry,
  type AgentCatalogReaders,
  AgentKind,
  createAgentCatalogReaders,
  INDEX_MESH,
  type IndexCatalogProject,
  type IndexCatalogSession,
  type IndexCatalogTable,
  IndexProjectRow,
  IndexSessionRow,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import WebSocket from "ws";
import { CatalogTable, createRowsPump, type RowsPump, type RowsPumpOptions } from "./catalog-rows";
import { familyOf } from "./project-family";
import type { RosettadState, RosettadSupervisor } from "./rosettad-supervisor";

// DS-6 — the history catalog's SOURCE on this desktop (design-06 §5
// "History"; `thinking-desktop-sync-plane.md` §6.4, DS-D8 RULED): fieldd follows
// its own rosetta's topology stream and republishes two FACT tables as rows —
// `projects` and `sessions` — for every other self desktop to replicate
// (`index.catalog.subscribe`) and for the mesh doors to page.
//
// What `/ws/meta` is at the pin (rosetta d3cf325, `crates/server/src/ws.rs`
// `run_meta_stream` + `hub.rs` `publish_meta` + `store/src/hot.rs`):
//   1. `{"frame":"hello","protocol_version":N,"stamp":null}`;
//   2. ONE `{"frame":"meta_snapshot","runtimes":[…],"projects":[…],"sessions":[…]}`
//      — the WHOLE resident mirror, uncapped, delegated children included;
//   3. unstamped `{"frame":"mutation","stamp":null,"mutation":{"type":…}}`
//      frames, each a FULL row of type `session` | `project` | `runtime` (only
//      mirror diffs reach meta subscribers; message/tool/usage mutations are
//      session-stream traffic and never arrive here);
//   4. `{"frame":"resync"}` when this subscriber fell 1,024 items behind,
//      followed by a fresh `meta_snapshot`.
// It has NO resume and NO removal event: a row the mirror drops "leaves
// silently" (`hot.rs` refresh_meta). So this follower owns the journal
// (CatalogTable assigns the revisions) and finds removals the only way the
// stream allows — by diffing a FRESH snapshot (`replaceAll`) — and it takes a
// fresh one by reconnecting every `INDEX_MESH.META_RESNAPSHOT_MS`: a session
// rosetta drops without a word leaves the catalog within that cadence and
// never sooner. The REST lists are not the source: `/api/sessions` caps at
// 1,000 roots with no cursor, and a diff over a capped list would read the
// 1,001st root falling off the window as a removal.
//
// Top-level sessions only (`parent_session_id` absent — the navigation fact
// `/api/sessions` browses by): a delegated child is transcript structure. The
// runtime rows are read only to name each session's agent (rosetta's `kind`,
// the seam column the duplicate rule joins on, DS-D10, and the catalog id it
// maps to). The project rows gain the repository FAMILY (DS-D9) and two
// figures derived from this desktop's own sessions.
//
// The tables are KEPT across a lost stream and a stopped daemon — a catalog is
// a fact that stays until a fresh snapshot says otherwise (DS-L8) — and they
// speak for the index only once this boot's first snapshot has landed
// (`ready`); until then the door answers UNAVAILABLE rather than an empty
// table a peer would replace its copy with.
//
// EL7: the loopback origin is read from the supervisor's STATE here and never
// logged or handed on; a log line names the route, never the origin, and no
// row's content ever reaches a log.

export type IndexCatalogPhase =
  /** no rosettad is configured on this desktop */
  | "unconfigured"
  /** the daemon is not ready (starting, restarting, failed, stopped) */
  | "waiting"
  /** dialing the stream, or waiting for its first snapshot */
  | "connecting"
  /** following: the tables are the index's, as of the last frame */
  | "live"
  /** the tables hold the last snapshot and the stream is down: re-dialing */
  | "stale"
  /** the daemon speaks another protocol: not followed until it restarts */
  | "incompatible";

export interface IndexCatalogOptions {
  /** null = no rosettad configured (the tables stay empty and never ready) */
  supervisor: RosettadSupervisor | null;
  /** the rosetta wire version fieldd speaks (`@rosetta/protocol` PROTOCOL_VERSION) */
  expectedProtocolVersion: number;
  /** this desktop's id, read at every stamp: it moves at most once, from the
   * persisted local fallback to the mesh identity (D30) */
  deviceId: () => string;
  /** AC-3 test seam: the catalog (default: THE table) — kind → catalog id */
  catalog?: readonly AgentCatalogEntry[];
  /** the tables' epoch (default: a fresh id per boot — a reader's cursor from
   * an earlier boot resets, because the journal did not survive it) */
  epoch?: string;
  /** test seams for the cadences (defaults: INDEX_MESH) */
  resnapshotMs?: number;
  batchMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  journalDepth?: number;
  pageBytes?: number;
  webSocket?: typeof WebSocket;
  now?: () => number;
  logger?: Logger;
}

/** rosetta's `ProjectRow` as the follower reads it (git_repo read loosely:
 * it is display metadata, and a shape we cannot vouch for is no family). */
interface RawProject {
  id: string;
  name: string;
  root_paths: string[];
  git_repo: string | null;
}

/** A row's one stamp the listing sorts by: the owner's conversation activity
 * (`activity.lastAt`), absent last — rosetta's own `compare_recent`. */
export function sessionActivityAt(row: IndexCatalogSession): number | undefined {
  return row.activity?.lastAt;
}

export class IndexCatalog extends EventEmitter {
  readonly epoch: string;
  readonly projects: CatalogTable<IndexCatalogProject>;
  readonly sessions: CatalogTable<IndexCatalogSession>;
  readonly #opts: IndexCatalogOptions;
  readonly #logger: Logger;
  readonly #catalog: AgentCatalogReaders;
  readonly #now: () => number;
  readonly #WebSocket: typeof WebSocket;
  readonly #resnapshotMs: number;
  readonly #batchMs: number;
  readonly #reconnectMinMs: number;
  readonly #reconnectMaxMs: number;

  #phase: IndexCatalogPhase = "waiting";
  #ready = false;
  #heardAt: number | null = null;
  #disposed = false;
  #started = false;
  /** the device the rows were last stamped with */
  #stamped: string | null = null;

  #ws: WebSocket | null = null;
  #origin: string | null = null;
  /** bumped per dial: a superseded socket's events are ignored */
  #generation = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #reconnectDelay: number;
  #resnapshotTimer: ReturnType<typeof setTimeout> | null = null;

  /** runtime id → rosetta kind */
  #runtimeKinds = new Map<string, string>();
  /** project id → rosetta's row */
  #rawProjects = new Map<string, RawProject>();
  /** the join maps a session change needs to refresh its project's figures */
  #sessionProject = new Map<string, string>();
  #projectSessions = new Map<string, Set<string>>();
  #sessionRuntime = new Map<string, string>();

  /** mutations folded into one frame per table per batch window */
  #pendingSessions = new Map<string, IndexSessionRow | null>();
  #pendingProjects = new Map<string, RawProject>();
  #pendingRuntimes = new Map<string, string>();
  #batchTimer: ReturnType<typeof setTimeout> | null = null;
  /** `<shape>` said once: a row this build cannot read */
  readonly #saidUnreadable = new Set<string>();

  constructor(opts: IndexCatalogOptions) {
    super();
    this.#opts = opts;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "index_catalog" });
    this.#catalog = createAgentCatalogReaders(opts.catalog ?? AGENT_CATALOG);
    this.#now = opts.now ?? Date.now;
    this.#WebSocket = opts.webSocket ?? WebSocket;
    this.#resnapshotMs = opts.resnapshotMs ?? INDEX_MESH.META_RESNAPSHOT_MS;
    this.#batchMs = opts.batchMs ?? INDEX_MESH.META_BATCH_MS;
    this.#reconnectMinMs = opts.reconnectMinMs ?? INDEX_MESH.META_RECONNECT_MIN_MS;
    this.#reconnectMaxMs = opts.reconnectMaxMs ?? INDEX_MESH.META_RECONNECT_MAX_MS;
    this.#reconnectDelay = this.#reconnectMinMs;
    this.epoch = opts.epoch ?? `catalog-${randomUUID()}`;
    const tableOpts = {
      epoch: this.epoch,
      ...(opts.journalDepth !== undefined ? { journalDepth: opts.journalDepth } : {}),
      ...(opts.pageBytes !== undefined ? { pageBytes: opts.pageBytes } : {}),
    };
    this.projects = new CatalogTable<IndexCatalogProject>({
      ...tableOpts,
      keyOf: (row) => row.projectId,
    });
    this.sessions = new CatalogTable<IndexCatalogSession>({
      ...tableOpts,
      keyOf: (row) => row.sessionId,
    });
  }

  /** The table a subscribe names. */
  table(
    name: IndexCatalogTable,
  ): CatalogTable<IndexCatalogProject> | CatalogTable<IndexCatalogSession> {
    return name === "projects" ? this.projects : this.sessions;
  }

  /** One subscriber of a table — the catalog door's body (the rows protocol's
   * open, then its frames; catalog-rows.ts). */
  pump(name: IndexCatalogTable, opts: Omit<RowsPumpOptions<unknown>, "table">): RowsPump {
    return name === "projects"
      ? createRowsPump({ ...opts, table: this.projects })
      : createRowsPump({ ...opts, table: this.sessions });
  }

  /** This boot's first snapshot has landed: the tables speak for the index. */
  get ready(): boolean {
    return this.#ready;
  }

  get phase(): IndexCatalogPhase {
    return this.#phase;
  }

  /** epoch ms of the last frame the stream delivered (null: never, this boot) */
  get heardAt(): number | null {
    return this.#heardAt;
  }

  /** The device the rows carry (the current id once anything was stamped). */
  device(): string {
    return this.#opts.deviceId();
  }

  start(): void {
    if (this.#started || this.#disposed) return;
    this.#started = true;
    const supervisor = this.#opts.supervisor;
    if (supervisor === null) {
      this.#setPhase("unconfigured");
      return;
    }
    // a unit seam may stub the supervisor with `health()` alone
    if (typeof supervisor.on === "function") supervisor.on("transition", this.#onTransition);
    const state = typeof supervisor.state === "function" ? supervisor.state() : null;
    if (state !== null) this.#onTransition(state);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const supervisor = this.#opts.supervisor;
    if (supervisor !== null && typeof supervisor.off === "function") {
      supervisor.off("transition", this.#onTransition);
    }
    this.#clearTimers();
    this.#closeSocket();
    this.removeAllListeners();
  }

  /** Take a fresh snapshot now (the cadence's own act, or a caller that has
   * reason to doubt the tables): the stream is re-dialed and its snapshot
   * diffed in, which is where silent removals surface. */
  resnapshot(): void {
    if (this.#disposed || this.#origin === null) return;
    this.#dial(this.#origin, { deliberate: true });
  }

  // ── the stream ──

  readonly #onTransition = (state: RosettadState): void => {
    if (this.#disposed) return;
    if (state.phase === "ready" && state.origin !== null) {
      if (this.#origin !== state.origin || this.#ws === null) {
        this.#reconnectDelay = this.#reconnectMinMs;
        this.#dial(state.origin);
      }
      return;
    }
    // the daemon is not serving: stop dialing, KEEP the tables
    this.#origin = null;
    this.#clearTimers();
    this.#closeSocket();
    this.#setPhase(state.phase === "unconfigured" ? "unconfigured" : "waiting");
  };

  /** Dial the stream. A `deliberate` re-dial (the re-snapshot cadence) keeps
   * the phase: the tables are as live as they were a moment ago. */
  #dial(origin: string, how: { deliberate?: boolean } = {}): void {
    this.#closeSocket();
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#origin = origin;
    const generation = ++this.#generation;
    if (how.deliberate !== true) this.#setPhase(this.#ready ? "stale" : "connecting");
    let ws: WebSocket;
    try {
      // a native client sends no Origin, which rosetta's WS guard admits
      // (`require_local_origin`: only a browser's foreign Origin is refused)
      ws = new this.#WebSocket(`${origin.replace(/^http/, "ws")}/ws/meta`, {
        perMessageDeflate: false,
        handshakeTimeout: 5_000,
      });
    } catch (error) {
      this.#logger.warn("fieldd.index_catalog.dial_failed", "The meta stream could not be dialed", {
        route: "/ws/meta",
        error: error instanceof Error ? error.message : String(error),
      });
      this.#scheduleReconnect(generation);
      return;
    }
    this.#ws = ws;
    ws.on("message", (data: WebSocket.RawData) => {
      if (generation === this.#generation) this.#onFrame(data);
    });
    ws.on("close", () => {
      if (generation !== this.#generation) return;
      this.#ws = null;
      this.#flush();
      if (this.#phase !== "incompatible") this.#setPhase(this.#ready ? "stale" : "connecting");
      this.#scheduleReconnect(generation);
    });
    ws.on("error", (error: Error) => {
      if (generation !== this.#generation) return;
      this.#logger.debug("fieldd.index_catalog.stream_error", "The meta stream failed", {
        route: "/ws/meta",
        error: error.message,
      });
    });
  }

  #scheduleReconnect(generation: number): void {
    if (this.#disposed || this.#origin === null || this.#phase === "incompatible") return;
    if (this.#reconnectTimer !== null) return;
    const delay = this.#reconnectDelay;
    this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, this.#reconnectMaxMs);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (generation !== this.#generation || this.#origin === null) return;
      this.#dial(this.#origin);
    }, delay);
    this.#reconnectTimer.unref?.();
  }

  #closeSocket(): void {
    const ws = this.#ws;
    this.#ws = null;
    this.#generation += 1; // its late events are no longer ours
    if (ws === null) return;
    ws.removeAllListeners("message");
    ws.on("error", () => {}); // a close racing the handshake must not throw
    try {
      ws.close();
    } catch {
      ws.terminate();
    }
  }

  #clearTimers(): void {
    for (const timer of [this.#reconnectTimer, this.#resnapshotTimer, this.#batchTimer]) {
      if (timer !== null) clearTimeout(timer);
    }
    this.#reconnectTimer = null;
    this.#resnapshotTimer = null;
    this.#batchTimer = null;
  }

  #setPhase(phase: IndexCatalogPhase): void {
    if (this.#phase === phase) return;
    this.#phase = phase;
    this.emit("phase", phase);
  }

  #onFrame(data: WebSocket.RawData): void {
    let frame: unknown;
    try {
      const text = Buffer.isBuffer(data)
        ? data.toString("utf8")
        : Array.isArray(data)
          ? Buffer.concat(data).toString("utf8")
          : Buffer.from(data).toString("utf8");
      frame = JSON.parse(text);
    } catch {
      this.#sayUnreadable("frame");
      return;
    }
    if (typeof frame !== "object" || frame === null) return;
    const record = frame as Record<string, unknown>;
    this.#heardAt = this.#now();
    switch (record["frame"]) {
      case "hello": {
        const version = record["protocol_version"];
        if (version !== this.#opts.expectedProtocolVersion) {
          this.#logger.warn(
            "fieldd.index_catalog.incompatible",
            "The index daemon's meta stream speaks another protocol; the catalog is not followed",
            { route: "/ws/meta", protocol: typeof version === "number" ? version : null },
          );
          this.#setPhase("incompatible");
          this.#closeSocket();
        }
        return;
      }
      case "meta_snapshot":
        this.#applySnapshot(record);
        return;
      case "mutation":
        this.#queueMutation(record["mutation"]);
        return;
      case "resync":
        // a barrier: the fresh snapshot that follows supersedes what is queued
        this.#dropPending();
        return;
      case "error":
        this.#logger.warn("fieldd.index_catalog.stream_refused", "The meta stream said error", {
          route: "/ws/meta",
        });
        return;
      default:
        // tolerant reader: a frame this build does not know is not a failure
        return;
    }
  }

  // ── folding the stream into the tables ──

  #applySnapshot(record: Record<string, unknown>): void {
    this.#dropPending();
    const device = this.#opts.deviceId();
    this.#runtimeKinds = new Map();
    for (const raw of asArray(record["runtimes"])) {
      const runtime = readRuntime(raw);
      if (runtime !== undefined) this.#runtimeKinds.set(runtime.id, runtime.kind);
      else this.#sayUnreadable("runtime");
    }
    this.#sessionProject = new Map();
    this.#projectSessions = new Map();
    this.#sessionRuntime = new Map();
    const sessions: IndexCatalogSession[] = [];
    for (const raw of asArray(record["sessions"])) {
      const parsed = IndexSessionRow.safeParse(raw);
      if (!parsed.success) {
        this.#sayUnreadable("session");
        continue;
      }
      if (isChild(parsed.data)) continue;
      const row = this.#sessionRow(parsed.data, device);
      this.#index(row.sessionId, row.projectId, parsed.data.runtime_id ?? undefined);
      sessions.push(row);
    }
    this.#rawProjects = new Map();
    for (const raw of asArray(record["projects"])) {
      const project = readProject(raw);
      if (project !== undefined) this.#rawProjects.set(project.id, project);
      else this.#sayUnreadable("project");
    }
    const movedSessions = this.sessions.replaceAll(sessions) !== null;
    const projects = [...this.#rawProjects.values()].map((raw) => this.#projectRow(raw, device));
    const movedProjects = this.projects.replaceAll(projects) !== null;
    this.#stamped = device;
    const first = !this.#ready;
    this.#ready = true;
    this.#reconnectDelay = this.#reconnectMinMs;
    this.#setPhase("live");
    this.#armResnapshot();
    if (first)
      this.#logger.info(
        "fieldd.index_catalog.ready",
        "The history catalog is following the index",
        {
          sessions: this.sessions.size,
          projects: this.projects.size,
        },
      );
    this.#changed(movedProjects, movedSessions, first);
  }

  #armResnapshot(): void {
    if (this.#resnapshotTimer !== null) clearTimeout(this.#resnapshotTimer);
    if (this.#resnapshotMs <= 0) return;
    this.#resnapshotTimer = setTimeout(() => {
      this.#resnapshotTimer = null;
      this.resnapshot();
    }, this.#resnapshotMs);
    this.#resnapshotTimer.unref?.();
  }

  #queueMutation(raw: unknown): void {
    if (typeof raw !== "object" || raw === null) return;
    const type = (raw as { type?: unknown }).type;
    if (type === "session") {
      const parsed = IndexSessionRow.safeParse(raw);
      if (!parsed.success) {
        this.#sayUnreadable("session");
        return;
      }
      this.#pendingSessions.set(parsed.data.id, parsed.data);
    } else if (type === "project") {
      const project = readProject(raw);
      if (project === undefined) {
        this.#sayUnreadable("project");
        return;
      }
      this.#pendingProjects.set(project.id, project);
    } else if (type === "runtime") {
      const runtime = readRuntime(raw);
      if (runtime === undefined) {
        this.#sayUnreadable("runtime");
        return;
      }
      this.#pendingRuntimes.set(runtime.id, runtime.kind);
    } else {
      return; // session-stream traffic, or a type this build does not know
    }
    if (this.#batchTimer === null) {
      this.#batchTimer = setTimeout(() => this.#flush(), this.#batchMs);
      this.#batchTimer.unref?.();
    }
  }

  #dropPending(): void {
    if (this.#batchTimer !== null) clearTimeout(this.#batchTimer);
    this.#batchTimer = null;
    this.#pendingSessions.clear();
    this.#pendingProjects.clear();
    this.#pendingRuntimes.clear();
  }

  /** Fold the queued mutations into ONE frame per table. */
  #flush(): void {
    if (this.#batchTimer !== null) clearTimeout(this.#batchTimer);
    this.#batchTimer = null;
    if (!this.#ready) {
      // nothing to fold into until a snapshot lands; the snapshot supersedes
      this.#dropPending();
      return;
    }
    const device = this.#opts.deviceId();
    if (device !== this.#stamped) this.#restamp(device);
    const sessionUpserts = new Map<string, IndexCatalogSession>();
    const sessionRemoved: string[] = [];
    const touchedProjects = new Set<string>();

    for (const [id, kind] of this.#pendingRuntimes) {
      if (this.#runtimeKinds.get(id) === kind) continue;
      this.#runtimeKinds.set(id, kind);
      for (const [sessionId, runtimeId] of this.#sessionRuntime) {
        const current = this.sessions.get(sessionId);
        if (runtimeId !== id || current === undefined) continue;
        sessionUpserts.set(sessionId, this.#withAgent(current, kind));
      }
    }
    for (const [id, raw] of this.#pendingSessions) {
      const before = this.#sessionProject.get(id);
      if (raw === null || isChild(raw)) {
        if (this.sessions.has(id) || sessionUpserts.has(id)) sessionRemoved.push(id);
        sessionUpserts.delete(id);
        this.#unindex(id);
        if (before !== undefined) touchedProjects.add(before);
        continue;
      }
      const row = this.#sessionRow(raw, device);
      this.#unindex(id);
      this.#index(id, row.projectId, raw.runtime_id ?? undefined);
      if (before !== undefined) touchedProjects.add(before);
      if (row.projectId !== undefined) touchedProjects.add(row.projectId);
      sessionUpserts.set(id, row);
    }
    const movedSessions =
      this.sessions.apply({ upserts: [...sessionUpserts.values()], removed: sessionRemoved }) !==
      null;
    for (const [id, raw] of this.#pendingProjects) {
      this.#rawProjects.set(id, raw);
      touchedProjects.add(id);
    }
    const projectUpserts: IndexCatalogProject[] = [];
    for (const id of touchedProjects) {
      const raw = this.#rawProjects.get(id);
      if (raw !== undefined) projectUpserts.push(this.#projectRow(raw, device));
    }
    const movedProjects = this.projects.apply({ upserts: projectUpserts }) !== null;
    this.#pendingSessions.clear();
    this.#pendingProjects.clear();
    this.#pendingRuntimes.clear();
    this.#changed(movedProjects, movedSessions, false);
  }

  /** The device id moved (the local fallback became the mesh identity): every
   * row is re-stamped, as one frame per table. */
  #restamp(device: string): void {
    this.sessions.replaceAll(this.sessions.rows().map((row) => ({ ...row, device })));
    this.projects.replaceAll(this.projects.rows().map((row) => ({ ...row, device })));
    this.#stamped = device;
  }

  #changed(projects: boolean, sessions: boolean, force: boolean): void {
    const tables: IndexCatalogTable[] = [];
    if (projects) tables.push("projects");
    if (sessions) tables.push("sessions");
    if (tables.length > 0 || force) this.emit("changed", { tables });
  }

  #index(sessionId: string, projectId: string | undefined, runtimeId: string | undefined): void {
    if (projectId !== undefined) {
      this.#sessionProject.set(sessionId, projectId);
      let members = this.#projectSessions.get(projectId);
      if (members === undefined) {
        members = new Set();
        this.#projectSessions.set(projectId, members);
      }
      members.add(sessionId);
    }
    if (runtimeId !== undefined) this.#sessionRuntime.set(sessionId, runtimeId);
  }

  #unindex(sessionId: string): void {
    const projectId = this.#sessionProject.get(sessionId);
    if (projectId !== undefined) {
      this.#projectSessions.get(projectId)?.delete(sessionId);
      this.#sessionProject.delete(sessionId);
    }
    this.#sessionRuntime.delete(sessionId);
  }

  #sessionRow(row: IndexSessionRow, device: string): IndexCatalogSession {
    const bounds = row.activity;
    const activity =
      bounds !== null && bounds.first_at <= bounds.last_at
        ? { firstAt: bounds.first_at, lastAt: bounds.last_at }
        : null;
    const kind =
      row.runtime_id === null || row.runtime_id === undefined
        ? undefined
        : this.#runtimeKinds.get(row.runtime_id);
    const base: IndexCatalogSession = {
      device,
      sessionId: row.id,
      nativeSessionId: row.native_session_id,
      ...(row.project_id ? { projectId: row.project_id } : {}),
      ...(row.title ? { title: row.title } : {}),
      ...(row.summary ? { summary: row.summary } : {}),
      ...(row.cwd ? { cwd: row.cwd } : {}),
      ...(typeof row.started_at === "number" ? { startedAt: row.started_at } : {}),
      ...(typeof row.updated_at === "number" ? { updatedAt: row.updated_at } : {}),
      activity,
      streamState: row.stream_state,
    };
    return kind === undefined ? base : this.#withAgent(base, kind);
  }

  /** The row naming its agent: rosetta's kind (when it is a kind the contract
   * can carry) and the catalog id it maps to (when a row maps it). */
  #withAgent(row: IndexCatalogSession, kind: string): IndexCatalogSession {
    const { kind: _kind, provider: _provider, ...rest } = row;
    const wireKind = AgentKind.safeParse(kind).success ? kind : undefined;
    const provider = wireKind === undefined ? undefined : this.#catalog.idForKind(wireKind);
    return {
      ...rest,
      ...(wireKind !== undefined ? { kind: wireKind } : {}),
      ...(provider !== undefined ? { provider } : {}),
    };
  }

  #projectRow(raw: RawProject, device: string): IndexCatalogProject {
    const members = this.#projectSessions.get(raw.id);
    let last: number | undefined;
    for (const sessionId of members ?? []) {
      const session = this.sessions.get(sessionId);
      const at = session === undefined ? undefined : sessionActivityAt(session);
      if (at !== undefined && (last === undefined || at > last)) last = at;
    }
    const family = familyOf(raw.git_repo);
    return {
      device,
      projectId: raw.id,
      name: raw.name,
      rootPaths: [...raw.root_paths],
      ...(raw.git_repo !== null && raw.git_repo !== "" ? { gitRepo: raw.git_repo } : {}),
      ...(family !== undefined ? { family } : {}),
      sessionCount: members?.size ?? 0,
      ...(last !== undefined ? { lastActivityAt: last } : {}),
    };
  }

  #sayUnreadable(shape: string): void {
    if (this.#saidUnreadable.has(shape)) return;
    this.#saidUnreadable.add(shape);
    this.#logger.warn(
      "fieldd.index_catalog.unreadable",
      "The meta stream sent a row this build cannot read; it is skipped",
      { shape },
    );
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Parent absence is the navigation fact rosetta's own list browses by. */
function isChild(row: IndexSessionRow): boolean {
  return typeof row.parent_session_id === "string" && row.parent_session_id !== "";
}

function readRuntime(raw: unknown): { id: string; kind: string } | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { id, kind } = raw as { id?: unknown; kind?: unknown };
  return typeof id === "string" && id !== "" && typeof kind === "string" && kind !== ""
    ? { id, kind }
    : undefined;
}

function readProject(raw: unknown): RawProject | undefined {
  const parsed = IndexProjectRow.safeParse(raw);
  if (!parsed.success) return undefined;
  const gitRepo = (raw as { git_repo?: unknown }).git_repo;
  return {
    id: parsed.data.id,
    name: parsed.data.name,
    root_paths: parsed.data.root_paths,
    git_repo: typeof gitRepo === "string" ? gitRepo : null,
  };
}
