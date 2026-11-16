import { NAMESPACES, PRODUCT_API_LIMITS } from "./registries";

// Item 476 (2026-11-16) — the product door admits a subscription BY ITS KEY (docs/DECISIONS.md,
// item 476; the agent-plane page's card "Admitted by what it asks for").
// Until this item one connection had a pool of 32 live subscriptions that every feature of a
// window drew on, so opening History could starve Settings; the pool bounded one connection,
// not a caller (the bound per caller is item 480's). Now every product subscription row
// declares here what IDENTIFIES one of its subscriptions, its key (the method plus its
// identity params, each normalized), and how many holders one key may have on one connection.
// The door (fieldd
// `product-api.ts`) admits an ask while this connection holds fewer than its key's holders, or,
// for a method whose key space is open, fewer than the method's own bound. Tuning params
// (`since`, `minIntervalMs`, `heartbeatMs`) and passthrough fields are not identity, so junk
// params mint no keys.
//
// Its own table beside METHODS, never a member of a row: `registry.test.ts` pins every
// tailnet-reachable row's `subscription` member whole. Nothing generated reads it. Contracts'
// `subscription-admission.test.ts` holds it to METHODS both ways, reads every variant's values
// from its params schema, and re-derives the figures (33 closed keys, 292 holders on one
// connection, 20 boards at 16 ms). Every holder count is counted from source, not measured;
// stage 3 (item 480) keeps the same ledger per principal across sockets.

/** What bounds a row's keys:
 *  · `one` — the method reads no identity param: one key.
 *  · `variants` — a closed enum (a projection and a scope, a table): the schema's values.
 *  · `things` — a param names a thing fieldd holds (a plugin, a profile set, a spark), which
 *    must exist: the handler answers NOT_FOUND before anything is installed.
 *  · `bounded` — the identity is open or very large (a log query, every transcript): the key is
 *    the method, and `bound` counts its live subscriptions on one connection. */
export type SubscriptionClass = "one" | "variants" | "things" | "bounded";

/** One identity param of a row. */
export interface IdentityField {
  /** the value an absent field means, so `{}` and the spelled default are one key */
  readonly default?: string;
  /** absent means the CALLER's own plugin, for a plugin principal only */
  readonly defaultFromPrincipal?: "plugin";
}

/** A product subscription row's admission. */
export interface SubscriptionAdmission {
  readonly class: SubscriptionClass;
  /** the identity params by name; `{}` for `one` and `bounded` */
  readonly identity: Readonly<Record<string, IdentityField>>;
  /** holders of ONE key on ONE connection: a number, or by one identity field's normalized
   * value. Absent: `PRODUCT_API_LIMITS.SUBSCRIPTION_HOLDERS_PER_KEY` */
  readonly holders?:
    | number
    | { readonly by: string; readonly values: Readonly<Record<string, number>> };
  /** `bounded` only: live subscriptions of the METHOD on one connection (the key is the method) */
  readonly bound?: number;
  /** why this number, in a sentence */
  readonly reason: string;
}

/** Item 476 — the admission of every product subscription row of `METHODS`, by method. The
 * holders are chosen from counted holders (docs/DECISIONS.md, item 476): the default 8 is above
 * the largest count of one key's holders by any client read (6, `user.link.subscribe` in a
 * window older than item 467), and a direct subscriber's site holds its key twice for a moment
 * under React's StrictMode in a development window, which the counts include. */
