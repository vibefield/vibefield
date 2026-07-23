import { join } from "node:path";
import { CONTRACTS_VERSION } from "@vibefield/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFielddSupervisor,
  createLineBuffer,
  createLogTail,
  type FielddSupervisorEvent,
  MAX_PARTIAL_LINE_BYTES,
  PARTIAL_LINE_TRUNCATION_MARKER,
  redactLine,
} from "../src/index";
import { createHarness, FIXTURE_READY, type Harness } from "./helpers";

// §12.2 log redaction: the unit primitives (redactLine · createLineBuffer ·
// createLogTail) and the end-to-end guarantee that a secret printed by a
// spawned child never reaches a typed output event in the clear (EL7).

let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

describe("redactLine", () => {
  it("masks a /t/<pathSecret> capability URL", () => {
    const out = redactLine("dialing GET /t/AbCdEf0123456789ghijklmn for the serve");
    expect(out).toContain("/t/[redacted]");
    expect(out).not.toContain("AbCdEf0123456789ghijklmn");
  });

  it("masks a token=<value> bearer shape", () => {
    const out = redactLine("connecting with token=SUPERSECRETvalue0123456789 now");
    expect(out).toBe("connecting with token=[redacted] now");
    expect(out).not.toContain("SUPERSECRETvalue0123456789");
  });

  it("leaves short token-ish values and ordinary lines untouched", () => {
    expect(redactLine("token=abc")).toBe("token=abc"); // below the 16-char floor
    expect(redactLine("fieldd up :49410 (boot-abc)")).toBe("fieldd up :49410 (boot-abc)");
  });
});

describe("createLineBuffer", () => {
  it("splits lines across chunk boundaries", () => {
    const lines: string[] = [];
    const buf = createLineBuffer((l) => lines.push(l));
    buf.push("hel");
    buf.push("lo\nwor");
    buf.push("ld\n");
    expect(lines).toEqual(["hello", "world"]);
  });

  it("flush() emits an unterminated tail (child died mid-line)", () => {
    const lines: string[] = [];
    const buf = createLineBuffer((l) => lines.push(l));
    buf.push("partial tail no newline");
    expect(lines).toEqual([]); // nothing emitted until the newline or flush
    buf.flush();
    expect(lines).toEqual(["partial tail no newline"]);
  });

  it("redacts each emitted line and skips empty ones", () => {
    const lines: string[] = [];
    const buf = createLineBuffer((l) => lines.push(l));
    buf.push("\n\n"); // pure blank lines never emit
    buf.push("token=abcdefghijklmnop0123456\n");
    expect(lines).toEqual(["token=[redacted]"]);
  });

  it("caps an unterminated line, emits one truncation marker, and resumes after newline", () => {
    const lines: string[] = [];
    const buf = createLineBuffer((l) => lines.push(l));
    const secret = "token=abcdefghijklmnop0123456";
    buf.push(`${secret}${"x".repeat(MAX_PARTIAL_LINE_BYTES)}`);
    buf.push("discarded remainder");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("token=[redacted]");
    expect(lines[0]).toContain(PARTIAL_LINE_TRUNCATION_MARKER);
    expect(lines[0]).not.toContain("abcdefghijklmnop0123456");

    buf.push("\nnext line\n");
    expect(lines.at(-1)).toBe("next line");
    expect(lines.filter((line) => line.includes(PARTIAL_LINE_TRUNCATION_MARKER))).toHaveLength(1);
  });

  it("measures the partial-line limit in bytes rather than UTF-16 characters", () => {
    const lines: string[] = [];
    const buf = createLineBuffer((l) => lines.push(l));
    buf.push("🙂".repeat(MAX_PARTIAL_LINE_BYTES / 4 + 1));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(PARTIAL_LINE_TRUNCATION_MARKER);
  });
});

describe("createLogTail", () => {
  it("keeps only the last N lines", () => {
    const tail = createLogTail(3);
    for (const n of ["1", "2", "3", "4", "5"]) tail.note(n);
    expect(tail.lines()).toEqual(["3", "4", "5"]);
  });

  it("returns a copy, not the live buffer", () => {
    const tail = createLogTail();
    tail.note("a");
    const snap = tail.lines();
    tail.note("b");
    expect(snap).toEqual(["a"]); // the earlier snapshot is unaffected
  });
});

describe("redaction through a spawned child", () => {
  it("a secret the child prints is [redacted] in unexpected stdout and never leaks raw", async () => {
    const raw = "abcdefghijklmnopqrstuvwxyz123456";
    const secretLine = `token=${raw}`;
    const { port, token } = await h.startProduct();
    const root = h.mkRoot();
    const script = h.writeFixture(join(root, "fx"), "fieldd.mjs", FIXTURE_READY);
    const events: FielddSupervisorEvent[] = [];
    const sup = h.track(
      createFielddSupervisor({
        dataRoot: root,
        spawn: { command: process.execPath, args: [script] },
        environment: {
          CV: CONTRACTS_VERSION,
          TEST_PRODUCT_PORT: String(port),
          SHELL_TOKEN: token,
          PRINT_SECRET: secretLine,
        },
        shutdownPolicy: "leave-running",
        adoptProbeMs: 300,
        readinessDeadlineMs: 3000,
        onEvent: (event) => events.push(event),
      }),
    );

    const handle = await sup.ensure();
    h.trackPid(handle.childPid);

    const output = events
      .filter(
        (event): event is Extract<FielddSupervisorEvent, { kind: "unexpected-stdout" }> =>
          event.kind === "unexpected-stdout",
      )
      .map((event) => event.line);
    const joined = output.join("\n");
    expect(joined).not.toContain(raw); // the raw secret never reached the sink
    expect(output.some((line) => line.includes("token=[redacted]"))).toBe(true);
    expect(events.filter((event) => event.kind === "readiness")).toHaveLength(1);
  });
});
