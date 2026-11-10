import { readFileSync } from "node:fs";
import type { ObjectIntent } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createDeskVerbs } from "../src/tool-plane/rooms/desk/verbs";
import { cleanupWorlds, type DeskWorld, DOC, world } from "./desk-fixtures";

// OB custody, C4 (OB-D18 A; rev-custody B3) — who a run is, for a grant, is fieldd's own memory of what it launched
// (`bornFor`), never a record read back from disk: the sessions' key is a file an agent can read, so a run's record can
// be rewritten to name any spark. Nothing in objects reads a session's record, to give or to take. A run nothing
// vouches for (re-attached at boot, and not named again by fieldd's launch memory) holds nothing, and a hand to it
// grants nothing, in a sentence VibeField already has. A plain run's grant ends with the fieldd that launched it,
// vouched or not (`plainHoldAtBoot: "end"`, the only value anything passes); a spark's stands (EY-D9 B) and is held
// by the runs fieldd starts for it, or vouches for, from then on.

afterEach(cleanupWorlds);

const SPARK = "sp-7k2m9q4x";
const OTHER = "sp-lyra00000";
const NO_SUCH_AGENT = "VibeField doesn't know that agent.";
const asRun = (runtimeRunId: string) => ({ runtimeRunId });

/** A world whose spark, Vela, thinks in run-1, which this fieldd launched for her. */
function sparkWorld(opts: Parameters<typeof world>[0] = {}): DeskWorld {
  const h = world(opts);
  h.sparks.set(SPARK, "Vela");
  h.sparkRuns.set("run-1", SPARK);
  h.runs.set("run-1", "live");
  return h;
}

/** A second spark, Lyra, thinking in run-l, launched by the fieldd running now. */
function withLyra(h: DeskWorld): DeskWorld {
  h.sparks.set(OTHER, "Lyra");
  h.sparkRuns.set("run-l", OTHER);
  h.runs.set("run-l", "live");
  return h;
}

/** A run fieldd launches now: a plain one, or one for a spark. */
function launch(h: DeskWorld, run: string, spark?: string) {
  if (spark !== undefined) h.sparkRuns.set(run, spark);
  h.runs.set(run, "live");
  return run;
}

const grantsOnDisk = (h: DeskWorld): { ref: string; holder: string }[] =>
  JSON.parse(readFileSync(h.grantsPath, "utf8")).grants;

