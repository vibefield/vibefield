// A real terminal child runs the briefing's bridge. Its caller identity must come from the floor's process walk.
// The briefing file may name the calls to make (CP-3), in order; absent, one agents_list. With `typed`, what the
// terminal hands the process (an input fieldd's queue delivered) is kept there.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const {
  server,
  output,
  calls = [{ name: "agents_list", arguments: {} }],
  typed,
} = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (typed) process.stdin.on("data", (chunk) => appendFileSync(typed, chunk));
const bridge = spawn(server.command, server.args, { stdio: ["pipe", "pipe", "pipe"] });
const pending = new Map();
const lines = createInterface({ input: bridge.stdout });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timeout);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result);
});
let nextId = 0;
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 10_000);
    pending.set(id, { resolve, reject, timeout });
    bridge.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

try {
  await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "spark-briefing-proof", version: "1" },
  });
  bridge.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  const listed = await request("tools/list", {});
  const answers = [];
  for (const call of calls) answers.push(await request("tools/call", call));
  writeFileSync(output, JSON.stringify({ listed, called: answers[0], calls: answers }));
} catch (error) {
  writeFileSync(output, JSON.stringify({ error: error.message }));
}
// Keep the terminal alive so the ordinary run exit/teardown path owns both processes.
setInterval(() => {}, 60_000);
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    bridge.kill(signal);
    process.exit(0);
  });
}
