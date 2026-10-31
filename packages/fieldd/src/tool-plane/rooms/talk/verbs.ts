import type {
  AgentModelSelection,
  ComposeAgentInterruptOutput,
  ComposeAgentSendInput,
  ComposeAgentSendOutput,
  ComposeAgentSessionInput,
  ComposeAgentSpawnInput,
  ComposeAgentSpawnOutput,
  ComposeAgentStopOutput,
  ComposeAgentWatchOutput,
  SparkId,
} from "@vibefield/contracts";
import { RpcCallError } from "../../../native-link";

// CP-2 — the talk room, with the agents room's start and the watch family beside it (`draft/compose-plane/
// cp2-talk-room.md`, ruled 2026-10-31 03:49:24Z: CP2-D1…D7 on their leans). A spark starts runs one level deep
// (TL-D2), watches them and talks to them through the session's one input queue (CP-L5). No call blocks: a send is
// queued and lands at the session's next idle moment, marked as the spark's and sent on the person's behalf (CP2-D1);
// an interrupt is the one way past the queue, and counts as his (CO-D7). Who may reach what (CP-D5, CP-D6) and the cap
// (CP-D7) are held here at every call; the audience a row is served to is the plane's (index.ts). fieldd's services
// answer through TalkDeps, so nothing here imports puppeteer (R29).

/** CP-D7 — the most live agents one spark may have started. */
export const SPARK_LIVE_AGENTS_MAX = 8;

/** A session as the talk room sees it (the runtime's rows and records, adapted in daemon.ts). */
export interface TalkSession {
  readonly runtimeRunId: string;
  /** the profile set it is filed under (absent: This Mac's) */
  readonly profileSet?: string | undefined;
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

/** fieldd's own services, as the room needs them (daemon.ts adapts the real ones). */
export interface TalkDeps {
  session(runtimeRunId: string): TalkSession | undefined;
  sessions(): readonly TalkSession[];
  /** start an agent for a spark: origin `spark` on its record, the spark named (CP-D15) */
  spawn(
    launch: {
      readonly agent: string;
      readonly profileSet: string;
      readonly cwd: string;
      readonly model?: AgentModelSelection | undefined;
    },
    spark: SparkId,
  ): Promise<{ runtimeRunId: string }>;
  /** queue words for a session (CP-L5); their place in its queue, 1 being next */
  enqueue(runtimeRunId: string, text: string, from: TalkSender): { position: number };
  /** the run's own turn stop (agent.interrupt): accepted means delivered, never that the turn ended */
  interrupt(runtimeRunId: string): Promise<{ accepted: boolean; reason?: string | undefined }>;
  /** end a run through the floor's ladder, as the person's Stop does */
  end(runtimeRunId: string): Promise<void>;
  /** be woken by a session, or stop being woken (the spawner is woken by its own runs without asking) */
  watch(spark: SparkId, runtimeRunId: string, on: boolean): void;
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

/** The profile a session belongs to: its set, or This Mac's when it names none. */
const NATIVE = "native";
const profileOf = (session: TalkSession): string => session.profileSet ?? NATIVE;

/** A refusal the model reads as the tool's own answer, with its fact (index.ts reads `details.fact`). */
const refuse = (fact: string, message: string, kind = "PRECONDITION_FAILED") =>
  new RpcCallError(kind, message, false, { fact });

export function createTalkVerbs(deps: TalkDeps): TalkVerbs {
  /** The session a call names, in the caller's profiles (CP-L4), or the fact that says why not. */
  const reach = (caller: TalkCaller, runtimeRunId: string): TalkSession => {
    const session = deps.session(runtimeRunId);
    if (session === undefined) throw refuse("not-found", `no session ${runtimeRunId}`, "NOT_FOUND");
    if (!caller.profiles.includes(profileOf(session)))
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

  return {
    async agent_spawn(caller, input) {
      const profileSet = input.profile ?? caller.thinksUnder;
      if (!caller.profiles.includes(profileSet))
        throw refuse(
          "outside",
          `${profileSet} is not one of your Agent Profiles`,
          "FORBIDDEN_SCOPE",
        );
      // CP-D7 (CP2-D5 A): past the cap the spawn is refused as the fact `limit`; the needs-you card comes with CP-3
      const alive = deps.sessions().filter((s) => s.live && startedBy(s, caller)).length;
      if (alive >= SPARK_LIVE_AGENTS_MAX)
        throw refuse(
          "limit",
          `you have ${alive} live agents, the most a spark may run; end one first`,
        );
      const { runtimeRunId } = await deps.spawn(
        {
          agent: input.agent,
          profileSet,
          cwd: input.cwd ?? caller.folder,
          ...(input.model !== undefined ? { model: input.model } : {}),
        },
        caller.sparkId,
      );
      // fieldd's spawn takes no first prompt: each task waits in the agent's queue for its first idle moment
      const tasks = input.tasks ?? [];
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
}
