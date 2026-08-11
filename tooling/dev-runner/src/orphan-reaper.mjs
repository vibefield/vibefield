/**
 * Session-start orphan reaping (GT-2d).
 *
 * The two-plane law says field-native outlives fieldd outlives the shell, and
 * adoption is a FEATURE — so a daemon nobody is supervising keeps answering its
 * socket forever. A pair left behind by a previous runner session therefore
 * wins the socket against the pair this session is about to start, and fieldd
 * honestly reports whatever that ancient floor can do. The runner's bounce
 * logic only manages the pair it launched, so nothing else closes this.
 *
 * Reaping is scoped by EVIDENCE, never by name pattern — a process is ours only
 * if it executes out of the runner-owned snapshot namespace, or if it holds a
 * socket in the runner-owned dev data root. Anything minding its own data dir
 * (the packaged app, a `target/debug` build under a test's temp root) is left
 * alone even when it is named field-native.
 */
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { isPidAlive, waitForPidExit } from "./processes.mjs";

const execFileAsync = promisify(execFile);

/** Bounds the dev-data walk: `data/users/<fuid>/<plane>/run/*.sock` is depth 5
 * since UA-1 (the flat `data/<plane>/run/*.sock` was 3); one level of margin. */
const SOCKET_WALK_DEPTH = 6;

export const REAP_STALE_SNAPSHOT = "stale-snapshot";
export const REAP_SOCKET_SQUATTER = "socket-squatter";

/**
 * Decide who dies. Pure: no filesystem, no signals, no process list of its own.
 *
 * `keepPids` is checked FIRST and wins over every class. That exemption is the
 * adoption feature: a shell-only rebuild moves the combined snapshot id while
 * the daemon identity stands still, so the legitimately adoptable pair is
 * running out of a snapshot directory that is no longer current — class (a)
 * describes it perfectly and must not touch it.
 *
 * @param {object} input
 * @param {Array<{pid: number, exePath?: string | null}>} input.processes
 * @param {Array<{pid: number, socketPath: string}>} input.socketOwners
 * @param {string} input.runtimeRoot  `.vibefield/dev/runtime`
 * @param {string} input.dataRoot     `.vibefield/dev/data`
 * @param {Iterable<string>} [input.keepSnapshots] snapshot dir names to spare
 * @param {Iterable<number>} [input.keepPids] the adoptable pair
 * @param {number} [input.selfPid]
 */
export function classifyOrphans({
  processes = [],
  socketOwners = [],
  runtimeRoot,
  dataRoot,
  keepSnapshots = [],
  keepPids = [],
  selfPid = process.pid,
}) {
  const runtime = resolve(runtimeRoot);
  const data = resolve(dataRoot);
  const keptSnapshots = new Set(keepSnapshots);
  const spared = new Set([selfPid, ...keepPids].filter(isRealPid));
  const exeByPid = new Map();
  const reap = new Map();

  for (const record of processes) {
    const pid = record?.pid;
    if (!isRealPid(pid)) continue;
    const exePath = normalizeExePath(record.exePath);
    exeByPid.set(pid, exePath);
    if (spared.has(pid)) continue;
    const snapshot = snapshotOwning(exePath, runtime);
    if (snapshot === null) continue; // outside our namespace; the socket pass may still convict
    if (keptSnapshots.has(snapshot)) {
      // Running the very bytes this session is about to run: not a leftover
      // generation but THIS one, so holding our socket is its job. Load-bearing
      // because fieldd records `nativePid` only when it SPAWNED the native — a
      // native it adopted is in nobody's product.json, and without this it would
      // read as a squatter and die with every session on it.
      spared.add(pid);
      continue;
    }
    reap.set(pid, { pid, exePath, reason: REAP_STALE_SNAPSHOT, snapshot });
  }

  for (const owner of socketOwners) {
    const pid = owner?.pid;
    if (!isRealPid(pid) || spared.has(pid) || reap.has(pid)) continue;
    if (!isDevRunSocket(owner.socketPath, data)) continue;
    reap.set(pid, {
      pid,
      exePath: exeByPid.get(pid) ?? null,
      reason: REAP_SOCKET_SQUATTER,
      socketPath: resolve(owner.socketPath),
    });
  }

  return [...reap.values()].sort((a, b) => a.pid - b.pid);
}

/**
 * Reap, then say what happened. Every effect is injectable so the suite can
 * prove the policy without owning a single real process.
 */
