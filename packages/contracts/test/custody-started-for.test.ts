// OB custody (rule 6; K5) — the floor remembers what each terminal was started for, so a fieldd started beside a
// living floor is told it by a survivor and never reads it back from a file an agent can rewrite. The shapes' own
// rows: custody.ts `TerminalStartedFor*`, mgmt.ts `NativeTerminalStartedForSet*`, envelope.ts `HelloAck.startedFor`,
// registries.ts `CUSTODY.STARTED_FOR_MAX`. The table rides the HELLO ACK and nothing of it is on a terminal's row:
// the last row here keeps that so.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TerminalStartedFor,
  TerminalStartedForEntry,
  TerminalStartedForId,
  TerminalStartedForProcess,
} from "../src/custody";
import { HelloAck } from "../src/envelope";
import { METHODS } from "../src/methods";
import {
  NativeTerminalStartedForSetParams,
  NativeTerminalStartedForSetResult,
  ObservedTerminal,
} from "../src/mgmt";
import { CUSTODY, MESH_CONTROL_LIMITS } from "../src/registries";
import { TerminalInfo } from "../src/terminal";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const record = (name: string) => fixture(name) as Record<string, unknown>;

const SET = "native-terminal-started-for-set-params";
const SESSION = "sess-01J9A2T4";
const ROOT = "4bd1c7e2-6f0a-4c3e-9a55-1f2e3d4c5b6a";
const PROCESS = { pid: 48213, startedAtMs: 1792431662417 };
/** whether the floor would read a set of `startedFor` on one terminal */
const setOf = (startedFor: unknown): boolean =>
  NativeTerminalStartedForSetParams.safeParse({ sessionId: SESSION, startedFor }).success;
const FLOOR = { contractsVersion: "0.1.0", serverKind: "field-native", grantedScopes: [] };
/** whether a floor's ack carrying `startedFor` is an ack */
const ackOf = (startedFor: unknown): boolean =>
  HelloAck.safeParse({ ...FLOOR, startedFor }).success;