export const SUBSCRIPTION_ADMISSION: Readonly<Record<string, SubscriptionAdmission>> = {
  // ── one: the method reads no identity param ──
  "system.health.subscribe": {
    class: "one",
    identity: {},
    reason:
      "This daemon's health is one value for every caller, so one key at the default holders.",
  },
  "doc.sync.subscribe": {
    class: "one",
    identity: {},
    reason: "Every document's sync standing rides one list, so one key at the default holders.",
  },
  "artifact.subscribe": {
    class: "one",
    identity: {},
    reason:
      "The live artifact catalog is one whole value, held at most twice by a window (counted), under the default holders.",
  },
  "device.subscribe": {
    class: "one",
    identity: {},
    reason: "The roster is one whole list for every caller, so one key at the default holders.",
  },
  "plugins.subscribe": {
    class: "one",
    identity: {},
    reason: "The plugin registry's snapshot is one value, so one key at the default holders.",
  },
  "services.subscribe": {
    class: "one",
    identity: {},
    reason: "The service registry is one whole value, so one key at the default holders.",
  },
  "user.link.subscribe": {
    class: "one",
    identity: {},
    reason:
      "The tailnet link's status is one value, held 6 times by a window older than item 467: the largest count, which the default holders (8) are chosen above.",
  },
  "storage.appPreferences.subscribe": {
    class: "one",
    identity: {},
    reason:
      "The app preferences are one document, held twice by Electron main (counted), under the default holders.",
  },
  "setup.subscribe": {
    class: "one",
    identity: {},
    reason:
      "The setup ledger is one value, held 5 times by a window older than item 467 (counted), under the default holders.",
  },
  "process.subscribe": {
    class: "one",
    identity: {},
    reason:
      "What the process view shows is the caller's principal's, never a param, so one key at the default holders.",
  },
  "index.status.subscribe": {
    class: "one",
    identity: {},
    reason: "This desktop's index standing is one value, so one key at the default holders.",
  },
  "index.apps.catalog.subscribe": {
    class: "one",
    identity: {},
    reason:
      "The apps table's peer replication door names no table or filter (its cursor and floor are tuning), so one key at the default holders.",
  },
  "project.subscribe": {
    class: "one",
    identity: {},
    reason:
      "The project pings are one chain (its cursor and floor are tuning), so one key at the default holders.",
  },
  "agents.operations.subscribe": {
    class: "one",
    identity: {},
    reason:
      "The distribution's running and last-finished acts are one list, so one key at the default holders.",
  },
  "agents.profileSets.subscribe": {
    class: "one",
    identity: {},
    reason:
      "The profile sets are one whole value, held 3 times by a window and 6 with React's development twin (counted), under the default holders.",
  },
  "agents.usage.subscribe": {
    class: "one",
    identity: {},
    reason:
      "The account usage is one whole value, held at most twice by a window (counted), under the default holders.",
  },
  "needs.subscribe": {
    class: "one",
    identity: {},
    reason:
      "The needs-you queue is one whole list per desktop, and the routed `device` is the door's to key, so one key at the default holders.",
  },
  "needs.notices.subscribe": {
    class: "one",
    identity: {},
    reason:
      "The notices are one event stream for main and every window, so one key at the default holders.",
  },
  "flows.subscribe": {
    class: "one",
    identity: {},
    reason:
      "The flows are one whole list, so one key at the default holders; the row has no handler yet (item 479), so the door answers NOT_FOUND and nothing is held.",
  },

  // ── variants: a closed enum, its values the params schema's ──
  "agent.subscribe": {
    class: "variants",
    identity: { projection: { default: "full" }, scope: { default: "local" } },
    holders: { by: "projection", values: { full: 4, model: 8, field: 16, remote: 16 } },
    reason:
      "The board by projection and scope (its floor, heartbeat and cursors are tuning), the 16 ms projections held tightest: full 4 (no desktop surface asks it), model 8 (Godview and Peek's Live now, each twice under the development twin, one more while a gap re-opens), and field and remote 16 (the socket between desktops: live, lingering and routed hubs).",
  },
  "index.catalog.subscribe": {
    class: "variants",
    identity: { table: {} },
    reason:
      "A peer's replication of one of the catalog's tables, which the ask must name, so one key per table at the default holders.",
  },
  "index.changes.subscribe": {
    class: "variants",
    identity: { scope: { default: "local" } },
    reason:
      "History's pings are one chain per scope (a local cursor never resumes a mesh one), so one key per scope at the default holders.",
  },
  "index.apps.subscribe": {
    class: "variants",
    identity: { scope: { default: "local" } },
    reason:
      "The shelf's pings are one chain per scope, so one key per scope at the default holders.",
  },
  "workspace.subscribe": {
    class: "variants",
    identity: { scope: {} },
    reason:
      'The roots as rows, whose required scope has the one value "roots" (its device routes, its cursor and floor are tuning), so one key at the default holders.',
  },

  // ── things: a param names a thing fieldd holds ──
  "plugins.update.subscribe": {
    class: "things",
    identity: { pluginId: {} },
    reason:
      "A window's update lane for one enabled plugin (a second lane for the same window and plugin is refused CONFLICT), so one key per plugin at the default holders, its room growing as plugins are installed.",
  },
  "plugins.runtime.subscribe": {
    class: "things",
    identity: { pluginId: {} },
    reason:
      "One plugin's runtime diagnostics, or every plugin's when the ask names none (its own key), so one key per plugin at the default holders.",
  },
  "storage.settings.subscribe": {
    class: "things",
    identity: { pluginId: { defaultFromPrincipal: "plugin" } },
    holders: 32,
    reason:
      "One plugin's settings (the caller's own plugin when a plugin names none), which the SDK opens once per watched setting key, so 32 is today's ceiling and this is the one row a correct plugin can reach (its 33rd watched setting key is refused, as it is today) until stage 4 folds the SDK to one feed per plugin and the row takes the default holders.",
  },
  "agents.extensions.subscribe": {
    class: "things",
    identity: { set: {} },
    reason: "One profile set's extensions, so one key per set at the default holders.",
  },
  "compose.sparks.crews.subscribe": {
    class: "things",
    identity: { spark: {} },
    reason: "One spark's crews for Chat's crew card, so one key per spark at the default holders.",
  },

  // ── bounded: an open key space, the method bounded instead ──
  "diagnostics.subscribe": {
    class: "bounded",
    identity: {},
    bound: 4,
    reason:
      "Its identity is an open log query and each subscriber scans the log at open and filters up to 1,000 records every 100 ms, so 4 live per connection (a window holds 1).",
  },
  "index.session.subscribe": {
    class: "bounded",
    identity: {},
    bound: 8,
    reason:
      "Every transcript exists and each session opens its own rosetta socket, so 8 live per connection (a phone's reader holds 1).",
  },
};

