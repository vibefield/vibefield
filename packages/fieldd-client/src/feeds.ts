import type { FielddClient, FielddRpcError, SubscribeOptions, Subscription } from "./client";

// Item 467 (2026-11-16) — one wire subscription per feed. A window talks to
// fieldd over ONE client, and fieldd gives a connection 32 live subscriptions
// (`PRODUCT_API_LIMITS.SUBSCRIPTIONS_PER_CONNECTION`, an EL7 budget). Every
// `useSubscription` used to open its own, so the frame and a Settings page
// held the same feeds five and six times over, and the 33rd subscribe — the
// last part of the page to mount — was refused for good. Here hooks asking the
// same method with the same params HOLD one shared subscription, counted by
// its holders: the first opens it, a later one is handed the current value at
// once, the last one's leaving gives it back. `FielddClient.subscribe` keeps
// its own contract (one call, one wire subscription) for every other caller.
// *Corrected 2026-11-16 (item 476): since item 476 fieldd admits a subscription
// by its key (the method and the identity params its row declares in
// contracts' `SUBSCRIPTION_ADMISSION`), not from a pool of 32, and
// `PRODUCT_API_LIMITS.SUBSCRIPTIONS_PER_CONNECTION` is retired. A refusal for
// room is now a key held past its holders, or a `bounded` method past its
// bound. The park-and-ask-again below still answers such a refusal, so no
// behaviour here moves.*
//
// React-free on purpose: the hook in react.ts is a line over `attachSubscription`,
// so every rule here is read by a test without a DOM.

/** What a holder sees: the feed's last value, or why there is none. */
export interface SubscriptionState<T> {
  status: "loading" | "live" | "error";
  data: T | null;
  error: Error | null;
}

type Hears = (state: SubscriptionState<unknown>) => void;

/** A feed's identity: the method and the params AS THE WIRE CARRIES THEM, with
 * object keys sorted (fieldd's federated subscriptions key the same way,
 * `canonical` in federated-subs.ts), so `{a, b}` and `{b, a}` share one feed.
 * An undefined params is its own feed: the frame omits the member, and `{}` or
 * `null` is a different frame a handler may read differently. A member whose
 * value is undefined is dropped from the frame, so it is dropped here too. */
export function feedKey(method: string, params: unknown): string {
  const wire = params === undefined ? undefined : JSON.stringify(params, sortedKeys);
  return JSON.stringify([method, wire ?? null]);
}

function sortedKeys(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const name of Object.keys(value).sort()) {
    sorted[name] = (value as Record<string, unknown>)[name];
  }
  return sorted;
}

/** The daemon refused a subscribe for want of ROOM: the connection holds its
 * budget (product-api's `subscriptionBudgetRefusal`). Read by shape, since a
 * refusal may come from a stand-in client as much as from this one.
 * *Corrected 2026-11-16 (item 476): there is no budget since item 476. The
 * door's function is `subscriptionAdmissionRefusal`, and room runs out when the
 * connection holds a key at its holders, or a `bounded` method at its bound.
 * The refusal's shape is the same (`RESOURCE_EXHAUSTED`, with
 * `resource: "subscriptions"` and `limit` the bound that refused), so this
 * reads it as before and no behaviour moves.* */
function refusedForRoom(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const { kind, details } = error as { kind?: unknown; details?: unknown };
  if (kind !== "RESOURCE_EXHAUSTED" || details === null || typeof details !== "object") {
    return false;
  }
  return (details as { resource?: unknown }).resource === "subscriptions";
}

/** The client's count of given-up subscriptions, or undefined when the client
 * offers none (a stand-in that implements `subscribe` alone): an unknown count
 * never reads as room made. */
function releasesOf(client: FielddClient): number | undefined {
  const count = (client as { subscriptionsReleased?: unknown }).subscriptionsReleased;
  return typeof count === "number" ? count : undefined;
}

function hasReleaseSeam(client: FielddClient): boolean {
  const seam = (client as { onSubscriptionReleased?: unknown }).onSubscriptionReleased;
  return typeof seam === "function";
}

const live = (data: unknown): SubscriptionState<unknown> => ({
  status: "live",
  data,
  error: null,
});

class SharedFeed {
  // plain fields, no parameter properties: client.ts's rule (strip-only erasure)
  private readonly client: FielddClient;
  private readonly method: string;
  private readonly params: unknown;
  private readonly forget: () => void;
  private readonly holders = new Set<Hears>();
  private state: SubscriptionState<unknown> = { status: "loading", data: null, error: null };
  private wire: Subscription | null = null;
  private asking = false;
  private closed = false;
  /** while refused for room: the client's release listener, to ask once more */
  private parked: (() => void) | null = null;

  constructor(client: FielddClient, method: string, params: unknown, forget: () => void) {
    this.client = client;
    this.method = method;
    this.params = params;
    this.forget = forget;
  }

  join(hears: Hears): void {
    this.holders.add(hears);
    // live, or refused for room (the answer stands until room is made): the
    // newcomer sees it at once
    if (this.state.status === "live" || this.parked !== null) {
      try {
        hears(this.state);
      } catch {
        // its own failure: it stays a holder, and its release still lets go
      }
      return;
    }
    // refused for any other reason: a newcomer asks again, as a fresh mount
    // always did, and its answer reaches every holder. Loading: it waits.
    if (this.state.status === "error" && !this.asking) this.ask();
  }

