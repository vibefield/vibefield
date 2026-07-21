import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { FielddClient, FielddClientStatus } from "./client";

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

/** Subscribe for the lifetime of the component; every event replaces `data`. */
export function useSubscription<T = unknown>(method: string, params?: unknown): SubscriptionState<T> {
  const client = useFielddClient();
  const [state, setState] = useState<SubscriptionState<T>>({ status: "loading", data: null, error: null });
  const paramsKey = JSON.stringify(params ?? null);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    setState({ status: "loading", data: null, error: null });
    client
      .subscribe(method, params, (payload) => {
        if (!cancelled) setState({ status: "live", data: payload as T, error: null });
      })
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
  }, [client, method, paramsKey]);

  return state;
}
