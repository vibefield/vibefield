import {
  AgentAccountUsageBatch,
  type AgentAccountUsageCredits,
  type AgentAccountUsageEntry,
  type AgentAccountUsageMetric,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type {
  AccountUsageBatch,
  AccountUsageEntry,
  AccountUsageFailure,
} from "@vibefield/puppeteer-core";
import {
  type AccountUsageMonitor,
  type AccountUsageMonitorOptions,
  type AccountUsageRefreshOptions,
  type AgentRuntime,
  createAccountUsageMonitor,
} from "@vibefield/puppeteer-runtime";

// AR-5d — account usage: the reading behind `agents.usage` and
// `agents.usage.subscribe` (thinking-ar-views-port.md §6.2). One row per
// provider AND per registered account, polled on the adapter's own cadence,
// backed off when a reading fails, and pushed to subscribers as FULL batches.
//
// The plane split this file exists for: the monitor is NODE — it asks
// puppeteer's adapters, which read native protocol sockets and OAuth-bearing
// roots. The renderer gets a PROJECTION and nothing else (EL7): percentages,
// adapter labels, the provider's own sentence for a refusal, and a balance
// string exactly as the provider formatted it. No token, no path, no native
// payload, no field this contract does not name — a key puppeteer adds that
// this projection has no word for is LOGGED once (drift surfaces at the seam)
// and dropped, never forwarded blind.

/** The fold's tick, shared deliberately: a subscriber to both doors sees one
 * frame of each per tick, not two cadences (agent-runtime.ts PUBLISH_TICK_MS). */
const PUBLISH_TICK_MS = 16;

// The monitor is puppeteer's (`@vibefield/puppeteer-runtime`
// `createAccountUsageMonitor`, landed upstream 2026-09-13 with the views
// package): per provider AND per account state, the adapter's own cadence,
// exponential backoff that honours a provider's `retryAt`, a retained
// last-good reading, pushes, and a registry reconcile. fieldd owns what it
// does with the batch, never the schedule — the rows in agent-usage.test.ts
// measure the rules, so they are what proves this seam still behaves.

// ── the projection (EL7: this is the only thing that crosses) ─────────────

const METRIC_KEYS = new Set([
  "id",
  "label",
  "description",
  "kind",
  "usedPercent",
  "durationMinutes",
  "startsAt",
  "resetsAt",
  "group",
]);
const GROUP_KEYS = new Set(["id", "label", "standby"]);
const CREDITS_KEYS = new Set(["balance", "hasCredits", "unlimited", "resetCreditsAvailable"]);
const SNAPSHOT_KEYS = new Set([
  "provider",
  "fetchedAt",
  "scope",
  "source",
  "metrics",
  "credits",
  "profileId",
]);
const SOURCE_KEYS = new Set(["kind", "stability"]);

type NoteUnknown = (where: string, value: unknown, known: ReadonlySet<string>) => void;

/** The part of the plan a meter measures: its name and whether it waits in
 * standby — three named fields, nothing else crosses. */
function projectGroup(value: unknown, note: NoteUnknown): AgentAccountUsageMetric["group"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const group = value as Record<string, unknown>;
  note("metric.group", group, GROUP_KEYS);
  if (typeof group["id"] !== "string" || typeof group["label"] !== "string") return undefined;
  return {
    id: group["id"],
    label: group["label"],
    ...(group["standby"] === true ? { standby: true } : {}),
  };
}

function projectMetric(
  metric: Record<string, unknown>,
  note: NoteUnknown,
): AgentAccountUsageMetric {
  note("metric", metric, METRIC_KEYS);
  const group = projectGroup(metric["group"], note);
  return {
    id: String(metric["id"]),
    label: String(metric["label"]),
    ...(typeof metric["description"] === "string" ? { description: metric["description"] } : {}),
    kind: String(metric["kind"]),
    usedPercent: Number(metric["usedPercent"]),
    ...(typeof metric["durationMinutes"] === "number"
      ? { durationMinutes: metric["durationMinutes"] }
      : {}),
    ...(typeof metric["startsAt"] === "string" ? { startsAt: metric["startsAt"] } : {}),
    ...(typeof metric["resetsAt"] === "string" ? { resetsAt: metric["resetsAt"] } : {}),
    ...(group !== undefined ? { group } : {}),
  };
}

function projectCredits(
  credits: Record<string, unknown>,
  note: NoteUnknown,
): AgentAccountUsageCredits {
  note("credits", credits, CREDITS_KEYS);
  return {
    ...(typeof credits["balance"] === "string" ? { balance: credits["balance"] } : {}),
    ...(typeof credits["hasCredits"] === "boolean" ? { hasCredits: credits["hasCredits"] } : {}),
    ...(typeof credits["unlimited"] === "boolean" ? { unlimited: credits["unlimited"] } : {}),
    ...(typeof credits["resetCreditsAvailable"] === "number"
      ? { resetCreditsAvailable: credits["resetCreditsAvailable"] }
      : {}),
  };
}

/** Upstream keeps `rate-limited` as a CODE on a failure rather than a status;
 * the column wants one vocabulary, so the projection lifts it to a state. */
function stateOf(failure: AccountUsageFailure): AgentAccountUsageEntry["state"] {
  return failure.code === "rate-limited" ? "rate-limited" : failure.status;
}

function failureFacts(
  failure: AccountUsageFailure,
): Pick<AgentAccountUsageEntry, "message" | "retryable" | "retryAt"> {
  return {
    message: failure.message,
    retryable: failure.retryable,
    ...(failure.retryAt !== undefined ? { retryAt: failure.retryAt } : {}),
  };
}

/** One monitor entry → one contract row. `fallbackAt` is the batch's own
 * stamp, used only where there is no reading to date (a failure). */
export function projectEntry(
  entry: AccountUsageEntry,
  fallbackAt: string,
  note: NoteUnknown,
): AgentAccountUsageEntry {
  const identity = {
    provider: entry.provider.id,
    label: entry.provider.label,
    ...(entry.profileId !== undefined ? { profileId: entry.profileId } : {}),
    ...(entry.profileLabel !== undefined ? { profileLabel: entry.profileLabel } : {}),
  };
  if (entry.result.status !== "available") {
    return {
      ...identity,
      state: stateOf(entry.result),
      metrics: [],
      ...failureFacts(entry.result),
      fetchedAt: fallbackAt,
    };
  }
  const snapshot = entry.result.snapshot as unknown as Record<string, unknown>;
  note("snapshot", snapshot, SNAPSHOT_KEYS);
  const source = entry.result.snapshot.source as unknown as Record<string, unknown>;
  note("source", source, SOURCE_KEYS);
  return {
    ...identity,
    ...(entry.profileId === undefined && entry.result.snapshot.profileId !== undefined
      ? { profileId: entry.result.snapshot.profileId }
      : {}),
    // A RETAINED reading keeps its own metrics and its own stamp, but `state`
    // describes the LATEST ATTEMPT: a row whose refresh was refused says so.
    // The reference's view model lifts only `rate-limited` this way and leaves
    // an unauthenticated refresh reading as `available` (apps/godview
    // renderer/account-usage.ts) — deliberately widened here, because
    // "available" over a signed-out account is the one state a person must
    // not be shown. `stale` + the retained `metrics` keep the numbers.
    state: entry.refreshFailure !== undefined ? stateOf(entry.refreshFailure) : "available",
    metrics: entry.result.snapshot.metrics.map((metric) =>
      projectMetric(metric as unknown as Record<string, unknown>, note),
    ),
    ...(entry.result.snapshot.credits !== undefined
      ? {
          credits: projectCredits(
            entry.result.snapshot.credits as unknown as Record<string, unknown>,
            note,
          ),
        }
      : {}),
    ...(entry.stale === true ? { stale: true } : {}),
    ...(entry.refreshFailure !== undefined ? failureFacts(entry.refreshFailure) : {}),
    fetchedAt: entry.result.snapshot.fetchedAt,
    scope: entry.result.snapshot.scope,
    source: { kind: String(source["kind"]), stability: String(source["stability"]) },
  };
}

export interface AccountUsagePollOptions {
  refreshMs?: number;
  tickMs?: number;
}

/** The runtime surface this service uses — nothing more (the seam a test fakes). */
export type AccountUsageRuntime = Pick<
  AgentRuntime,
  "accountUsageProviders" | "accountUsage" | "onAccountUsage" | "onProfilesChanged" | "profiles"
>;

export interface AccountUsageServiceOptions {
  runtime: AccountUsageRuntime;
  /** test/product seam: the polling cadence (default: each adapter's own) */
  poll?: AccountUsagePollOptions;
  /** test seam: the monitor factory (default: puppeteer's own) */
  createMonitor?: (options: AccountUsageMonitorOptions) => AccountUsageMonitor;
  now?: () => Date;
  logger?: Logger;
}

/** The service behind `agents.usage` and `agents.usage.subscribe`: it owns
 * the monitor, projects every batch it publishes, keeps the latest, and fans
 * frames out on the fold's own trailing-edge tick. */
export class AccountUsageService {
  private readonly monitor: AccountUsageMonitor;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private readonly unsubscribe: Array<() => void> = [];
  private readonly subscribers = new Set<(batch: AgentAccountUsageBatch) => void>();
  /** unknown upstream keys already reported, so drift is said once, not per poll */
  private readonly noted = new Set<string>();
  private latest: AgentAccountUsageBatch | null = null;
  private publishTimer: NodeJS.Timeout | null = null;
  /** the daemon has reached ready: the service MAY poll (it does not yet) */
  private armed = false;
  /** the poll is running — true only while somebody is subscribed */
  private polling = false;
  private disposed = false;

  constructor(opts: AccountUsageServiceOptions) {
    this.logger = opts.logger ?? createNoopLogger();
    this.now = opts.now ?? (() => new Date());
    const create = opts.createMonitor ?? createAccountUsageMonitor;
    this.monitor = create({
      providers: opts.runtime.accountUsageProviders(),
      fetchUsage: (providerId, profileId) => opts.runtime.accountUsage(providerId, profileId),
      // the same registry `agents.profiles.list` reads — a persona is an
      // account, and an account is a row
      // (a signed-out one waiting on its sessions is nobody's quota to show)
      listProfiles: async () =>
        (await opts.runtime.profiles())
          .filter((profile) => profile.retiredAt === undefined)
          .map((profile) => ({
            id: profile.id,
            provider: profile.provider,
            label: profile.label,
          })),
      publish: (batch) => this.ingestBatch(batch),
      ...(opts.poll?.refreshMs !== undefined ? { refreshMs: opts.poll.refreshMs } : {}),
      ...(opts.poll?.tickMs !== undefined ? { tickMs: opts.poll.tickMs } : {}),
      now: this.now,
      onError: (error) =>
        this.logger.warn("fieldd.agents.usage_error", "Account usage reported an error", {
          error: error.message,
        }),
    });
    // Pushes and registry changes are listened for from CONSTRUCTION: a
    // provider that pushes before the first poll must not be missed, and a
    // persona created before `start()` must still become a row.
    this.unsubscribe.push(
      opts.runtime.onAccountUsage((provider, result) => {
        if (this.disposed) return;
        try {
          this.monitor.ingest(provider.id, result);
        } catch (error) {
          this.logger.warn("fieldd.agents.usage_push_failed", "An account usage push was dropped", {
            provider: provider.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }),
      opts.runtime.onProfilesChanged(() => {
        // only while the poll is running: reconciling the registry can START a
        // reading (a new account is polled at once), and a persona created
        // with nobody watching must not spend a quota call
        if (this.disposed || !this.polling) return;
        void this.refreshProfiles();
      }),
    );
  }

  /** The daemon is ready: the service MAY read. It does not begin polling
   * here.
   *
   * A quota reading is not free — an adapter spends an authenticated HTTP
   * call or a process spawn on it (puppeteer's claude service reads the OAuth
   * credential from the user's own root and asks the vendor's usage
   * endpoint). Polling with nobody watching would burn a person's rate limit
   * for a column no one has open, and every daemon boot in the test graph
   * would reach the network with their real token. So the poll is DEMAND
   * driven: it runs while `agents.usage.subscribe` has a subscriber, and a
   * one-shot `agents.usage` takes exactly the one reading it was asked for. */
  start(): void {
    if (this.disposed) return;
    this.armed = true;
    if (this.subscribers.size > 0) this.beginPolling();
  }

  /** `agents.usage`: the latest batch. Before the first refresh answers this
   * is an honest empty — entries [], stamped now — never a throw or a wait,
   * and the reading it kicks off (exactly one, for a caller who asked) lands
   * in the next answer or in a subscriber's next frame. */
  snapshot(): AgentAccountUsageBatch {
    if (this.latest !== null) return this.latest;
    // One reading for a caller who asked — after the registry reconcile (the
    // unkeyed-row hazard `beginPolling` names), never while a poll is already
    // bringing one, and only once the daemon is ARMED: a call between the
    // API's registration and `lifecycle.ready` gets the honest empty and
    // spends no credentialed call the boot sequence meant to defer (AR-5b).
    if (this.armed && !this.disposed && !this.polling) {
      void this.refreshProfiles()
        .then(() => this.monitor.refresh())
        .catch(() => undefined);
    }
    return { entries: [], generatedAt: this.now().toISOString() };
  }

  /** `agents.usage.subscribe`: full batches, at most one per tick. The first
   * subscriber starts the poll; the last one to leave stops it. */
  subscribe(emit: (batch: AgentAccountUsageBatch) => void): () => void {
    this.subscribers.add(emit);
    this.beginPolling();
    return () => {
      this.subscribers.delete(emit);
      if (this.subscribers.size === 0) this.endPolling();
    };
  }

  /** Poll while somebody is watching (see `start`). The first act is a
   * registry reconcile, so the first batch has one row per ACCOUNT rather
   * than one unkeyed row per provider (the reference's note, and the
   * difference a persona sees). */
  private beginPolling(): void {
    if (this.polling || !this.armed || this.disposed) return;
    this.polling = true;
    // The reconcile FIRST, then the poll. `start()` takes a reading at once,
    // and a reading over the unkeyed per-provider rows the reconcile then
    // replaces made the first frame say every account had failed — and spent
    // one extra credentialed call per provider (AR-5b, the review's probe).
    // After the reconcile the start's own reading finds nothing due and
    // costs nothing; a subscriber that left meanwhile starts no poll.
    void this.refreshProfiles().then(() => {
      if (this.polling && !this.disposed) this.monitor.start();
    });
  }

  private endPolling(): void {
    if (!this.polling) return;
    this.polling = false;
    this.monitor.stop();
  }

  /** Manual refresh bypasses the poll interval, never the monitor's backoff.
   * Reconcile without polling so a cold request only reads its target accounts. */
  async refresh(options: AccountUsageRefreshOptions = {}): Promise<AgentAccountUsageBatch> {
    if (this.disposed || (options.force && !this.armed)) {
      return this.latest ?? { entries: [], generatedAt: this.now().toISOString() };
    }
    if (options.force) await this.monitor.refreshProfiles({ poll: false });
    if (!this.disposed) await this.monitor.refresh(options);
    return this.latest ?? { entries: [], generatedAt: this.now().toISOString() };
  }

  /** A completed, verified login changes the account's credentials. Forget
   * its pre-login reading, then read again only while somebody is watching.
   * A registry reconcile alone keeps existing rows and their failure delay. */
  async signedIn(profileId: string): Promise<void> {
    if (this.disposed) return;
    await this.monitor.refreshProfiles({ poll: false });
    if (this.disposed) return;
    await this.monitor.invalidateProfileAuthentication(profileId);
    if (this.armed && this.polling && !this.disposed) {
      await this.monitor.refresh({ profileIds: [profileId] });
    }
  }

  /** Re-read the persona registry: a new account becomes its own row, a
   * deleted one stops being polled. Called after the profile doors settle
   * (puppeteer's `onProfilesChanged`, which fires for create/delete/verify). */
  async refreshProfiles(): Promise<void> {
    try {
      await this.monitor.refreshProfiles();
    } catch (error) {
      this.logger.warn("fieldd.agents.usage_profiles_failed", "Account usage profiles not read", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  stop(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.armed = false;
    this.endPolling();
    this.monitor.stop();
    for (const off of this.unsubscribe.splice(0)) {
      try {
        off();
      } catch {
        /* a disposed runtime has already dropped its listeners */
      }
    }
    if (this.publishTimer !== null) {
      clearTimeout(this.publishTimer);
      this.publishTimer = null;
    }
    this.subscribers.clear();
  }

  /** The monitor published: project, validate against the contract, keep. */
  private ingestBatch(batch: AccountUsageBatch): void {
    if (this.disposed) return;
    const note: NoteUnknown = (where, value, known) => this.note(where, value, known);
    let projected: AgentAccountUsageBatch;
    try {
      projected = {
        entries: batch.entries.map((entry) => projectEntry(entry, batch.refreshedAt, note)),
        generatedAt: batch.refreshedAt,
      };
    } catch (error) {
      this.logger.warn("fieldd.agents.usage_project_failed", "An account usage batch was dropped", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    // The door's own contract is checked HERE, once, rather than trusted:
    // a projection that cannot be parsed is a fieldd bug, and the last good
    // batch is better than an unreadable one.
    const parsed = AgentAccountUsageBatch.safeParse(projected);
    if (!parsed.success) {
      this.logger.warn(
        "fieldd.agents.usage_invalid",
        "An account usage batch did not match its contract",
        { error: parsed.error.issues[0]?.message ?? "invalid" },
      );
      return;
    }
    this.latest = parsed.data;
    this.publish();
  }

  /** One key of upstream drift, said once: the projection named every field
   * it carries, so a key it has no word for is a wire change to look at. */
  private note(where: string, value: unknown, known: ReadonlySet<string>): void {
    if (value === null || typeof value !== "object") return;
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (known.has(key)) continue;
      const id = `${where}.${key}`;
      if (this.noted.has(id)) continue;
      this.noted.add(id);
      this.logger.info(
        "fieldd.agents.usage_unknown_field",
        "Account usage carried a field this projection does not name",
        { where, field: key },
      );
    }
  }

  private publish(): void {
    if (this.disposed || this.publishTimer !== null || this.subscribers.size === 0) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      if (this.disposed) return;
      const batch = this.latest;
      if (batch === null) return;
      for (const emit of [...this.subscribers]) {
        try {
          emit(batch);
        } catch (error) {
          this.logger.warn("fieldd.agents.usage_publish_failed", "A usage subscriber threw", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }, PUBLISH_TICK_MS);
    this.publishTimer.unref();
  }
}
