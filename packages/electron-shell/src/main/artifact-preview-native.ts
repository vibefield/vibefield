import { BrowserWindow, nativeImage, session } from "electron";
import type { ArtifactPreviewCaptureNative } from "./artifact-preview-capture";

/** AH-4's capture on the real Electron: one in-memory session per capture (no disk cache), and a hidden, unfocusable
 * window that paints while hidden. Main's own capture takes it, and so does item 378's probe
 * (`testing/capture-webrtc-probe.ts`), so the probe measures the window that ships, never a copy of it. */
export function electronArtifactPreviewNative(): ArtifactPreviewCaptureNative {
  return {
    createSession: (partition) => session.fromPartition(partition, { cache: false }),
    createWindow: ({ width, height, partition, webPreferences }) =>
      new BrowserWindow({
        show: false,
        frame: false,
        focusable: false,
        resizable: false,
        skipTaskbar: true,
        width,
        height,
        useContentSize: true,
        paintWhenInitiallyHidden: true,
        webPreferences: {
          partition,
          ...webPreferences,
          experimentalFeatures: false,
          spellcheck: false,
          backgroundThrottling: false,
        },
      }),
    decodeImage: (bytes) => nativeImage.createFromBuffer(bytes),
  };
}
