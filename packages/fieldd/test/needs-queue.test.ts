import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_CATALOG,
  NEEDS_CHOICE_WORDS,
  NEEDS_RECORD_FORMAT,
  NEEDS_WORDS_MAX,
  NeedsItem,
  type NeedsItemId,
  NeedsNotice,
  type NeedsRecord,
  type SparkRecord,
  type SparkSummary,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcCallError } from "../src/native-link";
import type { GrantPrincipal } from "../src/terminal-grants";
import { SPARK_LIVE_AGENTS_MAX } from "../src/tool-plane/rooms/talk/verbs";
import {
  type FlowItemActed,
  type FlowItemAnswer,
  type FlowItemRaise,
  type FlowItemStart,
  type FlowItemStarted,
  NeedsQueue,
  type NeedsRun,
} from "../src/tool-plane/rooms/you/queue";
import { NeedsStore } from "../src/tool-plane/rooms/you/store";
import * as words from "../src/tool-plane/rooms/you/words";

// CP-3 — the needs-you queue (`draft/compose-plane/cp3-the-person.md`, ruled 2026-10-31: CP3-D1…D8 at A), the you
// room's one authority, over a real signed store and fakes of fieldd's services: a question's answer lands as one marked
// wake (CP3-D2 A), a sleeping spark is resumed for it (CP3-D7 A), the first send into his session waits for his OK and
// his yes lasts for that run (CP3-D3 B), a spawn past the cap waits for Allow one more (CP3-D4 A), an agent's own ask is
// listed and never answered here (CP3-D1 A), and notify reaches every listener (CP3-D5 A). With the critique's: the act
// apart from its telling (4), answers serialized (5), an act a restart broke into never repeated (15), and a restart that
// re-reads the store and judges the runs only once the re-attach has settled (3).

const AGENT = AGENT_CATALOG[0]!;
const VELA = "sp-vela00000000";
const VELA_FROM = { spark: VELA, name: "Vela", session: "run-vela" };
const principal = { kind: "local-token" } as GrantPrincipal;

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sparkRecord = (id: string, name: string, profiles = ["native"]): SparkRecord => ({
  format: 1,
  id,
  name,
  face: { seed: 7 },
  agent: AGENT.id,
  profiles,
  thinksUnder: profiles[0]!,
  folder: `/f/sparks/${name.toLowerCase()}`,
  createdAt: "2026-10-31T15:00:00.000Z",
  updatedAt: "2026-10-31T15:00:00.000Z",
});

function harness(root = mkdtempSync(join(tmpdir(), "vf-needs-queue-"))) {
  if (!dirs.includes(root)) dirs.push(root);
  const woken: [string, string][] = [];
  /** item 158 — the item each wake's fact is for, as the input queue is told it (CO-Q9 (b)) */
  const wokenItems: [string, NeedsItemId | undefined][] = [];
  const queued: [string, string, string][] = [];
  const spawned: unknown[] = [];
  const opened: string[] = [];
  /** TH-1 — VibeField's acts kept in a spark's transcript: [spark, run, what, text] */
  const acts: [string, string, string, string][] = [];
  const runs = new Map<string, NeedsRun>([
    ["run-vela", { runtimeRunId: "run-vela", label: "Vela", spark: VELA, live: true }],
    ["run-his", { runtimeRunId: "run-his", label: "claude·2", live: true }],
    ["run-ada", { runtimeRunId: "run-ada", label: "Ada", startedBy: VELA, live: true }],
  ]);
  const sessions = new Map<string, string>([[VELA, "run-vela"]]);
  const sparks = new Map<string, SparkRecord>([[VELA, sparkRecord(VELA, "Vela")]]);
  let clock = Date.parse("2026-10-31T16:00:00.000Z");
  const ctl = {
    /** what open does for a spark that sleeps: resume it live, leave it starting, or refuse */
    open: "resume" as "resume" | "starting" | "refuse",
    spawn: async (): Promise<{ runtimeRunId: string }> => ({
      runtimeRunId: `run-new-${spawned.length}`,
    }),
    /** called inside open, before it answers (a monitor event that arrives meanwhile) */
    duringOpen: undefined as undefined | (() => void),
    /** called as each word is queued, before it is (a spark's send that arrives while an Allow acts) */
    duringEnqueue: undefined as undefined | (() => void),
    /** TU-1 — the monitor's persona map (null: no frame read yet): Work lists `claude:work` */
    personaSets: new Map([["claude:work", "work"]]) as ReadonlyMap<string, string> | null,
  };
  const sleep = () => {
    sessions.delete(VELA);
    runs.delete("run-vela");
  };
  const make = () =>
    new NeedsQueue({
      store: new NeedsStore({ dir: join(root, "needs"), keyPath: join(root, "needs.key") }),
      inputs: {
        wake: (run, fact, item) => {
          woken.push([run, fact]);
          wokenItems.push([run, item]);
          return true;
        },
        enqueue: (run, text, from) => {
          ctl.duringEnqueue?.();
          queued.push([run, text, from.kind === "spark" ? from.name : "VibeField"]);
          // IOS-12a — the queue answers the kept input's id beside its place
          return { id: `in-${queued.length}`, position: queued.filter(([r]) => r === run).length };
        },
      },
      run: (id) => runs.get(id),
      personaSets: () => ctl.personaSets,
      sparkSession: (spark) => sessions.get(spark),
      spark: (id) => sparks.get(id),
      open: async (id, by): Promise<SparkSummary> => {
        expect(by).toBe(principal);
        opened.push(id);
        ctl.duringOpen?.();
        if (ctl.open === "refuse") throw new Error("the spark's agent is signed out");
        const { format: _f, ...spark } = sparks.get(id)!;
        const run = "run-vela-2";
        if (ctl.open === "resume") {
          runs.set(run, { runtimeRunId: run, label: "Vela", spark: VELA, live: true });
          sessions.set(VELA, run);
        } else runs.set(run, { runtimeRunId: run, label: "Vela", spark: VELA, live: false });
        return { ...spark, session: { runtimeRunId: run, live: true } };
      },
      spawn: async (launch, spark, crew) => {
        spawned.push({ ...launch, spark, ...(crew !== undefined ? { crew } : {}) });
        return ctl.spawn();
      },
      agentLabel: (agent) => AGENT_CATALOG.find((e) => e.id === agent)?.label,
      appendAct: (spark, run, act) => void acts.push([spark, run, act.what, act.text]),
      now: () => {
        clock += 1000;
        return new Date(clock);
      },
    });
  const queue = make();
  const changes: number[] = [];
  queue.onChange((items) => void changes.push(items.length));
  /** the records the disk keeps now (needs/*.json), each verified */
  const kept = () =>
    new NeedsStore({ dir: join(root, "needs"), keyPath: join(root, "needs.key") }).list();
  return {
    root,
    queue,
    make,
    woken,
    wokenItems,
    kept,
    queued,
    spawned,
    opened,
    runs,
    sessions,
    sparks,
    ctl,
    sleep,
    changes,
    acts,
  };
}

/** What the queue lists, each parsed as the contract (the fieldd side of EL9). */
const listed = (queue: NeedsQueue) => queue.list().map((item) => NeedsItem.parse(item));

const refusal = async (call: Promise<unknown> | (() => unknown)) => {
  try {
    await (typeof call === "function" ? call() : call);
    return "ok";
  } catch (err) {
    const e = err as RpcCallError;
    const details = e.details as { fact?: string; reason?: string } | undefined;
    return details?.fact ?? details?.reason ?? e.kind ?? e.name;
  }
};

const ask = (h: ReturnType<typeof harness>, question = "Push the fix?") =>
  h.queue.ask(VELA_FROM, { question, choices: ["Push", "Hold"] });

