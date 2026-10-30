// @vitest-environment happy-dom

import type { ArtifactView } from "@vibefield/contracts";
import { ArtifactPanel } from "@vibefield/plugin-browser";
import type { PluginProductClient } from "@vibefield/plugin-sdk";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function client(
  artifacts: ArtifactView[],
  request: PluginProductClient["request"] = vi.fn(async () => ({})),
): PluginProductClient {
  return {
    request,
    subscribe: vi.fn(async (_method, _params, _onEvent) => ({
      snapshot: artifacts,
      unsubscribe: () => undefined,
    })),
  };
}

async function mount(productClient: PluginProductClient): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<ArtifactPanel client={productClient} />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...(container?.querySelectorAll("button") ?? [])].find(
    (candidate) =>
      candidate.textContent?.trim() === label ||
      candidate.querySelector("strong")?.textContent?.trim() === label ||
      candidate.getAttribute("aria-label") === label ||
      candidate.getAttribute("title") === label,
  );
  if (match === undefined) throw new Error(`missing button: ${label}`);
  return match;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const ARTIFACT: ArtifactView = {
  artifactId: "01J3QH5XX6M8QPK7R2B4F9C1TZ",
  artifactKey: "device-a:01J3QH5XX6M8QPK7R2B4F9C1TZ",
  title: "Vite prototype",
  kind: "proxy",
  originDeviceId: "device-a",
  originDeviceName: "Studio Mac",
  originBootId: "boot-a",
  originOnline: true,
  url: "https://studio-mac.example.ts.net:12000/",
  advertisedAvailability: "active",
  availability: "active",
  availabilityAt: 1_722_000_000_000,
  publishedAt: 1_722_000_000_000,
  updatedAt: 1_722_000_000_000,
  openable: true,
  editable: true,
};

