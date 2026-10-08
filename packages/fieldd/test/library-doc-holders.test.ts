// DS-5d — the holders slice's LEDGER (design-06 §4: "each holder's
// acknowledged version rides its holders slice; a trim goes only below the
// lowest version any KNOWN holder acknowledged; a desktop past the retirement
// horizon is not waited for").
//
// The slice is device-owned and EXPIRES WITH ITS PUBLISHER: the store drops a
// peer's slice the moment the transport drops the peer. A watermark read from
// live slices alone would therefore forget a laptop the minute its lid closed
// and trim straight under the edits it is carrying home. The ledger remembers
// every holder's last acknowledgement and when it was last heard — across
// restarts — so a desktop is waited for until DS-D17's thirty days pass.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DocHolding } from "@vibefield/contracts";
import { VersionVector } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { DocHoldersService, type HoldersMesh } from "../src/library-doc";
import { type HolderAck, versionToBase64 } from "../src/loro-host";
import { FakeHoldersStore } from "./holders-store";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const DOC = "6f1c2b0e-7c1a-4f0e-9d0b-2b8f5a1c3d4e";
const DAY = 86_400_000;
const vv = (entries: Record<string, number>): VersionVector =>
  VersionVector.parseJSON(new Map(Object.entries(entries).map(([p, c]) => [p as `${number}`, c])));
const json = (v: VersionVector | null): Record<string, number> | null =>
  v === null ? null : Object.fromEntries([...v.toJSON()].map(([p, c]) => [String(p), c]));
const flat = (acks: HolderAck[] | null) => {
  if (acks === null) throw new Error("the ledger vouches for nothing");
  return acks
    .map((a) => ({ device: a.device, ack: json(a.ack), seenAt: a.seenAt }))
    .sort((a, b) => a.device.localeCompare(b.device));
};

/** A store that is not there: the mesh is down. */
const meshDown: HoldersMesh = {
  setSlice: async () => {
    throw new Error("mesh down");
  },
  subscribeStoreManaged: async () => {
    throw new Error("mesh down");
  },
};

function holding(over: Partial<DocHolding> = {}): DocHolding {
  return { docId: DOC, baseEpoch: 0, fresh: true, heldSince: 1, ...over };
}

function holders(
  store: FakeHoldersStore,
  deviceId: string,
  clock: { now: number },
  opts: { ledgerPath?: string; docs?: () => DocHolding[] } = {},
): DocHoldersService {
  return new DocHoldersService({
    mesh: store.member(deviceId),
    deviceId: () => deviceId,
    holdings: async () => opts.docs?.() ?? [],
    now: () => clock.now,
    debounceMs: 1,
    ...(opts.ledgerPath !== undefined ? { ledgerPath: opts.ledgerPath } : {}),
  });
}

