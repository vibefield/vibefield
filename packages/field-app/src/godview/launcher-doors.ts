import type {
  LauncherAgent,
  LauncherHistoryStatus,
  LauncherOutcome,
  LauncherPort,
  LauncherReadiness,
  LauncherSession,
  LauncherWordHit,
} from "@vibecook/puppeteer-views/launcher";
import {
  AGENT_OFFERED_STATUSES,
  AGENT_VISIBLE_STATUSES,
  type AgentProfileSet,
  type AgentProviderSummary,
  AgentSpawnResult,
  IndexRecentResult,
  type IndexRecentSession,
  IndexSearchResult,
  IndexStatus,
} from "@vibefield/contracts";
import {
  AnswerLostError,
  type KeyedCallClient,
  outcomeUnknownKey,
  requestResolvingOutcome,
} from "../forwarded-call";
import { NATIVE_PROFILE } from "./monitor/profile-tabs";

// THE EMPTY PANE LAUNCHER'S PORT (QL-1, thinking-ql-empty-pane-launcher.md),
// over fieldd's doors. Pure adapters, like `monitor/doors.ts`: the launcher
// (`@vibecook/puppeteer-views/launcher`) asks in its own shapes, and this file
// answers from VibeField's contracts — `index.recent` for the list,
// `index.search` for the words lane, `agent.spawn` and `agent.resume`'s native
// form for the two verbs. Where the answer lands (the pane, the shell it
// replaces) is the deck's, handed in as `place`; nothing here holds a runtime
// or a workspace. No agent id is compared to a literal (R23b): a provider is
// an opaque string the rows carry and the doors take back.

/** The one call shape the port needs: a request through the deck's client
 * (the FielddClient itself — DS-D15: the key a resolved retry echoes rides
 * its third argument). */
export interface LauncherDoorClient extends KeyedCallClient {
  request(
    method: string,
    params: Record<string, unknown>,
    opts?: { idempotencyKey?: string | undefined },
  ): Promise<unknown>;
}

export interface LauncherPortDeps {
  client: LauncherDoorClient;
  /** The latest `agent.providers` rows, read at call time: whether a past
   * session's agent can resume it here is the row's `resumable`. */
  providers(): readonly AgentProviderSummary[];
  /** SB-3 — the Agent Profile a pane's shell was born under, by that shell's
   * session id (fieldd's record, the pool's): a launch there runs under it
   * (QL-D3 as revised). Undefined for a shell under none. */
  profileSetOf?(sessionId: string): string | undefined;
  /** SB-3 — the Agent Profiles as the feed last had them, for the refusal
   * clauses' names ("Work has no Codex sign-in"). */
  profileSets?(): readonly Pick<AgentProfileSet, "id" | "label">[];
  /**
   * Hand a born terminal (the spawn's or the resume's create ticket) to the
   * launcher's own pane (`paneId`), in place of `replacing`, the fresh shell
   * the launcher sat on (QL-D8). The deck's: it adopts the ticket and mounts
   * through its serialized door.
   */
  place(terminal: unknown, where: { paneId: string; replacing: string }): Promise<LauncherOutcome>;
}

/** What a row says when it has no title: the design's own words (§22). */
export const UNTITLED_SESSION = "untitled session";

/** Why ↵ is withheld on a row whose folder is gone from this device (§22). */
export const FOLDER_GONE = "folder is gone";

/** Why an agent cannot launch in a pane whose profile holds no sign-in for it
 * (SB-3, DESIGN §8): the launcher prints "Codex can’t launch: no sign-in". */
export const NO_SIGN_IN = "no sign-in";

/* ── the agents (QL-D6, QL-D3 as revised 2026-09-28) ──────────────────── */

const within = (statuses: readonly string[], status: string): boolean => statuses.includes(status);

/** Whether a door row can start a session at all: its status admits new
 * sessions (a row with no status decides nothing, and so offers what it always
 * did) and it does not deny `spawn`. The same reading the retired picker made;
 * the contract's own status lists, never a second one. */
export function agentStartsSessions(
  provider: Pick<AgentProviderSummary, "status" | "offers">,
): boolean {
  if (provider.status !== undefined && !within(AGENT_OFFERED_STATUSES, provider.status)) {
    return false;
  }
  return provider.offers?.spawn !== false;
}

