import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ComposeSparksCrewsFrame,
  type CrewId,
  SPARK_CREW_MEMBERS_MAX,
  SPARK_CREWS_KEPT,
  type SparkCrew,
  SparkKeptRecord,
} from "@vibefield/contracts";
import type { LogFields, Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import { type CrewRow, type CrewsStore, SparkCrews } from "../src/tool-plane/crews";
import { SparkKeptStore } from "../src/tool-plane/spark-kept";

// SP-1e2 (step0-sp1e2.md §4.1–§4.3) — a spark's crews: one per stretch of its own run's work (SPE-Q3 = RU-6), closed
// at the run's first idle seen while none of its talk calls is in flight (SPE-Q29 (a)), kept in the spark's kept
// record (item 159's store, SPE-Q6′ (b)) with every member after it ends (SPE-Q14 (a)), the newest SPARK_CREWS_KEPT
// (SPE-Q28 (b)), a resumed member followed to its new run (SPE-Q30 (a)), and the crews' door's frame with how many
// tasks wait for each member on the board (SPE-Q32 (a)). The store is the real one, on a temporary root.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const VELA = "sp-vela00000000";
const KIWI = "sp-kiwi00000000";

function capture(events: { event: string; attrs: LogFields | undefined }[]): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (event, _m, attrs) => void events.push({ event, attrs }),
    error: (event, _m, _e, attrs) => void events.push({ event, attrs }),
    fatal: () => undefined,
    isLevelEnabled: () => true,
  };
  return logger;
}

function harness(storeOver?: (store: SparkKeptStore) => CrewsStore) {
  const root = mkdtempSync(join(tmpdir(), "vf-spark-crews-"));
  dirs.push(root);
  const kept = new SparkKeptStore({
    dir: join(root, "spark-files"),
    keyPath: join(root, "spark-files.key"),
  });
  const store = storeOver?.(kept) ?? kept;
  const events: { event: string; attrs: LogFields | undefined }[] = [];
  let clock = Date.parse("2026-11-05T02:10:00.000Z");
  let minted = 0;
  const now = () => {
    clock += 1000;
    return new Date(clock);
  };
  /** a service on this root, as a fieldd (a restart opens another) */
  const open = () =>
    new SparkCrews({
      store,
      logger: capture(events),
      now,
      mintId: () => `cr-${String(++minted).padStart(6, "0")}` as CrewId,
    });
  const crews = open();
  const changes: string[] = [];
  crews.onChange((spark) => void changes.push(spark));
  /** the crews the disk keeps for a spark now, read by a fresh store */
  const disk = (spark: string): SparkCrew[] =>
    new SparkKeptStore({
      dir: join(root, "spark-files"),
      keyPath: join(root, "spark-files.key"),
    }).get(spark)?.crews ?? [];
  return { root, kept, crews, open, events, changes, disk };
}

const claude = (runtimeRunId: string) => ({ runtimeRunId, agent: "claude", folder: "vibe-field" });
/** the crew a spawn joins, asked in the spark's own run */
const of = (id: CrewId, sparkRun = "run-vela") => ({ id, sparkRun });
const row = (over: Partial<CrewRow> & Pick<CrewRow, "runtimeRunId" | "crew">): CrewRow => ({
  spark: VELA,
  agent: "claude",
  folder: "vibe-field",
  ...over,
});

