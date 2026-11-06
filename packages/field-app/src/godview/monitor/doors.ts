import {
  AgentAccountUsageBatch,
  type AgentAccountUsageEntry,
  AgentRecordedLanesResult,
  AgentsInstallsResult,
  AgentsProfileSetsListResult,
  type AgentsUsageParams,
  DeviceInfo,
  IndexSearchResult,
  IndexSessionsResult,
  IndexStatus,
} from "@vibefield/contracts";
import {
  type AccountUsageBatch,
  type AccountUsageEntry,
  type AccountUsageFailure,
  type AccountUsageFetchResult,
  type AccountUsageMetric,
  AccountUsageScopeSchema,
  type AccountUsageSource,
} from "@vibefield/puppeteer-core";
import type {
  HistoryPort,
  HistorySearchReadiness,
  HistorySearchStatus,
  HistorySessionFacts,
} from "@vibefield/puppeteer-views";
import type { RecordedLanesPort } from "./monitor-history";
import { instrumentModelClient } from "./perf/door-instruments";
import type {
  DevicesPort,
  ModelBoardFailure,
  ModelBoardPort,
  MonitorFeedState,
  MonitorUsagePort,
  ProfileSetsPort,
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
  return viewsBatch(AgentAccountUsageBatch.parse(payload));
}

function viewsBatch(batch: AgentAccountUsageBatch): AccountUsageBatch {
  return { refreshedAt: batch.generatedAt, entries: batch.entries.map(toEntry) };
}

/**
 * The usage port over fieldd's two usage doors (`agents.usage`, its
 * subscription) and This Mac's installs.
 *
 * UM-3 (2a; DESIGN.md §8 "Godview's profiles column") — THE ONE SUBSCRIPTION
 * is the port's own: its first reader opens `agents.usage.subscribe` (the
 * profiles column's rows, which the limit moment reads too, or a views reader
 * while one stands), every later reader shares it, and the last to leave
 * closes it. One refused or lost is dropped, so the next reader to come opens
 * it again: the strip's Retry is the stage's reader leaving and coming back.
 * Until UM-3's column, puppeteer-views' `UsageColumn` was the only opener and
 * the rows rode its batch (AO-6b3); the views' face (`snapshot`, `subscribe`)
 * stays this wave, a reader of the same subscription.
 */
