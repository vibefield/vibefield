import type {
  PluginAttachmentPool,
  PluginSurfaceHandle,
  PluginSurfaceViewProps,
} from "@vibefield/plugin-sdk";
import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import { activateWithMockHost, type MockLiveSurface } from "@vibefield/plugin-sdk/testing";
import { act, type ComponentType, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserPageView, normalizeAddress } from "../src/BrowserPageView";
import { browserSurfaceOptions, surfaceKeyFor } from "../src/BrowserPageWidget";
import type { BrowserPageCommit } from "../src/index";

/**
 * DT-3d — the browser card, against the SDK's own mock host.
 *
 * The card is split the way UI_SYSTEM asks: `BrowserPageView` is the whole face
 * and takes a handle plus the pool's `SurfaceView`, so THIS suite mounts the
 * shipping component rather than a stand-in, and the controller's one untested
 * remainder (the ICE prop read) is the part a plugin cannot exercise without an
 * engine. The handle and the view both come from `activateWithMockHost`, so
 * what the card talks to here is the same shape the window hands it.
 */

// The repo's DOM-test idiom: without this React runs the tree outside act
// semantics, effects flush on their own schedule, and an assertion about what
// a state change did can pass for the wrong reason.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTITY = 42 as unknown as Parameters<typeof surfaceKeyFor>[0];

interface Probe {
  pool: PluginAttachmentPool;
  handle: PluginSurfaceHandle;
  surface: MockLiveSurface;
}

/** Every mock activation this file opened, closed in teardown AFTER the tree is
 * gone — an activation closing under a mounted card would release its handle
 * into a live subtree, which is a React update outside any act boundary and a
 * lifecycle no window performs (the window unmounts, then deactivates). */
const sessions: Array<() => Promise<void>> = [];

/** Acquire one card's surface through the REAL options builder, so every
 * assertion about what the pool was asked for is an assertion about production. */