describe("one crew per stretch of the spark's own work (SPE-Q3 = RU-6, SPE-Q29 (a))", () => {
  it("C1 · two spawns in one stretch share one crew; the run's idle with no call in flight closes it; the next stretch is a second crew", () => {
    const { crews } = harness();
    const first = crews.join(VELA, "run-vela");
    expect(crews.join(VELA, "run-vela")).toBe(first);
    crews.sparkRow(VELA, "run-vela", false);
    expect(crews.join(VELA, "run-vela")).toBe(first);
    crews.sparkRow(VELA, "run-vela", true);
    const second = crews.join(VELA, "run-vela");
    expect(second).not.toBe(first);
  });

  it("C2 · an idle seen while one of the spark's talk calls is in flight never closes its crew; the next idle after it does", () => {
    const { crews } = harness();
    const crew = crews.join(VELA, "run-vela");
    const done = crews.busy(VELA);
    const also = crews.busy(VELA);
    crews.sparkRow(VELA, "run-vela", true);
    done();
    done(); // answered once, however often it is called
    crews.sparkRow(VELA, "run-vela", true);
    expect(crews.join(VELA, "run-vela")).toBe(crew);
    also();
    crews.sparkRow(VELA, "run-vela", true);
    expect(crews.join(VELA, "run-vela")).not.toBe(crew);
  });

  it("C3 · a crew is only its own spark's, and a new run of the spark (a wake) starts a new crew; the run's end closes it", () => {
    const { crews } = harness();
    const vela = crews.join(VELA, "run-vela");
    expect(crews.join(KIWI, "run-kiwi")).not.toBe(vela);
    // another run's idle is not the spark's own run's
    crews.sparkRow(VELA, "run-kiwi", true);
    expect(crews.join(VELA, "run-vela")).toBe(vela);
    // a wake: the spark thinks in a new run
    const woke = crews.join(VELA, "run-vela-2");
    expect(woke).not.toBe(vela);
    crews.ended("run-vela-2");
    expect(crews.join(VELA, "run-vela-2")).not.toBe(woke);
  });

  it("C4 · the restart split, pinned: the open crew is in memory, so a fieldd restarted mid-turn mints a second crew for the same turn", () => {
    const h = harness();
    const before = h.crews.join(VELA, "run-vela");
    h.crews.started(VELA, of(before), claude("run-21"));
    const after = h.open().join(VELA, "run-vela");
    expect(after).not.toBe(before);
  });
});