export function usagePortOver(client: DoorClient): MonitorUsagePort {
  const listeners = new Set<(state: MonitorFeedState) => void>();
  const errors = new Map<"snapshot" | "subscription", string>();
  let snapshotAttempt = 0;
  let subscriptionReady = false;
  let state: MonitorFeedState = { state: "loading" };
  // each reader is its own entry (a listener handed twice is two readers), so
  // the count of entries is the count of readers holding the subscription
  const rowsListeners = new Set<(rows: readonly AgentAccountUsageEntry[]) => void>();
  const batchListeners = new Set<(batch: AccountUsageBatch) => void>();
  let rows: readonly AgentAccountUsageEntry[] | null = null;
  /** the subscription's last readable frame, for a views reader that joins it */
  let batch: AccountUsageBatch | null = null;
  let feed: { close(): void } | null = null;
  const read = (payload: unknown): AccountUsageBatch => {
    const parsed = AgentAccountUsageBatch.parse(payload);
    rows = parsed.entries;
    for (const listener of rowsListeners) listener(parsed.entries);
    return viewsBatch(parsed);
  };
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
  const open = (): void => {
    subscriptionReady = false;
    batch = null;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    const opened = {
      close: (): void => {
        cancelled = true;
        unsubscribe?.();
      },
    };
    feed = opened;
    const deliver = (payload: unknown): void => {
      // Keep the last good batch on an unreadable frame, but expose the
      // failure to the host. A later valid frame clears this failure.
      try {
        const next = read(payload);
        batch = next;
        report("subscription");
        for (const listener of batchListeners) listener(next);
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
        if (cancelled) return;
        if (feed === opened) feed = null;
        report("subscription", cause);
      });
  };
  /** A reader joins: the subscription opens for the first, or again after a refusal. */
  const hold = <T>(into: Set<T>, entry: T): (() => void) => {
    into.add(entry);
    if (feed === null) open();
    return () => {
      if (!into.delete(entry)) return;
      if (rowsListeners.size + batchListeners.size > 0) return;
      feed?.close();
      feed = null;
    };
  };
  const ask = async (params: AgentsUsageParams): Promise<AccountUsageBatch> => {
    const attempt = ++snapshotAttempt;
    try {
      const answered = read(await client.request("agents.usage", params));
      if (attempt === snapshotAttempt) report("snapshot");
      return answered;
    } catch (cause) {
      if (attempt === snapshotAttempt) report("snapshot", cause);
      throw cause;
    }
  };
  return {
    subscribeState: (listener) => {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeRows: (listener) => {
      const entry = (next: readonly AgentAccountUsageEntry[]): void => listener(next);
      if (rows !== null) listener(rows);
      return hold(rowsListeners, entry);
    },
    refresh: async (profileIds) => {
      await ask({ refresh: true, profileIds: [...profileIds] });
    },
    installs: async () => {
      try {
        const parsed = AgentsInstallsResult.safeParse(await client.request("agents.installs", {}));
        return parsed.success
          ? new Set(parsed.data.installs.map((install) => install.provider))
          : undefined;
      } catch {
        return undefined;
      }
    },
    snapshot: () => ask({}),
    subscribe: (listener) => {
      const entry = (next: AccountUsageBatch): void => listener(next);
      if (batch !== null && feed !== null) listener(batch);
      return hold(batchListeners, entry);
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
const BOARD_TERMINAL_KINDS = new Set([
  "FORBIDDEN_SCOPE",
  "INCOMPATIBLE",
  "PRECONDITION_FAILED",
  "UNAUTHORIZED",
]);

/** A refusal or a lost ask, as the reader needs it (S4, 2026-10-01): fieldd's
 * words, and whether asking again may be answered — read from the error's own
 * `kind` and `retryable` (a FielddRpcError's), never from its message. */
export function modelBoardFailure(cause: unknown): ModelBoardFailure {
  const { kind, retryable } = (typeof cause === "object" && cause !== null ? cause : {}) as {
    kind?: unknown;
    retryable?: unknown;
  };
  return {
    reason: cause instanceof Error ? cause.message : String(cause),
    retryable: retryable === true && !(typeof kind === "string" && BOARD_TERMINAL_KINDS.has(kind)),
  };
}

const RosterList = DeviceInfo.array();

/** MV-3 (MV-D18) — the model board's ask, in one place: the window's one
 * subscription (`projection: "model", scope: "mesh"`) and the screen's report.
 * The frames reach the feed (`model-replica.ts`) unparsed — the fold is the
 * tolerant reader — and a refused replay reaches it too (S4). */
const MODEL_BOARD_ASK = { projection: "model", scope: "mesh" } as const;

export function modelBoardOver(client: DoorClient): ModelBoardPort {
  // MV-3c's B-side replay (`godviewReplay=1`) stands in for the client here, where the board is
  // built; dormant otherwise — `instrumentModelClient` hands back the same client.
  const door = instrumentModelClient(client);
  return {
    subscribe: (onFrame, opts) =>
      door.subscribe("agent.subscribe", { ...MODEL_BOARD_ASK }, onFrame, opts),
    reportShown: (ids) => door.request("agent.reportShown", { ids: [...ids] }),
  };
}

/** TL (B-D6 (a)) — the lanes' past as the backend derives it from the record
 * (`agent.recordedLanes`), asked only while a mounted view asks for it
 * (`monitor-history.ts`). An answer the window cannot read is a refusal, which
 * the hook words as the past's `unavailable`.
 *
 * TV-8 — and which session a native id is (`index.sessions`' lookup), asked
 * when an ended lane is opened (`open-ended-lane.ts`). The contract's rows as
 * they are: the find sheet's `facts` drops `provider`, which an opening reads
 * when a row names it. A refusal propagates in fieldd's own words (they are
 * the status line's detail); an answer the window cannot read is one too, in a
 * person's words rather than the parser's. */
export function recordedLanesPortOver(client: DoorClient): RecordedLanesPort {
  return {
    read: async (window) =>
      AgentRecordedLanesResult.parse(
        await client.request("agent.recordedLanes", {
          sinceMs: window.sinceMs,
          untilMs: window.untilMs,
        }),
      ),
    sessions: async (nativeSessionIds) => {
      const answer = IndexSessionsResult.safeParse(
        await client.request("index.sessions", { nativeSessionIds: [...nativeSessionIds] }),
      );
      if (!answer.success) {
        throw new Error("The agent index answered sessions this window cannot read");
      }
      return answer.data.rows;
    },
  };
}

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
