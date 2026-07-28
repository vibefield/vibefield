// fieldd's end of the MeshData byte plane (design-02 §2.5, D5).
//
// Two kinds of test, deliberately:
//   · against the REAL Rust bridge — the handshake, the lane-scoped error, the
//     daemon dying. This is the seam that matters: two codecs in two languages.
//   · against a FAKE bridge speaking the same frames — the inbound paths, which
//     a bare daemon cannot produce because inbound delivery needs a transport
//     and there is no mesh node in tests. The fake is not a shortcut around the
//     real thing; it is the only way to drive bytes INTO fieldd today.
import { type ChildProcess, execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeMeshDataFrame, MESHDATA_FRAME, MeshDataFrameReader } from "@vibefield/contracts";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MeshLaneLink, type MeshLaneLinkOptions } from "../src/mesh-lane";
import { NativeLink } from "../src/native-link";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = join(ROOT, "target/debug/field-native");

let children: ChildProcess[] = [];
let dirs: string[] = [];
let closers: (() => void)[] = [];

beforeAll(() => {
  execSync("cargo build -p field-native", { cwd: ROOT, stdio: "ignore" });
}, 180_000);

afterEach(() => {
  for (const c of closers) c();
  closers = [];
  for (const c of children) c.kill("SIGKILL");
  children = [];
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const tmp = (tag: string) => {
  const dir = mkdtempSync(join(tmpdir(), `vf-${tag}-`));
  dirs.push(dir);
  return dir;
};

async function spawnNative(): Promise<string> {
  const dir = tmp("lane");
  const child = spawn(BIN, [], {
    env: {
      ...process.env,
      FIELD_NATIVE_DATA_DIR: dir,
      FIELD_LOG_DIR: join(dir, "logs"),
      FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
    },
    stdio: "ignore",
  });
  children.push(child);
  // BOTH sockets, and the order is the reason. field-native binds meshdata.sock
  // inside start_all() and mgmt.sock only afterwards (lib.rs), so waiting on the
  // byte plane alone returns while the management plane is still unbound — every
  // test here that dials mgmt.sock was racing a socket that did not exist yet.
  // It survived on timing and failed under parallel suite load as ECONNREFUSED,
  // which reads as a daemon fault rather than as a harness that started early.
  // Waiting on both is also order-proof: whichever binds last, this still holds.
  const sockets = ["meshdata.sock", "mgmt.sock"].map((s) => join(dir, "native/run", s));
  const deadline = Date.now() + 10_000;
  for (const socket of sockets) {
    while (!existsSync(socket)) {
      if (Date.now() > deadline) throw new Error(`${socket} never appeared`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  return dir;
}

// Derived from the real options rather than restated, so a new knob does not
// need this list edited to be reachable from a test.
function link(opts: Omit<MeshLaneLinkOptions, "bootId">): MeshLaneLink {
  const l = new MeshLaneLink({ bootId: "fieldd-lane-test", ...opts });
  closers.push(() => l.close());
  return l;
}

/** A bridge that speaks the frame protocol and lets the test push inbound
 * DATA whenever it likes — including BEFORE the consumer subscribes. */
async function fakeBridge(): Promise<{
  socketPath: string;
  pairingFile: string;
  sendData: (laneId: number, payload: Uint8Array) => void;
  received: () => { laneId: number; payload: Uint8Array }[];
}> {
  const dir = tmp("fake");
  const socketPath = join(dir, "meshdata.sock");
  const pairingFile = join(dir, "pairing");
  writeFileSync(pairingFile, "ab".repeat(32));

  let client: Socket | null = null;
  const received: { laneId: number; payload: Uint8Array }[] = [];
  const reader = new MeshDataFrameReader();

  const server: Server = createServer((sock) => {
    client = sock;
    sock.on("data", (chunk: Buffer) => {
      for (const f of reader.push(new Uint8Array(chunk))) {
        if (f.kind === MESHDATA_FRAME.HELLO) {
          // the fake accepts any credential; the REAL bridge's refusal is
          // covered against the real daemon below
          sock.write(encodeMeshDataFrame(MESHDATA_FRAME.HELLO_OK, 0, new Uint8Array()));
        } else if (f.kind === MESHDATA_FRAME.DATA) {
          received.push({ laneId: f.laneId, payload: f.payload });
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  closers.push(() => {
    client?.destroy();
    server.close();
  });

  return {
    socketPath,
    pairingFile,
    sendData: (laneId, payload) =>
      client?.write(encodeMeshDataFrame(MESHDATA_FRAME.DATA, laneId, payload)),
    received: () => received,
  };
}

const text = (u: Uint8Array) => new TextDecoder().decode(u);
const bytes = (s: string) => new TextEncoder().encode(s);
const tick = () => new Promise((r) => setTimeout(r, 60));

describe("MeshLaneLink ⇄ the real Rust bridge", () => {
  it("authenticates with the mgmt channel's own pairing scheme", async () => {
    const dir = await spawnNative();
    const l = link({
      socketPath: join(dir, "native/run/meshdata.sock"),
      pairingFile: join(dir, "native/pairing"),
    });
    await l.connect();
    expect(l.connected).toBe(true);
  }, 30_000);

  it("is refused with a wrong secret rather than half-connecting", async () => {
    // EL7's adversary: a same-uid process that can see the socket path but not
    // the 0600 pairing secret gets nothing.
    const dir = await spawnNative();
    const pairingFile = join(dir, "native/pairing");
    const real = readFileSync(pairingFile, "utf8");
    writeFileSync(pairingFile, "00".repeat(32));
    const l = link({ socketPath: join(dir, "native/run/meshdata.sock"), pairingFile });
    await expect(l.connect()).rejects.toThrow(/refused|timed out/);
    expect(l.connected).toBe(false);
    writeFileSync(pairingFile, real);
  }, 30_000);

  it("gets a lane-scoped error for an unopened lane and keeps the socket", async () => {
    const dir = await spawnNative();
    const l = link({
      socketPath: join(dir, "native/run/meshdata.sock"),
      pairingFile: join(dir, "native/pairing"),
    });
    await l.connect();
    const failure = new Promise<{ laneId: number; reason: string }>((resolve) =>
      l.once("lane-error", (laneId: number, reason: string) => resolve({ laneId, reason })),
    );
    l.send(42, bytes("orphan"));
    const err = await failure;
    expect(err).toEqual({ laneId: 42, reason: "unknown-lane" });
    // D5: a lane's problem is a lane's problem
    expect(l.connected).toBe(true);
  }, 30_000);

  it("refuses lane.open without a mesh node, honestly, over the mgmt door", async () => {
    // Lane LIFECYCLE is the mgmt channel's, bytes are the lane link's — two
    // doors to one daemon, which is the D5 split this asserts end to end.
    const dir = await spawnNative();
    const native = new NativeLink({
      socketPath: join(dir, "native/run/mgmt.sock"),
      pairingFile: join(dir, "native/pairing"),
      bootId: "fieldd-lane-test",
      reconnect: false,
    });
    closers.push(() => native.close());
    await native.connect();
    // `kind` is the typed vocabulary; `code` is the numeric JSON-RPC one. The
    // kind is what carries meaning across the seam, so that is what is asserted.
    await expect(
      native.request("native.mesh.lane.open", {
        laneId: 1,
        class: "reliable",
        peer: "peer-a",
        protocol: "doc-sync",
      }),
    ).rejects.toMatchObject({ kind: "UNAVAILABLE" });
  }, 30_000);

  it("reports the daemon going away", async () => {
    const dir = await spawnNative();
    const l = link({
      socketPath: join(dir, "native/run/meshdata.sock"),
      pairingFile: join(dir, "native/pairing"),
    });
    await l.connect();
    const gone = new Promise<void>((resolve) => l.once("disconnected", () => resolve()));
    for (const c of children) c.kill("SIGKILL");
    await gone;
    expect(l.connected).toBe(false);
  }, 30_000);
});

describe("inbound lanes — the ordering hazard", () => {
  it("replays bytes that arrived BEFORE the lane was claimed, in order", async () => {
    // The hazard: an inbound lane is announced on mgmt while its DATA arrives
    // on this socket. Different transports, no shared ordering — so bytes for
    // a not-yet-subscribed lane are NORMAL. Dropping them would lose the first
    // update of every inbound lane, which reads as a rare random sync bug
    // rather than as the structural race it is.
    const bridge = await fakeBridge();
    const l = link(bridge);
    await l.connect();

    bridge.sendData(7, bytes("first"));
    bridge.sendData(7, bytes("second"));
    await tick();

    const seen: string[] = [];
    l.onLane(7, (p) => seen.push(text(p)));
    expect(seen).toEqual(["first", "second"]);

    // and live delivery continues normally afterwards
    bridge.sendData(7, bytes("third"));
    await tick();
    expect(seen).toEqual(["first", "second", "third"]);
  }, 30_000);

  it("keeps unclaimed lanes apart", async () => {
    const bridge = await fakeBridge();
    const l = link(bridge);
    await l.connect();
    bridge.sendData(1, bytes("for-one"));
    bridge.sendData(2, bytes("for-two"));
    await tick();

    const one: string[] = [];
    l.onLane(1, (p) => one.push(text(p)));
    expect(one).toEqual(["for-one"]);

    const two: string[] = [];
    l.onLane(2, (p) => two.push(text(p)));
    expect(two).toEqual(["for-two"]);
  }, 30_000);

  it("expires bytes for a lane that is never announced", async () => {
    // An announcement that never comes must not become permanent memory.
    const bridge = await fakeBridge();
    const l = link({ ...bridge, orphanTtlMs: 80 });
    await l.connect();
    bridge.sendData(9, bytes("nobody-claims-me"));
    await new Promise((r) => setTimeout(r, 200));

    const seen: string[] = [];
    l.onLane(9, (p) => seen.push(text(p)));
    expect(seen).toEqual([]); // expired, not replayed
  }, 30_000);

  it("sheds past the per-lane watermark instead of growing without bound", async () => {
    // PF4: every queue has a watermark and a named shed strategy.
    const bridge = await fakeBridge();
    const l = link({ ...bridge, orphanMaxBytes: 16 });
    await l.connect();
    bridge.sendData(3, bytes("0123456789")); // 10 bytes, held
    bridge.sendData(3, bytes("0123456789")); // would exceed 16 — shed
    await tick();

    const seen: string[] = [];
    l.onLane(3, (p) => seen.push(text(p)));
    expect(seen).toEqual(["0123456789"]);
  }, 30_000);

  it("counts parked bytes as bytes it actually retains", async () => {
    // A decoded payload is a VIEW over the reader's whole buffer. Parking the
    // view retains the entire socket read for a handful of bytes, so `bytes`
    // undercounts what is held and the watermark measures the wrong thing.
    // Proof is in the backing store: a copy's ArrayBuffer is payload-sized, a
    // view's is the size of everything that arrived with it.
    const bridge = await fakeBridge();
    const l = link({ ...bridge, orphanMaxBytes: 4096 });
    await l.connect();
    // A tiny record travelling alongside a large one, in one read.
    bridge.sendData(4, bytes("tiny"));
    bridge.sendData(5, new Uint8Array(2048));
    await tick();

    const held: Uint8Array[] = [];
    l.onLane(4, (p) => held.push(p));
    expect(held).toHaveLength(1);
    expect(text(held[0] as Uint8Array)).toBe("tiny");
    expect(held[0]?.buffer.byteLength).toBe(4);
  }, 30_000);

  it("refuses to queue past the outbound watermark instead of buffering forever", async () => {
    // PF4's other half. Node buffers an ignored write() without limit, and this
    // is the plane whole snapshots cross — an unbounded write buffer is how a
    // stalled bridge becomes an OOM. Refuse loudly; never drop a doc update.
    const bridge = await fakeBridge();
    const l = link({ ...bridge, sendMaxBufferedBytes: 1024 });
    await l.connect();
    expect(l.bufferedBytes).toBe(0);
    // The fake never reads, so the socket buffer only grows.
    let refused: Error | null = null;
    try {
      for (let i = 0; i < 5_000; i++) l.send(1, new Uint8Array(4096));
    } catch (error) {
      refused = error as Error;
    }
    expect(refused).not.toBeNull();
    expect(refused?.message).toMatch(/send buffer is full/);
  }, 30_000);

  it("does not leak a handshake listener per reconnect", async () => {
    // `once` removes only the listener that fires; the other stays registered
    // and accumulates — MaxListenersExceededWarning at 11, then a slow leak.
    const bridge = await fakeBridge();
    const l = link(bridge);
    for (let i = 0; i < 12; i++) {
      await l.connect();
      l.connected = false; // force the next connect() through the handshake
    }
    expect(l.listenerCount("hello-ok")).toBe(0);
    expect(l.listenerCount("hello-refused")).toBe(0);
  }, 30_000);

  it("sends opaque bytes through to the bridge unchanged", async () => {
    const bridge = await fakeBridge();
    const l = link(bridge);
    await l.connect();
    // a Loro update record is arbitrary binary — including NULs, which a
    // string-shaped path would corrupt
    const payload = new Uint8Array([0, 1, 2, 0, 255, 128, 0]);
    l.send(5, payload);
    await tick();
    const got = bridge.received();
    expect(got).toHaveLength(1);
    expect(got[0]?.laneId).toBe(5);
    expect([...(got[0]?.payload ?? [])]).toEqual([...payload]);
  }, 30_000);
});