async function probe(initialUrl = "about:blank"): Promise<Probe> {
  let pool: PluginAttachmentPool | null = null;
  let handle: PluginSurfaceHandle | null = null;
  const session = await activateWithMockHost(
    defineRendererPlugin({
      activate(ctx) {
        pool = ctx.pool;
        handle = ctx.pool.liveSurface(browserSurfaceOptions(ENTITY, initialUrl));
      },
    }),
  );
  sessions.push(session.close);
  const surface = session.liveSurfaces.get(surfaceKeyFor(ENTITY));
  if (pool === null || handle === null || surface === undefined) {
    throw new Error("mock host did not hand out the card's surface");
  }
  return { pool, handle, surface };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(node: ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

afterEach(async () => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  for (const close of sessions.splice(0)) await close();
});

interface Card {
  view: HTMLDivElement;
  commits: BrowserPageCommit[];
}

function mountCard(p: Probe, props?: { url?: string; title?: string; showChrome?: boolean }): Card {
  const commits: BrowserPageCommit[] = [];
  const view = render(
    <BrowserPageView
      handle={p.handle}
      SurfaceView={p.pool.SurfaceView as ComponentType<PluginSurfaceViewProps>}
      url={props?.url ?? "about:blank"}
      title={props?.title ?? ""}
      showChrome={props?.showChrome ?? true}
      onCommit={(commit) => commits.push(commit)}
    />,
  );
  return { view, commits };
}

const address = (view: HTMLElement): HTMLInputElement => {
  const field = view.querySelector<HTMLInputElement>("input[aria-label='Address']");
  if (field === null) throw new Error("no address field");
  return field;
};

const button = (view: HTMLElement, title: string): HTMLButtonElement => {
  const found = [...view.querySelectorAll("button")].find((b) => b.getAttribute("title") === title);
  if (found === undefined) throw new Error(`no ${title} button`);
  return found as HTMLButtonElement;
};

/** Put the surface where a real one is before a user can steer it. */
function goLive(p: Probe, url = "https://example.invalid/start"): void {
  act(() => {
    p.surface.set("live");
    p.surface.setBrowser({ url, loading: false, canGoBack: false, canGoForward: false });
  });
}

function type(field: HTMLInputElement, text: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(field) as object,
      "value",
    )?.set;
    setter?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(field: HTMLElement, key: string): void {
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function click(target: HTMLElement): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("normalizeAddress", () => {
  it("gives schemeless text the modern default and leaves real schemes alone", () => {
    expect(normalizeAddress("example.com")).toBe("https://example.com");
    expect(normalizeAddress("  example.com/a b  ")).toBe("https://example.com/a b");
    expect(normalizeAddress("http://example.com")).toBe("http://example.com");
    expect(normalizeAddress("about:blank")).toBe("about:blank");
  });

  it("refuses what the wire cannot carry, rather than letting navigate throw", () => {
    expect(normalizeAddress("")).toBeNull();
    expect(normalizeAddress("   ")).toBeNull();
    expect(normalizeAddress("https://example.com/\u0007")).toBeNull();
    expect(normalizeAddress(`https://example.com/${"a".repeat(8_192)}`)).toBeNull();
  });
});

describe("the browser card's surface claim", () => {
  it("names one attachment per card, and reuses that same name", async () => {
    const p = await probe("https://example.invalid/home");
    const asked = p.surface.options;

    expect(asked.key).toBe(surfaceKeyFor(ENTITY));
    // The reuse key IS the key: which attachment and which runtime are one
    // question for a card — its page.
    expect(asked.reuseKey).toBe(asked.key);
    expect(asked.source).toEqual({
      kind: "browser",
      initialUrl: "https://example.invalid/home",
      profile: { mode: "memory", ref: surfaceKeyFor(ENTITY) },
      logicalViewport: { width: 1024, height: 768 },
    });
    expect(asked.initialDemand).toEqual({
      mode: "live",
      targetFps: 30,
      priority: 50,
      interactive: false,
    });
  });

  it("carries no runtime identity into anything durable (DT-D7)", async () => {
    const p = await probe();
    // The options a card persists nothing from: what it asks for is derived
    // from the entity and the durable url, and nothing else.
    expect(JSON.stringify(p.surface.options)).not.toContain("surfaceId");
    expect(JSON.stringify(p.surface.options)).not.toContain("ticket");
  });
});

describe("the browser card's chrome", () => {
  it("submits the address bar as a normalized go, and stores the intent", async () => {
    const p = await probe();
    const card = mountCard(p);
    goLive(p);

    type(address(card.view), "example.com/docs");
    press(address(card.view), "Enter");

    expect(p.surface.navigations).toEqual([{ action: "go", url: "https://example.com/docs" }]);
    // The submit IS the intent: durable whether or not the page ever loads.
    expect(card.commits).toEqual([{ url: "https://example.com/docs" }]);
  });

  it("keeps back and forward disabled until the producer says they are reachable", async () => {
    const p = await probe();
    const card = mountCard(p);

    // Attaching: no committed truth, so neither direction is offered.
    expect(button(card.view, "Nothing behind this page").disabled).toBe(true);
    expect(button(card.view, "Nothing ahead of this page").disabled).toBe(true);

    goLive(p);
    expect(button(card.view, "Nothing behind this page").disabled).toBe(true);

    act(() => {
      p.surface.setBrowser({
        url: "https://example.invalid/start",
        loading: false,
        canGoBack: true,
        canGoForward: false,
      });
    });

    expect(button(card.view, "Back").disabled).toBe(false);
    expect(button(card.view, "Nothing ahead of this page").disabled).toBe(true);

    click(button(card.view, "Back"));
    expect(p.surface.navigations).toEqual([{ action: "back" }]);
  });

  it("swaps reload for stop while the page is loading", async () => {
    const p = await probe();
    const card = mountCard(p);
    goLive(p);
    expect(button(card.view, "Reload").disabled).toBe(false);

    act(() => {
      p.surface.setBrowser({
        url: "https://example.invalid/start",
        loading: true,
        canGoBack: false,
        canGoForward: false,
      });
    });

    click(button(card.view, "Stop"));
    expect(p.surface.navigations).toEqual([{ action: "stop" }]);
  });

  it("shows the durable intent, disabled, when the producer has no truth yet", async () => {
    const p = await probe();
    const card = mountCard(p, { url: "https://example.invalid/remembered" });

    // While attaching there is nothing to show but what the card stores.
    expect(address(card.view).value).toBe("https://example.invalid/remembered");
    expect(address(card.view).disabled).toBe(true);

    // LIVE IS NOT ENOUGH, which is the honest-state case worth pinning: a live
    // browser surface that has not committed a navigation yet has nothing to
    // put in the field (the about:blank bootstrap is plumbing, not truth), so
    // the card keeps showing what it stores and keeps refusing the edit rather
    // than inventing a state it cannot back.
    act(() => p.surface.set("live"));

    expect(address(card.view).value).toBe("https://example.invalid/remembered");
    expect(address(card.view).disabled).toBe(true);
    expect(button(card.view, "Nothing behind this page").disabled).toBe(true);
  });
});

describe("the durable write is gesture-edged (DT-D7)", () => {
  it("ignores a page that moves its own url with no gesture behind it", async () => {
    const p = await probe();
    const card = mountCard(p);
    goLive(p, "https://example.invalid/start");

    act(() => {
      p.surface.setBrowser({
        url: "https://example.invalid/start#section-4",
        loading: false,
        canGoBack: true,
        canGoForward: false,
      });
    });

    // An SPA rewriting history is not the user choosing an address.
    expect(card.commits).toEqual([]);
  });

  it("stores the address a nav gesture actually reached", async () => {
    const p = await probe();
    const card = mountCard(p);
    goLive(p, "https://example.invalid/start");

    act(() => {
      p.surface.setBrowser({
        url: "https://example.invalid/start",
        loading: false,
        canGoBack: true,
        canGoForward: false,
      });
    });
    click(button(card.view, "Back"));
    act(() => {
      p.surface.setBrowser({
        url: "https://example.invalid/previous",
        title: "Previous",
        loading: false,
        canGoBack: false,
        canGoForward: true,
      });
    });

    expect(card.commits).toEqual([{ url: "https://example.invalid/previous", title: "Previous" }]);

    // The arm is spent: the next unsolicited move writes nothing.
    act(() => {
      p.surface.setBrowser({
        url: "https://example.invalid/previous#later",
        loading: false,
        canGoBack: false,
        canGoForward: true,
      });
    });
    expect(card.commits).toHaveLength(1);
  });

  it("fills an empty title once, and never turns a changing title into a ticker", async () => {
    const p = await probe();
    const card = mountCard(p, { url: "https://example.invalid/start" });
    goLive(p, "https://example.invalid/start");

    act(() => {
      p.surface.setBrowser({
        url: "https://example.invalid/start",
        title: "Docs",
        loading: false,
        canGoBack: false,
        canGoForward: false,
      });
    });
    expect(card.commits).toEqual([{ url: "https://example.invalid/start", title: "Docs" }]);

    // The card now HAS a stored title (the controller re-renders with it); a
    // page that keeps renaming itself must not keep writing.
    act(() =>
      root?.render(
        <BrowserPageView
          handle={p.handle}
          SurfaceView={p.pool.SurfaceView as ComponentType<PluginSurfaceViewProps>}
          url="https://example.invalid/start"
          title="Docs"
          showChrome
          onCommit={(commit) => card.commits.push(commit)}
        />,
      ),
    );
    act(() => {
      p.surface.setBrowser({
        url: "https://example.invalid/start",
        title: "(1) Docs",
        loading: false,
        canGoBack: false,
        canGoForward: false,
      });
    });
    expect(card.commits).toHaveLength(1);
  });
});

describe("the card's input boundary", () => {
  it("hands the page no input until the user engages it", async () => {
    const p = await probe();
    const card = mountCard(p);
    goLive(p);

    const surface = card.view.querySelector("[data-live-surface-status]");
    const page = card.view.querySelector(".vf-browser-page__page");
    // Disengaged: the pointer belongs to the canvas, so neither the forwarding
    // lane nor the canvas opt-out is on.
    expect(surface?.getAttribute("data-live-surface-interactive")).toBeNull();
    expect(page?.hasAttribute("data-canvas-interactive")).toBe(false);

    act(() => {
      page?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(
      card.view
        .querySelector("[data-live-surface-status]")
        ?.getAttribute("data-live-surface-interactive"),
    ).toBe("true");
    expect(
      card.view.querySelector(".vf-browser-page__page")?.hasAttribute("data-canvas-interactive"),
    ).toBe(true);
  });

  it("gives the canvas its keyboard back on Escape", async () => {
    const p = await probe();
    const card = mountCard(p);
    goLive(p);

    const page = card.view.querySelector(".vf-browser-page__page");
    act(() => {
      page?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(card.view.querySelector(".vf-browser-page")?.getAttribute("data-engaged")).toBe("true");

    press(card.view.querySelector(".vf-browser-page") as HTMLElement, "Escape");

    expect(card.view.querySelector(".vf-browser-page")?.getAttribute("data-engaged")).toBe("false");
    expect(
      card.view
        .querySelector("[data-live-surface-status]")
        ?.getAttribute("data-live-surface-interactive"),
    ).toBeNull();
  });

  it("mounts the surface with no chrome at all when the card says so", async () => {
    const p = await probe();
    const card = mountCard(p, { showChrome: false });
    goLive(p);

    expect(card.view.querySelector("input[aria-label='Address']")).toBeNull();
    expect(card.view.querySelector("[data-live-surface-status]")).not.toBeNull();
  });
});
