// @vitest-environment happy-dom
/**
 * FilePill against a plain fake DocManagerApi (no sockets): the closed pill
 * shows the doc name, rename commits through the manager, the chevron expands,
 * the grid lists docs with the current one ringed, and a tile click switches.
 * createElement (not JSX) keeps this a `.ts` file, panels.test's pattern.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocManagerApi, DocManagerState } from "../renderer/src/doc-manager";
import { FilePill } from "../renderer/src/hud/FilePill";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOC_A = "1f0d7a2e-3c44-4b8a-9e51-6d2f8c0a7b19";
const DOC_B = "2a1b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

function fakeManager(overrides?: Partial<DocManagerState>) {
  let state: DocManagerState = {
    phase: "ready",
    loading: null,
    doc: { docId: DOC_A, name: "Field" },
    docs: [
      {
        docId: DOC_A,
        name: "Field",
        updatedAt: Date.now() - 60_000,
        baseEpoch: 0,
        engineSchema: 2,
        sizeBytes: 10,
      },
      {
        docId: DOC_B,
        name: "Studio",
        updatedAt: Date.now() - 7_200_000,
        baseEpoch: 0,
        engineSchema: 2,
        sizeBytes: 10,
      },
    ],
    thumbnailUrls: { [DOC_B]: "blob:studio-thumbnail" },
    pending: null,
    ...overrides,
  };
  const listeners = new Set<() => void>();
  const manager: DocManagerApi = {
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getState: () => state,
    refreshDocs: vi.fn(async () => state.docs),
    rename: vi.fn(async (name: string) => {
      state = { ...state, doc: state.doc ? { ...state.doc, name } : null };
      for (const fn of listeners) fn();
    }),
    createDoc: vi.fn(async () => {}),
    switchTo: vi.fn(async () => {}),
  };
  return manager;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
});

function mount(
  manager: DocManagerApi,
  open: boolean,
  onOpenChange: (o: boolean) => void = () => {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(createElement(FilePill, { manager, open, onOpenChange })));
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("FilePill", () => {
  it("closed pill shows the doc name; chevron requests expansion", () => {
    const manager = fakeManager();
    const onOpen = vi.fn();
    mount(manager, false, onOpen);
    expect(container?.textContent).toContain("Field");
    const chevron = container?.querySelector('button[title="Browse fields"]') as HTMLButtonElement;
    act(() => chevron.click());
    expect(onOpen).toHaveBeenCalledWith(true);
  });

  it("rename: click the name, edit, Enter commits through the manager", () => {
    const manager = fakeManager();
    mount(manager, false);
    const name = container?.querySelector('button[title="Rename this field"]') as HTMLButtonElement;
    act(() => name.click());
    const input = container?.querySelector("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    act(() => setInputValue(input, "Atelier"));
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(manager.rename).toHaveBeenCalledWith("Atelier");
  });

  it("rename Esc reverts without calling the manager", () => {
    const manager = fakeManager();
    mount(manager, false);
    const name = container?.querySelector('button[title="Rename this field"]') as HTMLButtonElement;
    act(() => name.click());
    const input = container?.querySelector("input") as HTMLInputElement;
    act(() => setInputValue(input, "Nope"));
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(manager.rename).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Field");
  });

  it("open sheet lists docs (fresh list requested), tile click switches + closes", () => {
    const manager = fakeManager();
    const onOpen = vi.fn();
    mount(manager, true, onOpen);
    expect(manager.refreshDocs).toHaveBeenCalled();
    expect(container?.textContent).toContain("Studio");
    const tile = container?.querySelector('button[title="Open Studio"]') as HTMLButtonElement;
    act(() => tile.click());
    expect(onOpen).toHaveBeenCalledWith(false);
    expect(manager.switchTo).toHaveBeenCalledWith(DOC_B);
  });

  it("the current doc's tile is marked current, and clicking it only closes", () => {
    const manager = fakeManager();
    const onOpen = vi.fn();
    mount(manager, true, onOpen);
    const current = container?.querySelector(
      'button[title="Field — current"]',
    ) as HTMLButtonElement;
    expect(current).not.toBeNull();
    act(() => current.click());
    expect(onOpen).toHaveBeenCalledWith(false);
    expect(manager.switchTo).not.toHaveBeenCalled();
  });

  it("uses a persisted thumbnail URL without asking the manager to generate one", () => {
    const manager = fakeManager();
    mount(manager, true);
    const image = container?.querySelector('img[src="blob:studio-thumbnail"]');
    expect(image).not.toBeNull();
    expect(manager.refreshDocs).toHaveBeenCalledTimes(1);
  });

  it("busy (loading) disables new + rename but never the chevron", () => {
    const manager = fakeManager({ phase: "loading", loading: { progress: 0.5, stage: "x" } });
    mount(manager, false);
    const plus = container?.querySelector('button[title="New field"]') as HTMLButtonElement;
    const name = container?.querySelector('button[title="Rename this field"]') as HTMLButtonElement;
    const chevron = container?.querySelector('button[title="Browse fields"]') as HTMLButtonElement;
    expect(plus.disabled).toBe(true);
    expect(name.disabled).toBe(true);
    expect(chevron.disabled).toBe(false);
  });
});
