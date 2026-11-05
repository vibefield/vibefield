import {
  type AgentModelSelection,
  type AgentProfileSetId,
  type ComposeAgentInterruptOutput,
  type ComposeAgentSendInput,
  type ComposeAgentSendOutput,
  type ComposeAgentSessionInput,
  type ComposeAgentSpawnInput,
  type ComposeAgentSpawnOutput,
  type ComposeAgentStopOutput,
  type ComposeAgentWatchOutput,
  type CrewId,
  type NeedsHeldLaunch,
  type NeedsItemId,
  profileSetOfRun,
  type SparkId,
} from "@vibefield/contracts";
import { RpcCallError } from "../../../native-link";

// CP-2 — the talk room, with the agents room's start and the watch family beside it (`draft/compose-plane/
// cp2-talk-room.md`, ruled 2026-10-31 03:49:24Z: CP2-D1…D7 on their leans). A spark starts runs one level deep
// (TL-D2), watches them and talks to them through the session's one input queue (CP-L5). No call blocks: a send is
// queued and lands at the session's next idle moment, marked as the spark's and sent on the person's behalf (CP2-D1);
// an interrupt is the one way past the queue, and counts as his (CO-D7). Who may reach what (CP-D5, CP-D6) and the cap
// (CP-D7) are held here at every call; the audience a row is served to is the plane's (index.ts). fieldd's services
// answer through TalkDeps, so nothing here imports puppeteer (R29).
// CP-3 (`draft/compose-plane/cp3-the-person.md`, ruled 2026-10-31) adds the person's two holds, both in the needs-you
// queue (rooms/you/): a spark's first send into a session the person started waits for his OK, which lasts for that
// run (CP-D3, CP3-D3 B); and past the cap a spawn waits for his Allow one more (CP-D7, CP3-D4 A). Each answers at once
// with the item it waits in, never a refusal, and the answer is a wake (CP-L5).
// TU-1 (Q3) — a session is in the caller's profiles by the one rule every reader shares (`profileSetOfRun`, over the
// persona map fieldd's monitor holds): filed, else This Mac's with no persona, else its persona's, else none. Until
// the monitor's first frame a persona's session filed under none is not placed yet: refused `unavailable`, retryably,
// never `outside`, so the spark asks again (§12 Q1 (a′), as the door and the Allow wait).

/** CP-D7 — the most live agents one spark may have started. */
export const SPARK_LIVE_AGENTS_MAX = 8;

/** A session as the talk room sees it (the runtime's rows and records, adapted in daemon.ts). */
export interface TalkSession {
  readonly runtimeRunId: string;
  /** the Agent Profile it is filed under; `profileSetOfRun` places it */
  readonly profileSet?: string | undefined;
  /** its persona, which places it when it is filed under none */
  readonly profileId?: string | undefined;
  /** CP-D15: who started it; `spark` names the spark whose agent_spawn did */
  readonly origin?: { readonly by: string; readonly spark?: SparkId | undefined } | undefined;
  /** CP-1c: the spark this session is the own session of */
  readonly spark?: SparkId | undefined;
  /** live under this daemon: it can take input, a stop or an end */
  readonly live: boolean;
}

/** Who sent a queued input: the spark, by id and by the name its words are marked with (CP2-D1). */
export interface TalkSender {
  readonly spark: SparkId;
  readonly name: string;
}

/** Who a held act is from: the sender, and its own session, which the item names as the asker's. */
export interface HoldSender extends TalkSender {
  readonly session: string;
}

/** A spawn after its defaults, and its tasks: what Allow one more starts, as the needs-you record keeps it, and the
 * crew it was asked in (SP-1e2), which Allow one more joins. */
export type HeldLaunch = Readonly<
  Pick<NeedsHeldLaunch, "agent" | "profileSet" | "cwd" | "model" | "tasks" | "crew">
>;

/** SP-1e2 — the crew a spawn joins, and the spark's own run it was asked in (the crew's `sparkRun`). */
export interface SpawnCrew {
  readonly id: CrewId;
  readonly sparkRun: string;
}

