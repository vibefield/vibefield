import { afterEach, describe, expect, it } from "vitest";
import { createDeskVerbs } from "../src/tool-plane/rooms/desk/verbs";
import { cleanupWorlds, type DeskWorld, DOC, ordinaryWindow, world } from "./desk-fixtures";

// OB-3a (§5.6, §11; OB-L1, EY-D9 B) — who a grant belongs to. A spark's run id changes each time it sleeps and wakes (a
// resume continues in a new run), and the send that hands it an object is meant to outlast that, so a spark's grants are
// the spark's. A plain run's are its run's, and end with it. Whatever is held can be listed, and taken back.

afterEach(cleanupWorlds);

const SPARK = "sp-7k2m9q4x";
const asRun = (runtimeRunId: string) => ({ runtimeRunId });

function sparkWorld(): DeskWorld {
  const h = world();
  h.sparks.set(SPARK, "Vela");
  h.sparkRuns.set("run-1", SPARK);
  h.runs.set("run-1", "live");
  return h;
}

/** The spark sleeps: run-1 ends. It wakes in run-2. */
function sleepAndWake(h: DeskWorld, desk = h.desk) {
  h.runs.set("run-1", "ended");
  desk.runEnded("run-1");
  h.sparkRuns.set("run-2", SPARK);
  h.runs.set("run-2", "live");
}

describe("a spark keeps what it was handed (§5.6)", () => {
  it("across a sleep and a wake, whose run id is a new one", async () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    expect(h.desk.hand(ref, "run-1")).toEqual({ handed: true });
    sleepAndWake(h);
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window(ordinaryWindow);
    await expect(verbs.object_open(asRun("run-2"), { ref })).resolves.toMatchObject({
      object: { yours: "handed" },
    });
    await expect(
      verbs.object_read(asRun("run-2"), { ref, tool: "read_text" }),
    ).resolves.toMatchObject({ result: { text: "eggs" } });
  });

  it("across a sleep, a wake and a restart of fieldd (EY-D9 B)", async () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    sleepAndWake(h);
    const again = h.reopen();
    again.reconcile();
    expect(again.grantOf(ref, "run-2")?.how).toBe("handed");
  });

  it("what it placed, too", async () => {
    const h = sparkWorld();
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window(ordinaryWindow);
    const manual = (await verbs.canvas_place(asRun("run-1"), { kind: "desk.note" })) as {
      object: { ref: string };
    };
    sleepAndWake(h);
    await expect(verbs.canvas_remove(asRun("run-2"), { ref: manual.object.ref })).resolves.toEqual({
      removed: true,
    });
  });

  it("can be handed something while it sleeps: its last run has ended, the spark has not", () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.runs.set("run-1", "ended");
    expect(h.desk.hand(ref, "run-1")).toEqual({ handed: true });
    h.sparkRuns.set("run-2", SPARK);
    expect(h.desk.grantOf(ref, "run-2")?.how).toBe("handed");
  });

  it("holds to the same rule: another spark and a plain run are not-handed", async () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    h.sparks.set("sp-other0000", "Other");
    h.sparkRuns.set("run-other", "sp-other0000");
    h.runs.set("run-other", "live");
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window(ordinaryWindow);
    for (const run of ["run-other", "run-a"])
      await expect(verbs.object_open(asRun(run), { ref })).rejects.toMatchObject({
        details: { fact: "not-handed" },
      });
  });

  it("gives back a handed object for good when any of its runs releases it", async () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    sleepAndWake(h);
    await createDeskVerbs({ objects: h.desk }).object_release(asRun("run-2"), { ref });
    expect(h.desk.grantOf(ref, "run-1")).toBeUndefined();
    expect(h.desk.grantOf(ref, "run-2")).toBeUndefined();
  });
});