describe("a spark's question (ask_user; CP3-D2 A, CP3-D7 A)", () => {
  it("waits as an item, and its answer lands as one marked wake", async () => {
    const h = harness();
    const id = ask(h);
    expect(listed(h.queue)).toEqual([
      expect.objectContaining({
        id,
        kind: "question",
        state: "open",
        from: { name: "Vela", session: "run-vela", spark: VELA },
        spark: VELA,
        words: "Push the fix?",
        choices: ["Push", "Hold", "Not now"],
      }),
    ]);
    const { item, woke } = await h.queue.answer(id, 0, principal);
    expect(NeedsItem.parse(item).answer).toMatchObject({ choice: 0, outcome: "done", told: true });
    expect(woke).toBeUndefined();
    expect(h.woken).toEqual([["run-vela", 'you answered Vela\'s question "Push the fix?": Push']]);
    expect(h.queue.list()).toEqual([]);
    // CO-Q9 (b): the record is kept until the spark's session confirms it took the line
    expect(readdirSync(join(h.root, "needs")).filter((f) => f.endsWith(".json"))).toHaveLength(1);
    h.queue.onFactOutcome("run-vela", [id], "delivered");
    expect(readdirSync(join(h.root, "needs"))).toEqual([]);
    expect(h.changes).toEqual([1, 0]);
  });

  it("Not now ends the item, and is a fact too", async () => {
    const h = harness();
    const id = ask(h);
    await h.queue.answer(id, 2, principal);
    expect(h.woken).toEqual([
      ["run-vela", 'you answered Vela\'s question "Push the fix?": Not now'],
    ]);
  });

  it("resumes a sleeping spark for its answer, and lands it in the resumed session's queue", async () => {
    const h = harness();
    const id = ask(h);
    h.sleep();
    const { item, woke } = await h.queue.answer(id, 1, principal);
    expect(h.opened).toEqual([VELA]);
    expect(woke).toBe("run-vela-2");
    expect(item.answer?.told).toBe(true);
    expect(h.woken).toEqual([
      ["run-vela-2", 'you answered Vela\'s question "Push the fix?": Hold'],
    ]);
  });

  it("keeps an answer owed, on disk, while its spark cannot be woken, and lands it once when its session is live", async () => {
    const h = harness();
    const id = ask(h);
    h.sleep();
    h.ctl.open = "refuse";
    const { item } = await h.queue.answer(id, 0, principal);
    // the act is done; the spark has not heard it (critique 4)
    expect(item.answer).toMatchObject({
      outcome: "done",
      told: false,
      waits: "the spark's agent is signed out",
    });
    expect(h.woken).toEqual([]);
    expect(h.queue.list()).toEqual([]);
    // a restart: a second queue over the same store
    const again = h.make();
    expect(again.restore()).toBe(1);
    expect(again.list()).toEqual([]);
    h.runs.set("run-vela-3", {
      runtimeRunId: "run-vela-3",
      label: "Vela",
      spark: VELA,
      live: false,
    });
    again.onSparkLive(VELA, "run-vela-3"); // still re-attaching: never into a pending run
    expect(h.woken).toEqual([]);
    h.runs.set("run-vela-3", {
      runtimeRunId: "run-vela-3",
      label: "Vela",
      spark: VELA,
      live: true,
    });
    again.onSparkLive(VELA, "run-vela-3");
    again.onSparkLive(VELA, "run-vela-3");
    expect(h.woken).toEqual([
      ["run-vela-3", 'you answered Vela\'s question "Push the fix?": Push'],
    ]);
    // CO-Q9 (b): heard once run-vela-3 confirms it took the line
    again.onFactOutcome("run-vela-3", [id], "delivered");
    expect(readdirSync(join(h.root, "needs")).filter((f) => f.endsWith(".json"))).toEqual([]);
  });

  it("a spark whose resumed session is still starting hears its answer when the session is live", async () => {
    const h = harness();
    const id = ask(h);
    h.sleep();
    h.ctl.open = "starting";
    const { item, woke } = await h.queue.answer(id, 0, principal);
    expect(woke).toBe("run-vela-2");
    expect(item.answer).toMatchObject({ told: false, waits: "Vela's session is not running yet" });
    h.runs.set("run-vela-2", {
      runtimeRunId: "run-vela-2",
      label: "Vela",
      spark: VELA,
      live: true,
    });
    h.queue.onSparkLive(VELA, "run-vela-2");
    expect(h.woken).toEqual([
      ["run-vela-2", 'you answered Vela\'s question "Push the fix?": Push'],
    ]);
  });

  it("is told once when its session comes alive while the answer resumes it", async () => {
    const h = harness();
    const id = ask(h);
    h.sleep();
    h.ctl.duringOpen = () => {
      h.runs.set("run-vela-2", {
        runtimeRunId: "run-vela-2",
        label: "Vela",
        spark: VELA,
        live: true,
      });
      h.queue.onSparkLive(VELA, "run-vela-2");
    };
    const { item } = await h.queue.answer(id, 0, principal);
    expect(item.answer?.told).toBe(true);
    expect(h.woken).toHaveLength(1);
  });

  it("is answered once, for every window: the same act answers it as it is, another is refused", async () => {
    const h = harness();
    const id = ask(h);
    const first = await h.queue.answer(id, 0, principal);
    expect((await h.queue.answer(id, 0, principal)).item).toEqual(first.item);
    expect(await refusal(h.queue.answer(id, 1, principal))).toBe("answered");
    expect(h.woken).toHaveLength(1);
  });

  it("refuses an act the item does not offer, and an item it does not know", async () => {
    const h = harness();
    const id = ask(h);
    expect(await refusal(h.queue.answer(id, 3, principal))).toBe("no-such-act");
    expect(await refusal(h.queue.answer(id, 1.5, principal))).toBe("no-such-act");
    expect(await refusal(h.queue.answer("ny-0000000000000000", 0, principal))).toBe("NOT_FOUND");
    expect(h.queue.list()).toHaveLength(1);
  });

  it("refuses a ninth open item from one spark as the fact `limit`", async () => {
    const h = harness();
    for (let i = 0; i < 8; i += 1) ask(h, `question ${i}`);
    expect(await refusal(() => ask(h))).toBe("limit");
    expect(await refusal(() => h.queue.send(VELA_FROM, "run-his", "words"))).toBe("limit");
    expect(h.queue.list()).toHaveLength(8);
  });
});

describe("an agent's own ask (CP3-D1 A, CP-L4)", () => {
  const blocked = (id: string, kind = "permission") => ({
    blockers: [
      {
        id,
        kind,
        since: "2026-10-31T16:20:00.000Z",
        permission: { tool: "Bash", requestId: "r1" },
      },
      { id: `${id}-2`, kind: "question", since: "2026-10-31T16:21:00.000Z" },
    ],
  });

  it("is listed with where to answer it, the same on every read, and never answered here", async () => {
    const h = harness();
    h.queue.onRunMonitor("run-ada", blocked("b1"));
    const [item] = listed(h.queue);
    expect(item).toEqual({
      id: expect.stringMatching(/^ny-[0-9a-f]{16}$/),
      kind: "agent-ask",
      state: "open",
      from: { name: "Ada", session: "run-ada" },
      spark: VELA,
      asked: "2026-10-31T16:20:00.000Z",
      ask: "permission",
      tool: "Bash",
      count: 2,
    });
    h.queue.onRunMonitor("run-ada", blocked("b1"));
    expect(h.queue.list()[0]?.id).toBe(item?.id);
    expect(h.changes).toEqual([1]);
    expect(await refusal(h.queue.answer(item!.id, 0, principal))).toBe("in-its-pane");
  });

  it("clears when the board says it cleared, and when its run ends", () => {
    const h = harness();
    h.queue.onRunMonitor("run-ada", blocked("b1"));
    h.queue.onRunMonitor("run-ada", { blockers: [] });
    expect(h.queue.list()).toEqual([]);
    h.queue.onRunMonitor("run-his", blocked("b2", "question"));
    expect(h.queue.list()[0]).toMatchObject({ ask: "question", from: { name: "claude·2" } });
    expect(h.queue.list()[0]).not.toHaveProperty("spark");
    h.queue.onRunEnded("run-his");
    expect(h.queue.list()).toEqual([]);
    h.queue.onRunMonitor("run-his", { blockers: [{ id: "f", kind: "failure", since: "x" }] });
    expect(h.queue.list()).toEqual([]);
  });
});

