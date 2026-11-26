// EY-1 (1e, 2026-11-19) — THE PAGE ENGINE'S TESTING KILL, the test Mac's alone: 1i's daemon-kill
// cases end a run's engine as a crash would. Main makes it only when it started with the smoke's
// run mark AND its own `--pages-daemon-kill` flag (pagesDaemonKillAsked, pages/broker/index.ts),
// and hands it to 1i's in-process adapter alone; no control call or door reaches it. It holds each
// run's engine child through the supervisor's `onSpawned` hook, which production never passes, and
// signals that child alone: `child.kill`, never a pid read from a file, never process.kill. Its
// answer names the child by a salted hash of its pid, so the pid itself never leaves main.

import { createHash, randomBytes } from "node:crypto";
import type { EngineChild } from "../main/pages/broker/engine-supervisor";

export interface PagesEngineKill {
  /** The supervisor's hook: the run's newest engine child, held until that child's exit. */
  readonly onSpawned: (run: string, generation: number, child: EngineChild) => void;
  /** Signals the run's held engine child alone; null when the run holds none (none started, or
   * its child has exited). */
  killEngine(run: string, signal: "SIGTERM" | "SIGKILL"): { readonly pidHash: string } | null;
}

interface Held {
  readonly generation: number;
  readonly child: EngineChild;
  /** this child's own salt: its hash is the same at each kill, and names no other child */
  readonly salt: string;
}

export function createPagesEngineKill(o: { readonly salt?: () => string } = {}): PagesEngineKill {
  const salt = o.salt ?? (() => randomBytes(16).toString("hex"));
  const held = new Map<string, Held>();
  return {
    onSpawned(run, generation, child) {
      const entry: Held = { generation, child, salt: salt() };
      held.set(run, entry);
      const forget = () => {
        if (held.get(run) === entry) held.delete(run);
      };
      child.once("exit", forget);
      child.once("error", forget);
    },
    killEngine(run, signal) {
      const entry = held.get(run);
      if (entry === undefined) return null;
      entry.child.kill(signal);
      const pid = entry.child.pid ?? "none";
      return { pidHash: createHash("sha256").update(`${entry.salt}:${pid}`).digest("hex") };
    },
  };
}
