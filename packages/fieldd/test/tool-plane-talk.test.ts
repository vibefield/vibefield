import type { CrewId } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import type { RpcCallError } from "../src/native-link";
import {
  createTalkVerbs,
  type HeldLaunch,
  type HoldSender,
  SPARK_LIVE_AGENTS_MAX,
  type TalkCaller,
  type TalkSession,
} from "../src/tool-plane/rooms/talk/verbs";

// CP-2 — the talk room (`draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31): who a spark may reach (CP-D5, CP-D6),
// held at every call to its Agent Profiles (CP-L4), the cap (CP-D7), and spawn's tasks queued for the agent's first idle
// moment. CP-3 (`draft/compose-plane/cp3-the-person.md`, ruled 2026-10-31) holds a spark's first send into the person's
// session (CP3-D3 B) and a spawn past the cap (CP3-D4 A) in the needs-you queue. TU-1 (Q3) places every session it
// reaches by the one rule (`profileSetOfRun`). SP-1e2 — each spawn joins the crew the room names for the spark's own
// run, and every call keeps that crew open until it answers (SPE-Q29 (a)). fieldd's services are faked; the queue, the
// waker, the needs-you queue and the crews have their own files.

const VELA: TalkCaller = {
  sparkId: "sp-vela00000000000",
  name: "Vela",
  runtimeRunId: "run-vela",
  profiles: ["native"],
  folder: "/f/sparks/vela",
  thinksUnder: "native",
};
const ORIN = "sp-orin00000000000";
/** A spark of Work alone (TU-1). */
const WREN: TalkCaller = {
  sparkId: "sp-wren00000000000",
  name: "Wren",
  runtimeRunId: "run-wren",
  profiles: ["work"],
  folder: "/f/sparks/wren",
  thinksUnder: "work",
};
/** The monitor's persona map: Work lists the Claude sign-in `work-claude`. */
const PERSONAS: ReadonlyMap<string, string> = new Map([["work-claude", "work"]]);

const SESSIONS: TalkSession[] = [
  { runtimeRunId: "run-vela", spark: VELA.sparkId, origin: { by: "you" }, live: true },
  { runtimeRunId: "run-his", origin: { by: "you" }, live: true },
  { runtimeRunId: "run-work", profileSet: "work", origin: { by: "you" }, live: true },
  { runtimeRunId: "run-old", live: false },
  { runtimeRunId: "run-ada", origin: { by: "spark", spark: VELA.sparkId }, live: true },
  { runtimeRunId: "run-orin", spark: ORIN, origin: { by: "you" }, live: true },
  { runtimeRunId: "run-orin-agent", origin: { by: "spark", spark: ORIN }, live: true },
  // TU-1: filed under none, its persona listed by Work; filed and persona both; a persona no profile lists
  { runtimeRunId: "run-persona", profileId: "work-claude", origin: { by: "you" }, live: true },
  {
    runtimeRunId: "run-filed",
    profileSet: "work",
    profileId: "work-claude",
    origin: { by: "you" },
    live: true,
  },
  { runtimeRunId: "run-orphan", profileId: "gone-claude", origin: { by: "you" }, live: true },
];

