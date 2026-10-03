import {
  DocListResult,
  DocOpenResult,
  DocRegistryEntry,
  type DocSyncIntent,
} from "@vibefield/contracts";
import { type FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { setBoardStatus } from "./board-status";
import { DocStillShelf } from "./doc-stills";
import { registryBeforeTheDesk } from "./field/desk/pre-desk";
import { getRendererLogger } from "./logging";

// B4 DocManager (thinking-b4-doc-ux §1): the renderer-spine lifecycle owner for
// canvas docs — launch decision, doc switching, create/rename, and the loading
// pipeline's progress accounting. React-free; FieldView consumes the store via
// useSyncExternalStore and APPLIES sessions to the engine (the manager never
// touches the CanvasEngine — the StrictMode twin-engine law stays React-side).
//
// Registry-open law (B3): the launch NEVER blind-seeds — this window's own
// board, else localStorage's last doc, else the most recently updated, else
// doc.create("Field") which alone carries seed:true (the demo scene belongs to
// the bootstrap default doc only; user-created docs open empty). Persistence
// status still flows through the board-status store (SystemSection's row); this
// store owns phase/doc/docs.

const LAST_DOC_KEY = "vf-last-doc";
/** THIS WINDOW'S board (DK-5): sessionStorage is the window's own and outlives its renderer, so a
 * renderer replaced after a daemon restart reopens the board IT held — not the last board any
 * window opened, which two windows would both reopen and the single-writer lock would refuse to
 * the second (found by `smoke:plugin-restart`'s soak with the desk). A new window has none and
 * reads the launch's `vf-last-doc`. */
const WINDOW_DOC_KEY = "vf-window-doc";
export const DEFAULT_DOC_NAME = "Field";
const SWITCH_COVER_MS = 220;
const CANVAS_PRESENT_TIMEOUT_MS = 2_500;

/** One engine-attachable doc session; FieldView's attach effect keys on generation. */
export interface DocSessionPending {
  generation: number;
  docId: string;
  name: string;
  /** null ⇒ persistence detached (degraded boot) — in-memory board. */
  lane: DocLaneClient | null;
  initialBytes: Uint8Array | null;
  initialUpdates: Uint8Array[];
  /** true only for the bootstrap default doc: seed the demo scene. */
  seed: boolean;
}

export interface DocManagerState {
  phase: "loading" | "ready";
  loading: { progress: number; stage: string } | null;
  doc: { docId: string; name: string } | null;
  /** explorer cache, most recently updated first */
  docs: DocRegistryEntry[];
  /** The boards' STILLS (DK-4, DK-D27): device-local, kept on the desk's byte store's keyed shelf;
   * `blob:` URLs, renderer-lifetime only. A board never captured has none (the placeholder tile). */
  thumbnailUrls: Readonly<Record<string, string>>;
  pending: DocSessionPending | null;
  /** Boards FROM BEFORE THE DESK (DK-3, ruling 7): the registry's (last saved below schema 3) and
   * any the open refused — listed by the explorer with Delete, never opened. Absent: none. */
  beforeTheDesk?: readonly string[];
}

/** A board's stills while it is open (DK-4, field/desk/desk-stills.ts): owed one after an edit
 * settles, and one taken at its close — registered per generation by the workspace session. */
export interface DocStillTaker {
  owe(): void;
  close(): Promise<void>;
}

/** The consumer surface (the head et al) — chrome takes this, not the class,
 * so UI tests drive a plain fake instead of a socket-backed manager. */
export interface DocManagerApi {
  subscribe(fn: () => void): () => void;
  getState(): DocManagerState;
  refreshDocs(): Promise<DocRegistryEntry[]>;
  rename(name: string): Promise<void>;
  createDoc(): Promise<void>;
  switchTo(docId: string): Promise<void>;
  /** UA-D7 — say whether this doc may leave the device. */
  setSyncIntent(docId: string, intent: DocSyncIntent): Promise<void>;
  /** DS-5's tombstone (`doc.delete`) — the explorer offers it for a board from before the desk. */
  deleteDoc?(docId: string): Promise<void>;
}

export interface DocPersistenceLease {
  flush(): Promise<void>;
  close(): Promise<void>;
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

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLastDocId(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(LAST_DOC_KEY);
  } catch {
    return null;
  }
}

function readWindowDocId(): string | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(WINDOW_DOC_KEY);
  } catch {
    return null;
  }
}