describe("ArtifactPanel", () => {
  it("publishes one exact proxy request even when submit is repeated", async () => {
    const gate = deferred<unknown>();
    const request = vi.fn((method: string, _params?: unknown) =>
      method === "artifact.publish" ? gate.promise : Promise.resolve({}),
    );
    await mount(client([], request));
    act(() => button("Add artifact").click());
    act(() => button("Proxy").click());
    act(() => button("HTTPS").click());
    const port = container?.querySelector<HTMLInputElement>('input[type="number"]');
    if (port === null || port === undefined) throw new Error("missing proxy port input");
    act(() => setInputValue(port, "5173"));
    const form = container?.querySelector("form");
    if (form === null || form === undefined) throw new Error("missing proxy form");
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    const publishes = request.mock.calls.filter(([method]) => method === "artifact.publish");
    expect(publishes).toHaveLength(1);
    expect(publishes[0]?.[1]).toMatchObject({
      artifactId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      idempotencyKey: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      title: "localhost:5173",
      source: { kind: "proxy", scheme: "https", port: 5173 },
    });
    await act(async () => gate.resolve({}));
  });

  it("uses the native picker, renders only the basename, and publishes the selected path", async () => {
    const folderPath = "/Users/james/Private Sites/secret-site";
    const request = vi.fn(async (method: string) => {
      if (method === "shell.dialog.pickFolder") return { canceled: false, path: folderPath };
      throw Object.assign(new Error("invalid folder"), {
        kind: "PRECONDITION_FAILED",
        details: { code: "STATIC_ROOT_INVALID" },
      });
    });
    await mount(client([], request));
    act(() => button("Add artifact").click());
    await act(async () => button("Folder").click());
    expect(request).toHaveBeenCalledWith("shell.dialog.pickFolder", {
      purpose: "artifact.publish",
    });
    expect(container?.textContent).toContain("secret-site");
    expect(container?.textContent).not.toContain("/Users/james");
    expect(
      [...(container?.querySelectorAll("input") ?? [])].some((input) => input.value === folderPath),
    ).toBe(false);

    const checkbox = container?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    act(() => checkbox?.click());
    const form = container?.querySelector("form");
    await act(async () =>
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(request).toHaveBeenCalledWith(
      "artifact.publish",
      expect.objectContaining({
        title: "secret-site",
        source: { kind: "folder", path: folderPath, spaFallback: "/index.html" },
      }),
    );
    expect(container?.textContent).toContain(
      "That folder cannot be served. Choose another folder.",
    );
  });

  it("puts Publish… first in the catalog, in words, and turns the panel in place to its step, Publish — Proxy and Folder, its two cards (HN-8, PL-D3; ruling 11)", async () => {
    await mount(client([ARTIFACT]));
    const tiles = [...(container?.querySelectorAll(".vf-artifact-list > li") ?? [])];
    expect(tiles.map((tile) => tile.className)).toEqual(["vf-artifact-publish", "vf-artifact-row"]);
    const publish = tiles[0]?.querySelector("button");
    expect(publish?.textContent).toBe("Publish…");
    act(() => publish?.click());
    expect(container?.querySelector(".vf-artifact-list")).toBeNull();
    // the act's one name: the step is headed "Publish", never "Add artifact"
    const heading = (): Element | null | undefined =>
      container?.querySelector(".vf-artifact-flow-heading");
    expect(heading()?.querySelector("strong")?.textContent).toBe("Publish");
    expect(heading()?.querySelector("small")?.textContent).toBe(
      "Choose what this computer should share.",
    );
    expect(container?.textContent).not.toContain("Add artifact");
    // its two choices stand together, the pair the tile form lays side by side as cards
    expect(
      [...(container?.querySelectorAll(".vf-artifact-choices > .vf-artifact-choice") ?? [])].map(
        (choice) => choice.querySelector("strong")?.textContent,
      ),
    ).toEqual(["Proxy", "Folder"]);
    expect(button("Proxy")).not.toBeNull();
    expect(button("Folder")).not.toBeNull();
    // the round plus it stands for in the tile form is the same act, the list's: it keeps its own
    // name and opens the same step
    act(() => button("Back").click());
    act(() => button("Add artifact").click());
    expect(heading()?.querySelector("strong")?.textContent).toBe("Publish");
    expect(button("Proxy")).not.toBeNull();
  });

  it("says an empty catalog in the act's name — Publish a proxy or a folder — with one Publish…, which opens the step (HN-8, ruling 11)", async () => {
    await mount(client([]));
    const quiet = container?.querySelector(".vf-artifact-quiet");
    expect(quiet?.querySelector(".vf-ui-empty-state__title")?.textContent).toBe("No artifacts yet");
    expect(quiet?.querySelector(".vf-ui-empty-state__description")?.textContent).toBe(
      "Publish a proxy or a folder",
    );
    const buttons = [...(quiet?.querySelectorAll("button") ?? [])];
    expect(buttons.map((found) => found.textContent)).toEqual(["Publish…"]);
    // the empty catalog draws no Publish… tile beside it: one Publish… on screen
    expect(container?.querySelector(".vf-artifact-publish")).toBeNull();
    act(() => buttons[0]?.click());
    expect(container?.querySelector(".vf-artifact-flow-heading strong")?.textContent).toBe(
      "Publish",
    );
    expect(button("Proxy")).not.toBeNull();
  });

  it("draws no close of its own: the shelf's Escape, its dim and its button close it (HN-8)", async () => {
    await mount(client([ARTIFACT]));
    expect(container?.textContent).not.toContain("Close panel");
    expect(container?.querySelector(".vf-artifact-close")).toBeNull();
  });

  it("opens the exact validated catalog URL and renders provider loss honestly", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ opened: true })
      .mockRejectedValueOnce({ kind: "UNAVAILABLE" });
    await mount(client([ARTIFACT], request));
    await act(async () => button("Open Vite prototype").click());
    expect(request).toHaveBeenCalledWith("shell.openExternal", { url: ARTIFACT.url });
    await act(async () => button("Open Vite prototype").click());
    expect(container?.textContent).toContain(
      "Desktop services are unavailable. Try again in a moment.",
    );
  });

  it("refreshes only through ArtifactService and bounds transient thumbnail retries", async () => {
    vi.useFakeTimers();
    const artifact = {
      ...ARTIFACT,
      previewRevision: 1,
      thumbnailUrl: "https://studio-mac.example.ts.net:12000/.vibefield/preview/thumbnail.jpg?v=1",
    };
    const request = vi.fn(async () => ({
      artifactId: ARTIFACT.artifactId,
      captured: true,
      previewRevision: 2,
    }));
    await mount(client([artifact], request));

    const image = container?.querySelector<HTMLImageElement>(".vf-artifact-preview img");
    expect(image?.src).toBe(artifact.thumbnailUrl);
    expect(image?.referrerPolicy).toBe("no-referrer");
    act(() => image?.dispatchEvent(new Event("error")));
    expect(container?.querySelector(".vf-artifact-preview img")).toBeNull();

    await act(async () => vi.advanceTimersByTime(500));
    const firstRetry = container?.querySelector<HTMLImageElement>(".vf-artifact-preview img");
    expect(new URL(firstRetry?.src ?? "").searchParams.get("vf-preview-attempt")).toBe("1");
    act(() => firstRetry?.dispatchEvent(new Event("error")));

    await act(async () => vi.advanceTimersByTime(1_500));
    const secondRetry = container?.querySelector<HTMLImageElement>(".vf-artifact-preview img");
    expect(new URL(secondRetry?.src ?? "").searchParams.get("vf-preview-attempt")).toBe("2");
    act(() => secondRetry?.dispatchEvent(new Event("error")));
    expect(container?.querySelector(".vf-artifact-preview img")).toBeNull();
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(container?.querySelector(".vf-artifact-preview img")).toBeNull();

    await act(async () => button("Refresh preview").click());
    expect(request).toHaveBeenCalledWith("artifact.refreshPreview", {
      artifactId: ARTIFACT.artifactId,
    });
  });
});
