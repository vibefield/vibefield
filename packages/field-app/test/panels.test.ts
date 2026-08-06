// @vitest-environment happy-dom
/**
 * Smoke tests for the remaining canvas chrome. Each mounts against a REAL
 * `createCanvasEngine()`, survives engine steps, and unmounts cleanly.
 * `createElement` (not JSX) keeps this a `.ts` file. No `EngineProvider`: the
 * panels take the engine as a prop and read it directly (no `@ice/react` hooks).
 *
 * DOC-LESS by design: this app's standalone `vitest.config.ts` does not inherit
 * vite.config's `loro-crdt → loro-crdt/base64` alias, so `docs.create()` would
 * build a `LoroDoc` from the wrong loro build and throw. Doc-less construction
 * never touches loro at runtime, and the panels handle the doc-less case
 * (undo-status resource absent ⇒ flags false). The environment is happy-dom
 * (vitest.config + the docblock pragma above); the JSX transform for the `.tsx`
 * panels comes from vitest.config's `esbuild.jsx: "automatic"`.
 */
import { type CanvasEngine, createCanvasEngine } from "@vibecook/ice";
import { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FieldHost, setHost } from "../src/host";
import { NavigationBreadcrumbs } from "../src/hud/NavigationBreadcrumbs";
import { SettingsPanel } from "../src/panels";

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

setHost({
  logger: noopLogger,
  getConnection: async () => ({ port: 1, token: "test" }),
  onPrepareClose: () => () => undefined,
  completeClose: () => undefined,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let disposeEngine: (() => void) | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  disposeEngine?.();
  disposeEngine = null;
  document.body.innerHTML = "";
});

function makeEngine(): CanvasEngine {
  const engine = createCanvasEngine({});
  disposeEngine = () => engine.dispose();
  return engine;
}

function mount(node: ReactElement): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
}

describe("widgetlab panels", () => {
  it("SettingsPanel presents categorized pages and preserves the canvas tools", async () => {
    const engine = makeEngine();
    // SystemSection (diagnostics live inside Settings) reads the fieldd hooks —
    // a provider with a never-connected client renders the honest idle state.
    const client = new FielddClient({ url: "ws://127.0.0.1:1", token: "test" });
    mount(
      createElement(
        FielddProvider,
        { client },
        createElement(SettingsPanel, {
          engine,
          onClose: () => {},
        }),
      ),
    );

    expect(container?.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container?.textContent).toContain("Desktop behavior");
    expect(container?.textContent).toContain("Settings history");
    expect(container?.textContent).not.toContain("World grid");

    const category = (name: string): HTMLButtonElement | undefined =>
      Array.from(container?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
        (button) => button.getAttribute("aria-label") === `${name} settings`,
      );
    expect(category("General")?.getAttribute("aria-current")).toBe("page");
    expect(category("Account")).toBeDefined();
    expect(category("Appearance")).toBeDefined();
    expect(category("Canvas")).toBeDefined();
    expect(category("Plugins")).toBeDefined();
    expect(category("Mesh")).toBeDefined();
    expect(category("Diagnostics")).toBeDefined();
    expect(category("Advanced")).toBeDefined();

    act(() => category("Appearance")?.click());
    expect(container?.textContent).toContain("Theme");
    expect(container?.textContent).not.toContain("Canvas palette");
    expect(container?.textContent).not.toContain("Overlap feedback");

    act(() => category("Canvas")?.click());
    expect(container?.textContent).not.toContain("World grid");
    expect(container?.textContent).toContain("Zoom range");
    expect(container?.textContent).toContain("Card behavior");
    const numberInputs = container?.querySelectorAll('input[type="number"]');
    expect(numberInputs?.length ?? 0).toBeGreaterThan(0);

    act(() => category("Advanced")?.click());
    expect(container?.textContent).toContain("Breakpoint preview");
    expect(container?.textContent).toContain("Canvas stress test");
    // Stress buttons are disabled without a stressWidgetType.
    const buttons = Array.from(container?.querySelectorAll("button") ?? []);
    const stress = buttons.find((b) => b.textContent === "+50");
    expect(stress?.disabled).toBe(true);

    act(() => category("Mesh")?.click());
    expect(container?.textContent).toContain("Mesh network");
    expect(container?.textContent).toContain("devices");
    expect(container?.textContent).toContain("no devices yet");

    await act(async () => {
      category("Diagnostics")?.click();
      await import("../src/panels/DiagnosticsSection");
    });
    expect(container?.textContent).toContain("System status");
    expect(container?.textContent).toContain("connection");
    expect(container?.textContent).toContain("board");
  });

  it("routes settings undo through the global Loro history toolbar", async () => {
    const engine = makeEngine();
    const request = vi.fn(async (method: string) =>
      method === "storage.settings.undo" ? { applied: true } : { ok: true },
    );
    const client = {
      status: "ready",
      onStatusChange: () => () => undefined,
      subscribe: vi.fn(async (method: string) => {
        if (method !== "storage.appPreferences.subscribe") {
          throw new Error(`unexpected subscription: ${method}`);
        }
        return {
          subId: "app-preferences",
          snapshot: { showTray: true, backgroundShell: true },
          unsubscribe: () => undefined,
        };
      }),
      request,
    } as unknown as FielddClient;

    mount(
      createElement(
        FielddProvider,
        { client },
        createElement(SettingsPanel, {
          engine,
          onClose: () => {},
        }),
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });

    const undo = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Undo settings change"]',
    );
    await act(async () => undo?.click());
    expect(request).toHaveBeenCalledWith("storage.settings.undo", {});
    expect(container?.textContent).toContain("Last synced change undone");
  });

  it("NavigationBreadcrumbs renders the root state at depth 0", () => {
    const engine = makeEngine();
    mount(createElement(NavigationBreadcrumbs, { engine }));

    // Root crumb present; back button disabled at the root of the nav stack.
    expect(container?.textContent).toContain("Root");
    const back = container?.querySelector("button") as HTMLButtonElement | null;
    expect(back).not.toBeNull();
    expect(back?.disabled).toBe(true);
  });
});
