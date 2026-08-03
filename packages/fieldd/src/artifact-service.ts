import { createHash, randomBytes } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { connect as connectTcp } from "node:net";
import { dirname, join, resolve } from "node:path";
import { connect as connectTls } from "node:tls";
import {
  ARTIFACT_INTENT_FILE,
  ARTIFACT_LIMITS,
  ARTIFACT_SERVE_PREFIX,
  ARTIFACT_TECHNICAL_NAME_PREFIX,
  type ArtifactPublishParams,
  ArtifactPublishV2Params,
  type ArtifactSource,
  ArtifactStatus,
  type ArtifactUnpublishParams,
  type ArtifactUpdateParams,
  LegacyArtifactPublishParams,
  LocalArtifactIntent,
  STORES,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { ObservedServe, ServeSpec, ServeState } from "./mesh-client";
import { RpcCallError } from "./native-link";

// ArtifactService (AH-1; artifact-hub §4/§5) owns source-local, durable serving
// intent. The Truffle listener is derived state: an intent fingerprints the
// complete effective config into serveId, so list-by-id is an equality proof
// even though Truffle deliberately does not echo routes/TLS/allow on list.
//
// This service never handles page bytes. It asks the mesh facade to create one
// HTTPS listener and performs only bounded control probes against the source.

export interface ArtifactServeBridge {
  /** Replace artifact serves; the daemon composes the product serve around it. */
  declare(specs: ServeSpec[]): Promise<void>;
  /** Remove one exact engine identity. NOT_FOUND is converged success. */
  remove(serveId: string): Promise<{ removed: boolean }>;
  /** Fused desired/runtime states, including the separately composed product serve. */
  states(): ServeState[];
  /** Raw native inventory used only to avoid listener-port collisions. */
  observed(): Promise<ObservedServe[]>;
  on(cb: () => void): () => void;
}

export interface ArtifactServiceOptions {
  dataDir: string;
  bridge: ArtifactServeBridge;
  logger?: Logger;
  now?: () => number;
  random?: () => number;
  /** Test seam; production uses the bounded TCP/TLS/stat probe below. */
  probe?: (source: ArtifactSource) => Promise<boolean>;
  /** false disables the 10s maintenance backstop (unit tests). */
  maintenanceMs?: number | false;
  /** Fault seam for atomic intent persistence. */
  writeIntent?: (path: string, body: string) => void;
}

interface IntentFileShape {
  v: 2;
  artifacts: unknown[];
}

interface LegacyRegistryShape {
  v?: unknown;
  artifacts?: unknown;
}

interface LegacyEntry {
  name: string;
  target: { kind: "port"; port: number } | { kind: "dir"; path: string };
  allow?: string[];
  publishedAt: number;
}

type ProbeState = "pending" | "ready" | "unavailable";

export interface ArtifactServiceHealth {
  count: number;
  storage: "ready" | "failed";
  sources: { ready: number; unavailable: number; pending: number };
  retiring: number;
}

export interface CanonicalServingConfigV1 {
  v: 1;
  listenPort: number;
  tls: true;
  allow: string[];
  routes: Array<Record<string, unknown>>;
}

const PORT_DOMAIN = "artifact-port-v1\0";
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const PROBE_TIMEOUT_MS = 1_000;
const PROBE_CONCURRENCY = 4;
const DEFAULT_MAINTENANCE_MS = 10_000;
const MAX_RETIRING_IDS = 16;

/** AH-D4's frozen first candidate. Linear probing is performed by the service. */
export function artifactPortCandidate(artifactId: string): number {
  const digest = createHash("sha256").update(PORT_DOMAIN).update(artifactId).digest();
  const width = ARTIFACT_LIMITS.LISTEN_PORT_MAX - ARTIFACT_LIMITS.LISTEN_PORT_MIN + 1;
  return ARTIFACT_LIMITS.LISTEN_PORT_MIN + (digest.readUInt32BE(0) % width);
}

/** Recursively key-sorted JSON, with arrays deliberately retaining route order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

/** The complete serving config whose digest is carried in the engine id. */
export function canonicalArtifactServingConfig(
  intent: LocalArtifactIntent,
  previewDir: string,
): CanonicalServingConfigV1 {
  const previewRoute = {
    allow: [],
    dir: previewDir,
    prefix: "/.vibefield/preview",
    stripPrefix: false,
  };
  const sourceRoute =
    intent.source.kind === "proxy"
      ? {
          allow: [],
          prefix: "/",
          stripPrefix: false,
          targetUrl: `${intent.source.scheme}://127.0.0.1:${intent.source.port}`,
        }
      : {
          allow: [],
          dir: intent.source.path,
          ...(intent.source.spaFallback !== undefined
            ? { fallback: intent.source.spaFallback }
            : {}),
          prefix: "/",
          stripPrefix: false,
        };
  return {
    v: 1,
    listenPort: intent.listenPort,
    tls: true,
    allow: canonicalAllow(intent.allow),
    // Exact longest-prefix order is part of the digest even though Truffle's
    // matcher is order-independent.
    routes: [previewRoute, sourceRoute],
  };
}

export function artifactServeId(intent: LocalArtifactIntent, previewDir: string): string {
  const bytes = Buffer.from(canonicalJson(canonicalArtifactServingConfig(intent, previewDir)));
  const fingerprint = base32(createHash("sha256").update(bytes).digest()).slice(0, 16);
  return `${ARTIFACT_SERVE_PREFIX}${intent.artifactId}-${fingerprint}`;
}

export class ArtifactService {
  readonly #bridge: ArtifactServeBridge;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #random: () => number;
  readonly #probe: (source: ArtifactSource) => Promise<boolean>;
  readonly #maintenanceMs: number | false;
  readonly #writeIntent: (path: string, body: string) => void;
  readonly #registryDir: string;
  readonly #intentPath: string;
  readonly #legacyPath: string;
  readonly #previewRoot: string;

  #entries = new Map<string, LocalArtifactIntent>();
  #legacyEntries: LegacyEntry[] | null = null;
  readonly #probes = new Map<string, ProbeState>();
  readonly #removeErrors = new Set<string>();
  readonly #listeners = new Set<(statuses: ArtifactStatus[]) => void>();
  #bridgeOff: (() => void) | null = null;
  #maintenance: NodeJS.Timeout | null = null;
  #chain: Promise<void> = Promise.resolve();
  #lastSig = "";
  #storageOk = true;
  #started = false;
  #disposed = false;

  constructor(opts: ArtifactServiceOptions) {
    this.#bridge = opts.bridge;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "artifacts" });
    this.#now = opts.now ?? Date.now;
    this.#random = opts.random ?? Math.random;
    this.#probe = opts.probe ?? probeArtifactSource;
    this.#maintenanceMs = opts.maintenanceMs ?? DEFAULT_MAINTENANCE_MS;
    this.#writeIntent = opts.writeIntent ?? atomicWriteIntent;
    this.#registryDir = join(opts.dataDir, "registries");
    this.#intentPath = join(this.#registryDir, ARTIFACT_INTENT_FILE);
    this.#legacyPath = join(this.#registryDir, `${STORES.ARTIFACTS}.json`);
    this.#previewRoot = join(opts.dataDir, "artifacts", "previews");
    this.#load();
  }

  /** Load/migrate, drain durable removals, and declare eligible serves. Mesh
   * unavailability is a normal starting state and never fails daemon boot. */
  start(): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#started || this.#disposed) return;
      this.#started = true;
      this.#bridgeOff = this.#bridge.on(() => {
        void this.#enqueue(async () => {
          await this.#adoptObservedUrls();
          this.#emit();
        });
      });
      await this.#migrateLegacy();
      await this.#reconcile();
      void this.#enqueue(async () => {
        await this.#probeAll();
        this.#emit();
      });
      this.#scheduleMaintenance();
    });
  }

  publish(params: ArtifactPublishParams): Promise<ArtifactStatus> {
    return this.#enqueue(async () => {
      const normalized = await this.#normalizePublish(params);
      const existing = this.#entries.get(normalized.artifactId);
      if (existing === undefined && this.#entries.size >= ARTIFACT_LIMITS.LOCAL_OBJECTS) {
        throw new RpcCallError(
          "RESOURCE_EXHAUSTED",
          `at most ${ARTIFACT_LIMITS.LOCAL_OBJECTS} local artifacts may exist`,
          false,
          { resource: "artifacts", limit: ARTIFACT_LIMITS.LOCAL_OBJECTS },
        );
      }

      const now = this.#now();
      const listenPort = existing?.listenPort ?? (await this.#allocatePort(normalized.artifactId));
      mkdirSync(this.#previewDir(normalized.artifactId), { recursive: true, mode: 0o700 });
      const next: LocalArtifactIntent = LocalArtifactIntent.parse({
        artifactId: normalized.artifactId,
        title: normalized.title,
        source: normalized.source,
        listenPort,
        allow: normalized.allow,
        publicTls: true,
        desired: "published",
        retiringServeIds: existing?.retiringServeIds ?? [],
        ...(existing?.lastPublishedUrl !== undefined
          ? { lastPublishedUrl: existing.lastPublishedUrl }
          : {}),
        ...(existing?.previewRevision !== undefined
          ? { previewRevision: existing.previewRevision }
          : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        ...(normalized.legacyName !== undefined ? { legacyName: normalized.legacyName } : {}),
      });
      if (existing !== undefined) this.#retireChangedConfig(existing, next);

      const entries = new Map(this.#entries);
      entries.set(next.artifactId, next);
      this.#commit(entries);
      this.#probes.set(next.artifactId, "pending");
      await this.#probeOne(next);
      await this.#reconcile();
      return this.#statusFor(this.#entries.get(next.artifactId) ?? next);
    });
  }

  update(params: ArtifactUpdateParams): Promise<ArtifactStatus> {
    return this.#enqueue(async () => {
      const current = this.#entries.get(params.artifactId);
      if (current === undefined) throw artifactNotFound(params.artifactId);
      if (current.desired === "absent") {
        throw new RpcCallError("CONFLICT", "artifact removal is already in progress", true);
      }
      const source =
        params.source === undefined ? current.source : normalizeSource(params.source, true);
      const allow = params.allow === undefined ? current.allow : canonicalAllow(params.allow);
      const next = LocalArtifactIntent.parse({
        ...current,
        ...(params.title !== undefined ? { title: params.title } : {}),
        source,
        allow,
        updatedAt: this.#now(),
      });
      this.#retireChangedConfig(current, next);
      const entries = new Map(this.#entries);
      entries.set(next.artifactId, next);
      this.#commit(entries);
      if (params.source !== undefined) {
        this.#probes.set(next.artifactId, "pending");
        await this.#probeOne(next);
      }
      await this.#reconcile();
      return this.#statusFor(this.#entries.get(next.artifactId) ?? next);
    });
  }

  unpublish(params: ArtifactUnpublishParams | string): Promise<{ removed: boolean }> {
    return this.#enqueue(async () => {
      const current = this.#findForUnpublish(params);
      if (current === undefined) return { removed: false };
      if (current.desired === "absent") {
        await this.#reconcile();
        return { removed: true };
      }
      const currentId = artifactServeId(current, this.#previewDir(current.artifactId));
      const retiring = appendRetiring(current.retiringServeIds, currentId);
      const next = LocalArtifactIntent.parse({
        ...current,
        desired: "absent",
        retiringServeIds: retiring,
        updatedAt: this.#now(),
      });
      const entries = new Map(this.#entries);
      entries.set(next.artifactId, next);
      this.#commit(entries);
      await this.#reconcile();
      return { removed: true };
    });
  }

  refreshPreview(artifactId: string): { artifactId: string; captured: false; reason: string } {
    if (!this.#entries.has(artifactId)) throw artifactNotFound(artifactId);
    // AH-4 installs the shell capture provider. The hardened route exists now,
    // but its directory remains intentionally empty until a bounded capture is
    // atomically committed.
    return { artifactId, captured: false, reason: "preview capture is not available" };
  }

  statuses(): ArtifactStatus[] {
    return [...this.#entries.values()]
      .map((entry) => this.#statusFor(entry))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
  }

  onChanged(fn: (statuses: ArtifactStatus[]) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  health(): ArtifactServiceHealth {
    const sources = { ready: 0, unavailable: 0, pending: 0 };
    for (const entry of this.#entries.values()) {
      if (entry.desired === "absent") continue;
      sources[this.#probes.get(entry.artifactId) ?? "pending"] += 1;
    }
    return {
      count: this.#entries.size,
      storage: this.#storageOk ? "ready" : "failed",
      sources,
      retiring: [...this.#entries.values()].reduce(
        (count, entry) => count + entry.retiringServeIds.length,
        0,
      ),
    };
  }

  dispose(): void {
    this.#disposed = true;
    this.#bridgeOff?.();
    this.#bridgeOff = null;
    if (this.#maintenance !== null) clearTimeout(this.#maintenance);
    this.#maintenance = null;
    this.#listeners.clear();
  }

  // ---- normalization and identity ---------------------------------------

  async #normalizePublish(params: ArtifactPublishParams): Promise<{
    artifactId: string;
    title: string;
    source: ArtifactSource;
    allow: string[];
    legacyName?: string;
  }> {
    const v2 = ArtifactPublishV2Params.safeParse(params);
    if (v2.success) {
      return {
        artifactId: v2.data.artifactId,
        title: v2.data.title,
        source: normalizeSource(v2.data.source, true),
        allow: canonicalAllow(v2.data.allow),
      };
    }
    const legacy = LegacyArtifactPublishParams.parse(params);
    const prior = [...this.#entries.values()].find((entry) => entry.legacyName === legacy.name);
    return {
      artifactId: prior?.artifactId ?? mintUlid(this.#now()),
      title: legacy.name,
      source: normalizeSource(
        legacy.target.kind === "port"
          ? { kind: "proxy", port: legacy.target.port, scheme: "http" }
          : { kind: "folder", path: legacy.target.path },
        true,
      ),
      allow: canonicalAllow(legacy.allow),
      legacyName: legacy.name,
    };
  }

  #retireChangedConfig(current: LocalArtifactIntent, next: LocalArtifactIntent): void {
    const previewDir = this.#previewDir(current.artifactId);
    const oldId = artifactServeId(current, previewDir);
    const nextId = artifactServeId(next, previewDir);
    if (oldId !== nextId) next.retiringServeIds = appendRetiring(next.retiringServeIds, oldId);
  }

  async #allocatePort(artifactId: string): Promise<number> {
    const used = new Set<number>();
    for (const entry of this.#entries.values()) used.add(entry.listenPort);
    try {
      for (const serve of await this.#bridge.observed()) {
        if (Number.isInteger(serve.listenPort) && serve.listenPort > 0) used.add(serve.listenPort);
      }
    } catch {
      // Mesh down is normal. Persisted reservations remain authoritative and a
      // later unexpected native collision is surfaced as an add error.
    }
    const first = artifactPortCandidate(artifactId);
    const width = ARTIFACT_LIMITS.LISTEN_PORT_MAX - ARTIFACT_LIMITS.LISTEN_PORT_MIN + 1;
    for (let offset = 0; offset < width; offset += 1) {
      const candidate =
        ARTIFACT_LIMITS.LISTEN_PORT_MIN +
        ((first - ARTIFACT_LIMITS.LISTEN_PORT_MIN + offset) % width);
      if (!used.has(candidate)) return candidate;
    }
    throw new RpcCallError("RESOURCE_EXHAUSTED", "no artifact listener port is available", true, {
      resource: "artifact-listen-port",
      min: ARTIFACT_LIMITS.LISTEN_PORT_MIN,
      max: ARTIFACT_LIMITS.LISTEN_PORT_MAX,
    });
  }

  #previewDir(artifactId: string): string {
    return join(this.#previewRoot, artifactId);
  }

  #serveSpec(intent: LocalArtifactIntent): ServeSpec {
    return {
      serveId: artifactServeId(intent, this.#previewDir(intent.artifactId)),
      name: `${ARTIFACT_TECHNICAL_NAME_PREFIX}${intent.artifactId}`,
      listenPort: intent.listenPort,
      target:
        intent.source.kind === "proxy"
          ? {
              kind: "port",
              port: intent.source.port,
              scheme: intent.source.scheme,
            }
          : {
              kind: "dir",
              path: intent.source.path,
              ...(intent.source.spaFallback !== undefined
                ? { fallback: intent.source.spaFallback }
                : {}),
            },
      previewDir: this.#previewDir(intent.artifactId),
      allow: intent.allow,
      tls: true,
    };
  }

  // ---- reconciliation ----------------------------------------------------

  async #reconcile(): Promise<void> {
    if (this.#disposed) return;

    // Drain the durable queue first. The replacement is deliberately excluded
    // from declare until every old id converges, preserving the stable port's
    // remove-before-add law across crashes and transient failures.
    for (const snapshot of [...this.#entries.values()]) {
      let current = this.#entries.get(snapshot.artifactId);
      if (current === undefined) continue;
      for (const serveId of [...current.retiringServeIds]) {
        try {
          await this.#bridge.remove(serveId);
          const latest = this.#entries.get(snapshot.artifactId);
          if (latest === undefined) break;
          const next = LocalArtifactIntent.parse({
            ...latest,
            retiringServeIds: latest.retiringServeIds.filter((id) => id !== serveId),
          });
          const entries = new Map(this.#entries);
          entries.set(next.artifactId, next);
          if (!this.#tryCommit(entries, "retirement checkpoint")) break;
          this.#removeErrors.delete(next.artifactId);
          current = next;
        } catch (error) {
          this.#removeErrors.add(snapshot.artifactId);
          this.#logger.info(
            "fieldd.artifacts.remove_deferred",
            "An artifact listener removal will be retried",
            { artifactId: snapshot.artifactId, error: errorName(error) },
          );
          break;
        }
      }
    }

    // An absent intent is deleted only after the removal queue is durably
    // empty. Preview deletion comes after the intent deletion, never before.
    for (const entry of [...this.#entries.values()]) {
      if (entry.desired !== "absent" || entry.retiringServeIds.length > 0) continue;
      const entries = new Map(this.#entries);
      entries.delete(entry.artifactId);
      if (!this.#tryCommit(entries, "unpublish checkpoint")) continue;
      this.#probes.delete(entry.artifactId);
      this.#removeErrors.delete(entry.artifactId);
      rmSync(this.#previewDir(entry.artifactId), { recursive: true, force: true });
    }

    const eligible = [...this.#entries.values()].filter(
      (entry) => entry.desired === "published" && entry.retiringServeIds.length === 0,
    );
    try {
      await this.#bridge.declare(eligible.map((entry) => this.#serveSpec(entry)));
    } catch (error) {
      this.#logger.info(
        "fieldd.artifacts.declare_deferred",
        "Artifact listeners are not carried yet",
        { error: errorName(error) },
      );
    }
    await this.#adoptObservedUrls();
    this.#emit();
  }

  async #adoptObservedUrls(): Promise<void> {
    const states = new Map(
      this.#bridge.states().map((state) => [state.serveId ?? state.name, state] as const),
    );
    let entries: Map<string, LocalArtifactIntent> | null = null;
    for (const entry of this.#entries.values()) {
      if (entry.desired !== "published" || entry.retiringServeIds.length > 0) continue;
      const id = artifactServeId(entry, this.#previewDir(entry.artifactId));
      const url = states.get(id)?.url;
      if (
        url === undefined ||
        url === entry.lastPublishedUrl ||
        url.length > ARTIFACT_LIMITS.URL_CHARS
      ) {
        continue;
      }
      entries ??= new Map(this.#entries);
      entries.set(entry.artifactId, LocalArtifactIntent.parse({ ...entry, lastPublishedUrl: url }));
    }
    if (entries !== null) this.#tryCommit(entries, "observed URL checkpoint");
  }

  // ---- source health -----------------------------------------------------

  async #probeOne(entry: LocalArtifactIntent): Promise<void> {
    if (entry.desired === "absent" || this.#disposed) return;
    let ready = false;
    try {
      ready = await this.#probe(entry.source);
    } catch {
      ready = false;
    }
    this.#probes.set(entry.artifactId, ready ? "ready" : "unavailable");
  }

  async #probeAll(): Promise<void> {
    const queue = [...this.#entries.values()].filter((entry) => entry.desired === "published");
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const index = cursor++;
        const entry = queue[index];
        if (entry === undefined) return;
        await this.#probeOne(entry);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, () => worker()),
    );
  }

  #scheduleMaintenance(): void {
    if (this.#maintenanceMs === false || this.#disposed) return;
    const jitter = Math.floor(this.#maintenanceMs * 0.2 * (this.#random() - 0.5));
    this.#maintenance = setTimeout(
      () => {
        this.#maintenance = null;
        void this.#enqueue(async () => {
          await this.#probeAll();
          await this.#reconcile();
          this.#scheduleMaintenance();
        });
      },
      Math.max(100, this.#maintenanceMs + jitter),
    );
    this.#maintenance.unref();
  }

  // ---- projection --------------------------------------------------------

  #statusFor(entry: LocalArtifactIntent): ArtifactStatus {
    const id = artifactServeId(entry, this.#previewDir(entry.artifactId));
    const serve = this.#bridge.states().find((state) => (state.serveId ?? state.name) === id);
    const probe = this.#probes.get(entry.artifactId) ?? "pending";
    let status: ArtifactStatus["status"];
    let error: string | undefined;

    if (entry.desired === "absent" || entry.retiringServeIds.length > 0) {
      status = "removing";
      if (this.#removeErrors.has(entry.artifactId)) error = "artifact listener removal is retrying";
    } else if (!this.#storageOk) {
      status = "error";
      error = "artifact intent storage is unavailable";
    } else if (serve === undefined || serve.status === "pending") {
      status = "starting";
    } else if (serve.status === "error" && !isSourceRuntimeError(serve.error)) {
      status = "error";
      error = safeServeError(serve.error);
    } else if (probe === "pending") {
      status = "starting";
    } else if (probe === "unavailable") {
      status = "source-unavailable";
      error = "source is unavailable";
    } else {
      // A successful independent probe clears Truffle's sticky source-runtime
      // error; listener/config errors took the branch above.
      status = "active";
    }

    return ArtifactStatus.parse({
      artifactId: entry.artifactId,
      title: entry.title,
      kind: entry.source.kind,
      status,
      ...(entry.lastPublishedUrl !== undefined ? { url: entry.lastPublishedUrl } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(entry.previewRevision !== undefined ? { previewRevision: entry.previewRevision } : {}),
      publishedAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...(entry.legacyName !== undefined ? { name: entry.legacyName } : {}),
    });
  }

  #emit(): void {
    const statuses = this.statuses();
    const sig = JSON.stringify(statuses);
    if (sig === this.#lastSig) return;
    this.#lastSig = sig;
    for (const fn of this.#listeners) {
      try {
        fn(statuses);
      } catch (error) {
        this.#logger.warn("fieldd.artifacts.listener_failed", "An artifact listener threw", {
          error: errorName(error),
        });
      }
    }
  }

  // ---- persistence and migration ----------------------------------------

  #load(): void {
    const v2 = this.#readJson(this.#intentPath, "intent");
    if (v2 !== undefined) {
      if (
        typeof v2 !== "object" ||
        v2 === null ||
        (v2 as IntentFileShape).v !== 2 ||
        !Array.isArray((v2 as IntentFileShape).artifacts)
      ) {
        this.#quarantine(this.#intentPath, "intent");
      } else {
        const rawArtifacts = (v2 as IntentFileShape).artifacts;
        if (rawArtifacts.length > ARTIFACT_LIMITS.LOCAL_OBJECTS) {
          this.#logger.warn(
            "fieldd.artifacts.intent_entries_truncated",
            "Artifact intent exceeded the local object limit",
            { count: rawArtifacts.length, limit: ARTIFACT_LIMITS.LOCAL_OBJECTS },
          );
        }
        for (const raw of rawArtifacts.slice(0, ARTIFACT_LIMITS.LOCAL_OBJECTS)) {
          const parsed = LocalArtifactIntent.safeParse(raw);
          if (parsed.success) {
            try {
              const normalized = LocalArtifactIntent.parse({
                ...parsed.data,
                source: normalizeSource(parsed.data.source, false),
                allow: canonicalAllow(parsed.data.allow),
              });
              if (this.#entries.has(normalized.artifactId)) {
                throw new Error("duplicate artifact id");
              }
              this.#entries.set(normalized.artifactId, normalized);
              this.#probes.set(normalized.artifactId, "pending");
            } catch (error) {
              this.#logger.warn(
                "fieldd.artifacts.intent_entry_dropped",
                "One artifact intent entry was unreadable",
                { issue: errorName(error) },
              );
            }
          } else {
            this.#logger.warn(
              "fieldd.artifacts.intent_entry_dropped",
              "One artifact intent entry was unreadable",
              { issue: parsed.error.issues[0]?.message ?? "unknown" },
            );
          }
        }
        return; // a valid v2 file, including an empty one, wins over legacy
      }
    }

    const legacy = this.#readJson(this.#legacyPath, "legacy registry");
    if (legacy === undefined) return;
    const rawEntries = (legacy as LegacyRegistryShape | null)?.artifacts;
    if (!Array.isArray(rawEntries)) {
      this.#quarantine(this.#legacyPath, "legacy registry");
      return;
    }
    const entries: LegacyEntry[] = [];
    for (const raw of rawEntries.slice(0, ARTIFACT_LIMITS.LOCAL_OBJECTS)) {
      const candidate = raw as Record<string, unknown> | null;
      const parsed = LegacyArtifactPublishParams.safeParse(candidate);
      const publishedAt = candidate?.["publishedAt"];
      if (parsed.success && typeof publishedAt === "number" && Number.isSafeInteger(publishedAt)) {
        entries.push({
          name: parsed.data.name,
          target: parsed.data.target,
          ...(parsed.data.allow !== undefined ? { allow: parsed.data.allow } : {}),
          publishedAt,
        });
      } else {
        this.#logger.warn(
          "fieldd.artifacts.legacy_entry_dropped",
          "One legacy artifact entry was unreadable",
        );
      }
    }
    this.#legacyEntries = entries;
  }

  async #migrateLegacy(): Promise<void> {
    if (this.#legacyEntries === null) return;
    const occupied = new Set<number>();
    try {
      for (const serve of await this.#bridge.observed()) {
        if (serve.listenPort > 0) occupied.add(serve.listenPort);
      }
    } catch {
      // mesh down: legacy ids are still retired before replacements are added;
      // any unrelated collision remains an honest add error.
    }
    const entries = new Map<string, LocalArtifactIntent>();
    for (const legacy of this.#legacyEntries) {
      const artifactId = mintUlid(this.#now());
      let listenPort = artifactPortCandidate(artifactId);
      const width = ARTIFACT_LIMITS.LISTEN_PORT_MAX - ARTIFACT_LIMITS.LISTEN_PORT_MIN + 1;
      let found = false;
      for (let offset = 0; offset < width; offset += 1) {
        const candidate =
          ARTIFACT_LIMITS.LISTEN_PORT_MIN +
          ((listenPort - ARTIFACT_LIMITS.LISTEN_PORT_MIN + offset) % width);
        if (!occupied.has(candidate)) {
          listenPort = candidate;
          found = true;
          break;
        }
      }
      if (!found) {
        this.#storageOk = false;
        this.#logger.error(
          "fieldd.artifacts.migration_ports_exhausted",
          "Legacy artifacts could not be migrated because the listener range is full",
        );
        return;
      }
      occupied.add(listenPort);
      const createdAt = Math.max(0, legacy.publishedAt);
      const source = normalizeSource(
        legacy.target.kind === "port"
          ? { kind: "proxy", port: legacy.target.port, scheme: "http" }
          : { kind: "folder", path: legacy.target.path },
        false,
      );
      const intent = LocalArtifactIntent.parse({
        artifactId,
        title: legacy.name,
        source,
        listenPort,
        allow: canonicalAllow(legacy.allow),
        publicTls: true,
        desired: "published",
        retiringServeIds: [`${ARTIFACT_SERVE_PREFIX}${legacy.name}`],
        createdAt,
        updatedAt: this.#now(),
        legacyName: legacy.name,
      });
      mkdirSync(this.#previewDir(artifactId), { recursive: true, mode: 0o700 });
      entries.set(artifactId, intent);
      this.#probes.set(artifactId, "pending");
    }
    try {
      this.#commit(entries);
    } catch (error) {
      this.#logger.error(
        "fieldd.artifacts.migration_failed",
        "Legacy artifact intent could not be migrated",
        { error: errorName(error) },
      );
      return;
    }
    const backup = `${this.#legacyPath}.migrated-${this.#now()}`;
    try {
      renameSync(this.#legacyPath, backup);
    } catch (error) {
      // v2 is already durable and wins next boot. Keeping the old evidence is
      // safe; never roll back the new intent after that commit point.
      this.#logger.warn(
        "fieldd.artifacts.legacy_backup_failed",
        "The migrated legacy registry could not be renamed",
        { error: errorName(error) },
      );
    }
    this.#legacyEntries = null;
    this.#logger.info(
      "fieldd.artifacts.migrated",
      "Legacy artifacts were migrated to stable HTTPS listeners",
      { count: entries.size, backup },
    );
  }

  #readJson(path: string, label: string): unknown | undefined {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (error) {
      if (isCode(error, "ENOENT")) return undefined;
      this.#storageOk = false;
      this.#logger.error("fieldd.artifacts.read_failed", `Artifact ${label} could not be read`, {
        error: errorName(error),
      });
      return undefined;
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      this.#quarantine(path, label);
      return undefined;
    }
  }

  #quarantine(path: string, label: string): void {
    const backup = `${path}.bad-${this.#now()}`;
    try {
      renameSync(path, backup);
    } catch {
      this.#storageOk = false;
    }
    this.#logger.error(
      "fieldd.artifacts.registry_unreadable",
      `Artifact ${label} was unreadable; it was moved aside`,
      { backup },
    );
  }

  #commit(entries: Map<string, LocalArtifactIntent>): void {
    const body = `${JSON.stringify(
      { v: 2, artifacts: [...entries.values()] } satisfies IntentFileShape,
      null,
      2,
    )}\n`;
    try {
      this.#writeIntent(this.#intentPath, body);
      this.#entries = entries;
      this.#storageOk = true;
    } catch (error) {
      this.#storageOk = false;
      this.#emit();
      throw new RpcCallError("INTERNAL", "artifact intent could not be persisted", true, {
        service: "artifact-storage",
        state: "failed",
        code: errorName(error),
      });
    }
  }

  #tryCommit(entries: Map<string, LocalArtifactIntent>, checkpoint: string): boolean {
    try {
      this.#commit(entries);
      return true;
    } catch (error) {
      this.#logger.error(
        "fieldd.artifacts.checkpoint_failed",
        `Artifact ${checkpoint} could not be persisted`,
        { error: errorName(error) },
      );
      return false;
    }
  }

  #findForUnpublish(params: ArtifactUnpublishParams | string): LocalArtifactIntent | undefined {
    if (typeof params === "string") {
      return [...this.#entries.values()].find((entry) => entry.legacyName === params);
    }
    if (typeof params.artifactId === "string") return this.#entries.get(params.artifactId);
    return [...this.#entries.values()].find((entry) => entry.legacyName === params.name);
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(operation);
    this.#chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function normalizeSource(source: ArtifactSource, requireReadableFolder: boolean): ArtifactSource {
  if (source.kind === "proxy") {
    // Product mutation schemas are tolerant readers, but private intent is a
    // narrow writer. Never persist caller-supplied extension fields beside a
    // local source address.
    return { kind: "proxy", port: source.port, scheme: source.scheme };
  }
  const absolute = resolve(source.path);
  let rooted = absolute;
  try {
    rooted = realpathSync(absolute);
  } catch {
    if (requireReadableFolder) throw invalidFolder();
  }
  if (requireReadableFolder) {
    try {
      if (!statSync(rooted).isDirectory()) throw invalidFolder();
      // Directory traversal needs search/execute permission as well as read.
      // Checking both catches the ordinary invalid-root case at the product
      // door; Truffle's os.OpenRoot binding remains the authoritative,
      // race-safe check immediately before listener installation.
      accessSync(rooted, constants.R_OK | constants.X_OK);
    } catch {
      throw invalidFolder();
    }
  }
  if (rooted.length > ARTIFACT_LIMITS.PATH_CHARS) {
    throw new RpcCallError("PRECONDITION_FAILED", "folder path is too long", false);
  }
  return {
    kind: "folder",
    path: rooted,
    ...(source.spaFallback !== undefined ? { spaFallback: source.spaFallback } : {}),
  };
}

function invalidFolder(): RpcCallError {
  return new RpcCallError(
    "PRECONDITION_FAILED",
    "selected folder is missing, unreadable, or not a directory",
    false,
    { code: "STATIC_ROOT_INVALID" },
  );
}

export function canonicalAllow(allow: readonly string[] | undefined): string[] {
  const canonical = [...new Set((allow ?? []).map((glob) => glob.trim().toLowerCase()))].sort();
  for (const glob of canonical) {
    if (glob.length === 0 || glob.length > ARTIFACT_LIMITS.ALLOW_GLOB_CHARS) {
      throw new RpcCallError("PRECONDITION_FAILED", "allow glob is empty or too long", false);
    }
    if (!validGoPathMatchPattern(glob)) {
      throw new RpcCallError("PRECONDITION_FAILED", "allow glob is malformed", false);
    }
  }
  if (canonical.length > ARTIFACT_LIMITS.ALLOW_GLOBS) {
    throw new RpcCallError(
      "PRECONDITION_FAILED",
      `at most ${ARTIFACT_LIMITS.ALLOW_GLOBS} allow globs are accepted`,
      false,
    );
  }
  return canonical;
}

/** Syntax validation matching Go path.Match's malformed-pattern cases. */
function validGoPathMatchPattern(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "\\") {
      i += 1;
      if (i >= pattern.length) return false;
      continue;
    }
    if (char !== "[") continue;
    i += 1;
    if (pattern[i] === "^") i += 1;
    let ranges = 0;
    for (;;) {
      if (i >= pattern.length) return false;
      if (pattern[i] === "]" && ranges > 0) break;
      const lo = escapedCodePoint(pattern, i);
      if (lo === null) return false;
      i = lo.next;
      let hi = lo.value;
      if (pattern[i] === "-") {
        const parsed = escapedCodePoint(pattern, i + 1);
        if (parsed === null) return false;
        hi = parsed.value;
        i = parsed.next;
      }
      if (lo.value > hi) return false;
      ranges += 1;
    }
  }
  return true;
}

