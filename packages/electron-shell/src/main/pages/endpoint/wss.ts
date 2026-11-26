// EY-1 (7b, 2026-11-19) — the bridge's WebSocket server as the product makes it: `ws` in noServer mode, its frame cap
// set by the caller (server.ts). The ONE module of the pages plane that imports `ws`.

import { WebSocketServer } from "ws";
import type { BridgeServerDeps } from "./server";

export const makeBridgeWss: BridgeServerDeps["makeWss"] = (o) => new WebSocketServer(o);
