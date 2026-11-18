// Item 502 (2026-11-18) — a run's start line names its door by kinds alone (EL7). The forwarded client's kind is
// a value a PEER sent, so the line writes it only when the contracts name it; any other text is `unknown`. The
// line itself is read over the real floor in agent-session.test.ts; this file holds the door facts it is made of.
import { describe, expect, it } from "vitest";
import { RESUMED_WHEN_IDLE, startedThrough } from "../src/agent-started-through";

describe("item 502 — the start line's door facts, kinds alone (EL7)", () => {
  it("a forwarded launch names the forwarded client's kind when the contracts name it, and `unknown` for a peer's own text", () => {
    const peer = { kind: "peer-fieldd", deviceId: "desktop-b" };
    expect(startedThrough("spawn", peer, { clientKind: "ios", deviceId: "phone-1" })).toEqual({
      door: "spawn",
      caller: "peer-fieldd",
      onBehalfOf: "ios",
    });
    expect(
      startedThrough("resume", peer, { clientKind: "a peer's own\nwords", deviceId: "phone-1" }),
    ).toEqual({ door: "resume", caller: "peer-fieldd", onBehalfOf: "unknown" });
  });

  it("names the caller by a principal kind the contracts name, never its token or login, and `unknown` for any other string", () => {
    expect(startedThrough("spawn", { kind: "local-token", tokenId: "tok-1" }, undefined)).toEqual({
      door: "spawn",
      caller: "local-token",
    });
    expect(
      startedThrough("spawn", { kind: "tailnet", login: "someone@example.com" }, undefined),
    ).toEqual({ door: "spawn", caller: "tailnet" });
    expect(startedThrough("spawn", { kind: "someone@example.com" }, undefined)).toEqual({
      door: "spawn",
      caller: "unknown",
    });
    expect(RESUMED_WHEN_IDLE).toEqual({ door: "resume-when-idle", caller: "system" });
  });
});
