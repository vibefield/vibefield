import { DocListResult, DocOpenResult, DocRegistryEntry } from "@vibefield/contracts";
import { type FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { setBoardStatus } from "./board-status";

// B4 DocManager (thinking-b4-doc-ux §1): the renderer-spine lifecycle owner for
// canvas docs — launch decision, doc switching, create/rename, and the loading
// pipeline's progress accounting. React-free; FieldView consumes the store via
// useSyncExternalStore and APPLIES sessions to the engine (the manager never
// touches the CanvasEngine — the StrictMode twin-engine law stays React-side).
//
// Registry-open law (B3): the launch NEVER blind-seeds — localStorage's last
// doc, else the most recently updated, else doc.create("Field") which alone
// carries seed:true (the demo scene belongs to the bootstrap default doc only;
// user-created docs open empty). Persistence status still flows through the
// board-status store (SystemSection's row); this store owns phase/doc/docs.

const LAST_DOC_KEY = "vf-last-doc";
export const DEFAULT_DOC_NAME = "Field";

/** One engine-attachable doc session; FieldView's attach effect keys on generation. */
export interface DocSessionPending {
  generation: number;
  docId: string;
  name: string;
  /** null ⇒ persistence detached (degraded boot) — in-memory board. */
  lane: DocLaneClient | null;
  initialBytes: Uint8Array | null;
  /** true only for the bootstrap default doc: seed the demo scene. */
  seed: boolean;
}

export interface DocManagerState {
  phase: "loading" | "ready";
  loading: { progress: number; stage: string } | null;
  doc: { docId: string; name: string } | null;
  /** explorer cache, most recently updated first */
  docs: DocRegistryEntry[];
  pending: DocSessionPending | null;
}

/** Chunked preview capture, injected by FieldView (it owns the three/R3F imports). */
export type PreviewRunner = (onTick: (done: number, total: number) => void) => Promise<void>;

/** The consumer surface (FilePill et al) — chrome takes this, not the class,
 * so UI tests drive a plain fake instead of a socket-backed manager. */
export interface DocManagerApi {
  subscribe(fn: () => void): () => void;
  getState(): DocManagerState;
  refreshDocs(): Promise<DocRegistryEntry[]>;
  rename(name: string): Promise<void>;
  createDoc(): Promise<void>;
  switchTo(docId: string): Promise<void>;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function readLastDocId(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(LAST_DOC_KEY);
  } catch {
    return null;
  }
}

function writeLastDocId(docId: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LAST_DOC_KEY, docId);
  } catch {
    /* private-mode class failures — last-doc is a convenience, never load-bearing */
  }
}

