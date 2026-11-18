import type { FielddClient, FielddRpcError, SubscribeOptions } from "./client";
import { reaskDelayMs, refusedForRoom } from "./reask";

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
// *Item 476, second stage (2026-11-16): one behaviour here does move. A feed
// refused for room no longer waits for a release alone: while it has a holder
// it also asks again by itself on `REASK_BACKOFF` (reask.ts: 1 s, 2, 4, 8, 16,
// then every 30 s), so a refusal no release on this client would ever answer
// heals without a remount.*
// *Item 473 (2026-11-18): a feed is held on any client that subscribes
// (`FeedClient`), so a door's narrow client holds one too. A feed is keyed by
// the client it is held on, so holders share one only on the same client, and
// only the window's own client lends the release seam.*
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

/** What a shared feed asks of its client (item 473): its `subscribe` alone, so
 * a door's narrow client holds a feed too. The window's own client (a
 * `FielddClient`) also lends its release seam, read only where it is there. */
export interface FeedClient {
  subscribe(
    method: string,
    params: unknown,
    onFrame: (payload: unknown) => void,
    opts?: SubscribeOptions,
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }>;
}

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

/** The client's count of given-up subscriptions, or undefined when the client
 * offers none (a stand-in that implements `subscribe` alone): an unknown count
 * never reads as room made. */
function releasesOf(client: FeedClient): number | undefined {
  const count = (client as { subscriptionsReleased?: unknown }).subscriptionsReleased;
  return typeof count === "number" ? count : undefined;
}

function hasReleaseSeam(
  client: FeedClient,
): client is FeedClient & Pick<FielddClient, "onSubscriptionReleased"> {
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
  private readonly client: FeedClient;
  private readonly method: string;
  private readonly params: unknown;
  private readonly forget: () => void;
  private readonly holders = new Set<Hears>();
  private state: SubscriptionState<unknown> = { status: "loading", data: null, error: null };
  private wire: { unsubscribe: () => void } | null = null;
  private asking = false;
  private closed = false;
  /** while refused for room: the client's release listener, to ask once more */
  private parked: (() => void) | null = null;
  /** while refused for room: the ONE timer of the backoff's next ask (item 476) */
  private reask: ReturnType<typeof setTimeout> | null = null;
  /** the refusals for room since the feed was last granted: the backoff's step */
  private step = 0;

  constructor(client: FeedClient, method: string, params: unknown, forget: () => void) {
    this.client = client;
    this.method = method;
    this.params = params;
    this.forget = forget;
  }

  join(hears: Hears): void {
    this.holders.add(hears);
    // live, or refused for room (the answer stands until room is made or the
    // backoff's next ask is answered, item 476): the newcomer sees it at once
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
    // an ask is going out, so the wait it ends is over: neither the release
    // listener nor the timer may send a second one beside it (item 476)
    this.unpark();
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
          // granted: the next refusal for room starts the backoff at its first step
          this.step = 0;
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
   * for a release or the backoff's next step, as a refused ask does (item 476:
   * it was live, so the step is the first); otherwise the next holder to join
   * asks afresh. */
  private ended(error: FielddRpcError): void {
    // only a subscription this feed stands on: an ended one is gone from the
    // client, so no earlier ask's can be heard after a new one
    if (this.closed || this.wire === null) return;
    this.wire = null;
    this.tell({ status: "error", data: this.state.data, error });
    if (refusedForRoom(error)) this.park();
  }

  /** Refused for room: ask again at the next release on this client, at once,
   * or at the backoff's next step (`reaskDelayMs`), whichever comes first. ONE
   * listener and ONE timer at most, and whichever of the two asks clears the
   * other (`ask` unparks first), so a release and the timer never both ask for
   * one wait. A second refusal parks again one step on, and waits for the release
   * or the step after that; a grant puts the step back to the first. A client
   * with no release seam (a stand-in) has no listener, so the next holder to
   * join still asks again at once; it has the timer all the same, which does
   * not depend on the seam.
   * *Corrected 2026-11-16 (item 476, second stage): this said "ask ONCE more at
   * the next release on this client — no timer", and that a stand-in "parks
   * nothing: its holders keep the refusal". With no timer, a refusal that no
   * release on this client answered stood until a remount.* */
  private park(): void {
    // an ask already out (a holder that joined from inside its own hearing of
    // this refusal) answers for itself: nothing waits to ask beside it
    if (this.closed || this.asking) return;
    if (this.parked === null && hasReleaseSeam(this.client)) {
      this.parked = this.client.onSubscriptionReleased(() => {
        this.unpark();
        if (!this.closed) this.ask();
      });
    }
    if (this.reask !== null) return;
    const wait = reaskDelayMs(this.step);
    this.step += 1;
    // the global's own timer, read at the call: a test's fake clock drives it
    this.reask = setTimeout(() => {
      this.reask = null;
      if (!this.closed && !this.asking) this.ask();
    }, wait);
  }

  /** The wait is over (an ask is going out, or the last holder left): the
   * release listener and the backoff's timer both go. */
  private unpark(): void {
    const parked = this.parked;
    this.parked = null;
    parked?.();
    if (this.reask === null) return;
    clearTimeout(this.reask);
    this.reask = null;
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

const feedsOf = new WeakMap<FeedClient, Map<string, SharedFeed>>();

/** Hold the feed `(method, params)` on `client`: `hears` gets its current
 * value at once when there is one, then every value after. The returned
 * function lets go (idempotent); the last holder's letting go unsubscribes.
 * Any client that subscribes holds one (item 473), and holders share it on the
 * same client alone. */
export function holdFeed(
  client: FeedClient,
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
