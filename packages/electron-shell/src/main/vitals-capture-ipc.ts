import { VITALS_CAPTURE_CHANNELS } from "@vibefield/contracts/registries";
import type {
  VitalsCaptureArmResult,
  VitalsCaptureRevealResult,
  VitalsCaptureState,
} from "@vibefield/contracts/vitals";
import type { VitalsCaptures } from "./vitals-capture";

// VT-5 (track VT, 2026-11-24) — the captures' three doors in main, for the Vitals window alone: its main frame, in
// the window main made (`isVitalsWindow`). Anyone else is answered as if nothing were there. What the page sends is
// read by `VitalsCaptures` against the contracts' closed lists, and a file is shown by a name joined to the captures
// folder here, never by a path from the page.

export interface CaptureIpcMain {
  handle(channel: string, handler: (event: unknown, raw?: unknown) => unknown): void;
  removeHandler(channel: string): void;
}

export function installVitalsCaptureIpc(opts: {
  ipc: CaptureIpcMain;
  /** whether an invoke came from the Vitals window's own main frame */
  isVitalsWindow(event: unknown): boolean;
  captures: Pick<VitalsCaptures, "arm" | "current" | "revealPath">;
  /** Electron's `shell.showItemInFolder` */
  reveal(path: string): void;
}): () => void {
  const idle: VitalsCaptureState = { state: "idle" };
  opts.ipc.handle(
    VITALS_CAPTURE_CHANNELS.current,
    (event): VitalsCaptureState => (opts.isVitalsWindow(event) ? opts.captures.current() : idle),
  );
  opts.ipc.handle(
    VITALS_CAPTURE_CHANNELS.arm,
    (event, raw): VitalsCaptureArmResult =>
      opts.isVitalsWindow(event)
        ? opts.captures.arm(raw)
        : { accepted: false, reason: "not-started" },
  );
  opts.ipc.handle(VITALS_CAPTURE_CHANNELS.reveal, (event, raw): VitalsCaptureRevealResult => {
    if (!opts.isVitalsWindow(event)) return { revealed: false };
    const path = opts.captures.revealPath(raw);
    if (path === null) return { revealed: false };
    try {
      opts.reveal(path);
      return { revealed: true };
    } catch {
      return { revealed: false };
    }
  });
  return () => {
    opts.ipc.removeHandler(VITALS_CAPTURE_CHANNELS.current);
    opts.ipc.removeHandler(VITALS_CAPTURE_CHANNELS.arm);
    opts.ipc.removeHandler(VITALS_CAPTURE_CHANNELS.reveal);
  };
}
