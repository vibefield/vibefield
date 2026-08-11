import { spawn } from "node:child_process";

export const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
export const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";

/** Only a real image can be handed to CreateProcess; everything else is a script. */
const WINDOWS_IMAGE = /\.(exe|com)$/i;

/** cmd.exe metacharacters, cross-spawn's set minus `%`: percent expansion runs
 * BEFORE caret processing, so `^%` is not an escape — and every line built here
 * is our own argv, which makes %VAR% expansion accepted behaviour rather than a
 * hole to pretend we closed. */
const CMD_META = /([()\][!^"`<>&|;, *?])/g;

/**
 * The win32 relaunch shape. A `.cmd` (pnpm's shim is one) is a batch file, not
 * an image: CreateProcess cannot launch it and Node ≥ 20.12 refuses to try
 * (the CVE-2024-27980 fix throws EINVAL), so it must ride cmd.exe. Escaping
 * follows cross-spawn: every quote and metacharacter is caret-escaped so cmd
 * never enters quoted state, and what survives caret processing is a correctly
 * quoted command line for the child's own argv parsing. Pure.
 */
export function buildCmdShellCommand(command, args) {
  const line = [escapeCmdCommand(command), ...args.map(escapeCmdArgument)].join(" ");
  return { command: "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`] };
}

/** What to actually spawn on this platform, and whether node must keep hands off. */
export function launchSpec(command, args, platform = process.platform) {
  if (platform !== "win32" || WINDOWS_IMAGE.test(command)) {
    return { command, args, windowsVerbatimArguments: false };
  }
  return { ...buildCmdShellCommand(command, args), windowsVerbatimArguments: true };
}

function escapeCmdCommand(value) {
  return value.replace(CMD_META, "^$1");
}

function escapeCmdArgument(value) {
  // qntm.org/cmd: double every backslash run that precedes a quote, and the run
  // that would precede the closing quote we are about to add, then escape the
  // quotes themselves.
  const escaped = `${value}`.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  return `"${escaped}"`.replace(CMD_META, "^$1");
}

export function runCommand({
  command,
  args,
  cwd,
  env = process.env,
  label = `${command} ${args.join(" ")}`,
  stdio = "inherit",
  onSpawn,
  platform = process.platform,
}) {
  const launch = launchSpec(command, args, platform);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(launch.command, launch.args, {
        cwd,
        env,
        stdio,
        windowsHide: true,
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      });
    } catch (error) {
      reject(new Error(`${label} could not start`, { cause: error }));
      return;
    }
    onSpawn?.(child);
    child.once("error", (error) => {
      reject(new Error(`${label} could not start`, { cause: error }));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(child);
        return;
      }
      reject(
        new Error(
          `${label} failed (${signal !== null ? `signal ${signal}` : `exit ${String(code)}`})`,
        ),
      );
    });
  });
}

export async function terminateChild(
  child,
  { graceMs = 8_000, killWaitMs = 2_000, platform = process.platform } = {},
) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return { forced: false };

  const exited = new Promise((resolve) => {
    child.once("exit", () => resolve(true));
  });
  if (platform === "win32") {
    // Every signal here is TerminateProcess: there is no graceful stop to wait
    // for, so the TERM → grace → KILL ladder would be theatre and `forced:
    // false` a lie about what the child was given. One kill, reported honestly.
    // A real graceful daemon stop has to ride the management RPC, not a signal.
    // Two limits stay honest rather than papered over: a command relaunched
    // through cmd.exe dies without its grandchild (a `taskkill /T` follow-up),
    // and `graceMs` has nothing to mean here.
    child.kill();
    await settleWithin(exited, killWaitMs);
    return { forced: true };
  }
  child.kill("SIGTERM");
  if (await settleWithin(exited, graceMs)) return { forced: false };

  child.kill("SIGKILL");
  await settleWithin(exited, killWaitMs);
  return { forced: true };
}

export function isPidAlive(pid, kill = process.kill.bind(process)) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM (unix) and EACCES (libuv's mapping of Windows ERROR_ACCESS_DENIED)
    // both mean the process EXISTS and we may not query it. Reading that as
    // dead is destructive: clearDeadDevProductFiles then deletes product.json
    // and shell.token out from under a live daemon.
    return error?.code === "EPERM" || error?.code === "EACCES";
  }
}

export async function waitForPidExit(pid, timeoutMs, kill = process.kill.bind(process)) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid, kill)) return true;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return !isPidAlive(pid, kill);
}

async function settleWithin(promise, timeoutMs) {
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const result = await Promise.race([promise, timedOut]);
  clearTimeout(timer);
  return result === true;
}
