import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_CATALOG,
  NEEDS_RECORD_FORMAT,
  NEEDS_WORDS_MAX,
  NeedsItem,
  NeedsNotice,
  type NeedsRecord,
  type SparkRecord,
  type SparkSummary,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcCallError } from "../src/native-link";
import type { GrantPrincipal } from "../src/terminal-grants";
import { SPARK_LIVE_AGENTS_MAX } from "../src/tool-plane/rooms/talk/verbs";
import { NeedsQueue, type NeedsRun } from "../src/tool-plane/rooms/you/queue";
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
  const queued: [string, string, string][] = [];
  const spawned: unknown[] = [];
  const opened: string[] = [];
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
        wake: (run, fact) => void woken.push([run, fact]),
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
      spawn: async (launch, spark) => {
        spawned.push({ ...launch, spark });
        return ctl.spawn();
      },
      agentLabel: (agent) => AGENT_CATALOG.find((e) => e.id === agent)?.label,
      now: () => {
        clock += 1000;
        return new Date(clock);
      },
    });
  const queue = make();
  const changes: number[] = [];
  queue.onChange((items) => void changes.push(items.length));
  return {
    root,
    queue,
    make,
    woken,
    queued,
    spawned,
    opened,
    runs,
    sessions,
    sparks,
    ctl,
    sleep,
    changes,
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
    expect(one.item.answer).toMatchObject({ outcome: "failed", reason: "claude·2 ended" });
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
      reason: "claude·4 is in none of Vela's Agent Profiles",
    });
    expect(h.queued).toEqual([]);
    expect(h.woken.map(([, fact]) => fact)).toEqual([
      words.sendFailedFact("Vela", "claude·3", "work is not one of Vela's Agent Profiles"),
      words.sendFailedFact("Vela", "claude·4", "claude·4 is in none of Vela's Agent Profiles"),
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
    // a restart after that finds nothing to tell again
    h.woken.length = 0;
    const again = h.make();
    expect(again.restore()).toBe(0);
    again.onSparkLive(VELA, "run-vela");
    expect(h.woken).toEqual([]);
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
