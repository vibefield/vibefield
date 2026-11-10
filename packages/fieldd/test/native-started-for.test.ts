// OB custody (rule 6; CUSTODY-SPEC §8.1.0, "fieldd", the `NativeLink` bullet) — WHAT EACH TERMINAL WAS STARTED FOR,
// as the link reads it and says it.
//
// A sealed fieldd may not learn what a run is from a file an agent can rewrite. So it tells the FLOOR at each launch
// and adoption (`native.terminal.startedFor.set`), the floor keeps that in memory, and the next fieldd is handed the
// table in its hello ack (`HelloAck.startedFor`). The link's half is here:
//   · the ack's table is read BY HAND, field by field, as every field of that ack is. An entry that fails its shape
//     is skipped ALONE; the rest of the table stands; nothing throws (the PM's condition 2);
//   · this side holds two bounds by its own check, because neither side trusts the other's generator: a typed run's
//     `process.pid` is 2 or more, and a `spark` is a `SparkId`;
//   · the link holds the table of the LATEST hello until it is taken. `takeStartedFor()` hands it over ONCE, and
//     after that every later ack's table is dropped unread: one life believes one table;
//   · `setStartedFor` answers one word of five and never throws, inside two seconds;
//   · nothing of an entry's values reaches a log line at any level.
//
// GIVEN AN INJECTED FLOOR (the PM's rows rule, v0.19): the floor here is the mock, which keeps a table as field-native
// is specified to and hands the ack whatever a row plants. These rows show the LINK's rule given that floor. That a
// sealed daemon binds this link as its runtime's table, and that a `files` daemon binds none, is proved through the
// real daemon by the runtime's rows (agent-started-for.test.ts) once that slice lands; until then: NONE.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CUSTODY, LAYOUT, SOCKETS } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { NativeLink, type StartedFor } from "../src/native-link";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { type Cleanup, runCleanup } from "./custody-harness";
import { nativeEndpoint, removeTempRoot, shortTmpRoot } from "./native-harness";

const cleanup: Cleanup = [];
afterEach(() => runCleanup(cleanup));

const SECRET = "d7".repeat(32);
const SPARK = "sp-0a1b2c3d";
const PLAIN: StartedFor = { run: "run-plain", root: "root-plain" };
const OF_A_SPARK: StartedFor = { run: "run-spark", spark: SPARK, root: "root-spark" };
const TYPED: StartedFor = {
  run: "run-typed",
  process: { pid: 4_242, startedAtMs: 1_762_000_000_000 },
};

/** A floor booted by the hand-off, and a link paired with it by a source (a sealed fieldd's link). */
async function floor(): Promise<MockMgmtServer> {
  const dataDir = shortTmpRoot("vf-sf-");
  cleanup.push(() => removeTempRoot(dataDir));
  mkdirSync(join(dataDir, ...LAYOUT.NATIVE_RUN_DIR), { recursive: true });
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  mock.pairingSecretHex = SECRET;
  await mock.start();
  cleanup.push(() => mock.stop());
  return mock;
}

async function paired(mock: MockMgmtServer, logger?: Logger): Promise<NativeLink> {
  const link = new NativeLink({
    socketPath: mock.endpoint,
    pairingSecret: () => SECRET,
    bootId: "fieldd-started-for",
    ...(logger !== undefined ? { logger } : {}),
  });
  cleanup.push(() => link.close());
  await link.connect();
  return link;
}

