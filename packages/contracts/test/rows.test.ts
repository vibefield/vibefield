import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ForwardEnvelope, ForwardReceipt, IdempotencyKey, OnBehalfOf } from "../src/forwarding";
import { FORWARDING, ROWS } from "../src/registries";
import {
  MeshScope,
  meshRowsFrame,
  meshRowsOpen,
  RowsCursor,
  RowsDeviceState,
  RowsDigest,
  RowsSubscribeParams,
  rowsDelta,
  rowsFrame,
  rowsOpen,
  rowsSnapshot,
} from "../src/rows";

const Row = z.object({ id: z.string().min(1), n: z.number() }).passthrough();
const Snapshot = rowsSnapshot(Row);
const Delta = rowsDelta(Row);
const Open = rowsOpen(Row);
const Frame = rowsFrame(Row);

describe("DS-L3 — the rows protocol: list, then watch", () => {
  it("a subscribe with a kept cursor parses; a negative revision does not", () => {
    expect(RowsSubscribeParams.parse({ since: { epoch: "boot-1", revision: 7 } }).since).toEqual({
      epoch: "boot-1",
      revision: 7,
    });
    expect(RowsCursor.safeParse({ epoch: "boot-1", revision: -1 }).success).toBe(false);
    expect(RowsCursor.safeParse({ epoch: "", revision: 0 }).success).toBe(false);
    expect(RowsSubscribeParams.safeParse({ minIntervalMs: 8 }).success).toBe(false);
  });

  it("the open answer is either a resume or a snapshot, never both shapes at once", () => {
    const resumed = Open.parse({ resumed: { epoch: "boot-1", revision: 7 } });
    expect("resumed" in resumed).toBe(true);
    const reset = Open.parse({
      snapshot: { epoch: "boot-2", revision: 0, rows: [{ id: "a", n: 1 }], more: true },
    });
    expect((reset as { snapshot?: { more?: boolean } }).snapshot?.more).toBe(true);
    expect(Open.safeParse({ resumed: { epoch: "x" } }).success).toBe(false);
  });

  it("a delta names the revision it applies on top of and carries keys for removals", () => {
    const delta = Delta.parse({
      epoch: "boot-1",
      since: 7,
      revision: 8,
      upserts: [{ id: "a", n: 2 }],
      removed: ["b"],
    });
    expect(delta.since).toBe(7);
    expect(
      Delta.safeParse({ epoch: "boot-1", since: 7, revision: 8, upserts: [], removed: [""] })
        .success,
    ).toBe(false);
    expect((Frame.parse({ delta }) as { delta: { revision: number } }).delta.revision).toBe(8);
    expect(Frame.parse({ snapshot: { epoch: "boot-3", revision: 0, rows: [] } })).toHaveProperty(
      "snapshot",
    );
  });

  it("rows tolerate unknown fields (the tolerant reader) and a snapshot keeps them", () => {
    const parsed = Snapshot.parse({
      epoch: "boot-1",
      revision: 1,
      rows: [{ id: "a", n: 1, later: "field" }],
      extra: true,
    });
    expect((parsed.rows[0] as Record<string, unknown>).later).toBe("field");
    expect((parsed as Record<string, unknown>).extra).toBe(true);
  });

  it("a mesh open lists every device with its state; a frame is one device's", () => {
    const open = meshRowsOpen(Row).parse({
      devices: [
        {
          device: "studio",
          state: "live",
          asOf: "2026-09-30T22:00:00Z",
          snapshot: { epoch: "s1", revision: 3, rows: [] },
        },
        { device: "laptop", state: "asleep", asOf: "2026-09-30T21:00:00Z" },
      ],
    });
    expect(open.devices.map((d) => d.state)).toEqual(["live", "asleep"]);
    expect(open.devices[1]?.snapshot).toBeUndefined();
    const frame = meshRowsFrame(Row);
    expect(
      frame.parse({
        device: "studio",
        delta: { epoch: "s1", since: 3, revision: 4, upserts: [], removed: [] },
      }),
    ).toHaveProperty("delta");
    expect(
      frame.parse({ device: "laptop", state: "live", asOf: "2026-09-30T22:01:00Z" }),
    ).toHaveProperty("state");
    expect(RowsDeviceState.options).toEqual(["live", "stale", "asleep", "incompatible"]);
    expect(MeshScope.options).toEqual(["local", "mesh"]);
  });

  it("a digest is a 64-hex hash over the keys, with the cursor it describes", () => {
    expect(
      RowsDigest.safeParse({ epoch: "s1", revision: 3, count: 2, keysHash: "a".repeat(64) })
        .success,
    ).toBe(true);
    expect(
      RowsDigest.safeParse({ epoch: "s1", revision: 3, count: 2, keysHash: "A".repeat(64) })
        .success,
    ).toBe(false);
    expect(ROWS.DIGEST_ALGORITHM).toBe("sha256");
    expect(ROWS.SNAPSHOT_PAGE_BYTES).toBe(256 * 1024);
  });
});

describe("DS-L7 / DS-D15 — a forwarded call carries who it is for", () => {
  it("onBehalfOf restates the forwarding daemon's client; unknown kinds are refused", () => {
    expect(
      OnBehalfOf.parse({ clientKind: "renderer", deviceId: "laptop", windowId: "w1" }).windowId,
    ).toBe("w1");
    expect(OnBehalfOf.safeParse({ clientKind: "browser", deviceId: "laptop" }).success).toBe(false);
    expect(OnBehalfOf.safeParse({ clientKind: "ios", deviceId: "" }).success).toBe(false);
  });

  it("an idempotency key is bounded and a receipt names one of three honest outcomes", () => {
    expect(IdempotencyKey.safeParse("short").success).toBe(false);
    const receipt = ForwardReceipt.parse({
      idempotencyKey: "01J9ABCDEFGHJKMN",
      method: "agent.interrupt",
      device: "studio",
      state: "outcome-unknown",
      at: 1_759_270_000_000,
    });
    expect(receipt.state).toBe("outcome-unknown");
    expect(
      ForwardReceipt.safeParse({ ...receipt, state: "refused", error: "NOT_A_KIND" }).success,
    ).toBe(false);
    expect(
      ForwardReceipt.safeParse({ ...receipt, state: "refused", error: "UNAVAILABLE" }).success,
    ).toBe(true);
    expect(FORWARDING.RECEIPT_TTL_MS).toBeGreaterThan(0);
  });

  it("the envelope rides beside a method's own params", () => {
    const parsed = ForwardEnvelope.parse({
      sessionId: "s-1",
      onBehalfOf: { clientKind: "renderer", deviceId: "laptop" },
      idempotencyKey: "01J9ABCDEFGHJKMN",
    });
    expect((parsed as Record<string, unknown>).sessionId).toBe("s-1");
  });
});
