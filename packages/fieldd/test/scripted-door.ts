// A peer door that speaks the product hello and hands every other request to
// a script — enough to decide, from a caller's side, whether a forward left,
// was answered, or lost its answer (DS-2), and what the door last said (DS-L8).
// `hello` overrides the hello reply (an INCOMPATIBLE door, say).
import type { AddressInfo } from "node:net";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { type WebSocket, WebSocketServer } from "ws";

export interface ScriptedMessage {
  id: number;
  method: string;
  params: unknown;
}

export interface ScriptedDoor {
  url: string;
  seen: Array<{ method: string; params: Record<string, unknown> }>;
  close(): Promise<void>;
}

export async function scriptedDoor(
  script: (msg: ScriptedMessage, ws: WebSocket, n: number) => void,
  opts: { hello?: (msg: ScriptedMessage, ws: WebSocket) => void } = {},
): Promise<ScriptedDoor> {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
  const seen: ScriptedDoor["seen"] = [];
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as ScriptedMessage;
      if (msg.method === "system.hello") {
        if (opts.hello !== undefined) {
          opts.hello(msg, ws);
          return;
        }
        answer(ws, msg.id, {
          contractsVersion: CONTRACTS_VERSION,
          serverKind: "fieldd",
          grantedScopes: [],
        });
        return;
      }
      seen.push({ method: msg.method, params: msg.params as Record<string, unknown> });
      script(msg, ws, seen.length);
    });
  });
  const port = (wss.address() as AddressInfo).port;
  return {
    url: `ws://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}

export function answer(ws: WebSocket, id: number, result: unknown): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

export function refuse(
  ws: WebSocket,
  id: number,
  error: { code: number; message: string; kind: string; retryable?: boolean; details?: unknown },
): void {
  ws.send(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: {
        code: error.code,
        message: error.message,
        data: {
          kind: error.kind,
          retryable: error.retryable ?? false,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
    }),
  );
}
