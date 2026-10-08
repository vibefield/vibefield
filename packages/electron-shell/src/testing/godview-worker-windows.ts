import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { BrowserWindow } from "electron";
import type { WindowRegistry } from "../main/window-policy";
import {
  type LabWindow,
  labWindowOptions,
  leave,
  openLabWindow,
  page,
  sleep,
  teardownLab,
} from "./godview-lab-window";

// THE ELECTRON 43 SIGTRAP PROBE, VibeField's (build-mv M14, M32; MV-5's
// deliverable 7). Twice in this program Electron 43's main process died with
// SIGTRAP when a window opened after another window — one whose page had run a
// dedicated worker — was destroyed. Since MV-5 the swarm's physics run in a
// worker the VIEW brings (MV-D7), in every window that shows Godview, so the
// risk is VibeField's own: close a window that ran it, open another, and the
// app must live. mv5-pu proved puppeteer's side; this is the same drive over
// VibeField's real product (main, the daemon pair, the renderer):
//
//   1. a lab window's swarm says its physics run in a WORKER (the view's
//      report, as the view host's slot mirrors it on ITS element — W5), and
//      still says so after the worker's proof-of-life deadline, so the worker
//      really loaded and was not demoted;
//   2. a second window opens and its swarm says the same;
//   3. the FIRST window — the one whose page ran the worker — is destroyed;
//   4. a third opens after it, worker again; then the newest is destroyed and
//      a fourth opens, worker again.
//
// Every window is the lab's (`godview-lab-window.ts`): offscreen by default,
// never shown, never focused, no OS input. A main process that dies between
// the steps comes back to `scripts/godview-worker-windows.mjs` as a signal.
//
// `VF_GODVIEW_LAB_RENDERER=dev` loads the renderer from the Vite dev server
// (`VITE_DEV_SERVER_URL`) instead of the packaged entry, so the same drive
// proves the worker loads as a module worker under the dev server too.

/** The toolkit's worker proof-of-life deadline is 4 s; a worker still reported past it said `ready`. */
const PAST_THE_WATCHDOG_MS = 5_000;
const STEP_MS = 60_000;

interface SlotState {
  view: string | null;
  physics: string | null;
  renderer: string | null;
}

const SLOT_STATE = `(() => {
  const slot = document.querySelector("[data-monitor-view-slot]");
  return slot === null
    ? null
    : {
        view: slot.getAttribute("data-monitor-view"),
        physics: slot.getAttribute("data-monitor-view-physics"),
        renderer: slot.getAttribute("data-monitor-view-renderer"),
      };
})()`;

async function slotState(win: BrowserWindow): Promise<SlotState | null> {
  try {
    return await page<SlotState | null>(win, SLOT_STATE);
  } catch {
    return null; // still loading, or torn down under us
  }
}

/** The window's swarm, once its physics say where they run; inline fails at once. */
async function swarmWorker(win: BrowserWindow, label: string): Promise<SlotState> {
  const deadline = Date.now() + STEP_MS;
  for (;;) {
    const state = await slotState(win);
    if (state?.view === "swarm" && state.physics === "inline") {
      throw new Error(`${label}: the swarm's physics ran inline — the worker did not load`);
    }
    if (state?.view === "swarm" && state.physics === "worker") return state;
    if (Date.now() > deadline) {
      throw new Error(`${label}: no swarm reporting its physics (last ${JSON.stringify(state)})`);
    }
    await sleep(250);
  }
}

export async function runGodviewWorkerWindows(opts: {
  handle: FielddHandle;
  supervisor: FielddSupervisor;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  viteUrl: string;
  beforeExit: () => Promise<void>;
  onWindow?: ((window: BrowserWindow) => void) | undefined;
}): Promise<void> {
  const say = (record: Record<string, unknown>): void => {
    process.stdout.write(`GODVIEW_WORKER_WINDOWS ${JSON.stringify(record)}\n`);
  };
  const options = labWindowOptions();
  const renderer = process.env["VF_GODVIEW_LAB_RENDERER"] === "dev" ? "dev" : "packaged";
  let opened = 0;
  let destroyed = 0;
  const windows: LabWindow[] = [];
  const open = async (): Promise<LabWindow> => {
    opened += 1;
    const label = `window ${opened}`;
    const lab = await openLabWindow({
      preloadPath: opts.preloadPath,
      viteUrl: opts.viteUrl,
      registry: opts.registry,
      role: opts.registry.primary() === null ? "primary" : "auxiliary",
      options,
      onWindow: opts.onWindow,
    });
    windows.push(lab);
    const first = await swarmWorker(lab.win, label);
    await sleep(PAST_THE_WATCHDOG_MS);
    const settled = await swarmWorker(lab.win, label);
    say({ kind: "window", n: opened, renderer, profile: lab.profile, first, settled });
    return lab;
  };
  const destroy = async (lab: LabWindow, n: number): Promise<void> => {
    lab.win.destroy();
    const deadline = Date.now() + STEP_MS;
    while (!lab.win.isDestroyed()) {
      if (Date.now() > deadline) throw new Error(`window ${n} was never destroyed`);
      await sleep(100);
    }
    destroyed += 1;
    say({ kind: "destroyed", n });
  };

  let code = 0;
  try {
    say({ kind: "start", renderer, window: options, electron: process.versions.electron });
    const first = await open();
    const second = await open();
    // the window whose page ran the worker goes…
    await destroy(first, 1);
    // …and another opens after it (the M14 risk): its swarm runs in a worker too
    const third = await open();
    // the other way round: the newest goes, the older stays, another opens
    await destroy(third, 3);
    await open();
    say({ kind: "ok", opened, destroyed, alive: !second.win.isDestroyed() });
  } catch (error) {
    code = 1;
    say({ kind: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    for (const lab of windows) if (!lab.win.isDestroyed()) lab.win.destroy();
    await teardownLab(opts);
    leave(code);
  }
}
