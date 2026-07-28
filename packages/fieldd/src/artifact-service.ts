import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARTIFACT_SERVE_PREFIX,
  ArtifactEntry,
  type ArtifactStatus,
  type ArtifactTarget,
  STORES,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { ServeSpec, ServeState } from "./mesh-client";
import { RpcCallError } from "./native-link";

// ArtifactService (C6-6; design-02 §3 · design-00 §4.7) — the artifact hub:
// publish a port or a directory, get a tailnet URL back. It is a REGISTRY over
// the mesh serve facade, deliberately thin: the C3 machinery already owns
// declarative serves, reconnect replay, and live runtime fusion, so this
// service's whole job is durable intent ("what should be served") plus honest
// projection ("what its serve is actually doing").
//
// "Re-serving is re-creating": the registry (`field.artifacts.v1`, a local
// JSON file — the docs-registry pattern) is replayed into the serve set on
// every start; MeshClient replays the set on every native (re)connect. An
// artifact therefore survives fieldd restarts the same way a doc does —
// intent is durable, the serve is derived.
//
// DEFERRED with a named gate (thinking-c6 §11): the CAS blob store under
// blobs/ as a deny-by-default pull root. truffle-core ships FileTransfer, but
// the native facade exposes no file-transfer surface — building one is a
// deliberate mgmt-contract + Rust slice, not a by-product of this one; and
// the blob store's consumers (canvas blob refs, peer-CAS plugin fetch) do not
// exist yet (A7: no speculative powers).

/** The daemon's composition seam: artifacts never own the WHOLE serve set —
 * the product serve is composed in by the daemon (its secret never enters
 * this service). */
export interface ArtifactServeBridge {
  /** Replace the artifact serves (the daemon prepends the product serve). */
  declare(specs: ServeSpec[]): Promise<void>;
  /** The fused serve states (C2 reconcile ∘ C3 runtime), all serves. */
  states(): ServeState[];
  /** serves-changed; returns a detach. */
  on(cb: () => void): () => void;
}

export interface ArtifactServiceOptions {
  dataDir: string;
  bridge: ArtifactServeBridge;
  logger?: Logger;
  now?: () => number;
}

interface RegistryFileShape {
  v: number;
  artifacts: unknown[];
}

export class ArtifactService {
  readonly #bridge: ArtifactServeBridge;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #registryDir: string;
  readonly #registryPath: string;

  /** insertion-ordered: list() reads back in publish order */
  #entries = new Map<string, ArtifactEntry>();
  readonly #listeners = new Set<(statuses: ArtifactStatus[]) => void>();
  #bridgeOff: (() => void) | null = null;
  #lastSig = "";
  #storageOk = true;

  constructor(opts: ArtifactServiceOptions) {
    this.#bridge = opts.bridge;
    this.#logger = (opts.logger ?? createNoopLogger()).child({ component: "artifacts" });
    this.#now = opts.now ?? Date.now;
    this.#registryDir = join(opts.dataDir, "registries");
    this.#registryPath = join(this.#registryDir, `${STORES.ARTIFACTS}.json`);
    this.#load();
  }

  /** Replay the persisted set into the serve fabric and start following live
   * serve state. Fire-and-forget at bootstrap (mesh down ⇒ serves sit
   * `pending` honestly — the C3 law; nothing here stalls boot). */
  async start(): Promise<void> {
    this.#bridgeOff ??= this.#bridge.on(() => this.#emit());
    await this.#declare();
  }

  /** Upsert-by-name (idempotent — a retry or a re-publish with new bits is
   * the same gesture). Returns the artifact's status, honest about `pending`
   * when the mesh has not carried it yet. */
  async publish(params: {
    name: string;
    target: ArtifactTarget;
    allow?: string[] | undefined;
  }): Promise<ArtifactStatus> {
    if (params.target.kind === "dir") {
      // Refuse fast at the door: a serve over a directory that is not there
      // would sit in a runtime-error loop the caller could have been told
      // about now. Later deletion still surfaces — as the serve's own honest
      // error state, not a silent 404.
      let isDir = false;
      try {
        isDir = statSync(params.target.path).isDirectory();
      } catch {
        /* missing — refused below */
      }
      if (!isDir) {
        throw new RpcCallError("PRECONDITION_FAILED", "target.path is not a directory", false, {
          path: params.target.path,
        });
      }
    }
    const entry: ArtifactEntry = {
      name: params.name,
      target: params.target,
      ...(params.allow !== undefined ? { allow: params.allow } : {}),
      publishedAt: this.#now(),
    };
    this.#entries.set(entry.name, entry);
    this.#persist();
    await this.#declare();
    const status = this.statuses().find((s) => s.name === entry.name);
    // the entry was just set; the fold always answers for it
    return status ?? { ...entry, status: "pending" };
  }

