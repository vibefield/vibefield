import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FielddClient, FielddClientStatus, FielddRpcError, SubscribeOptions } from "./client";
import { attachSubscription, type SubscriptionState } from "./feeds";

export type { SubscriptionState } from "./feeds";

// React bindings (design-03 A6): thin, hook-first. No JSX in this file so the
// core package needs no JSX toolchain — the desktop renderer brings its own.

const Ctx = createContext<FielddClient | null>(null);

export function FielddProvider(props: { client: FielddClient; children?: ReactNode }) {
  return createElement(Ctx.Provider, { value: props.client }, props.children);
}

export function useFielddClient(): FielddClient {
  const c = useContext(Ctx);
  if (!c) throw new Error("useFielddClient must be used inside <FielddProvider>");
  return c;
}

export function useFielddStatus(): FielddClientStatus {
  const client = useFielddClient();
  return useSyncExternalStore(
    (cb) => client.onStatusChange(cb),
    () => client.status,
  );
}

/** DS-6b (2026-10-01) — S3's per-subscription choices, passed through to
 * `FielddClient.subscribe` (`SubscribeOptions`). Read when the client asks, so
 * a caller's inline arrows may change identity every render without
 * re-subscribing. */
export interface UseSubscriptionOptions {
  /** what a socket blip's REPLAY asks with, read when the replay is sent (a
   * resumable subscription's CURRENT cursor); the first replay after a render
   * reads that render's supplier */
  params?: () => unknown;
  /** the daemon REFUSED this subscription's replay: it is over on the client.
   * The hook reads `error` (the last data kept beside it — never shown as
   * live again), then hands the error to this owner, which decides what
   * follows. Without one, the client's own rule stands (a retryable refusal
   * is re-asked by the client alone; any other ends the subscription). */
  onReplayFailed?: (error: FielddRpcError) => void;
}

/** Subscribe for the lifetime of the component; every event replaces `data`.
 *
 * Item 467 (2026-11-16): with no options, every hook on this client asking the
 * same method with the same params (keyed by `feedKey`: key order does not
 * matter) holds ONE shared wire subscription: a later hook sees the current
 * value at once, and the last one to unmount unsubscribes. A shared feed the
 * daemon refused for want of room asks once more when this client next gives
 * a subscription up. With options it stays the owner's own subscription. */
export function useSubscription<T = unknown>(
  method: string,
  params?: unknown,
  opts?: UseSubscriptionOptions,
): SubscriptionState<T> {
  const client = useFielddClient();
  const [state, setState] = useState<SubscriptionState<T>>({
    status: "loading",
    data: null,
    error: null,
  });
  const paramsKey = JSON.stringify(params ?? null);
  // the latest options, read when the client asks (see UseSubscriptionOptions)
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const supplies = opts?.params !== undefined;
  const ownsRefusal = opts?.onReplayFailed !== undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: params is deliberately keyed by its JSON (paramsKey) so object-identity churn never resubscribes; the options are read through optsRef
  useEffect(() => {
    setState({ status: "loading", data: null, error: null });
    // no options: the shared feed, asked with no fourth argument (the call is
    // exactly what it was); options: the owner's own, read through optsRef
    const choices: SubscribeOptions | undefined =
      supplies || ownsRefusal
        ? {
            ...(supplies ? { params: () => (optsRef.current?.params ?? (() => params))() } : {}),
            ...(ownsRefusal
              ? {
                  onReplayFailed: (error: FielddRpcError) =>
                    optsRef.current?.onReplayFailed?.(error),
                }
              : {}),
          }
        : undefined;
    // the release, run as this effect's cleanup; a holder hears nothing after it
    return attachSubscription(
      client,
      method,
      params,
      (next) => setState(next as SubscriptionState<T>),
      choices,
    );
    // params participates via paramsKey (stable identity for object literals)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, method, paramsKey, supplies, ownsRefusal]);

  return state;
}
