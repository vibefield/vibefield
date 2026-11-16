// @vitest-environment happy-dom
/**
 * Item 467 (2026-11-16) — `useSubscription` under a real React renderer:
 * hooks on one client asking the same method with the same params share ONE
 * `subscribe`. Before, every mounted hook opened its own, and one window held
 * the same feeds five and six times over against fieldd's 32 per connection.
 * The hook lives in fieldd-client (`react.ts` over `feeds.ts`); this row lives
 * here because field-app is where a DOM renderer is installed. It names only
 * `useSubscription`, `FielddProvider` and a stand-in client, so it reads the
 * hook as it ships, before and after the change.
 */
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider, useSubscription } from "@vibefield/fieldd-client/react";
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type OnEvent = (payload: unknown, kind: "snapshot" | "delta") => void;

/** A daemon's one feed behind a stand-in client: every subscribe is answered
 * with the feed's CURRENT value, and an event reaches every subscription. */
function standIn() {
  let current: unknown = { v: 0 };
  const handlers: OnEvent[] = [];
  const unsubscribe = vi.fn();
  const subscribe = vi.fn(async (_method: string, _params: unknown, onEvent: OnEvent) => {
    handlers.push(onEvent);
    return { subId: `s${handlers.length}`, snapshot: current, unsubscribe };
  });
  const client = {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe,
  } as unknown as FielddClient;
  const emit = (payload: unknown): void => {
    current = payload;
    for (const handler of handlers) handler(payload, "delta");
  };
  return { client, subscribe, unsubscribe, emit };
}

function Probe(props: { id: string }) {
  const feed = useSubscription<{ v: number }>("thing.subscribe", { a: 1 });
  return createElement(
    "span",
    { "data-probe": props.id },
    feed.status === "live" ? `v${feed.data?.v}` : feed.status,
  );
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function show(client: FielddClient, ids: string[], strict = false): Promise<void> {
  if (host === null) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  const probes = ids.map((id) => createElement(Probe, { key: id, id }));
  const tree = createElement(FielddProvider, { client }, ...probes);
  await act(async () => {
    root?.render(strict ? createElement(StrictMode, null, tree) : tree);
  });
}

const shown = (id: string): string | null | undefined =>
  host?.querySelector(`[data-probe="${id}"]`)?.textContent;

describe("useSubscription — one feed, one subscribe (item 467)", () => {
  it("two hooks on one feed: subscribe is called ONCE and both render the snapshot", async () => {
    const daemon = standIn();
    await show(daemon.client, ["a", "b"]);
    expect(daemon.subscribe).toHaveBeenCalledTimes(1); // main: 2
    expect(shown("a")).toBe("v0");
    expect(shown("b")).toBe("v0");
  });

  it("a third hook mounted after an event renders the CURRENT value at once and asks nothing", async () => {
    const daemon = standIn();
    await show(daemon.client, ["a", "b"]);
    await act(async () => daemon.emit({ v: 2 }));
    expect(shown("a")).toBe("v2");
    await show(daemon.client, ["a", "b", "c"]);
    expect(shown("c")).toBe("v2");
    expect(daemon.subscribe).toHaveBeenCalledTimes(1); // main: 3
    await act(async () => daemon.emit({ v: 3 }));
    expect([shown("a"), shown("b"), shown("c")]).toEqual(["v3", "v3", "v3"]);
  });

  it("unmounting two of three sends no unsubscribe; unmounting the last sends ONE", async () => {
    const daemon = standIn();
    await show(daemon.client, ["a", "b", "c"]);
    await show(daemon.client, ["c"]);
    expect(daemon.unsubscribe).not.toHaveBeenCalled(); // main: 2
    expect(shown("c")).toBe("v0");
    await show(daemon.client, []);
    expect(daemon.unsubscribe).toHaveBeenCalledTimes(1); // main: 3
  });

  it("StrictMode's double mount ends live, with subscribes minus unsubscribes = 1", async () => {
    const daemon = standIn();
    await show(daemon.client, ["a"], true);
    const subscribes = daemon.subscribe.mock.calls.length;
    const unsubscribes = daemon.unsubscribe.mock.calls.length;
    expect(subscribes - unsubscribes).toBe(1);
    expect(shown("a")).toBe("v0");
    await act(async () => daemon.emit({ v: 4 }));
    expect(shown("a")).toBe("v4");
  });
});
