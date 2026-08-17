import { MESHDATA_INBOUND_LANE_ID_BASE } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { OutboundLaneIdAllocator } from "../src/lane-id";

describe("OutboundLaneIdAllocator", () => {
  it("gives independent consumers one non-overlapping outbound sequence", () => {
    const ids = new OutboundLaneIdAllocator();
    const docSync = ids.allocate();
    const presence = ids.allocate();
    const nextDocSync = ids.allocate();
    expect([docSync, presence, nextDocSync]).toEqual([1, 2, 3]);
  });

  it("fails rather than wrapping onto a potentially live lane", () => {
    const ids = new OutboundLaneIdAllocator(MESHDATA_INBOUND_LANE_ID_BASE - 1);
    expect(ids.allocate()).toBe(MESHDATA_INBOUND_LANE_ID_BASE - 1);
    expect(() => ids.allocate()).toThrow(/exhausted/);
  });
});
