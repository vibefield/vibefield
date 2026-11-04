import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeTpMessage,
  KNOWN_CAPABILITIES,
  RequestScene,
  TP_LEG_INBOUND,
} from "../src/terminal-pipeline";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/tp-request-scene.valid.json", import.meta.url), "utf8"),
);

describe("negotiated scene repair", () => {
  it("shares its golden with Swift and Rust and belongs only on frames", () => {
    const body = RequestScene.parse(fixture);
    expect(KNOWN_CAPABILITIES).toContain("scene-repair");
    expect(decodeTpMessage({ type: "RequestScene", ...body }, TP_LEG_INBOUND.frames).ok).toBe(true);
    expect(decodeTpMessage({ type: "RequestScene", ...body }, TP_LEG_INBOUND.control).ok).toBe(
      false,
    );
  });

  it("requires a current activation identity and a JSON-safe epoch", () => {
    for (const mutation of [
      { sessionId: "" },
      { activationId: "" },
      { leaseEpoch: -1 },
      { leaseEpoch: 0.5 },
      { leaseEpoch: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(RequestScene.safeParse({ ...fixture, ...mutation }).success).toBe(false);
    }
  });
});
