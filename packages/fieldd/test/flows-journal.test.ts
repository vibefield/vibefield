import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FLOW_RECORD_FORMAT, type FlowJournalHead, RECORD_STORES } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { JOURNAL_SUFFIX, RUNS_DIR } from "../src/flows/journal";
import { FlowRecords } from "../src/flows/records";
import { RecordSigner, UNREADABLE_WORDS } from "../src/signed-record";
import { beganRun } from "./flows-run-records";

// CP-4a2a (step0-cp4a2.md §12 commit 8; CP4-S15, CP-D9; 4A2-Q10 (a), ruled by VF-PM 2026-11-05 08:51Z) — a run's
// journal, kept by the flows store (FlowRecords) beside the approvals: lines that chain, a line that is not VibeField's
// setting its run aside as lost, a disk that does not answer refused in fieldd's words (item 172), and contracts'
// four fixtures read under the fixture key they were signed with (EL9's second side).

const RUN = "fr-k3v9q2m7x1";
const FIXTURES = join(import.meta.dirname, "..", "..", "contracts", "fixtures");
const fixtureText = (name: string): string => readFileSync(join(FIXTURES, `${name}.json`), "utf8");
/** The key contracts' journal fixtures were MAC'd under (packages/contracts/test/flows.test.ts names the rule). */
const FIXTURE_KEY = createHash("sha256").update("flows journal fixture key").digest("hex");

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function store(opts: { key?: string; readFile?: (path: string) => string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vf-flows-journal-"));
  roots.push(root);
  const dir = join(root, "fieldd", "flows");
  const keyPath = join(root, "fieldd", "flows.key");
  if (opts.key !== undefined) {
    mkdirSync(join(root, "fieldd"), { recursive: true, mode: 0o700 });
    writeFileSync(keyPath, opts.key, { mode: 0o600 });
  }
  const records = new FlowRecords({ dir, keyPath, readFile: opts.readFile });
  const file = join(dir, RUNS_DIR, `${RUN}${JOURNAL_SUFFIX}`);
  return { root, dir, keyPath, records, file };
}

const HEAD = {
  run: RUN,
  flow: "release-check",
  name: "Release check",
  n: 3,
  hash: "ffe093265fa8ada081e77b87d6311a7a0079580e98c7739307e85d3c6c471870",
  starter: { by: "you" },
} as const;

/** A journal written by the store itself: the head, a call, its answer. */
function written() {
  const s = store();
  beganRun(s.records, HEAD);
  s.records.appendRun(RUN, {
    kind: "call",
    call: 1,
    what: "agent",
    key: "a".repeat(64),
    n: 1,
    label: "review",
  });
  s.records.appendRun(RUN, { kind: "answer", call: 1, value: { verdict: "clean" } });
  // the row's own reads of the file come after the store is seen to have written it
  expect(existsSync(s.file), "the store wrote the run's journal").toBe(true);
  return s;
}

/** The journal's lines as JSON, to edit as an agent would. */
const linesOf = (file: string): string[] => readFileSync(file, "utf8").split("\n").filter(Boolean);

const asides = (dir: string): string[] =>
  readdirSync(join(dir, RUNS_DIR)).filter((name) => name !== `${RUN}${JOURNAL_SUFFIX}`);

describe("CP-4a2a — a run's journal, kept by the flows store (CP4-S15)", () => {
  it("J1: lines append in order, each chained to the one before, and read back whole", () => {
    const s = written();
    s.records.appendRun(RUN, { kind: "log", text: "reviewed" });
    s.records.appendRun(RUN, { kind: "end", state: "done" });
    const read = s.records.readRun(RUN);
    expect(read.kind).toBe("kept");
    const kept = read as Extract<typeof read, { kind: "kept" }>;
    expect(kept.head).toMatchObject({ ...HEAD, format: FLOW_RECORD_FORMAT, seq: 1, kind: "head" });
    expect(kept.lines.map((line) => [line.seq, line.kind])).toEqual([
      [1, "head"],
      [2, "call"],
      [3, "answer"],
      [4, "log"],
      [5, "end"],
    ]);
    // each line's MAC names the one before it: a line's mac is its successor's prev
    const raw = linesOf(s.file).map((line) => JSON.parse(line) as { mac?: unknown });
    expect(
      raw.every((line) => typeof line.mac === "string" && /^[0-9a-f]{64}$/.test(line.mac)),
    ).toBe(true);
    expect(new Set(raw.map((line) => line.mac)).size).toBe(raw.length);
    expect(s.records.runs()).toEqual([RUN]);
  });

  it("J1b: contracts' fixtures, a chain of head, call and answer, read back under the key they were signed with", () => {
    const s = store({ key: FIXTURE_KEY });
    mkdirSync(join(s.dir, RUNS_DIR), { recursive: true, mode: 0o700 });
    const text = ["flow-journal-head.valid", "flow-journal-line.call", "flow-journal-line.answer"]
      .map((name) => JSON.stringify(JSON.parse(fixtureText(name))))
      .join("\n");
    writeFileSync(s.file, `${text}\n`, { mode: 0o600 });
    const read = s.records.readRun(RUN);
    expect(read.kind).toBe("kept");
    expect((read as { lines?: { kind: string }[] }).lines?.map((line) => line.kind)).toEqual([
      "head",
      "call",
      "answer",
    ]);
  });

  it("J2: a forged line (an answer changed after it was signed) sets the run aside as lost, never replayed", () => {
    const s = store({ key: FIXTURE_KEY });
    mkdirSync(join(s.dir, RUNS_DIR), { recursive: true, mode: 0o700 });
    const text = ["flow-journal-head.valid", "flow-journal-line.call", "flow-journal-line.forged"]
      .map((name) => JSON.stringify(JSON.parse(fixtureText(name))))
      .join("\n");
    writeFileSync(s.file, `${text}\n`, { mode: 0o600 });
    expect(s.records.readRun(RUN)).toEqual({ kind: "lost", why: "forged", line: 3 });
    // set aside beside itself for a person to look at, and never read again
    expect(asides(s.dir)).toHaveLength(1);
    expect(asides(s.dir)[0]).toMatch(new RegExp(`^${RUN}\\.jsonl\\.forged-\\d+$`));
    expect(s.records.readRun(RUN)).toEqual({ kind: "absent" });
    expect(s.records.runs()).toEqual([]);
  });

  it("J3: a dropped line (the call taken out) sets the run aside as lost", () => {
    const s = written();
    const [head, , answer] = linesOf(s.file);
    writeFileSync(s.file, `${head}\n${answer}\n`, { mode: 0o600 });
    expect(s.records.readRun(RUN)).toMatchObject({ kind: "lost", line: 2 });
    expect(asides(s.dir)).toHaveLength(1);
  });

  it("J4: reordered lines (the answer before its call) set the run aside as lost", () => {
    const s = written();
    const [head, call, answer] = linesOf(s.file);
    writeFileSync(s.file, `${head}\n${answer}\n${call}\n`, { mode: 0o600 });
    expect(s.records.readRun(RUN)).toMatchObject({ kind: "lost", line: 2 });
    // and a line copied in from another run's journal is not this run's
    const other = written();
    const copied = linesOf(other.file)[1];
    const t = written();
    writeFileSync(t.file, `${linesOf(t.file)[0]}\n${copied}\n`, { mode: 0o600 });
    expect(t.records.readRun(RUN)).toMatchObject({ kind: "lost" });
  });

  it("J5: a journal the disk does not answer (EMFILE) is left where it is, and refused in the flows' words", () => {
    const s0 = written();
    const bytes = readFileSync(s0.file, "utf8");
    const tries: string[] = [];
    const records = new FlowRecords({
      dir: s0.dir,
      keyPath: s0.keyPath,
      readFile: (path) => {
        if (path === s0.file) {
          tries.push(path);
          throw Object.assign(new Error("too many open files"), { code: "EMFILE" });
        }
        return readFileSync(path, "utf8");
      },
    });
    let refused: unknown;
    try {
      records.readRun(RUN);
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({
      kind: "UNAVAILABLE",
      retryable: true,
      details: { service: RECORD_STORES.SERVICE_FLOWS, state: RECORD_STORES.STATE_UNREADABLE },
      message: UNREADABLE_WORDS.flows,
    });
    expect(tries).toHaveLength(RECORD_STORES.READ_TRIES);
    expect(readFileSync(s0.file, "utf8")).toBe(bytes);
    expect(asides(s0.dir)).toEqual([]);
  });

  it("J6: a journal a newer VibeField began is kept for it, never read as this one, and never written to", () => {
    const s = store();
    beganRun(s.records, HEAD);
    expect(existsSync(s.file), "the store wrote the run's head").toBe(true);
    // re-signed by the store's own key with a newer format: a newer VibeField's head, not an edit
    const signer = new RecordSigner({ keyPath: s.keyPath });
    const head = JSON.parse(linesOf(s.file)[0] as string) as FlowJournalHead & { mac: string };
    const { mac: _mac, ...unsigned } = { ...head, format: FLOW_RECORD_FORMAT + 1 };
    const mac = signer.sign({ run: RUN, prev: "", line: unsigned });
    writeFileSync(s.file, `${JSON.stringify({ ...unsigned, mac })}\n`, { mode: 0o600 });
    const bytes = readFileSync(s.file, "utf8");
    expect(s.records.readRun(RUN)).toEqual({ kind: "newer", format: FLOW_RECORD_FORMAT + 1 });
    expect(() => s.records.appendRun(RUN, { kind: "log", text: "more" })).toThrow();
    expect(readFileSync(s.file, "utf8")).toBe(bytes);
    expect(asides(s.dir)).toEqual([]);
  });

  it("J6b: a line the disk never finished (a crash mid-write, no newline after it) is no line, and no proof of anything", () => {
    const s = written();
    writeFileSync(s.file, `${readFileSync(s.file, "utf8")}{"format":1,"seq":4,"ki`, {
      mode: 0o600,
    });
    const read = s.records.readRun(RUN);
    expect(read.kind).toBe("kept");
    expect((read as { lines?: unknown[] }).lines).toHaveLength(3);
  });

  it("J6c: every journal is 0600 in a 0700 folder, and one open to other users is not VibeField's", () => {
    const s = written();
    expect(readFileSync(s.file, "utf8").length).toBeGreaterThan(0);
    const mode = (path: string) => statSync(path).mode & 0o777;
    expect(mode(s.file)).toBe(0o600);
    expect(mode(join(s.dir, RUNS_DIR))).toBe(0o700);
    chmodSync(s.file, 0o644);
    expect(s.records.readRun(RUN)).toMatchObject({ kind: "lost", why: "exposed" });
  });

  it("J6d: after a line the disk never finished, the next line starts on its own: the piece is dropped, never glued to", () => {
    const s = written();
    const whole = readFileSync(s.file, "utf8");
    writeFileSync(s.file, `${whole}{"format":1,"seq":4,"ki`, { mode: 0o600 });
    // fieldd started again after the crash: its store reads the journal's tail from the file, then appends
    const restarted = new FlowRecords({ dir: s.dir, keyPath: s.keyPath });
    restarted.appendRun(RUN, { kind: "log", text: "after the crash" });
    const read = restarted.readRun(RUN);
    expect(read).toMatchObject({ kind: "kept" });
    const kept = read as Extract<typeof read, { kind: "kept" }>;
    expect(kept.lines.map((line) => [line.seq, line.kind])).toEqual([
      [1, "head"],
      [2, "call"],
      [3, "answer"],
      [4, "log"],
    ]);
    const after = readFileSync(s.file, "utf8");
    expect(after.startsWith(whole), "the lines before the piece are untouched").toBe(true);
    expect(after).not.toContain('"ki{');
  });

  it("J9: a line nested past the journal's bound, however deep, reads the run as lost, never thrown (bth's review P1)", () => {
    for (const depth of [64, 200_000]) {
      const s = written();
      const [head, call] = linesOf(s.file);
      const line = `{"format":1,"seq":3,"kind":"answer","call":1,"value":${"[".repeat(depth)}1${"]".repeat(depth)},"at":"2026-11-05T12:00:00.000Z","mac":"${"0".repeat(64)}"}`;
      writeFileSync(s.file, `${head}\n${call}\n${line}\n`, { mode: 0o600 });
      const restarted = new FlowRecords({ dir: s.dir, keyPath: s.keyPath });
      let read: unknown;
      try {
        read = restarted.readRun(RUN);
      } catch (error) {
        read = { threw: (error as Error).message };
      }
      expect(read, `a line ${depth} deep`).toMatchObject({ kind: "lost", line: 3 });
    }
  });

  it("J8: a journal cut short reads kept to the cut after a restart (no anchor yet), but the store that wrote it knows its tail", () => {
    const s = written();
    const [head, call] = linesOf(s.file);
    writeFileSync(s.file, `${head}\n${call}\n`, { mode: 0o600 });
    // fieldd started again: a store that never wrote this journal cannot tell the cut from a crash between a call and
    // its answer. The anchor, the tail kept in the run's own signed record, is CP-4a2b's (Owed); DESIGN.md §9 says so.
    const restarted = new FlowRecords({ dir: s.dir, keyPath: s.keyPath });
    const read = restarted.readRun(RUN);
    expect(read).toMatchObject({ kind: "kept", tail: { seq: 2 } });
    // the store that wrote it to seq 3 reads seq 2 as a cut, never as a crash: the run is set aside, never replayed
    expect(s.records.readRun(RUN)).toEqual({ kind: "lost", why: "forged", line: 3 });
    expect(asides(s.dir)).toHaveLength(1);
  });

  it("J8b: a newer format no key signed is forged, never kept for a newer VibeField (the MAC is read before the format)", () => {
    const s = written();
    const lines = linesOf(s.file);
    const head = JSON.parse(lines[0] as string) as Record<string, unknown>;
    // the format raised by hand and the store's MAC left as it was: only the key signs a newer VibeField's head
    lines[0] = JSON.stringify({ ...head, format: FLOW_RECORD_FORMAT + 1 });
    writeFileSync(s.file, `${lines.join("\n")}\n`, { mode: 0o600 });
    const restarted = new FlowRecords({ dir: s.dir, keyPath: s.keyPath });
    expect(restarted.readRun(RUN)).toEqual({ kind: "lost", why: "forged", line: 1 });
    expect(asides(s.dir)).toHaveLength(1);
  });
});
