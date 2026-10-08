import { vi } from "vitest";
import type { VirtualTime } from "./model-stream";

// The virtual clock the model stream is computed on (MV-3c): vitest's fake
// timers at a recipe's `baseWall`, faking exactly what fieldd's code reads —
// `Date`, the timeouts and the intervals (the floors, the backend's tick and
// clock, the relay's sweep, the heartbeat). Microtasks stay real and run
// between timers (`advanceTimersByTimeAsync`), as they do in a daemon.

export async function withVirtualTime<T>(
  baseWall: number,
  run: (time: VirtualTime) => Promise<T>,
): Promise<T> {
  vi.useFakeTimers({
    toFake: [
      "Date",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "setImmediate",
      "clearImmediate",
    ],
    now: baseWall,
  });
  try {
    return await run({
      advance: async (ms) => {
        await vi.advanceTimersByTimeAsync(ms);
      },
      now: () => Date.now(),
    });
  } finally {
    vi.useRealTimers();
  }
}
