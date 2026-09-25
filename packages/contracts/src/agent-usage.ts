import { z } from "zod";
import { AgentProfileId, AgentProviderId } from "./agent-index";

// AR-5d — account usage: the door set behind Godview's usage column
// (thinking-ar-views-port.md §6.2; the column and its view model are the
// reference's, the READING is fieldd's). One row per provider AND per
// registered account: the pair is the identity of a reading, because a
// subscription quota belongs to an ACCOUNT, not to a session.
//
// Transcribed from puppeteer-core's zod (`packages/core/src/services/
// account-usage.ts`: `AccountUsageMetric`, `AccountUsageCredits`,
// `AccountUsageSnapshot`, `AccountUsageFetchResult`) with the AR-1/AR-2
// mirroring habit — contracts stays zero-dep, objects are `.passthrough()`,
// and every upstream ENUM that is a vocabulary rather than a law is an open
// string here (a sixth `kind`, a fourth `scope`, a third `stability` must not
// fail a parse). The vendor wall (AR-L1) holds: `provider` is puppeteer's
// open provider id, `label` the adapter's own label, and nothing here carries
// a credential, a token, a path, or a native payload — EL7's read of this
// file is "percentages and labels, never an account's keys".
//
// The one deliberate DIFFERENCE from upstream: the fetch result is a union of
// a snapshot and a failure, and this contract FLATTENS it into one row with a
// `state`. A view that draws a column wants one row shape, and the flattening
// is where `rate-limited` — upstream a `code` on a failure, not a status —
// becomes a state of its own.
//
// TS-only in the generation pipeline (design-01 §7), like the rest of the
// agent plane: field-native reads no usage row.

/** The states a reading can be in. Five are projections of puppeteer's fetch
 * result; `unknown` is the tolerant reader's own (see below). */
export const AGENT_ACCOUNT_USAGE_STATES = [
  /** a snapshot was read (its metrics are in `metrics`) */
  "available",
  /** the provider refused for quota reasons (upstream `code: "rate-limited"`) */
  "rate-limited",
  /** the account is not logged in */
  "unauthenticated",
  /** this provider does not publish account usage at all */
  "unsupported",
  /** the reading could not be taken (transport, timeout, a thrown adapter) */
  "unavailable",
  /** a state this reader cannot name */
  "unknown",
] as const;

/** Tolerant the way `IndexPhase` is (agent-index.ts): an unrecognized value
 * folds to `unknown` rather than failing the batch.
 *
 * Why `unknown` and not `.catch("unavailable")`: a state this reader cannot
 * name is not a failed reading. Folding it to `unavailable` would make the
 * row CLAIM a refusal the daemon never reported and lend it `retryable`
 * semantics; `unknown` says only what is true — the daemon reported a state
 * this build has no word for — and `message` still carries the provider's own
 * sentence for a person to read. (Degraded is surfaced honestly, never
 * relabelled as something more definite.) */
export const AgentAccountUsageState = z.enum(AGENT_ACCOUNT_USAGE_STATES).catch("unknown");
export type AgentAccountUsageState = (typeof AGENT_ACCOUNT_USAGE_STATES)[number];

/** One adapter-normalized meter, already named and ordered for a generic
 * consumer (upstream `AccountUsageMetricSchema`). `id` is opaque outside the
 * adapter: a view renders `label` and PRESERVES array order. */