/** Whether a door row may be SHOWN: a status a surface shows, or none. A word
 * this build never heard of is not offered, so it is not listed either. */
function agentVisible(provider: Pick<AgentProviderSummary, "status">): boolean {
  return provider.status === undefined || within(AGENT_VISIBLE_STATUSES, provider.status);
}

/**
 * The profile a launch runs under, as the preview line names it (QL-D3 as
 * revised): a launch sends NO profile, so fieldd resolves it as puppeteer
 * resolves any spawn that names none — the default Agent Profile's sign-in for
 * the agent, else the agent's own folder. So the line names the default
 * profile only where that is what will run: the row claims personas, and the
 * default profile is This Mac or holds a sign-in for this agent. Everywhere
 * else it says "its defaults", which is exactly as much as the deck knows.
 */
export function launchPreview(
  provider: Pick<AgentProviderSummary, "label" | "offers" | "personas">,
  profileSets: readonly Pick<AgentProfileSet, "id" | "label" | "default">[],
): string {
  const fallback = `${provider.label} · its defaults`;
  if (provider.offers?.personas !== true) return fallback;
  const chosen = profileSets.find((set) => set.default);
  if (chosen === undefined) return fallback;
  const signedIn =
    chosen.id === NATIVE_PROFILE || provider.personas.some((persona) => persona.set === chosen.id);
  return signedIn ? `${provider.label} · ${chosen.label}` : fallback;
}

/**
 * The launcher's agents: the door's rows that can start a session, in the
 * door's own order (the catalog's — the launcher re-orders by
 * `lastLaunchedAt`), each with its label, its last launch, why it cannot
 * launch (an agent not installed on this device is listed and says so), and
 * the preview line.
 *
 * `under` is the Agent Profile a pane's shell was born under (SB-3): a launch
 * there runs under it, so the preview names it (`Claude Code · Work`), and an
 * agent a managed profile holds no sign-in for is `no sign-in` — puppeteer
 * would refuse it, and the launcher says so before anyone asks. This Mac (the
 * native set) is every agent's own folder: every agent launches there as it
 * does today.
 */
export function launcherAgents(
  providers: readonly AgentProviderSummary[],
  profileSets: readonly Pick<AgentProfileSet, "id" | "label" | "default">[] = [],
  under?: Pick<AgentProfileSet, "label" | "kind" | "personas">,
): LauncherAgent[] {
  return providers
    .filter((provider) => agentVisible(provider) && agentStartsSessions(provider))
    .map((provider) => {
      const noSignIn =
        under?.kind === "managed" &&
        !under.personas.some((persona) => persona.provider === provider.id);
      return {
        providerId: provider.id,
        label: provider.label,
        ...(provider.lastLaunchedAt !== undefined
          ? { lastLaunchedAt: provider.lastLaunchedAt }
          : {}),
        ...(!provider.available
          ? { unavailable: "not installed" }
          : noSignIn
            ? { unavailable: NO_SIGN_IN }
            : {}),
        preview:
          under === undefined
            ? launchPreview(provider, profileSets)
            : `${provider.label} · ${under.label}`,
      };
    });
}

/* ── the list: index.recent → LauncherSession ─────────────────────────── */

/** Why ↵ is withheld on a row, or undefined when it resumes. The door's
 * `resumable` already folds the catalog's `offers.resume` in (AC-3). */
function unresumable(
  row: Pick<IndexRecentSession, "provider" | "nativeSessionId" | "cwdExists">,
  providers: readonly AgentProviderSummary[],
): string | undefined {
  if (row.provider === undefined || row.nativeSessionId === "") return "can’t resume";
  const provider = providers.find((candidate) => candidate.id === row.provider);
  if (provider === undefined || !agentVisible(provider)) return "not offered here";
  if (!provider.resumable) return "can’t resume";
  // fieldd's own answer (a resume there is refused `missing-cwd`); before the
  // install, which a person can fix — a gone folder they cannot, from here
  if (row.cwdExists === false) return FOLDER_GONE;
  if (!provider.available) return "not installed";
  return undefined;
}

