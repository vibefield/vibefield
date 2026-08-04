// THE handshake test: fieldd (TypeScript) pairs with the REAL field-native
// (Rust binary) over the mgmt UDS — D8 end to end, then the full spine:
// WS client → ProductAPI → NativeLink → field-native and back.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddHealth, NativeLink } from "../src/index";
import { helloAs, until, WsRpc } from "./ws-rpc";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = join(ROOT, "target/debug/field-native");

let children: ChildProcess[] = [];
let dirs: string[] = [];

function nativeEnv(dataDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FIELD_NATIVE_DATA_DIR: dataDir,
    FIELD_LOG_DIR: join(dataDir, "logs"),
    FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
  };
}

beforeAll(async () => {
  // Async on purpose: a synchronous build blocks the vitest worker's event
  // loop, and on a cold CI cache that starves the worker→host RPC past its
  // timeout (the "onTaskUpdate" red with every test green).
  await new Promise<void>((resolveBuild, reject) => {
    const build = spawn("cargo", ["build", "-p", "field-native"], { cwd: ROOT, stdio: "ignore" });
    build.once("error", reject);
    build.once("exit", (code) =>
      code === 0 ? resolveBuild() : reject(new Error(`cargo build -p field-native exited ${code}`)),
    );
  });
}, 180_000);

afterEach(async () => {
  // SIGKILL is asynchronous: a dying daemon (or its segment writer) can still
  // be creating files while rmSync walks the tree — the ENOTEMPTY teardown
  // race that broke three verify runs. Await the real exits, then remove with
  // Node's own ENOTEMPTY retry loop as the backstop.
  const exits = children.map((c) =>
    c.exitCode !== null || c.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2_000);
          c.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        }),
  );
  for (const c of children) c.kill("SIGKILL");
  await Promise.all(exits);
  children = [];
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  dirs = [];
});

async function spawnNative(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "vf-"));
  dirs.push(dir);
  const child = spawn(BIN, [], {
    env: nativeEnv(dir),
    stdio: "ignore",
  });
  children.push(child);
  const socket = join(dir, "native/run/mgmt.sock");
  const deadline = Date.now() + 10_000;
  while (!existsSync(socket)) {
    if (Date.now() > deadline) throw new Error("field-native socket never appeared");
    await new Promise((r) => setTimeout(r, 50));
  }
  return dir;
}

function wsRequest(ws: WebSocket, msg: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ws timeout")), 5000);
    ws.once("message", (raw) => {
      clearTimeout(t);
      resolve(JSON.parse(raw.toString()));
    });
    ws.send(JSON.stringify(msg));
  });
}

