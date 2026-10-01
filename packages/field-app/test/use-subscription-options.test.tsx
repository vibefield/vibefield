// @vitest-environment happy-dom
/**
 * DS-6b (2026-10-01) — `useSubscription(method, params, opts?)` passes S3's two
 * per-subscription choices through to `FielddClient.subscribe`: the params a
 * socket blip's REPLAY asks with (read when the replay is sent — a resumable
 * subscription's current cursor), and the owner of a REFUSED replay. The hook
 * lives in fieldd-client (`react.ts`); its row lives here because field-app is
 * where a DOM renderer is already installed.
 */
import { type FielddClient, FielddRpcError, type SubscribeOptions } from "@vibefield/fieldd-client";
import {
  FielddProvider,
  type SubscriptionState,
  useSubscription,
} from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Call = [method: string, params: unknown, opts: SubscribeOptions | undefined, arity: number];

function fakeClient(calls: Call[]): FielddClient {
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (...args: unknown[]) => {
      calls.push([
        args[0] as string,
        args[1],
        args[3] as SubscribeOptions | undefined,
        args.length,
      ]);
      return { subId: "s1", snapshot: { n: 1 }, unsubscribe: (): undefined => undefined };
    }),
  } as unknown as FielddClient;
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render(client: FielddClient, probe: () => null): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(createElement(FielddProvider, { client }, createElement(probe)));
  });
}

describe("useSubscription — the options bag (DS-6b)", () => {
  it("passes the replay's params supplier and onReplayFailed through; a refused replay shows the error, then reaches its owner", async () => {
    const calls: Call[] = [];
    const client = fakeClient(calls);
    let cursor = 1;
    const failures: FielddRpcError[] = [];
    const seen: Array<SubscriptionState<{ n: number }>> = [];
    function Probe(): null {
      seen.push(
        useSubscription<{ n: number }>(
          "thing.subscribe",
          { table: "x" },
          {
            params: () => ({ table: "x", since: cursor }),
            onReplayFailed: (error) => failures.push(error),
          },
        ),
      );
      return null;
    }
    await render(client, Probe);
    expect(calls).toHaveLength(1);
    const [method, params, opts] = calls[0] ?? [];
    expect(method).toBe("thing.subscribe");
    expect(params).toEqual({ table: "x" });
    // read when the replay is SENT: the cursor as it is then
    expect(opts?.params?.()).toEqual({ table: "x", since: 1 });
    cursor = 7;
    expect(opts?.params?.()).toEqual({ table: "x", since: 7 });
    expect(seen.at(-1)).toMatchObject({ status: "live", data: { n: 1 } });

    const refusal = new FielddRpcError("UNAVAILABLE", "the catalog is not ready", true);
    await act(async () => {
      opts?.onReplayFailed?.(refusal);
    });
    expect(failures).toEqual([refusal]);
    // the subscription is over on the client: never shown as live again
    expect(seen.at(-1)).toMatchObject({ status: "error", error: refusal, data: { n: 1 } });
    expect(calls).toHaveLength(1); // the owner decides what follows, not the hook
  });

  it("with no options the call is what it always was — three arguments, the client's own replay rules", async () => {
    const calls: Call[] = [];
    function Probe(): null {
      useSubscription("thing.subscribe", { table: "x" });
      return null;
    }
    await render(fakeClient(calls), Probe);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[3]).toBe(3);
  });
});