describe("the held send (CP-D3, CP3-D3 B)", () => {
  it("holds the first send into his session; Allow queues its words as the spark's and keeps the yes until that run ends", async () => {
    const h = harness();
    const id = h.queue.send(VELA_FROM, "run-his", "run the tests");
    expect(listed(h.queue)).toEqual([
      expect.objectContaining({
        id,
        kind: "held-send",
        words: "run the tests",
        choices: ["Allow", "Not now"],
        count: 1,
        to: { session: "run-his", name: "claude·2" },
      }),
    ]);
    expect(h.queue.allowed(VELA, "run-his")).toBe(false);
    const { item } = await h.queue.answer(id, 0, principal);
    expect(item.answer).toMatchObject({ outcome: "done", told: true });
    expect(h.queued).toEqual([["run-his", "run the tests", "Vela"]]);
    expect(h.woken).toEqual([["run-vela", words.sendAllowedFact("Vela", "claude·2")]]);
    expect(h.queue.allowed(VELA, "run-his")).toBe(true);
    expect(h.queue.allowed("sp-orin00000000", "run-his")).toBe(false);
    expect(h.queue.list()).toEqual([]);
    h.queue.onRunEnded("run-his");
    expect(h.queue.allowed(VELA, "run-his")).toBe(false);
    // CO-Q9 (b): its fact is heard once run-vela confirms it took the line
    h.queue.onFactOutcome("run-vela", [id], "delivered");
    expect(readdirSync(join(h.root, "needs"))).toEqual([]);
  });

  it("Not now drops the held words and tells the spark", async () => {
    const h = harness();
    const id = h.queue.send(VELA_FROM, "run-his", "run the tests");
    await h.queue.answer(id, 1, principal);
    expect(h.queued).toEqual([]);
    expect(h.woken).toEqual([["run-vela", words.sendHeldBackFact("Vela", "claude·2")]]);
    expect(h.queue.allowed(VELA, "run-his")).toBe(false);
  });

  it("joins the sends that wait on one item, in order, and refuses a seventeenth as `limit`", async () => {
    const h = harness();
    const id = h.queue.send(VELA_FROM, "run-his", "one");
    for (let i = 2; i <= 16; i += 1) expect(h.queue.send(VELA_FROM, "run-his", `${i}`)).toBe(id);
    expect(h.queue.list()).toEqual([expect.objectContaining({ count: 16, words: "one" })]);
    expect(await refusal(() => h.queue.send(VELA_FROM, "run-his", "17"))).toBe("limit");
    await h.queue.answer(id, 0, principal);
    expect(h.queued.map(([, text]) => text)).toEqual([
      "one",
      ...Array.from({ length: 15 }, (_, i) => `${i + 2}`),
    ]);
  });

  it("holds a send that comes while an Allow acts on its run's item in an item of its own, never in the one being spent (critique 5)", async () => {
    const h = harness();
    const id = h.queue.send(VELA_FROM, "run-his", "run the tests");
    let later: string | undefined;
    h.ctl.duringEnqueue = () => {
      h.ctl.duringEnqueue = undefined;
      later = h.queue.send(VELA_FROM, "run-his", "then push it");
    };
    const { item } = await h.queue.answer(id, 0, principal);
    expect(item.answer).toMatchObject({ outcome: "done", told: true });
    // the Allow queued only what it was asked about; the words that came meanwhile wait for an answer of their own
    expect(h.queued).toEqual([["run-his", "run the tests", "Vela"]]);
    expect(later).toMatch(/^ny-/);
    expect(later).not.toBe(id);
    expect(listed(h.queue)).toEqual([
      expect.objectContaining({ id: later, kind: "held-send", words: "then push it", count: 1 }),
    ]);
  });

  it("cuts long words on the wire and says so, while the record keeps them whole", async () => {
    // the cut is fieldd's alone, its "…" with it: the words come out as the contracts fixture the window draws (EL9)
    const fixture = NeedsItem.parse(
      JSON.parse(
        readFileSync(
          join(import.meta.dirname, "../../contracts/fixtures/needs-item.held-send-cut.json"),
          "utf8",
        ),
      ),
    );
    const cutWords = fixture.words ?? "";
    expect(fixture.cut).toBe(true);
    const h = harness();
    const long = `${cutWords.slice(0, -1)} and every word past the cut`;
    const id = h.queue.send(VELA_FROM, "run-his", long);
    const [item] = listed(h.queue);
    expect(item).toMatchObject({ cut: true, words: cutWords });
    expect(item?.words).toHaveLength(NEEDS_WORDS_MAX);
    expect(item?.words?.endsWith("…")).toBe(true);
    await h.queue.answer(id, 0, principal);
    expect(h.queued).toEqual([["run-his", long, "Vela"]]);
  });

  it("ends, and tells its spark, when its session ends before an answer", async () => {
    const h = harness();
    const id = h.queue.send(VELA_FROM, "run-his", "run the tests");
    h.runs.delete("run-his");
    h.queue.onRunEnded("run-his");
    expect(h.queue.list()).toEqual([]);
    expect(h.woken).toEqual([["run-vela", words.sendEndedFact("Vela", "claude·2")]]);
    expect(await refusal(h.queue.answer(id, 0, principal))).toBe("ended");
    expect(h.queued).toEqual([]);
  });

  it("re-checks an Allow: a session that ended, or one gone outside the spark's profiles, sends nothing", async () => {
    const h = harness();
    const ended = h.queue.send(VELA_FROM, "run-his", "a");
    h.runs.delete("run-his");
    const one = await h.queue.answer(ended, 0, principal);
    // CO-1b: the reason says "it" for the session its line names ("Couldn't send Vela's words to claude·2: it ended")
    expect(one.item.answer).toMatchObject({ outcome: "failed", reason: "it ended" });
    h.runs.set("run-work", {
      runtimeRunId: "run-work",
      label: "w",
      profileSet: "work",
      live: true,
    });
    const outside = h.queue.send(VELA_FROM, "run-work", "b");
    const two = await h.queue.answer(outside, 0, principal);
    expect(two.item.answer).toMatchObject({
      outcome: "failed",
      reason: "work is not one of Vela's Agent Profiles",
    });
    expect(h.queued).toEqual([]);
    expect(h.woken.map(([, fact]) => fact)).toEqual([
      words.sendEndedFact("Vela", "claude·2"),
      words.sendFailedFact("Vela", "w", "work is not one of Vela's Agent Profiles"),
    ]);
    expect(h.queue.allowed(VELA, "run-work")).toBe(false);
  });

  it("re-checks an Allow by the one rule (TU-1, Q3): a persona's run is its profile's, and a run in no profile is said in its own words", async () => {
    const h = harness();
    // filed under none, its persona listed by Work: Work's, never This Mac's
    h.runs.set("run-persona", {
      runtimeRunId: "run-persona",
      label: "claude·3",
      profileId: "claude:work",
      live: true,
    });
    // a persona no profile lists
    h.runs.set("run-orphan", {
      runtimeRunId: "run-orphan",
      label: "claude·4",
      profileId: "claude:gone",
      live: true,
    });
    const persona = await h.queue.answer(h.queue.send(VELA_FROM, "run-persona", "a"), 0, principal);
    expect(persona.item.answer).toMatchObject({
      outcome: "failed",
      reason: "work is not one of Vela's Agent Profiles",
    });
    const orphan = await h.queue.answer(h.queue.send(VELA_FROM, "run-orphan", "b"), 0, principal);
    expect(orphan.item.answer).toMatchObject({
      outcome: "failed",
      reason: "it is in none of Vela's Agent Profiles",
    });
    expect(h.queued).toEqual([]);
    expect(h.woken.map(([, fact]) => fact)).toEqual([
      words.sendFailedFact("Vela", "claude·3", "work is not one of Vela's Agent Profiles"),
      words.sendFailedFact("Vela", "claude·4", "it is in none of Vela's Agent Profiles"),
    ]);
  });

  it('CO-1b · re-checks an Allow: a session that is not running is said as "it", the line having named it', async () => {
    const h = harness();
    h.runs.set("run-asleep", {
      runtimeRunId: "run-asleep",
      label: "claude·5",
      profileSet: "native",
      live: false,
    });
    const { item } = await h.queue.answer(h.queue.send(VELA_FROM, "run-asleep", "a"), 0, principal);
    expect(item.to?.name).toBe("claude·5");
    expect(item.answer).toMatchObject({ outcome: "failed", reason: "it is not running" });
    expect(h.queued).toEqual([]);
    expect(h.woken.map(([, fact]) => fact)).toEqual([
      words.sendFailedFact("Vela", "claude·5", "it is not running"),
    ]);
  });

  it("an Allow before the profiles are read waits (TU-1, §12 Q1 (a′)): refused as retryable, its item open, its spark told nothing; the frame placed, it acts", async () => {
    const h = harness();
    // filed under none, its persona one This Mac's profile lists: Vela's, once the profiles are read
    h.runs.set("run-mine", {
      runtimeRunId: "run-mine",
      label: "claude·3",
      profileId: "claude:mine",
      live: true,
    });
    h.ctl.personaSets = null;
    const id = h.queue.send(VELA_FROM, "run-mine", "c");
    await expect(h.queue.answer(id, 0, principal)).rejects.toMatchObject({
      kind: "PRECONDITION_FAILED",
      retryable: true,
      details: { reason: "profiles-unread" },
    });
    expect(h.queue.list().find((item) => item.id === id)?.state).toBe("open");
    expect(h.queued).toEqual([]);
    expect(h.woken).toEqual([]);
    // the monitor's first frame lands: the same Allow, pressed again, is placed and acts
    h.ctl.personaSets = new Map([
      ["claude:work", "work"],
      ["claude:mine", "native"],
    ]);
    const allowed = await h.queue.answer(id, 0, principal);
    expect(allowed.item.answer).toMatchObject({ outcome: "done" });
    expect(h.queued).toEqual([["run-mine", "c", "Vela"]]);
  });

  it("an allowance granted to a sleeping spark holds, and the spark hears it once it wakes (critique 4)", async () => {
    const h = harness();
    const id = h.queue.send(VELA_FROM, "run-his", "run the tests");
    h.sleep();
    h.ctl.open = "refuse";
    const { item } = await h.queue.answer(id, 0, principal);
    expect(item.answer).toMatchObject({ outcome: "done", told: false });
    expect(h.queued).toEqual([["run-his", "run the tests", "Vela"]]);
    expect(h.queue.allowed(VELA, "run-his")).toBe(true);
    h.runs.set("run-vela-3", {
      runtimeRunId: "run-vela-3",
      label: "Vela",
      spark: VELA,
      live: true,
    });
    h.queue.onSparkLive(VELA, "run-vela-3");
    expect(h.woken).toEqual([["run-vela-3", words.sendAllowedFact("Vela", "claude·2")]]);
    expect(h.queue.allowed(VELA, "run-his")).toBe(true);
  });

  it("an allowance outlives a fieldd restart whose session re-attaches, and ends with a run that did not (critique 3)", async () => {
    const h = harness();
    await h.queue.answer(h.queue.send(VELA_FROM, "run-his", "a"), 0, principal);
    const open = h.queue.send(VELA_FROM, "run-ada-his", "b");
    expect(open).toMatch(/^ny-/);
    // fieldd restarts: no run has re-attached yet, and restore judges none
    const runs = new Map(h.runs);
    h.runs.clear();
    const again = h.make();
    expect(again.restore()).toBe(2);
    expect(again.allowed(VELA, "run-his")).toBe(true);
    expect(again.list().map((i) => i.id)).toEqual([open]);
    // the re-attach settles: run-his survived, run-ada-his did not
    for (const [k, v] of runs) h.runs.set(k, v);
    again.reconcile();
    expect(again.allowed(VELA, "run-his")).toBe(true);
    expect(again.list()).toEqual([]);
    expect(h.woken.at(-1)).toEqual(["run-vela", words.sendEndedFact("Vela", "run-ada-his")]);
    h.runs.delete("run-his");
    again.reconcile();
    expect(again.allowed(VELA, "run-his")).toBe(false);
  });

  it("reconciles once this boot's re-attach has settled, and asks no more after", () => {
    vi.useFakeTimers();
    const h = harness();
    h.queue.send(VELA_FROM, "run-gone", "a");
    let settled = false;
    const reconcile = vi.spyOn(h.queue, "reconcile");
    h.queue.reconcileWhenSettled(() => settled);
    vi.advanceTimersByTime(3_000);
    expect(reconcile).not.toHaveBeenCalled();
    expect(h.queue.list()).toHaveLength(1);
    settled = true;
    vi.advanceTimersByTime(1_000);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(h.queue.list()).toEqual([]);
    vi.advanceTimersByTime(5_000);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it("J1 · runs each settle joiner once, after its own reconcile, in the order they joined; one that throws stops none of the others (item 159, X5)", () => {
    vi.useFakeTimers();
    const h = harness();
    h.queue.send(VELA_FROM, "run-gone", "a");
    const ran: string[] = [];
    let settled = false;
    h.queue.joinSettle("inputs", () => ran.push(`inputs after ${h.queue.list().length} open`));
    h.queue.reconcileWhenSettled(() => settled);
    h.queue.joinSettle("broken", () => {
      ran.push("broken");
      throw new Error("a joiner's own fault");
    });
    h.queue.joinSettle("waker", () => ran.push("waker"));
    vi.advanceTimersByTime(3_000);
    expect(ran).toEqual([]);
    settled = true;
    vi.advanceTimersByTime(1_000);
    // the needs queue's own reconcile ran first: the held send for a gone run had ended
    expect(ran).toEqual(["inputs after 0 open", "broken", "waker"]);
    vi.advanceTimersByTime(5_000);
    expect(ran).toHaveLength(3);
    // one that joins after the settle runs at once, once
    h.queue.joinSettle("late", () => ran.push("late"));
    expect(ran.at(-1)).toBe("late");
  });
});

describe("the held spawn (CP-D7, CP3-D4 A)", () => {
  const launch = {
    agent: AGENT.id,
    profileSet: "native",
    cwd: "/Users/you/Projects/vibe-field",
    tasks: ["review the restore", "write its test"],
  };

  it("waits as an item past the cap; Allow one more starts it past the cap with its tasks, and the fact names it", async () => {
    const h = harness();
    const id = h.queue.spawn(VELA_FROM, launch, SPARK_LIVE_AGENTS_MAX);
    expect(listed(h.queue)).toEqual([
      expect.objectContaining({
        id,
        kind: "held-spawn",
        words: "review the restore",
        choices: ["Allow one more", "Not now"],
        agent: AGENT.id,
        folder: "vibe-field",
        live: 8,
      }),
    ]);
    const { item } = await h.queue.answer(id, 0, principal);
    expect(item.answer).toMatchObject({ outcome: "done", told: true });
    expect(h.spawned).toEqual([
      { agent: AGENT.id, profileSet: "native", cwd: launch.cwd, spark: VELA },
    ]);
    expect(h.queued).toEqual([
      ["run-new-1", "review the restore", "Vela"],
      ["run-new-1", "write its test", "Vela"],
    ]);
    expect(h.woken).toEqual([
      ["run-vela", words.spawnAllowedFact("Vela", AGENT.label, "run-new-1")],
    ]);
    // CO-Q9 (b): its fact is heard once run-vela confirms it took the line
    h.queue.onFactOutcome("run-vela", [id], "delivered");
    expect(readdirSync(join(h.root, "needs"))).toEqual([]);
  });

  it("Not now tells the spark `limit`, as CP-2 did", async () => {
    const h = harness();
    await h.queue.answer(h.queue.spawn(VELA_FROM, launch, 8), 1, principal);
    expect(h.spawned).toEqual([]);
    expect(h.woken).toEqual([["run-vela", words.spawnNotNowFact("Vela", SPARK_LIVE_AGENTS_MAX)]]);
  });

  it("an Allow that cannot start says why, and the spark hears it", async () => {
    const h = harness();
    h.ctl.spawn = async () => {
      throw new Error("work has no sign-in for that agent");
    };
    const { item } = await h.queue.answer(h.queue.spawn(VELA_FROM, launch, 8), 0, principal);
    expect(item.answer).toMatchObject({
      outcome: "failed",
      reason: "work has no sign-in for that agent",
    });
    expect(h.queued).toEqual([]);
    expect(h.woken).toEqual([
      ["run-vela", words.spawnFailedFact("Vela", "work has no sign-in for that agent")],
    ]);
  });

  it("two answers at once are one: the second waits for the first, and nothing starts twice (critique 5)", async () => {
    const h = harness();
    let release!: () => void;
    h.ctl.spawn = () =>
      new Promise((resolve) => {
        release = () => resolve({ runtimeRunId: "run-new-1" });
      });
    const id = h.queue.spawn(VELA_FROM, launch, 8);
    const first = h.queue.answer(id, 0, principal);
    const second = h.queue.answer(id, 0, principal);
    const other = h.queue.answer(id, 1, principal);
    await vi.waitFor(() => expect(h.spawned).toHaveLength(1));
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(b.item).toEqual(a.item);
    expect(await refusal(other)).toBe("answered");
    expect(h.spawned).toHaveLength(1);
    expect(h.woken).toHaveLength(1);
  });

  it("SP-1e2 — the held spawn keeps the crew it was asked in, across a restart; Allow one more joins that crew, made in the spark's run that asked (SPE-Q38 (a))", async () => {
    const h = harness();
    const id = h.queue.spawn(VELA_FROM, { ...launch, crew: "cr-3n8w5t1v" }, 8);
    expect(h.kept().map((record) => record.launch?.crew)).toEqual(["cr-3n8w5t1v"]);
    // the crew is no row until it is allowed: the item names no crew
    expect(JSON.stringify(listed(h.queue))).not.toContain("cr-3n8w5t1v");
    const again = h.make();
    expect(again.restore()).toBe(1);
    await again.answer(id, 0, principal);
    expect(h.spawned).toEqual([
      {
        agent: AGENT.id,
        profileSet: "native",
        cwd: launch.cwd,
        spark: VELA,
        crew: { id: "cr-3n8w5t1v", sparkRun: "run-vela" },
      },
    ]);
  });

  it("TH-1 × SP-1e2 — Allow one more into the crew it was asked in: the member joins that crew, and the answer is kept once in the asking run's transcript", async () => {
    const h = harness();
    const id = h.queue.spawn(VELA_FROM, { ...launch, crew: "cr-3n8w5t1v" }, 8);
    await h.queue.answer(id, 0, principal);
    expect(h.spawned).toEqual([
      {
        agent: AGENT.id,
        profileSet: "native",
        cwd: launch.cwd,
        spark: VELA,
        crew: { id: "cr-3n8w5t1v", sparkRun: "run-vela" },
      },
    ]);
    expect(h.acts).toEqual([[VELA, "run-vela", "answer", "Allow one more"]]);
  });
});

describe("an act a restart broke into (CP2-D2, critique 15)", () => {
  function seed(root: string, record: NeedsRecord) {
    new NeedsStore({ dir: join(root, "needs"), keyPath: join(root, "needs.key") }).write(record);
  }
  const acting = (kind: "held-send" | "held-spawn"): NeedsRecord => ({
    format: NEEDS_RECORD_FORMAT,
    item: {
      id: kind === "held-send" ? "ny-0000000000000aaa" : "ny-0000000000000bbb",
      kind,
      state: "open",
      from: { name: "Vela", session: "run-vela", spark: VELA },
      spark: VELA,
      asked: kind === "held-send" ? "2026-10-31T16:00:00.000Z" : "2026-10-31T16:00:01.000Z",
      choices: kind === "held-send" ? ["Allow", "Not now"] : ["Allow one more", "Not now"],
      ...(kind === "held-send" ? { to: { session: "run-his", name: "claude·2" } } : {}),
    },
    ...(kind === "held-send"
      ? { texts: ["run the tests"] }
      : { launch: { agent: AGENT.id, profileSet: "native", cwd: "/p", tasks: ["t"] } }),
    sender: "Vela",
    acting: { choice: 0, at: "2026-10-31T16:00:05.000Z" },
  });

  it("is never done again, and its spark is told it is uncertain", () => {
    const root = mkdtempSync(join(tmpdir(), "vf-needs-queue-"));
    seed(root, acting("held-send"));
    seed(root, acting("held-spawn"));
    const h = harness(root);
    expect(h.queue.restore()).toBe(2);
    expect(h.queue.list()).toEqual([]);
    expect(h.queue.allowed(VELA, "run-his")).toBe(false);
    h.queue.onSparkLive(VELA, "run-vela");
    expect(h.queued).toEqual([]);
    expect(h.spawned).toEqual([]);
    expect(h.woken).toEqual([
      ["run-vela", words.actUncertainFact("Vela", "claude·2")],
      ["run-vela", words.spawnUncertainFact("Vela")],
    ]);
    // a restart after that finds nothing to tell again, CO-Q9 (b): once run-vela confirms it took both facts
    h.queue.onFactOutcome("run-vela", ["ny-0000000000000aaa", "ny-0000000000000bbb"], "delivered");
    h.woken.length = 0;
    const again = h.make();
    expect(again.restore()).toBe(0);
    again.onSparkLive(VELA, "run-vela");
    expect(h.woken).toEqual([]);
  });
});

describe("item 158 — an answer is owed until its session takes it (CO-Q9 (b))", () => {
  const PUSH = 'you answered Vela\'s question "Push the fix?": Push';
  /** Vela's session `run` is live, and is her own */
  const liveAt = (h: ReturnType<typeof harness>, run: string) => {
    h.runs.set(run, { runtimeRunId: run, label: "Vela", spark: VELA, live: true });
    h.sessions.set(VELA, run);
  };
  /** A question answered Push while Vela's session is live: its fact is in run-vela's queue. */
  const answered = async (h: ReturnType<typeof harness>) => {
    const id = ask(h);
    const { item } = await h.queue.answer(id, 0, principal);
    return { id, item };
  };

  it("N1 · the record stays owed while its fact is in the queue, and goes once its session took it", async () => {
    const h = harness();
    const { id, item } = await answered(h);
    // told keeps its built meaning (§8 Q1 (b)): the fact is in the spark's input queue
    expect(item.answer?.told).toBe(true);
    expect(h.kept()).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ id }),
        owed: PUSH,
        telling: { run: "run-vela", at: expect.any(String) },
      }),
    ]);
    h.queue.onFactOutcome("run-vela", [id], "delivered");
    expect(h.kept()).toEqual([]);
  });

  it("N2 · a session that ends before its idle leaves the answer owed, and the next session hears it exactly once", async () => {
    const h = harness();
    const { id } = await answered(h);
    // Vela's session ends with the line still in its queue: the input queue drops it
    h.sleep();
    h.queue.onFactOutcome("run-vela", [id], "dropped");
    expect(h.kept()).toHaveLength(1);
    const [record] = h.kept();
    expect(record?.owed).toBe(PUSH);
    expect(record?.telling).toBeUndefined();
    // the card says "Vela hears it when it wakes: Vela's session ended before it took this" (DESIGN.md §9)
    expect(record?.item.answer).toMatchObject({
      told: false,
      waits: "Vela's session ended before it took this",
    });
    liveAt(h, "run-vela-2");
    for (let i = 0; i < 3; i += 1) h.queue.onSparkLive(VELA, "run-vela-2");
    expect(h.woken).toEqual([
      ["run-vela", PUSH],
      ["run-vela-2", PUSH],
    ]);
  });

  it("N3 · an uncertain line is never queued again", async () => {
    const h = harness();
    const { id } = await answered(h);
    expect(h.kept()).toHaveLength(1);
    h.queue.onFactOutcome("run-vela", [id], "uncertain");
    expect(h.kept()).toEqual([]);
    h.queue.onSparkLive(VELA, "run-vela");
    expect(h.woken).toEqual([["run-vela", PUSH]]);
  });

  it("N4 · repeated monitor changes queue a telling record once", async () => {
    const h = harness();
    const { id } = await answered(h);
    for (let i = 0; i < 3; i += 1) h.queue.onSparkLive(VELA, "run-vela");
    expect(h.woken).toHaveLength(1);
    expect(h.kept().map((record) => record.item.id)).toEqual([id]);
  });

  it("N5 · a boot whose kept queue lost the item owes it again; one that still carries it does not", async () => {
    const h = harness();
    const { id } = await answered(h);
    // a restart whose kept queue still carries the item (a stamped head among them): nothing is owed again
    const carried = h.make();
    expect(carried.restore()).toBe(1);
    carried.reconcileTelling((run, item) => run === "run-vela" && item === id);
    carried.onSparkLive(VELA, "run-vela");
    expect(h.woken).toHaveLength(1);
    expect(h.kept()[0]?.telling).toMatchObject({ run: "run-vela" });
    // a restart whose kept queue lost it (set aside, unkept or lost): owed again, and heard at the next live session
    const lost = h.make();
    expect(lost.restore()).toBe(1);
    lost.reconcileTelling(() => false);
    expect(h.kept()).toEqual([expect.objectContaining({ owed: PUSH })]);
    expect(h.kept()[0]?.telling).toBeUndefined();
    lost.onSparkLive(VELA, "run-vela");
    expect(h.woken).toEqual([
      ["run-vela", PUSH],
      ["run-vela", PUSH],
    ]);
  });

  it("N6 · a late outcome from a run that is not the record's telling run changes nothing", async () => {
    const h = harness();
    const { id } = await answered(h);
    h.sleep();
    h.queue.onFactOutcome("run-vela", [id], "dropped");
    liveAt(h, "run-vela-2");
    h.queue.onSparkLive(VELA, "run-vela-2");
    // run-vela's line was dropped; a late word from it is not run-vela-2's
    h.queue.onFactOutcome("run-vela", [id], "delivered");
    expect(h.kept().map((record) => record.telling?.run)).toEqual(["run-vela-2"]);
    h.queue.onFactOutcome("run-vela-2", [id], "delivered");
    expect(h.kept()).toEqual([]);
  });

  it("N7 · the fact carries its item into the queue", async () => {
    const h = harness();
    const { id } = await answered(h);
    expect(h.wokenItems).toEqual([["run-vela", id]]);
  });

  it("N8 · an answer whose session comes alive while the answer resumes it is queued once, never told 'not running yet' (the guard)", async () => {
    const h = harness();
    const id = ask(h);
    h.sleep();
    h.ctl.duringOpen = () => {
      liveAt(h, "run-vela-2");
      h.queue.onSparkLive(VELA, "run-vela-2");
    };
    const { item } = await h.queue.answer(id, 0, principal);
    expect(item.answer).toMatchObject({ told: true });
    expect(item.answer?.waits).toBeUndefined();
    expect(h.woken).toEqual([["run-vela-2", PUSH]]);
  });
});

