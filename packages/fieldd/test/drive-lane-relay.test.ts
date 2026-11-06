// DR-3b (W3, VF-RELAY) — the drive's lane relay (src/drive/lane-relay.ts): mille-drive's sync records between two
// desktops of the account, on ONE reliable `drive` lane per peer and direction (contracts mgmt.ts
// `MeshLaneProtocol`), opaque to fieldd (DR-L4). Against fakes for the two planes, as doc-sync's routing is
// (doc-sync-service.test.ts): who gets a lane, what crosses it, and what is refused.
import { DRIVE_LIMITS, MESHDATA_INBOUND_LANE_ID_BASE } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { DriveLaneRelay, type DriveLaneRelayOptions } from "../src/drive/lane-relay";
import { OutboundLaneIdAllocator } from "../src/lane-id";
import { RpcCallError } from "../src/native-link";
import {
  type CapturedLog,
  captureLogger,
  FakeDriveLaneBytes,
  FakeDriveLaneControl,
  sleep,
} from "./drive-fakes";

const IN = MESHDATA_INBOUND_LANE_ID_BASE;
const SELF = new Set(["peer-a", "peer-b"]);

const relays: DriveLaneRelay[] = [];
afterEach(async () => {
  for (const relay of relays.splice(0)) await relay.dispose();
});

function harness(extra: Partial<DriveLaneRelayOptions> = {}) {
  const control = new FakeDriveLaneControl();
  const bytes = new FakeDriveLaneBytes();
  const events: CapturedLog[] = [];
  const relay = new DriveLaneRelay({
    control,
    bytes,
    allocateLaneId: new OutboundLaneIdAllocator().allocate,
    isSelfPeer: (peer) => SELF.has(peer),
    logger: captureLogger(events),
    ...extra,
  });
  relays.push(relay);
  const frames: Array<{ peer: string; record: number[] }> = [];
  relay.onFrame((peer, record) => frames.push({ peer, record: [...record] }));
  return { control, bytes, events, relay, frames };
}

/** A peer opened a lane to us, as the floor announces it (`lane.peerOpened`). */
function opened(laneId: number, peer: string, protocol = "drive", lane = "reliable") {
  return { kind: "peerOpened", laneId, inbound: true, class: lane, peer, protocol };
}

const bytesOf = (...values: number[]) => new Uint8Array(values);
const filled = (length: number, value: number) => new Uint8Array(length).fill(value);