/** Item 476 — a plugin-provided `x.` subscription is no METHODS row: its params are the
 * plugin's own and nothing folds them, so the method is bounded at today's ceiling. */
export const PLUGIN_PROVIDED_SUBSCRIPTION: SubscriptionAdmission = {
  class: "bounded",
  identity: {},
  bound: 32,
  reason:
    "A plugin-provided subscription takes arbitrary params and no fold, so 32 live per method per connection, today's ceiling: who holds how many is not known yet.",
};

/** Who asks, as the door knows it: `pluginId` for a plugin principal; `device` for a routed
 * ask, the foreign desktop it is carried to (a `device` naming this desktop is stripped before
 * the local site, `product-api.ts`). */
export interface SubscriptionCaller {
  readonly pluginId?: string;
  readonly device?: string;
}

/** A resolved ask: the key the door counts, and the number that refuses it. */
export interface ResolvedSubscriptionAdmission {
  readonly key: string;
  /** the key's holders, or a bounded method's bound */
  readonly limit: number;
  readonly class: SubscriptionClass;
  /** false: a method with no table row and no `x.` prefix (the fallback) */
  readonly declared: boolean;
}

/** An identity value after normalizing: a string, `null` for an absent field with no default
 * (its own key), or a non-string kept as its JSON text (it keys, and the handler refuses it). */
type IdentityValue = string | null | { readonly json: string };

/** The fallback for a METHODS row missing from the table: one key, the default holders. The
 * census test finds none; the door logs it once and never refuses for the missing row. */
const UNDECLARED: SubscriptionAdmission = {
  class: "one",
  identity: {},
  reason: "A product subscription row the table does not declare: one key at the default holders.",
};

