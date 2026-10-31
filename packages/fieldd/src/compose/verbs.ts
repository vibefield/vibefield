import type {
  AgentModelsResult,
  AgentProfileSet,
  AgentSessionSummary,
  ComposeAgentReadInput,
  ComposeAgentsAvailableOutput,
  ComposeAgentsListInput,
  ComposeAgentsListOutput,
  ComposeHistoryHit,
  ComposeHistoryReadInput,
  ComposeHistorySearchInput,
  ComposeHistorySearchOutput,
  ComposeModel,
  ComposeProject,
  ComposeProjectsListOutput,
  ComposeReadOutput,
  ComposeSession,
  ComposeTurn,
  IndexSearchResult,
  IndexTimelineResult,
  SparkRecord,
} from "@vibefield/contracts";
import { COMPOSE_VERB_SCHEMAS } from "@vibefield/contracts";
import { RpcCallError } from "../native-link";

// CP-1b — the six read verbs a spark is served first (the compose plane, version 2; compose.ts's COMPOSE_VERB_SCHEMAS).
// Each is held to the spark's Agent Profiles (TL-D5, NS-D5): it lists, reads and searches only what those profiles
// hold. fieldd's own services answer them through VerbDeps, so nothing here imports puppeteer or rosetta (wall R29) and
// nothing reads a vendor's transcript. They change nothing; the audit line around each call is the caller's (index.ts).

/** The profile a run belongs to: its set, or This Mac's when it names none. */
const NATIVE = "native";
const profileOf = (row: { profileSet?: string | undefined }): string => row.profileSet ?? NATIVE;

/** A read's bounds: what a turn may carry, and the page asked of the index for each turn kept. */
const TURN_TEXT_MAX = 4000;
const TURNS_DEFAULT = 4;
const SEARCH_DEFAULT = 20;
const MODELS_WAIT_MS = 4000;

