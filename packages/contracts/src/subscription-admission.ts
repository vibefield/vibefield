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
//
// RED (item 476's first contracts commit): the types and the plugin entry stand, the table is
// empty and nothing keys yet, so the rows of `subscription-admission.test.ts` fail by their own
// assertions. The next commit declares the 31 rows.

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

/** Item 476 — the admission of every product subscription row of `METHODS`, by method. Not
 * declared yet. */
export const SUBSCRIPTION_ADMISSION: Readonly<Record<string, SubscriptionAdmission>> = {};

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

/** Item 476 — a subscription's key. Not declared yet. */
export function subscriptionKey(
  _method: string,
  _params: unknown,
  _admission: SubscriptionAdmission,
  _caller: SubscriptionCaller,
): string {
  throw new Error("subscription admission is not declared yet");
}

/** Item 476 — what the door counts for an ask, and against what. Not declared yet. */
export function resolveSubscriptionAdmission(
  _method: string,
  _params: unknown,
  _caller: SubscriptionCaller,
): ResolvedSubscriptionAdmission {
  throw new Error("subscription admission is not declared yet");
}
