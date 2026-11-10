import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ObjectIntent } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { RecordSigner } from "../src/signed-record";
import { createDeskVerbs } from "../src/tool-plane/rooms/desk/verbs";
import { cleanupWorlds, type DeskWorld, DOC, world } from "./desk-fixtures";

// OB custody, C4 (OB-D18 A; rev-custody B3) — who a run is, for a grant, is fieldd's own memory of what it launched
// (`bornFor`), never a record read back from disk: the sessions' key is a file an agent can read, so a run's record can
// be rewritten to name any spark. A run this fieldd did not launch (re-attached at boot) holds nothing and can be
// handed nothing; a plain run's grant ends with the fieldd that launched it; a spark's stands (EY-D9 B) and is held by
// the runs fieldd starts for it from then on.

afterEach(cleanupWorlds);

const SPARK = "sp-7k2m9q4x";
const UNVOUCHED =
  "That agent was running before VibeField restarted. Start it again, or hand this to another.";
const asRun = (runtimeRunId: string) => ({ runtimeRunId });

/** A world whose spark, Vela, thinks in run-1, which this fieldd launched for her. */
function sparkWorld(opts: Parameters<typeof world>[0] = {}): DeskWorld {
  const h = world(opts);
  h.sparks.set(SPARK, "Vela");
  h.sparkRuns.set("run-1", SPARK);
  h.runs.set("run-1", "live");
  return h;
}

/** A run fieldd launches now: a plain one, or one for Vela. */
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
    // ... and the run that was there before the restart is not served it: this fieldd did not launch it
    expect(again.grantOf(ref, "run-1")).toBeUndefined();
    const verbs = createDeskVerbs({ objects: again });
    await expect(verbs.object_open(asRun("run-1"), { ref })).rejects.toMatchObject({
      details: { fact: "not-handed" },
      message: expect.stringContaining("before VibeField restarted"),
    });
    expect(again.presence.snapshot().objects).toEqual([]);
    // the run fieldd starts for the spark next holds what the spark was handed
    expect(again.grantOf(ref, launch(h, "run-2", SPARK))?.how).toBe("handed");
  });

  it("a forged session's record names no holder: rewritten to name another spark, a run holds nothing of that spark's", async () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    // run-a is a plain run this fieldd launched. Its agent reads the sessions' key (0600, the same uid) and rewrites
    // its own run's record to say it is Vela's. Only the two fields the door read are written here.
    const sessions = new RecordSigner({
      keyPath: join(h.root, "sessions.key"),
      keyEncoding: "base64",
    });
    const forged = { runtimeRunId: "run-a", spark: SPARK };
    const path = join(h.root, "run-a.json");
    const signed = { ...forged, signature: sessions.sign(forged) };
    writeFileSync(path, JSON.stringify(signed), { mode: 0o600 });
    // the forgery verifies: whoever reads the record back is told run-a is the spark's
    expect(sessions.read(path)).toEqual({ body: forged });
    h.recordSays.set("run-a", forged.spark);
    // and it confers nothing. A launch adopted through the agent gateway is the same case: born plain, whatever
    // its record names.
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

  it("refuses a hand to a run that was running before VibeField restarted, in those words", () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.runs.set("run-done", "ended");
    const again = h.reopen();
    // a live plain run, a spark's run and an ended one, each from before the restart
    for (const run of ["run-a", "run-1", "run-done"])
      expect(again.hand(ref, run), run).toEqual({ handed: false, reason: UNVOUCHED });
    expect(again.grants(ref)).toEqual([]);
    // a run nobody knows is still said as that
    expect(again.hand(ref, "run-none")).toEqual({
      handed: false,
      reason: expect.stringContaining("doesn't know that agent"),
    });
    // and one this fieldd launched is handed it as ever
    expect(again.hand(ref, launch(h, "run-new"))).toEqual({ handed: true });
  });

  it("a re-attached run can place nothing: refused before the window is asked", async () => {
    const h = world({ answerMs: 20 });
    const again = h.reopen();
    const sent: ObjectIntent[] = [];
    again.subscribeDesk(DOC, "tok-window", (intent) => sent.push(intent));
    const verbs = createDeskVerbs({ objects: again });
    await expect(verbs.canvas_place(asRun("run-a"), { kind: "desk.note" })).rejects.toMatchObject({
      kind: "UNAVAILABLE",
      details: { service: "desk", state: "before-restart" },
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
    // run-a's session continues in run-c, which this fieldd launched
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
});

describe("a take-back reaches the grant the person means, whoever fieldd can vouch for (C5)", () => {
  it("takes a spark's grant back by its re-attached run, which fieldd cannot vouch for", () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    const again = h.reopen();
    again.reconcile();
    again.takeBack(ref, "run-1");
    expect(again.grants(ref)).toEqual([]);
    expect(again.grantOf(ref, launch(h, "run-2", SPARK))).toBeUndefined();
  });

  it("takes a plain run's grant back by the holder the list names, before the settle has ended it", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const again = h.reopen();
    const [listed] = again.grants(ref);
    expect(listed?.holder).toBe("run-a");
    again.takeBack(ref, listed?.holder ?? "");
    expect(again.grants(ref)).toEqual([]);
    expect(grantsOnDisk(h)).toEqual([]);
  });

  it("does not take a spark's grant back through a record that only claims the spark, from a run born plain", () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    // run-a was launched plain by this fieldd; its record was rewritten to name Vela
    h.recordSays.set("run-a", SPARK);
    h.desk.takeBack(ref, "run-a");
    expect(h.desk.grantOf(ref, "run-1")?.how).toBe("handed");
  });
});