function titleOf(row: Pick<IndexRecentSession, "title" | "summary">): string {
  for (const candidate of [row.title, row.summary]) {
    const text = candidate?.trim();
    if (text) return text;
  }
  return UNTITLED_SESSION;
}

/** One `index.recent` row as the launcher lists it. */
export function launcherSession(
  row: IndexRecentSession,
  providers: readonly AgentProviderSummary[],
): LauncherSession {
  const why = unresumable(row, providers);
  const lastAt = row.activity?.lastAt ?? row.updatedAt;
  return {
    key: row.sessionId,
    ...(row.provider !== undefined ? { providerId: row.provider } : {}),
    ...(row.nativeSessionId !== "" ? { nativeSessionId: row.nativeSessionId } : {}),
    title: titleOf(row),
    ...(row.cwd !== undefined && row.cwd !== "" ? { cwd: row.cwd } : {}),
    here: row.here,
    ...(lastAt !== undefined ? { lastAt } : {}),
    resumable: why === undefined,
    ...(why !== undefined ? { unresumable: why } : {}),
  };
}

/** A refusal fieldd expressed by throwing, read structurally (the deck holds
 * its client through a door, so `instanceof` would be a claim about a wrapper). */
interface DoorRefusal {
  kind?: unknown;
  message?: unknown;
  details?: Record<string, unknown> | undefined;
}

function refusalOf(cause: unknown): DoorRefusal {
  return typeof cause === "object" && cause !== null ? (cause as DoorRefusal) : {};
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error && cause.message) return cause.message;
  const message = refusalOf(cause).message;
  return typeof message === "string" && message !== "" ? message : String(cause);
}

/**
 * The index's state, as the launcher's readiness. `UNAVAILABLE {service:
 * "index", state}` carries rosettad's phase: coming up is `building` (the
 * rows arrive when it is ready — a rebuild of a projection of another schema
 * too, DEBTS), a daemon that failed or answered what fieldd
 * cannot read is `failed`, and a daemon that is stopped, unconfigured or not
 * reachable at all is `unreachable`.
 */
export function historyStatusFromRefusal(cause: unknown): LauncherHistoryStatus {
  const refusal = refusalOf(cause);
  const detail = messageOf(cause);
  const state = refusal.details?.["state"];
  if (refusal.kind === "UNAVAILABLE" && typeof state === "string") {
    if (state === "starting" || state === "restarting" || state === "rebuilding")
      return { readiness: "building", detail };
    if (state === "failed" || state === "malformed") return { readiness: "failed", detail };
  }
  return { readiness: "unreachable", detail };
}

const SEARCH_READINESS = new Set<LauncherReadiness>([
  "ready",
  "building",
  "catching-up",
  "stale",
  "failed",
]);

/** The words lane's readiness beside a list the door DID answer: the rows are
 * whatever the index holds now, and `index.status` says whether it is still
 * reading (catching up · n of m). A status that cannot be read says nothing —
 * the list answered, so the history is not "unreachable". */
async function searchStatus(client: LauncherDoorClient): Promise<LauncherHistoryStatus> {
  try {
    const search = IndexStatus.parse(await client.request("index.status", {})).search;
    const word = search?.readiness;
    if (word === undefined || !SEARCH_READINESS.has(word as LauncherReadiness)) {
      return { readiness: "ready" };
    }
    const readiness = word as LauncherReadiness;
    // `failed` here is the SEARCH projection's: the list still answered.
    if (readiness === "failed") return { readiness: "stale", detail: "search is unavailable" };
    return {
      readiness,
      ...(search?.progress ? { progress: search.progress } : {}),
      ...(search?.detail ? { detail: search.detail } : {}),
    };
  } catch {
    return { readiness: "ready" };
  }
}

/* ── the verbs' refusals ──────────────────────────────────────────────── */

/** SB-3 — what a launch in a bound pane named: the pane's profile and the
 * agent, as a person reads them (the feed's label, the catalog's). */
export interface LaunchUnder {
  set: string;
  agent: string;
}

/**
 * fieldd's refusal of a launch or a resume, as the clause the launcher puts
 * after "didn't launch:" / "didn't resume:". The three documented refusals of
 * the native resume (and the spawn's matching ones) get plain sentences; any
 * other refusal is carried in fieldd's own words. A launch in a pane born under
 * an Agent Profile (`under`, SB-3) sent that set, so a missing profile is then
 * about IT: puppeteer's "Work has no codex account" reads "Work has no Codex
 * sign-in", in the catalog's label.
 */
