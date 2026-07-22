import type { DocThumbnailScene } from "./doc-thumbnail-scene";
import {
  isHidden as realIsHidden,
  onVisibilityChange as realOnVisibilityChange,
} from "./visibility";

const DB_NAME = "vibefield-derived-artifacts";
const STORE_NAME = "doc-thumbnails";
const DB_VERSION = 1;
const RENDERER_VERSION = 1;
const DEBOUNCE_MS = 4_000;
const MAX_WAIT_MS = 30_000;

interface ThumbnailRecord {
  docId: string;
  revision: string;
  rendererVersion: number;
  generatedAt: number;
  blob: Blob;
}

interface ThumbnailJob {
  docId: string;
  revision: string;
  scene: DocThumbnailScene;
  firstQueuedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

interface WorkerReply {
  id: number;
  blob?: Blob;
  error?: string;
}

interface VisibilitySeam {
  isHidden(): boolean;
  onVisibilityChange(fn: (hidden: boolean) => void): () => void;
}

export class DocThumbnailCache {
  private readonly hydrated = new Set<string>();
  private readonly urls = new Map<string, string>();
  private readonly latestRevision = new Map<string, string>();
  private readonly jobs = new Map<string, ThumbnailJob>();
  private readonly parked = new Map<string, ThumbnailJob>();
  private watchingVisibility = false;
  private renderChain: Promise<void> = Promise.resolve();
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private worker: Worker | null = null;
  private requestId = 0;

  constructor(
    private readonly publish: (docId: string, url: string) => void,
    private readonly vis: VisibilitySeam = {
      isHidden: realIsHidden,
      onVisibilityChange: realOnVisibilityChange,
    },
  ) {}

  /** honesty + test seam: captures currently waiting on visibility (PF6) */
  parkedCount(): number {
    return this.parked.size;
  }

  async hydrate(docIds: string[]): Promise<void> {
    const wanted = docIds.filter((docId) => !this.hydrated.has(docId));
    if (wanted.length === 0) return;
    for (const docId of wanted) this.hydrated.add(docId);
    const db = await this.openDb();
    if (db === null) return;
    const records = await Promise.all(wanted.map((docId) => readRecord(db, docId)));
    for (const record of records) {
      if (record === undefined || record.rendererVersion !== RENDERER_VERSION) continue;
      this.latestRevision.set(record.docId, record.revision);
      this.publishBlob(record.docId, record.blob);
    }
  }

  schedule(docId: string, revision: string, scene: DocThumbnailScene): void {
    this.latestRevision.set(docId, revision);
    const prior = this.jobs.get(docId);
    if (prior !== undefined) clearTimeout(prior.timer);
    const firstQueuedAt = prior?.firstQueuedAt ?? Date.now();
    const remaining = Math.max(0, MAX_WAIT_MS - (Date.now() - firstQueuedAt));
    const delay = Math.min(DEBOUNCE_MS, remaining);
    const timer = setTimeout(() => this.enqueue(docId), delay);
    this.jobs.set(docId, { docId, revision, scene, firstQueuedAt, timer });
  }

  private enqueue(docId: string): void {
    const job = this.jobs.get(docId);
    if (job === undefined) return;
    this.jobs.delete(docId);
    // PF6 — visibility silences the source: a hidden window captures nothing.
    // The job parks; the next `visible` flushes it (latest-wins stays intact
    // through renderAndPersist's revision checks). App-lifetime object — the
    // single listener is registered lazily and never needs teardown.
    if (this.vis.isHidden()) {
      this.parked.set(docId, job);
      this.watchVisibility();
      return;
    }
    this.chain(job);
  }

  private chain(job: ThumbnailJob): void {
    this.renderChain = this.renderChain
      .then(() => this.renderAndPersist(job))
      .catch((error: unknown) => console.warn("[doc-thumbnail] generation failed", error));
  }

  private watchVisibility(): void {
    if (this.watchingVisibility) return;
    this.watchingVisibility = true;
    this.vis.onVisibilityChange((hidden) => {
      if (hidden) return;
      for (const job of this.parked.values()) this.chain(job);
      this.parked.clear();
    });
  }

  private async renderAndPersist(job: ThumbnailJob): Promise<void> {
    if (this.latestRevision.get(job.docId) !== job.revision) return;
    await whenIdle();
    if (this.latestRevision.get(job.docId) !== job.revision) return;
    const blob = await this.render(job.scene);
    if (this.latestRevision.get(job.docId) !== job.revision) return;
    const record: ThumbnailRecord = {
      docId: job.docId,
      revision: job.revision,
      rendererVersion: RENDERER_VERSION,
      generatedAt: Date.now(),
      blob,
    };
    const db = await this.openDb();
    if (db !== null) await writeRecord(db, record);
    if (this.latestRevision.get(job.docId) === job.revision) this.publishBlob(job.docId, blob);
  }

  private render(scene: DocThumbnailScene): Promise<Blob> {
    const worker = this.getWorker();
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerReply>): void => {
        if (event.data.id !== id) return;
        cleanup();
        if (event.data.blob !== undefined) resolve(event.data.blob);
        else reject(new Error(event.data.error ?? "thumbnail worker returned no image"));
      };
      const onError = (event: ErrorEvent): void => {
        cleanup();
        this.worker?.terminate();
        this.worker = null;
        reject(new Error(event.message || "thumbnail worker crashed"));
      };
      const cleanup = (): void => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({ id, scene });
    });
  }

  private getWorker(): Worker {
    this.worker ??= new Worker(new URL("./doc-thumbnail-worker.ts", import.meta.url), {
      type: "module",
      name: "vibefield-doc-thumbnails",
    });
    return this.worker;
  }

  private publishBlob(docId: string, blob: Blob): void {
    if (typeof URL.createObjectURL !== "function") return;
    const next = URL.createObjectURL(blob);
    const prior = this.urls.get(docId);
    if (prior !== undefined && typeof URL.revokeObjectURL === "function")
      URL.revokeObjectURL(prior);
    this.urls.set(docId, next);
    this.publish(docId, next);
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise !== null) return this.dbPromise;
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME))
          db.createObjectStore(STORE_NAME, { keyPath: "docId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("thumbnail cache open failed"));
    });
    return this.dbPromise;
  }
}

function readRecord(db: IDBDatabase, docId: string): Promise<ThumbnailRecord | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(docId);
    request.onsuccess = () => resolve(request.result as ThumbnailRecord | undefined);
    request.onerror = () => reject(request.error ?? new Error("thumbnail cache read failed"));
  });
}

function writeRecord(db: IDBDatabase, record: ThumbnailRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("thumbnail cache write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("thumbnail cache write aborted"));
  });
}

function whenIdle(): Promise<void> {
  const requestIdle = (
    globalThis as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (requestIdle === undefined)
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  return new Promise((resolve) => requestIdle(resolve, { timeout: 1_500 }));
}
