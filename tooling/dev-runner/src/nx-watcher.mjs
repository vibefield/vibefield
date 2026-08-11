import { spawn } from "node:child_process";
import { buildChildEnv } from "./env.mjs";
import { parseNxChangeLine } from "./nx-events.mjs";
import { launchSpec, pnpmCommand, terminateChild } from "./processes.mjs";

export async function startNxWatcher({ repoRoot, eventScript, onChange, onUnexpectedExit }) {
  let stopping = false;
  let stdoutBuffer = "";
  let stderrBuffer = "";
  // pnpm's shim is a `.cmd`, so this spawn needs the same cmd.exe relaunch every
  // tracked command gets — a bare `.cmd` throws EINVAL on Node ≥ 20.12.
  const launch = launchSpec(pnpmCommand, [
    "nx",
    "watch",
    "--all",
    "--",
    ...nxWatchEventArgv(eventScript),
  ]);
  const child = spawn(launch.command, launch.args, {
    cwd: repoRoot,
    env: nxWatcherEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    windowsVerbatimArguments: launch.windowsVerbatimArguments,
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

/**
 * Nx re-executes the argv after `--` THROUGH A SHELL, so an unquoted path with
 * spaces (`C:\Program Files\nodejs\node.exe` is the default install) breaks
 * silently: the event command dies and change events simply never arrive. The
 * quotes are literal argv content here — our own cmd.exe wrapper preserves them.
 */
export function nxWatchEventArgv(
  eventScript,
  execPath = process.execPath,
  platform = process.platform,
) {
  return platform === "win32" ? [`"${execPath}"`, `"${eventScript}"`] : [execPath, eventScript];
}

export function nxWatcherEnvironment(environment = process.env, platform = process.platform) {
  return buildChildEnv(
    environment,
    {
      // Nx deliberately disables its daemon inside an Nx task. `nx watch`
      // requires that daemon, so the nested long-lived watcher must opt back
      // in explicitly.
      set: {
        NX_DAEMON: "true",
        NX_TASKS_RUNNER_DYNAMIC_OUTPUT: "false",
      },
    },
    platform,
  );
}

function consumeLines(value, onLine) {
  const lines = value.split(/\r?\n/);
  const remainder = lines.pop() ?? "";
  for (const line of lines) onLine(line);
  return remainder;
}