function paramsRecord(params: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  return params as Readonly<Record<string, unknown>>;
}

function jsonText(value: unknown): string {
  try {
    const text: string | undefined = JSON.stringify(value);
    return text ?? String(value);
  } catch {
    return String(value);
  }
}

function identityValue(
  params: Readonly<Record<string, unknown>> | null,
  field: string,
  spec: IdentityField,
  caller: SubscriptionCaller,
): IdentityValue {
  const raw = params !== null && Object.hasOwn(params, field) ? params[field] : undefined;
  if (raw === undefined) {
    if (spec.defaultFromPrincipal === "plugin" && caller.pluginId !== undefined)
      return caller.pluginId;
    return spec.default ?? null;
  }
  if (typeof raw === "string") return raw;
  return { json: jsonText(raw) };
}

/** By field name in UTF-16 code-unit order, never a locale's: one canonical order everywhere. */
function byName(a: readonly [string, unknown], b: readonly [string, unknown]): number {
  if (a[0] < b[0]) return -1;
  if (a[0] > b[0]) return 1;
  return 0;
}

/** Item 476 — a subscription's key: the method plus its declared identity fields in sorted
 * order, each normalized (an absent field takes its `default`, or the caller's plugin where the
 * row says so), and a routed ask's `device`. Tuning and passthrough fields are dropped. A
 * `bounded` method's key is the method alone. Pure: the same ask always keys the same. */
export function subscriptionKey(
  method: string,
  params: unknown,
  admission: SubscriptionAdmission,
  caller: SubscriptionCaller,
): string {
  if (admission.class === "bounded") return JSON.stringify([method, []]);
  const record = paramsRecord(params);
  const fields: Array<readonly [string, IdentityValue]> = [];
  for (const [field, spec] of Object.entries(admission.identity))
    fields.push([field, identityValue(record, field, spec, caller)]);
  if (caller.device !== undefined) fields.push(["device", caller.device]);
  fields.sort(byName);
  return JSON.stringify([method, fields]);
}

function holdersOf(
  admission: SubscriptionAdmission,
  params: unknown,
  caller: SubscriptionCaller,
): number {
  const fallback = PRODUCT_API_LIMITS.SUBSCRIPTION_HOLDERS_PER_KEY;
  if (admission.class === "bounded") return admission.bound ?? fallback;
  const holders = admission.holders;
  if (holders === undefined) return fallback;
  if (typeof holders === "number") return holders;
  const spec = admission.identity[holders.by];
  if (spec === undefined) return fallback;
  const value = identityValue(paramsRecord(params), holders.by, spec, caller);
  if (typeof value !== "string" || !Object.hasOwn(holders.values, value)) return fallback;
  return holders.values[value] ?? fallback;
}

/** Item 476 — what the door counts for an ask, and against what: the table's row; else, for a
 * method starting `x.`, `PLUGIN_PROVIDED_SUBSCRIPTION`; else the fallback (class `one`, the
 * method alone, the default holders, `declared: false`). */
export function resolveSubscriptionAdmission(
  method: string,
  params: unknown,
  caller: SubscriptionCaller,
): ResolvedSubscriptionAdmission {
  const row = Object.hasOwn(SUBSCRIPTION_ADMISSION, method)
    ? SUBSCRIPTION_ADMISSION[method]
    : undefined;
  // the plugin namespace is the registry's word, the one the door routes by
  const provided = method.startsWith(NAMESPACES.DYNAMIC_PREFIX);
  const admission = row ?? (provided ? PLUGIN_PROVIDED_SUBSCRIPTION : undefined);
  if (admission === undefined)
    return {
      key: subscriptionKey(method, params, UNDECLARED, caller),
      limit: PRODUCT_API_LIMITS.SUBSCRIPTION_HOLDERS_PER_KEY,
      class: "one",
      declared: false,
    };
  return {
    key: subscriptionKey(method, params, admission, caller),
    limit: holdersOf(admission, params, caller),
    class: admission.class,
    declared: true,
  };
}