describe("cross-daemon handshake (TS fieldd ⇄ Rust field-native)", () => {
  it("NativeLink pairs with the real daemon and drives the survivor set", async () => {
    const dir = await spawnNative();
    const link = new NativeLink({
      socketPath: join(dir, "native/run/mgmt.sock"),
      pairingFile: join(dir, "native/pairing"),
      bootId: "fieldd-test-boot",
    });
    await link.connect();

    const { snapshot } = await link.subscribe("native.lifecycle.health.subscribe", {}, () => {});
    const units = (snapshot as { units: { unit: string }[] }).units.map((u) => u.unit);
    expect(units).toContain("terminal");
    expect(units).toContain("mesh-gateway");

    const applied = await link.request("native.lifecycle.desired.set", {
      generation: 3,
      terminals: [{ sessionId: "s-1" }],
      workers: [],
    });
    expect((applied as { applied: number }).applied).toBe(3);
    link.close();
  }, 20_000);

  it("a second fieldd supersedes the first (single product plane per device)", async () => {
    const dir = await spawnNative();
    const mk = (bootId: string) =>
      new NativeLink({
        socketPath: join(dir, "native/run/mgmt.sock"),
        pairingFile: join(dir, "native/pairing"),
        bootId,
      });
    const first = mk("fieldd-boot-A");
    await first.connect();
    const supersededEvent = new Promise<void>((resolve) =>
      first.once("superseded", () => resolve()),
    );

    const second = mk("fieldd-boot-B");
    await second.connect();

    await supersededEvent; // fatal for the old fieldd by design — no reconnect
    expect(first.superseded).toBe(true);
    second.close();
    first.close();
  }, 20_000);

  it("full spine: WS client → ProductAPI → NativeLink → field-native", async () => {
    const dir = await spawnNative();
    const daemon = await bootstrap({ dataDir: dir, controlPort: 0 });
    const grant = daemon.tokens.mint(["canvas.read"], "test-client");

    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    // pre-hello call is refused
    const early = await wsRequest(ws, {
      jsonrpc: "2.0",
      id: 1,
      method: "system.health",
      params: {},
    });
    expect((early["error"] as { data: { kind: string } }).data.kind).toBe("UNAUTHORIZED");

    const hello = await wsRequest(ws, {
      jsonrpc: "2.0",
      id: 2,
      method: "system.hello",
      params: {
        contractsVersion: "0.1.0",
        minCompatible: "0.1.0",
        clientKind: "renderer",
        credential: grant.token,
      },
    });
    expect((hello["result"] as { serverKind: string }).serverKind).toBe("fieldd");

    const health = await wsRequest(ws, {
      jsonrpc: "2.0",
      id: 3,
      method: "system.health",
      params: {},
    });
    const native = (health["result"] as { native: { units: { unit: string }[] } }).native;
    expect(native.units.map((u) => u.unit)).toContain("terminal"); // Rust truth, seen through two daemons

    const caps = await wsRequest(ws, {
      jsonrpc: "2.0",
      id: 4,
      method: "system.capabilities",
      params: {},
    });
    expect((caps["result"] as { methods: string[] }).methods).toContain("system.health");

    const missing = await wsRequest(ws, { jsonrpc: "2.0", id: 5, method: "nope.nope", params: {} });
    expect((missing["error"] as { code: number }).code).toBe(-32601);

    ws.close();
    await daemon.stop();
  }, 20_000);

  it("SUPERSEDED stops the whole product plane — no zombie API (review P1)", async () => {
    const dir = await spawnNative();
    let fatal = "";
    let fatalNotified: (reason: string) => void = () => undefined;
    const fatalNotification = new Promise<string>((resolve) => {
      fatalNotified = resolve;
    });
    const daemon = await bootstrap({
      dataDir: dir,
      controlPort: 0,
      onFatal: (reason) => {
        fatal = reason;
        fatalNotified(reason);
      },
    });
    const grant = daemon.tokens.mint([], "client");

    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    await new Promise<void>((r) => ws.once("open", () => r()));
    const hello = await wsRequest(ws, {
      jsonrpc: "2.0",
      id: 1,
      method: "system.hello",
      params: {
        contractsVersion: "0.1.0",
        minCompatible: "0.1.0",
        clientKind: "renderer",
        credential: grant.token,
      },
    });
    expect((hello["result"] as { serverKind: string }).serverKind).toBe("fieldd");

    const wsClosed = new Promise<void>((r) => ws.once("close", () => r()));
    // a newer fieldd takes over the native plane
    const usurper = new NativeLink({
      socketPath: join(dir, "native/run/mgmt.sock"),
      pairingFile: join(dir, "native/pairing"),
      bootId: "fieldd-usurper",
    });
    await usurper.connect();

    await wsClosed; // the old product plane's API died with its native link
    // The process-exit callback deliberately follows service-lease revocation
    // and evidence close, so never infer it synchronously from socket close.
    await expect(fatalNotification).resolves.toContain("superseded");
    expect(fatal).toContain("superseded");
    expect(daemon.native.superseded).toBe(true);
    usurper.close();
  }, 20_000);

  it("bootstrap rollback: a failed API listen releases the native slot (review P1)", async () => {
    const dir = await spawnNative();
    // occupy a port with something that does NOT participate in supersession
    const blocker = createNetServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", () => r()));
    const blockedPort = (blocker.address() as { port: number }).port;

    // bootstrap pairs first, then fails to bind → must reject AND release the slot
    await expect(bootstrap({ dataDir: dir, controlPort: blockedPort })).rejects.toThrow();

    // rollback released its mgmt connection: a fresh link pairs and works immediately
    const fresh = new NativeLink({
      socketPath: join(dir, "native/run/mgmt.sock"),
      pairingFile: join(dir, "native/pairing"),
      bootId: "fieldd-after-rollback",
    });
    await fresh.connect();
    const { snapshot } = await fresh.subscribe("native.lifecycle.health.subscribe", {}, () => {});
    expect((snapshot as { units: unknown[] }).units.length).toBeGreaterThan(0);
    expect(fresh.superseded).toBe(false); // nobody is holding the slot against us
    fresh.close();
    await new Promise<void>((r) => blocker.close(() => r()));
  }, 20_000);

  it("product hello is contract-gated: malformed shape and major mismatch are refused (review P2)", async () => {
    const dir = await spawnNative();
    const daemon = await bootstrap({ dataDir: dir, controlPort: 0 });
    const grant = daemon.tokens.mint([], "client");

    const ws1 = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    await new Promise<void>((r) => ws1.once("open", () => r()));
    const malformed = await wsRequest(ws1, {
      jsonrpc: "2.0",
      id: 1,
      method: "system.hello",
      params: { nope: true },
    });
    expect((malformed["error"] as { data: { kind: string } }).data.kind).toBe(
      "PRECONDITION_FAILED",
    );

    const ws2 = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    await new Promise<void>((r) => ws2.once("open", () => r()));
    const mismatch = await wsRequest(ws2, {
      jsonrpc: "2.0",
      id: 1,
      method: "system.hello",
      params: {
        contractsVersion: "1.0.0",
        minCompatible: "1.0.0",
        clientKind: "renderer",
        credential: grant.token,
      },
    });
    expect((mismatch["error"] as { data: { kind: string } }).data.kind).toBe("INCOMPATIBLE");
    await daemon.stop();
  }, 20_000);

  it("kill matrix: native death flips the live health stream; respawn restores it", async () => {
    const dir = await spawnNative();
    const nativeChild = children[children.length - 1]!;
    const daemon = await bootstrap({ dataDir: dir, controlPort: 0 });
    const grant = daemon.tokens.mint([], "watcher");

    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    await new Promise<void>((r) => ws.once("open", () => r()));
    const rpc = new WsRpc(ws);
    await helloAs(rpc, grant.token);

    const sub = (await rpc.call("system.health.subscribe", {})) as {
      subId: string;
      snapshot: FielddHealth;
    };
    expect(sub.snapshot.nativeConnected).toBe(true);
    const payloads = (): FielddHealth[] =>
      rpc.notifications
        .filter((n) => n.method === "system.health.delta")
        .map((n) => n.params.payload as FielddHealth);

    // the Rust daemon dies → the renderer-facing stream says so, honestly
    nativeChild.kill("SIGKILL");
    await until(() => payloads().some((p) => p.nativeConnected === false), 8000);

    // same data dir, fresh boot: pairing secret persists → fieldd re-pairs by itself
    const revived = spawn(BIN, [], {
      env: nativeEnv(dir),
      stdio: "ignore",
    });
    children.push(revived);
    await until(() => {
      const ps = payloads();
      const lastDown = ps.map((p) => p.nativeConnected).lastIndexOf(false);
      return ps.slice(lastDown + 1).some((p) => p.nativeConnected === true && p.native !== null);
    }, 20_000);

    ws.close();
    await daemon.stop();
  }, 40_000);

  it("bad token and disallowed Origin are rejected", async () => {
    const dir = await spawnNative();
    const daemon = await bootstrap({ dataDir: dir, controlPort: 0 });

    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    await new Promise<void>((r) => ws.once("open", () => r()));
    const resp = await wsRequest(ws, {
      jsonrpc: "2.0",
      id: 1,
      method: "system.hello",
      params: {
        contractsVersion: "0.1.0",
        minCompatible: "0.1.0",
        clientKind: "renderer",
        credential: "tok_forged",
      },
    });
    expect((resp["error"] as { data: { kind: string } }).data.kind).toBe("UNAUTHORIZED");

    const evil = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`, {
      headers: { origin: "https://evil.example" },
    });
    const code = await new Promise<number>((resolve) => evil.once("close", (c) => resolve(c)));
    expect(code).toBe(1008);

    await daemon.stop();
  }, 20_000);
});
