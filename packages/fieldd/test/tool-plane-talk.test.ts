import { describe, expect, it } from "vitest";
import type { RpcCallError } from "../src/native-link";
import {
  createTalkVerbs,
  SPARK_LIVE_AGENTS_MAX,
  type TalkCaller,
  type TalkSession,
} from "../src/tool-plane/rooms/talk/verbs";

// CP-2 — the talk room (`draft/compose-plane/cp2-talk-room.md`, ruled 2026-10-31): who a spark may reach (CP-D5, CP-D6),
// held at every call to its Agent Profiles (CP-L4), the cap (CP-D7 as the fact `limit`, CP2-D5), and spawn's tasks
// queued for the agent's first idle moment. fieldd's services are faked; the queue and the waker have their own files.

const VELA: TalkCaller = {
  sparkId: "sp-vela00000000000",
  name: "Vela",
  runtimeRunId: "run-vela",
  profiles: ["native"],
  folder: "/f/sparks/vela",
  thinksUnder: "native",
};
const ORIN = "sp-orin00000000000";

const SESSIONS: TalkSession[] = [
  { runtimeRunId: "run-vela", spark: VELA.sparkId, origin: { by: "you" }, live: true },
  { runtimeRunId: "run-his", origin: { by: "you" }, live: true },
  { runtimeRunId: "run-work", profileSet: "work", origin: { by: "you" }, live: true },
  { runtimeRunId: "run-old", live: false },
  { runtimeRunId: "run-ada", origin: { by: "spark", spark: VELA.sparkId }, live: true },
  { runtimeRunId: "run-orin", spark: ORIN, origin: { by: "you" }, live: true },
  { runtimeRunId: "run-orin-agent", origin: { by: "spark", spark: ORIN }, live: true },
];

function harness(extra: TalkSession[] = [], stopAccepted = true) {
  const sessions = [...SESSIONS, ...extra];
  const queued: { run: string; text: string; from: string }[] = [];
  const spawned: unknown[] = [];
  const watched: string[] = [];
  const stopped: string[] = [];
  const ended: string[] = [];
  const verbs = createTalkVerbs({
    session: (run) => sessions.find((s) => s.runtimeRunId === run),
    sessions: () => sessions,
    spawn: async (launch, spark) => {
      spawned.push({ ...launch, spark });
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
  });
  return { verbs, queued, spawned, watched, stopped, ended };
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
    const h = harness();
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
      { agent: "claude", profileSet: "native", cwd: "/f/sparks/vela", spark: VELA.sparkId },
    ]);
    expect(h.queued.map((q) => q.text)).toEqual(["read the README", "run the tests"]);
    expect(await fact(h.verbs.agent_spawn(VELA, { agent: "claude", profile: "work" }))).toBe(
      "outside",
    );
  });

  it("refuses a spawn past the cap of live agents as the fact `limit` (CP2-D5)", async () => {
    const many: TalkSession[] = Array.from({ length: SPARK_LIVE_AGENTS_MAX - 1 }, (_, i) => ({
      runtimeRunId: `run-live-${i}`,
      origin: { by: "spark", spark: VELA.sparkId },
      live: true,
    }));
    // run-ada is the eighth
    const h = harness(many);
    expect(await fact(h.verbs.agent_spawn(VELA, { agent: "claude" }))).toBe("limit");
    expect(h.spawned).toEqual([]);
  });
});
