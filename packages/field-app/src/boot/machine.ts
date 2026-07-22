import type { FielddClient } from "@vibefield/fieldd-client";
import type { DocManager } from "../doc-manager";
import type { FieldHost } from "../host";

// The boot machine (ESR §5.4.2; design-03 §4.3 v0.3): explicit states, no
// scattered nullable globals. Framework-free — BootRoot renders it via
// useSyncExternalStore; tests drive it with a fake host and injected
// raf/now/mark. The reveal law lives here: `interactive` fires only after the
// document is fully warm (DocManager phase "ready" — the B4 pipeline includes
// previews) AND the frame-stability gate passes or its bounded cap forces a
// logged degraded reveal.

export type WorkspaceModule = typeof import("../workspace");

export type BootPhase =
  | "requesting-bootstrap"
  | "connecting-fieldd"
  | "opening-document"
  | "warming"
  | "stabilizing"
  | "interactive";

export interface BootUnavailable {
  phase: BootPhase;
  reason: string;
  retryable: boolean;
}

/** Stable snapshot for useSyncExternalStore — replaced wholesale on change. */
export interface BootView {
  phase: BootPhase;
  unavailable: BootUnavailable | null;
  /** lowercase stage label (DESIGN.md §8 — real stages, never theater) */
  stage: string;
  /** null before the document pipeline reports numbers */
  progress: number | null;
  degradedReveal: boolean;
}

export interface BootReady {
  client: FielddClient;
  manager: DocManager;
  mod: WorkspaceModule;
}

export interface BootMachineDeps {
  host: FieldHost;
  importWorkspace(): Promise<WorkspaceModule>;
  makeClient(conn: { port: number; token: string }): FielddClient;
  raf?: (cb: () => void) => void;
  now?: () => number;
  /** a frame counts as clean at or under this delta */
  frameBudgetMs?: number;
  /** consecutive clean frames required to reveal */
  stableFrames?: number;
  /** cap past warmth: degraded reveal + logged miss, never a hung splash */
  stabilityCapMs?: number;
  /** hidden windows have no frames to judge — the reveal proceeds unwatched
   * (PF6; with background throttling restored, rAF may not tick at all) */
  isHidden?: () => boolean;
  mark?: (name: string) => void;
}

export interface BootMachine {
  view(): BootView;
  subscribe(fn: () => void): () => void;
  readonly ready: BootReady | null;
  readonly client: FielddClient | null;
  /** idempotent; called after the first paint (mount schedules it on rAF) */
  start(): void;
  /** re-runs from the failed step; no-op unless unavailable */
  retry(): void;
}

const FRAME_BUDGET_MS = 24; // 60Hz + scheduling slack
const STABLE_FRAMES = 10;
const STABILITY_CAP_MS = 1_000;

export function createBootMachine(deps: BootMachineDeps): BootMachine {
  const raf = deps.raf ?? ((cb: () => void) => requestAnimationFrame(() => cb()));
  const now = deps.now ?? (() => performance.now());
  const mark = deps.mark ?? ((name: string) => performance.mark(name));

  const listeners = new Set<() => void>();
  let view: BootView = {
    phase: "requesting-bootstrap",
    unavailable: null,
    stage: "waking the daemon",
    progress: null,
    degradedReveal: false,
  };
  const patch = (next: Partial<BootView>): void => {
    view = { ...view, ...next };
    for (const fn of [...listeners]) fn();
  };

  // resumable checkpoints — retry() re-enters run() and completed steps skip
  let workspacePromise: Promise<WorkspaceModule> | null = null;
  let conn: { port: number; token: string } | null = null;
  let client: FielddClient | null = null;
  let mod: WorkspaceModule | null = null;
  let ready: BootReady | null = null;
  let running = false;
  let started = false;

  async function run(): Promise<void> {
    if (running) return;
    running = true;
    patch({ unavailable: null });
    try {
      if (workspacePromise === null) {
        mark("vf:renderer:workspace-import-start");
        workspacePromise = deps.importWorkspace().then((m) => {
          mark("vf:renderer:workspace-import-end");
          return m;
        });
        workspacePromise.catch(() => {}); // observed again at the await below
      }

      if (conn === null) {
        patch({ phase: "requesting-bootstrap", stage: "waking the daemon" });
        conn = await deps.host.getConnection();
        mark("vf:renderer:fieldd-ready");
      }
      if (client === null) {
        patch({ phase: "connecting-fieldd", stage: "waking the daemon" });
        client = deps.makeClient(conn);
      }
      if (mod === null) {
        patch({ stage: "loading the field" });
        try {
          mod = await workspacePromise;
        } catch (error) {
          workspacePromise = null; // a failed fetch must not poison retry
          throw error;
        }
      }

      if (ready === null) {
        patch({ phase: "opening-document", stage: "opening doc", progress: 0 });
        const manager = new mod.DocManager(client);
        ready = { client, manager, mod };
        mark("vf:renderer:document-ready");
        for (const fn of [...listeners]) fn(); // BootRoot mounts the workspace under the splash
      }

      // warming: the B4 per-doc pipeline (fetch → restore → previews) IS the
      // warm gate — pass its honest stages through until phase "ready"
      patch({ phase: "warming" });
      const manager = ready.manager;
      await new Promise<void>((resolve) => {
        const sync = (): void => {
          const s = manager.getState();
          if (s.phase === "ready") {
            unsub();
            resolve();
            return;
          }
          if (s.loading !== null) {
            patch({ stage: s.loading.stage, progress: s.loading.progress });
          }
        };
        const unsub = manager.subscribe(sync);
        sync();
      });
      mark("vf:renderer:warm-end");

      // stabilizing: N consecutive clean frames, capped — reveal never hangs
      // on a weak GPU and never fires mid-hitch (design-03 §4.3 v0.3)
      patch({ phase: "stabilizing", stage: "settling", progress: 1 });
      const degraded = await stabilize();
      mark("vf:renderer:stable");
      if (degraded) console.warn("[boot] stability cap hit — degraded reveal");

      patch({ phase: "interactive", stage: "", degradedReveal: degraded });
      mark("vf:renderer:interactive");
    } catch (error) {
      patch({
        unavailable: {
          phase: view.phase,
          reason: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      });
    } finally {
      running = false;
    }
  }

  function stabilize(): Promise<boolean> {
    const hidden = deps.isHidden ?? (() => typeof document !== "undefined" && document.hidden);
    if (hidden()) return Promise.resolve(false); // nothing to judge; not degraded
    return new Promise((resolve) => {
      const budget = deps.frameBudgetMs ?? FRAME_BUDGET_MS;
      const need = deps.stableFrames ?? STABLE_FRAMES;
      let last = now();
      let streak = 0;
      let settled = false;
      const cap = setTimeout(() => {
        settled = true;
        resolve(true);
      }, deps.stabilityCapMs ?? STABILITY_CAP_MS);
      const tick = (): void => {
        if (settled) return;
        const t = now();
        streak = t - last <= budget ? streak + 1 : 0;
        last = t;
        if (streak >= need) {
          settled = true;
          clearTimeout(cap);
          resolve(false);
          return;
        }
        raf(tick);
      };
      raf(tick);
    });
  }

  return {
    view: () => view,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    get ready() {
      return ready;
    },
    get client() {
      return client;
    },
    start: () => {
      if (started) return;
      started = true;
      void run();
    },
    retry: () => {
      if (view.unavailable === null) return;
      void run();
    },
  };
}
