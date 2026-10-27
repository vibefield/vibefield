// @vitest-environment happy-dom

import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FieldHost, setHost } from "../src/host";
import { SetupSheet } from "../src/setup/SetupSheet";

// AO-D10 (track AO, AO-2) — Finish setting up's sheet: the Setup Assistant's own
// panes over the app, one put-off step after another. It is modal while open —
// its keys are its own — and it closes when nothing is left to ask. Its panes'
// words are their owners' (the Connect pane is track TS's), so nothing here
// reads them.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noopLogger: FieldHost["logger"] = {
  child: () => noopLogger,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  isLevelEnabled: () => false,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

/** Who is finishing setup — the face the Connect pane is drawn around (TS-2). */
const ME = { face: { emoji: "🦊" }, seed: "01J8Z3K6W9QX2M4N7P5R8T1V3B" };

function fieldd(): FielddClient {
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string) => {
      if (method === "user.link.subscribe") {
        return {
          subId: "user-link",
          snapshot: {
            link: null,
            meshEnabled: false,
            nodeState: null,
            authUrl: null,
            linkState: "offline",
            linkDetail: null,
          },
          unsubscribe: (): void => undefined,
        };
      }
      // TS-2 — the Connect pane reads the account's devices for its arrival
      if (method === "device.subscribe") {
        return { subId: "devices", snapshot: [], unsubscribe: (): void => undefined };
      }
      throw new Error(`unexpected subscription: ${method}`);
    }),
    request: vi.fn(async () => ({ ok: true })),
  } as unknown as FielddClient;
}

async function open(onClose: () => void): Promise<FielddClient> {
  setHost({
    logger: noopLogger,
    getConnection: async () => ({ port: 1, token: "test" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
  });
  const client = fieldd();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(
        FielddProvider,
        { client },
        createElement(SetupSheet, { me: ME, steps: ["devices"], onClose }),
      ),
    );
  });
  return client;
}

const sheet = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="Finish setting up"]');

describe("Finish setting up's sheet (AO-D10)", () => {
  it("opens the put-off step's own pane on the wizard's glass, over the app, holding focus", async () => {
    const client = await open(vi.fn());
    expect(sheet()?.getAttribute("aria-modal")).toBe("true");
    expect(sheet()?.querySelector(".vf-wizard-shell")).not.toBeNull();
    // The Connect pane's own controller is live under it (track TS's pane).
    const subscribed = vi.mocked(client.subscribe).mock.calls.map(([method]) => method);
    expect(subscribed).toContain("user.link.subscribe");
    expect(document.activeElement).toBe(sheet());
  });

  it("closes on Escape and on the scrim, and on neither inside its glass", async () => {
    const onClose = vi.fn();
    await open(onClose);
    await act(async () => {
      sheet()
        ?.querySelector(".vf-wizard-shell")
        ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      sheet()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes by itself when nothing is left to ask", async () => {
    const onClose = vi.fn();
    setHost({
      logger: noopLogger,
      getConnection: async () => ({ port: 1, token: "test" }),
      onPrepareClose: () => () => undefined,
      completeClose: () => undefined,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          FielddProvider,
          { client: fieldd() },
          createElement(SetupSheet, { me: ME, steps: [], onClose }),
        ),
      );
    });
    expect(sheet()).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
