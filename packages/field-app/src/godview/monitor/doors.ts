import type {
  AccountUsageBatch,
  AccountUsageEntry,
  AccountUsageFailure,
  AccountUsageFetchResult,
  AccountUsageMetric,
  AccountUsageScope,
  AccountUsageSource,
} from "@vibecook/puppeteer-core";
import type {
  AccountUsagePort,
  HistoryPort,
  HistorySearchReadiness,
  HistorySearchStatus,
  HistorySessionFacts,
} from "@vibecook/puppeteer-views";
import {
  AgentAccountUsageBatch,
  type AgentAccountUsageEntry,
  IndexSearchResult,
  IndexSessionsResult,
  IndexStatus,
} from "@vibefield/contracts";

// THE TWO PORTS (AR-5, D14): the find sheet and the usage column reach fieldd
// only through the deck's door, and the deck builds these over its own
// `fieldd` client. Each is a pure adapter from a VibeField contract (the door's
// answer) to the shape the views package reads; nothing here knows a daemon's
// origin, and nothing here reaches a window bridge. The reference app's ports
// are its preload; these are ours.

/** The one call shape both ports need: a request through the deck's client. */
export interface DoorClient {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  subscribe(
    method: string,
    params: Record<string, unknown>,
    onFrame: (payload: unknown) => void,
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
            rootSessionId: hit.rootSessionId,
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
  const failure = (): AccountUsageFailure => ({
    status:
      row.state === "unauthenticated" || row.state === "unsupported" ? row.state : "unavailable",
    provider: row.provider,
    message: row.message ?? row.state,
    retryable: row.retryable ?? false,
    ...(row.state === "rate-limited" ? { code: "rate-limited" as const } : {}),
    ...(row.retryAt !== undefined ? { retryAt: row.retryAt } : {}),
  });
  const held = row.metrics.length > 0 && (row.state === "available" || row.stale === true);
  const result: AccountUsageFetchResult = held
    ? {
        status: "available",
        snapshot: {
          provider: row.provider,
          fetchedAt: row.fetchedAt,
          scope: (row.scope ?? "unknown") as AccountUsageScope,
          // the door carries the adapter's source when it named one; the
          // column reads neither field, so an absent source stays unknown-ish
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

export function usagePortOver(client: DoorClient): AccountUsagePort {
  return {
    snapshot: async () => toAccountUsageBatch(await client.request("agents.usage", {})),
    subscribe: (listener) => {
      let cancelled = false;
      let unsubscribe: (() => void) | null = null;
      const deliver = (payload: unknown): void => {
        // the tolerant reader: an unreadable frame is dropped, never drawn
        try {
          listener(toAccountUsageBatch(payload));
        } catch {
          // a frame this reader cannot parse — the column keeps its last batch
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
        .catch(() => undefined);
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },
  };
}