describe("an answer whose record the disk does not take (CP2-D2)", () => {
  /** The store as the queue keeps it, its writes failing once `from` of them have been kept (the disk filled). */
  function fillsAfter(h: ReturnType<typeof harness>, from: number) {
    const store = (h.queue as unknown as { opts: { store: NeedsStore } }).opts.store;
    const write = store.write.bind(store);
    let writes = 0;
    store.write = (record) => {
      writes += 1;
      if (writes > from) throw new Error("ENOSPC: no space left on device");
      write(record);
    };
  }

  it("stands once its act is done: it leaves every window, its spark is told, and it is never done twice", async () => {
    const h = harness();
    const id = h.queue.send(VELA_FROM, "run-his", "run the tests");
    // the act's mark is kept (1); no record after it is
    fillsAfter(h, 1);
    const { item } = await h.queue.answer(id, 0, principal);
    expect(item.answer).toMatchObject({ choice: 0, outcome: "done", told: true });
    expect(h.queue.list()).toEqual([]);
    expect(h.queued).toEqual([["run-his", "run the tests", "Vela"]]);
    expect(h.woken).toEqual([["run-vela", words.sendAllowedFact("Vela", "claude·2")]]);
    // his yes stands, so the spark's next words to that run are not held
    expect(h.queue.allowed(VELA, "run-his")).toBe(true);
    // answered once: the same act again answers it as it is, another is refused, and nothing is queued again
    expect((await h.queue.answer(id, 0, principal)).item.answer).toMatchObject({ outcome: "done" });
    expect(await refusal(h.queue.answer(id, 1, principal))).toBe("answered");
    expect(h.queued).toHaveLength(1);
    // a restart finds the act begun on disk: it is never done again, its yes is gone, and its spark hears it uncertain
    const again = h.make();
    expect(again.restore()).toBe(1);
    expect(again.allowed(VELA, "run-his")).toBe(false);
    again.onSparkLive(VELA, "run-vela");
    expect(h.woken.at(-1)).toEqual(["run-vela", words.actUncertainFact("Vela", "claude·2")]);
    expect(h.queued).toHaveLength(1);
    // and, as that fact says, its later words to that run are held again: a send waits as a new item
    const held = again.send(VELA_FROM, "run-his", "and the lint");
    expect(again.list().map((each) => each.id)).toEqual([held]);
    expect(h.queued).toHaveLength(1);
  });

  it("is refused while it began no act, and its item still waits to be answered again", async () => {
    const h = harness();
    const id = ask(h);
    fillsAfter(h, 0);
    expect(await refusal(h.queue.answer(id, 0, principal))).toBe("Error");
    expect(h.queue.list().map((each) => each.id)).toEqual([id]);
    expect(h.woken).toEqual([]);
  });
});

