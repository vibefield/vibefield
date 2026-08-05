// UA-5 — the two-resident-pairs audit (spec §10 exit): one machine, one
// users.json, two FULL pairs under users/1 and users/2 — no socket, port, or
// store collision, both product planes answering AT THE SAME TIME, and the
// UA-D10 law held physically: neither resident fieldd ever writes users.json
// (mtime unchanged across the run). Ephemeral ports (UA-D12) are what make
// this possible at all — the fixed 9410/9411 were the accidental machine-wide
// mutex V5 named, and this test is the mutex's tombstone.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UserRecord } from "@vibefield/contracts";
import { createUser, mintLockedUsersFile, userRootFor, usersFilePath } from "@vibefield/users";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { helloAs, WsRpc } from "./ws-rpc";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = join(ROOT, "target/debug/field-native");

let children: ChildProcess[] = [];
let cleanup: Array<() => void | Promise<void>> = [];

beforeAll(async () => {
  // Async on purpose (the kill-matrix lesson): a synchronous build starves the
  // vitest worker RPC on a cold cache.
  await new Promise<void>((resolveBuild, reject) => {
    const build = spawn("cargo", ["build", "-p", "field-native"], { cwd: ROOT, stdio: "ignore" });
    build.once("error", reject);
    build.once("exit", (code) =>
      code === 0 ? resolveBuild() : reject(new Error(`cargo build -p field-native exited ${code}`)),
    );
  });
}, 180_000);

afterEach(async () => {
  const fns = cleanup.reverse();
  cleanup = [];
  for (const fn of fns) {
    try {
      await fn();
    } catch {
      /* already-stopped is fine */
    }
  }
  for (const c of children) c.kill("SIGKILL");
  children = [];
});

async function spawnNativeAt(dataDir: string): Promise<ChildProcess> {
  const child = spawn(BIN, [], {
    env: {
      ...process.env,
      FIELD_NATIVE_DATA_DIR: dataDir,
      FIELD_LOG_DIR: join(dataDir, "logs"),
      FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
    },
    stdio: "ignore",
  });
  children.push(child);
  const socket = join(dataDir, "native/run/mgmt.sock");
  const deadline = Date.now() + 15_000;
  while (!existsSync(socket)) {
    if (Date.now() > deadline) throw new Error("field-native did not come up");
    await new Promise((r) => setTimeout(r, 100));
  }
  return child;
}

async function upPair(vfRoot: string, record: UserRecord): Promise<FielddDaemon> {
  const userRoot = userRootFor(vfRoot, record);
  await spawnNativeAt(userRoot);
  const daemon = await bootstrap({
    dataDir: userRoot,
    controlPort: 0,
    dataPort: 0,
    userId: record.userId,
  });
  cleanup.push(() => daemon.stop());
  return daemon;
}

async function health(daemon: FielddDaemon): Promise<unknown> {
  const grant = daemon.tokens.mint([], "two-pairs-audit");
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  cleanup.push(() => ws.close());
  const rpc = new WsRpc(ws);
  await helloAs(rpc, grant.token);
  return rpc.call("system.health", {});
}

describe("UA-5 — two resident pairs on one machine", () => {
  it("no port/socket/store collision, both answer concurrently, users.json untouched", async () => {
    const vfRoot = mkdtempSync("/tmp/vf-2p-");
    cleanup.push(() => rmSync(vfRoot, { recursive: true, force: true }));
    const { file } = mintLockedUsersFile(vfRoot);
    const first = file.users[0];
    if (first === undefined) throw new Error("mint produced no user");
    const { user: second } = await createUser(vfRoot, {}, { name: "second" });
    const usersPath = usersFilePath(vfRoot);
    const mtimeBefore = statSync(usersPath).mtimeMs;

    const a = await upPair(vfRoot, first);
    const b = await upPair(vfRoot, second);

    // the port audit — four ephemeral binds, all real, all distinct
    const ports = [a.controlPort, a.dataPort, b.controlPort, b.dataPort];
    for (const port of ports) expect(port).toBeGreaterThan(0);
    expect(new Set(ports).size).toBe(4);

    // the socket audit — each pair's floor under its OWN root, both alive
    expect(existsSync(join(userRootFor(vfRoot, first), "native/run/mgmt.sock"))).toBe(true);
    expect(existsSync(join(userRootFor(vfRoot, second), "native/run/mgmt.sock"))).toBe(true);

    // both product planes answer WHILE the other lives — the resident promise
    const [healthA, healthB] = await Promise.all([health(a), health(b)]);
    expect(healthA).toMatchObject({ fieldd: { state: "up" } });
    expect(healthB).toMatchObject({ fieldd: { state: "up" } });

    // UA-D10 — neither resident fieldd ever opened users.json for write
    expect(statSync(usersPath).mtimeMs).toBe(mtimeBefore);
  }, 90_000);
});
