import { contextBridge } from "electron";

// Placeholder capability for the composition slice. It is deliberately data,
// not raw Electron IPC; the closed publish/status API replaces it with the
// transport slice.
contextBridge.exposeInMainWorld(
  "vibefieldStudio",
  Object.freeze({ environment: "electron", livePreviewAvailable: false }),
);
