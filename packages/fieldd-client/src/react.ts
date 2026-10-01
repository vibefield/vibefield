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

export interface SubscriptionState<T> {
  status: "loading" | "live" | "error";
  data: T | null;
  error: Error | null;
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

/** Subscribe for the lifetime of the component; every event replaces `data`. */
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
    let cancelled = false;
    let unsub: (() => void) | null = null;
    setState({ status: "loading", data: null, error: null });
    const choices: SubscribeOptions = {
      ...(supplies ? { params: () => (optsRef.current?.params ?? (() => params))() } : {}),
      ...(ownsRefusal
        ? {
            onReplayFailed: (error: FielddRpcError) => {
              if (cancelled) return;
              setState((prior) => ({ status: "error", data: prior.data, error }));
              optsRef.current?.onReplayFailed?.(error);
            },
          }
        : {}),
    };
    const onEvent = (payload: unknown): void => {
      if (!cancelled) setState({ status: "live", data: payload as T, error: null });
    };
    // no options, no fourth argument: the call is exactly what it was
    (supplies || ownsRefusal
      ? client.subscribe(method, params, onEvent, choices)
      : client.subscribe(method, params, onEvent)
    )
      .then((res) => {
        if (cancelled) {
          res.unsubscribe();
          return;
        }
        unsub = res.unsubscribe;
        setState({ status: "live", data: res.snapshot as T, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: "error", data: null, error: e as Error });
      });
    return () => {
      cancelled = true;
      unsub?.();
    };
    // params participates via paramsKey (stable identity for object literals)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, method, paramsKey, supplies, ownsRefusal]);

  return state;
}
