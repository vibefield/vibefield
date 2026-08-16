import { describe, expect, it } from "vitest";
import {
  LiveSurfaceTicketError,
  LiveSurfaceTicketTable,
} from "../src/main/live-surfaces/ticket-table";

interface Authority {
  readonly name: string;
}

function binding(authority: Authority = { name: "alpha" }) {
  return {
    targetWebContentsId: 17,
    rendererGeneration: 3,
    surfaceId: "surface_0123456789abcdef",
    sourceKind: "browser" as const,
    operations: ["view", "pointer"] as const,
    principalId: "lab",
    authority,
  };
}

function deterministicTokens() {
  let sequence = 0;
  return () => `ticket_${String(++sequence).padStart(40, "0")}`;
}

describe("LiveSurfaceTicketTable", () => {
  it("mints bounded opaque tickets and returns the main-private authority once", () => {
    let now = 1_000;
    const table = new LiveSurfaceTicketTable<Authority>({
      now: () => now,
      randomToken: deterministicTokens(),
    });
    const authority = { name: "alpha" };
    const ticket = table.issue(binding(authority));
    expect(ticket).toEqual({ v: 1, token: "ticket_0000000000000000000000000000000000000001" });
    expect(table.size).toBe(1);
    const redeemed = table.redeem(ticket, {
      senderWebContentsId: 17,
      rendererGeneration: 3,
    });
    expect(redeemed.authority).toBe(authority);
    expect(redeemed.operations).toEqual(["view", "pointer"]);
    expect(redeemed.expiresAtMs).toBe(16_000);
    expect(table.size).toBe(0);
    now += 1;
    expect(() => table.redeem(ticket, { senderWebContentsId: 17, rendererGeneration: 3 })).toThrow(
      new LiveSurfaceTicketError("unknown"),
    );
  });

  it("burns an exact token after a wrong-window or wrong-generation attempt", () => {
    const table = new LiveSurfaceTicketTable<Authority>({ randomToken: deterministicTokens() });
    const wrongWindow = table.issue(binding());
    expect(() =>
      table.redeem(wrongWindow, { senderWebContentsId: 18, rendererGeneration: 3 }),
    ).toThrow(new LiveSurfaceTicketError("wrong-window"));
    expect(() =>
      table.redeem(wrongWindow, { senderWebContentsId: 17, rendererGeneration: 3 }),
    ).toThrow(new LiveSurfaceTicketError("unknown"));

    const wrongGeneration = table.issue(binding());
    expect(() =>
      table.redeem(wrongGeneration, { senderWebContentsId: 17, rendererGeneration: 4 }),
    ).toThrow(new LiveSurfaceTicketError("wrong-generation"));
    expect(table.size).toBe(0);
  });

  it("expires, prunes, revokes, and enforces capacity without leaking authorities", () => {
    let now = 100;
    const table = new LiveSurfaceTicketTable<Authority>({
      now: () => now,
      randomToken: deterministicTokens(),
      defaultTtlMs: 10,
      maxTtlMs: 20,
      maxEntries: 2,
    });
    const first = table.issue(binding({ name: "first" }));
    table.issue({ ...binding({ name: "second" }), surfaceId: "surface_9999999999999999" });
    expect(() => table.issue(binding({ name: "third" }))).toThrow(
      new LiveSurfaceTicketError("capacity"),
    );
    expect(table.revokeSurface("surface_9999999999999999")).toBe(1);
    now = 110;
    expect(() => table.redeem(first, { senderWebContentsId: 17, rendererGeneration: 3 })).toThrow(
      new LiveSurfaceTicketError("expired"),
    );
    expect(table.size).toBe(0);
  });

  it("requires view and rejects unsafe identity or TTL inputs before storage", () => {
    const table = new LiveSurfaceTicketTable<Authority>({ randomToken: deterministicTokens() });
    expect(() => table.issue({ ...binding(), operations: ["pointer"] })).toThrow(/include view/);
    expect(() => table.issue({ ...binding(), targetWebContentsId: -1 })).toThrow(/WebContents/);
    expect(() => table.issue(binding(), 60_001)).toThrow(/TTL/);
    expect(table.size).toBe(0);
  });
});
