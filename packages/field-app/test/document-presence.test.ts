import { createCanvasEngine } from "@vibecook/ice";
import type { DocLaneClient } from "@vibefield/fieldd-client/doclane";
import { describe, expect, it } from "vitest";
import {
  attachDocumentPresence,
  PRESENCE_INK_FALLBACK,
  presenceColor,
  presenceName,
} from "../src/field/document-presence";
import type { FieldUserProfile } from "../src/host";

const PROFILE: FieldUserProfile = {
  userId: "usr_01",
  fuid: 4,
  name: "James",
  face: { emoji: "🦊" },
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
  it("draws every cursor in the one neutral ink — a person has no colour (UA-D17)", () => {
    // jsdom resolves no custom properties, so the wire gets the token's own
    // value: a real colour, never a var() a peer in another theme can't read.
    expect(presenceColor()).toBe(PRESENCE_INK_FALLBACK);
    expect(presenceColor()).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("labels the cursor with the face, then the name", () => {
    expect(presenceName(PROFILE)).toBe("🦊 James");
    // A pre-v0.3 profile (an accent, no face yet) wears the machine's deal.
    const legacy: FieldUserProfile = {
      userId: PROFILE.userId,
      fuid: PROFILE.fuid,
      name: PROFILE.name,
      color: "accent-2",
      resident: true,
      onboarded: true,
    };
    expect(presenceName(legacy)).toMatch(/^\S+ James$/u);
    expect(presenceName(legacy)).not.toContain("accent");
    expect(presenceName({ ...PROFILE, name: "   " })).toBe("");
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
