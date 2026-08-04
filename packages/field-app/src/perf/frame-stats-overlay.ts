import { type FrameStatsHandle, type FrameStatsSample, startFrameStats } from "./frame-stats";
import "./frame-stats-overlay.css";

// The app-level FPS readout. Deliberately NOT a React component and deliberately
// not mounted inside the app tree:
//
//   - it must survive every remount the tree does — the canvas stack remounts on
//     doc generation, the Godview monitor unmounts on close (PF6) — and an
//     instrument that dies with the thing it is measuring is no instrument;
//   - React reconciliation at 4Hz over a live canvas is exactly the kind of cost
//     this readout exists to find, so it writes `textContent` through held refs
//     and never re-renders anything.
//
// It follows the drag region's precedent in `mount.tsx`: a plain node appended
// to the body, owned by the module that made it.

const STORAGE_KEY = "vf-frame-stats-visible-v1";

/** ⌘⌥⇧F — clear of ⌘K (palette), ⌘1/2/3 (Godview status), and plain `c`. */
function isToggleChord(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.altKey &&
    event.shiftKey &&
    (event.key === "f" || event.key === "F" || event.code === "KeyF")
  );
}

function readPersisted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persist(visible: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, visible ? "true" : "false");
  } catch {
    // A disabled storage partition should not disable the instrument.
  }
}

const VERDICT_LABEL: Record<FrameStatsSample["verdict"], string> = {
  healthy: "HEALTHY",
  "main-thread": "MAIN THREAD — JS",
  "off-main-thread": "OFF MAIN — GPU/COMPOSITE",
  unknown: "CAUSE UNKNOWN",
};

export interface FrameStatsOverlayHandle {
  show(): void;
  hide(): void;
  toggle(): boolean;
  destroy(): void;
}

export function mountFrameStatsOverlay(
  container: HTMLElement = document.body,
): FrameStatsOverlayHandle {
  const root = document.createElement("div");
  root.className = "vf-frame-stats";
  root.setAttribute("aria-hidden", "true");
  root.hidden = true;

  const fps = document.createElement("strong");
  fps.className = "vf-frame-stats-fps";
  fps.textContent = "—";

  const refresh = document.createElement("span");
  refresh.className = "vf-frame-stats-refresh";

  const head = document.createElement("div");
  head.className = "vf-frame-stats-head";
  head.append(fps, refresh);

  const frames = document.createElement("div");
  frames.className = "vf-frame-stats-row";

  const drops = document.createElement("div");
  drops.className = "vf-frame-stats-row";

  const verdict = document.createElement("div");
  verdict.className = "vf-frame-stats-verdict";

  const hint = document.createElement("div");
  hint.className = "vf-frame-stats-hint";
  hint.textContent = "⌘⌥⇧F";

  root.append(head, frames, drops, verdict, hint);
  container.append(root);

  let stats: FrameStatsHandle | null = null;
  let visible = false;

  const paint = (sample: FrameStatsSample): void => {
    fps.textContent = sample.fps.toFixed(0);
    refresh.textContent = sample.refreshHz === null ? "· detecting" : `· ${sample.refreshHz}Hz`;
    frames.textContent = `${sample.frameMs.p50.toFixed(1)} / ${sample.frameMs.p95.toFixed(
      1,
    )} / ${sample.frameMs.worst.toFixed(1)} ms`;

    // Blocking reads "n/a" rather than 0 when LoAF cannot be observed: a zero
    // here would claim the main thread was clean, which is a different fact
    // from not having looked.
    const blocking = sample.blockingMs === null ? "n/a" : `${sample.blockingMs.toFixed(0)}ms`;
    drops.textContent = `${sample.dropped} dropped · block ${blocking}`;

    verdict.textContent = VERDICT_LABEL[sample.verdict];
    root.dataset.verdict = sample.verdict;
  };

  const show = (): void => {
    if (visible) return;
    visible = true;
    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    // The rAF loop is itself load — it only runs while something is reading it.
    stats = startFrameStats({ onSample: paint });
    persist(true);
  };

  const hide = (): void => {
    if (!visible) return;
    visible = false;
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    stats?.stop();
    stats = null;
    persist(false);
  };

  const toggle = (): boolean => {
    if (visible) hide();
    else show();
    return visible;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isToggleChord(event)) return;
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };
  window.addEventListener("keydown", onKeyDown, true);

  if (readPersisted()) show();

  const handle: FrameStatsOverlayHandle = {
    show,
    hide,
    toggle,
    destroy(): void {
      hide();
      window.removeEventListener("keydown", onKeyDown, true);
      root.remove();
    },
  };

  // Console access, so the readout can be driven from DevTools while a chord is
  // being swallowed by a focused terminal pane.
  (globalThis as { __vfFrameStats?: FrameStatsOverlayHandle }).__vfFrameStats = handle;

  return handle;
}
