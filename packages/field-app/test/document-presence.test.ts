import { createCanvasEngine } from "@vibecook/ice";
import type { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { describe, expect, it } from "vitest";
import { attachDocumentPresence, presenceColor } from "../src/field/document-presence";
import type { FieldUserProfile } from "../src/host";

const PROFILE: FieldUserProfile = {
  userId: "usr_01",
  fuid: 4,
  name: "James",
  color: "accent-2",
  resident: true,
  onboarded: true,
};

class RoomLane {
  readonly sent: Uint8Array[] = [];
  readonly listeners = new Set<(payload: Uint8Array) => void>();

  onPresence(fn: (payload: Uint8Array) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  sendPresence(payload: Uint8Array): void {
    this.sent.push(payload.slice());
  }

  deliver(payload: Uint8Array): void {
    for (const listener of [...this.listeners]) listener(payload);
  }
}

describe("document presence composition", () => {
  it("resolves the account accent to a portable wire color", () => {
    expect(presenceColor(PROFILE)).toBe("#ec4899");
    expect(presenceColor({ ...PROFILE, color: "oklch(60% 0.2 20)" })).toBe("oklch(60% 0.2 20)");
  });

  it("keeps outbound wired through ICE detach, then removes both transport directions", () => {
    const ce = createCanvasEngine();
    ce.docs.create();
    const lane = new RoomLane();
    const close = attachDocumentPresence({
      ce,
      lane: lane as unknown as DocLaneClient,
      profile: PROFILE,
      docId: "doc-a",
    });
    expect(ce.docs.presence()).toBeDefined();
    expect(lane.listeners.size).toBe(1);

    // Malformed remote input is contained by this optional coeffect and does
    // not prevent the exact graceful inverse from shipping its leave.
    lane.deliver(new Uint8Array([0xff]));
    const before = lane.sent.length;
    close();
    expect(lane.sent.length).toBeGreaterThan(before);
    expect(lane.listeners.size).toBe(0);
    expect(ce.docs.presence()).toBeUndefined();
    close();
    ce.docs.close();
    ce.dispose();
  });
});
