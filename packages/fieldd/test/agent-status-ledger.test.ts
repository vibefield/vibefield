import {
  appendFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_HISTORY,
  type AgentMonitorMirror,
  AgentRunHistory,
  type AgentSessionRecord,
} from "@vibefield/contracts";
import { afterAll, describe, expect, it } from "vitest";
import {
  AgentStatusLedgers,
  blockerOf,
  isLedgerRunId,
  LEDGER_READ_BYTES,
} from "../src/agent-status-ledger";

// TL (TL-D8) — the status ledger on its own: what a run's file says, what a
// reader makes of a file that says something else (EL7: the directory is
// writable by every same-uid agent), and what the horizon keeps.

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.parse("2026-10-02T12:00:00.000Z");
const iso = (ms: number): string => new Date(ms).toISOString();
const MIN = 60_000;

function harness(start = T0) {
  const root = mkdtempSync(join(tmpdir(), "vf-ledger-"));
  dirs.push(root);
  const dir = join(root, "agents", "history");
  const clock = { now: start };
  const make = () => new AgentStatusLedgers({ dir, now: () => new Date(clock.now) });
  return { root, dir, clock, ledgers: make(), make };
}

const lines = (path: string): Array<Record<string, unknown>> =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe("the status ledger (TL-D8)", () => {
  it("records changes oldest first, never repeats a status, and never lets `at` run backwards or ahead", () => {
    const { ledgers, clock, dir } = harness();
    const run = ledgers.open("run-a", { recordedFrom: T0, resume: false });
    expect(run).toBeDefined();
    clock.now = T0 + 10 * MIN;
    run!.change("idle", T0 + MIN);
    run!.change("idle", T0 + 2 * MIN); // a repeat is no change
    run!.change("working", T0 + 3 * MIN);
    // puppeteer's moment before the last change: held at the last change
    run!.change("idle", T0 + 2 * MIN);
    // a moment in the future: held at now
    run!.change("working", T0 + 60 * MIN);
    const history = AgentRunHistory.parse(ledgers.history("run-a"));
    expect(history.recordedFrom).toBe(iso(T0));
    expect(history.changes.map((c) => [c.status, c.at])).toEqual([
      ["unknown", iso(T0)],
      ["idle", iso(T0 + MIN)],
      ["working", iso(T0 + 3 * MIN)],
      ["idle", iso(T0 + 3 * MIN)],
      ["working", iso(T0 + 10 * MIN)],
    ]);
    // the file: 0600 in a 0700 directory, a `from` line, then one line per change
    const path = join(dir, "run-a.jsonl");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const written = lines(path);
    expect(written[0]).toEqual({ k: "from", at: iso(T0) });
    expect(written.filter((l) => l["k"] === "change")).toHaveLength(5);
  });

  it("keeps a working span's LAST activity line as its `did`, written when the span closes", () => {
    const { ledgers, clock, dir, make } = harness();
    const run = ledgers.open("run-did", { recordedFrom: T0, resume: false })!;
    clock.now = T0 + 2 * MIN;
    run.change("working", T0 + MIN);
    run.activity("Reading src/a.ts");
    run.activity("Editing src/a.ts");
    // the open span's line, the latest so far
    expect(ledgers.history("run-did")?.changes.at(-1)).toMatchObject({
      status: "working",
      did: "Editing src/a.ts",
    });
    // not yet on disk: a crash now loses that one line, nothing else
    expect(lines(join(dir, "run-did.jsonl")).some((l) => l["k"] === "did")).toBe(false);
    expect(make().history("run-did")?.changes.at(-1)).toEqual({
      status: "working",
      at: iso(T0 + MIN),
    });
    clock.now = T0 + 5 * MIN;
    run.change("idle", T0 + 4 * MIN);
    // an activity line outside a working span is nobody's `did`
    run.activity("ignored");
    run.change("working", T0 + 6 * MIN);
    run.activity("Running tests");
    run.flush();
    const reloaded = make().history("run-did");
    expect(reloaded?.changes.slice(1)).toEqual([
      { status: "working", at: iso(T0 + MIN), did: "Editing src/a.ts" },
      { status: "idle", at: iso(T0 + 4 * MIN) },
      { status: "working", at: iso(T0 + 5 * MIN), did: "Running tests" },
    ]);
  });

  it("a blocked change carries the first blocker's kind and words, bounded", () => {
    const mirror = (blockers: unknown[]) => ({ blockers }) as unknown as AgentMonitorMirror;
    const long = "x".repeat(AGENT_HISTORY.TEXT_CHARS * 3);
    expect(blockerOf(mirror([]))).toBeUndefined();
    expect(blockerOf(undefined)).toBeUndefined();
    expect(
      blockerOf(
        mirror([
          { id: "b1", kind: "permission", since: iso(T0), detail: "Bash: rm -rf build" },
          { id: "b2", kind: "question", since: iso(T0) },
        ]),
      ),
    ).toEqual({ kind: "permission", detail: "Bash: rm -rf build" });
    // a question without a detail: its first prompt, in its own words
    expect(
      blockerOf(
        mirror([
          { id: "b1", kind: "question", since: iso(T0), questions: [{ prompt: "Which branch?" }] },
        ]),
      ),
    ).toEqual({ kind: "question", detail: "Which branch?" });
    const bounded = blockerOf(mirror([{ id: "b", kind: "failure", since: iso(T0), detail: long }]));
    expect(Array.from(bounded?.detail ?? "")).toHaveLength(AGENT_HISTORY.TEXT_CHARS);
    expect(bounded?.detail?.endsWith("…")).toBe(true);

    const { ledgers, make, clock } = harness();
    const run = ledgers.open("run-b", { recordedFrom: T0, resume: false })!;
    clock.now = T0 + 10 * MIN;
    run.change("blocked", T0 + MIN, { kind: "question", detail: "Which branch?" });
    run.change("idle", T0 + 2 * MIN, { kind: "never", detail: "kept off a non-blocked change" });
    expect(make().history("run-b")?.changes.slice(1)).toEqual([
      {
        status: "blocked",
        at: iso(T0 + MIN),
        blocker: { kind: "question", detail: "Which branch?" },
      },
      { status: "idle", at: iso(T0 + 2 * MIN) },
    ]);
  });

  it("holds at most MAX_CHANGES, the oldest first to go, and compacts the file past twice that", () => {
    const { ledgers, clock, dir, make } = harness();
    const run = ledgers.open("run-many", { recordedFrom: T0, resume: false })!;
    const total = AGENT_HISTORY.MAX_CHANGES * 2 + 50;
    for (let i = 1; i <= total; i += 1) {
      clock.now = T0 + i * 1000;
      run.change(i % 2 === 0 ? "idle" : "working", clock.now);
    }
    const history = ledgers.history("run-many")!;
    expect(history.changes).toHaveLength(AGENT_HISTORY.MAX_CHANGES);
    expect(history.changes.at(-1)?.at).toBe(iso(T0 + total * 1000));
    // what was dropped is no longer recorded: the record begins at the oldest kept
    expect(history.recordedFrom).toBe(history.changes[0]?.at);
    // the file was rewritten, not left to grow
    const onDisk = lines(join(dir, "run-many.jsonl"));
    expect(onDisk.length).toBeLessThanOrEqual(AGENT_HISTORY.MAX_CHANGES * 2 + 1);
    expect(onDisk[0]?.["k"]).toBe("from");
    expect(make().history("run-many")).toEqual(history);
    // no temp file left behind
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("trims to the horizon, keeping the change that straddles the cut — moved up to it", () => {
    const { ledgers, clock } = harness();
    const run = ledgers.open("run-old", { recordedFrom: T0, resume: false })!;
    clock.now = T0 + 10 * MIN;
    run.change("working", T0 + MIN);
    run.activity("Long build");
    run.change("idle", T0 + 2 * MIN);
    run.change("working", T0 + 3 * MIN);
    clock.now = T0 + AGENT_HISTORY.HORIZON_MS + 2.5 * MIN;
    const cut = clock.now - AGENT_HISTORY.HORIZON_MS;
    const history = AgentRunHistory.parse(ledgers.history("run-old"));
    expect(history.recordedFrom).toBe(iso(cut));
    expect(history.changes).toEqual([
      { status: "idle", at: iso(cut) },
      { status: "working", at: iso(T0 + 3 * MIN) },
    ]);
    // every change sits at or after the record's start
    for (const change of history.changes) {
      expect(Date.parse(change.at)).toBeGreaterThanOrEqual(Date.parse(history.recordedFrom));
    }
  });

  it("a tolerant reader: garbage, a huge line, unknown kinds, out-of-order times and oversized words are skipped", () => {
    const { ledgers, dir } = harness();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "run-messy.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({ k: "from", at: iso(T0) }),
        "not json at all",
        JSON.stringify({ k: "change", status: "idle", at: iso(T0 + MIN) }),
        JSON.stringify({ k: "change", status: "working", at: iso(T0 + 3 * MIN) }),
        JSON.stringify({ k: "did", did: "y".repeat(10_000) }), // a huge line
        JSON.stringify({ k: "did", did: "z".repeat(500) }),
        // out of order: before the last change
        JSON.stringify({ k: "change", status: "blocked", at: iso(T0 + 2 * MIN) }),
        JSON.stringify({ k: "change", status: "s".repeat(200), at: iso(T0 + 4 * MIN) }),
        JSON.stringify({ k: "change", status: "idle", at: "yesterday" }),
        JSON.stringify({ k: "mystery", at: iso(T0 + 5 * MIN) }),
        JSON.stringify([1, 2, 3]),
        JSON.stringify({
          k: "change",
          status: "blocked",
          at: iso(T0 + 6 * MIN),
          blocker: { kind: "question", detail: "q".repeat(500), extra: "kept off" },
        }),
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    const history = AgentRunHistory.parse(ledgers.history("run-messy"));
    expect(history.recordedFrom).toBe(iso(T0));
    expect(history.changes.map((c) => c.status)).toEqual(["idle", "working", "blocked"]);
    expect(Array.from(history.changes[1]?.did ?? "")).toHaveLength(AGENT_HISTORY.TEXT_CHARS);
    expect(history.changes[2]?.blocker?.kind).toBe("question");
    expect(Array.from(history.changes[2]?.blocker?.detail ?? "")).toHaveLength(
      AGENT_HISTORY.TEXT_CHARS,
    );
    expect(history.changes[2]?.blocker).not.toHaveProperty("extra");
  });

  it("reads at most the last MiB of a file planted to be enormous", () => {
    const { ledgers, dir } = harness();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "run-huge.jsonl");
    writeFileSync(path, `${JSON.stringify({ k: "from", at: iso(T0) })}\n`, { mode: 0o600 });
    appendFileSync(path, `${"g".repeat(LEDGER_READ_BYTES * 2)}\n`);
    appendFileSync(
      path,
      `${JSON.stringify({ k: "change", status: "working", at: iso(T0 + MIN) })}\n`,
    );
    const history = ledgers.history("run-huge");
    // the `from` line was beyond the read: the record begins at what was read
    expect(history?.recordedFrom).toBe(iso(T0 + MIN));
    expect(history?.changes).toEqual([{ status: "working", at: iso(T0 + MIN) }]);
  });

  it("never follows a symlink planted at the path, nor appends through a hard link", () => {
    const { ledgers, root, dir, clock } = harness();
    mkdirSync(dir, { recursive: true });
    // a symlink to a file the person cares about
    const precious = join(root, "precious.txt");
    writeFileSync(precious, `${JSON.stringify({ k: "change", status: "idle", at: iso(T0) })}\n`);
    symlinkSync(precious, join(dir, "run-link.jsonl"));
    expect(ledgers.history("run-link")).toBeUndefined();
    const run = ledgers.open("run-link", { recordedFrom: T0, resume: true })!;
    clock.now = T0 + MIN;
    run.change("working", T0 + MIN);
    // the link was REPLACED by our own file; its target is untouched
    expect(readFileSync(precious, "utf8")).toBe(
      `${JSON.stringify({ k: "change", status: "idle", at: iso(T0) })}\n`,
    );
    expect(statSync(join(dir, "run-link.jsonl")).isFile()).toBe(true);
    expect(lines(join(dir, "run-link.jsonl")).at(-1)).toMatchObject({ status: "working" });

    // a hard link: readable (it is a regular file), never appended to
    const other = join(root, "other.txt");
    writeFileSync(other, `${JSON.stringify({ k: "change", status: "idle", at: iso(T0) })}\n`, {
      mode: 0o600,
    });
    linkSync(other, join(dir, "run-hard.jsonl"));
    const hard = ledgers.open("run-hard", { recordedFrom: T0, resume: true })!;
    expect(hard.lastStatus).toBe("idle");
    hard.change("working", T0 + MIN);
    expect(readFileSync(other, "utf8")).toBe(
      `${JSON.stringify({ k: "change", status: "idle", at: iso(T0) })}\n`,
    );
    expect(statSync(join(dir, "run-hard.jsonl")).nlink).toBe(1);
  });

  it("refuses a run id that is not a plain file name", () => {
    const { ledgers, root } = harness();
    for (const bad of ["../escape", "a/b", "..", ".hidden", "", "a\\b", "x".repeat(200), "a..b"]) {
      expect(isLedgerRunId(bad)).toBe(false);
      expect(ledgers.open(bad, { recordedFrom: T0, resume: false })).toBeUndefined();
      expect(ledgers.history(bad)).toBeUndefined();
    }
    expect(existsSync(join(root, "agents", "escape.jsonl"))).toBe(false);
    expect(isLedgerRunId("3f2a9c1e-5b7d-4e2a-9c1e-5b7d4e2a9c1e")).toBe(true);
  });

  it("a ledger directory that is a link is not written through", () => {
    const { root, clock } = harness();
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    mkdirSync(join(root, "agents"));
    symlinkSync(elsewhere, join(root, "agents", "history"));
    const ledgers = new AgentStatusLedgers({
      dir: join(root, "agents", "history"),
      now: () => new Date(clock.now),
    });
    const run = ledgers.open("run-x", { recordedFrom: T0, resume: false })!;
    run.change("idle", T0);
    // in memory still, and nothing landed in the link's target
    expect(ledgers.history("run-x")?.changes.at(-1)?.status).toBe("idle");
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("survives a restart: a resumed ledger carries on from the file", () => {
    const { ledgers, make, clock } = harness();
    const run = ledgers.open("run-r", { recordedFrom: T0, resume: false })!;
    clock.now = T0 + MIN;
    run.change("working", T0 + MIN);
    run.activity("Thinking");
    // the graceful stop
    clock.now = T0 + 2 * MIN;
    run.flush();
    run.change("unknown", clock.now);
    // the next boot
    clock.now = T0 + 5 * MIN;
    const next = make();
    const resumed = next.open("run-r", { recordedFrom: clock.now, resume: true })!;
    resumed.change("working", T0 + 4 * MIN);
    expect(next.history("run-r")?.changes).toEqual([
      { status: "unknown", at: iso(T0) },
      { status: "working", at: iso(T0 + MIN), did: "Thinking" },
      { status: "unknown", at: iso(T0 + 2 * MIN) },
      { status: "working", at: iso(T0 + 4 * MIN) },
    ]);
    // a resume with no file begins fresh, at the moment the fold first saw it
    const fresh = next.open("run-new", { recordedFrom: clock.now, resume: true })!;
    expect(fresh.lastStatus).toBe("unknown");
    expect(next.history("run-new")?.recordedFrom).toBe(iso(clock.now));
  });

  it("retention: a ledger with no record, or whose run exited past the horizon, goes; live runs and recent exits stay", () => {
    const { ledgers, clock, dir } = harness();
    for (const id of ["live", "recent", "old", "orphan", "unrecorded-live"]) {
      ledgers.open(id, { recordedFrom: T0, resume: false });
    }
    writeFileSync(join(dir, "stale.jsonl.0000.tmp"), "half");
    writeFileSync(join(dir, "README"), "not ours, left alone");
    clock.now = T0 + AGENT_HISTORY.HORIZON_MS + 10 * MIN;
    const record = (id: string, exitedAt?: number): AgentSessionRecord => ({
      format: 1,
      runtimeRunId: id,
      runtimeEpoch: 1,
      provider: "scripted",
      cwd: "/repo",
      continuation: { providerId: "scripted", nativeSessionId: `n-${id}` },
      createdAt: iso(T0),
      updatedAt: iso(T0),
      ...(exitedAt !== undefined
        ? { exited: { at: iso(exitedAt), exitCode: 0, signal: null, reason: "exit" } }
        : {}),
    });
    ledgers.sweep(
      [record("live"), record("recent", clock.now - MIN), record("old", T0 + MIN)],
      new Set(["unrecorded-live"]),
    );
    expect(readdirSync(dir).sort()).toEqual([
      "README",
      "live.jsonl",
      "recent.jsonl",
      "unrecorded-live.jsonl",
    ]);
    expect(ledgers.history("old")).toBeUndefined();
    expect(ledgers.history("orphan")).toBeUndefined();
    ledgers.remove("live");
    expect(existsSync(join(dir, "live.jsonl"))).toBe(false);
    expect(ledgers.sweepDue()).toBe(false);
    clock.now += 61 * MIN;
    expect(ledgers.sweepDue()).toBe(true);
  });
});
