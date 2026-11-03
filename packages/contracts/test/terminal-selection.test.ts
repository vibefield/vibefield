import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeTpMessage,
  KNOWN_CAPABILITIES,
  SelectionTextRequest,
  SelectionTextResult,
  TP_LEG_INBOUND,
  TP_LEG_OUTBOUND,
} from "../src/terminal-pipeline";

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8"));

describe("negotiated terminal selection reads", () => {
  it("shares Unicode fixtures with Swift and the native host and stays on control", () => {
    const request = SelectionTextRequest.parse(fixture("tp-selection-text-request.valid"));
    const result = SelectionTextResult.parse(fixture("tp-selection-text-result.unicode"));
    expect(result.text).toBe("中-é-👩‍💻-🛙X\nrow 160");
    expect(KNOWN_CAPABILITIES).toContain("selection-text");
    expect(
      decodeTpMessage({ type: "SelectionTextRequest", ...request }, TP_LEG_INBOUND.control).ok,
    ).toBe(true);
    expect(
      decodeTpMessage({ type: "SelectionTextResult", ...result }, TP_LEG_OUTBOUND.control).ok,
    ).toBe(true);
    expect(
      decodeTpMessage({ type: "SelectionTextRequest", ...request }, TP_LEG_INBOUND.frames).ok,
    ).toBe(false);
    expect(
      decodeTpMessage({ type: "SelectionTextResult", ...result }, TP_LEG_INBOUND.control).ok,
    ).toBe(false);
  });

  it("requires safe coordinates and exactly one complete result", () => {
    const request = fixture("tp-selection-text-request.valid");
    for (const mutation of [
      { requestId: "" },
      { requestId: "x".repeat(65) },
      { sessionId: "x".repeat(257) },
      { startColumn: -1 },
      { endColumn: 65_536 },
      { startRow: 4_294_967_296 },
      { leaseEpoch: Number.MAX_SAFE_INTEGER + 1 },
      { selectAll: 1 },
    ])
      expect(SelectionTextRequest.safeParse({ ...request, ...mutation }).success).toBe(false);
    const result = fixture("tp-selection-text-result.unicode");
    expect(SelectionTextResult.safeParse({ ...result, text: "" }).success).toBe(true);
    expect(SelectionTextResult.safeParse({ ...result, error: "TOO_LARGE" }).success).toBe(false);
    expect(
      SelectionTextResult.safeParse({ ...result, text: undefined, error: "TOO_LARGE" }).success,
    ).toBe(true);
    expect(SelectionTextResult.safeParse({ ...result, text: undefined }).success).toBe(false);
  });
});