describe("a grant is honoured only for a run this fieldd launched (OB-D18 A)", () => {
  it("a plain run's grant ends with fieldd", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const again = h.reopen();
    // run-a lived through the restart and came back re-attached. Before the settle it already holds nothing ...
    expect(again.grantOf(ref, "run-a")).toBeUndefined();
    again.reconcile();
    // ... and at the settle its grant is ended for good, in the file too
    expect(again.grants(ref)).toEqual([]);
    expect(grantsOnDisk(h)).toEqual([]);
  });

  it("a re-attached run holds nothing of its spark's until the spark's next run", async () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    const again = h.reopen();
    again.reconcile();
    // the spark's grant stands (EY-D9 B) ...
    expect(again.grants(ref)).toEqual([
      expect.objectContaining({ holder: `spark:${SPARK}`, name: "Vela", how: "handed" }),
    ]);
    // ... and the run that was there before the restart is not served it: this fieldd did not launch it. It is told
    // what any run is told of an object it does not hold, in the one sentence there is for that.
    expect(again.grantOf(ref, "run-1")).toBeUndefined();
    const verbs = createDeskVerbs({ objects: again });
    await expect(verbs.object_open(asRun("run-1"), { ref })).rejects.toMatchObject({
      details: { fact: "not-handed" },
      message: `${ref} is not yours to work: you neither placed it nor were handed it. Ask the user to hand it to you.`,
    });
    expect(again.presence.snapshot().objects).toEqual([]);
    // the run fieldd starts for the spark next holds what the spark was handed
    expect(again.grantOf(ref, launch(h, "run-2", SPARK))?.how).toBe("handed");
  });

  it("a forged session's record names no holder: rewritten to name another spark, a run holds nothing of that spark's", async () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    // run-a is a plain run this fieldd launched. Its agent reads the sessions' key and rewrites its own run's record
    // to say it is Vela's. The forgery verifies: whoever reads the record back is told run-a is the spark's.
    expect(h.forgeRecord("run-a", SPARK)).toEqual({
      body: { runtimeRunId: "run-a", spark: SPARK },
    });
    // And it confers nothing. A launch adopted through the agent gateway is the same case: born plain, whatever its
    // record names.
    expect(h.desk.holder("run-a")).toBe("run-a");
    expect(h.desk.grantOf(ref, "run-a")).toBeUndefined();
    const verbs = createDeskVerbs({ objects: h.desk });
    await expect(verbs.object_open(asRun("run-a"), { ref })).rejects.toMatchObject({
      details: { fact: "not-handed" },
    });
    await expect(
      verbs.object_read(asRun("run-a"), { ref, tool: "read_text" }),
    ).rejects.toMatchObject({ details: { fact: "not-handed" } });
    // what the person hands run-a is run-a's own, never the spark's
    const other = h.refOf("k2", "desk.note");
    expect(h.desk.hand(other, "run-a")).toEqual({ handed: true });
    expect(h.desk.grants(other).map((g) => g.holder)).toEqual(["run-a"]);
    expect(h.desk.grantOf(other, "run-1")).toBeUndefined();
    // and the spark's own run still holds what the spark was handed
    expect(h.desk.grantOf(ref, "run-1")?.how).toBe("handed");
  });

  it("an ended run this fieldd did not launch is refused as ended, a spark's last run among them", () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    // the spark sleeps and a plain run has exited, each before fieldd restarts
    h.runs.set("run-1", "ended");
    h.runs.set("run-done", "ended");
    const again = h.reopen();
    for (const run of ["run-1", "run-done"])
      expect(again.hand(ref, run), run).toEqual({
        handed: false,
        reason: expect.stringContaining("That agent has ended."),
      });
    expect(again.grants(ref)).toEqual([]);
  });

  it("a hand to a live run nothing vouches for grants nothing, and says no new words", () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    const again = h.reopen();
    // a plain run and a spark's run, each still live, each from before the restart
    for (const run of ["run-a", "run-1"])
      expect(again.hand(ref, run), run).toEqual({ handed: false, reason: NO_SUCH_AGENT });
    expect(again.grants(ref)).toEqual([]);
    // a run nobody knows is said the same way, as it always was
    expect(again.hand(ref, "run-none")).toEqual({ handed: false, reason: NO_SUCH_AGENT });
    // and one this fieldd launched is handed it as ever
    expect(again.hand(ref, launch(h, "run-new"))).toEqual({ handed: true });
  });

  it("a re-attached run can place nothing: refused before the window is asked, in words VibeField already has", async () => {
    const h = world({ answerMs: 20 });
    const again = h.reopen();
    const sent: ObjectIntent[] = [];
    again.subscribeDesk(DOC, "tok-window", (intent) => sent.push(intent));
    const verbs = createDeskVerbs({ objects: again });
    await expect(verbs.canvas_place(asRun("run-a"), { kind: "desk.note" })).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      message: NO_SUCH_AGENT,
      details: { service: "desk", state: "unknown-agent" },
    });
    expect(sent).toEqual([]);
    expect(again.grants()).toEqual([]);
  });

  it("the settle spares a run launched and handed something since the boot", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const again = h.reopen();
    expect(again.hand(ref, launch(h, "run-new"))).toEqual({ handed: true });
    again.reconcile();
    expect(again.grants(ref).map((g) => g.holder)).toEqual(["run-new"]);
  });
});

describe("a resume carries grants only between runs this fieldd launched (OB-D18 A)", () => {
  const resume = (h: DeskWorld, desk: DeskWorld["desk"], old: string, next: string) => {
    h.runs.set(old, "ended");
    desk.runEnded(old);
    h.runs.set(next, "live");
    desk.runReplaced(old, next);
  };

  it("a resume into a run born here carries the grants, into a re-attached one does not", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    const other = h.refOf("k2", "desk.note");
    h.desk.hand(ref, "run-a");
    h.desk.hand(other, "run-b");
    // run-a's session continues in run-c, which this fieldd launched. run-a has ended by then, and is still whose
    // it was: an ended run goes on answering what it was launched as.
    resume(h, h.desk, "run-a", "run-c");
    expect(h.desk.grantOf(ref, "run-c")?.how).toBe("handed");
    // run-b's continues in run-d, which it did not
    h.reattached.add("run-d");
    resume(h, h.desk, "run-b", "run-d");
    expect(h.desk.grantOf(other, "run-d")).toBeUndefined();
    expect(h.desk.grants(other)).toEqual([]);
  });

  it("does not carry what a re-attached run held before the restart", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const again = h.reopen();
    // before the settle has ended run-a's grant, its session is resumed into a run this fieldd launches
    resume(h, again, "run-a", "run-c");
    expect(again.grantOf(ref, "run-c")).toBeUndefined();
    expect(again.grants(ref)).toEqual([]);
  });

  it("does not carry what a vouched plain run held before the restart, when it ends before the settle", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const again = h.reopen({ vouched: ["run-a"] });
    // run-a is vouched, and what it held at boot is still not this fieldd's to hand on: it ends with the run
    resume(h, again, "run-a", "run-c");
    expect(again.grantOf(ref, "run-c")).toBeUndefined();
    expect(again.grants(ref)).toEqual([]);
  });
});

