import { describe, expect, it } from "vitest";
import { createBoundedLineFramer, type FramedLine } from "../src/index";

describe("bounded shared line framer", () => {
  it("frames split LF/CRLF chunks and flushes a final unterminated line", () => {
    const lines: FramedLine[] = [];
    const framer = createBoundedLineFramer({ maxBytes: 64, onLine: (line) => lines.push(line) });
    framer.push(Buffer.from("one\r"));
    framer.push(Buffer.from("\ntw"));
    framer.push(Buffer.from("o\nthree"));
    framer.flush();
    expect(lines).toEqual([
      { line: "one", truncated: false, inputBytes: 4 },
      { line: "two", truncated: false, inputBytes: 3 },
      { line: "three", truncated: false, inputBytes: 5 },
    ]);
  });

  it("emits one bounded prefix, discards through newline, and then resumes", () => {
    const lines: FramedLine[] = [];
    const framer = createBoundedLineFramer({ maxBytes: 8, onLine: (line) => lines.push(line) });
    framer.push("123456789");
    framer.push("discarded");
    framer.push("\nnext\n");
    expect(lines).toEqual([
      { line: "12345678", truncated: true, inputBytes: 9 },
      { line: "next", truncated: false, inputBytes: 4 },
    ]);
  });

  it("uses replacement decoding for invalid UTF-8 and measures bytes, not characters", () => {
    const lines: FramedLine[] = [];
    const framer = createBoundedLineFramer({ maxBytes: 5, onLine: (line) => lines.push(line) });
    framer.push(Buffer.from([0xf0, 0x9f, 0x99, 0x82, 0xff, 0x61]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ line: "🙂�", truncated: true, inputBytes: 6 });
  });

  it("rejects a non-positive or unsafe bound", () => {
    expect(() => createBoundedLineFramer({ maxBytes: 0, onLine: () => undefined })).toThrow(
      "positive safe integer",
    );
  });
});