describe("the kept record keeps each crew (SPE-Q6′ (b), SPE-Q14 (a))", () => {
  it("K1 · a start keeps its crew at the first start, made in the spark's run, and every member by start; another section survives", () => {
    const h = harness();
    h.kept.update(VELA, (record) => ({ ...record, watches: ["run-ada"] }));
    const crew = h.crews.join(VELA, "run-vela");
    for (const run of ["run-21", "run-22", "run-23", "run-24"])
      h.crews.started(VELA, of(crew), claude(run));
    h.crews.started(VELA, of(crew), claude("run-22")); // a start told twice keeps one member
    const [kept] = h.disk(VELA);
    expect(kept).toMatchObject({ id: crew, sparkRun: "run-vela", at: "2026-11-05T02:10:01.000Z" });
    expect(kept?.members.map((m) => [m.runtimeRunId, m.agent, m.folder])).toEqual([
      ["run-21", "claude", "vibe-field"],
      ["run-22", "claude", "vibe-field"],
      ["run-23", "claude", "vibe-field"],
      ["run-24", "claude", "vibe-field"],
    ]);
    expect(h.kept.get(VELA)).toMatchObject({ watches: ["run-ada"] });
    expect(SparkKeptRecord.parse(h.kept.get(VELA)).crews).toHaveLength(1);
    expect(h.changes.filter((s) => s === VELA).length).toBeGreaterThan(0);
  });

  it("K2 · a member's model and effort are the first its row names, never overwritten; no write when nothing changed", () => {
    const h = harness();
    const crew = h.crews.join(VELA, "run-vela");
    h.crews.started(VELA, of(crew), claude("run-21"));
    h.crews.seen(row({ runtimeRunId: "run-21", crew }));
    expect(h.disk(VELA)[0]?.members.map((m) => [m.runtimeRunId, m.model])).toEqual([
      ["run-21", undefined],
    ]);
    h.crews.seen(row({ runtimeRunId: "run-21", crew, model: "Opus 5.5", effort: "high" }));
    h.crews.seen(row({ runtimeRunId: "run-21", crew, model: "Sonnet 5.5", effort: "low" }));
    expect(h.disk(VELA)[0]?.members[0]).toMatchObject({ model: "Opus 5.5", effort: "high" });
  });

  it("K3 · an end keeps the member, Ended at its time and named as fieldd names the run; a restart reads the count", () => {
    const h = harness();
    const crew = h.crews.join(VELA, "run-vela");
    h.crews.started(VELA, of(crew), claude("run-21"));
    h.crews.started(VELA, of(crew), claude("run-22"));
    h.crews.ended("run-21", "Claude Code in vibe-field");
    h.crews.ended("run-21", "a second end is no end");
    const members = h.disk(VELA)[0]?.members ?? [];
    expect(members[0]).toMatchObject({
      runtimeRunId: "run-21",
      endedAt: expect.any(String),
      name: "Claude Code in vibe-field",
    });
    expect(members[1]).not.toHaveProperty("endedAt");
    // a run no crew holds ends nothing
    h.crews.ended("run-unknown", "nobody");
    // after a restart the frame still says 1 of 2 ended
    const frame = ComposeSparksCrewsFrame.parse(h.open().frame(VELA, () => undefined));
    expect(frame.crews[0]?.members.filter((m) => m.endedAt !== undefined)).toHaveLength(1);
  });

  it("K4 · once the re-attach settles, a member whose run fieldd no longer holds is Ended; one it holds runs on", () => {
    const h = harness();
    const crew = h.crews.join(VELA, "run-vela");
    h.crews.started(VELA, of(crew), claude("run-21"));
    h.crews.started(VELA, of(crew), claude("run-22"));
    const restarted = h.open();
    restarted.reconcile((run) => run === "run-22");
    const members = h.disk(VELA)[0]?.members ?? [];
    expect(members.map((m) => [m.runtimeRunId, m.endedAt !== undefined])).toEqual([
      ["run-21", true],
      ["run-22", false],
    ]);
    // and the restarted service knows its members: run-22's end is kept
    restarted.ended("run-22", "Claude Code in vibe-field");
    expect(h.disk(VELA)[0]?.members[1]).toMatchObject({ name: "Claude Code in vibe-field" });
  });

  it("K5 · the record keeps the newest SPARK_CREWS_KEPT crews: an older crew leaves", () => {
    const h = harness();
    const ids: string[] = [];
    for (let i = 0; i <= SPARK_CREWS_KEPT; i++) {
      const crew = h.crews.join(VELA, "run-vela");
      ids.push(crew);
      h.crews.started(VELA, of(crew), claude(`run-${i}`));
      h.crews.sparkRow(VELA, "run-vela", true);
    }
    const kept = h.disk(VELA);
    expect(kept).toHaveLength(SPARK_CREWS_KEPT);
    expect(kept[0]?.id).toBe(ids[1]);
    expect(kept.at(-1)?.id).toBe(ids.at(-1));
  });

  it("K6 · a crew keeps at most SPARK_CREW_MEMBERS_MAX members, and says when a later one is on the board alone", () => {
    const h = harness();
    const crew = h.crews.join(VELA, "run-vela");
    for (let i = 0; i <= SPARK_CREW_MEMBERS_MAX; i++)
      h.crews.started(VELA, of(crew), claude(`run-${i}`));
    expect(h.disk(VELA)[0], "the crew is kept").toBeDefined();
    expect(h.disk(VELA)[0]?.members).toHaveLength(SPARK_CREW_MEMBERS_MAX);
    expect(h.events.map((e) => e.event)).toContain("fieldd.crews.full");
  });

  it("K7 · a held start allowed after its crew closed joins that crew; a crew this fieldd never minted is made in the run it is told", () => {
    const h = harness();
    const crew = h.crews.join(VELA, "run-vela");
    h.crews.started(VELA, of(crew), claude("run-21"));
    h.crews.sparkRow(VELA, "run-vela", true);
    h.crews.started(VELA, of(crew), claude("run-22"));
    expect(h.disk(VELA).map((c) => c.members.length)).toEqual([2]);
    // a held spawn kept across a restart: its crew minted by the fieldd before this one
    const restarted = h.open();
    restarted.started(VELA, of("cr-heldkept" as CrewId, "run-vela-2"), claude("run-31"));
    expect(h.disk(VELA)[1]).toMatchObject({ id: "cr-heldkept", sparkRun: "run-vela-2" });
  });

  it("K8 · a member its spawn started and the record never kept is kept from its row (R4); a crew no fieldd here minted and the record lacks is the board's alone", () => {
    const h = harness();
    const crew = h.crews.join(VELA, "run-vela");
    h.crews.seen(row({ runtimeRunId: "run-21", crew, model: "Opus 5.5" }));
    expect(h.disk(VELA)[0]?.members.map((m) => [m.runtimeRunId, m.model])).toEqual([
      ["run-21", "Opus 5.5"],
    ]);
    // the start told after its row keeps one member
    h.crews.started(VELA, of(crew), claude("run-21"));
    expect(h.disk(VELA)[0]?.members).toHaveLength(1);
    h.open().seen(row({ runtimeRunId: "run-99", crew: "cr-elsewhere" as CrewId }));
    expect(h.disk(VELA).map((c) => c.id)).toEqual([crew]);
  });

  it("K9 · a member resumed in a new run is one member, following its new run (SPE-Q30 (a))", () => {
    const h = harness();
    const crew = h.crews.join(VELA, "run-vela");
    h.crews.started(VELA, of(crew), claude("run-21"));
    h.crews.started(VELA, of(crew), claude("run-22"));
    h.crews.seen(
      row({ runtimeRunId: "run-22", crew, conversation: "native-22", model: "Opus 5.5" }),
    );
    h.crews.ended("run-22", "Claude Code in vibe-field");
    // Godview's resume: the same conversation in a new run, its origin (and so its crew) kept
    h.crews.seen(row({ runtimeRunId: "run-41", crew, conversation: "native-22" }));
    const members = h.disk(VELA)[0]?.members ?? [];
    expect(members.map((m) => m.runtimeRunId)).toEqual(["run-21", "run-41"]);
    expect(members[1]).toMatchObject({ continues: "run-22", model: "Opus 5.5" });
    expect(members[1]).not.toHaveProperty("endedAt");
    expect(members[1]).not.toHaveProperty("name");
  });

  it("K10 · a write the disk refuses is logged, and the crews stay as the disk has them", () => {
    const h = harness((store) => ({
      get: (spark) => store.get(spark),
      list: () => store.list(),
      update: () => {
        throw new Error("EIO: the disk did not take it");
      },
    }));
    const crew = h.crews.join(VELA, "run-vela");
    h.crews.started(VELA, of(crew), claude("run-21"));
    expect(h.disk(VELA)).toEqual([]);
    expect(h.crews.frame(VELA, () => undefined).crews).toEqual([]);
    expect(h.events.map((e) => e.event)).toContain("fieldd.crews.keep_failed");
  });
});