/** fieldd's own services, as the verbs need them (daemon.ts adapts the real ones). */
export interface VerbDeps {
  /** Agent Profiles and their sign-ins (`agents.profiles.sets()`). */
  profileSets(): Promise<readonly AgentProfileSet[]>;
  /** The catalog's label for an agent (AC-D4). */
  agentLabel(provider: string): string | undefined;
  /** An agent's models under a profile (`agents.models`, 0.2–3.2 s, held 60 s). */
  models(provider: string, profileSet: string): Promise<AgentModelsResult>;
  /** This desktop's runs (`agents.list()`): managed, pending and exited. */
  runs(): readonly AgentSessionSummary[];
  /** What Godview's row knows of a run that the fold's row does not: its spend in US dollars and its effort. */
  runFacts(runtimeRunId: string): { readonly usd?: number; readonly effort?: string } | undefined;
  /** This desktop's projects and their folders (the projects service, read as the person's own window reads it). */
  projects(): readonly ComposeProject[];
  /** The index's id for a run's conversation, by its native id; undefined when the index has not read it. */
  indexSessionFor(nativeSessionId: string): Promise<string | undefined>;
  /** The persona a History session was filed under (`index.session`), to hold history_read to the profiles. */
  indexSessionProfile(sessionId: string): Promise<{ profileId?: string | undefined }>;
  /** One backward page of a session's timeline: the newest rows first asked, `cursor` for older. */
  timeline(
    sessionId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<IndexTimelineResult>;
  /** One search, held to one runtime (rosetta's `runtime` filter). */
  search(
    query: string,
    runtimeId: string,
    limit: number,
    afterMs: number | undefined,
  ): Promise<IndexSearchResult>;
}

export interface ComposeVerbs {
  agents_available(spark: SparkRecord, input: unknown): Promise<ComposeAgentsAvailableOutput>;
  projects_list(spark: SparkRecord, input: unknown): Promise<ComposeProjectsListOutput>;
  agents_list(spark: SparkRecord, input: ComposeAgentsListInput): Promise<ComposeAgentsListOutput>;
  agent_read(spark: SparkRecord, input: ComposeAgentReadInput): Promise<ComposeReadOutput>;
  history_search(
    spark: SparkRecord,
    input: ComposeHistorySearchInput,
  ): Promise<ComposeHistorySearchOutput>;
  history_read(spark: SparkRecord, input: ComposeHistoryReadInput): Promise<ComposeReadOutput>;
}

/** The verbs built so far: exactly the ones compose.ts gives schemas. */
export type ComposeVerbName = keyof typeof COMPOSE_VERB_SCHEMAS;
export const isComposeVerb = (name: string): name is ComposeVerbName =>
  Object.hasOwn(COMPOSE_VERB_SCHEMAS, name);

/** Run a built verb on input its own schema has already parsed (the one place the union is widened). */
export function runVerb(
  verbs: ComposeVerbs,
  name: ComposeVerbName,
  spark: SparkRecord,
  input: unknown,
) {
  return (verbs[name] as (spark: SparkRecord, input: unknown) => Promise<unknown>)(spark, input);
}

/** A refusal the model reads as the tool's own answer (never a protocol error). */
const outside = (what: string) =>
  new RpcCallError("FORBIDDEN_SCOPE", `${what} is outside your Agent Profiles`, false);

export function createComposeVerbs(deps: VerbDeps): ComposeVerbs {
  const inScope = (spark: SparkRecord, profile: string) => spark.profiles.includes(profile);
  const scopedSets = async (spark: SparkRecord) =>
    (await deps.profileSets()).filter((set) => inScope(spark, set.id));

  /** The runtimes History reads under a spark's profiles: one per signed-in persona that has one. */
  const runtimes = async (spark: SparkRecord, agent: string | undefined) =>
    (await scopedSets(spark)).flatMap((set) =>
      set.personas
        .filter((p) => p.runtimeId !== undefined && (agent === undefined || p.provider === agent))
        .map((p) => ({ runtimeId: p.runtimeId as string, profile: set.id, provider: p.provider })),
    );

  const stateOf = (row: AgentSessionSummary): string => {
    if (row.continuation?.exited) return "ended";
    if (row.status === "blocked") {
      const failed = row.monitor?.blockers.some((b) => /fail|error|crash/i.test(b.kind));
      return failed ? "failed" : "asking";
    }
    return row.status;
  };

  const session = (row: AgentSessionSummary): ComposeSession => {
    const blocker = row.monitor?.blockers[0];
    const facts = deps.runFacts(row.runtimeRunId);
    return {
      id: row.runtimeRunId,
      agent: row.kind,
      ...(row.title ? { title: row.title } : {}),
      state: stateOf(row),
      ...(stateOf(row) === "asking" && blocker ? { asking: blocker.kind } : {}),
      folder: row.monitor?.environment?.cwd ?? row.workspace?.root ?? "",
      profile: profileOf(row),
      ...(row.monitor?.model?.id ? { model: row.monitor.model.id } : {}),
      ...(facts?.effort ? { effort: facts.effort } : {}),
      ...(facts?.usd !== undefined ? { usd: facts.usd } : {}),
      startedAt: row.createdAt,
      ...(row.origin ? { origin: row.origin } : {}),
      ...(row.spark ? { spark: row.spark } : {}),
    };
  };

  /** A run the spark may read: on this desktop, under its profiles. */
  const scopedRun = (spark: SparkRecord, id: string): AgentSessionSummary => {
    const row = deps.runs().find((r) => r.runtimeRunId === id && r.tier !== "remote");
    if (!row)
      throw new RpcCallError("NOT_FOUND", `no session ${id}; agents_list names them`, false);
    if (!inScope(spark, profileOf(row))) throw outside(`session ${id}`);
    return row;
  };

  /** A page of a conversation as turns: what was asked and what was answered, oldest first, each bounded. */
  const turnsOf = (page: IndexTimelineResult, keep: number): ComposeReadOutput => {
    const turns: ComposeTurn[] = page.entries
      .filter((e) => (e.kind === "user" || e.kind === "agent") && (e.text ?? "").trim().length > 0)
      .sort((a, b) => a.ordinal - b.ordinal)
      .slice(-keep)
      .map((e) => {
        const text = e.text ?? "";
        const cut = text.length > TURN_TEXT_MAX || e.textClipped === true;
        return {
          who: e.kind,
          text: text.slice(0, TURN_TEXT_MAX),
          ...(e.at !== undefined ? { at: e.at } : {}),
          ...(cut ? { cut: true } : {}),
        };
      });
    return {
      session: page.sessionId,
      turns,
      ...(page.nextCursor ? { before: page.nextCursor } : {}),
    };
  };

  const read = async (sessionId: string, before: string | undefined, turns: number | undefined) => {
    const keep = turns ?? TURNS_DEFAULT;
    // tool rows, thoughts and notices sit between the turns: ask for several rows per turn kept
    return turnsOf(await deps.timeline(sessionId, before, Math.min(keep * 8, 200)), keep);
  };

  return {
    async agents_available(spark) {
      const sets = await scopedSets(spark);
      const offers = sets.flatMap((set) =>
        [
          ...new Set(
            set.personas.filter((p) => p.identity?.loggedIn === true).map((p) => p.provider),
          ),
        ].map((provider) => ({ set, provider })),
      );
      const agents = await Promise.all(
        offers.map(async ({ set, provider }) => {
          const label = deps.agentLabel(provider) ?? provider;
          const asked = deps.models(provider, set.id).then(
            (r) => r,
            () => undefined,
          );
          const answer = await Promise.race([
            asked,
            new Promise<undefined>((r) => setTimeout(() => r(undefined), MODELS_WAIT_MS).unref?.()),
          ]);
          const models: ComposeModel[] = (answer?.catalog?.models ?? []).map((m) => {
            const effort = m.controls.find((c) => c.role === "effort");
            return {
              id: m.id,
              label: m.label,
              ...(effort ? { efforts: effort.values.map((v) => v.id) } : {}),
            };
          });
          return {
            agent: provider,
            label,
            profile: set.id,
            profileName: set.label,
            models,
            ...(models.length === 0
              ? { modelsNote: `${label} could not list its models just now.` }
              : {}),
          };
        }),
      );
      return { agents };
    },

    async projects_list() {
      return { projects: [...deps.projects()] };
    },

    async agents_list(spark, input) {
      const sessions = deps
        .runs()
        .filter((r) => r.tier !== "remote" && inScope(spark, profileOf(r)))
        .filter((r) => input.ended === true || !r.continuation?.exited)
        .map(session);
      return { sessions };
    },

    async agent_read(spark, input) {
      const row = scopedRun(spark, input.session);
      const indexId = await deps.indexSessionFor(row.sessionId);
      if (!indexId) return { session: input.session, turns: [] };
      const out = await read(indexId, input.before, input.turns);
      return { ...out, session: input.session };
    },

    async history_search(spark, input) {
      const under = await runtimes(spark, input.agent);
      const limit = input.limit ?? SEARCH_DEFAULT;
      const afterMs = input.since !== undefined ? Date.parse(input.since) : undefined;
      if (afterMs !== undefined && Number.isNaN(afterMs))
        throw new RpcCallError("PRECONDITION_FAILED", "since is an ISO date or time", false);
      // rosetta filters by one runtime per request: one search per runtime under the profiles, merged by time
      // (scores are per index and never merged, DS-6's rule).
      const answers = await Promise.all(
        under.map(async (rt) => ({
          rt,
          result: await deps.search(input.query, rt.runtimeId, limit, afterMs),
        })),
      );
      const hits: ComposeHistoryHit[] = answers
        .flatMap(({ rt, result }) =>
          result.hits.map((h) => ({
            session: h.rootSessionId ?? h.sessionId,
            ...(h.title ? { title: h.title } : {}),
            agent: h.provider ?? rt.provider,
            profile: rt.profile,
            ...(h.cwd ? { folder: h.cwd } : {}),
            ...(h.at !== undefined ? { at: h.at } : {}),
            snippet: h.snippet,
          })),
        )
        .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
        .slice(0, limit);
      const unanswered = answers.filter((a) => !a.result.answered).length;
      return {
        answered: under.length === 0 || unanswered < answers.length,
        hits,
        ...(under.length === 0
          ? { note: "No History is filed under your profiles yet." }
          : unanswered > 0
            ? {
                note: `History could not answer for ${unanswered} of ${answers.length} sign-ins just now.`,
              }
            : {}),
      };
    },

    async history_read(spark, input) {
      const { profileId } = await deps.indexSessionProfile(input.session);
      const sets = await deps.profileSets();
      const filedUnder =
        sets.find((set) => set.personas.some((p) => p.profileId === profileId))?.id ??
        (profileId === undefined ? NATIVE : undefined);
      if (filedUnder === undefined || !inScope(spark, filedUnder))
        throw outside(`session ${input.session}`);
      return read(input.session, input.before, input.turns);
    },
  };
}
