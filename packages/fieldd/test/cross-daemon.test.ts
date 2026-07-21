// THE handshake test: fieldd (TypeScript) pairs with the REAL field-native
// (Rust binary) over the mgmt UDS — D8 end to end, then the full spine:
// WS client → ProductAPI → NativeLink → field-native and back.
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, NativeLink } from "../src/index";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = join(ROOT, "target/debug/field-native");

let children: ChildProcess[] = [];
let dirs: string[] = [];

beforeAll(() => {
  execSync("cargo build -p field-native", { cwd: ROOT, stdio: "ignore" });
}, 180_000);

afterEach(() => {
  for (const c of children) c.kill("SIGKILL");
  children = [];
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

async function spawnNative(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "vf-"));
  dirs.push(dir);
  const child = spawn(BIN, [], { env: { ...process.env, FIELD_NATIVE_DATA_DIR: dir }, stdio: "ignore" });
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
    const supersededEvent = new Promise<void>((resolve) => first.once("superseded", () => resolve()));

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
    const early = await wsRequest(ws, { jsonrpc: "2.0", id: 1, method: "system.health", params: {} });
    expect((early["error"] as { data: { kind: string } }).data.kind).toBe("UNAUTHORIZED");

    const hello = await wsRequest(ws, {
      jsonrpc: "2.0", id: 2, method: "system.hello",
      params: { contractsVersion: "0.1.0", minCompatible: "0.1.0", clientKind: "renderer", credential: grant.token },
    });
    expect((hello["result"] as { serverKind: string }).serverKind).toBe("fieldd");

    const health = await wsRequest(ws, { jsonrpc: "2.0", id: 3, method: "system.health", params: {} });
    const native = (health["result"] as { native: { units: { unit: string }[] } }).native;
    expect(native.units.map((u) => u.unit)).toContain("terminal"); // Rust truth, seen through two daemons

    const caps = await wsRequest(ws, { jsonrpc: "2.0", id: 4, method: "system.capabilities", params: {} });
    expect((caps["result"] as { methods: string[] }).methods).toContain("system.health");

    const missing = await wsRequest(ws, { jsonrpc: "2.0", id: 5, method: "nope.nope", params: {} });
    expect((missing["error"] as { code: number }).code).toBe(-32601);

    ws.close();
    await daemon.stop();
  }, 20_000);

  it("bad token and disallowed Origin are rejected", async () => {
    const dir = await spawnNative();
    const daemon = await bootstrap({ dataDir: dir, controlPort: 0 });

    const ws = new WebSocket(`ws://127.0.0.1:${daemon.controlPort}`);
    await new Promise<void>((r) => ws.once("open", () => r()));
    const resp = await wsRequest(ws, {
      jsonrpc: "2.0", id: 1, method: "system.hello",
      params: { contractsVersion: "0.1.0", minCompatible: "0.1.0", clientKind: "renderer", credential: "tok_forged" },
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
