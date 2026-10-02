import {
  type AccountUsageBatch,
  type AccountUsageEntry,
  type AccountUsageFailure,
  type AccountUsageFetchResult,
  type AccountUsageMetric,
  AccountUsageScopeSchema,
  type AccountUsageSource,
} from "@vibecook/puppeteer-core";
import type {
  HistoryPort,
  HistorySearchReadiness,
  HistorySearchStatus,
  HistorySessionFacts,
} from "@vibecook/puppeteer-views";
import {
  AgentAccountUsageBatch,
  type AgentAccountUsageEntry,
  AgentMeshFrame,
  AgentMeshOpen,
  AgentRunHistory,
  AgentsProfileSetsListResult,
  DeviceInfo,
  IndexSearchResult,
  IndexSessionsResult,
  IndexStatus,
} from "@vibefield/contracts";
import type {
  DevicesPort,
  MeshBoardFailure,
  MeshBoardListener,
  MonitorFeedState,
  MonitorUsagePort,
  ProfileSetsPort,
  StatusHistoryPort,
} from "./remote-door";

// THE TWO PORTS (AR-5, D14): the find sheet and the usage column reach fieldd
// only through the deck's door, and the deck builds these over its own
// `fieldd` client. Each is a pure adapter from a VibeField contract (the door's
// answer) to the shape the views package reads; nothing here knows a daemon's
// origin, and nothing here reaches a window bridge. The reference app's ports
// are its preload; these are ours.

/** The one call shape both ports need: a request through the deck's client.
 * `kind` is the client's own word for a frame — a `.snapshot` (a whole board:
 * the open, or the re-snapshot after a reconnect) or a `.delta`. */
export interface DoorClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  subscribe(
    method: string,
    params: Record<string, unknown>,
    onFrame: (payload: unknown, kind?: "snapshot" | "delta") => void,
    /** fieldd-client's `SubscribeOptions`: `onReplayFailed` hears a replay
     * after a reconnect that the daemon refused — the subscription is over */
    opts?: { onReplayFailed?: (error: unknown) => void },
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }>;
}

/* ── history: index.status / index.sessions / index.search ─────────────── */

const READINESS = new Set<HistorySearchReadiness>([
  "ready",
  "building",
  "catching-up",
  "stale",
  "failed",
]);

function readiness(value: string | undefined): HistorySearchReadiness | undefined {
  return value !== undefined && READINESS.has(value as HistorySearchReadiness)
    ? (value as HistorySearchReadiness)
    : undefined;
}

function checkedAt(): string {
  return new Date().toISOString();
}

export function historyPortOver(client: DoorClient): HistoryPort {
  return {
    async status(): Promise<HistorySearchStatus> {
      try {
        const status = IndexStatus.parse(await client.request("index.status", {}));
        const search = status.search;
        const readinessWord = readiness(search?.readiness);
        return {
          reachable: search?.reachable ?? false,
          // the door says `null` for a protocol it has not read yet; the
          // sheet's status has no word for that, so the field stays absent
          ...(typeof status.rosettad.protocolVersion === "number"
            ? { protocolVersion: status.rosettad.protocolVersion }
            : {}),
          ...(search ? { capabilities: search.capabilities } : {}),
          ...(search?.canonicalReady !== undefined
            ? { canonicalReady: search.canonicalReady }
            : {}),
          ...(readinessWord ? { readiness: readinessWord } : {}),
          ...(search?.progress ? { progress: search.progress } : {}),
          ...(search?.detail ? { detail: search.detail } : {}),
          checkedAt: checkedAt(),
        };
      } catch (cause) {
        return {
          reachable: false,
          detail: cause instanceof Error ? cause.message : String(cause),
          checkedAt: checkedAt(),
        };
      }
    },
    async facts(nativeSessionIds): Promise<HistorySessionFacts[]> {
      if (nativeSessionIds.length === 0) return [];
      // `index.sessions` refuses UNAVAILABLE while the daemon is not ready; the
      // sheet keeps the facts it last showed on a rejection, so the refusal
      // propagates rather than being dressed as an empty answer.
      const result = IndexSessionsResult.parse(
        await client.request("index.sessions", { nativeSessionIds: [...nativeSessionIds] }),
      );
      return result.rows.map((row) => ({
        nativeSessionId: row.nativeSessionId,
        sessionId: row.sessionId,
        rootSessionId: row.rootSessionId,
        ...(row.title !== undefined ? { title: row.title } : {}),
        ...(row.summary !== undefined ? { summary: row.summary } : {}),
        ...(row.cwd !== undefined ? { cwd: row.cwd } : {}),
        // the door leaves an unknown stamp absent rather than inventing one;
        // the sheet's contract wants a number, and 0 is "no stamp"
        updatedAt: row.updatedAt ?? 0,
        streamState: row.streamState,
      }));
    },
    async search(request) {
      try {
        const result = IndexSearchResult.parse(
          await client.request("index.search", {
            q: request.query,
            ...(request.nativeSessionIds.length > 0
              ? { nativeSessionIds: [...request.nativeSessionIds] }
              : {}),
            ...(request.afterMs !== undefined
              ? { afterMs: Math.max(0, Math.floor(request.afterMs)) }
              : {}),
            ...(request.limit !== undefined ? { limit: request.limit } : {}),
            ...(request.prefix !== undefined ? { prefix: request.prefix } : {}),
          }),
        );
        const readinessWord = readiness(result.state.readiness);
        return {
          status: {
            reachable: true,
            ...(result.state.canonicalReady !== undefined
              ? { canonicalReady: result.state.canonicalReady }
              : {}),
            ...(readinessWord ? { readiness: readinessWord } : {}),
            ...(result.state.progress ? { progress: result.state.progress } : {}),
            ...(result.state.detail ? { detail: result.state.detail } : {}),
            checkedAt: checkedAt(),
          },
          answered: result.answered,
          hits: result.hits.map((hit) => ({
            sessionId: hit.sessionId,
            // absent when the daemon could not attribute the hit — never the
            // hit's own id in its place (AR-5b)
            ...(hit.rootSessionId !== undefined ? { rootSessionId: hit.rootSessionId } : {}),
            ...(hit.nativeSessionId !== undefined ? { nativeSessionId: hit.nativeSessionId } : {}),
            ...(hit.title !== undefined ? { title: hit.title } : {}),
            timelineId: hit.timelineId,
            kind: hit.kind,
            ...(hit.at !== undefined ? { at: hit.at } : {}),
            snippet: hit.snippet,
          })),
          clipped: result.clipped,
        };
      } catch (cause) {
        // Unanswered, never "no matches": the sheet holds what it last showed.
        return {
          status: {
            reachable: false,
            detail: cause instanceof Error ? cause.message : String(cause),
            checkedAt: checkedAt(),
          },
          answered: false,
          hits: [],
          clipped: false,
        };
      }
    },
  };
}

