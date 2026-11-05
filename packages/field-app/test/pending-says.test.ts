// @vitest-environment node
/**
 * TH-1 — your words before the record has them (`chat/pending-says.ts`; DESIGN.md §8 "Chat's thread", your words): a
 * send's bubble stands from the press, takes its receipt, leaves when the send is not taken, and gives way to the
 * record's line once the record holds its request id.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  letGoPendingSays,
  pendingSaysNow,
  resetPendingSaysForTest,
  settlePendingSay,
  standPendingSay,
} from "../src/chat/pending-says";

afterEach(() => resetPendingSaysForTest());

const say = (requestId: string, state?: string) => ({
  requestId,
  text: `words of ${requestId}`,
  chips: [],
  at: "2026-11-05T02:00:00.000Z",
  ...(state === undefined ? {} : { state }),
});

describe("the bubbles a window stands (TH-1)", () => {
  it("stands a send, takes its receipt, and lets it go when it is not taken", () => {
    standPendingSay("sp-vela0001", say("say-00000001", "waking"));
    standPendingSay("sp-vela0001", say("say-00000002"));
    settlePendingSay("sp-vela0001", "say-00000001", "queued");
    expect(pendingSaysNow("sp-vela0001").map((each) => [each.requestId, each.state])).toEqual([
      ["say-00000001", "queued"],
      ["say-00000002", undefined],
    ]);
    settlePendingSay("sp-vela0001", "say-00000002", null);
    expect(pendingSaysNow("sp-vela0001").map((each) => each.requestId)).toEqual(["say-00000001"]);
    // another thread's are its own
    expect(pendingSaysNow("sp-lyra0001")).toEqual([]);
  });

  it("gives way to the record, and keeps the newest 32 a thread sends", () => {
    for (let n = 0; n < 40; n += 1)
      standPendingSay("sp-vela0001", say(`say-${String(n).padStart(8, "0")}`));
    expect(pendingSaysNow("sp-vela0001")).toHaveLength(32);
    expect(pendingSaysNow("sp-vela0001")[0]?.requestId).toBe("say-00000008");
    letGoPendingSays("sp-vela0001", new Set(["say-00000008", "say-00000039"]));
    expect(pendingSaysNow("sp-vela0001")).toHaveLength(30);
    // a settle for a send already let go changes nothing
    settlePendingSay("sp-vela0001", "say-00000008", "delivered");
    expect(pendingSaysNow("sp-vela0001")).toHaveLength(30);
  });
});