describe("a plain run's grants end with it", () => {
  it("are gone when the run ends, so nothing claims the object for it", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    h.desk.hand(ref, "run-b");
    h.desk.runEnded("run-a");
    expect(h.desk.grantOf(ref, "run-a")).toBeUndefined();
    expect(h.desk.grantOf(ref, "run-b")?.how).toBe("handed");
    expect(h.reopen().grantOf(ref, "run-a")).toBeUndefined();
  });

  it("survive a restart of fieldd while the run lives (EY-D9 B)", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    const again = h.reopen();
    again.reconcile();
    expect(again.grantOf(ref, "run-a")?.how).toBe("handed");
  });

  it("are dropped once the re-attach has settled, when the run ended while fieldd was down", () => {
    const h = world();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-a");
    h.desk.hand(ref, "run-b");
    h.runs.delete("run-a");
    h.runs.set("run-b", "ended");
    const again = h.reopen();
    again.reconcile();
    expect(again.grantOf(ref, "run-a")).toBeUndefined();
    expect(again.grantOf(ref, "run-b")).toBeUndefined();
  });

  it("are dropped at that settle for a spark fieldd no longer holds, and kept for one it does", () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    const other = h.refOf("k2", "desk.note");
    h.desk.hand(ref, "run-1");
    h.sparks.set("sp-gone00000", "Gone");
    h.sparkRuns.set("run-gone", "sp-gone00000");
    h.runs.set("run-gone", "live");
    h.desk.hand(other, "run-gone");
    h.sparks.delete("sp-gone00000");
    const again = h.reopen();
    again.reconcile();
    expect(again.grantOf(ref, "run-1")?.how).toBe("handed");
    expect(again.registry.get(other)?.grants).toEqual([]);
  });
});

describe("a forgotten grant can be found and taken back (§11)", () => {
  it("lists every grant with the object it is on and who holds it, a spark by its name", () => {
    const h = sparkWorld();
    const note = h.refOf("k1", "desk.note");
    const other = h.refOf("k2", "desk.note");
    h.desk.hand(note, "run-1");
    h.desk.hand(other, "run-a");
    h.desk.registry.grant(other, "run-b", "placed");
    const all = h.desk.grants();
    expect(all).toHaveLength(3);
    expect(all).toContainEqual(
      expect.objectContaining({
        ref: note,
        docId: DOC,
        key: "k1",
        kind: "desk.note",
        holder: `spark:${SPARK}`,
        name: "Vela",
        how: "handed",
      }),
    );
    expect(all).toContainEqual(
      expect.objectContaining({ ref: other, holder: "run-b", name: "claude·b", how: "placed" }),
    );
    expect(h.desk.grants(note).map((g) => g.holder)).toEqual([`spark:${SPARK}`]);
    expect(h.desk.grants("vf:obj/zzzzzzzz")).toEqual([]);
  });

  it("takes a spark's grant back by the holder the list names, though the spark has no run now", async () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    const [grant] = h.desk.grants(ref);
    h.runs.set("run-1", "ended");
    h.desk.takeBack(ref, grant?.holder ?? "");
    h.sparkRuns.set("run-2", SPARK);
    h.runs.set("run-2", "live");
    h.window(ordinaryWindow);
    await expect(
      createDeskVerbs({ objects: h.desk }).object_open(asRun("run-2"), { ref }),
    ).rejects.toMatchObject({ details: { fact: "not-handed" } });
  });

  it("takes a spark's grant back by any of its runs, and shows every run of it released", async () => {
    const h = sparkWorld();
    const ref = h.refOf("k1", "desk.note");
    h.desk.hand(ref, "run-1");
    const verbs = createDeskVerbs({ objects: h.desk });
    h.window(ordinaryWindow);
    await verbs.object_open(asRun("run-1"), { ref });
    h.desk.takeBack(ref, `spark:${SPARK}`);
    expect(h.desk.grants(ref)).toEqual([]);
    expect(h.desk.presence.snapshot().objects[0]?.agents[0]?.state).toBe("released");
  });

  it("moves a `one` kind off a spark as off a run", () => {
    const h = sparkWorld();
    const ref = h.refOf("page", "vibefield.page");
    h.desk.hand(ref, "run-1");
    h.desk.hand(ref, "run-a");
    expect(h.desk.grantOf(ref, "run-1")).toBeUndefined();
    expect(h.desk.grantOf(ref, "run-a")?.how).toBe("handed");
  });
});
