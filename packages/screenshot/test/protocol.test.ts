import { describe, expect, it } from "vitest";
import { parseScreenshotHelperLine, ScreenshotLineReader } from "../src/protocol";

// SNAP-D2 — the reader is strict, bounded, and poisons itself after the first
// line the contract refuses. Everything the tool does with a helper's stdout
// goes through this, so the verdicts are pinned here without a process.

const READY = '{"v":1,"status":"ready"}';
const OK =
  '{"v":1,"status":"ok","path":"/tmp/vibefield-screenshot-1.png","width":10,"height":8,' +
  '"scale":2,"displayId":1,"bounds":{"x":0,"y":0,"width":5,"height":4}}';

describe("parseScreenshotHelperLine", () => {
  it("returns the typed event for a contract line", () => {
    const verdict = parseScreenshotHelperLine(OK);
    expect(verdict.kind).toBe("event");
    if (verdict.kind !== "event") throw new Error("unreachable");
    expect(verdict.event).toMatchObject({ status: "ok", width: 10, displayId: 1 });
  });

  it("names the reason a line is refused", () => {
    expect(parseScreenshotHelperLine("wrote /tmp/a.png 10x10")).toMatchObject({
      kind: "violation",
      reason: "not-json",
    });
    expect(parseScreenshotHelperLine('{"status":"maybe"}')).toMatchObject({
      kind: "violation",
      reason: "unrecognized",
    });
    // a JSON scalar is JSON, and still not a line the contract admits
    expect(parseScreenshotHelperLine("42")).toMatchObject({
      kind: "violation",
      reason: "unrecognized",
    });
  });

  it("keeps the detail short — an excerpt, never the whole line", () => {
    const verdict = parseScreenshotHelperLine("x".repeat(500));
    expect(verdict.kind).toBe("violation");
    if (verdict.kind !== "violation") throw new Error("unreachable");
    expect(verdict.detail.length).toBeLessThanOrEqual(80);
  });
});

describe("ScreenshotLineReader", () => {
  it("reassembles lines split across chunks and ignores empty lines", () => {
    const reader = new ScreenshotLineReader();
    expect(reader.push(READY.slice(0, 5))).toEqual([]);
    const verdicts = reader.push(`${READY.slice(5)}\n\n${OK.slice(0, 20)}`);
    expect(verdicts.map((v) => v.kind)).toEqual(["event"]);
    const rest = reader.push(`${OK.slice(20)}\n`);
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({ kind: "event", event: { status: "ok" } });
  });

  it("accepts CRLF line endings (a Windows helper writing through a console)", () => {
    const reader = new ScreenshotLineReader();
    const verdicts = reader.push(`${READY}\r\n${OK}\r\n`);
    expect(verdicts.map((v) => v.kind)).toEqual(["event", "event"]);
  });

  it("poisons itself after the first violation and reports nothing more", () => {
    const reader = new ScreenshotLineReader();
    const verdicts = reader.push(`${READY}\nnot json\n${OK}\n`);
    expect(verdicts.map((v) => v.kind)).toEqual(["event", "violation"]);
    expect(reader.poisoned).toBe(true);
    expect(reader.push(`${OK}\n`)).toEqual([]);
  });

  it("refuses a line longer than its bound — with or without a newline", () => {
    const bounded = new ScreenshotLineReader(64);
    const long = `{"v":1,"status":"ready","pad":"${"p".repeat(100)}"}`;
    expect(bounded.push(`${long}\n`)).toEqual([
      { kind: "violation", reason: "line-too-long", detail: `${long.length} bytes` },
    ]);
    const streaming = new ScreenshotLineReader(64);
    expect(streaming.push("x".repeat(40))).toEqual([]);
    const verdicts = streaming.push("x".repeat(40));
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ kind: "violation", reason: "line-too-long" });
    expect(streaming.poisoned).toBe(true);
  });

  it("rejects a nonsensical bound at construction", () => {
    expect(() => new ScreenshotLineReader(0)).toThrow(RangeError);
    expect(() => new ScreenshotLineReader(1.5)).toThrow(RangeError);
  });
});
