import { spawn } from "node:child_process";
import { parseNxChangeLine } from "./nx-events.mjs";
import { pnpmCommand, terminateChild } from "./processes.mjs";

export async function startNxWatcher({ repoRoot, eventScript, onChange, onUnexpectedExit }) {
  let stopping = false;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  const child = spawn(pnpmCommand, ["nx", "watch", "--all", "--", process.execPath, eventScript], {
    cwd: repoRoot,
    env: nxWatcherEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });

  child.stdout.on("data", (chunk) => {
    stdoutBuffer = consumeLines(stdoutBuffer + chunk.toString(), (line) => {
      const change = parseNxChangeLine(line);
      if (change) onChange(change);
      else process.stdout.write(`${line}\n`);
    });
  });
  child.stderr.on("data", (chunk) => {
    stderrBuffer = consumeLines(stderrBuffer + chunk.toString(), (line) => {
      process.stderr.write(`${line}\n`);
    });
  });
  child.once("exit", (code, signal) => {
    if (stdoutBuffer) process.stdout.write(stdoutBuffer);
    if (stderrBuffer) process.stderr.write(stderrBuffer);
    if (!stopping) onUnexpectedExit({ code, signal });
  });

  return {
    async close() {
      stopping = true;
      await terminateChild(child, { graceMs: 2_000, killWaitMs: 1_000 });
    },
  };
}

export function nxWatcherEnvironment(environment = process.env) {
  return {
    ...environment,
    // Nx deliberately disables its daemon inside an Nx task. `nx watch`
    // requires that daemon, so the nested long-lived watcher must opt back
    // in explicitly.
    NX_DAEMON: "true",
    NX_TASKS_RUNNER_DYNAMIC_OUTPUT: "false",
  };
}

function consumeLines(value, onLine) {
  const lines = value.split(/\r?\n/);
  const remainder = lines.pop() ?? "";
  for (const line of lines) onLine(line);
  return remainder;
}