export class DocManager {
  private state: DocManagerState = {
    phase: "loading",
    loading: { progress: 0, stage: "opening doc" },
    doc: null,
    docs: [],
    pending: null,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private booted = false;
  private appliedGeneration = 0;
  private previewRunner: PreviewRunner | null = null;
  /** lanes awaiting retirement — drained (chain settles, then close) once the
   * SUCCESSOR session's content is applied, i.e. after React cleanup queued the
   * old autosave's final flush PUT onto them. */
  private retiring: DocLaneClient[] = [];
  /** in-flight drains — the NEXT open awaits these, or a fast switch-back hits
   * the daemon's single-writer lock while the old socket is still closing. */
  private drains: Promise<void>[] = [];
  private offLane: (() => void) | null = null;

  constructor(
    private readonly client: FielddClient,
    private readonly opts: { timeoutMs?: number } = {},
  ) {}

  // ---- store ----

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = (): DocManagerState => this.state;

  private patch(next: Partial<DocManagerState>): void {
    this.state = { ...this.state, ...next };
    for (const fn of this.listeners) fn();
  }

  private stage(progress: number, stage: string): void {
    this.patch({ phase: "loading", loading: { progress, stage } });
  }

  // ---- lifecycle ----

  setPreviewRunner(run: PreviewRunner | null): void {
    this.previewRunner = run;
  }

  /** Launch: pick the doc (last-open → most-recent → create the default) and open it. */
  async boot(): Promise<void> {
    if (this.booted) return; // StrictMode double-effect
    this.booted = true;
    this.stage(0, "opening doc");
    try {
      const docs = await this.refreshDocs();
      const last = readLastDocId();
      let entry =
        (last !== null ? docs.find((d) => d.docId === last && d.deletedAt === undefined) : null) ??
        docs.find((d) => d.deletedAt === undefined) ?? // list is updatedAt-desc
        null;
      let seed = false;
      if (entry === null) {
        entry = DocRegistryEntry.parse(
          await this.request("doc.create", { name: DEFAULT_DOC_NAME }),
        );
        seed = true;
        await this.refreshDocs();
      }
      await this.openSession(entry, seed);
    } catch (e) {
      this.degradedSession(e);
    }
  }

  /** Load another doc into the field. The current session tears down in React
   * (flush→stop→close), and its lane drains once the new content is applied. */
  async switchTo(docId: string): Promise<void> {
    if (this.state.doc?.docId === docId && this.state.phase === "ready") return;
    const entry = this.state.docs.find((d) => d.docId === docId);
    if (!entry) {
      console.warn(`[doc-manager] switchTo unknown doc ${docId}`);
      return;
    }
    this.stage(0, "opening doc");
    try {
      await this.openSession(entry, false);
    } catch (e) {
      this.recoverToCurrent("switch", e);
    }
  }

  /** New empty doc, then switch into it. */
  async createDoc(): Promise<void> {
    this.stage(0, "opening doc");
    try {
      const entry = DocRegistryEntry.parse(await this.request("doc.create", { name: "Untitled" }));
      await this.refreshDocs();
      await this.openSession(entry, false);
    } catch (e) {
      this.recoverToCurrent("create", e);
    }
  }

  /** A failed SWITCH must never demote the running board — the current doc
   * stays on screen and stays live; only a failed BOOT degrades (no board
   * exists yet to keep). */
  private recoverToCurrent(what: string, e: unknown): void {
    if (this.appliedGeneration === 0) {
      this.degradedSession(e);
      return;
    }
    console.warn(`[doc-manager] ${what} failed — keeping the current doc:`, e);
    this.patch({ phase: "ready", loading: null });
  }

  /** Rename the current doc (label only — recency is content's, per doc.rename). */
  async rename(name: string): Promise<void> {
    const doc = this.state.doc;
    const trimmed = name.trim();
    if (!doc || trimmed.length === 0 || trimmed === doc.name) return;
    const entry = DocRegistryEntry.parse(
      await this.request("doc.rename", { docId: doc.docId, name: trimmed }),
    );
    this.patch({
      doc: { docId: doc.docId, name: entry.name },
      docs: this.state.docs.map((d) => (d.docId === doc.docId ? entry : d)),
    });
  }

  async refreshDocs(): Promise<DocRegistryEntry[]> {
    const { docs } = DocListResult.parse(
      await withTimeout(
        this.client.request("doc.list", {}),
        this.opts.timeoutMs ?? 8_000,
        "doc.list",
      ),
    );
    const sorted = [...docs].sort((a, b) => b.updatedAt - a.updatedAt);
    this.patch({ docs: sorted });
    return sorted;
  }

  /** FieldView calls this at the end of its attach effect: the doc is on the
   * canvas — retire predecessors, run the previews stage, land on ready. */
  contentApplied(generation: number): void {
    if (generation !== this.generation) return; // a newer session superseded this apply
    const firstApply = this.appliedGeneration !== generation;
    this.appliedGeneration = generation;
    for (const lane of this.retiring.splice(0)) this.drains.push(lane.drain());
    const pending = this.state.pending;
    if (pending !== null && pending.lane !== null && firstApply) writeLastDocId(pending.docId);
    void this.runPreviewsStage(generation);
  }

  // ---- internals ----

  private request(method: string, params: unknown): Promise<unknown> {
    return withTimeout(this.client.request(method, params), this.opts.timeoutMs ?? 8_000, method);
  }

  private async openSession(entry: DocRegistryEntry, seed: boolean): Promise<void> {
    const timeoutMs = this.opts.timeoutMs ?? 8_000;
    // A predecessor lane may still be closing. drain() settles when the CLIENT
    // initiates close, but the daemon's writer lock clears only when the SERVER
    // observes the socket close — so a fast switch-back can still read
    // writer-busy for a few ms. Await our drains, then retry busy briefly.
    await Promise.allSettled(this.drains.splice(0));
    const lane = new DocLaneClient({
      openLane: async () =>
        DocOpenResult.parse(await this.client.request("doc.open", { docId: entry.docId })),
    });
    let hasDoc = false;
    for (let attempt = 0; ; attempt++) {
      try {
        ({ hasDoc } = await withTimeout(lane.attach(), timeoutMs, "doc lane attach"));
        break;
      } catch (e) {
        const busy = e instanceof FielddRpcError && e.kind === "PRECONDITION_FAILED";
        if (!busy || attempt >= 20) throw e;
        await new Promise((r) => setTimeout(r, 75));
      }
    }
    this.stage(0.25, "fetching board");
    const initialBytes = hasDoc ? await withTimeout(lane.get(), timeoutMs, "doc fetch") : null;
    this.stage(0.45, "restoring board");
    this.installSession({
      generation: ++this.generation,
      docId: entry.docId,
      name: entry.name,
      lane,
      initialBytes,
      // a doc that already has bytes never re-seeds, whatever the caller thinks
      seed: seed && initialBytes === null,
    });
  }

  /** Honest degraded launch (B3 law): the field still opens, in memory, with
   * persistence detached and the reason on the board row. */
  private degradedSession(e: unknown): void {
    const detail = e instanceof Error ? e.message : String(e);
    console.warn(`[doc-manager] degraded session: ${detail}`);
    this.installSession({
      generation: ++this.generation,
      docId: "",
      name: DEFAULT_DOC_NAME,
      lane: null,
      initialBytes: null,
      seed: true,
    });
    setBoardStatus({ state: "detached", detail });
  }

  private installSession(pending: DocSessionPending): void {
    // the outgoing lane retires only after the successor's content is applied
    const prev = this.state.pending?.lane;
    if (prev && prev !== pending.lane) this.retiring.push(prev);
    this.offLane?.();
    this.offLane = null;
    if (pending.lane !== null) {
      const lane = pending.lane;
      this.offLane = lane.onStatusChange(() => {
        if (lane.status === "attached")
          setBoardStatus({ state: "live", lastSavedAt: lane.lastPutAt });
        else if (lane.status === "reconnecting")
          setBoardStatus({
            state: "detached",
            detail: "reconnecting",
            lastSavedAt: lane.lastPutAt,
          });
      });
      setBoardStatus({ state: "live", lastSavedAt: null });
    }
    this.patch({ doc: { docId: pending.docId, name: pending.name }, pending });
  }

  private async runPreviewsStage(generation: number): Promise<void> {
    this.stage(0.6, "preparing previews");
    const run = this.previewRunner;
    if (run !== null) {
      try {
        await run((done, total) => {
          if (generation !== this.generation) return;
          const frac = total === 0 ? 1 : done / total;
          this.stage(0.6 + 0.4 * frac, "preparing previews");
        });
      } catch (e) {
        // previews fail soft — tray tiles keep their manifest fallbacks
        console.warn("[doc-manager] preview capture failed", e);
      }
    }
    if (generation !== this.generation) return;
    this.patch({ phase: "ready", loading: null });
  }
}