function harness(
  extra: TalkSession[] = [],
  stopAccepted = true,
  allowed: string[] = [],
  personaSets: ReadonlyMap<string, string> | null = PERSONAS,
) {
  const sessions = [...SESSIONS, ...extra];
  const queued: { run: string; text: string; from: string }[] = [];
  const heldSends: { from: HoldSender; run: string; text: string }[] = [];
  const heldSpawns: { from: HoldSender; launch: HeldLaunch; live: number }[] = [];
  const spawned: unknown[] = [];
  const watched: string[] = [];
  const stopped: string[] = [];
  const ended: string[] = [];
  /** SP-1e2 — what the room asked the crews, and how many of its calls were in flight at each spawn */
  const crewLog: string[] = [];
  const busyAtSpawn: number[] = [];
  let inFlight = 0;
  const verbs = createTalkVerbs({
    session: (run) => sessions.find((s) => s.runtimeRunId === run),
    sessions: () => sessions,
    personaSets: () => personaSets,
    spawn: async (launch, spark, crew) => {
      busyAtSpawn.push(inFlight);
      spawned.push({ ...launch, spark, ...(crew !== undefined ? { crew } : {}) });
      const runtimeRunId = `run-new-${spawned.length}`;
      sessions.push({ runtimeRunId, origin: { by: "spark", spark }, live: true });
      return { runtimeRunId };
    },
    enqueue: (run, text, from) => {
      queued.push({ run, text, from: from.name });
      return { position: queued.filter((q) => q.run === run).length };
    },
    interrupt: async (run) => {
      stopped.push(run);
      return stopAccepted ? { accepted: true } : { accepted: false, reason: "no-terminal-host" };
    },
    end: async (run) => {
      ended.push(run);
    },
    watch: (spark, run, on) => watched.push(`${on ? "+" : "-"}${spark}:${run}`),
    holds: {
      allowed: (spark, run) => allowed.includes(`${spark}:${run}`),
      send: (from, run, text) => {
        heldSends.push({ from, run, text });
        return "ny-held0send";
      },
      spawn: (from, launch, live) => {
        heldSpawns.push({ from, launch, live });
        return "ny-held0spawn";
      },
    },
    crews: {
      busy: (spark) => {
        inFlight++;
        crewLog.push(`busy ${spark}`);
        return () => {
          inFlight--;
          crewLog.push(`done ${spark}`);
        };
      },
      join: (spark, sparkRun) => {
        crewLog.push(`join ${spark} ${sparkRun}`);
        return "cr-000001" as CrewId;
      },
    },
  });
  return {
    verbs,
    queued,
    spawned,
    watched,
    stopped,
    ended,
    heldSends,
    heldSpawns,
    crewLog,
    busyAtSpawn,
    inFlight: () => inFlight,
  };
}

/** A call's answer, or the fact its refusal names. */
const fact = async (call: Promise<unknown>) => {
  try {
    await call;
    return "ok";
  } catch (err) {
    return ((err as RpcCallError).details as { fact?: string } | undefined)?.fact ?? "thrown";
  }
};

describe("the talk room's reach (CP-D5, CP-D6, CP-L4)", () => {
  it("sends to his sessions and its own agents, and to no other spark nor another spark's agents", async () => {
    const h = harness([], true, [`${VELA.sparkId}:run-his`]);
    expect(await h.verbs.agent_send(VELA, { session: "run-his", text: "hi" })).toEqual({
      session: "run-his",
      queued: true,
      position: 1,
    });
    expect(await fact(h.verbs.agent_send(VELA, { session: "run-ada", text: "go" }))).toBe("ok");
    expect(await fact(h.verbs.agent_send(VELA, { session: "run-orin", text: "x" }))).toBe(
      "forbidden",
    );
    expect(await fact(h.verbs.agent_send(VELA, { session: "run-orin-agent", text: "x" }))).toBe(
      "forbidden",
    );
    expect(await fact(h.verbs.agent_send(VELA, { session: "run-work", text: "x" }))).toBe(
      "outside",
    );
    expect(await fact(h.verbs.agent_send(VELA, { session: "run-old", text: "x" }))).toBe(
      "unavailable",
    );
    expect(await fact(h.verbs.agent_send(VELA, { session: "run-vela", text: "x" }))).toBe(
      "bad-input",
    );
    expect(await fact(h.verbs.agent_send(VELA, { session: "run-none", text: "x" }))).toBe(
      "not-found",
    );
    expect(h.queued).toEqual([
      { run: "run-his", text: "hi", from: "Vela" },
      { run: "run-ada", text: "go", from: "Vela" },
    ]);
  });

  it("interrupts any session in scope but a spark's own, and says when the stop could not be sent", async () => {
    const h = harness();
    expect(await h.verbs.agent_interrupt(VELA, { session: "run-his" })).toEqual({
      session: "run-his",
      sent: true,
    });
    expect(await fact(h.verbs.agent_interrupt(VELA, { session: "run-orin-agent" }))).toBe("ok");
    expect(await fact(h.verbs.agent_interrupt(VELA, { session: "run-orin" }))).toBe("forbidden");
    expect(h.stopped).toEqual(["run-his", "run-orin-agent"]);
    const refused = harness([], false);
    expect(await fact(refused.verbs.agent_interrupt(VELA, { session: "run-his" }))).toBe(
      "unavailable",
    );
  });

  it("ends only the agents it started", async () => {
    const h = harness();
    expect(await h.verbs.agent_stop(VELA, { session: "run-ada" })).toEqual({
      session: "run-ada",
      ending: true,
    });
    expect(await fact(h.verbs.agent_stop(VELA, { session: "run-his" }))).toBe("forbidden");
    expect(await fact(h.verbs.agent_stop(VELA, { session: "run-orin-agent" }))).toBe("forbidden");
    expect(h.ended).toEqual(["run-ada"]);
  });

  it("watches a session it did not start, and is woken by its own agents without asking", async () => {
    const h = harness();
    expect(await h.verbs.agent_watch(VELA, { session: "run-his" })).toEqual({
      session: "run-his",
      watching: true,
    });
    expect(await h.verbs.agent_unwatch(VELA, { session: "run-his" })).toEqual({
      session: "run-his",
      watching: false,
    });
    expect(await h.verbs.agent_watch(VELA, { session: "run-ada" })).toEqual({
      session: "run-ada",
      watching: true,
    });
    expect(await h.verbs.agent_unwatch(VELA, { session: "run-ada" })).toEqual({
      session: "run-ada",
      watching: true,
    });
    expect(h.watched).toEqual([
      `+${VELA.sparkId}:run-his`,
      `-${VELA.sparkId}:run-his`,
      `-${VELA.sparkId}:run-ada`,
    ]);
  });
});