// OB-D18 is ONE rule, at the settle (the spec's §8.1.5): what a plain run held when fieldd booted ends, whether or not
// fieldd vouches for the run again. `plainHoldAtBoot` decides it, never `bornFor`; `"end"` is James's pick and the only
// value anything passes. What stood at boot serves nobody from the boot on, and the settle writes that down.
describe("a plain run's hold at boot ends, vouched or not (OB-D18 A; `plainHoldAtBoot`)", () => {
  it("under `end`, a vouched plain run's old grant is gone after the boot, and a new hand to it is granted", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    // fieldd restarts, and its launch memory names run-a again: a plain run, vouched
    const again = h.reopen({ vouched: ["run-a"] });
    // from the boot on, what it held before serves nobody ...
    expect(again.grantOf(ref, "run-a")).toBeUndefined();
    again.reconcile();
    // ... and at the settle it is ended for good, in the file too
    expect(again.grantOf(ref, "run-a")).toBeUndefined();
    expect(again.grants(ref)).toEqual([]);
    expect(grantsOnDisk(h)).toEqual([]);
    // a new hand is this fieldd's own, and is granted
    expect(again.hand(ref, "run-a")).toEqual({ handed: true });
    expect(again.grantOf(ref, "run-a")?.how).toBe("handed");
    expect(grantsOnDisk(h).map((g) => g.holder)).toEqual(["run-a"]);
  });

  it("under `end`, a new hand made before the settle is kept by it", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const again = h.reopen({ vouched: ["run-a"] });
    // the settle is polled, and may come after the first hand. The old grant served nobody, so this is no `already`.
    expect(again.hand(ref, "run-a")).toEqual({ handed: true });
    expect(again.grantOf(ref, "run-a")?.how).toBe("handed");
    again.reconcile();
    expect(again.grantOf(ref, "run-a")?.how).toBe("handed");
    expect(grantsOnDisk(h).map((g) => g.holder)).toEqual(["run-a"]);
  });

  it("a vouched spark's run is served its spark's grants after the boot", () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    // run-1 lived through the restart, and fieldd's launch memory says again that it is Vela's
    const again = h.reopen({ vouched: ["run-1"] });
    // a spark's grant is the spark's: before the settle, and after it
    expect(again.grantOf(ref, "run-1")?.how).toBe("handed");
    again.reconcile();
    expect(again.grantOf(ref, "run-1")?.how).toBe("handed");
    expect(again.grants(ref).map((g) => g.holder)).toEqual([`spark:${SPARK}`]);
  });

  it("`keep-vouched`, which is wired nowhere, keeps a vouched plain run's grant at the settle", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    const other = h.refOf("k2", "desk.note");
    h.desk.hand(ref, "run-a");
    h.desk.hand(other, "run-b");
    const again = h.reopen({ vouched: ["run-a"] });
    // until the settle has judged it, what stood at boot serves nobody, whichever rule it will be
    expect(again.grantOf(ref, "run-a")).toBeUndefined();
    // OB-D18 is James's pick, and it is "end": nothing but this row passes the other value
    again.reconcile({ plainHoldAtBoot: "keep-vouched" });
    expect(again.grantOf(ref, "run-a")?.how).toBe("handed");
    // a run nothing vouches for keeps nothing under either rule
    expect(again.grants(other)).toEqual([]);
  });
});

