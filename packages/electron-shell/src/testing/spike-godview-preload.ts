import { forwardGhostteaRendererPorts } from "@vibecook/ghosttea-electron/preload";
import { ipcRenderer } from "electron";
import "../preload/index";

// GT-0 spike preload (test-only, like everything in this directory): the
// PRODUCT preload verbatim — imported for its side effects so the spike window
// is a real shell window — plus the one thing the product bridge has no reason
// to carry yet.
//
// That one thing is unavoidable. ghosttea-electron transfers the control and
// frame MessagePorts with `webContents.postMessage`, which lands on
// `ipcRenderer` in the isolated world; `waitForGhostteaRendererPorts` listens
// for a `window` message in the MAIN world. Only a preload spans those two
// worlds, and re-posting the ports is the whole of its job here.
forwardGhostteaRendererPorts(ipcRenderer);