function escapedCodePoint(value: string, offset: number): { value: number; next: number } | null {
  if (offset >= value.length || value[offset] === "]") return null;
  let index = offset;
  if (value[index] === "\\") {
    index += 1;
    if (index >= value.length) return null;
  }
  const point = value.codePointAt(index);
  if (point === undefined) return null;
  return { value: point, next: index + (point > 0xffff ? 2 : 1) };
}

function appendRetiring(existing: readonly string[], id: string): string[] {
  if (existing.includes(id)) return [...existing];
  if (existing.length >= MAX_RETIRING_IDS) {
    throw new RpcCallError(
      "RESOURCE_EXHAUSTED",
      "too many artifact listener replacements are awaiting removal",
      true,
      { resource: "artifact-retiring-listeners", limit: MAX_RETIRING_IDS },
    );
  }
  return [...existing, id];
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item !== undefined) out[key] = sortJson(item);
  }
  return out;
}

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function mintUlid(now: number): string {
  const timestamp = BigInt(Math.max(0, Math.min(Math.trunc(now), 0xffffffffffff)));
  const entropy = BigInt(`0x${randomBytes(10).toString("hex")}`);
  let value = (timestamp << 80n) | entropy;
  let out = "";
  for (let i = 0; i < 26; i += 1) {
    out = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

async function probeArtifactSource(source: ArtifactSource): Promise<boolean> {
  if (source.kind === "folder") {
    try {
      if (!statSync(source.path).isDirectory()) return false;
      accessSync(source.path, constants.R_OK | constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return await new Promise<boolean>((resolveProbe) => {
    let settled = false;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(ready);
    };
    const socket =
      source.scheme === "https"
        ? connectTls({ host: "127.0.0.1", port: source.port, rejectUnauthorized: false }, () =>
            finish(true),
          )
        : connectTcp({ host: "127.0.0.1", port: source.port }, () => finish(true));
    socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function atomicWriteIntent(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  const file = openSync(tmp, "r");
  try {
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
  renameSync(tmp, path);
  // Persist the rename itself. Some filesystems reject directory fsync; the
  // file is still atomically replaced, so only propagate errors from opening
  // or syncing platforms that support the operation.
  let directory: number | null = null;
  try {
    directory = openSync(dirname(path), "r");
    fsyncSync(directory);
  } catch (error) {
    if (!isCode(error, "EINVAL") && !isCode(error, "ENOTSUP")) throw error;
  } finally {
    if (directory !== null) closeSync(directory);
  }
}

function isSourceRuntimeError(error: string | undefined): boolean {
  return error !== undefined && /CONNECTION_(?:REFUSED|RESET)|BACKEND_(?:CONNECT|TLS)/i.test(error);
}

function safeServeError(error: string | undefined): string {
  if (error?.includes("STATIC_ROOT_INVALID")) return "folder is unavailable";
  if (/cert|tls/i.test(error ?? "")) return "tailnet HTTPS listener could not start";
  if (/bind|address.*use|port/i.test(error ?? "")) return "artifact listener port is unavailable";
  return "artifact listener could not start";
}

function artifactNotFound(artifactId: string): RpcCallError {
  return new RpcCallError("NOT_FOUND", `no such artifact: ${artifactId}`, false);
}

function errorName(error: unknown): string {
  if (error instanceof RpcCallError) return error.kind;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code.slice(0, 64);
  }
  return error instanceof Error ? error.name : "UNKNOWN";
}

function isCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