export async function reapDevOrphans({
  paths,
  log,
  keepSnapshots = [],
  keepPids = [],
  listProcesses = listSystemProcesses,
  listSocketOwners = listUnixSocketOwners,
  findSockets = findDevRunSockets,
  kill = process.kill.bind(process),
  isAlive = isPidAlive,
  waitForExit = waitForPidExit,
  graceMs = 3_000,
  killWaitMs = 1_000,
}) {
  const sockets = await findSockets(paths.dataRoot);
  const [processes, socketOwners] = await Promise.all([
    listProcesses({ log }),
    listSocketOwners(sockets, { log }),
  ]);
  const orphans = classifyOrphans({
    processes,
    socketOwners,
    runtimeRoot: paths.runtimeRoot,
    dataRoot: paths.dataRoot,
    keepSnapshots,
    keepPids,
  });
  if (orphans.length === 0) return "no development orphans were holding the dev tree";

  const counts = { [REAP_STALE_SNAPSHOT]: 0, [REAP_SOCKET_SQUATTER]: 0 };
  let forced = 0;
  for (const orphan of orphans) {
    counts[orphan.reason] += 1;
    log.warn(`reaping ${describeOrphan(orphan)}`);
    if (await terminatePid(orphan.pid, { kill, isAlive, waitForExit, graceMs, killWaitMs })) {
      forced += 1;
      log.warn(`dev orphan pid ${orphan.pid} ignored SIGTERM and was killed`);
    }
  }
  return `reaped ${orphans.length} development orphan${orphans.length === 1 ? "" : "s"} (${
    counts[REAP_STALE_SNAPSHOT]
  } stale-snapshot, ${counts[REAP_SOCKET_SQUATTER]} socket-squatter${
    forced > 0 ? `, ${forced} force-killed` : ""
  })`;
}

/** SIGTERM → bounded wait → SIGKILL. Resolves true when the ladder went all the way. */
async function terminatePid(pid, { kill, isAlive, waitForExit, graceMs, killWaitMs }) {
  if (!isAlive(pid)) return false;
  try {
    kill(pid, "SIGTERM");
  } catch {
    return false; // it died between the listing and the signal
  }
  if (await waitForExit(pid, graceMs)) return false;
  try {
    kill(pid, "SIGKILL");
  } catch {
    return false;
  }
  await waitForExit(pid, killWaitMs);
  return true;
}

function describeOrphan(orphan) {
  const where = orphan.exePath ?? "unknown executable";
  return orphan.reason === REAP_STALE_SNAPSHOT
    ? `dev orphan pid ${orphan.pid} (stale-snapshot ${orphan.snapshot}): ${where}`
    : `dev orphan pid ${orphan.pid} (socket-squatter on ${orphan.socketPath}): ${where}`;
}

/**
 * The snapshot directory an executable belongs to, or null when the path is
 * outside the runner's namespace. A string check by design: the runner prunes
 * old snapshots on every start, so an orphan's executable is usually already
 * deleted and any filesystem probe would clear the guilty.
 */
function snapshotOwning(exePath, runtimeRoot) {
  if (exePath === null) return null;
  const rel = relative(runtimeRoot, exePath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  const [snapshot] = rel.split(/[\\/]/);
  return snapshot === undefined || snapshot === "" ? null : snapshot;
}

/** `<dataRoot>/**‍/run/*.sock` — the runner-owned socket namespace. */
function isDevRunSocket(socketPath, dataRoot) {
  if (typeof socketPath !== "string" || socketPath === "") return false;
  const full = resolve(socketPath);
  const rel = relative(dataRoot, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return false;
  return full.endsWith(".sock") && basename(dirname(full)) === "run";
}

/** Linux appends this to a deleted binary's exe link; macOS `ps` does not. */
function normalizeExePath(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/ \(deleted\)$/, "");
  return trimmed === "" ? null : resolve(trimmed);
}

function isRealPid(pid) {
  return Number.isInteger(pid) && pid > 0;
}

/** `ps -Ao pid=,comm=` — on macOS `comm` is the full executable path. Windows
 * has no `ps` at all and the gate is explicit rather than by spawn failure: an
 * MSYS `ps.exe` on PATH answers with a different table entirely. */
export async function listSystemProcesses({ log, platform = process.platform } = {}) {
  if (platform === "win32") return listWindowsProcesses(log);
  let stdout;
  try {
    ({ stdout } = await execFileAsync("ps", ["-Ao", "pid=,comm="], {
      maxBuffer: 8 * 1024 * 1024,
    }));
  } catch (error) {
    log?.warn(`could not list processes; stale-snapshot orphans go unreaped: ${messageOf(error)}`);
    return [];
  }
  return parseProcessList(stdout);
}

/** CIM is the portable process table on Windows; `Select-Object` keeps the
 * payload to the two fields the classifier convicts on. */
async function listWindowsProcesses(log) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress",
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    ));
  } catch (error) {
    log?.warn(`could not list processes; stale-snapshot orphans go unreaped: ${messageOf(error)}`);
    return [];
  }
  const processes = parseWindowsProcessList(stdout);
  if (processes.length === 0) {
    log?.warn("the process table came back empty; stale-snapshot orphans go unreaped");
  }
  return processes;
}