  leave(hears: Hears): void {
    if (!this.holders.delete(hears) || this.holders.size > 0) return;
    // The last holder: the feed ends NOW, out of the registry first, so a
    // holder mounting in the same tick opens a feed of its own rather than
    // joining one being torn down. An ask still out is given back by its own
    // answer (`closed`), so neither order leaks a wire subscription.
    this.closed = true;
    this.forget();
    this.unpark();
    const wire = this.wire;
    this.wire = null;
    wire?.unsubscribe();
  }

  ask(): void {
    const before = releasesOf(this.client);
    this.asking = true;
    this.client
      .subscribe(this.method, this.params, (payload) => this.tell(live(payload)), {
        // the client ended it for good (a replay refused, nobody re-asking)
        onEnded: (error) => this.ended(error),
      })
      .then(
        (sub) => {
          this.asking = false;
          if (this.closed) {
            sub.unsubscribe();
            return;
          }
          this.wire = sub;
          this.tell(live(sub.snapshot));
        },
        (error: unknown) => {
          this.asking = false;
          if (this.closed) return;
          const room = refusedForRoom(error);
          const after = releasesOf(this.client);
          // room was made while this ask was out: the refusal is older than the
          // room, so that fall is this feed's one ask
          if (room && before !== undefined && after !== undefined && after !== before) {
            this.ask();
            return;
          }
          this.tell({ status: "error", data: null, error: error as Error });
          if (room) this.park();
        },
      );
  }

  /** The client ended the feed's subscription at a replay: every holder hears
   * it with the last data beside it (never shown as live again), the wire
   * handle goes, and the feed's rules for a refusal stand — for room it waits
   * for a release; otherwise the next holder to join asks afresh. */
  private ended(error: FielddRpcError): void {
    // only a subscription this feed stands on: an ended one is gone from the
    // client, so no earlier ask's can be heard after a new one
    if (this.closed || this.wire === null) return;
    this.wire = null;
    this.tell({ status: "error", data: this.state.data, error });
    if (refusedForRoom(error)) this.park();
  }

  /** Refused for room: ask ONCE more at the next release on this client —
   * no timer, and a second refusal waits for the release after that. A client
   * with no release seam (a stand-in) parks nothing: its holders keep the
   * refusal, and the next holder to join asks again. */
  private park(): void {
    if (this.parked !== null || this.closed || !hasReleaseSeam(this.client)) return;
    this.parked = this.client.onSubscriptionReleased(() => {
      this.unpark();
      if (!this.closed) this.ask();
    });
  }

  private unpark(): void {
    const parked = this.parked;
    this.parked = null;
    parked?.();
  }

  private tell(state: SubscriptionState<unknown>): void {
    if (this.closed) return;
    this.state = state;
    for (const hears of [...this.holders]) {
      try {
        hears(state);
      } catch {
        // one holder's failure is its own: the others still hear
      }
    }
  }
}

const feedsOf = new WeakMap<FielddClient, Map<string, SharedFeed>>();

/** Hold the feed `(method, params)` on `client`: `hears` gets its current
 * value at once when there is one, then every value after. The returned
 * function lets go (idempotent); the last holder's letting go unsubscribes. */
export function holdFeed(
  client: FielddClient,
  method: string,
  params: unknown,
  hears: Hears,
): () => void {
  let feeds = feedsOf.get(client);
  if (feeds === undefined) {
    feeds = new Map();
    feedsOf.set(client, feeds);
  }
  const key = feedKey(method, params);
  let feed = feeds.get(key);
  const opening = feed === undefined;
  if (feed === undefined) {
    const registry = feeds;
    const made: SharedFeed = new SharedFeed(client, method, params, () => {
      if (registry.get(key) === made) registry.delete(key);
    });
    registry.set(key, made);
    feed = made;
  }
  // one holder per hold, even when a caller hands the same function twice
  const holder: Hears = (state) => hears(state);
  feed.join(holder);
  if (opening) feed.ask();
  const held = feed;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.leave(holder);
  };
}

/** The hook's subscription. With no `choices` it holds the shared feed. With
 * choices (DS-6b: a replay's params supplier, a refused replay's owner) it is
 * that owner's OWN subscription, exactly as before item 467: a supplier is one
 * owner's cursor and a refused replay is one owner's to recover, so neither can
 * be shared with a holder that did not ask for it. Returns the release. */
export function attachSubscription(
  client: FielddClient,
  method: string,
  params: unknown,
  hears: Hears,
  choices?: SubscribeOptions,
): () => void {
  if (choices === undefined) return holdFeed(client, method, params, hears);
  let cancelled = false;
  let unsub: (() => void) | null = null;
  let data: unknown = null;
  const say = (state: SubscriptionState<unknown>): void => {
    if (cancelled) return;
    data = state.data;
    hears(state);
  };
  const owner = choices.onReplayFailed;
  const own: SubscribeOptions = {
    ...(choices.params !== undefined ? { params: choices.params } : {}),
    ...(owner !== undefined
      ? {
          onReplayFailed: (error: FielddRpcError) => {
            if (cancelled) return;
            // the last data stays beside the error, never shown as live again
            say({ status: "error", data, error });
            owner(error);
          },
        }
      : {}),
  };
  client
    .subscribe(method, params, (payload) => say(live(payload)), own)
    .then((res) => {
      if (cancelled) {
        res.unsubscribe();
        return;
      }
      unsub = res.unsubscribe;
      say(live(res.snapshot));
    })
    .catch((e: unknown) => say({ status: "error", data: null, error: e as Error }));
  return () => {
    cancelled = true;
    unsub?.();
  };
}