describe("DR-3b — the drive's lane relay", () => {
  it("claims an inbound `drive` lane from this account's peers, from the table and from the stream", async () => {
    const { control, bytes, relay, frames } = harness();
    control.lanes = [
      { laneId: IN, peer: "peer-a", protocol: "drive", class: "reliable", inbound: true },
    ];
    await relay.start();
    expect(bytes.claimed(IN)).toBe(true);
    control.announce(opened(IN + 1, "peer-b"));
    expect(bytes.claimed(IN + 1)).toBe(true);
    bytes.deliver(IN, bytesOf(1));
    bytes.deliver(IN + 1, bytesOf(2));
    expect(frames).toEqual([
      { peer: "peer-a", record: [1] },
      { peer: "peer-b", record: [2] },
    ]);
  });

  it("leaves another protocol's lane alone, and closes a foreign or lossy `drive` lane", async () => {
    const { control, bytes, events, relay } = harness();
    await relay.start();
    control.announce(opened(IN, "peer-a", "doc-sync"));
    control.announce(opened(IN + 1, "stranger"));
    control.announce(opened(IN + 2, "peer-a", "drive", "lossy"));
    const claimed = [IN, IN + 1, IN + 2].map((laneId) => bytes.claimed(laneId));
    expect(claimed).toEqual([false, false, false]);
    // doc-sync's lane is doc-sync's to answer; the two drive lanes are refused, and closed
    expect(control.closed).toEqual([IN + 1, IN + 2]);
    expect(events.map((e) => e.event)).toEqual([
      "fieldd.drive.lane_refused_foreign_account",
      "fieldd.drive.lane_refused_lossy",
    ]);
  });

  it("opens ONE reliable lane per peer, with no docId", async () => {
    const { control, bytes, relay } = harness();
    await relay.start();
    expect(await relay.send("peer-a", bytesOf(1))).toBe(true);
    expect(await relay.send("peer-a", bytesOf(2))).toBe(true);
    expect(await relay.send("peer-b", bytesOf(3))).toBe(true);
    expect(control.opened).toEqual([
      { laneId: 1, class: "reliable", peer: "peer-a", protocol: "drive" },
      { laneId: 2, class: "reliable", peer: "peer-b", protocol: "drive" },
    ]);
    expect(control.opened.some((req) => "docId" in req)).toBe(false);
    expect(bytes.sent.map((s) => s.laneId)).toEqual([1, 1, 2]);
  });

  it("relays records opaque and in order, both ways", async () => {
    const { control, bytes, relay, frames } = harness();
    await relay.start();
    const out = [bytesOf(222, 173), bytesOf(), bytesOf(190, 239, 0)];
    // issued back to back, before the lane is open: the queue keeps their order, and ONE pump opens ONE lane
    const sends = out.map((record) => relay.send("peer-a", record));
    expect(await Promise.all(sends)).toEqual([true, true, true]);
    expect(bytes.sent.map((s) => [...s.payload])).toEqual([[222, 173], [], [190, 239, 0]]);
    expect(control.opened).toHaveLength(1);
    expect(new Set(bytes.sent.map((s) => s.laneId)).size).toBe(1);
    control.announce(opened(IN, "peer-b"));
    bytes.deliver(IN, bytesOf(1, 2, 3));
    bytes.deliver(IN, bytesOf(4));
    expect(frames).toEqual([
      { peer: "peer-b", record: [1, 2, 3] },
      { peer: "peer-b", record: [4] },
    ]);
  });

  it("refuses an outbound record over DRIVE_LIMITS.LANE_RECORD_BYTES and sends nothing", async () => {
    const { control, bytes, relay } = harness();
    await relay.start();
    const over = relay.send("peer-a", new Uint8Array(DRIVE_LIMITS.LANE_RECORD_BYTES + 1));
    await expect(over).rejects.toBeInstanceOf(RpcCallError);
    await expect(over).rejects.toMatchObject({ kind: "PRECONDITION_FAILED", retryable: false });
    expect(control.opened).toEqual([]);
    expect(bytes.sent).toEqual([]);
    // the bound itself rides
    expect(await relay.send("peer-a", new Uint8Array(DRIVE_LIMITS.LANE_RECORD_BYTES))).toBe(true);
    expect(bytes.sent).toHaveLength(1);
  });

  it("drops an inbound record over the bound, with a warn, and keeps the lane", async () => {
    const { control, bytes, events, relay, frames } = harness();
    await relay.start();
    control.announce(opened(IN, "peer-a"));
    bytes.deliver(IN, new Uint8Array(DRIVE_LIMITS.LANE_RECORD_BYTES + 1));
    // the bound itself is delivered
    bytes.deliver(IN, new Uint8Array(DRIVE_LIMITS.LANE_RECORD_BYTES));
    bytes.deliver(IN, bytesOf(9));
    expect(frames.map((frame) => frame.record.length)).toEqual([DRIVE_LIMITS.LANE_RECORD_BYTES, 1]);
    expect(frames.at(-1)).toEqual({ peer: "peer-a", record: [9] });
    expect(events.filter((e) => e.event === "fieldd.drive.lane_record_dropped")).toHaveLength(1);
  });

  it("paces under the send watermark, and drops past the peer's queue bound with a warn", async () => {
    const { bytes, events, relay } = harness({ sendWatermarkBytes: 16, maxQueuedBytes: 25 });
    await relay.start();
    bytes.bufferedBytes = 16; // the byte socket is at its watermark
    const first = relay.send("peer-a", filled(10, 1));
    const second = relay.send("peer-a", filled(10, 2));
    // 30 queued bytes would pass the bound of 25: this one is dropped, and said so
    expect(await relay.send("peer-a", filled(10, 3))).toBe(false);
    expect(events.map((e) => e.event)).toContain("fieldd.drive.lane_queue_full");
    await sleep(50);
    expect(bytes.sent).toEqual([]);
    bytes.bufferedBytes = 0; // it drained
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(bytes.sent.map((s) => s.payload[0])).toEqual([1, 2]);
  });

  it("takes a peer down when its LAST lane closes, either way, and dispose closes only the relay's own lanes", async () => {
    const { control, relay } = harness();
    const peers: Array<[string, boolean]> = [];
    relay.onPeer((peer, up) => peers.push([peer, up]));
    const closed = (laneId: number, inbound: boolean) =>
      control.announce({ kind: "closed", laneId, inbound, reason: "peer-closed" });
    await relay.start();
    control.announce(opened(IN, "peer-b"));
    expect(await relay.send("peer-a", bytesOf(1))).toBe(true);
    expect(peers).toEqual([
      ["peer-b", true],
      ["peer-a", true],
    ]);
    closed(IN, true);
    expect(peers.at(-1)).toEqual(["peer-b", false]);
    // peer-a opens a lane to us beside ours to it: its inbound one closes, and our outbound one keeps it up
    control.announce(opened(IN + 1, "peer-a"));
    closed(IN + 1, true);
    // peer-b again, both ways: our outbound lane closes, and its inbound one keeps it up
    expect(await relay.send("peer-b", bytesOf(2))).toBe(true);
    control.announce(opened(IN + 2, "peer-b"));
    closed(2, false);
    expect(peers).toEqual([
      ["peer-b", true],
      ["peer-a", true],
      ["peer-b", false],
      ["peer-b", true],
    ]);
    // dispose with peer-b's inbound lane live: field-native's to reap, so only our own lane 1 is closed
    await relay.dispose();
    expect(control.closed).toEqual([1]);
  });

  it("draws every lane id from the boot's ONE allocator, shared with another consumer, never colliding", async () => {
    // lane-id.ts: the single minting authority for every lane fieldd opens in a boot. The floor refuses a duplicate
    // id, so a relay that minted its own would collide with doc-sync's (the W3 critic's finding 7).
    const shared = new OutboundLaneIdAllocator();
    const docSync: number[] = [];
    const { control, relay } = harness({ allocateLaneId: shared.allocate });
    await relay.start();
    docSync.push(shared.allocate());
    expect(await relay.send("peer-a", bytesOf(1))).toBe(true);
    docSync.push(shared.allocate(), shared.allocate());
    expect(await relay.send("peer-b", bytesOf(2))).toBe(true);
    docSync.push(shared.allocate());
    const drive = control.opened.map((req) => req.laneId);
    expect(drive).toEqual([2, 5]);
    expect(docSync).toEqual([1, 3, 4, 6]);
    expect(drive.filter((laneId) => docSync.includes(laneId))).toEqual([]);
  });
});
