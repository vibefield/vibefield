// DR-3b (W3, VF-RELAY) — `field.drive.v1`, this desktop's holders slice (src/drive/holders.ts; contracts drive.ts
// `DriveHoldersSlice`): DocHoldersService's shape for the drive. The slice is DISCOVERY, published per the contract
// while the drive is OPEN, whatever the floor's file transfer can do (the W3 critic's finding 2, VF-PM's W3-9).
// Against the scripted floor (the first row: the slice lands in STORES.DRIVE's own map) and an in-memory store.
// Nothing here pulls: the DrivePulls these rows compose answer from floors that accept no pull, so UNUSED_ROOT is a
// path no row reads or makes.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DRIVE_PROTOCOL,
  DriveHoldersSlice,
  isPipeEndpoint,
  SOCKETS,
  STORES,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { DriveHolders, type DriveHolding } from "../src/drive/holders";
import { DriveLaneRelay } from "../src/drive/lane-relay";
import { DrivePulls } from "../src/drive/pulls";
import { DriveService } from "../src/drive/service";
import { OutboundLaneIdAllocator } from "../src/lane-id";
import { MeshClient } from "../src/mesh-client";
import { NativeLink, RpcCallError } from "../src/native-link";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import {
  FakeDriveLaneBytes,
  FakeDriveLaneControl,
  FakeDriveStore,
  sleep,
  streamRefusedOnce,
  unsupportedFloor,
  until,
} from "./drive-fakes";
import { nativeEndpoint } from "./native-harness";