async function until(holds: () => boolean, what: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!holds()) {
    if (Date.now() >= deadline) throw new Error(`${what} did not happen within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const SET = "native.terminal.startedFor.set";
const hellos = (mock: MockMgmtServer): number =>
  mock.requestLog.filter((asked) => asked.method === "native.lifecycle.hello").length;

/** The floor's every client is dropped and the link pairs again: a second hello, a second ack. */
async function repaired(mock: MockMgmtServer, link: NativeLink): Promise<void> {
  const before = hellos(mock);
  mock.killClients();
  await until(() => hellos(mock) > before && link.connected, "the link's second hello");
}

const table = (link: NativeLink): Record<string, StartedFor> =>
  Object.fromEntries(link.takeStartedFor());

describe("the ack's started-for table, as the link reads it", () => {
  it("each terminal's entry is read: a plain run, a spark's run, a typed run", async () => {
    const mock = await floor();
    mock.startedFor.set("term-1", PLAIN).set("term-2", OF_A_SPARK).set("term-3", TYPED);
    const link = await paired(mock);
    expect(table(link)).toEqual({ "term-1": PLAIN, "term-2": OF_A_SPARK, "term-3": TYPED });
  });

  it("an entry that fails its shape is skipped alone: the rest of the table stands and nothing throws", async () => {
    const mock = await floor();
    const long = "x".repeat(129);
    const said: unknown[] = [
      { sessionId: "term-good-1", ...PLAIN },
      // not an entry at all
      "term-2",
      null,
      42,
      ["term-3"],
      // no terminal, or one off the bound
      { run: "run-a" },
      { sessionId: "", run: "run-a" },
      { sessionId: long, run: "run-a" },
      { sessionId: 7, run: "run-a" },
      // no run, or one off the bound
      { sessionId: "term-4" },
      { sessionId: "term-5", run: "" },
      { sessionId: "term-6", run: long },
      { sessionId: "term-7", run: null },
      // a root off the bound
      { sessionId: "term-8", run: "run-a", root: "" },
      { sessionId: "term-9", run: "run-a", root: long },
      { sessionId: "term-10", run: "run-a", root: 5 },
      // a process that is not one
      { sessionId: "term-11", run: "run-a", process: "4242" },
      { sessionId: "term-12", run: "run-a", process: { pid: 4_242 } },
      { sessionId: "term-13", run: "run-a", process: { pid: 4_242, startedAtMs: -1 } },
      { sessionId: "term-14", run: "run-a", process: { pid: 4_242.5, startedAtMs: 1 } },
      { sessionId: "term-15", run: "run-a", process: { pid: "4242", startedAtMs: 1 } },
      // a second word for a terminal the table already holds: the first stands
      { sessionId: "term-good-1", run: "run-another" },
      // fields this build does not know ride along unread
      { sessionId: "term-good-2", ...TYPED, later: { field: true } },
      { sessionId: "term-good-3", ...OF_A_SPARK },
    ];
    mock.helloStartedFor = { said };
    const link = await paired(mock);
    expect(table(link)).toEqual({
      "term-good-1": PLAIN,
      "term-good-2": TYPED,
      "term-good-3": OF_A_SPARK,
    });
  });

  // K5, point 2 (the PM, 02:02:04Z): typify gives the Rust type no minimum of 2, so the floor refuses a set below it
  // by hand, and this reader holds the SAME bound by its own check. Neither side trusts the other's generator.
  it("a typed run's pid below 2 is skipped by this side's own check: 0 and 1 are, 2 is taken", async () => {
    const mock = await floor();
    const at = (pid: number): unknown => ({
      sessionId: `term-pid-${pid}`,
      run: `run-pid-${pid}`,
      process: { pid, startedAtMs: 1_762_000_000_000 },
    });
    mock.helloStartedFor = { said: [at(0), at(1), at(2), at(-3)] };
    const link = await paired(mock);
    expect(table(link)).toEqual({
      "term-pid-2": { run: "run-pid-2", process: { pid: 2, startedAtMs: 1_762_000_000_000 } },
    });
  });

  // K5: `spark` on the wire is the opaque 1..128 string (the floor outlives fieldd and must not pin today's pattern);
  // fieldd holds it to `SparkId` where it reads it.
  it("a spark is held to SparkId here: an entry whose spark is not one is skipped alone", async () => {
    const mock = await floor();
    const said: unknown[] = [
      { sessionId: "term-1", run: "run-1", spark: "not-a-spark" },
      { sessionId: "term-2", run: "run-2", spark: "sp-UPPER00" },
      { sessionId: "term-3", run: "run-3", spark: null },
      { sessionId: "term-4", run: "run-4", spark: "" },
      { sessionId: "term-5", run: "run-5", spark: SPARK },
    ];
    mock.helloStartedFor = { said };
    const link = await paired(mock);
    expect(table(link)).toEqual({ "term-5": { run: "run-5", spark: SPARK } });
  });

  it("a table that is no table vouches nothing, and so does none", async () => {
    for (const said of [null, {}, "term-1", 7, { "term-1": PLAIN }]) {
      const mock = await floor();
      mock.helloStartedFor = { said };
      const link = await paired(mock);
      expect(link.connected, JSON.stringify(said)).toBe(true);
      expect(table(link), JSON.stringify(said)).toEqual({});
    }
    // and a floor that holds none sends no key at all
    const empty = await floor();
    expect(table(await paired(empty))).toEqual({});
  });

  it("no more than STARTED_FOR_MAX entries are read", async () => {
    const mock = await floor();
    const many: unknown[] = [];
    for (let i = 0; i < CUSTODY.STARTED_FOR_MAX + 5; i += 1) {
      many.push({ sessionId: `term-${i}`, run: `run-${i}` });
    }
    mock.helloStartedFor = { said: many };
    const link = await paired(mock);
    const read = link.takeStartedFor();
    expect(read.size).toBe(CUSTODY.STARTED_FOR_MAX);
    expect(read.has("term-0")).toBe(true);
    expect(read.has(`term-${CUSTODY.STARTED_FOR_MAX}`)).toBe(false);
  });
});

describe("the table of the latest hello, taken once", () => {
  // The PM's row (1), the link's half: the first connection drops before its inventory, and the second connection's
  // ack is the one whose table is handed over (with the inventory that connection delivers: the runtime's rows).
  it("until it is taken the link holds the LATEST hello's table", async () => {
    const mock = await floor();
    mock.startedFor.set("term-1", PLAIN);
    const link = await paired(mock);
    // nobody took it; the floor's table moved; the connection dropped and paired again
    mock.startedFor.delete("term-1");
    mock.startedFor.set("term-2", OF_A_SPARK);
    await repaired(mock, link);
    expect(table(link)).toEqual({ "term-2": OF_A_SPARK });
  });

  // The PM's row (1), second half: a reconnect later in the same life changes nothing this life believes.
  it("taken, it is handed over once: every later ack's table is dropped unread", async () => {
    const mock = await floor();
    mock.startedFor.set("term-1", PLAIN);
    const link = await paired(mock);
    expect(table(link)).toEqual({ "term-1": PLAIN });
    // a second take in the same life has nothing
    expect(table(link)).toEqual({});
    // and a later hello's table is not kept for anybody
    mock.startedFor.set("term-2", OF_A_SPARK);
    await repaired(mock, link);
    expect(table(link)).toEqual({});
    await repaired(mock, link);
    expect(table(link)).toEqual({});
  });
});

describe("telling the floor what a terminal was started for", () => {
  it("a set is one request with the entry as given, and answers `set`", async () => {
    const mock = await floor();
    const link = await paired(mock);
    await expect(link.setStartedFor("term-1", OF_A_SPARK)).resolves.toBe("set");
    await expect(link.setStartedFor("term-2", TYPED)).resolves.toBe("set");
    // the params as the floor received them: the terminal, and the entry, and nothing else
    expect(mock.startedForAsks).toEqual([
      { sessionId: "term-1", startedFor: OF_A_SPARK },
      { sessionId: "term-2", startedFor: TYPED },
    ]);
    expect(Object.fromEntries(mock.startedFor)).toEqual({ "term-1": OF_A_SPARK, "term-2": TYPED });
  });

  it("a clear is a set with NO `startedFor`, never a null, and answers `set` too", async () => {
    const mock = await floor();
    mock.startedFor.set("term-1", PLAIN);
    const link = await paired(mock);
    await expect(link.setStartedFor("term-1", undefined)).resolves.toBe("set");
    // as received off the wire: a `null` there would be a key, and this has none
    expect(mock.startedForAsks).toEqual([{ sessionId: "term-1" }]);
    expect(Object.keys(mock.startedForAsks[0] ?? {})).toEqual(["sessionId"]);
    expect(mock.startedFor.has("term-1")).toBe(false);
    // clearing nothing is no error
    await expect(link.setStartedFor("term-nobody", undefined)).resolves.toBe("set");
  });

  it("the floor's refusals are each a word: not-found, full, not-sealed", async () => {
    const mock = await floor();
    const link = await paired(mock);
    // the floor lists no such running terminal (the run ended first)
    mock.startedForSessions = new Set(["term-1"]);
    await expect(link.setStartedFor("term-gone", PLAIN)).resolves.toBe("not-found");
    // a NEW terminal while the floor holds its most
    mock.startedForFull = true;
    await expect(link.setStartedFor("term-1", PLAIN)).resolves.toBe("full");
    mock.startedForFull = false;
    // a floor that was not booted by the hand-off keeps no table
    mock.startedForSealed = false;
    await expect(link.setStartedFor("term-1", PLAIN)).resolves.toBe("not-sealed");
    expect(mock.startedFor.size).toBe(0);
  });

  it("a floor that does not answer is `unanswered` inside two seconds, and so is a link that is down", async () => {
    const mock = await floor();
    const link = await paired(mock);
    // read and never answered: the socket stays open, only the reply is missing
    mock.silentMethods.add(SET);
    const asked = Date.now();
    await expect(link.setStartedFor("term-1", PLAIN)).resolves.toBe("unanswered");
    const waited = Date.now() - asked;
    expect(waited).toBeGreaterThanOrEqual(1_500);
    expect(waited).toBeLessThan(4_000);
    // a link that is closed: an answer, never a throw
    link.close();
    await expect(link.setStartedFor("term-1", PLAIN)).resolves.toBe("unanswered");
  });

  it("any other refusal of the floor's is `unanswered` too: this side invents no sixth word", async () => {
    const mock = await floor();
    const link = await paired(mock);
    mock.startedForRefusal = { kind: "INTERNAL", message: "the floor could not say" };
    await expect(link.setStartedFor("term-1", PLAIN)).resolves.toBe("unanswered");
    // a precondition this side has no word for is not read as one it has
    mock.startedForRefusal = {
      kind: "PRECONDITION_FAILED",
      message: "something later",
      details: { reason: "a-later-reason" },
    };
    await expect(link.setStartedFor("term-1", PLAIN)).resolves.toBe("unanswered");
  });
});

describe("an entry's values and the log", () => {
  /** One line the link logged, with an error kept as the real serializer keeps one. */
  interface Line {
    level: string;
    event: string;
    kept: string;
  }

  function everyLine(lines: Line[]): Logger {
    // an error as the real serializer keeps one: `JSON.stringify` alone drops its message
    const errorKept = (_key: string, inner: unknown): unknown => {
      if (!(inner instanceof Error)) return inner;
      return { ...inner, name: inner.name, message: inner.message, stack: inner.stack };
    };
    const keep = (level: string, event: string, message: string, attrs: unknown): void => {
      lines.push({ level, event, kept: `${message} ${JSON.stringify(attrs, errorKept)}` });
    };
    const logger: Logger = {
      child: () => logger,
      trace: (event, message, attrs) => keep("trace", event, message, attrs),
      debug: (event, message, attrs) => keep("debug", event, message, attrs),
      info: (event, message, attrs) => keep("info", event, message, attrs),
      warn: (event, message, attrs) => keep("warn", event, message, attrs),
      error: (event, message, error, attrs) => keep("error", event, message, { error, attrs }),
      fatal: (event, message, error, attrs) => keep("fatal", event, message, { error, attrs }),
      isLevelEnabled: () => true,
    };
    return logger;
  }

  // The PM's condition 4, the link's half: a table's values are counts in a log, never values. The canary is a
  // string in each field of an entry, and (the PM, 02:05:49Z) a PATH under a home.
  it("no log line at any level holds a value of an entry, read or sent, taken or skipped or refused", async () => {
    const home = join(tmpdir(), "canary-home", "Library", "VibeField");
    const canary: StartedFor = {
      run: "canary-run-7f3a",
      spark: "sp-canary7f3a",
      process: { pid: 3_999_077, startedAtMs: 1_762_000_077_077 },
      root: home,
    };
    const mock = await floor();
    const said: unknown[] = [
      { sessionId: "canary-term-7f3a", ...canary },
      // one that fails its shape, with the same values: what is skipped is not printed either
      { sessionId: "canary-term-skip", ...canary, spark: "canary-not-a-spark" },
    ];
    mock.helloStartedFor = { said };
    const lines: Line[] = [];
    const link = await paired(mock, everyLine(lines));
    expect(table(link)).toEqual({ "canary-term-7f3a": canary });

    await link.setStartedFor("canary-term-7f3a", canary);
    mock.startedForSessions = new Set();
    await link.setStartedFor("canary-term-7f3a", canary);
    mock.startedForSessions = null;
    mock.startedForSealed = false;
    await link.setStartedFor("canary-term-7f3a", canary);
    link.close();
    await link.setStartedFor("canary-term-7f3a", canary);

    const all = lines.map((line) => line.kept).join("\n");
    for (const value of ["canary", "3999077", "1762000077077", home]) {
      expect(all, value).not.toContain(value);
    }
  });
});
