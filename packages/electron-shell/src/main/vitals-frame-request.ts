import { VITALS_CAPTURE_CHANNELS, VITALS_CAPTURES } from "@vibefield/contracts/registries";
import type { VitalsCaptureSeconds, VitalsFrameCountRequest } from "@vibefield/contracts/vitals";
import { VitalsFrameCountReply } from "@vibefield/contracts/vitals";
import type { DeskFramesAnswer } from "./vitals-capture";

// VT-5 (track VT, 2026-11-24; VT-D9) — main asks the desk's window to count its own frames for a capture's length,
// the way the durable close asks it to drain (close.ts): one request id, the reply taken from that window alone, the
// window's going a cut-short count, and a wait that cannot outlive the length by more than its grace. The counting is
// the desk window's preload's (`preload/vitals-frame-count.ts`): no page code runs and no script is injected.

/** The part of a WebContents used here. */
export interface FrameCountContents {
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): void;
  off(event: "destroyed", listener: () => void): void;
}

/** The part of `ipcMain` used here. */
export interface FrameCountIpc {
  on(channel: string, listener: (event: { sender: unknown }, raw: unknown) => void): void;
  off(channel: string, listener: (event: { sender: unknown }, raw: unknown) => void): void;
}

export function createDeskFrameRequester(opts: {
  /** the desk window's contents now, or null while it has none */
  desk(): FrameCountContents | null;
  ipc: FrameCountIpc;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}): (seconds: VitalsCaptureSeconds) => Promise<DeskFramesAnswer> {
  const setTimer =
    opts.setTimer ??
    ((fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms);
      timer.unref();
      return timer;
    });
  const clearTimer =
    opts.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let sequence = 0;

  return (seconds) =>
    new Promise<DeskFramesAnswer>((resolve) => {
      const contents = opts.desk();
      if (contents === null || contents.isDestroyed()) {
        resolve({ ok: false, reason: "no-desk" });
        return;
      }
      sequence += 1;
      const requestId = `vitals-frames:${sequence}`;
      let done = false;
      const finish = (answer: DeskFramesAnswer): void => {
        if (done) return;
        done = true;
        clearTimer(timer);
        opts.ipc.off(VITALS_CAPTURE_CHANNELS.frameCountResult, onReply);
        contents.off("destroyed", onGone);
        resolve(answer);
      };
      const onReply = (event: { sender: unknown }, raw: unknown): void => {
        // the desk window's own answer to this request, and nobody else's
        if (event.sender !== contents) return;
        const reply = VitalsFrameCountReply.safeParse(raw);
        if (!reply.success || reply.data.requestId !== requestId) return;
        if (reply.data.count !== undefined) finish({ ok: true, count: reply.data.count });
        else finish({ ok: false, reason: reply.data.refused === "busy" ? "busy" : "cut-short" });
      };
      const onGone = (): void => finish({ ok: false, reason: "cut-short" });
      const timer = setTimer(
        () => finish({ ok: false, reason: "cut-short" }),
        seconds * 1_000 + VITALS_CAPTURES.REPLY_GRACE_MS,
      );
      opts.ipc.on(VITALS_CAPTURE_CHANNELS.frameCountResult, onReply);
      contents.once("destroyed", onGone);
      try {
        contents.send(VITALS_CAPTURE_CHANNELS.frameCount, {
          requestId,
          seconds,
        } satisfies VitalsFrameCountRequest);
      } catch {
        finish({ ok: false, reason: "no-desk" });
      }
    });
}