describe("the person's holds on a send (CP-D3, CP3-D3 B)", () => {
  it("holds the first send into his session in the needs-you queue, and queues it once he allowed it", async () => {
    const h = harness();
    expect(await h.verbs.agent_send(VELA, { session: "run-his", text: "run the tests" })).toEqual({
      session: "run-his",
      queued: false,
      held: "ny-held0send",
    });
    expect(h.heldSends).toEqual([
      {
        from: { spark: VELA.sparkId, name: "Vela", session: "run-vela" },
        run: "run-his",
        text: "run the tests",
      },
    ]);
    expect(h.queued).toEqual([]);
    const allowed = harness([], true, [`${VELA.sparkId}:run-his`]);
    expect(await allowed.verbs.agent_send(VELA, { session: "run-his", text: "and again" })).toEqual(
      { session: "run-his", queued: true, position: 1 },
    );
    expect(allowed.heldSends).toEqual([]);
  });

  it("never holds a send to its own agents: they ask the person themselves (TL-D2 A)", async () => {
    const h = harness();
    expect(await h.verbs.agent_send(VELA, { session: "run-ada", text: "go" })).toEqual({
      session: "run-ada",
      queued: true,
      position: 1,
    });
    expect(h.heldSends).toEqual([]);
  });

  it("holds nothing it would refuse: a send that is forbidden, outside or to a stopped session is refused first", async () => {
    const h = harness();
    expect(await fact(h.verbs.agent_send(VELA, { session: "run-orin", text: "x" }))).toBe(
      "forbidden",
    );
    expect(await fact(h.verbs.agent_send(VELA, { session: "run-work", text: "x" }))).toBe(
      "outside",
    );
    expect(await fact(h.verbs.agent_send(VELA, { session: "run-old", text: "x" }))).toBe(
      "unavailable",
    );
    expect(h.heldSends).toEqual([]);
  });
});