describe("notify (CP3-D5 A)", () => {
  it("reaches every listener, its words on one line, and a seventh in a minute from one session is `limit`", async () => {
    const h = harness();
    const heard: NeedsNotice[][] = [[], []];
    h.queue.onNotice((n) => void heard[0]!.push(NeedsNotice.parse(n)));
    const off = h.queue.onNotice((n) => void heard[1]!.push(n));
    const from = { name: "claude·2", session: "run-his" };
    const notice = h.queue.notify(from, "the build\nis green");
    expect(notice).toMatchObject({ from, words: "the build is green" });
    expect(notice.id).toMatch(/^nt-/);
    off();
    for (let i = 0; i < 5; i += 1) h.queue.notify(from, `n${i}`);
    expect(await refusal(() => h.queue.notify(from, "seventh"))).toBe("limit");
    expect(heard[0]).toHaveLength(6);
    expect(heard[1]).toHaveLength(1);
    // another teller is not held back by this one
    expect(await refusal(() => h.queue.notify({ name: "Vela", session: "run-vela" }, "hi"))).toBe(
      "ok",
    );
    expect(await refusal(() => h.queue.notify(from, " \n "))).toBe("limit");
    expect(await refusal(() => h.queue.notify({ name: "x", session: "s" }, " \n "))).toBe(
      "bad-input",
    );
    expect(h.queue.list()).toEqual([]);
  });
});