export function refusalReason(cause: unknown, under?: LaunchUnder): string {
  // DS-D15 — not refusals: the act ran, or may have (`requestResolvingOutcome`
  // asked once more and still could not tell). Said as such, never as "no".
  if (cause instanceof AnswerLostError) {
    return "it started, and its answer was lost; look before trying again";
  }
  if (outcomeUnknownKey(cause) !== undefined) {
    return "it may have started — its answer was lost; look before trying again";
  }
  const refusal = refusalOf(cause);
  const details = refusal.details ?? {};
  if (refusal.kind === "PRECONDITION_FAILED") {
    if (details["reason"] === "unsupported-agent") {
      return details["capability"] === "resume"
        ? "this agent can’t resume sessions here"
        : "this agent can’t start sessions here";
    }
    if (details["state"] === "terminal-alive") return "it is already running";
    if (details["state"] === "resuming") return "it is already being resumed";
    if (details["state"] === "signed-out") return "its profile is signed out";
    if (details["reason"] === "missing-cwd") return "its folder is gone";
    if (details["reason"] === "other-profile") return "it is held under another profile";
    if (details["reason"] === "malformed-native-id") return "its id is not one an agent can resume";
  }
  if (refusal.kind === "NOT_FOUND") {
    // Read by what fieldd says is missing, never by the kind alone: the
    // launcher sends no profile set, so a missing profile is only puppeteer's
    // AGENT_PROFILE_NOT_FOUND (a row's persona deleted since it was listed);
    // the native resume's own refusals name the conversation; anything else
    // is fieldd's words.
    if (details["reason"] === "unknown-conversation") return "the history no longer knows it";
    if (details["reason"] === "other-agent") return "the history files it under another agent";
    if (details["reason"] === "unsupported-agent") return "this agent is not offered here";
    if (details["code"] === "AGENT_PROFILE_NOT_FOUND") {
      if (under === undefined) return "its profile no longer exists";
      // puppeteer's words for the set this launch named, read by what they
      // are about — the agent it holds no account for, a set it never had,
      // an agent that cannot hold one at all — else fieldd's own
      const message = messageOf(cause);
      const provider = details["provider"];
      if (typeof provider === "string" && message.endsWith(` has no ${provider} account`)) {
        return `${under.set} has no ${under.agent} sign-in`;
      }
      if (message.startsWith("unknown profile set")) return "its profile no longer exists";
      if (message.startsWith("agent provider does not expose account profiles")) {
        return `${under.set} cannot hold a ${under.agent} sign-in`;
      }
      return message;
    }
  }
  return messageOf(cause);
}

/* ── the port ─────────────────────────────────────────────────────────── */

/** What a resume needs that the launcher's row does not carry: the persona
 * the conversation was filed under. Keyed by the row's key (rosetta's id). */
interface ResumeFacts {
  provider: string;
  nativeSessionId: string;
  profileId?: string;
}

/**
 * The port. `recent` asks `index.recent` (and `index.status` beside it, for
 * the catching-up line); `words` asks `index.search` over the sessions the
 * last list named; `launch` is `agent.spawn` in the pane's folder, under the
 * Agent Profile the pane's shell was born under (QL-D3 as revised again, SB-3:
 * a pane with a profile launches under it) and under none in any other pane;
 * `resume` is `agent.resume`'s native form with the ROW's persona, or none —
 * never a tab's or a pane's: a resume continues where the conversation lives,
 * and another profile's folder does not hold it.
 */
