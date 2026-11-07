// DR-3b (W3, VF-RELAY) — the drive's lane relay (src/drive/lane-relay.ts): mille-drive's sync records between two
// desktops of the account, on ONE reliable `drive` lane per peer and direction (contracts mgmt.ts
// `MeshLaneProtocol`), opaque to fieldd (DR-L4). Against fakes for the two planes, as doc-sync's routing is
// (doc-sync-service.test.ts): who gets a lane, what crosses it, and what is refused.
import { DRIVE_LIMITS, MESHDATA_INBOUND_LANE_ID_BASE } from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveLaneRelay, type DriveLaneRelayOptions } from "../src/drive/lane-relay";
import { OutboundLaneIdAllocator } from "../src/lane-id";
import { RpcCallError } from "../src/native-link";
import {
  afterTurns,
  type CapturedLog,
  captureLogger,
  FakeDriveLaneBytes,
  FakeDriveLaneControl,
  gate,
  sleep,
  until,
} from "./drive-fakes";

const IN = MESHDATA_INBOUND_LANE_ID_BASE;
const SELF = new Set(["peer-a", "peer-b"]);

const relays: DriveLaneRelay[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
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

/** A row of the lane table as the floor writes it (`lane_json`): only an inbound lane carries `inbound`. */
const inboundRow = (laneId: number, peer: string) => ({
  laneId,
  class: "reliable",
  peer,
  protocol: "drive",
  inbound: true,
});
const outboundRow = (laneId: number, peer: string) => ({
  laneId,
  class: "reliable",
  peer,
  protocol: "drive",
});

/** Every peer event, in order. */
function peersOf(relay: DriveLaneRelay): Array<[string, boolean]> {
  const peers: Array<[string, boolean]> = [];
  relay.onPeer((peer, up) => peers.push([peer, up]));
  return peers;
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

  it("forgets the lanes a snapshot drops: their peers go down, and the next send opens a fresh id", async () => {
    const { control, bytes, relay } = harness();
    const peers = peersOf(relay);
    await relay.start();
    control.announce(opened(IN, "peer-b"));
    expect(await relay.send("peer-a", bytesOf(1))).toBe(true);
    // a floor that restarted holds neither lane: NativeLink's replay hands its empty table as a snapshot
    control.announce({ lanes: [] }, "snapshot");
    expect(peers).toEqual([
      ["peer-b", true],
      ["peer-a", true],
      ["peer-a", false],
      ["peer-b", false],
    ]);
    expect(bytes.claimed(IN)).toBe(false);
    expect(await relay.send("peer-a", bytesOf(2))).toBe(true);
    expect(control.opened.map((req) => req.laneId)).toEqual([1, 2]);
    expect(bytes.sent.map((s) => s.laneId)).toEqual([1, 2]);
    expect(peers.at(-1)).toEqual(["peer-a", true]);
  });

  it("keeps the lanes a snapshot lists: no new open, no peer event, and their records still route", async () => {
    const { control, bytes, relay, frames } = harness();
    const peers = peersOf(relay);
    await relay.start();
    control.announce(opened(IN, "peer-b"));
    expect(await relay.send("peer-a", bytesOf(1))).toBe(true);
    const before = [...peers];
    // a lag snapshot: every lane still stands
    control.announce({ lanes: [outboundRow(1, "peer-a"), inboundRow(IN, "peer-b")] }, "snapshot");
    expect(peers).toEqual(before);
    expect(await relay.send("peer-a", bytesOf(2))).toBe(true);
    expect(control.opened).toHaveLength(1);
    expect(bytes.sent.map((s) => s.laneId)).toEqual([1, 1]);
    bytes.deliver(IN, bytesOf(3));
    expect(frames).toEqual([{ peer: "peer-b", record: [3] }]);
  });

  it("re-derives an inbound id another peer now holds: its records carry that peer's name, and the old peer goes down", async () => {
    const { control, bytes, relay, frames } = harness();
    const peers = peersOf(relay);
    await relay.start();
    control.announce(opened(IN, "peer-a"));
    // a floor's inbound ids restart at its boot, so the same id comes back naming another desktop
    control.announce({ lanes: [inboundRow(IN, "peer-b")] }, "snapshot");
    bytes.deliver(IN, bytesOf(7));
    expect(frames).toEqual([{ peer: "peer-b", record: [7] }]);
    expect(peers).toEqual([
      ["peer-a", true],
      ["peer-b", true],
      ["peer-a", false],
    ]);
  });

  it("holds a re-derived row to the account gate: a stranger on a reused id is closed, and hears nothing", async () => {
    const { control, bytes, events, relay, frames } = harness();
    const peers = peersOf(relay);
    await relay.start();
    control.announce(opened(IN, "peer-a"));
    control.announce({ lanes: [inboundRow(IN, "stranger")] }, "snapshot");
    expect(bytes.claimed(IN)).toBe(false);
    bytes.deliver(IN, bytesOf(9));
    expect(frames).toEqual([]);
    expect(control.closed).toEqual([IN]);
    expect(events.map((e) => e.event)).toEqual(["fieldd.drive.lane_refused_foreign_account"]);
    expect(peers.at(-1)).toEqual(["peer-a", false]);
  });

  it("never flaps a peer a snapshot still lists either way: one lane going leaves it up on the other", async () => {
    const { control, relay } = harness();
    const peers = peersOf(relay);
    await relay.start();
    control.announce(opened(IN, "peer-a"));
    expect(await relay.send("peer-a", bytesOf(1))).toBe(true);
    // its inbound lane goes, and our outbound one keeps it up
    control.announce({ lanes: [outboundRow(1, "peer-a")] }, "snapshot");
    control.announce(opened(IN + 1, "peer-a"));
    // its outbound lane goes, and the inbound one, claimed anew, keeps it up
    control.announce({ lanes: [inboundRow(IN + 1, "peer-a")] }, "snapshot");
    expect(peers).toEqual([["peer-a", true]]);
  });

  it("subscribes anew at a reconnect, hears what a refused replay left unheard, and keeps one entry", async () => {
    const { control, bytes, relay } = harness();
    await relay.start();
    expect(await relay.send("peer-a", bytesOf(1))).toBe(true);
    // the replay read TIMEOUT: the entry stays with no route, and nothing says so
    control.replayRefused();
    control.announce(opened(IN, "peer-b"));
    expect(bytes.claimed(IN)).toBe(false);
    control.lanes = [inboundRow(IN, "peer-b")];
    await relay.connected();
    // the table named peer-b's lane, and no longer named our lane 1: the next send opens a fresh one
    expect(bytes.claimed(IN)).toBe(true);
    expect(await relay.send("peer-a", bytesOf(2))).toBe(true);
    expect(bytes.sent.map((s) => s.laneId)).toEqual([1, 2]);
    // the new stream routes
    control.announce(opened(IN + 1, "peer-b"));
    expect(bytes.claimed(IN + 1)).toBe(true);
    await relay.connected();
    expect(control.subscribes).toBe(3);
    expect(control.disposed).toBe(2);
  });

  it("arms at the next reconnect after a refused start", async () => {
    const { control, bytes, relay } = harness();
    control.refuseNextSubscribe = new Error("mesh queue full");
    await expect(relay.start()).rejects.toThrow("mesh queue full");
    control.lanes = [inboundRow(IN, "peer-a")];
    await relay.connected();
    expect(bytes.claimed(IN)).toBe(true);
    // the refused start made no entry to let go
    expect(control.subscribes).toBe(2);
    expect(control.disposed).toBe(0);
  });

  it("logs a re-subscribe refused at a reconnect and never throws, and the next reconnect asks again", async () => {
    const { control, bytes, events, relay } = harness();
    await relay.start();
    control.refuseNextSubscribe = new Error("mesh queue full");
    await relay.connected();
    expect(events.map((e) => e.event)).toEqual(["fieldd.drive.lanes_unheard"]);
    // the stream that stood is kept until a subscribe is answered
    expect(control.disposed).toBe(0);
    control.lanes = [inboundRow(IN, "peer-a")];
    await relay.connected();
    expect(bytes.claimed(IN)).toBe(true);
    expect(control.subscribes).toBe(3);
    expect(control.disposed).toBe(1);
  });

  it("keeps the stream it had when a re-subscribe at a reconnect is refused, and a lane it then announces is claimed", async () => {
    const { control, bytes, relay } = harness();
    await relay.start();
    // the replay ran: the stream that stands hears the live table
    control.refuseNextSubscribe = new Error("mesh queue full");
    await relay.connected();
    control.announce(opened(IN, "peer-a"));
    expect(bytes.claimed(IN)).toBe(true);
    expect(control.subscribes).toBe(2);
    expect(control.disposed).toBe(0);
  });

  it("lets both streams go when disposed during a reconnect's subscribe, and claims nothing", async () => {
    const { control, bytes, relay } = harness();
    await relay.start();
    const held = gate();
    control.subscribeGate = held.waits;
    control.lanes = [inboundRow(IN, "peer-a")];
    const reconnected = relay.connected();
    await until(() => control.subscribes === 2, "the reconnect's subscribe");
    // dispose lets the stream that stood go at once, and the answer goes as it comes
    await relay.dispose();
    expect(control.disposed).toBe(1);
    held.open();
    await reconnected;
    expect(control.disposed).toBe(2);
    expect(bytes.claimed(IN)).toBe(false);
  });

  it("arms a refused start at a node-up and keeps a stream that stands; one refused there is logged, never thrown", async () => {
    const { control, bytes, events, relay } = harness();
    control.refuseNextSubscribe = new Error("mesh queue full");
    await expect(relay.start()).rejects.toThrow("mesh queue full");
    control.refuseNextSubscribe = new Error("mesh queue full");
    await relay.nodeUp();
    expect(events.map((e) => e.event)).toEqual(["fieldd.drive.lanes_unheard"]);
    control.lanes = [inboundRow(IN, "peer-a")];
    await relay.nodeUp();
    expect(bytes.claimed(IN)).toBe(true);
    // the table is the floor's bridge's, not the node's: a node-up makes no subscribe over a stream that stands
    await relay.nodeUp();
    expect(control.subscribes).toBe(3);
    expect(control.disposed).toBe(0);
  });

  it("keeps one entry when a node-up lands at any turn after a reconnect's refused subscribe", async () => {
    for (let turns = 0; turns < 16; turns++) {
      const { control, relay } = harness();
      const subscribe = control.subscribe.bind(control);
      let race = false;
      control.subscribe = (onEvent) => {
        const answer = subscribe(onEvent);
        if (race) {
          race = false;
          answer.catch(() => afterTurns(turns, () => void relay.nodeUp()));
        }
        return answer;
      };
      await relay.start();
      control.refuseNextSubscribe = new Error("mesh queue full");
      race = true;
      await relay.connected();
      // the fakes answer in microtasks, so every turn has run by the next timer
      await sleep(5);
      const entries = control.subscribes - 1 - control.disposed;
      expect(entries, `the refused one is no entry; a node-up ${turns} turns on`).toBe(1);
    }
  });

  it("renews at a node-up after a reconnect whose replay and re-subscribe were both refused, and only that once", async () => {
    const { control, bytes, events, relay } = harness();
    await relay.start();
    // the replay meets a full queue, and so does the reconnect's own subscribe: the stream kept is the replay's entry,
    // with no route
    control.replayRefused();
    control.refuseNextSubscribe = new Error("mesh queue full");
    await relay.connected();
    expect(events.map((e) => e.event)).toEqual(["fieldd.drive.lanes_unheard"]);
    expect(control.subscribes).toBe(2);
    control.lanes = [inboundRow(IN, "peer-a")];
    await relay.nodeUp();
    expect(control.subscribes, "subscribes after the node-up").toBe(3);
    expect(control.disposed, "the dead entry, let go").toBe(1);
    expect(bytes.claimed(IN), "the lane, claimed from the snapshot").toBe(true);
    // answered, nothing is owed: the next node-up keeps the stream
    await relay.nodeUp();
    expect(control.subscribes, "subscribes after a second node-up").toBe(3);
  });

  it("waits out a subscribe in flight at a reconnect, then makes its own: that one left on the old connection", async () => {
    const { control, relay } = harness();
    const held = gate();
    control.subscribeGate = held.waits;
    const started = relay.start();
    const reconnected = relay.connected();
    await sleep(20);
    expect(control.subscribes).toBe(1);
    control.subscribeGate = null;
    held.open();
    await Promise.all([started, reconnected]);
    expect(control.subscribes).toBe(2);
    expect(control.disposed).toBe(1);
  });

  it("subscribes at a reconnect behind a subscribe in flight that is refused, which `start` alone answers for", async () => {
    const { control, bytes, events, relay } = harness();
    const held = gate();
    control.subscribeGate = held.waits;
    control.refuseNextSubscribe = new Error("mesh queue full");
    const started = relay.start();
    const reconnected = relay.connected();
    control.subscribeGate = null;
    control.lanes = [inboundRow(IN, "peer-a")];
    held.open();
    await expect(started).rejects.toThrow("mesh queue full");
    await reconnected;
    expect(bytes.claimed(IN)).toBe(true);
    expect(control.subscribes).toBe(2);
    expect(events).toEqual([]);
  });

  it("makes one subscribe at a time, and none over a stream that stands", async () => {
    const { control, relay } = harness();
    const held = gate();
    control.subscribeGate = held.waits;
    const starts = [relay.start(), relay.start()];
    control.subscribeGate = null;
    held.open();
    await Promise.all(starts);
    await relay.start();
    expect(control.subscribes).toBe(1);
    expect(control.disposed).toBe(0);
  });

  it("lets the answer go when disposed during its subscribe, and claims nothing", async () => {
    const { control, bytes, relay } = harness();
    control.lanes = [inboundRow(IN, "peer-a")];
    const held = gate();
    control.subscribeGate = held.waits;
    const started = relay.start();
    await relay.dispose();
    control.subscribeGate = null;
    held.open();
    await started;
    expect(bytes.claimed(IN)).toBe(false);
    expect(control.subscribes).toBe(1);
    expect(control.disposed).toBe(1);
  });

  it("lets its subscription go at dispose, and a reconnect after it asks nothing", async () => {
    const { control, relay } = harness();
    await relay.start();
    await relay.dispose();
    expect(control.disposed).toBe(1);
    await relay.connected();
    expect(control.subscribes).toBe(1);
    expect(control.disposed).toBe(1);
  });

  it("answers false with a warn when the byte plane throws, and the next record still goes", async () => {
    const { bytes, events, relay } = harness();
    await relay.start();
    expect(await relay.send("peer-a", bytesOf(1))).toBe(true);
    bytes.throwOnSend = new Error("meshdata link is not connected");
    expect(await relay.send("peer-a", bytesOf(2))).toBe(false);
    expect(events.map((e) => e.event)).toEqual(["fieldd.drive.lane_send_failed"]);
    bytes.throwOnSend = null;
    expect(await relay.send("peer-a", bytesOf(3))).toBe(true);
    expect(bytes.sent.map((s) => s.payload[0])).toEqual([1, 3]);
  });

  it("keeps a throwing record reader from the next one, with a warn", async () => {
    const { control, bytes, events, relay, frames } = harness();
    relay.onFrame(() => {
      throw new Error("the reader threw");
    });
    const later: number[][] = [];
    relay.onFrame((_peer, record) => later.push([...record]));
    await relay.start();
    control.announce(opened(IN, "peer-a"));
    bytes.deliver(IN, bytesOf(5));
    expect(frames).toEqual([{ peer: "peer-a", record: [5] }]);
    expect(later).toEqual([[5]]);
    expect(events.map((e) => e.event)).toEqual(["fieldd.drive.frame_listener_failed"]);
  });

  it("keeps a throwing peer listener from the lanes after it and from a queued record, with a warn", async () => {
    const { control, bytes, events, relay } = harness();
    relay.onPeer(() => {
      throw new Error("the listener threw");
    });
    const peers = peersOf(relay);
    await relay.start();
    // the lane's open says its peer is up: the record settles all the same
    let sent: boolean | undefined;
    void relay.send("peer-a", bytesOf(1)).then((ok) => {
      sent = ok;
    });
    await until(() => sent !== undefined, "the record, past a throwing listener");
    expect(sent).toBe(true);
    // a snapshot claims every lane it lists, the one after a throw included
    const rows = [outboundRow(1, "peer-a"), inboundRow(IN, "peer-b"), inboundRow(IN + 1, "peer-a")];
    control.announce({ lanes: rows }, "snapshot");
    expect([bytes.claimed(IN), bytes.claimed(IN + 1)]).toEqual([true, true]);
    expect(peers).toEqual([
      ["peer-a", true],
      ["peer-b", true],
    ]);
    const failed = events.filter((e) => e.event === "fieldd.drive.peer_listener_failed");
    expect(failed.map((e) => e.attrs?.peer)).toEqual(["peer-a", "peer-b"]);
    expect(events).toHaveLength(2);
  });

  it("settles every queued record false at dispose, sends none of them, and calls no socket undrained", async () => {
    const { bytes, events, relay } = harness({ sendWatermarkBytes: 16 });
    await relay.start();
    // the lane is open first, so the records below wait in the pace and not behind the open
    expect(await relay.send("peer-a", bytesOf(1))).toBe(true);
    bytes.bufferedBytes = 16;
    const sends = [relay.send("peer-a", filled(10, 2)), relay.send("peer-a", filled(10, 3))];
    await relay.dispose();
    expect(await Promise.all(sends)).toEqual([false, false]);
    // past the pace's next look: timers in one process fire in their order, so it has woken by now
    await sleep(50);
    expect(bytes.sent.map((s) => s.payload[0])).toEqual([1]);
    expect(events).toEqual([]);
    expect(await relay.send("peer-a", bytesOf(4))).toBe(false);
  });

  it("closes a lane the floor opens after dispose, and its record settles false", async () => {
    const { control, relay } = harness();
    await relay.start();
    const held = gate();
    control.openGate = held.waits;
    const sending = relay.send("peer-a", bytesOf(1));
    await relay.dispose();
    expect(await sending).toBe(false);
    control.openGate = null;
    held.open();
    await until(() => control.closed.length === 1, "the late lane's close");
    expect(control.closed).toEqual([1]);
  });

  it("opens a new lane for a record whose lane closed during its wait for the watermark", async () => {
    const { control, bytes, relay } = harness({ sendWatermarkBytes: 16 });
    await relay.start();
    expect(await relay.send("peer-a", bytesOf(1))).toBe(true);
    bytes.bufferedBytes = 16;
    const waiting = relay.send("peer-a", filled(10, 2));
    control.announce({ kind: "closed", laneId: 1, inbound: false, reason: "peer-closed" });
    bytes.bufferedBytes = 0;
    expect(await waiting).toBe(true);
    expect(control.opened.map((req) => req.laneId)).toEqual([1, 2]);
    expect(bytes.sent.map((s) => s.laneId)).toEqual([1, 2]);
  });

  it("drops a peer's queue with a warn once the socket misses the pace deadline, and the next record still goes", async () => {
    const { bytes, events, relay } = harness({ sendWatermarkBytes: 16 });
    await relay.start();
    expect(await relay.send("peer-a", bytesOf(1))).toBe(true);
    bytes.bufferedBytes = 16;
    // the clock is the row's, so the deadline is met by arithmetic and no real wait: a send reads it as it is made
    let clock = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const sends = [relay.send("peer-a", filled(10, 2)), relay.send("peer-a", filled(10, 3))];
    clock += 30_000;
    await sleep(50);
    expect(events).toEqual([]);
    clock += 1;
    expect(await Promise.all(sends)).toEqual([false, false]);
    const warned = events.find((e) => e.event === "fieldd.drive.lane_not_draining");
    expect(warned?.attrs).toMatchObject({ peer: "peer-a", droppedRecords: 2 });
    bytes.bufferedBytes = 0;
    expect(await relay.send("peer-a", bytesOf(4))).toBe(true);
    expect(bytes.sent.map((s) => s.payload[0])).toEqual([1, 4]);
  });
});
