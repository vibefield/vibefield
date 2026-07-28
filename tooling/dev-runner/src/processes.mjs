import { spawn } from "node:child_process";

export const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
export const cargoCommand = process.platform === "win32" ? "cargo.exe" : "cargo";

export function runCommand({
  command,
  args,
  cwd,
  env = process.env,
  label = `${command} ${args.join(" ")}`,
  stdio = "inherit",
  onSpawn,
}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio,
        windowsHide: false,
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

export async function terminateChild(child, { graceMs = 8_000, killWaitMs = 2_000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return { forced: false };

  const exited = new Promise((resolve) => {
    child.once("exit", () => resolve(true));
  });
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
    return error?.code === "EPERM";
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