describe("DS-5d — the holders ledger", () => {
  it("names every OTHER holder with what it acknowledged, and NOW while its slice is live", async () => {
    const store = new FakeHoldersStore();
    const clock = { now: 1_800_000_000_000 };
    const studio = holders(store, "studio", clock, {
      docs: () => [
        holding({
          headVersion: versionToBase64(vv({ 1: 9 })),
          ackVersion: versionToBase64(vv({ 1: 7 })),
        }),
      ],
    });
    const laptop = holders(store, "laptop", clock, {
      docs: () => [holding({ headVersion: versionToBase64(vv({ 1: 9 })) })],
    });
    await studio.start();
    await laptop.start();
    // The laptop is not its own holder; the studio's acknowledgement is the
    // one it states, never its head.
    expect(flat(laptop.acknowledgements(DOC))).toEqual([
      { device: "studio", ack: { 1: 7 }, seenAt: clock.now },
    ]);
    // A holder from before DS-5d states only its head: the head stands in.
    expect(flat(studio.acknowledgements(DOC))).toEqual([
      { device: "laptop", ack: { 1: 9 }, seenAt: clock.now },
    ]);
    await studio.stop();
    await laptop.stop();
  });

  it("REMEMBERS a holder whose slice is gone: still waited for, with the time it was last heard", async () => {
    // Before DS-5d a peerRemoved forgot the holder outright — a laptop that
    // closed its lid was no longer anyone the trim had to wait for.
    const store = new FakeHoldersStore();
    const clock = { now: 1_800_000_000_000 };
    const studio = holders(store, "studio", clock);
    const laptop = holders(store, "laptop", clock, {
      docs: () => [holding({ ackVersion: versionToBase64(vv({ 1: 4 })) })],
    });
    await studio.start();
    await laptop.start();
    const leftAt = clock.now;
    await laptop.stop();
    store.leave("laptop");
    clock.now += 10 * DAY;
    expect(flat(studio.acknowledgements(DOC))).toEqual([
      { device: "laptop", ack: { 1: 4 }, seenAt: leftAt },
    ]);
    expect(studio.homesOf(DOC)).toEqual([]); // a home is a LIVE fact — unchanged
    await studio.stop();
  });

  it("keeps the ledger across a restart, and forgets a holder unheard for twice the horizon", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-holders-"));
    dirs.push(dir);
    const ledgerPath = join(dir, "holders.json");
    const store = new FakeHoldersStore();
    const clock = { now: 1_800_000_000_000 };
    const first = holders(store, "studio", clock, { ledgerPath });
    const laptop = holders(store, "laptop", clock, {
      docs: () => [holding({ ackVersion: versionToBase64(vv({ 1: 4 })) })],
    });
    await first.start();
    await laptop.start();
    const heard = clock.now;
    await laptop.stop();
    store.leave("laptop");
    await first.flush();
    await first.stop();

    // fieldd restarts with the laptop still away: the ledger is the memory.
    clock.now += 3 * DAY;
    const second = holders(store, "studio", clock, { ledgerPath });
    await second.start();
    expect(flat(second.acknowledgements(DOC))).toEqual([
      { device: "laptop", ack: { 1: 4 }, seenAt: heard },
    ]);
    await second.stop();

    // Sixty-one days on, it is gone from the ledger altogether.
    clock.now = heard + 61 * DAY;
    const third = holders(store, "studio", clock, { ledgerPath });
    await third.start();
    expect(third.acknowledgements(DOC)).toEqual([]);
    await third.stop();
  });

  it("a holding whose acknowledgement does not decode is a holder that acknowledges nothing", async () => {
    const store = new FakeHoldersStore();
    const clock = { now: 1_800_000_000_000 };
    const studio = holders(store, "studio", clock);
    const laptop = holders(store, "laptop", clock, {
      docs: () => [holding({ ackVersion: "////" })],
    });
    const opaque = holders(store, "attic", clock, { docs: () => [holding()] }); // opaque custody
    await studio.start();
    await laptop.start();
    await opaque.start();
    expect(flat(studio.acknowledgements(DOC))).toEqual([
      { device: "attic", ack: null, seenAt: clock.now },
      { device: "laptop", ack: null, seenAt: clock.now },
    ]);
    await studio.stop();
    await laptop.stop();
    await opaque.stop();
  });

  it("a ledger that has NEVER heard the store vouches for nothing; one that heard it in a past life still does, mesh down or not", async () => {
    // Without this, a desktop whose mesh is down at its first DS-5d boot knows
    // of no holder only because it heard none — and would trim as if alone.
    const dir = mkdtempSync(join(tmpdir(), "vf-holders-"));
    dirs.push(dir);
    const ledgerPath = join(dir, "holders.json");
    const clock = { now: 1_800_000_000_000 };
    const offline = (): DocHoldersService =>
      new DocHoldersService({
        mesh: meshDown,
        deviceId: () => "studio",
        holdings: async () => [],
        now: () => clock.now,
        ledgerPath,
      });
    const cold = offline();
    await expect(cold.start()).rejects.toThrow(/mesh down/);
    expect(cold.acknowledgements(DOC)).toBeNull();
    await cold.stop();

    // A life in which it heard the store, and the laptop in it.
    const store = new FakeHoldersStore();
    const warm = holders(store, "studio", clock, { ledgerPath });
    const laptop = holders(store, "laptop", clock, {
      docs: () => [holding({ ackVersion: versionToBase64(vv({ 1: 4 })) })],
    });
    await warm.start();
    await laptop.start();
    await warm.flush();
    await warm.stop();
    await laptop.stop();

    // The next boot, mesh down: the remembered laptop is still waited for.
    clock.now += DAY;
    const later = offline();
    await expect(later.start()).rejects.toThrow(/mesh down/);
    expect(flat(later.acknowledgements(DOC))).toEqual([
      { device: "laptop", ack: { 1: 4 }, seenAt: clock.now - DAY },
    ]);
    await later.stop();
  });
});
