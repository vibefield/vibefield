import { mountFieldApp } from "@vibefield/field-app";
import { createRendererLoggingClient } from "./renderer-logger";

// The one Electron-specific renderer adapter (ESR §5.2.5): read the preload
// global, adapt it to FieldHost, mount. It knows nothing about ICE, documents,
// plugins, or HUD — the field app is a black box behind its public entry.

const root = document.getElementById("root");
if (root === null) throw new Error("renderer host: #root missing from index.html");

const logging = createRendererLoggingClient({
  send: (serializedBatch) => window.vibefield.submitRendererLogs(serializedBatch),
});
window.addEventListener("pagehide", () => logging.close(), { once: true });

mountFieldApp({
  container: root,
  host: {
    logger: logging.logger,
    getConnection: () => window.vibefield.getConnection(),
    onPrepareClose: (handler) => window.vibefield.onPrepareClose(handler),
    completeClose: (result) => window.vibefield.completeClose(result),
  },
});
