import type { SurfaceDemandIntent } from "../pool";

type Wake = () => void;
interface Timers {
  set(fn: Wake, ms: number): unknown;
  clear(handle: unknown): void;
}

interface Face {
  readonly wake: Wake;
  readonly simulator: boolean;
  arrived: number;
  woke: number;
}

const PREVIEW_PERIOD_MS = 1000 / 30;
const MAX_WAIT_MS = 12;
const CADENCE_SLACK_MS = 2;

/** Share desk redraws between independently clocked moving previews when a simulator is present. */
export function previewFrameBatch(
  timers: Timers,
  now: () => number,
  enabled: () => boolean = () => true,
  minimumMovingSimulators = 1,
) {
  const simulators = new Set<Face>();
  const active = new Set<Face>();
  const pending = new Set<Face>();
  let timer: unknown = null;
  let deadline = Infinity;

  const flush = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
    deadline = Infinity;
    const at = now();
    for (const face of [...pending]) {
      // A preceding callback may have closed another face.
      if (!pending.delete(face)) continue;
      face.woke = at;
      try {
        face.wake();
      } catch {
        // Match the frame transport's observer isolation across wakes in the same task.
      }
    }
  };
  const forget = (face: Face) => {
    active.delete(face);
    const owed = pending.delete(face);
    if (
      timer !== null &&
      (simulators.size < minimumMovingSimulators || active.size < 2 || pending.size === 0)
    )
      flush();
    face.woke = -Infinity;
    return owed;
  };

  return (source: "ios-simulator" | "browser", wake: Wake) => {
    const face: Face = {
      wake,
      simulator: source === "ios-simulator",
      arrived: -Infinity,
      woke: -Infinity,
    };
    let eligible = false;
    return {
      demand(intent: Pick<SurfaceDemandIntent, "mode" | "targetFps" | "interactive">) {
        eligible = intent.mode === "live" && !intent.interactive && intent.targetFps === 30;
        if (face.simulator && eligible) simulators.add(face);
        if (!eligible) {
          simulators.delete(face);
          if (forget(face)) wake();
        }
      },
      frame() {
        if (!eligible || simulators.size < minimumMovingSimulators || !enabled()) {
          if (active.has(face)) forget(face);
          wake();
          return;
        }
        const at = now();
        face.arrived = at;
        active.add(face);
        if (active.size === 1) {
          face.woke = at;
          wake();
          return;
        }
        pending.add(face);
        let movingSimulators = 0;
        let waitingForPeer = false;
        for (const peer of active) {
          const elapsed = at - peer.arrived;
          if (elapsed > 1.5 * PREVIEW_PERIOD_MS) {
            active.delete(peer);
            continue;
          }
          if (peer.simulator) movingSimulators++;
          // If the peer just delivered, its next frame cannot share this bounded wait.
          // This also lets a trailing arrival join a redraw already scheduled by the leader.
          if (!pending.has(peer) && PREVIEW_PERIOD_MS - elapsed <= MAX_WAIT_MS)
            waitingForPeer = true;
        }
        // Gradually align independent phases. Once a face is due, an absent peer cannot add another wait.
        const due = Math.min(at + MAX_WAIT_MS, face.woke + PREVIEW_PERIOD_MS + CADENCE_SLACK_MS);
        if (movingSimulators < minimumMovingSimulators || !waitingForPeer || due <= at) {
          flush();
        } else if (due < deadline) {
          if (timer !== null) timers.clear(timer);
          deadline = due;
          timer = timers.set(flush, due - at);
        }
      },
      close() {
        eligible = false;
        simulators.delete(face);
        forget(face);
      },
    };
  };
}