describe("the talk room's start (TL-D2, CP-D7)", () => {
  it("starts an agent under the profile it thinks under, in its folder, with each task queued in order", async () => {
    const h = harness();
    expect(
      await h.verbs.agent_spawn(VELA, {
        agent: "claude",
        tasks: ["read the README", "run the tests"],
      }),
    ).toEqual({ session: "run-new-1", queued: 2 });
    expect(h.spawned).toEqual([
      {
        agent: "claude",
        profileSet: "native",
        cwd: "/f/sparks/vela",
        spark: VELA.sparkId,
        crew: { id: "cr-000001", sparkRun: "run-vela" },
      },
    ]);
    expect(h.queued.map((q) => q.text)).toEqual(["read the README", "run the tests"]);
    expect(await fact(h.verbs.agent_spawn(VELA, { agent: "claude", profile: "work" }))).toBe(
      "outside",
    );
  });

  it("holds a spawn past the cap of live agents in the needs-you queue (CP3-D4 A)", async () => {
    const many: TalkSession[] = Array.from({ length: SPARK_LIVE_AGENTS_MAX - 1 }, (_, i) => ({
      runtimeRunId: `run-live-${i}`,
      origin: { by: "spark", spark: VELA.sparkId },
      live: true,
    }));
    // run-ada is the eighth
    const h = harness(many);
    expect(
      await h.verbs.agent_spawn(VELA, { agent: "claude", cwd: "/p/vibe-field", tasks: ["review"] }),
    ).toEqual({ held: "ny-held0spawn", queued: 1 });
    expect(h.spawned).toEqual([]);
    expect(h.queued).toEqual([]);
    expect(h.heldSpawns).toEqual([
      {
        from: { spark: VELA.sparkId, name: "Vela", session: "run-vela" },
        launch: {
          agent: "claude",
          profileSet: "native",
          cwd: "/p/vibe-field",
          tasks: ["review"],
          crew: "cr-000001",
        },
        live: SPARK_LIVE_AGENTS_MAX,
      },
    ]);
  });

  it("SP-1e2 — a spawn joins the crew the room names for the spark's own run; every call keeps that crew open until it answers, refused or not (SPE-Q29 (a))", async () => {
    const h = harness();
    await h.verbs.agent_spawn(VELA, { agent: "claude", tasks: ["read the README"] });
    // the call was in flight while its agent started
    expect(h.busyAtSpawn).toEqual([1]);
    expect(h.inFlight()).toBe(0);
    // a refused spawn joins no crew; a refused send and a watch answer too
    expect(await fact(h.verbs.agent_spawn(VELA, { agent: "claude", profile: "work" }))).toBe(
      "outside",
    );
    expect(await fact(h.verbs.agent_send(VELA, { session: "run-orin", text: "x" }))).not.toBe("ok");
    await h.verbs.agent_watch(VELA, { session: "run-his" });
    expect(h.inFlight()).toBe(0);
    const v = VELA.sparkId;
    expect(h.crewLog).toEqual([
      `busy ${v}`,
      `join ${v} run-vela`,
      `done ${v}`,
      `busy ${v}`,
      `done ${v}`,
      `busy ${v}`,
      `done ${v}`,
      `busy ${v}`,
      `done ${v}`,
    ]);
  });
});

describe("one rule places a session in an Agent Profile (TU-1, Q3)", () => {
  /** Who reaches a session: each spark's answer to a send, `ok` when it is reached (sent or held). */
  const reach = async (h: ReturnType<typeof harness>, session: string) => ({
    vela: await fact(h.verbs.agent_send(VELA, { session, text: "x" })),
    wren: await fact(h.verbs.agent_send(WREN, { session, text: "x" })),
  });

  it("places a session filed under none by the profile listing its persona: Work's sparks reach it, This Mac's do not", async () => {
    const h = harness();
    expect(await reach(h, "run-persona")).toEqual({ vela: "outside", wren: "ok" });
    expect(h.heldSends.map((held) => `${held.from.name}:${held.run}`)).toEqual([
      "Wren:run-persona",
    ]);
  });

  it("a filed set is its profile, a persona no profile lists is in none, and a session naming neither is This Mac's", async () => {
    const h = harness();
    expect(await reach(h, "run-filed")).toEqual({ vela: "outside", wren: "ok" });
    expect(await reach(h, "run-orphan")).toEqual({ vela: "outside", wren: "outside" });
    expect(await reach(h, "run-his")).toEqual({ vela: "ok", wren: "outside" });
  });

  it("fails closed until the profiles are read (§12 Q1 (a′)): a persona's session filed under none is not placed yet, retryably; filed and persona-less sessions stand", async () => {
    const h = harness([], true, [], null);
    expect(await reach(h, "run-persona")).toEqual({ vela: "unavailable", wren: "unavailable" });
    await expect(
      h.verbs.agent_send(WREN, { session: "run-persona", text: "x" }),
    ).rejects.toMatchObject({ kind: "UNAVAILABLE", retryable: true });
    expect(h.heldSends).toEqual([]);
    expect(await reach(h, "run-filed")).toEqual({ vela: "outside", wren: "ok" });
    expect(await reach(h, "run-his")).toEqual({ vela: "ok", wren: "outside" });
  });
});