export function launcherPortOver(deps: LauncherPortDeps): LauncherPort {
  const facts = new Map<string, ResumeFacts>();
  const listed = { here: [] as string[], all: [] as string[] };

  const place = async (
    answered: unknown,
    where: { paneId: string; replacing: string },
  ): Promise<LauncherOutcome> => {
    const result = AgentSpawnResult.parse(answered);
    return await deps.place(result.terminal, where);
  };

  return {
    async recent(request) {
      const [answer, status] = await Promise.allSettled([
        deps.client.request("index.recent", {
          ...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
          scope: request.scope,
          ...(request.limit !== undefined ? { limit: request.limit } : {}),
        }),
        searchStatus(deps.client),
      ]);
      if (answer.status === "rejected") {
        return { status: historyStatusFromRefusal(answer.reason), sessions: [] };
      }
      const parsed = IndexRecentResult.safeParse(answer.value);
      if (!parsed.success) {
        return {
          status: { readiness: "failed", detail: "the agent index answered an unreadable list" },
          sessions: [],
        };
      }
      const providers = deps.providers();
      const sessions = parsed.data.rows.map((row) => {
        if (row.provider !== undefined && row.nativeSessionId !== "") {
          facts.set(row.sessionId, {
            provider: row.provider,
            nativeSessionId: row.nativeSessionId,
            ...(row.profileId !== undefined ? { profileId: row.profileId } : {}),
          });
        }
        return launcherSession(row, providers);
      });
      listed[request.scope] = sessions.flatMap((session) =>
        session.nativeSessionId !== undefined ? [session.nativeSessionId] : [],
      );
      return {
        status: status.status === "fulfilled" ? status.value : { readiness: "ready" },
        sessions,
      };
    },

    async words(request) {
      // Scoped to what the list named (the words lane only annotates listed
      // sessions); the door takes at most 256 ids, and none means everything.
      const ids = listed[request.scope].slice(0, 256);
      try {
        const result = IndexSearchResult.parse(
          await deps.client.request("index.search", {
            q: request.query,
            ...(ids.length > 0 ? { nativeSessionIds: ids } : {}),
            ...(request.limit !== undefined ? { limit: request.limit } : {}),
            prefix: true,
          }),
        );
        const hits: LauncherWordHit[] = result.hits.map((hit) => {
          // A hit in a delegated child is joined to the ROOT the list shows;
          // its own native id names the child, so it is only carried for a
          // hit that is its own root.
          const root = hit.rootSessionId ?? hit.sessionId;
          return {
            sessionKey: root,
            ...(hit.nativeSessionId !== undefined && root === hit.sessionId
              ? { nativeSessionId: hit.nativeSessionId }
              : {}),
            kind: hit.kind,
            snippet: hit.snippet,
          };
        });
        return { answered: result.answered, hits };
      } catch {
        // Unanswered, never "no matches": the launcher keeps what it showed.
        return { answered: false, hits: [] };
      }
    },

    async launch(request) {
      // the shell this launcher sits on, and so the pane's profile
      const profileSet = deps.profileSetOf?.(request.sessionId);
      let answered: unknown;
      try {
        // DS-D15 — one logical launch: an outcome-unknown is asked once more
        // with its key (today only a launch routed to another desktop is keyed;
        // a local one never fails that way, so this is one request)
        answered = await requestResolvingOutcome(deps.client, "agent.spawn", {
          provider: request.providerId,
          ...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
          ...(profileSet !== undefined ? { profileSet } : {}),
        });
      } catch (cause) {
        const under =
          profileSet === undefined
            ? undefined
            : {
                set:
                  deps.profileSets?.().find((set) => set.id === profileSet)?.label ?? "its profile",
                agent:
                  deps.providers().find((provider) => provider.id === request.providerId)?.label ??
                  request.providerId,
              };
        return { accepted: false, reason: refusalReason(cause, under) };
      }
      return await place(answered, { paneId: request.paneId, replacing: request.sessionId });
    },

    async resume(request) {
      const known = facts.get(request.session.key);
      if (known === undefined) return { accepted: false, reason: "no agent here can resume it" };
      const cwd = request.session.cwd ?? request.cwd;
      let answered: unknown;
      try {
        answered = await requestResolvingOutcome(deps.client, "agent.resume", {
          provider: known.provider,
          nativeSessionId: known.nativeSessionId,
          ...(cwd !== undefined ? { cwd } : {}),
          ...(known.profileId !== undefined ? { profileId: known.profileId } : {}),
          ...(request.session.title !== UNTITLED_SESSION
            ? { title: request.session.title.slice(0, 256) }
            : {}),
        });
      } catch (cause) {
        return { accepted: false, reason: refusalReason(cause) };
      }
      return await place(answered, { paneId: request.paneId, replacing: request.sessionId });
    },
  };
}
