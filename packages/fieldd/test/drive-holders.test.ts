// DR-3b (W3, VF-RELAY) — `field.drive.v1`, this desktop's holders slice (src/drive/holders.ts; contracts drive.ts
// `DriveHoldersSlice`): DocHoldersService's shape for the drive. The slice is DISCOVERY, published per the contract
// while the drive is OPEN, whatever the floor's file transfer can do (the W3 critic's finding 2, VF-PM's W3-9).
// Against the scripted floor (the first row: the slice lands in STORES.DRIVE's own map; the floor-restart row: a real
// NativeLink's refused replay) and an in-memory store.
// Nothing here pulls: the DrivePulls these rows compose answer from floors that accept no pull, so UNUSED_ROOT is a
// path no row reads or makes.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  DRIVE_PROTOCOL,
  DriveHoldersSlice,
  isPipeEndpoint,
  MESHDATA_INBOUND_LANE_ID_BASE,
  SOCKETS,
  STORES,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DriveHolders,
  type DriveHoldersMesh,
  type DriveHoldersOptions,
  type DriveHolding,
} from "../src/drive/holders";
import { DriveLaneRelay } from "../src/drive/lane-relay";
import { DrivePulls, type DrivePullsFloor } from "../src/drive/pulls";
import { DriveService } from "../src/drive/service";
import { OutboundLaneIdAllocator } from "../src/lane-id";
import { MeshClient } from "../src/mesh-client";
import { NativeLink, RpcCallError } from "../src/native-link";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import {
  afterTurns,
  answeringFloor,
  type CapturedLog,
  captureLogger,
  FakeDriveLaneBytes,
  FakeDriveLaneControl,
  FakeDriveStore,
  gate,
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
const STORE_SUBSCRIBE = "native.mesh.store.subscribe";
const IN = MESHDATA_INBOUND_LANE_ID_BASE;
/** A peer's drive lane as the lane table lists it. */
const INBOUND = { laneId: IN, class: "reliable", peer: "peer-a", protocol: "drive", inbound: true };

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** The scripted floor over a real NativeLink, and MeshClient over it: the production path to the store. */
async function floor(): Promise<{ mock: MockMgmtServer; mesh: MeshClient; link: NativeLink }> {
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
  return { mock, mesh: new MeshClient(link), link };
}

function holders(
  store: FakeDriveStore,
  deviceId: string,
  drive: () => DriveHolding | null = () => READY,
  linked: () => boolean = () => true,
  over: Partial<DriveHoldersOptions> = {},
): DriveHolders {
  const service = new DriveHolders({
    mesh: store.member(deviceId),
    deviceId: () => deviceId,
    drive,
    linked,
    debounceMs: 5,
    now: () => NOW,
    ...over,
  });
  cleanup.push(() => service.stop());
  return service;
}

/** The lane relay over fakes: these rows are the slice's. */
function relay(
  control = new FakeDriveLaneControl(),
  bytes = new FakeDriveLaneBytes(),
): DriveLaneRelay {
  return new DriveLaneRelay({
    control,
    bytes,
    allocateLaneId: new OutboundLaneIdAllocator().allocate,
    isSelfPeer: () => true,
  });
}

/** The whole service over `store`, its lane planes in hand: an open drive, published as "studio". */
function composed(store: FakeDriveStore, pullsFloor: DrivePullsFloor = unsupportedFloor()) {
  const control = new FakeDriveLaneControl();
  const bytes = new FakeDriveLaneBytes();
  const pulls = new DrivePulls({
    floor: pullsFloor,
    userRoot: UNUSED_ROOT,
    roots: () => [],
    bootId: () => "boot-1",
    linked: () => true,
  });
  const service = new DriveService({
    relay: relay(control, bytes),
    pulls,
    holders: holders(store, "studio"),
  });
  cleanup.push(() => service.stop());
  return { control, bytes, pulls, service };
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
const withdrawn = (store: FakeDriveStore) => store.writes.map((write) => write.data === null);

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

  it("hears the store again at the node-up after a floor restart refused NativeLink's replay", async () => {
    const { mock, mesh, link } = await floor();
    const storeSubscribes = () => mock.meshCalls.filter((m) => m === STORE_SUBSCRIBE).length;
    const studio = new DriveHolders({
      mesh,
      deviceId: () => mock.meshDeviceId,
      drive: () => READY,
      linked: () => true,
      now: () => NOW,
    });
    cleanup.push(() => studio.stop());
    mock.driveStoreSlices.set("attic", slice("attic"));
    await studio.start();
    expect(ids(studio)).toEqual(["attic"]);
    // a fresh floor boots with no node: the replay meets the node gate, and its entry stays with no route
    mock.meshUnavailable = true;
    const redialled = new Promise((resolve) => link.once("connected", resolve));
    mock.killClients();
    await redialled;
    expect(storeSubscribes()).toBe(2);
    // "connected" asks at once, and the gate refuses that too
    await studio.nodeUp();
    expect(storeSubscribes()).toBe(3);
    // the node comes up, holding a store this desktop has not heard
    mock.meshUnavailable = false;
    mock.driveStoreSlices.delete("attic");
    mock.driveStoreSlices.set("laptop", slice("laptop"));
    await studio.nodeUp();
    expect(storeSubscribes()).toBe(4);
    expect(ids(studio)).toEqual(["laptop"]);
    // and the stream it made is the one that hears
    const data = slice("loft");
    mock.pushStoreDelta({ kind: "peerUpdated", deviceId: "loft", data, version: 1 }, STORES.DRIVE);
    await until(() => ids(studio).includes("loft"), "a desktop heard on the new stream", 8_000);
  });

  it("hears the new store at a node-up over a live link: a node built anew leaves the old stream quiet", async () => {
    const store = new FakeDriveStore();
    store.put("laptop", slice("laptop"));
    const studio = holders(store, "studio");
    await studio.start();
    expect(ids(studio)).toEqual(["laptop"]);
    store.rebuild();
    store.put("attic", slice("attic"));
    expect(ids(studio)).toEqual(["laptop"]);
    await studio.nodeUp();
    expect(ids(studio)).toEqual(["attic", "laptop"]);
    store.put("den", slice("den"));
    expect(ids(studio)).toEqual(["attic", "den", "laptop"]);
    // published again into the new store, and the old entry let go: NativeLink replays one stream, never two
    expect(store.writes).toHaveLength(2);
    expect(store.subscribes).toBe(2);
    expect(store.disposed).toBe(1);
  });

  it("keeps one entry through every node-up", async () => {
    const store = new FakeDriveStore();
    const studio = holders(store, "studio");
    await studio.start();
    await studio.nodeUp();
    await studio.nodeUp();
    expect(store.subscribes).toBe(3);
    expect(store.disposed).toBe(2);
  });

  it("lets go the stream a subscribe in flight at a node-up got, and makes its own: that one may have left before the node", async () => {
    const store = new FakeDriveStore();
    store.put("laptop", slice("laptop"));
    const studio = holders(store, "studio");
    const held = gate();
    store.subscribeGate = held.waits;
    const started = studio.start();
    const up = studio.nodeUp();
    await sleep(20);
    expect(store.subscribes).toBe(1);
    held.open();
    await Promise.all([started, up]);
    expect(store.subscribes).toBe(2);
    expect(store.disposed).toBe(1);
    expect(ids(studio)).toEqual(["laptop"]);
  });

  it("makes its own subscribe at a node-up behind a subscribe in flight that is refused", async () => {
    const store = new FakeDriveStore();
    store.put("laptop", slice("laptop"));
    const studio = holders(store, "studio");
    const held = gate();
    store.subscribeGate = held.waits;
    store.failNextSubscribe = true;
    const started = studio.start();
    const up = studio.nodeUp();
    await sleep(20);
    expect(store.subscribes).toBe(1);
    store.subscribeGate = null;
    held.open();
    await Promise.all([started, up]);
    expect(store.subscribes).toBe(2);
    expect(ids(studio)).toEqual(["laptop"]);
  });

  it("keeps hearing the stream it had when a node-up's subscribe is refused, and lets it go once one is answered", async () => {
    const store = new FakeDriveStore();
    store.put("laptop", slice("laptop"));
    const studio = holders(store, "studio");
    await studio.start();
    // a node that was not built anew: the stream that stands hears the live store
    store.failNextSubscribe = true;
    await studio.nodeUp();
    store.put("attic", slice("attic"));
    store.leave("laptop");
    expect(ids(studio)).toEqual(["attic"]);
    expect(store.subscribes).toBe(2);
    expect(store.disposed).toBe(0);
    await studio.nodeUp();
    expect(store.subscribes).toBe(3);
    expect(store.disposed).toBe(1);
    store.put("den", slice("den"));
    expect(ids(studio)).toEqual(["attic", "den"]);
  });

  it("lets both streams go when stopped during a node-up's subscribe, and subscribes no more", async () => {
    const store = new FakeDriveStore();
    const studio = holders(store, "studio");
    await studio.start();
    const held = gate();
    store.subscribeGate = held.waits;
    const up = studio.nodeUp();
    await until(() => store.subscribes === 2, "the node-up's subscribe");
    // stop lets the stream that stood go at once, and the answer goes as it comes
    studio.stop();
    expect(store.disposed).toBe(1);
    held.open();
    await up;
    expect(store.disposed).toBe(2);
    await studio.nodeUp();
    await studio.start();
    expect(store.subscribes).toBe(2);
    expect(store.writes).toHaveLength(1);
  });

  it("keeps one entry when a start lands at any turn after a node-up's refused subscribe", async () => {
    for (let turns = 0; turns < 16; turns++) {
      const store = new FakeDriveStore();
      const member = store.member("studio");
      let race = false;
      const mesh: DriveHoldersMesh = {
        setSlice: (storeId, data) => member.setSlice(storeId, data),
        subscribeStoreManaged: (storeId, onEvent) => {
          const answer = member.subscribeStoreManaged(storeId, onEvent);
          if (race) {
            race = false;
            answer.catch(() => afterTurns(turns, () => void studio.start()));
          }
          return answer;
        },
      };
      const studio = holders(store, "studio", undefined, undefined, { mesh });
      await studio.start();
      store.failNextSubscribe = true;
      race = true;
      await studio.nodeUp();
      // the fakes answer in microtasks, so every turn has run by the next timer
      await sleep(5);
      const entries = store.subscribes - 1 - store.disposed;
      expect(entries, `the refused one is no entry; a start ${turns} turns on`).toBe(1);
    }
  });

  it("makes no second subscribe at a repeated start, while a stream stands", async () => {
    const store = new FakeDriveStore();
    const studio = holders(store, "studio");
    await studio.start();
    await studio.start();
    expect(store.subscribes).toBe(1);
  });

  it("withdraws nothing while unlinked, and withdraws once linked again", async () => {
    const store = new FakeDriveStore();
    let open = true;
    let linked = true;
    const studio = holders(
      store,
      "studio",
      () => (open ? READY : null),
      () => linked,
    );
    await studio.start();
    expect(withdrawn(store)).toEqual([false]);
    // a capture: no account to scope a slice to, a null one included
    open = false;
    linked = false;
    await studio.publish();
    expect(withdrawn(store)).toEqual([false]);
    linked = true;
    await studio.publish();
    expect(withdrawn(store)).toEqual([false, true]);
  });

  it("logs a slice outside its contract and writes nothing, and publishes once it is inside", async () => {
    const store = new FakeDriveStore();
    const events: CapturedLog[] = [];
    let deviceId = "";
    const studio = holders(store, "studio", undefined, undefined, {
      deviceId: () => deviceId,
      logger: captureLogger(events),
    });
    await studio.publish();
    expect(store.writes).toEqual([]);
    expect(events.map((e) => e.event)).toEqual(["fieldd.drive.holders_slice_invalid"]);
    deviceId = "studio";
    await studio.publish();
    expect(store.writes).toHaveLength(1);
  });

  it("drops a store snapshot outside its contract with a warn, and keeps what it heard", async () => {
    const store = new FakeDriveStore();
    store.put("laptop", slice("laptop"));
    const events: CapturedLog[] = [];
    const studio = holders(store, "studio", undefined, undefined, {
      logger: captureLogger(events),
    });
    await studio.start();
    store.hearSnapshot({ slices: "not a table" });
    expect(ids(studio)).toEqual(["laptop"]);
    expect(events.map((e) => e.event)).toEqual(["fieldd.drive.holders_snapshot_dropped"]);
  });

  it("withdraws again on the next change after a failed withdrawal, and once", async () => {
    const store = new FakeDriveStore();
    const events: CapturedLog[] = [];
    let open = true;
    const studio = holders(store, "studio", () => (open ? READY : null), undefined, {
      logger: captureLogger(events),
    });
    await studio.start();
    open = false;
    store.failNextSet = true;
    await studio.publish();
    expect(withdrawn(store)).toEqual([false]);
    expect(events.map((e) => e.event)).toEqual(["fieldd.drive.holders_unwithdrawn"]);
    await studio.publish();
    expect(withdrawn(store)).toEqual([false, true]);
    await studio.publish();
    expect(withdrawn(store)).toEqual([false, true]);
  });

  it("withdraws a first publish still in flight as the drive closes: the null slice lands after it", async () => {
    const store = new FakeDriveStore();
    let open = true;
    const studio = holders(store, "studio", () => (open ? READY : null));
    const laptop = holders(store, "laptop", () => null);
    await laptop.start();
    const held = gate();
    store.setGate = held.waits;
    const first = studio.publish();
    open = false;
    const closing = studio.publish();
    store.setGate = null;
    held.open();
    await Promise.all([first, closing]);
    expect(withdrawn(store)).toEqual([false, true]);
    expect(ids(laptop)).toEqual([]);
  });

  it("withdraws a publish that read as refused and landed all the same", async () => {
    const store = new FakeDriveStore();
    let open = true;
    const studio = holders(store, "studio", () => (open ? READY : null));
    store.failNextSetAfterLanding = true;
    await studio.publish();
    expect(withdrawn(store)).toEqual([false]);
    open = false;
    await studio.publish();
    expect(withdrawn(store)).toEqual([false, true]);
  });

  it("keeps a publish made during a withdrawal's flight, and withdraws it at the next close", async () => {
    const store = new FakeDriveStore();
    let open = true;
    const studio = holders(store, "studio", () => (open ? READY : null));
    await studio.publish();
    open = false;
    const held = gate();
    store.setGate = held.waits;
    const closing = studio.publish();
    open = true;
    const reopened = studio.publish();
    store.setGate = null;
    held.open();
    await Promise.all([closing, reopened]);
    expect(withdrawn(store)).toEqual([false, true, false]);
    open = false;
    await studio.publish();
    expect(withdrawn(store)).toEqual([false, true, false, true]);
  });

  it("publishes the slice again at a reconnect, and hears the lane table anew", async () => {
    const store = new FakeDriveStore();
    const { control, bytes, service } = composed(store);
    await service.start();
    expect(store.writes).toHaveLength(1);
    control.replayRefused();
    control.lanes = [INBOUND];
    await service.connected();
    expect(store.writes).toHaveLength(2);
    expect(bytes.claimed(IN)).toBe(true);
    expect(store.subscribes).toBe(2);
  });

  it("holds up neither the slice nor the lane table behind the pulls' unanswered subscribe at a reconnect", async () => {
    const held = gate();
    let silent = false;
    const pullsFloor: DrivePullsFloor = {
      request: async () => ({ roots: [] }),
      subscribe: async () => {
        if (silent) await held.waits;
        return { snapshot: { transfers: [] }, dispose: () => undefined };
      },
    };
    const store = new FakeDriveStore();
    const { control, service } = composed(store, pullsFloor);
    await service.start();
    silent = true;
    let ended = false;
    const reconnected = service.connected().then(() => {
      ended = true;
    });
    await until(() => store.writes.length === 2, "the slice, past the pulls' silent subscribe");
    await until(() => control.subscribes === 2, "the lane table, past the pulls' silent subscribe");
    expect(ended).toBe(false);
    // NativeLink's deadline ends that subscribe, and the reconnect with it
    held.open();
    await reconnected;
  });

  it("hands a link that went down to the pulls", async () => {
    const { pulls, service } = composed(new FakeDriveStore());
    const held = vi.spyOn(pulls, "disconnected");
    service.disconnected();
    expect(held).toHaveBeenCalledTimes(1);
  });

  it("arms all three parts at the next reconnect after the lane table refused start", async () => {
    const store = new FakeDriveStore();
    const asked: string[] = [];
    const pullsFloor: DrivePullsFloor = {
      request: async (method) => {
        asked.push(method);
        return { roots: [] };
      },
      subscribe: async (method) => {
        asked.push(method);
        return { snapshot: { transfers: [] }, dispose: () => undefined };
      },
    };
    const { control, bytes, service } = composed(store, pullsFloor);
    control.refuseNextSubscribe = new Error("mesh queue full");
    await expect(service.start()).rejects.toThrow("mesh queue full");
    // start's own behaviour: nothing after the lane table ran
    expect(asked).toEqual([]);
    expect(store.writes).toEqual([]);
    control.lanes = [INBOUND];
    await service.connected();
    expect(bytes.claimed(IN)).toBe(true);
    expect(asked).toContain(SUBSCRIBE);
    expect(store.subscribes).toBe(1);
    expect(store.writes).toHaveLength(1);
  });

  it("arms the lane table at the next node-up after it refused start, with no reconnect", async () => {
    const store = new FakeDriveStore();
    const pullsFloor = answeringFloor();
    const { control, bytes, service } = composed(store, pullsFloor);
    control.refuseNextSubscribe = new Error("mesh queue full");
    await expect(service.start()).rejects.toThrow("mesh queue full");
    control.lanes = [INBOUND];
    await service.nodeUp();
    expect(bytes.claimed(IN)).toBe(true);
    expect(control.subscribes).toBe(2);
    expect(pullsFloor.asked).toContain(SUBSCRIBE);
    expect(store.subscribes).toBe(1);
    expect(store.writes).toHaveLength(1);
    // the table is the bridge's, not the node's: the next node-up keeps the stream that stands
    await service.nodeUp();
    expect(control.subscribes).toBe(2);
    expect(control.disposed).toBe(0);
  });

  it("holds up no lane table behind the pulls' unanswered subscribe at a node-up", async () => {
    const store = new FakeDriveStore();
    const pullsFloor = answeringFloor();
    const { control, bytes, service } = composed(store, pullsFloor);
    control.refuseNextSubscribe = new Error("mesh queue full");
    await expect(service.start()).rejects.toThrow("mesh queue full");
    const held = gate();
    pullsFloor.subscribeGate = held.waits;
    control.lanes = [INBOUND];
    let ended = false;
    const up = service.nodeUp().then(() => {
      ended = true;
    });
    await until(() => bytes.claimed(IN), "the lane table, past the pulls' silent subscribe");
    expect(pullsFloor.asked).toEqual([SUBSCRIBE]);
    expect(store.subscribes).toBe(0);
    expect(ended).toBe(false);
    // NativeLink's deadline ends that subscribe, and the holders follow it
    held.open();
    await up;
    expect(store.subscribes).toBe(1);
    expect(store.writes).toHaveLength(1);
  });

  it("holds up neither the pulls nor the slice behind the lane table's unanswered subscribe at a node-up", async () => {
    const store = new FakeDriveStore();
    const pullsFloor = answeringFloor();
    const { control, bytes, service } = composed(store, pullsFloor);
    control.refuseNextSubscribe = new Error("mesh queue full");
    await expect(service.start()).rejects.toThrow("mesh queue full");
    const held = gate();
    control.subscribeGate = held.waits;
    control.lanes = [INBOUND];
    let ended = false;
    const up = service.nodeUp().then(() => {
      ended = true;
    });
    await until(() => store.writes.length === 1, "the slice, past the lane table's subscribe");
    expect(pullsFloor.asked).toContain(SUBSCRIBE);
    expect(control.subscribes).toBe(2);
    expect(bytes.claimed(IN)).toBe(false);
    expect(ended).toBe(false);
    held.open();
    await up;
    expect(bytes.claimed(IN)).toBe(true);
  });
});