function writeLastDocId(docId: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LAST_DOC_KEY, docId);
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(WINDOW_DOC_KEY, docId);
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
    thumbnailUrls: {},
    pending: null,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private booted = false;
  private appliedGeneration = 0;
  /** lanes awaiting retirement — drained (chain settles, then close) once the
   * SUCCESSOR session's content is applied, i.e. after React cleanup queued the
   * old autosave's final flush PUT onto them. */
  private retiring: DocLaneClient[] = [];
  /** in-flight drains — the NEXT open awaits these, or a fast switch-back hits
   * the daemon's single-writer lock while the old socket is still closing. */
  private drains: Promise<void>[] = [];
  private offLane: (() => void) | null = null;
  private activePersistence: {
    generation: number;
    lease: DocPersistenceLease;
  } | null = null;
  private readonly presentedGenerations = new Set<number>();
  private readonly presentationWaiters = new Map<number, () => void>();
  /** Boards the open refused as from before the desk (ruling 7) — beside the registry's own word. */
  private readonly refused = new Set<string>();
  private readonly stills = new DocStillShelf(
    (docId, url) => {
      if (this.state.thumbnailUrls[docId] === url) return;
      this.patch({ thumbnailUrls: { ...this.state.thumbnailUrls, [docId]: url } });
    },
    undefined,
    (docId) => {
      if (this.state.thumbnailUrls[docId] === undefined) return;
      const thumbnailUrls = { ...this.state.thumbnailUrls };
      delete thumbnailUrls[docId];
      this.patch({ thumbnailUrls });
    },
  );
  private activeStills: { generation: number; docId: string; taker: DocStillTaker } | null = null;

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

  /** Launch: pick the doc (last-open → most-recent → create the default) and open it. */
  async boot(): Promise<void> {
    if (this.booted) return; // StrictMode double-effect
    this.booted = true;
    this.stage(0, "opening doc");
    try {
      const docs = await this.refreshDocs();
      // A board from before the desk is never the launch's (ruling 7): it is
      // listed, refused, and offered for deletion — never opened.
      const openable = (d: DocRegistryEntry): boolean =>
        d.deletedAt === undefined && !this.isBeforeTheDesk(d);
      const remembered = (docId: string | null): DocRegistryEntry | undefined =>
        docId === null ? undefined : docs.find((d) => d.docId === docId && openable(d));
      let entry =
        remembered(readWindowDocId()) ?? // this window's own board (DK-5)
        remembered(readLastDocId()) ??
        docs.find(openable) ?? // list is updatedAt-desc
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
      getRendererLogger()
        .child({ component: "docs.manager", docId })
        .warn("renderer.docs.switch_rejected", "Document switch targeted an unknown document");
      return;
    }
    if (this.isBeforeTheDesk(entry)) {
      getRendererLogger()
        .child({ component: "docs.manager", docId })
        .warn("renderer.docs.switch_before_the_desk", "A board from before the desk is not opened");
      return;
    }
    this.stage(0, "opening doc");
    try {
      // Let the opaque cover reach full opacity before the keyed engine swap.
      // This small, fixed handoff is cheaper than exposing teardown/rebuild.
      await this.waitForSwitchCover();
      await this.closeActiveStills();
      await this.flushActivePersistence();
      await this.openSession(entry, false);
    } catch (e) {
      this.recoverToCurrent("switch", e);
    }
  }

  /** New empty doc, then switch into it. */
  async createDoc(): Promise<void> {
    this.stage(0, "opening doc");
    try {
      await this.waitForSwitchCover();
      await this.closeActiveStills();
      await this.flushActivePersistence();
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
    getRendererLogger()
      .child({ component: "docs.manager", docId: this.state.doc?.docId })
      .error(
        "renderer.docs.action_failed",
        "A document action failed; the current document remains active",
        e,
        { action: what },
      );
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

  /** UA-D7 — where this doc is willing to go. The daemon answers with the whole
   * updated entry, and THAT is what the explorer patches: the "local" chip is a
   * registry fact, never inferred from the sync stream (the no-`solo`-on-the-
   * wire law — a gated doc has no sync status at all to read). */
  async setSyncIntent(docId: string, intent: DocSyncIntent): Promise<void> {
    const entry = DocRegistryEntry.parse(
      await this.request("doc.setSyncIntent", { docId, intent }),
    );
    this.patch({ docs: this.state.docs.map((d) => (d.docId === docId ? entry : d)) });
  }

  /** DS-5's tombstone: the board leaves every list (its bytes stay on disk). Deleting the board in
   * view — a refused one from before the desk — moves the field to the newest openable board, or a
   * new one when none is left. DK-5: its STILL leaves the explorer and the shelf with it — after
   * the switch, whose close may have taken one. */
  async deleteDoc(docId: string): Promise<void> {
    await this.request("doc.delete", { docId });
    this.refused.delete(docId);
    const docs = await this.refreshDocs();
    if (this.state.doc?.docId === docId) {
      const next = docs.find((d) => d.deletedAt === undefined && !this.isBeforeTheDesk(d));
      if (next !== undefined) await this.switchTo(next.docId);
      else await this.createDoc();
    }
    await this.stills.forget(docId);
  }

  /** The open refused this board as from before the desk (ruling 7): the library marks it. */
  refuseBeforeTheDesk(docId: string): void {
    if (docId.length === 0 || this.refused.has(docId)) return;
    this.refused.add(docId);
    this.patch({ beforeTheDesk: this.beforeTheDeskOf(this.state.docs) });
  }

  private isBeforeTheDesk(entry: DocRegistryEntry): boolean {
    return registryBeforeTheDesk(entry.engineSchema) || this.refused.has(entry.docId);
  }

  private beforeTheDeskOf(docs: readonly DocRegistryEntry[]): string[] {
    const ids = docs.filter((d) => this.isBeforeTheDesk(d)).map((d) => d.docId);
    for (const id of this.refused) if (!ids.includes(id)) ids.push(id);
    return ids;
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
    this.patch({ docs: sorted, beforeTheDesk: this.beforeTheDeskOf(sorted) });
    void this.stills
      .hydrate(sorted.filter((doc) => !this.isBeforeTheDesk(doc)).map((doc) => doc.docId))
      .catch((error: unknown) =>
        getRendererLogger()
          .child({ component: "docs.stills" })
          .error("renderer.docs.still_hydrate_failed", "The boards' stills were not read", error),
      );
    return sorted;
  }

  /** An edit to `docId` settled — fieldd acknowledged its save: its desk owes a still at its next
   * rest (DK-4, DK-D27). */
  stillOwed(docId: string): void {
    const active = this.activeStills;
    if (active !== null && active.docId === docId) active.taker.owe();
  }

  /** A still of `docId`, taken by its desk: kept on the shelf, the explorer's tile shown it. */
  keepStill(docId: string, png: Uint8Array<ArrayBuffer>): Promise<void> {
    return this.stills.keep(docId, png);
  }

  /** The open board's stills, per generation (the workspace session's). */
  registerStills(generation: number, docId: string, taker: DocStillTaker): () => void {
    const registration = { generation, docId, taker };
    this.activeStills = registration;
    return () => {
      if (this.activeStills === registration) this.activeStills = null;
    };
  }

  registerPersistence(generation: number, lease: DocPersistenceLease): () => void {
    const registration = { generation, lease };
    this.activePersistence = registration;
    return () => {
      if (this.activePersistence === registration) this.activePersistence = null;
    };
  }

  async shutdown(): Promise<void> {
    this.stage(0, "saving document");
    await this.waitForSwitchCover();
    await this.closeActiveStills();
    const persistence = this.activePersistence;
    if (persistence !== null) await persistence.lease.close();

    const lanes = new Set(this.retiring.splice(0));
    if (this.state.pending?.lane !== null && this.state.pending?.lane !== undefined) {
      lanes.add(this.state.pending.lane);
    }
    await Promise.all([...lanes].map((lane) => lane.drain()));
    await Promise.all(this.drains.splice(0));
  }

  /** FieldView reports presentation only after the arrival camera has framed
   * the restored world. Bytes-applied is not visual-ready: widgets/GL mount on
   * the following frames, which is exactly what the veil must conceal. */
  canvasPresented(generation: number): void {
    if (generation !== this.generation) return;
    this.presentedGenerations.add(generation);
    this.presentationWaiters.get(generation)?.();
    this.presentationWaiters.delete(generation);
    for (const seen of this.presentedGenerations) {
      if (seen < generation - 1) this.presentedGenerations.delete(seen);
    }
  }

  /** FieldView calls this at the end of its attach effect: the doc is on the
   * canvas — retire predecessors, wait for the desk to present it, land on ready. */
  contentApplied(generation: number): void {
    if (generation !== this.generation) return; // a newer session superseded this apply
    const firstApply = this.appliedGeneration !== generation;
    this.appliedGeneration = generation;
    for (const lane of this.retiring.splice(0)) this.drains.push(lane.drain());
    const pending = this.state.pending;
    // a refused board is never the next launch's (ruling 7)
    if (pending !== null && pending.lane !== null && firstApply && !this.refused.has(pending.docId))
      writeLastDocId(pending.docId);
    void this.presentStage(generation);
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
    let lane: DocLaneClient | null = null;
    let initialBytes: Uint8Array | null = null;
    let initialUpdates: Uint8Array[] = [];
    this.stage(0.25, "fetching board");
    for (let attempt = 0; ; attempt++) {
      const candidate = new DocLaneClient({
        openLane: async () =>
          DocOpenResult.parse(await this.client.request("doc.open", { docId: entry.docId })),
        opTimeoutMs: timeoutMs,
      });
      try {
        ({ initialBytes, initialUpdates } = await candidate.attachSnapshot());
        lane = candidate;
        break;
      } catch (e) {
        candidate.close();
        const busy = e instanceof FielddRpcError && e.kind === "PRECONDITION_FAILED";
        if (!busy || attempt >= 20) throw e;
        await new Promise((r) => setTimeout(r, 75));
      }
    }
    if (lane === null) throw new Error("document lane attach completed without a lane");
    this.stage(0.45, "restoring board");
    this.installSession({
      generation: ++this.generation,
      docId: entry.docId,
      name: entry.name,
      lane,
      initialBytes,
      initialUpdates,
      // a doc that already has bytes never re-seeds, whatever the caller thinks
      seed: seed && initialBytes === null,
    });
  }

  /** The board on screen closes (a switch, a new board, the window's end): its desk's last still,
   * taken before the stage lets the desk go — bounded, so a desk that cannot answer never holds it. */
  private async closeActiveStills(): Promise<void> {
    const active = this.activeStills;
    if (active === null || active.generation !== this.appliedGeneration) return;
    await active.taker.close();
  }

  private async flushActivePersistence(): Promise<void> {
    const persistence = this.activePersistence;
    if (persistence === null || persistence.generation !== this.appliedGeneration) return;
    await persistence.lease.flush();
  }

  /** Honest degraded launch (B3 law): the field still opens, in memory, with
   * persistence detached and the reason on the board row. */
  private degradedSession(e: unknown): void {
    const detail = e instanceof Error ? e.message : String(e);
    getRendererLogger()
      .child({ component: "docs.manager" })
      .error("renderer.docs.session_degraded", "Document session entered degraded mode", e);
    this.installSession({
      generation: ++this.generation,
      docId: "",
      name: DEFAULT_DOC_NAME,
      lane: null,
      initialBytes: null,
      initialUpdates: [],
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

  /** The veil's last stage (DK-4): the board is applied, and the desk draws it — the veil waits for
   * the arrival framed and presented, never on previews (the R3F preview capture retired at DK-2). */
  private async presentStage(generation: number): Promise<void> {
    this.stage(0.6, "drawing the board");
    await this.waitForCanvasPresentation(generation);
    if (generation !== this.generation) return;
    this.patch({ phase: "ready", loading: null });
  }

  private waitForSwitchCover(): Promise<void> {
    return this.appliedGeneration === 0 ? Promise.resolve() : waitMs(SWITCH_COVER_MS);
  }

  private waitForCanvasPresentation(generation: number): Promise<void> {
    if (this.presentedGenerations.has(generation)) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.presentationWaiters.delete(generation);
        resolve();
      }, CANVAS_PRESENT_TIMEOUT_MS);
      this.presentationWaiters.set(generation, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