export const AgentAccountUsageMetric = z
  .object({
    id: z.string().min(1),
    /** compact semantic label — the adapter's, never enumerated here */
    label: z.string().min(1),
    /** longer provider-neutral explanation for a tip or a screen reader */
    description: z.string().optional(),
    /** upstream `window | budget`; open (a third kind must not fail a parse) */
    kind: z.string(),
    /** percent consumed; above 100 is valid for an exceeded budget */
    usedPercent: z.number().nonnegative(),
    durationMinutes: z.number().int().positive().optional(),
    startsAt: z.string().optional(),
    resetsAt: z.string().optional(),
    /** the part of the plan this meter measures when it is not the whole plan
     * (upstream `AccountUsageMetricGroupSchema`): a model family or an
     * allowance of its own, named as the provider names it. Meters sharing an
     * id are one family; `standby` marks an allowance drawn on only after the
     * plan's own limits run out (a view keeps it out of sight until then) */
    group: z
      .object({
        id: z.string().min(1),
        label: z.string().min(1),
        standby: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();
export type AgentAccountUsageMetric = z.infer<typeof AgentAccountUsageMetric>;

/** Account-wide credits that no percentage meter represents (upstream
 * `AccountUsageCreditsSchema`). `balance` stays a STRING: it is the
 * provider's own formatting, units and precision included, and fieldd never
 * re-formats or re-denominates money. */
export const AgentAccountUsageCredits = z
  .object({
    balance: z.string().optional(),
    hasCredits: z.boolean().optional(),
    unlimited: z.boolean().optional(),
    resetCreditsAvailable: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type AgentAccountUsageCredits = z.infer<typeof AgentAccountUsageCredits>;

/** How the adapter obtained the snapshot, without naming a credential
 * (upstream `AccountUsageSourceSchema`). Both fields are open vocabularies. */
export const AgentAccountUsageSource = z
  .object({ kind: z.string(), stability: z.string() })
  .passthrough();
export type AgentAccountUsageSource = z.infer<typeof AgentAccountUsageSource>;

/** One reading: a provider, the account it was read for, and either its
 * metrics or the reason there are none.
 *
 * `fetchedAt` is when the DATA was read, never when the batch was built — so
 * a `stale` row (the last good snapshot, kept because a later refresh failed)
 * keeps the older stamp and says `stale: true` beside it. A failure row's
 * `fetchedAt` is the instant the failed reading completed. */
export const AgentAccountUsageEntry = z
  .object({
    /** puppeteer's provider id — OPEN (AR-L1: no vendor is enumerated here) */
    provider: AgentProviderId,
    /** the adapter's own label for the provider */
    label: z.string().min(1),
    /** the registered account this reading belongs to; absent = the provider's
     * native default account (the root it uses when no variable is bound) */
    profileId: AgentProfileId.optional(),
    /** the persona's label, so a row can name its account without a second door */
    profileLabel: z.string().optional(),
    /** the LATEST attempt's outcome — which is not always what `metrics`
     * hold: a retained reading (see `stale`) keeps its numbers and still
     * reports the refusal that kept them */
    state: AgentAccountUsageState,
    /** adapter-ranked; a view preserves this order. Empty until a reading has
     * succeeded at least once. */
    metrics: z.array(AgentAccountUsageMetric),
    credits: AgentAccountUsageCredits.optional(),
    /** the provider's own sentence for a non-available state, or for the
     * refresh that failed over a stale row */
    message: z.string().optional(),
    retryable: z.boolean().optional(),
    /** earliest provider-authorized retry, when one was given */
    retryAt: z.string().optional(),
    /** the metrics are a RETAINED reading and the last refresh failed
     * (`state`/`message`/`retryable` then describe that failure, not the
     * metrics, whose age is `fetchedAt`) */
    stale: z.boolean().optional(),
    fetchedAt: z.string(),
    /** upstream `subscription | api | workspace | unknown`; open */
    scope: z.string().optional(),
    source: AgentAccountUsageSource.optional(),
  })
  .passthrough();
export type AgentAccountUsageEntry = z.infer<typeof AgentAccountUsageEntry>;

/** `agents.usage` result, and the shape of every `agents.usage.subscribe`
 * frame: FULL snapshots in provider order (state transfer, never edges — a
 * missed frame is repaired by the next one), at most one per tick per
 * connection. Before the first refresh answers, `entries` is empty and
 * `generatedAt` still stamps the answer: an honest empty, never a throw. */
export const AgentAccountUsageBatch = z
  .object({
    entries: z.array(AgentAccountUsageEntry),
    generatedAt: z.string(),
  })
  .passthrough();
export type AgentAccountUsageBatch = z.infer<typeof AgentAccountUsageBatch>;

/** An explicit refresh waits for a reading, bypassing the normal poll interval
 * while preserving provider backoff and the monitor's repeated-click guard. */
export const AgentsUsageParams = z
  .object({
    refresh: z.boolean().optional(),
    profileIds: z.array(AgentProfileId).max(256).optional(),
  })
  .strict();
export type AgentsUsageParams = z.infer<typeof AgentsUsageParams>;
