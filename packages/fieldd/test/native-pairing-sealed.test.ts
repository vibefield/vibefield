// OB custody (C3) — THE FLOOR IS HANDED ITS PAIRING.
//
// At `files` the floor makes `native/pairing` and fieldd reads it at every hello; whoever else reads that file may
// say `native.lifecycle.hello`, supersede fieldd and hold every `native.*` row (T2). A fieldd handed custody takes the
// D8 secret from its hand-off instead and never touches the file: it pairs with a floor that was handed the same
// secret, and a fieldd restarted beside that floor is handed it again by the shell and pairs with the floor it left.
// The handshake itself, its vector and `meshdata.sock` do not move: only where the secret comes from.
//
// fieldd's half, here in two parts:
//   · the daemon over the mock floor, which here CHECKS the client's MAC under the handed secret
//     (`MockMgmtServer.verifyClientMac`), so "paired" means the handed secret was the one used;
//   · the two links alone (`NativeLink`, `MeshLaneLink`) and their `pairingSecret` source.
// The spawn (the flag, the pipe, the one line, the verifier seam) is native-bootstrap.test.ts's, with a fake child,
// and custody-boot.test.ts's under the real entry.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import {
  encodeMeshDataJsonFrame,
  isPipeEndpoint,
  LAYOUT,
  MESHDATA_FRAME,
  MeshDataFrameReader,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap, type FielddCustody } from "../src/index";
import { MeshLaneLink } from "../src/mesh-lane";
import { NativeLink } from "../src/native-link";
import { computeAckMac, computePairingMac } from "../src/pairing";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { bootSealed, type Cleanup, HANDED, runCleanup } from "./custody-harness";
import { nativeEndpoint, removeTempRoot, shortTmpRoot } from "./native-harness";

const cleanup: Cleanup = [];
afterEach(() => runCleanup(cleanup));

/** The floor's pairing as a spawner derives it: NOT the mock floor's default, so a link that fell back to any
 * other secret does not pair. */
const FLOOR_SECRET = "d7".repeat(32);
const SEALED: FielddCustody = { ...HANDED, pairing: FLOOR_SECRET };
const pairingFile = (dataDir: string): string => join(dataDir, ...LAYOUT.PAIRING_FILE);
/** A floor that holds the handed secret and checks every hello's MAC under it. */
const checking = (mock: MockMgmtServer): void => {
  mock.verifyClientMac = true;
};

describe("a sealed fieldd and its floor (C3)", () => {
  it("pairs from the hand-off, reading no file", async () => {
    const { dataDir, mock, daemon } = await bootSealed(cleanup, {
      custody: SEALED,
      floorFile: false,
      floor: checking,
    });
    expect(daemon.health().nativeConnected).toBe(true);
    expect(mock.refusedHellos).toBe(0);
    // no file was there to read, and none was made
    expect(existsSync(pairingFile(dataDir))).toBe(false);
  });

  it("a file left on the root is not read: the handed secret is the one used", async () => {
    // what a `files` floor left behind, under another secret: a fieldd that read it would be refused
    const stale = "00".repeat(32);
    const { dataDir, mock, daemon } = await bootSealed(cleanup, {
      custody: SEALED,
      floorFile: false,
      floor: checking,
      before: (root) => writeFileSync(pairingFile(root), stale),
    });
    expect(daemon.health().nativeConnected).toBe(true);
    expect(mock.refusedHellos).toBe(0);
    // and it is left as it was found: the floor's file is never fieldd's to write or remove
    expect(readFileSync(pairingFile(dataDir), "utf8")).toBe(stale);
  });

  it("a fieldd handed another secret does not pair", async () => {
    // the control for the two rows above: this floor does refuse a MAC made under a secret that is not its own
    const dataDir = shortTmpRoot("vf-cust-");
    cleanup.push(() => removeTempRoot(dataDir));
    mkdirSync(join(dataDir, ...LAYOUT.NATIVE_RUN_DIR), { recursive: true });
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    mock.pairingSecretHex = FLOOR_SECRET;
    mock.verifyClientMac = true;
    await mock.start();
    cleanup.push(() => mock.stop());

    const other: FielddCustody = { ...HANDED, pairing: "e8".repeat(32) };
    // the floor's own words for a MAC it does not verify (field-native mgmt/mod.rs), not retryable
    await expect(bootstrap({ dataDir, controlPort: 0, custody: other })).rejects.toThrow(
      /pairing verification failed/,
    );
    expect(mock.refusedHellos).toBeGreaterThan(0);
    expect(existsSync(pairingFile(dataDir))).toBe(false);
  });

  it("a restarted fieldd re-pairs with the floor it left", async () => {
    const world = await bootSealed(cleanup, {
      custody: SEALED,
      floorFile: false,
      floor: checking,
    });
    const { dataDir, mock, daemon: first } = world;
    expect(first.health().nativeConnected).toBe(true);
    await first.stop();
    const before = mock.connections;

    // the same floor, still running; the shell hands the next fieldd the same derived secret
    const second = await bootstrap({ dataDir, controlPort: 0, custody: SEALED });
    cleanup.push(() => second.stop());
    expect(second.bootId).not.toBe(first.bootId);
    expect(second.health().nativeConnected).toBe(true);
    expect(mock.connections).toBeGreaterThan(before);
    expect(mock.refusedHellos).toBe(0);
    expect(existsSync(pairingFile(dataDir))).toBe(false);
  });

  it("a floor that comes back under a sealed fieldd is paired again from the same source", async () => {
    const { mock, daemon } = await bootSealed(cleanup, {
      custody: SEALED,
      floorFile: false,
      floor: checking,
    });
    const before = mock.connections;
    // the mgmt socket drops (the mock stays listening): the link redials and hellos afresh
    mock.killClients();
    await until(() => mock.connections > before && daemon.native.connected, "the re-pair");
    expect(mock.refusedHellos).toBe(0);
  });
});