describe("OB custody — what a terminal was started for, as fieldd tells the floor", () => {
  it("sets a plain run, a spark's run with its root, and a typed run with its process", () => {
    const plain = NativeTerminalStartedForSetParams.parse(fixture(`${SET}.valid.json`));
    expect(plain).toEqual({
      sessionId: "5e6f7a8b-9c0d-4e1f-a2b3-c4d5e6f7a8b9",
      startedFor: { run: "run-1" },
    });
    const spark = NativeTerminalStartedForSetParams.parse(fixture(`${SET}.spark.json`));
    expect(spark.sessionId).toBe("sess-01JB7Q2V");
    expect(spark.startedFor).toEqual({ run: "run-12", spark: "sp-7k2m9q4x", root: ROOT });
    const typed = NativeTerminalStartedForSetParams.parse(fixture(`${SET}.typed.json`));
    expect(typed.sessionId).toBe(SESSION);
    expect(typed.startedFor).toEqual({ run: "run-7", process: PROCESS });
  });

  it("clears by leaving `startedFor` out, and never by a null", () => {
    const clear = NativeTerminalStartedForSetParams.parse(fixture(`${SET}.clear.json`));
    expect(clear).toEqual({ sessionId: SESSION });
    expect("startedFor" in record(`${SET}.clear.json`)).toBe(false);
    expect(setOf(null)).toBe(false);
    // a clear still names its terminal
    expect(NativeTerminalStartedForSetParams.safeParse({}).success).toBe(false);
  });

  it("answers a set and a clear alike, with nothing in the answer", () => {
    const answered = fixture("native-terminal-started-for-set-result.valid.json");
    expect(NativeTerminalStartedForSetResult.parse(answered)).toEqual({});
    expect(Object.keys(NativeTerminalStartedForSetResult.shape)).toEqual([]);
    // a tolerant reader: a floor that one day says more is still read (P3)
    expect(NativeTerminalStartedForSetResult.safeParse({ kept: true }).success).toBe(true);
  });

  it("needs a run, and takes a spark, a process and a root beside it", () => {
    expect(Object.keys(TerminalStartedFor.shape)).toEqual(["run", "spark", "process", "root"]);
    expect(setOf({ run: "run-7" })).toBe(true);
    expect(setOf({})).toBe(false);
    expect(setOf({ spark: "sp-7k2m9q4x", process: PROCESS, root: ROOT })).toBe(false);
    expect(TerminalStartedFor.safeParse({ run: "run-7" }).success).toBe(true);
  });

  it("refuses a process whose pid is 0 or 1, and one with no whole start", () => {
    // 0 is the kernel's and 1 is launchd's: neither is ever a process a person typed
    for (const pid of [0, 1, -1, 1.5, "48213", null]) {
      expect(setOf({ run: "run-7", process: { ...PROCESS, pid } }), String(pid)).toBe(false);
    }
    expect(setOf({ run: "run-7", process: { ...PROCESS, pid: 2 } })).toBe(true);
    for (const startedAtMs of [-1, 1.5, "1792431662417"]) {
      const typed = { ...PROCESS, startedAtMs };
      expect(setOf({ run: "run-7", process: typed }), String(startedAtMs)).toBe(false);
    }
    expect(setOf({ run: "run-7", process: { pid: PROCESS.pid } })).toBe(false);
    expect(Object.keys(TerminalStartedForProcess.shape)).toEqual(["pid", "startedAtMs"]);
    expect(TerminalStartedForProcess.safeParse({ ...PROCESS, startedAtMs: 0 }).success).toBe(true);
  });

  it("holds every id to 1 to 128 characters: a run, a spark, a root and the session", () => {
    const longest = "r".repeat(128);
    expect(TerminalStartedForId.safeParse(longest).success).toBe(true);
    for (const id of ["", `${longest}r`, 7, null]) {
      expect(TerminalStartedForId.safeParse(id).success, String(id)).toBe(false);
    }
    // a 129-character one is refused where it stands, and a 128-character one is taken there
    for (const key of ["run", "spark", "root"] as const) {
      expect(setOf({ run: "run-7", [key]: longest }), key).toBe(true);
      expect(setOf({ run: "run-7", [key]: `${longest}r` }), key).toBe(false);
      expect(setOf({ run: "run-7", [key]: "" }), key).toBe(false);
    }
    const onSession = (sessionId: string): boolean => {
      const set = { sessionId, startedFor: { run: "run-7" } };
      return NativeTerminalStartedForSetParams.safeParse(set).success;
    };
    expect(onSession(longest)).toBe(true);
    expect(onSession(`${longest}r`)).toBe(false);
    expect(onSession("")).toBe(false);
  });
});

