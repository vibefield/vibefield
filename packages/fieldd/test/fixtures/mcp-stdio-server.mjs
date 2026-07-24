#!/usr/bin/env node
// Tiny fixture MCP server for McpService's consume tests. Speaks newline-
// delimited JSON-RPC 2.0 on stdin/stdout (one message per line — MCP stdio
// framing). Answers `initialize`, ignores `notifications/initialized`, lists a
// single `add` tool, and evaluates `tools/call add`. `--crash-after-init` makes
// it exit(1) right after replying to initialize (the start-failure path); the
// reply is flushed first so the client reliably sees the result before EOF.
import process from "node:process";

const crashAfterInit = process.argv.includes("--crash-after-init");

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let idx;
  // biome-ignore lint/suspicious/noAssignInExpressions: canonical newline-split loop
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (line.trim()) handle(line);
  }
});

function send(msg, then) {
  process.stdout.write(`${JSON.stringify(msg)}\n`, then);
}

function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // tolerant: garbage never fatal
  }
  const { id, method, params } = msg;
  if (method === "initialize") {
    const reply = {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "0.0.1" },
      },
    };
    if (crashAfterInit) {
      send(reply, () => process.exit(1));
      return;
    }
    send(reply);
    return;
  }
  if (method === "notifications/initialized") return; // notification: no reply
  if (method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "add",
            title: "Add",
            description: "adds two numbers",
            inputSchema: {
              type: "object",
              properties: { a: { type: "number" }, b: { type: "number" } },
              required: ["a", "b"],
            },
          },
        ],
      },
    });
    return;
  }
  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (name === "add") {
      send({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: String(Number(args.a) + Number(args.b)) }] },
      });
      return;
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown tool ${name}` } });
    return;
  }
  if (id !== undefined && id !== null)
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
}
