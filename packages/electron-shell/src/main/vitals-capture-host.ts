import { chmod, mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LAYOUT, VITALS_CAPTURE_CHANNELS } from "@vibefield/contracts/registries";
import type { Logger } from "@vibefield/logging";
import { contentTracing, ipcMain, shell, type WebContents } from "electron";
import { type CaptureFieldd, VitalsCaptures } from "./vitals-capture";
import { installVitalsCaptureIpc } from "./vitals-capture-ipc";
import { createDeskFrameRequester } from "./vitals-frame-request";

// VT-5 (track VT, 2026-11-24) — the armed captures, wired to Electron: `contentTracing` for the trace, the desk
// window's preload for the count, fieldd's door for the profile, `shell.showItemInFolder` to show a file, and the
// user's own root for the folder. `vitals.ts` holds one of these beside the window.

export interface VitalsCaptureHost {
  /** the Vitals window went: a running trace or count is stopped and not saved */
  cut(): void;
  dispose(): void;
}

export function installVitalsCaptures(opts: {
  /** the attached user's root now, or null while there is none */
  userRoot(): string | null;
  /** the Vitals window's own WebContents now */
  vitalsContents(): WebContents | null;
  /** the desk window's WebContents now */
  deskContents(): WebContents | null;
  fieldd(): CaptureFieldd | null;
  logger: Logger;
}): VitalsCaptureHost {
  const captures = new VitalsCaptures({
    dir: () => {
      const root = opts.userRoot();
      return root === null ? null : join(root, ...LAYOUT.VITALS_CAPTURES_DIR);
    },
    tracing: contentTracing,
    fieldd: opts.fieldd,
    deskFrames: createDeskFrameRequester({ desk: opts.deskContents, ipc: ipcMain }),
    files: {
      mkdir: async (path) => {
        await mkdir(path, { recursive: true, mode: 0o700 });
      },
      writeFile: (path, text) => writeFile(path, text, { mode: 0o600 }),
      chmod: (path, mode) => chmod(path, mode),
      rename: (from, to) => rename(from, to),
      size: async (path) => (await stat(path)).size,
      readdir: (path) => readdir(path),
      unlink: (path) => unlink(path),
    },
    onState: (state) => {
      const contents = opts.vitalsContents();
      if (contents !== null && !contents.isDestroyed()) {
        contents.send(VITALS_CAPTURE_CHANNELS.state, state);
      }
    },
    logger: opts.logger,
  });
  const stopIpc = installVitalsCaptureIpc({
    ipc: ipcMain,
    isVitalsWindow: (event) => {
      const contents = opts.vitalsContents();
      const sent = event as { sender?: unknown; senderFrame?: { parent?: unknown } | null };
      // the window main made, and its own main frame: never a frame inside it
      return contents !== null && sent.sender === contents && sent.senderFrame?.parent === null;
    },
    captures,
    reveal: (path) => shell.showItemInFolder(path),
  });
  return {
    cut: () => captures.cut(),
    dispose: () => {
      captures.dispose();
      stopIpc();
    },
  };
}
