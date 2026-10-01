// DS-5d — compaction's wire and registry shapes (design-06 §4; DS-D17).
//
// The numbers are registry numbers, not feelings (design-06 §8): the two
// journal thresholds that offer a hosted canvas for compaction, and the
// retirement horizon past which an unseen desktop is no longer waited for.
// The shapes are additive: a holder states the version below which it will
// never again produce an op (the watermark's input), and an S4 answer says it
// is one, so a receiver tells a re-bootstrap from a stray cross-epoch record.
import { describe, expect, it } from "vitest";
import { DocHoldersSlice, DocHolding } from "../src/docs";
import { DocSyncMeta } from "../src/docsync";
import { DOC_HOST } from "../src/registries";

const holding = {
  docId: "6f1c2b0e-7c1a-4f0e-9d0b-2b8f5a1c3d4e",
  baseEpoch: 1,
  headVersion: "AQfOAQ==",
  fresh: true,
  heldSince: 1_790_000_000_000,
};

describe("DS-5d — compaction's registry numbers", () => {
  it("names the journal thresholds and DS-D17's thirty days", () => {
    expect(DOC_HOST.COMPACT_RECORDS).toBe(1024);
    expect(DOC_HOST.COMPACT_JOURNAL_BYTES).toBe(4 * 1024 * 1024);
    expect(DOC_HOST.RETIREMENT_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("DS-5d — a holder's acknowledged version", () => {
  it("is optional, and rides beside the head as base64", () => {
    expect(DocHolding.parse(holding).ackVersion).toBeUndefined();
    expect(DocHolding.parse({ ...holding, ackVersion: "AQfOAQ==" }).ackVersion).toBe("AQfOAQ==");
    // "AA==" is the empty version: a holder that acknowledges nothing.
    expect(
      DocHoldersSlice.parse({ deviceId: "01J9", docs: [{ ...holding, ackVersion: "AA==" }] })
        .docs[0]?.ackVersion,
    ).toBe("AA==");
  });

  it("refuses a value the watermark could not decode", () => {
    // Tolerant reader has limits: an unknown KEY rides through, a known one
    // the trim reads does not take another type.
    expect(DocHolding.safeParse({ ...holding, ackVersion: 7 }).success).toBe(false);
  });
});

describe("DS-5d — the S4 answer is marked", () => {
  const meta = { baseEpoch: 2, engineSchema: 2, savedAt: 1 };

  it("`rebootstrap` is optional and only ever true", () => {
    expect(DocSyncMeta.parse(meta).rebootstrap).toBeUndefined();
    expect(DocSyncMeta.parse({ ...meta, rebootstrap: true }).rebootstrap).toBe(true);
    expect(DocSyncMeta.safeParse({ ...meta, rebootstrap: false }).success).toBe(false);
  });
});
