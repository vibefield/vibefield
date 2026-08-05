// @vitest-environment happy-dom
/**
 * FilePill against a plain fake DocManagerApi (no sockets): the closed pill
 * shows the doc name, rename commits through the manager, the chevron expands,
 * the grid lists docs with the current one ringed, and a tile click switches.
 * createElement (not JSX) keeps this a `.ts` file, panels.test's pattern.
 */
import type { DocSyncStatus } from "@vibefield/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocManagerApi, DocManagerState } from "../src/doc-manager";
import { resetDocSyncStatuses, setDocSyncStatuses } from "../src/doc-sync-store";
import { FilePill } from "../src/hud/FilePill";

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
    setSyncIntent: vi.fn(async (docId: string, intent: "sync" | "local") => {
      // The real manager patches from the entry the daemon returns; the fake
      // does the same so the chip is read back from the REGISTRY row, which is
      // the property under test (never from the sync stream).
      state = {
        ...state,
        docs: state.docs.map((d) => (d.docId === docId ? { ...d, syncIntent: intent } : d)),
      };
      for (const fn of listeners) fn();
    }),
  };
  return manager;
}

/** A C6-4 status with honest defaults; tests override what they assert. */
function syncStatus(overrides: Partial<DocSyncStatus> & { docId: string }): DocSyncStatus {
  return {
    name: "Field",
    state: "in-step",
    pendingRecords: 0,
    peers: [{ peer: "dev-b", reachable: true, lastExchangeAt: 1_700_000_000_000 }],
    reason: null,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
  act(() => resetDocSyncStatuses());
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

describe("FilePill sync dot (C6-4)", () => {
  it("stays quiet for in-step AND for transient syncing — no flicker on routine traffic", () => {
    act(() => setDocSyncStatuses([syncStatus({ docId: DOC_A, state: "in-step" })]));
    const manager = fakeManager();
    mount(manager, false);
    expect(container?.querySelector("[data-sync-dot]")).toBeNull();

    act(() => setDocSyncStatuses([syncStatus({ docId: DOC_A, state: "syncing" })]));
    expect(container?.querySelector("[data-sync-dot]")).toBeNull();
  });

  it("shows a muted dot for peer-offline whose title claims the last exchange, not now", () => {
    act(() => setDocSyncStatuses([syncStatus({ docId: DOC_A, state: "peer-offline" })]));
    mount(fakeManager(), false);
    const dot = container?.querySelector("[data-sync-dot]") as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.style.background).toContain("128");
    // F-C6-22 honesty: the words say what we knew and when — never "up to date".
    expect(dot.title).toContain("offline");
    expect(dot.title).toContain("last exchange");
  });

  it("shows an orange dot for the needs-attention states", () => {
    act(() =>
      setDocSyncStatuses([
        syncStatus({ docId: DOC_A, state: "peer-declined", reason: "unknown-doc" }),
      ]),
    );
    mount(fakeManager(), false);
    const dot = container?.querySelector("[data-sync-dot]") as HTMLElement;
    expect(dot.style.background).toContain("--vf-orange");
    expect(dot.title).toContain("unknown-doc");
  });

  it("counts what pending waits on", () => {
    act(() =>
      setDocSyncStatuses([syncStatus({ docId: DOC_A, state: "pending", pendingRecords: 3 })]),
    );
    mount(fakeManager(), false);
    const dot = container?.querySelector("[data-sync-dot]") as HTMLElement;
    expect(dot.title).toContain("3 records");
  });

  it("keeps the dot to the CURRENT doc; other docs speak through their tiles", () => {
    act(() =>
      setDocSyncStatuses([
        syncStatus({ docId: DOC_A, state: "in-step" }),
        syncStatus({ docId: DOC_B, name: "Studio", state: "peer-offline" }),
      ]),
    );
    mount(fakeManager(), true);
    // current doc (A) is in step — no pill dot even though B is offline …
    expect(container?.querySelector("[data-sync-dot]")).toBeNull();
    // … and B's tile caption carries the honest word.
    expect(container?.textContent).toContain("peer offline");
  });

  it("UA-D7: a tile offers 'keep local', and a gated one wears the chip", () => {
    const manager = fakeManager({
      docs: [
        {
          docId: DOC_A,
          name: "Field",
          updatedAt: Date.now(),
          baseEpoch: 0,
          engineSchema: 2,
          sizeBytes: 10,
        },
        {
          docId: DOC_B,
          name: "Studio",
          updatedAt: Date.now(),
          baseEpoch: 0,
          engineSchema: 2,
          sizeBytes: 10,
          syncIntent: "local",
        },
      ],
    });
    mount(manager, true);
    const chips = [...(container?.querySelectorAll("[data-sync-intent]") ?? [])];
    expect(chips.map((c) => c.getAttribute("data-sync-intent"))).toEqual(["sync", "local"]);
    expect(chips[0]?.textContent).toBe("keep local");
    // The gated doc says what it IS, not what you could do to it.
    expect(chips[1]?.textContent).toBe("local");
    expect((chips[1] as HTMLElement).title).toContain("stays on this device");
  });

  it("UA-D7: the chip toggles both ways through the manager", () => {
    const manager = fakeManager();
    mount(manager, true);
    const chip = container?.querySelector("[data-sync-intent]") as HTMLButtonElement;
    act(() => chip.click());
    expect(manager.setSyncIntent).toHaveBeenCalledWith(DOC_A, "local");

    const gated = container?.querySelector("[data-sync-intent='local']") as HTMLButtonElement;
    expect(gated.textContent).toBe("local");
    act(() => gated.click());
    expect(manager.setSyncIntent).toHaveBeenLastCalledWith(DOC_A, "sync");
  });

  it("UA-D7: the chip reads the registry, never the sync stream", () => {
    // The no-`solo`-on-the-wire law: a gated doc has NO sync status to read, so
    // a chip inferred from the stream would be a chip that never appears.
    act(() => setDocSyncStatuses([]));
    const manager = fakeManager({
      docs: [
        {
          docId: DOC_A,
          name: "Field",
          updatedAt: Date.now(),
          baseEpoch: 0,
          engineSchema: 2,
          sizeBytes: 10,
          syncIntent: "local",
        },
      ],
    });
    mount(manager, true);
    const chip = container?.querySelector("[data-sync-intent]") as HTMLElement;
    expect(chip.getAttribute("data-sync-intent")).toBe("local");
    expect(chip.textContent).toBe("local");
  });

  it("UA-D7: an untouched doc's tile is unchanged — no chip text, no caption", () => {
    act(() => setDocSyncStatuses([]));
    mount(fakeManager(), true);
    const chip = container?.querySelector("[data-sync-intent]") as HTMLElement;
    expect(chip.getAttribute("data-sync-intent")).toBe("sync");
    // Present for the action, invisible until hover or keyboard focus.
    expect(chip.className).toContain("opacity-0");
    expect(chip.className).toContain("group-hover:opacity-100");
  });
});