/** SP-1e2 — the spark's crews, as the room asks them (tool-plane/crews.ts answers). */
export interface TalkCrews {
  /** a talk call of this spark's is in flight until the answer is called: its crew stays open meanwhile (SPE-Q29 (a)) */
  busy(spark: SparkId): () => void;
  /** the crew this spark's spawn joins: its open crew in its own run `sparkRun`, else a new one (SPE-Q3 = RU-6) */
  join(spark: SparkId, sparkRun: string): CrewId;
}

/** CP-3 — the needs-you queue's holds, as the room asks them (rooms/you/queue.ts answers). */
export interface TalkHolds {
  /** the person said Allow to this spark's words to this run (CP3-D3 B): its later words are not held */
  allowed(spark: SparkId, runtimeRunId: string): boolean;
  /** hold words for the person's OK; the item they wait in (words held for the same run join it) */
  send(from: HoldSender, runtimeRunId: string, text: string): NeedsItemId;
  /** hold a spawn past the cap for the person's OK (CP3-D4 A); `live` is how many the spark runs */
  spawn(from: HoldSender, launch: HeldLaunch, live: number): NeedsItemId;
}

/** fieldd's own services, as the room needs them (daemon.ts adapts the real ones). */
export interface TalkDeps {
  session(runtimeRunId: string): TalkSession | undefined;
  sessions(): readonly TalkSession[];
  /** TU-1 — each persona to the profile listing it (the monitor's latest frame); null until fieldd has read one */
  personaSets(): ReadonlyMap<string, AgentProfileSetId> | null;
  /** start an agent for a spark: origin `spark` on its record, the spark named (CP-D15), and the crew it joins
   * (SP-1e2; absent for a held spawn kept before SP-1e2) */
  spawn(
    launch: {
      readonly agent: string;
      readonly profileSet: string;
      readonly cwd: string;
      readonly model?: AgentModelSelection | undefined;
    },
    spark: SparkId,
    crew?: SpawnCrew,
  ): Promise<{ runtimeRunId: string }>;
  /** queue words for a session (CP-L5); their place in its queue, 1 being next */
  enqueue(runtimeRunId: string, text: string, from: TalkSender): { position: number };
  /** the run's own turn stop (agent.interrupt): accepted means delivered, never that the turn ended */
  interrupt(runtimeRunId: string): Promise<{ accepted: boolean; reason?: string | undefined }>;
  /** end a run through the floor's ladder, as the person's Stop does */
  end(runtimeRunId: string): Promise<void>;
  /** be woken by a session, or stop being woken (the spawner is woken by its own runs without asking) */
  watch(spark: SparkId, runtimeRunId: string, on: boolean): void;
  /** CP-3 — the person's holds. Required: CP-2's unheld send must not survive by default. */
  readonly holds: TalkHolds;
  /** SP-1e2 — the spark's crews. Required: a spawn joins one. */
  readonly crews: TalkCrews;
}

/** Who a talk verb answers: a settled spark (the door's caller, with its record's facts). */
export interface TalkCaller {
  readonly sparkId: SparkId;
  readonly name: string;
  /** the spark's own session */
  readonly runtimeRunId: string;
  readonly profiles: readonly string[];
  /** where it lives, and so where its agents start unless it says otherwise */
  readonly folder: string;
  readonly thinksUnder: string;
}

export interface TalkVerbs {
  agent_spawn(caller: TalkCaller, input: ComposeAgentSpawnInput): Promise<ComposeAgentSpawnOutput>;
  agent_watch(
    caller: TalkCaller,
    input: ComposeAgentSessionInput,
  ): Promise<ComposeAgentWatchOutput>;
  agent_unwatch(
    caller: TalkCaller,
    input: ComposeAgentSessionInput,
  ): Promise<ComposeAgentWatchOutput>;
  agent_send(caller: TalkCaller, input: ComposeAgentSendInput): Promise<ComposeAgentSendOutput>;
  agent_interrupt(
    caller: TalkCaller,
    input: ComposeAgentSessionInput,
  ): Promise<ComposeAgentInterruptOutput>;
  agent_stop(caller: TalkCaller, input: ComposeAgentSessionInput): Promise<ComposeAgentStopOutput>;
}

