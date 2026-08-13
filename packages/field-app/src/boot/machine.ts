import type { FielddClient } from "@vibefield/fieldd-client";
import type { DocManager } from "../doc-manager";
import type { FieldHost, FieldUserProfile } from "../host";
import type { PreparedRendererPlugins } from "../plugin-host/staged-loader";

// The boot machine (ESR §5.4.2; design-03 §4.3 v0.3): explicit states, no
// scattered nullable globals. Framework-free — BootRoot renders it via
// useSyncExternalStore; tests drive it with a fake host and injected
// raf/now/mark. The reveal law lives here: `interactive` fires only after the
// document is fully warm (DocManager phase "ready" — the B4 pipeline includes
// previews) AND the frame-stability gate passes or its bounded cap forces a
// logged degraded reveal.
//
// UA-3w adds ONE optional hold to that line — the §6 Setup Assistant, entered
// only when a readable profile says `onboarded: false`. It is a hold, not a
// door: it sits between a warm daemon and an open document, and every way of
// failing to read the flag proceeds rather than stops (W5 — the wizard ends
// inside the product, so the product must be able to start without it).

export type WorkspaceModule = typeof import("../workspace");

export type BootPhase =
  | "requesting-bootstrap"
  | "connecting-fieldd"
  | "onboarding"
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
  /** P8b-3 — the staged plugin set, resolved BEFORE the workspace mounts. The
   * registry is built synchronously in a memo, so this is the last moment an
   * import can still happen; after this the set is fixed for the mount. */
  plugins: PreparedRendererPlugins;
}

/** What the wizard is handed while the boot holds for it (UA-3w). The profile
 * is the record the gate actually read — the wizard derives its entry pane from
 * those durable fields (W6) rather than from any remembered position.
 * `stagesDone` is the honest list of stage labels this boot already passed, so
 * the setting-up pane can name real work instead of drawing a fake bar (W4). */
export interface BootOnboarding {
  profile: FieldUserProfile;
  stagesDone: readonly string[];
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
  /** Non-null exactly while `view().phase === "onboarding"`. Set BEFORE the
   * phase patch that notifies subscribers, so a render triggered by that patch
   * reads a matching pair (the `ready` precedent). */
  readonly onboarding: BootOnboarding | null;
  /** idempotent; called after the first paint (mount schedules it on rAF) */
  start(): void;
  /** re-runs from the failed step; no-op unless unavailable */
  retry(): void;
  /** UA-3w — the wizard is finished; release the hold and boot on. Idempotent,
   * and inert when nothing is holding. The wizard calls it only after the
   * durable `onboarded` write lands, so a later retry() re-reads a record that
   * skips the phase on its own — no "already shown" bit is kept anywhere. */
  completeOnboarding(): void;
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
  // Every stage label this boot actually entered, in order — the wizard's
  // setting-up pane names these (W4) rather than inventing a progress story.
  const stagesSeen: string[] = [view.stage];
  const patch = (next: Partial<BootView>): void => {
    view = { ...view, ...next };
    const stage = next.stage;
    if (stage !== undefined && stage !== "" && stagesSeen[stagesSeen.length - 1] !== stage) {
      stagesSeen.push(stage);
    }
    for (const fn of [...listeners]) fn();
  };

  // resumable checkpoints — retry() re-enters run() and completed steps skip
  let workspacePromise: Promise<WorkspaceModule> | null = null;
  let pluginsPromise: Promise<PreparedRendererPlugins> | null = null;
  let conn: { port: number; token: string } | null = null;
  let client: FielddClient | null = null;
  let mod: WorkspaceModule | null = null;
  let ready: BootReady | null = null;
  let running = false;
  let started = false;
  let onboarding: BootOnboarding | null = null;
  let releaseOnboarding: (() => void) | null = null;

  /** The §6 gate (UA-3w). The ONE outcome that opens the wizard is a record
   * this build can read that says `onboarded: false`. Everything else — no
   * supervisor bridge, a rejected read, a shape this build cannot make sense
   * of — proceeds with the phase skipped and a line in the log. The wizard is
   * never allowed to be the reason the app fails to start. */
  async function onboardingProfile(): Promise<FieldUserProfile | null> {
    const usersUpdate = deps.host.usersUpdate;
    if (usersUpdate === undefined) return null;
    const log = deps.host.logger.child({ component: "boot" });
    try {
      // The empty update is the READ (host.ts) — the same door that writes.
      const record: unknown = await usersUpdate({});
      if (typeof record !== "object" || record === null) {
        log.warn(
          "renderer.boot.onboarding_skipped",
          "The supervisor answered the profile read with something that is not a record",
        );
        return null;
      }
      const profile = record as FieldUserProfile;
      if (typeof profile.onboarded !== "boolean") {
        log.warn(
          "renderer.boot.onboarding_skipped",
          "The profile record carries no readable onboarded flag",
        );
        return null;
      }
      if (deps.host.forceOnboarding === true) {
        log.info(
          "renderer.boot.onboarding_forced",
          "Opening a fresh setup wizard because the development preview mode is enabled",
        );
        // Project a fresh-user view for this boot only. Omitting color and
        // setupVariant makes the assistant begin at Welcome even when the
        // durable account has already completed onboarding.
        return {
          userId: profile.userId,
          fuid: profile.fuid,
          name: profile.name,
          resident: profile.resident,
          onboarded: false,
        };
      }
      return profile.onboarded ? null : profile;
    } catch (error) {
      log.warn("renderer.boot.onboarding_skipped", "The supervisor refused the profile read", {
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

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

      // P8b-3 — the staged plugin load STARTS here and is awaited below, just
      // before the document opens. Started early so it overlaps the onboarding
      // hold and costs a cold boot nothing; awaited late because the registry
      // is built synchronously the moment the workspace mounts. It never
      // rejects (the loader's own budget answers for an absent daemon), so
      // there is nothing here that can strand the splash.
      if (pluginsPromise === null) {
        const prepareClient = client;
        pluginsPromise = mod.prepareFieldPlugins({
          request: async (method, params) => await prepareClient.request(method, params),
        });
      }

      // UA-3w — the Setup Assistant holds HERE: after the daemon answered and
      // the workspace chunk landed (so the wizard's setting-up pane names two
      // finished stages, not two hopeful ones) and before the document opens
      // (so it owns the window, and the field it hands you is the one it just
      // named). The gate re-reads the record on every pass through run(): once
      // the wizard flips the flag, a retry derives "already onboarded" from
      // disk instead of trusting a bit this machine remembered.
      if (ready === null) {
        const profile = await onboardingProfile();
        if (profile !== null) {
          onboarding = { profile, stagesDone: [...stagesSeen] };
          patch({ phase: "onboarding", stage: "", progress: null });
          await new Promise<void>((resolve) => {
            releaseOnboarding = resolve;
          });
          releaseOnboarding = null;
          onboarding = null;
        }
      }

      if (ready === null) {
        patch({ phase: "opening-document", stage: "staging plugins" });
        const plugins = await pluginsPromise;
        patch({ stage: "opening doc", progress: 0 });
        const manager = new mod.DocManager(client);
        ready = { client, manager, mod, plugins };
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
      if (degraded) {
        deps.host.logger
          .child({ component: "boot" })
          .warn(
            "renderer.boot.stability_cap_reached",
            "The renderer used the bounded degraded reveal path",
          );
      }

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
    get onboarding() {
      return onboarding;
    },
    completeOnboarding: () => {
      releaseOnboarding?.();
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