const NOW = 1_800_000_000_000;
const READY: DriveHolding = { state: "ready", held: { objects: 3, bytes: 4_096 } };
const UNUSED_ROOT = join(tmpdir(), "vf-dh-never-read");
const SUBSCRIBE = "native.mesh.fileTransfer.subscribe";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** The scripted floor over a real NativeLink, and MeshClient over it: the production path to the store. */
async function floor(): Promise<{ mock: MockMgmtServer; mesh: MeshClient }> {
  const dir = mkdtempSync(join(tmpdir(), "vf-dh-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "pairing"), "ab".repeat(32));
  const endpoint = nativeEndpoint(dir, SOCKETS.MGMT);
  if (!isPipeEndpoint(endpoint)) mkdirSync(dirname(endpoint), { recursive: true });
  const mock = new MockMgmtServer(endpoint);
  await mock.start();
  cleanup.push(() => mock.stop());
  const link = new NativeLink({
    socketPath: endpoint,
    pairingFile: join(dir, "pairing"),
    bootId: "b",
  });
  cleanup.push(() => link.close());
  await link.connect();
  return { mock, mesh: new MeshClient(link) };
}

function holders(
  store: FakeDriveStore,
  deviceId: string,
  drive: () => DriveHolding | null = () => READY,
  linked: () => boolean = () => true,
): DriveHolders {
  const service = new DriveHolders({
    mesh: store.member(deviceId),
    deviceId: () => deviceId,
    drive,
    linked,
    debounceMs: 5,
    now: () => NOW,
  });
  cleanup.push(() => service.stop());
  return service;
}

/** The lane relay over fakes: these rows are the slice's. */
function relay(): DriveLaneRelay {
  return new DriveLaneRelay({
    control: new FakeDriveLaneControl(),
    bytes: new FakeDriveLaneBytes(),
    allocateLaneId: new OutboundLaneIdAllocator().allocate,
    isSelfPeer: () => true,
  });
}

/** A slice as a desktop publishes it. */
function slice(deviceId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    deviceId,
    protocol: DRIVE_PROTOCOL,
    state: "ready",
    held: { objects: 1, bytes: 10 },
    publishedAt: NOW,
    ...over,
  };
}

const ids = (service: DriveHolders) => service.holders().map((held) => held.deviceId);

describe("DR-3b — the drive's holders slice", () => {
  it("publishes a valid slice under its own deviceId, into STORES.DRIVE's own map on the floor", async () => {
    const { mock, mesh } = await floor();
    const studio = new DriveHolders({
      mesh,
      deviceId: () => mock.meshDeviceId,
      drive: () => READY,
      linked: () => true,
      now: () => NOW,
    });
    cleanup.push(() => studio.stop());
    await studio.start();
    expect(mock.driveStoreWrites).toHaveLength(1);
    expect(DriveHoldersSlice.parse(mock.driveStoreSlices.get(mock.meshDeviceId))).toEqual({
      deviceId: mock.meshDeviceId,
      protocol: DRIVE_PROTOCOL,
      state: "ready",
      held: { objects: 3, bytes: 4_096 },
      publishedAt: NOW,
    });
    // DEVICES keeps its own: a drive slice never shows in a devices snapshot
    expect(mock.storeWrites).toEqual([]);
    expect(Object.fromEntries(mock.storeSlices)).toEqual({ "dev-self": { hello: 1 } });
  });

  it("coalesces a burst of changes into one publish", async () => {
    const store = new FakeDriveStore();
    const studio = holders(store, "studio");
    await studio.start();
    expect(store.writes).toHaveLength(1);
    for (let i = 0; i < 5; i++) studio.schedule();
    await until(() => store.writes.length === 2, "the burst's one publish");
    await sleep(30);
    expect(store.writes).toHaveLength(2);
    expect(store.writes.every((write) => write.storeId === STORES.DRIVE)).toBe(true);
  });

  it("lets a store snapshot replace what it heard", async () => {
    const store = new FakeDriveStore();
    store.put("laptop", slice("laptop"));
    store.put("attic", slice("attic"));
    const studio = holders(store, "studio");
    await studio.start();
    expect(ids(studio)).toEqual(["attic", "laptop"]);
    // the attic left while the stream lagged: the re-snapshot is the truth
    store.slices.delete("attic");
    store.resnapshot();
    expect(ids(studio)).toEqual(["laptop"]);
  });

  it("merges deltas: a desktop's slice joins, changes, and leaves", async () => {
    const store = new FakeDriveStore();
    const studio = holders(store, "studio");
    await studio.start();
    store.put("laptop", slice("laptop"));
    expect(studio.holders()).toEqual([slice("laptop")]);
    store.put("laptop", slice("laptop", { state: "copying" }));
    expect(studio.holders().map((held) => held.state)).toEqual(["copying"]);
    store.leave("laptop");
    expect(studio.holders()).toEqual([]);
  });

  it("holds no slice under another desktop's key, nor one in a protocol this tree does not speak", async () => {
    const store = new FakeDriveStore();
    const studio = holders(store, "studio");
    await studio.start();
    store.put("laptop", slice("attic"));
    store.put("attic", slice("attic", { protocol: DRIVE_PROTOCOL + 1 }));
    store.put("den", { deviceId: "den", protocol: DRIVE_PROTOCOL });
    store.put("loft", slice("loft"));
    expect(ids(studio)).toEqual(["loft"]);
  });

  it("publishes while the drive is open on a floor that cannot pull, nothing while closed or unlinked, and again after a failed publish", async () => {
    const store = new FakeDriveStore();
    let open = false;
    let linked = true;
    const studio = holders(
      store,
      "studio",
      () => (open ? READY : null),
      () => linked,
    );
    const pulls = new DrivePulls({
      floor: unsupportedFloor(),
      userRoot: UNUSED_ROOT,
      roots: () => [],
      bootId: () => "boot-1",
      linked: () => linked,
    });
    const service = new DriveService({ relay: relay(), pulls, holders: studio });
    cleanup.push(() => service.stop());
    await service.start();
    expect(pulls.unsupported()).toBe(true);
    // closed: no slice, whatever else is true
    expect(store.writes).toEqual([]);
    open = true;
    // unlinked (a capture, say): no account to scope a slice to
    linked = false;
    await studio.publish();
    expect(store.writes).toEqual([]);
    linked = true;
    store.failNextSet = true;
    await service.driveChanged();
    await until(() => !store.failNextSet, "the failed publish");
    expect(store.writes).toEqual([]);
    // the next change publishes it: the slice is a fact about now
    await service.driveChanged();
    await until(() => store.writes.length === 1, "the next change's publish");
    expect(DriveHoldersSlice.parse(store.writes[0]?.data)).toMatchObject({
      deviceId: "studio",
      protocol: DRIVE_PROTOCOL,
      state: "ready",
    });
  });

  it("withdraws its slice once the drive closes: one null slice, and no peer holds it", async () => {
    // drive.ts: a desktop whose drive is not open publishes no slice at all, and the store has no withdraw verb
    const store = new FakeDriveStore();
    let open = true;
    const studio = holders(store, "studio", () => (open ? READY : null));
    const laptop = holders(store, "laptop", () => null);
    await laptop.start();
    await studio.start();
    expect(ids(laptop)).toEqual(["studio"]);
    open = false;
    studio.schedule();
    await until(() => store.writes.length === 2, "the withdrawal");
    expect(store.writes[1]).toEqual({ deviceId: "studio", storeId: STORES.DRIVE, data: null });
    expect(ids(laptop)).toEqual([]);
    // once: a drive still closed writes nothing more, and the laptop, never open, never wrote
    await studio.publish();
    expect(store.writes.map((write) => write.deviceId)).toEqual(["studio", "studio"]);
  });

  it("hears the store again at node-up after a refused subscribe, and the service re-arms the pulls' stream with it", async () => {
    const store = new FakeDriveStore();
    store.put("laptop", slice("laptop"));
    store.failNextSubscribe = true;
    const studio = holders(store, "studio");
    const notUp = { service: "mesh-gateway", state: "starting" };
    const refusal = new RpcCallError("UNAVAILABLE", "mesh node not up", true, notUp, -32006);
    const refusedOnce = streamRefusedOnce(refusal);
    const pulls = new DrivePulls({
      floor: refusedOnce,
      userRoot: UNUSED_ROOT,
      roots: () => [],
      bootId: () => "boot-1",
      linked: () => true,
    });
    const service = new DriveService({ relay: relay(), pulls, holders: studio });
    cleanup.push(() => service.stop());
    await service.start();
    expect(ids(studio)).toEqual([]);
    expect(refusedOnce.asked.filter((method) => method === SUBSCRIBE)).toHaveLength(1);
    await service.nodeUp();
    expect(ids(studio)).toEqual(["laptop"]);
    expect(refusedOnce.asked.filter((method) => method === SUBSCRIBE)).toHaveLength(2);
  });
});