describe("the crews' door's frame (SPE-Q27 (a), SPE-Q32 (a))", () => {
  it("D1 · the spark's crews whole, and how many tasks wait for each member still on the board; another spark's change is its own", () => {
    const h = harness();
    const crew = h.crews.join(VELA, "run-vela");
    for (const run of ["run-21", "run-22", "run-23"]) h.crews.started(VELA, of(crew), claude(run));
    h.crews.ended("run-21", "Claude Code in vibe-field");
    const waiting = new Map([
      ["run-22", 1],
      ["run-23", 0],
    ]);
    const frame = ComposeSparksCrewsFrame.parse(h.crews.frame(VELA, (run) => waiting.get(run)));
    expect(frame.spark).toBe(VELA);
    expect(frame.crews.map((c) => c.members.length)).toEqual([3]);
    expect(frame.waiting).toEqual([
      { runtimeRunId: "run-22", tasks: 1 },
      { runtimeRunId: "run-23", tasks: 0 },
    ]);
    // a spark with no crew: an empty list, never a refusal
    expect(h.crews.frame(KIWI, () => undefined)).toEqual({ spark: KIWI, crews: [], waiting: [] });
    // each member's row is a change, so the door reads `waiting` again
    h.changes.length = 0;
    h.crews.seen(row({ runtimeRunId: "run-22", crew }));
    expect(h.changes).toEqual([VELA]);
  });
});