/**
 * `ConvertTo-Json` emits a bare object rather than a one-element array when the
 * query matches a single row, so both shapes are accepted. A row without an
 * ExecutablePath (the ones we may not query) carries no evidence at all and is
 * dropped — reaping is by evidence, never by name.
 */
export function parseWindowsProcessList(stdout) {
  let value;
  try {
    value = JSON.parse(stdout);
  } catch {
    return [];
  }
  const processes = [];
  for (const row of Array.isArray(value) ? value : [value]) {
    const pid = Number(row?.ProcessId);
    const exePath = row?.ExecutablePath;
    if (!isRealPid(pid) || typeof exePath !== "string" || exePath.trim() === "") continue;
    processes.push({ pid, exePath });
  }
  return processes;
}

/** `<pid> <executable path>` per line; the path may contain spaces. */
export function parseProcessList(stdout) {
  const processes = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match === null) continue;
    processes.push({ pid: Number(match[1]), exePath: match[2] });
  }
  return processes;
}

/**
 * Who holds these unix sockets. macOS `lsof <socket-path>` finds NOTHING for a
 * unix socket even though lsof prints that same path in its NAME column, so the
 * only reliable query is the whole unix-socket table filtered by name.
 */
export async function listUnixSocketOwners(socketPaths, { log, platform = process.platform } = {}) {
  // Windows: the endpoints are named pipes, which have no filesystem presence
  // for anything to enumerate — the socket-squatter class needs a pid recorded
  // in a run file (or an ask-the-daemon probe) instead, which is the WIN
  // follow-up. Until it lands this pass honestly contributes nothing.
  if (platform === "win32") return [];
  const wanted = new Set(socketPaths.map((path) => resolve(path)));
  if (wanted.size === 0) return [];
  let stdout;
  try {
    ({ stdout } = await execFileAsync("lsof", ["-U", "-Fpn"], { maxBuffer: 8 * 1024 * 1024 }));
  } catch (error) {
    // lsof exits non-zero when it merely lacked permission on some processes,
    // and it is absent on some machines: partial output still reaps, no output
    // degrades to stale-snapshot coverage alone. Never fatal.
    if (typeof error?.stdout !== "string" || error.stdout === "") {
      const detail = messageOf(error);
      log?.warn(`could not read unix socket owners; socket squatters go unreaped: ${detail}`);
      return [];
    }
    stdout = error.stdout;
  }
  return parseUnixSocketOwners(stdout, wanted);
}

/**
 * lsof `-F` output is a stream of records: a `p<pid>` line opens a process and
 * every `n<name>` line under it belongs to that process until the next `p`.
 * Names that are not sockets we care about (peer addresses, other trees) fall
 * through untouched.
 */
export function parseUnixSocketOwners(stdout, wantedPaths) {
  const wanted = wantedPaths instanceof Set ? wantedPaths : new Set(wantedPaths);
  const owners = [];
  let pid = null;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) {
      const parsed = Number(line.slice(1));
      pid = Number.isInteger(parsed) ? parsed : null;
    } else if (line.startsWith("n") && pid !== null) {
      const socketPath = line.slice(1);
      if (wanted.has(socketPath)) owners.push({ pid, socketPath });
    }
  }
  return owners;
}

/** Every `run/*.sock` under the dev data root, depth-bounded. */
export async function findDevRunSockets(dataRoot, depth = SOCKET_WALK_DEPTH) {
  if (depth <= 0) return [];
  let entries;
  try {
    entries = await readdir(dataRoot, { withFileTypes: true });
  } catch {
    return []; // a dev tree with no data root yet has no sockets to own
  }
  const found = [];
  const inRunDir = basename(dataRoot) === "run";
  const nested = [];
  for (const entry of entries) {
    const path = join(dataRoot, entry.name);
    if (entry.isDirectory()) nested.push(findDevRunSockets(path, depth - 1));
    else if (inRunDir && entry.name.endsWith(".sock")) found.push(path);
  }
  for (const batch of await Promise.all(nested)) found.push(...batch);
  return found;
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