async function until(holds: () => boolean, what: string, ms = 8_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!holds()) {
    if (Date.now() > deadline) throw new Error(`${what} did not happen within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** A mock floor's mgmt endpoint under a fresh root, with no pairing file anywhere near it. */
async function checkingFloor(): Promise<{ dataDir: string; mock: MockMgmtServer }> {
  const dataDir = shortTmpRoot("vf-cust-");
  cleanup.push(() => removeTempRoot(dataDir));
  mkdirSync(join(dataDir, ...LAYOUT.NATIVE_RUN_DIR), { recursive: true });
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.pairingSecretHex = FLOOR_SECRET;
  mock.verifyClientMac = true;
  await mock.start();
  cleanup.push(() => mock.stop());
  return { dataDir, mock };
}

describe("NativeLink's pairing secret (C3)", () => {
  it("with a source it touches no file, and `connect` gates on the socket alone", async () => {
    const { dataDir, mock } = await checkingFloor();
    let asked = 0;
    const link = new NativeLink({
      socketPath: mock.endpoint,
      pairingSecret: () => {
        asked += 1;
        return FLOOR_SECRET;
      },
      bootId: "fieldd-sealed-link",
    });
    cleanup.push(() => link.close());
    await link.connect();
    expect(link.connected).toBe(true);
    expect(mock.refusedHellos).toBe(0);
    expect(asked).toBe(1);
    expect(existsSync(pairingFile(dataDir))).toBe(false);

    // a re-pair asks the source again: nothing of the secret is kept by the link between hellos
    const before = mock.connections;
    mock.killClients();
    await until(() => mock.connections > before && link.connected, "the re-pair");
    expect(asked).toBe(2);
    expect(mock.refusedHellos).toBe(0);
  });

  it("a source wins over a file: the file is not read", async () => {
    const { dataDir, mock } = await checkingFloor();
    writeFileSync(pairingFile(dataDir), "00".repeat(32));
    const link = new NativeLink({
      socketPath: mock.endpoint,
      pairingFile: pairingFile(dataDir),
      pairingSecret: () => FLOOR_SECRET,
      bootId: "fieldd-sealed-link",
    });
    cleanup.push(() => link.close());
    await link.connect();
    expect(link.connected).toBe(true);
    expect(mock.refusedHellos).toBe(0);
  });

  it("a link with neither a source nor a file is refused when it is made", () => {
    const bare = { socketPath: "/nowhere/native.sock", bootId: "fieldd-bare-link" };
    expect(() => new NativeLink(bare)).toThrow(/pairing/);
    expect(() => new MeshLaneLink(bare)).toThrow(/pairing/);
  });

  // A GUARD, not a red row: the `files` link is today's, a file read at every hello and waited for at the first.
  it("with a file alone it is today's link", async () => {
    const { dataDir, mock } = await checkingFloor();
    writeFileSync(pairingFile(dataDir), FLOOR_SECRET);
    const link = new NativeLink({
      socketPath: mock.endpoint,
      pairingFile: pairingFile(dataDir),
      bootId: "fieldd-files-link",
    });
    cleanup.push(() => link.close());
    await link.connect();
    expect(link.connected).toBe(true);

    // and with no file yet it waits for the floor to make one, then gives up by name
    const { dataDir: bare, mock: floor } = await checkingFloor();
    const waiting = new NativeLink({
      socketPath: floor.endpoint,
      pairingFile: pairingFile(bare),
      bootId: "fieldd-files-link",
      waitForDaemonMs: 300,
    });
    cleanup.push(() => waiting.close());
    await expect(waiting.connect()).rejects.toThrow(/did not come up/);
    expect(floor.connections).toBe(0);
  });
});

/** A MeshData bridge that holds `secretHex`: it checks the client's MAC under it and proves its own (WIN-10). */
async function checkingBridge(secretHex: string): Promise<{
  socketPath: string;
  refused: () => number;
  accepted: () => number;
}> {
  const dataDir = shortTmpRoot("vf-cust-");
  cleanup.push(() => removeTempRoot(dataDir));
  const endpoint = nativeEndpoint(dataDir, SOCKETS.MESHDATA);
  if (!isPipeEndpoint(endpoint)) {
    mkdirSync(join(dataDir, ...LAYOUT.NATIVE_RUN_DIR), { recursive: true });
  }
  let refused = 0;
  let accepted = 0;
  const server: Server = createServer((sock) => {
    const reader = new MeshDataFrameReader();
    sock.on("error", () => undefined);
    sock.on("data", (chunk: Buffer) => {
      for (const frame of reader.push(new Uint8Array(chunk))) {
        if (frame.kind !== MESHDATA_FRAME.HELLO) continue;
        const said = JSON.parse(new TextDecoder().decode(frame.payload)) as {
          bootId: string;
          ts: number;
          mac: string;
          nonce: string;
        };
        if (said.mac !== computePairingMac(secretHex, said.bootId, said.ts)) {
          refused += 1;
          sock.end(encodeMeshDataJsonFrame(MESHDATA_FRAME.ERR, 0, { reason: "bad pairing" }));
          continue;
        }
        accepted += 1;
        sock.write(
          encodeMeshDataJsonFrame(MESHDATA_FRAME.HELLO_OK, 0, {
            serverMac: computeAckMac(secretHex, said.nonce, said.bootId),
          }),
        );
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(endpoint, resolve));
  cleanup.push(() => {
    server.close();
  });
  return { socketPath: endpoint, refused: () => refused, accepted: () => accepted };
}

describe("MeshLaneLink's pairing secret (C3)", () => {
  it("takes the same source, and touches no file", async () => {
    const bridge = await checkingBridge(FLOOR_SECRET);
    const lane = new MeshLaneLink({
      socketPath: bridge.socketPath,
      pairingSecret: () => FLOOR_SECRET,
      bootId: "fieldd-sealed-lane",
    });
    cleanup.push(() => lane.close());
    await lane.connect();
    expect(lane.connected).toBe(true);
    expect(bridge.accepted()).toBe(1);
    expect(bridge.refused()).toBe(0);
  });

  it("a source that is not the bridge's secret is refused by the bridge", async () => {
    // the control: this bridge does check the MAC
    const bridge = await checkingBridge(FLOOR_SECRET);
    const lane = new MeshLaneLink({
      socketPath: bridge.socketPath,
      pairingSecret: () => "e8".repeat(32),
      bootId: "fieldd-sealed-lane",
    });
    cleanup.push(() => lane.close());
    await expect(lane.connect()).rejects.toThrow(/refused|closed/);
    expect(bridge.accepted()).toBe(0);
    expect(bridge.refused()).toBe(1);
  });
});