describe("TH-1 — an answer you gave a spark is kept in its transcript (TH-Q27 (a))", () => {
  it("keeps the act's words in the run that asked, once, whatever its telling; asked again, nothing more", async () => {
    const h = harness();
    const id = ask(h);
    await h.queue.answer(id, 0, principal);
    await h.queue.answer(id, 0, principal);
    expect(h.acts).toEqual([[VELA, "run-vela", "answer", "Push"]]);
  });

  it("keeps nothing for an answer refused", async () => {
    const h = harness();
    const id = ask(h);
    expect(await refusal(() => h.queue.answer(id, 9, principal))).toBe("no-such-act");
    expect(h.acts).toEqual([]);
  });
});

// CP-4a2b (§13a slice 6; 13a's D2, D22) — the needs queue takes a flow run's items, as CP-D12's one queue: the runs raise
// them, each holding its run and the call it waits at, with the runs' acts and then Stop the run; the person's answer
// is handed to the runs once (they write it, keyed by its call, at most once: D22), and a run's end ends its items.
describe("CP-4a2b — a flow run's items: the runs' acts, then Stop the run; an answer handed to the runs once (§13a slice 6)", () => {
  const RUN = { run: "fr-k3v9q2m7x1", flow: "release-check", call: 3, label: "ship" };
  const GATE: FlowItemRaise = {
    kind: "flow-gate",
    run: RUN,
    name: "Release check",
    spark: VELA,
    words: "Ship the release?",
    acts: ["Ship", "Hold"],
  };
  /** N5 — a run item's row starts no changed flow, and a changed flow's row answers no run item */
  const noStart = async (): Promise<FlowItemStarted> => {
    throw new Error("this row's runs start no flow");
  };
  const noAnswer = async (): Promise<FlowItemActed> => {
    throw new Error("this row's runs hold no run item");
  };
  /** the runs' side, faked: every answer as it was handed on, and what the runs say */
  const runsActs = (acted: FlowItemActed = { outcome: "done" }) => {
    const routed: FlowItemAnswer[] = [];
    const answer = async (handed: FlowItemAnswer): Promise<FlowItemActed> => {
      routed.push(handed);
      return acted;
    };
    return { routed, acts: { answer, start: noStart } };
  };
  const files = (h: ReturnType<typeof harness>) =>
    h
      .kept()
      .map((record) => record.item.id)
      .sort();

  it("N1: a gate waits with the script's choices, then Stop the run, and Stop is handed to the runs as the run's Stop", async () => {
    const h = harness();
    const { routed, acts } = runsActs();
    h.queue.bindFlowActs(acts);
    const id = h.queue.flowItem(GATE);
    expect(listed(h.queue)).toEqual([
      expect.objectContaining({
        id,
        kind: "flow-gate",
        state: "open",
        from: { name: "Release check" },
        spark: VELA,
        words: "Ship the release?",
        choices: ["Ship", "Hold", NEEDS_CHOICE_WORDS.stopRun],
        run: RUN,
      }),
    ]);
    // kept, signed, before it is shown
    expect(files(h)).toEqual([id]);
    const { item } = await h.queue.answer(id, 2, principal);
    expect(routed).toEqual([{ id, kind: "flow-gate", run: RUN, choice: 2, stop: true }]);
    expect(NeedsItem.parse(item)).toMatchObject({
      state: "answered",
      answer: { choice: 2, outcome: "done", told: false },
    });
    expect(h.queue.list()).toEqual([]);
    // nothing is owed here: the runs tell the run's spark by their own wakes (slice 11), so nothing more is kept
    expect(files(h)).toEqual([]);
    expect(h.woken).toEqual([]);
    expect(h.acts).toEqual([]);
    // each kind's acts come first, and a run whose one act is Stop the run has that alone
    const cap = h.queue.flowItem({
      kind: "flow-cap",
      run: { ...RUN, call: 41 },
      name: "Release check",
      acts: [NEEDS_CHOICE_WORDS.allowMore],
    });
    const lost = h.queue.flowItem({
      kind: "flow-lost",
      run: { run: "fr-l0st0000aa", flow: "nightly" },
      name: "Nightly",
      words: "VibeField can't trust what Nightly kept, so it set the run aside.",
      acts: [],
    });
    const choices = new Map(h.queue.list().map((open) => [open.id, open.choices]));
    expect(choices.get(cap)).toEqual(["Allow 20 more", "Stop the run"]);
    expect(choices.get(lost)).toEqual(["Stop the run"]);
    // Stop the run is never a gate's own, and an item holds at most NEEDS_CHOICES_MAX acts before it
    expect(await refusal(() => h.queue.flowItem({ ...GATE, acts: ["Ship", "stop the run"] }))).toBe(
      "bad-input",
    );
    expect(
      await refusal(() => h.queue.flowItem({ ...GATE, acts: ["a", "b", "c", "d", "e"] })),
    ).toBe("bad-input");
    expect(await refusal(() => h.queue.flowItem({ ...GATE, acts: ["Ship", "Ship"] }))).toBe(
      "bad-input",
    );
    expect(h.queue.list()).toHaveLength(2);
  });

  it("N2: an answer is handed to the runs once: a second at once waits and is the same answer, another act is refused, and the runs' failure is its outcome", async () => {
    const h = harness();
    const routed: FlowItemAnswer[] = [];
    let finish: ((acted: FlowItemActed) => void) | undefined;
    h.queue.bindFlowActs({
      answer: (answer) => {
        routed.push(answer);
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      start: noStart,
    });
    const id = h.queue.flowItem(GATE);
    expect(listed(h.queue).map((open) => open.id)).toEqual([id]);
    const first = h.queue.answer(id, 0, principal);
    const second = h.queue.answer(id, 0, principal);
    const other = refusal(h.queue.answer(id, 1, principal));
    expect(routed).toEqual([{ id, kind: "flow-gate", run: RUN, choice: 0, stop: false }]);
    finish?.({ outcome: "done" });
    expect((await first).item.answer).toMatchObject({ choice: 0, outcome: "done" });
    expect((await second).item.answer).toMatchObject({ choice: 0, outcome: "done" });
    expect(await other).toBe("answered");
    // answered again later, the same act is the answer as it was, handed on no more
    expect((await h.queue.answer(id, 0, principal)).item.answer?.choice).toBe(0);
    expect(routed).toHaveLength(1);
    // an act the runs could not do is the item's answer, failed with their words, and never handed on again
    const refused = runsActs({ outcome: "failed", reason: "the run had ended" });
    h.queue.bindFlowActs(refused.acts);
    const next = h.queue.flowItem({ ...GATE, run: { ...RUN, call: 4 } });
    expect((await h.queue.answer(next, 1, principal)).item.answer).toMatchObject({
      choice: 1,
      outcome: "failed",
      reason: "the run had ended",
    });
    await h.queue.answer(next, 1, principal);
    expect(refused.routed).toHaveLength(1);
    // a hand-on that throws acted on nothing: the item waits on, and the next answer is handed on again
    let throws = true;
    const thrown: FlowItemAnswer[] = [];
    h.queue.bindFlowActs({
      answer: async (answer) => {
        thrown.push(answer);
        if (throws) throw new Error("the flows store could not be read");
        return { outcome: "done" };
      },
      start: noStart,
    });
    const third = h.queue.flowItem({ ...GATE, run: { ...RUN, call: 5 } });
    expect(await refusal(h.queue.answer(third, 0, principal))).toBe("Error");
    expect(h.queue.list().map((open) => open.id)).toEqual([third]);
    throws = false;
    expect((await h.queue.answer(third, 0, principal)).item.answer?.outcome).toBe("done");
    expect(thrown).toHaveLength(2);
  });

  it("N3: a run's end ends its items, and only its: each is answered as ended after, never handed on, and none is kept", async () => {
    const h = harness();
    const { routed, acts } = runsActs();
    h.queue.bindFlowActs(acts);
    const gate = h.queue.flowItem(GATE);
    const repair = h.queue.flowItem({
      kind: "flow-repair",
      run: { ...RUN, call: 5, label: "notes" },
      name: "Release check",
      spark: VELA,
      acts: [NEEDS_CHOICE_WORDS.askOnceMore],
    });
    const other = h.queue.flowItem({
      ...GATE,
      run: { run: "fr-b0b0b0b0b0", flow: "nightly", call: 1 },
    });
    expect(listed(h.queue).map((open) => open.id)).toEqual([gate, repair, other]);
    h.queue.onFlowRunEnded(RUN.run);
    expect(listed(h.queue).map((open) => open.id)).toEqual([other]);
    expect(files(h)).toEqual([other]);
    expect(await refusal(h.queue.answer(gate, 0, principal))).toBe("ended");
    expect(await refusal(h.queue.answer(repair, 1, principal))).toBe("ended");
    expect(routed).toEqual([]);
    // an agent run's end is no flow run's, even by the same id
    h.queue.onRunEnded("fr-b0b0b0b0b0");
    expect(h.queue.list().map((open) => open.id)).toEqual([other]);
  });

  it("N3b: the runs end one item alone (a gate whose call their journal already answered, found at boot): it is answered `ended` after, and an id that is no open flow item ends nothing", async () => {
    const h = harness();
    const { routed, acts } = runsActs();
    h.queue.bindFlowActs(acts);
    const gate = h.queue.flowItem(GATE);
    const later = h.queue.flowItem({ ...GATE, run: { ...RUN, call: 4 } });
    const question = ask(h);
    expect(h.queue.endFlowItem(gate)).toBe(true);
    expect(listed(h.queue).map((open) => open.id)).toEqual([later, question]);
    expect(files(h)).toEqual([later, question].sort());
    expect(await refusal(h.queue.answer(gate, 0, principal))).toBe("ended");
    // ended again, a spark's own question, or an id the queue never held: nothing changes
    expect(h.queue.endFlowItem(gate)).toBe(false);
    expect(h.queue.endFlowItem(question)).toBe(false);
    expect(h.queue.endFlowItem("ny-0000000000000000")).toBe(false);
    expect(h.queue.list().map((open) => open.id)).toEqual([later, question]);
    expect(routed).toEqual([]);
  });

  it("N4: a restart restores a run's items; the runs re-raising the same call's gate get that item, and its answer is still handed on once", async () => {
    const h = harness();
    const id = h.queue.flowItem(GATE);
    const again = h.make();
    expect(again.restore()).toBe(1);
    expect(listed(again)).toEqual([
      expect.objectContaining({
        id,
        kind: "flow-gate",
        state: "open",
        run: RUN,
        choices: ["Ship", "Hold", "Stop the run"],
      }),
    ]);
    // D2's re-bind: the same call's gate is the item the queue restored, never a second
    expect(again.flowItem(GATE)).toBe(id);
    expect(again.list()).toHaveLength(1);
    // before the runs hand over their acts, an answer is refused, retryably, and nothing is spent
    const unbound = await again.answer(id, 0, principal).then(
      () => undefined,
      (err: unknown) => err as RpcCallError,
    );
    expect(unbound).toMatchObject({ retryable: true, details: { reason: "flows-unbound" } });
    expect(again.list().map((open) => open.id)).toEqual([id]);
    const { routed, acts } = runsActs();
    again.bindFlowActs(acts);
    expect((await again.answer(id, 0, principal)).item.answer).toMatchObject({ outcome: "done" });
    expect(routed).toEqual([{ id, kind: "flow-gate", run: RUN, choice: 0, stop: false }]);
    expect(again.list()).toEqual([]);
    expect(h.make().restore()).toBe(0);
  });

  // N5 (cp-landing 03:33Z/03:43Z, VF-PM 03:33Z; CP4-Q5 (a)) — a flow changed since you approved it, or never approved,
  // asks before its run: no run yet, only its bytes. Its acts: Run this version, Run the one you approved (only while
  // one is), Not now last; See the change is the card's, drawn from `script`. A spark's flow_run that waits on it is
  // the item's teller, told what you chose by the queue's own owed fact (item 158's road); yours owes nothing.
  const CHANGED = { flow: "release-check", hash: "a".repeat(64), approved: "b".repeat(64) };
  const CHANGED_ACTS = ["Run this version", "Run the one you approved", "Not now"];
  const startsInto = (started: FlowItemStart[], result?: (n: number) => FlowItemStarted) => ({
    answer: noAnswer,
    start: async (start: FlowItemStart): Promise<FlowItemStarted> => {
      started.push(start);
      return result?.(started.length) ?? { outcome: "done", run: `fr-started${started.length}x` };
    },
  });

  it("N5: a changed flow a spark ran asks once before its run, and each act's result is told to that spark; yours tells no one", async () => {
    const h = harness();
    const started: FlowItemStart[] = [];
    h.queue.bindFlowActs(startsInto(started));
    const id = h.queue.flowChanged({ script: CHANGED, name: "Release check", from: VELA_FROM });
    expect(listed(h.queue)).toEqual([
      expect.objectContaining({
        id,
        kind: "flow-changed",
        state: "open",
        from: VELA_FROM,
        spark: VELA,
        words: "Release check",
        choices: ["Run this version", "Run the one you approved", "Not now"],
        script: CHANGED,
      }),
    ]);
    expect(h.queue.list()[0]).not.toHaveProperty("run");
    // the same spark's flow_run of the same bytes asks no second time
    expect(h.queue.flowChanged({ script: CHANGED, name: "Release check", from: VELA_FROM })).toBe(
      id,
    );
    expect(h.queue.list()).toHaveLength(1);

    // Run this version: the bytes it would run start, and the spark hears the run it started
    const { item } = await h.queue.answer(id, 0, principal);
    expect(started).toEqual([{ id, flow: "release-check", hash: CHANGED.hash }]);
    expect(item.answer).toMatchObject({ choice: 0, outcome: "done", told: true });
    expect(h.woken).toEqual([
      ["run-vela", "you ran Release check for Vela as it is now: it started as fr-started1x"],
    ]);
    expect(h.acts).toEqual([[VELA, "run-vela", "answer", "Run this version"]]);

    // Run the one you approved: the approved bytes start
    const two = h.queue.flowChanged({
      script: { ...CHANGED, hash: "c".repeat(64) },
      name: "Release check",
      from: VELA_FROM,
    });
    await h.queue.answer(two, 1, principal);
    expect(started.at(-1)).toEqual({ id: two, flow: "release-check", hash: CHANGED.approved });
    expect(h.woken.at(-1)?.[1]).toBe(
      "you ran Release check as you approved it, for Vela: it started as fr-started2x",
    );

    // Not now starts nothing, and says why it did not run
    const three = h.queue.flowChanged({
      script: { ...CHANGED, hash: "d".repeat(64) },
      name: "Release check",
      from: VELA_FROM,
    });
    expect((await h.queue.answer(three, 2, principal)).item.answer?.outcome).toBe("done");
    expect(started).toHaveLength(2);
    expect(h.woken.at(-1)?.[1]).toBe(
      "you said Not now to Vela's run of Release check: it changed since you approved it, so it did not run",
    );
    // a flow never approved: no Run the one you approved, and Not now says it was never approved
    const fresh = h.queue.flowChanged({
      script: { flow: "nightly", hash: "e".repeat(64) },
      name: "Nightly",
      from: VELA_FROM,
    });
    expect(h.queue.list().find((open) => open.id === fresh)?.choices).toEqual([
      "Run this version",
      "Not now",
    ]);
    await h.queue.answer(fresh, 1, principal);
    expect(h.woken.at(-1)?.[1]).toBe(
      "you said Not now to Vela's run of Nightly: you haven't approved it, so it did not run",
    );

    // the runs could not start it: failed with their words, and the spark is told so
    h.queue.bindFlowActs(
      startsInto(started, () => ({ outcome: "failed", reason: "the folder is gone" })),
    );
    const four = h.queue.flowChanged({
      script: { ...CHANGED, hash: "f".repeat(64) },
      name: "Release check",
      from: VELA_FROM,
    });
    expect((await h.queue.answer(four, 0, principal)).item.answer).toMatchObject({
      outcome: "failed",
      reason: "the folder is gone",
    });
    expect(h.woken.at(-1)?.[1]).toBe(
      "the run of Release check you allowed Vela could not start: the folder is gone",
    );

    // yours: the item names the flow, no spark; it is answered, and no one is told, and nothing stays kept
    h.queue.bindFlowActs(startsInto(started));
    const heard = h.woken.length;
    const yours = h.queue.flowChanged({
      script: { flow: "nightly-sweep", hash: "1".repeat(64), approved: "2".repeat(64) },
      name: "Nightly sweep",
    });
    const mine = listed(h.queue).find((open) => open.id === yours);
    expect(mine).toMatchObject({ from: { name: "Nightly sweep" }, choices: CHANGED_ACTS });
    expect(mine).not.toHaveProperty("spark");
    expect(mine).not.toHaveProperty("words");
    expect((await h.queue.answer(yours, 0, principal)).item.answer).toMatchObject({
      outcome: "done",
      told: false,
    });
    expect(started.at(-1)).toEqual({ id: yours, flow: "nightly-sweep", hash: "1".repeat(64) });
    expect(h.woken).toHaveLength(heard);
    expect(h.kept().some((record) => record.item.id === yours)).toBe(false);
  });

  it("N5b (D): a restart that broke into a changed flow's start never starts it again: answered uncertain, its spark told; a start before the runs bind is refused, nothing begun", async () => {
    const h = harness();
    const id = h.queue.flowChanged({ script: CHANGED, name: "Release check", from: VELA_FROM });
    const yours = h.queue.flowChanged({
      script: { flow: "nightly-sweep", hash: "1".repeat(64) },
      name: "Nightly sweep",
    });
    // before the runs bind: refused retryably, and no act is begun
    expect(await refusal(h.queue.answer(id, 0, principal))).toBe("flows-unbound");
    expect(h.kept().find((record) => record.item.id === id)?.acting).toBeUndefined();
    // the runs take the start and never answer before the restart: each act is kept begun
    h.queue.bindFlowActs({ answer: noAnswer, start: () => new Promise<FlowItemStarted>(() => {}) });
    void h.queue.answer(id, 0, principal);
    void h.queue.answer(yours, 0, principal);
    expect(h.kept().filter((record) => record.acting !== undefined)).toHaveLength(2);

    const again = h.make();
    const started: FlowItemStart[] = [];
    again.bindFlowActs(startsInto(started));
    // the spark's is kept owed; yours, owing no one, is kept no more
    expect(again.restore()).toBe(1);
    expect(again.list()).toEqual([]);
    expect(files(h)).toEqual([id]);
    for (const asked of [id, yours]) {
      const { item } = await again.answer(asked, 0, principal);
      expect(item.answer).toMatchObject({ outcome: "failed", reason: words.UNCERTAIN_REASON });
    }
    expect(started).toEqual([]);
    // the spark hears it once its session is live
    again.onSparkLive(VELA, "run-vela");
    expect(h.woken.at(-1)).toEqual([
      "run-vela",
      "VibeField restarted, and cannot tell whether the run of Release check you allowed Vela started; list Vela's flows to see",
    ]);
  });
});