  async unpublish(name: string): Promise<{ removed: boolean }> {
    const removed = this.#entries.delete(name);
    if (removed) {
      this.#persist();
      await this.#declare();
    }
    return { removed };
  }

  /** Entries fused with their serve's live verdict. An entry whose serve the
   * fabric does not (yet) know is `pending` — declared intent, not yet
   * carried; never invented as active. */
  statuses(): ArtifactStatus[] {
    const states = new Map(this.#bridge.states().map((s) => [s.name, s]));
    const out: ArtifactStatus[] = [];
    for (const entry of this.#entries.values()) {
      const serve = states.get(ARTIFACT_SERVE_PREFIX + entry.name);
      out.push({
        ...entry,
        status: serve?.status ?? "pending",
        ...(serve?.url !== undefined ? { url: serve.url } : {}),
        ...(serve?.status === "error" && serve.error !== undefined ? { error: serve.error } : {}),
      });
    }
    return out;
  }

  /** Status-change feed for `artifact.subscribe` (roster pattern). */
  onChanged(fn: (statuses: ArtifactStatus[]) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  health(): { count: number; storage: "ready" | "failed" } {
    return { count: this.#entries.size, storage: this.#storageOk ? "ready" : "failed" };
  }

  dispose(): void {
    this.#bridgeOff?.();
    this.#bridgeOff = null;
    this.#listeners.clear();
  }

  // ---- internals ----

  async #declare(): Promise<void> {
    const specs: ServeSpec[] = [...this.#entries.values()].map((entry) => ({
      name: ARTIFACT_SERVE_PREFIX + entry.name,
      target: entry.target,
      ...(entry.allow !== undefined ? { allow: entry.allow } : {}),
      // Plain HTTP inside WireGuard — the tunnel encrypts, and tls:true would
      // couple every artifact to MagicDNS cert provisioning (the product
      // serve's own C3 reasoning). A per-artifact tls opt-in can ride the
      // params passthrough later without a shape change.
      tls: false,
    }));
    try {
      await this.#bridge.declare(specs);
    } catch (error) {
      // Mesh down or the declare failing outright — intent is already durable
      // and the states() fold reads `pending`; the next reconcile replays.
      this.#logger.info("fieldd.artifacts.declare_deferred", "Artifact serves not carried yet", {
        error: String(error),
      });
    }
    this.#emit();
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
        this.#logger.warn("fieldd.artifacts.listener_failed", "A status listener threw", {
          error: String(error),
        });
      }
    }
  }

  #load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.#registryPath, "utf8");
    } catch {
      return; // first boot — an empty registry is the normal empty state
    }
    let parsed: RegistryFileShape;
    try {
      parsed = JSON.parse(raw) as RegistryFileShape;
      if (!Array.isArray(parsed.artifacts)) throw new Error("artifacts is not an array");
    } catch (error) {
      // An unreadable registry never takes the service down — and never gets
      // silently overwritten either: the evidence moves aside, the service
      // starts empty, and the log says so.
      const backup = `${this.#registryPath}.bad-${this.#now()}`;
      try {
        renameSync(this.#registryPath, backup);
      } catch {
        this.#storageOk = false;
      }
      this.#logger.error(
        "fieldd.artifacts.registry_unreadable",
        "The artifact registry could not be parsed; moved aside, starting empty",
        { error: String(error), backup },
      );
      return;
    }
    for (const raw of parsed.artifacts) {
      const entry = ArtifactEntry.safeParse(raw);
      // tolerant reader: one bad entry is one entry, never the registry
      if (entry.success) this.#entries.set(entry.data.name, entry.data);
      else {
        this.#logger.warn("fieldd.artifacts.entry_dropped", "A registry entry was unreadable", {
          issue: entry.error.issues[0]?.message ?? "unknown",
        });
      }
    }
  }

  #persist(): void {
    try {
      mkdirSync(this.#registryDir, { recursive: true });
      const body = JSON.stringify(
        { v: 1, artifacts: [...this.#entries.values()] } satisfies RegistryFileShape,
        null,
        2,
      );
      const tmp = `${this.#registryPath}.tmp`;
      writeFileSync(tmp, `${body}\n`);
      renameSync(tmp, this.#registryPath); // atomic on one filesystem
      this.#storageOk = true;
    } catch (error) {
      // The serve still declares (intent lives in memory this boot); the
      // NEXT boot loses it — say so loudly rather than failing the publish.
      this.#storageOk = false;
      this.#logger.error(
        "fieldd.artifacts.persist_failed",
        "The artifact registry could not be written; this boot's set will not replay",
        error,
      );
    }
  }
}
