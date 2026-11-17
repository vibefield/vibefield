// @vitest-environment happy-dom
/**
 * Extensions, its feed refused (item 476). Every Extensions page reads one
 * feed, `agents.extensions.subscribe`. When fieldd refuses it the page says its
 * own line, "Could not read what the agents hold.", and none of fieldd's words
 * for why: the reason is an internal, and a feed refused for room asks again
 * by itself. The controller is mounted as extensions-settings.test.tsx mounts
 * it, over a client whose subscribe is refused.
 */

import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileExtensions } from "../src/panels/agents/ExtensionsSection";

// The window's terminal pool is not here: a sign-in's pane is a stand-in, as in
// extensions-settings.test.tsx (no row here opens one).
vi.mock("../src/panels/agents/SignInTerminal", () => ({
  SignInTerminal: ({ terminal }: { terminal: { sessionId: string } }) =>
    createElement("div", { "data-sign-in-pane": terminal.sessionId }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  // the feed's own asking-again runs on timers: none is waited for here
  vi.useFakeTimers();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

async function mount(element: ReturnType<typeof createElement>): Promise<void> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(element));
}

/** The subscribe's answer reaches the page: turns of the microtask queue, never a wait. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let hop = 0; hop < 8; hop += 1) await Promise.resolve();
  });
}

describe("ProfileExtensions, its feed refused (item 476)", () => {
  it("says its own line for a feed fieldd refused for room, and none of fieldd's words for why", async () => {
    // fieldd's refusal of a subscribe for want of room, as the window's client hands it on
    const subscribe = vi.fn(async (_method: string, _params: unknown) => {
      throw Object.assign(new Error("this connection holds too many live subscriptions"), {
        kind: "RESOURCE_EXHAUSTED",
        details: { resource: "subscriptions", limit: 8 },
      });
    });
    const client = {
      status: "ready",
      onStatusChange: () => () => undefined,
      request: vi.fn(async () => ({})),
      subscribe,
    } as unknown as FielddClient;
    await mount(
      createElement(
        FielddProvider,
        { client },
        createElement(ProfileExtensions, { set: "work", profile: "Work" }),
      ),
    );
    await settle();
    // the refusal is the page's feed's
    expect(subscribe.mock.calls[0]?.slice(0, 2)).toEqual([
      "agents.extensions.subscribe",
      { set: "work" },
    ]);
    // the head alone: no dash, and nothing after it
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not read what the agents hold.",
    );
    // fieldd's reason is nowhere on the page
    expect(container?.textContent).not.toMatch(/connection|subscriptions/iu);
  });
});