/* ── usage: agents.usage + agents.usage.subscribe ───────────────────────── */

/** The flattened door row back into Core's two-part entry (a provider, a
 * result), which is the shape the column's view model was written against.
 * The reading is fieldd's: the row carries percentages, labels and the
 * provider's own sentences, and this rebuilds the union around them. */
function toEntry(row: AgentAccountUsageEntry): AccountUsageEntry {
  const provider = {
    id: row.provider,
    label: row.label,
    // Not a reading: the flattened row carries no polling cadence (fieldd owns
    // the cadence), and nothing in the column reads this. NaN says so.
    refresh: { pollIntervalMs: Number.NaN },
  };
  // Core's failure union has no slot for `unknown` (a daemon that has not
  // read yet, the contract's honest word); the column can draw only Core's
  // shapes, so it is said as an unavailable reading that IS retryable — the
  // next poll may answer — under its own sentence, never the bare word or
  // a claimed refusal (AR-5b; a `pending` slot upstream is the real fix).
  const unknown = row.state === "unknown";
  const failure = (): AccountUsageFailure => ({
    status:
      row.state === "unauthenticated" || row.state === "unsupported" ? row.state : "unavailable",
    provider: row.provider,
    message: row.message ?? (unknown ? "no reading yet" : row.state),
    retryable: row.retryable ?? unknown,
    ...(row.state === "rate-limited" ? { code: "rate-limited" as const } : {}),
    ...(row.retryAt !== undefined ? { retryAt: row.retryAt } : {}),
  });
  // A reading is a reading with or without percentage meters: an account on
  // credits alone (Codex, Grok) reports `available` with no metrics, and the
  // column has its own honest line for that (NO LIMIT DATA) — gating on
  // the meters drew it as a refusal captioned "available" and dropped the
  // credits (AR-5b).
  const held = row.state === "available" || row.stale === true;
  const scope = AccountUsageScopeSchema.safeParse(row.scope);
  const result: AccountUsageFetchResult = held
    ? {
        status: "available",
        snapshot: {
          provider: row.provider,
          fetchedAt: row.fetchedAt,
          // the contract's scope word is open; Core's is a closed enum, and a
          // word Core does not know is `unknown` rather than a typed lie
          scope: scope.success ? scope.data : "unknown",
          // fieldd names the source of every available reading (Core requires
          // one); the fallback is for a row this reader cannot vouch for, and
          // the column reads neither field
          source: (row.source ?? {
            kind: "native-protocol",
            stability: "experimental",
          }) as AccountUsageSource,
          metrics: row.metrics.map(
            (metric): AccountUsageMetric => ({
              id: metric.id,
              label: metric.label,
              ...(metric.description !== undefined ? { description: metric.description } : {}),
              kind: metric.kind as AccountUsageMetric["kind"],
              usedPercent: metric.usedPercent,
              ...(metric.durationMinutes !== undefined
                ? { durationMinutes: metric.durationMinutes }
                : {}),
              ...(metric.startsAt !== undefined ? { startsAt: metric.startsAt } : {}),
              ...(metric.resetsAt !== undefined ? { resetsAt: metric.resetsAt } : {}),
              // the part of the plan it meters; Core writes standby only as `true`
              ...(metric.group !== undefined
                ? {
                    group: {
                      id: metric.group.id,
                      label: metric.group.label,
                      ...(metric.group.standby === true ? { standby: true as const } : {}),
                    },
                  }
                : {}),
            }),
          ),
          ...(row.credits ? { credits: row.credits } : {}),
          ...(row.profileId !== undefined ? { profileId: row.profileId } : {}),
        },
      }
    : failure();
  return {
    provider,
    result,
    ...(row.profileId !== undefined ? { profileId: row.profileId } : {}),
    ...(row.profileLabel !== undefined ? { profileLabel: row.profileLabel } : {}),
    ...(held && row.stale === true ? { stale: true, refreshFailure: failure() } : {}),
  };
}