export type TalkVerbName = keyof TalkVerbs;
const TALK_VERBS: readonly TalkVerbName[] = [
  "agent_spawn",
  "agent_watch",
  "agent_unwatch",
  "agent_send",
  "agent_interrupt",
  "agent_stop",
];
export const isTalkVerb = (name: string): name is TalkVerbName =>
  (TALK_VERBS as readonly string[]).includes(name);

/** Run a talk verb on input its own schema has already parsed (the one place the union is widened). */
export function runTalk(verbs: TalkVerbs, name: TalkVerbName, caller: TalkCaller, input: unknown) {
  return (verbs[name] as (caller: TalkCaller, input: unknown) => Promise<unknown>)(caller, input);
}

/** A refusal the model reads as the tool's own answer, with its fact (index.ts reads `details.fact`). */
const refuse = (fact: string, message: string, kind = "PRECONDITION_FAILED") =>
  new RpcCallError(kind, message, false, { fact });

export function createTalkVerbs(deps: TalkDeps): TalkVerbs {
  /** The session a call names, in the caller's profiles (CP-L4), or the fact that says why not. */
  const reach = (caller: TalkCaller, runtimeRunId: string): TalkSession => {
    const session = deps.session(runtimeRunId);
    if (session === undefined) throw refuse("not-found", `no session ${runtimeRunId}`, "NOT_FOUND");
    const personaSets = deps.personaSets();
    const profile = profileSetOfRun(session, personaSets);
    if (profile === undefined && personaSets === null)
      throw new RpcCallError(
        "UNAVAILABLE",
        `VibeField hasn't read the Agent Profiles yet, so ${runtimeRunId} is not placed; try again in a moment`,
        true,
        { fact: "unavailable" },
      );
    if (profile === undefined || !caller.profiles.includes(profile))
      throw refuse("outside", `${runtimeRunId} is outside your Agent Profiles`, "FORBIDDEN_SCOPE");
    if (session.runtimeRunId === caller.runtimeRunId)
      throw refuse("bad-input", "that session is your own");
    return session;
  };
  /** A run this spark started (CP-D15's origin). */
  const startedBy = (session: TalkSession, caller: TalkCaller) =>
    session.origin?.by === "spark" && session.origin.spark === caller.sparkId;
  /** His own session: started by him, and not a spark's own session. */
  const his = (session: TalkSession) =>
    session.spark === undefined && (session.origin?.by ?? "you") === "you";
  const live = (session: TalkSession) => {
    if (!session.live)
      throw refuse("unavailable", `${session.runtimeRunId} is not running`, "UNAVAILABLE");
  };
  const senderOf = (caller: TalkCaller): HoldSender => ({
    spark: caller.sparkId,
    name: caller.name,
    session: caller.runtimeRunId,
  });

  const verbs: TalkVerbs = {
    async agent_spawn(caller, input) {
      const profileSet = input.profile ?? caller.thinksUnder;
      if (!caller.profiles.includes(profileSet))
        throw refuse(
          "outside",
          `${profileSet} is not one of your Agent Profiles`,
          "FORBIDDEN_SCOPE",
        );
      const launch = {
        agent: input.agent,
        profileSet,
        cwd: input.cwd ?? caller.folder,
        ...(input.model !== undefined ? { model: input.model } : {}),
      };
      const tasks = input.tasks ?? [];
      // SP-1e2 (SPE-Q3 = RU-6): every spawn of this stretch of the spark's own run joins one crew, a held one too
      // (SPE-Q38 (a): it is no row until Allow one more starts it, into this crew even after the crew closed)
      const crew = {
        id: deps.crews.join(caller.sparkId, caller.runtimeRunId),
        sparkRun: caller.runtimeRunId,
      };
      // CP-D7 (CP3-D4 A): past the cap the spawn waits in the needs-you queue; Allow one more starts it, and Not now
      // tells the spark `limit`, as CP-2 refused it
      const alive = deps.sessions().filter((s) => s.live && startedBy(s, caller)).length;
      if (alive >= SPARK_LIVE_AGENTS_MAX) {
        const held = deps.holds.spawn(senderOf(caller), { ...launch, tasks, crew: crew.id }, alive);
        return { held, queued: tasks.length };
      }
      const { runtimeRunId } = await deps.spawn(launch, caller.sparkId, crew);
      // fieldd's spawn takes no first prompt: each task waits in the agent's queue for its first idle moment
      for (const task of tasks)
        deps.enqueue(runtimeRunId, task, { spark: caller.sparkId, name: caller.name });
      return { session: runtimeRunId, queued: tasks.length };
    },

    async agent_watch(caller, input) {
      const session = reach(caller, input.session);
      // its own runs wake it already (CP-D4); another's are watched on asking (CP-D6)
      if (!startedBy(session, caller)) deps.watch(caller.sparkId, session.runtimeRunId, true);
      return { session: session.runtimeRunId, watching: true };
    },

    async agent_unwatch(caller, input) {
      const session = reach(caller, input.session);
      deps.watch(caller.sparkId, session.runtimeRunId, false);
      return { session: session.runtimeRunId, watching: startedBy(session, caller) };
    },

    async agent_send(caller, input) {
      const session = reach(caller, input.session);
      // CP-D6: his sessions or its own; CP-D5: never another spark, nor another spark's agents
      if (!his(session) && !startedBy(session, caller))
        throw refuse("forbidden", `you may send only to the user's sessions or your own agents`);
      live(session);
      // CP-D3 (CP3-D3 B, until a session's approvals posture is a fact fieldd reads in no vendor's words): the first
      // send into a session the person started waits for his OK, and his yes lasts for that run; its own agents ask
      // the person themselves (TL-D2 A), so a send to them is never held
      if (his(session) && !deps.holds.allowed(caller.sparkId, session.runtimeRunId)) {
        const held = deps.holds.send(senderOf(caller), session.runtimeRunId, input.text);
        return { session: session.runtimeRunId, queued: false, held };
      }
      const { position } = deps.enqueue(session.runtimeRunId, input.text, {
        spark: caller.sparkId,
        name: caller.name,
      });
      return { session: session.runtimeRunId, queued: true, position };
    },

    async agent_interrupt(caller, input) {
      const session = reach(caller, input.session);
      // CP-D6: any session in scope; CP-D5: never a spark's own session
      if (session.spark !== undefined) throw refuse("forbidden", "sparks never stop sparks");
      live(session);
      const result = await deps.interrupt(session.runtimeRunId);
      if (!result.accepted)
        throw refuse(
          "unavailable",
          `the stop could not be sent (${result.reason ?? "refused"})`,
          "UNAVAILABLE",
        );
      return { session: session.runtimeRunId, sent: true };
    },

    async agent_stop(caller, input) {
      const session = reach(caller, input.session);
      // CP-D6: it ends only its own
      if (!startedBy(session, caller))
        throw refuse("forbidden", "you may end only the agents you started");
      live(session);
      await deps.end(session.runtimeRunId);
      return { session: session.runtimeRunId, ending: true };
    },
  };
  /** SP-1e2 (SPE-Q29 (a)) — a call of the spark's is in flight until it answers, refused or not: the spark's run
   * reads idle a moment inside a call, and that idle must not close its crew. */
  const kept =
    <I, O>(verb: (caller: TalkCaller, input: I) => Promise<O>) =>
    async (caller: TalkCaller, input: I): Promise<O> => {
      const done = deps.crews.busy(caller.sparkId);
      try {
        return await verb(caller, input);
      } finally {
        done();
      }
    };
  return {
    agent_spawn: kept(verbs.agent_spawn),
    agent_watch: kept(verbs.agent_watch),
    agent_unwatch: kept(verbs.agent_unwatch),
    agent_send: kept(verbs.agent_send),
    agent_interrupt: kept(verbs.agent_interrupt),
    agent_stop: kept(verbs.agent_stop),
  };
}