describe("OB custody — the hello ack hands the table to the next fieldd", () => {
  it("carries a typed run's entry and a spark's with its root", () => {
    const ack = HelloAck.parse(fixture("hello-ack.started-for.json"));
    expect(ack.startedFor).toEqual([
      { sessionId: SESSION, run: "run-7", process: PROCESS },
      { sessionId: "sess-01JB7Q2V", run: "run-12", spark: "sp-7k2m9q4x", root: ROOT },
    ]);
    for (const entry of ack.startedFor ?? []) {
      expect(TerminalStartedForEntry.safeParse(entry).success, entry.sessionId).toBe(true);
    }
    // the marks ride the same ack: one survivor's memory, two things in it
    expect(ack.marks).toEqual({ [CUSTODY.MARK_OBJECT_GRANTS]: 8 });
  });

  // Spelled out twice and never `.extend()`ed: the generator writes an extension as references into the parent's own
  // properties, which typify cannot follow (mgmt.ts says so at `TerminalRoutesStreamPayload`). This row is what
  // keeps the two spellings one shape.
  it("spells an entry as the set's own shape with its session beside it, field for field", () => {
    const set = TerminalStartedFor.shape;
    const entry = TerminalStartedForEntry.shape;
    expect(Object.keys(entry)).toEqual(["sessionId", ...Object.keys(set)]);
    expect(entry.sessionId).toBe(TerminalStartedForId);
    expect(entry.run).toBe(TerminalStartedForId);
    expect(set.run).toBe(TerminalStartedForId);
    for (const key of ["spark", "root"] as const) {
      expect(entry[key].unwrap(), key).toBe(TerminalStartedForId);
      expect(set[key].unwrap(), key).toBe(TerminalStartedForId);
    }
    expect(entry.process.unwrap()).toBe(TerminalStartedForProcess);
    expect(set.process.unwrap()).toBe(TerminalStartedForProcess);
  });

  it("still parses with no table, and says nothing of one", () => {
    for (const name of ["hello-ack.marks.json", "hello-ack.pid.json", "hello-ack.valid.json"]) {
      expect(HelloAck.parse(fixture(name)).startedFor, name).toBeUndefined();
      expect("startedFor" in record(name), name).toBe(false);
    }
    // an empty table is a table: a floor that holds nothing may say so, or say nothing
    expect(ackOf([])).toBe(true);
  });

  it("refuses a table past the bound, and takes one at it", () => {
    const entries = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ sessionId: `sess-${i}`, run: `run-${i}` }));
    expect(ackOf(entries(CUSTODY.STARTED_FOR_MAX))).toBe(true);
    expect(ackOf(entries(CUSTODY.STARTED_FOR_MAX + 1))).toBe(false);
    expect(ackOf(entries(1025))).toBe(false);
  });

  // The SCHEMA is whole or not at all. fieldd does not read a live ack through it: it reads the table entry by entry
  // and skips the one that fails, so a single bad entry never costs the rest (its own rows, in fieldd).
  it("refuses a table that is no list of whole entries", () => {
    expect(ackOf({ [SESSION]: { run: "run-7" } })).toBe(false);
    expect(ackOf([{ run: "run-7" }])).toBe(false);
    expect(ackOf([{ sessionId: SESSION }])).toBe(false);
    const launchd = { sessionId: SESSION, run: "run-7", process: { ...PROCESS, pid: 1 } };
    expect(ackOf([launchd])).toBe(false);
    expect(ackOf([{ sessionId: SESSION, run: "r".repeat(129) }])).toBe(false);
  });

  it("keeps the fullest table well inside one mgmt frame", () => {
    // the widest an id can be on the wire: 128 characters of three bytes each
    const id = "界".repeat(128);
    const widest = Number.MAX_SAFE_INTEGER;
    const full = Array.from({ length: CUSTODY.STARTED_FOR_MAX }, () => ({
      sessionId: id,
      run: id,
      spark: id,
      process: { pid: widest, startedAtMs: widest },
      root: id,
    }));
    expect(full).toHaveLength(1024);
    expect(ackOf(full)).toBe(true);
    const bytes = Buffer.byteLength(JSON.stringify({ ...FLOOR, startedFor: full }));
    // about 1.7 MB at the very fullest, against a frame of 80 MiB
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
    expect(bytes).toBeLessThan(MESH_CONTROL_LIMITS.MGMT_FRAME_BYTES);
  });
});

describe("OB custody — the verb, and the table's bound", () => {
  it("declares the verb as the marks verb is declared, field for field", () => {
    const marks = METHODS.find((m) => m.method === "native.marks.set");
    const startedFor = METHODS.find((m) => m.method === "native.terminal.startedFor.set");
    expect(marks).toBeDefined();
    expect(startedFor).toEqual({ ...marks, method: "native.terminal.startedFor.set" });
    expect(startedFor).toEqual({
      surface: "mgmt",
      method: "native.terminal.startedFor.set",
      scope: null,
      idempotent: true,
      locality: "local",
    });
  });

  it("bounds the table at 1024 terminals", () => {
    expect(CUSTODY.STARTED_FOR_MAX).toBe(1024);
  });
});

describe("OB custody — the product's terminal row is not the table's carrier", () => {
  // `TerminalInfo` IS `ObservedTerminal` (terminal.ts), so a field on the floor's row would be a field on the row
  // every window, plugin and peer reads. A guard: green before K5 and after it.
  it("puts none of it on the observed row, which is the product's `TerminalInfo`", () => {
    expect(TerminalInfo).toBe(ObservedTerminal);
    expect(Object.keys(ObservedTerminal.shape)).not.toContain("startedFor");
  });
});