export function toAccountUsageBatch(payload: unknown): AccountUsageBatch {
  const batch = AgentAccountUsageBatch.parse(payload);
  return { refreshedAt: batch.generatedAt, entries: batch.entries.map(toEntry) };
}

export function usagePortOver(client: DoorClient): MonitorUsagePort {
  const listeners = new Set<(state: MonitorFeedState) => void>();
  const errors = new Map<"snapshot" | "subscription", string>();
  let snapshotAttempt = 0;
  let subscriptionReady = false;
  let state: MonitorFeedState = { state: "loading" };
  const report = (source: "snapshot" | "subscription", cause?: unknown): void => {
    if (source === "subscription") subscriptionReady = cause === undefined;
    if (subscriptionReady) errors.delete("snapshot");
    if (cause === undefined) errors.delete(source);
    else if (source !== "snapshot" || !subscriptionReady) {
      errors.set(source, cause instanceof Error ? cause.message : String(cause));
    }
    const reason = [...errors.values()].join(" · ");
    state = reason ? { state: "unavailable", reason } : { state: "ready" };
    for (const listener of listeners) listener(state);
  };
  return {
    subscribeState: (listener) => {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: async () => {
      const attempt = ++snapshotAttempt;
      try {
        const batch = toAccountUsageBatch(await client.request("agents.usage", {}));
        if (attempt === snapshotAttempt) report("snapshot");
        return batch;
      } catch (cause) {
        if (attempt === snapshotAttempt) report("snapshot", cause);
        throw cause;
      }
    },
    subscribe: (listener) => {
      subscriptionReady = false;
      let cancelled = false;
      let unsubscribe: (() => void) | null = null;
      const deliver = (payload: unknown): void => {
        // Keep the last good batch on an unreadable frame, but expose the
        // failure to the host. A later valid frame clears this failure.
        try {
          const batch = toAccountUsageBatch(payload);
          report("subscription");
          listener(batch);
        } catch (cause) {
          report("subscription", cause);
        }
      };
      void client
        .subscribe("agents.usage.subscribe", {}, (payload) => {
          if (!cancelled) deliver(payload);
        })
        .then((subscription) => {
          if (cancelled) {
            subscription.unsubscribe();
            return;
          }
          unsubscribe = subscription.unsubscribe;
          deliver(subscription.snapshot);
        })
        .catch((cause: unknown) => {
          if (!cancelled) report("subscription", cause);
        });
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },
  };
}

/* ── profiles: agents.profileSets.subscribe (AR-S5) ─────────────────────── */

/** The Agent Profiles for the bar's tabs, over the same feed Settings reads.
 * Whole snapshots; the tolerant reader drops a frame it cannot parse, and a
 * subscription that cannot be opened leaves the bar without tabs rather than
 * inventing any. */
/* ── DS-3: the mesh board and the roster ───────────────────────────────── */

/** The refusals no second ask can change: the same request gets the same
 * answer until something else moves (a grant, a build, the request itself). */
const MESH_TERMINAL_KINDS = new Set([
  "FORBIDDEN_SCOPE",
  "INCOMPATIBLE",
  "PRECONDITION_FAILED",
  "UNAUTHORIZED",
]);

/** A refusal or a lost ask, as the reader needs it (S4, 2026-10-01): fieldd's
 * words, and whether asking again may be answered — read from the error's own
 * `kind` and `retryable` (a FielddRpcError's), never from its message. */
export function meshBoardFailure(cause: unknown): MeshBoardFailure {
  const { kind, retryable } = (typeof cause === "object" && cause !== null ? cause : {}) as {
    kind?: unknown;
    retryable?: unknown;
  };
  return {
    reason: cause instanceof Error ? cause.message : String(cause),
    retryable: retryable === true && !(typeof kind === "string" && MESH_TERMINAL_KINDS.has(kind)),
  };
}

/** The board every self desktop's agents arrive on (`agent.subscribe
 * {projection: "desk", scope: "mesh"}`, DS-D4), read through the deck's own
 * client: a `.snapshot` is a whole board (the open, and the client's replay
 * after a reconnect), a `.delta` one device's frame. The tolerant reader: a
 * frame that does not parse is a reason (`onError`), never a blank. S4: every
 * failure says whether asking again may be answered, and a replay the daemon
 * refused after a reconnect is a failure too — the client let it go. */
export function meshBoardOver(client: DoorClient): (listener: MeshBoardListener) => () => void {
  return ({ onOpen, onFrame, onError }) => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const deliverOpen = (payload: unknown): void => {
      const parsed = AgentMeshOpen.safeParse(payload);
      if (parsed.success) onOpen(parsed.data);
      else
        onError({
          reason: `the mesh board answered an unreadable board: ${parsed.error.issues[0]?.message ?? "invalid"}`,
          retryable: false, // another build's board: asking again reads the same
        });
    };
    const deliverFrame = (payload: unknown): void => {
      const parsed = AgentMeshFrame.safeParse(payload);
      if (parsed.success) onFrame(parsed.data);
      else
        onError({
          reason: `the mesh board sent an unreadable frame: ${parsed.error.issues[0]?.message ?? "invalid"}`,
          retryable: true,
          frame: true,
        });
    };
    void client
      .subscribe(
        "agent.subscribe",
        { projection: "desk", scope: "mesh" },
        (payload, kind) => {
          if (cancelled) return;
          if (kind === "snapshot") deliverOpen(payload);
          else deliverFrame(payload);
        },
        {
          onReplayFailed: (cause) => {
            if (!cancelled) onError(meshBoardFailure(cause));
          },
        },
      )
      .then((subscription) => {
        if (cancelled) {
          subscription.unsubscribe();
          return;
        }
        unsubscribe = subscription.unsubscribe;
        deliverOpen(subscription.snapshot);
      })
      .catch((cause: unknown) => {
        if (!cancelled) onError(meshBoardFailure(cause));
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  };
}

const RosterList = DeviceInfo.array();

/** The roster (`device.subscribe`): whole lists, the newest one standing. An
 * unreadable list is dropped and the last good one stays. */
export function devicesPortOver(client: DoorClient): DevicesPort {
  return {
    subscribe: (listener) => {
      let cancelled = false;
      let unsubscribe: (() => void) | null = null;
      const deliver = (payload: unknown): void => {
        const parsed = RosterList.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      void client
        .subscribe("device.subscribe", {}, (payload) => {
          if (!cancelled) deliver(payload);
        })
        .then((subscription) => {
          if (cancelled) {
            subscription.unsubscribe();
            return;
          }
          unsubscribe = subscription.unsubscribe;
          deliver(subscription.snapshot);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },
  };
}

export function profileSetsPortOver(client: DoorClient): ProfileSetsPort {
  return {
    subscribe: (listener) => {
      let cancelled = false;
      let unsubscribe: (() => void) | null = null;
      const deliver = (payload: unknown): void => {
        const parsed = AgentsProfileSetsListResult.safeParse(payload);
        if (parsed.success) listener(parsed.data.sets);
      };
      void client
        .subscribe("agents.profileSets.subscribe", {}, (payload) => {
          if (!cancelled) deliver(payload);
        })
        .then((subscription) => {
          if (cancelled) {
            subscription.unsubscribe();
            return;
          }
          unsubscribe = subscription.unsubscribe;
          deliver(subscription.snapshot);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },
  };
}

/* ── the status ledger: agent.history (TL, TL-D8) ───────────────────────── */

/** fieldd's record of what each run did, read run by run (the tolerant reader):
 * an answer that is not a list of runs is no record, and a run that does not
 * parse is dropped while the rest stand. A refusal — a fieldd from before the
 * door — rejects, and the caller draws what it watched. */
export function statusHistoryPortOver(client: DoorClient): StatusHistoryPort {
  return {
    async load(runtimeRunIds) {
      const answer = await client.request(
        "agent.history",
        runtimeRunIds === undefined ? {} : { runtimeRunIds: [...runtimeRunIds] },
      );
      const runs =
        typeof answer === "object" && answer !== null && "runs" in answer ? answer.runs : undefined;
      if (!Array.isArray(runs)) return [];
      return runs.flatMap((run: unknown) => {
        const parsed = AgentRunHistory.safeParse(run);
        return parsed.success ? [parsed.data] : [];
      });
    },
  };
}