// A take-back reads no record either: the forger is the run being taken from. For a run fieldd launched it ends that
// holder's grant alone; for a holder's own name, that holder's alone; and for a run it did not launch it cannot say
// whose the run is, so it ends the grant under the very name given and EVERY spark's grant on that object. Taking back
// too much is the safe side. It is a fallback inside fieldd: no surface names such a run in a take-back.
describe("a take-back reads no record (OB-D18 A, OB-D19 A)", () => {
  /** Vela and Lyra each hold `both`; Lyra alone holds `hers`. */
  function twoSparks() {
    const h = withLyra(sparkWorld());
    const both = h.refOf("k1", "desk.note");
    const hers = h.refOf("k2", "desk.note");
    h.desk.hand(both, "run-1");
    h.desk.hand(both, "run-l");
    h.desk.hand(hers, "run-l");
    return { h, both, hers };
  }

  it("a take-back from a run fieldd did not start removes every spark's grant on that object", () => {
    const { h, both, hers } = twoSparks();
    const again = h.reopen();
    again.reconcile();
    // run-1 came back re-attached: fieldd cannot say whose run it is
    expect(again.takeBack(both, "run-1")).toEqual([`spark:${SPARK}`, `spark:${OTHER}`]);
    expect(again.grants(both)).toEqual([]);
    expect(again.grantOf(both, launch(h, "run-2", SPARK))).toBeUndefined();
    expect(again.grantOf(both, launch(h, "run-m", OTHER))).toBeUndefined();
    // on that object alone: what a spark holds elsewhere is untouched
    expect(again.grants(hers).map((g) => g.holder)).toEqual([`spark:${OTHER}`]);
    expect(grantsOnDisk(h).map((g) => [g.ref, g.holder])).toEqual([[hers, `spark:${OTHER}`]]);
  });

  it("a run whose record names another spark cannot keep its own spark's grant through a take-back", () => {
    const h = withLyra(sparkWorld());
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    const again = h.reopen();
    again.reconcile();
    // Vela's run-1, re-attached, rewrites its own record to say it is Lyra's. The forgery verifies.
    expect(h.forgeRecord("run-1", OTHER)).toEqual({
      body: { runtimeRunId: "run-1", spark: OTHER },
    });
    // The person takes the object back from run-1. Were the record believed, Lyra's grant would be looked for (she
    // has none here), Vela's would stay, and Vela's next run would hold the object again.
    again.takeBack(ref, "run-1");
    expect(again.grants(ref)).toEqual([]);
    expect(again.grantOf(ref, launch(h, "run-2", SPARK))).toBeUndefined();
  });

  it("a take-back from a run born here removes that holder's grant alone", () => {
    const { h, both } = twoSparks();
    h.desk.hand(both, "run-a");
    // run-a's record is rewritten to name Vela: it changes nothing, nobody reads it
    h.forgeRecord("run-a", SPARK);
    expect(h.desk.takeBack(both, "run-a")).toEqual(["run-a"]);
    expect(h.desk.grants(both).map((g) => g.holder)).toEqual([`spark:${SPARK}`, `spark:${OTHER}`]);
    // a spark's run born here: the spark's alone
    expect(h.desk.takeBack(both, "run-1")).toEqual([`spark:${SPARK}`]);
    expect(h.desk.grants(both).map((g) => g.holder)).toEqual([`spark:${OTHER}`]);
  });

  it("a take-back by a holder's own name removes that holder's grant alone, though no run of it is here", () => {
    const { h, both } = twoSparks();
    const again = h.reopen();
    again.reconcile();
    const listed = again.grants(both).map((g) => g.holder);
    expect(listed).toEqual([`spark:${SPARK}`, `spark:${OTHER}`]);
    expect(again.takeBack(both, `spark:${SPARK}`)).toEqual([`spark:${SPARK}`]);
    expect(again.grants(both).map((g) => g.holder)).toEqual([`spark:${OTHER}`]);
  });

  it("takes a plain run's grant back by the holder the list names, before the settle has ended it", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const again = h.reopen();
    const [listed] = again.grants(ref);
    expect(listed?.holder).toBe("run-a");
    expect(again.takeBack(ref, listed?.holder ?? "")).toEqual(["run-a"]);
    expect(again.grants(ref)).toEqual([]);
    expect(grantsOnDisk(h)).toEqual([]);
  });

  it("answers no holder when there was nothing to take", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    expect(h.desk.takeBack(ref, "run-a")).toEqual([]);
    expect(h.desk.takeBack(ref, "run-none")).toEqual([]);
  });
});
