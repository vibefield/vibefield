import { IPC_CHANNELS } from "@vibefield/contracts";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import * as mainView from "../src/main/view";
import { ViewRegistry, ViewWindowState } from "../src/main/view";

// Main owns each window's view (One Frame FR-1 — GT-D2's Godview bit, grown
// into the frame's four views). These lock the consequences: a request names a
// view, the Assistant waits, every answer reaches both the page and the menu,
// and a destroyed window is never written to.

interface FakeContents {
  id: number;
  destroyed: boolean;
  sent: { channel: string; payload: unknown }[];
  handlers: Map<string, () => void>;
}

function fakeContents(id = 1): { contents: WebContents; fake: FakeContents } {
  const fake: FakeContents = { id, destroyed: false, sent: [], handlers: new Map() };
  const contents = {
    id,
    isDestroyed: () => fake.destroyed,
    send: (channel: string, payload: unknown) => fake.sent.push({ channel, payload }),
    once: (event: string, handler: () => void) => fake.handlers.set(event, handler),
  } as unknown as WebContents;
  return { contents, fake };
}

describe("ViewWindowState", () => {
  it("opens on the canvas — the ground floor (FV-D1), and no deck forked for nobody", () => {
    const { contents } = fakeContents();
    expect(new ViewWindowState(contents, {}).current()).toEqual({ view: "canvas" });
  });

  it("goes to the view it is asked for — there is no flip to argue with", () => {
    const { contents } = fakeContents();
    const state = new ViewWindowState(contents, {});
    expect(state.set("godview").view).toBe("godview");
    expect(state.set("history").view).toBe("history");
    expect(state.set("history").view).toBe("history");
    // The deck's last pane closing asks for the canvas: it means LEAVE, not "flip".
    expect(state.set("canvas").view).toBe("canvas");
  });

  it("refuses the Assistant while it waits, and answers with where the window is (FC-D2)", () => {
    const onChanged = vi.fn();
    const { contents, fake } = fakeContents();
    const state = new ViewWindowState(contents, { onChanged });
    state.set("godview");
    fake.sent.length = 0;
    expect(state.set("assistant")).toEqual({ view: "godview" });
    // still answered, so a page that asked is never left waiting
    expect(fake.sent).toEqual([{ channel: IPC_CHANNELS.viewState, payload: { view: "godview" } }]);
    expect(onChanged).toHaveBeenLastCalledWith({ view: "godview" }, contents);
  });

  it("publishes to the renderer on every request, changed or not", () => {
    // An unchanged request is also how a freshly loaded document asks for the truth.
    const { contents, fake } = fakeContents();
    const state = new ViewWindowState(contents, {});
    state.set("canvas");
    state.set("godview");
    expect(fake.sent).toEqual([
      { channel: IPC_CHANNELS.viewState, payload: { view: "canvas" } },
      { channel: IPC_CHANNELS.viewState, payload: { view: "godview" } },
    ]);
  });

  it("tells the menu after every request, so its mark and ⌘W follow", () => {
    const onChanged = vi.fn();
    const { contents } = fakeContents();
    const state = new ViewWindowState(contents, { onChanged });
    state.set("history");
    expect(onChanged).toHaveBeenLastCalledWith({ view: "history" }, contents);
  });

  it("names the window that asked, so what main composes with a view is per window", () => {
    // The window's lights follow its view (window-lights.ts): a view change in
    // one window must never move another's.
    const onChanged = vi.fn();
    const registry = new ViewRegistry({ onChanged });
    const a = fakeContents(21).contents;
    const b = fakeContents(22).contents;
    registry.ensure(a).set("godview");
    registry.ensure(b).set("history");
    expect(onChanged.mock.calls).toEqual([
      [{ view: "godview" }, a],
      [{ view: "history" }, b],
    ]);
  });

  it("republishes to a reloaded document, which believes it is on the canvas", () => {
    const { contents, fake } = fakeContents();
    const state = new ViewWindowState(contents, {});
    state.set("godview");
    fake.sent.length = 0;
    state.republish();
    expect(fake.sent).toEqual([{ channel: IPC_CHANNELS.viewState, payload: { view: "godview" } }]);
  });

  it("says nothing to a destroyed window", () => {
    const { contents, fake } = fakeContents();
    const state = new ViewWindowState(contents, {});
    fake.destroyed = true;
    state.set("godview");
    expect(fake.sent).toEqual([]);
    // The value still moved — the window is gone, not confused.
    expect(state.current()).toEqual({ view: "godview" });
  });
});

describe("ViewRegistry", () => {
  it("keeps one state per window and hands the same one back", () => {
    const registry = new ViewRegistry({});
    const { contents } = fakeContents(7);
    expect(registry.ensure(contents)).toBe(registry.ensure(contents));
  });

  it("peeks without creating — drawing a menu must not bring a state into being", () => {
    const registry = new ViewRegistry({});
    const { contents, fake } = fakeContents(9);
    expect(registry.peek(contents)).toEqual({ view: "canvas" });
    registry.ensure(contents).set("godview");
    expect(registry.peek(contents)).toEqual({ view: "godview" });
    expect(fake.sent).toHaveLength(1);
  });

  it("buries a window's state with the window", () => {
    const registry = new ViewRegistry({});
    const { contents, fake } = fakeContents(11);
    registry.ensure(contents).set("history");
    fake.handlers.get("destroyed")?.();
    expect(registry.peek(contents)).toEqual({ view: "canvas" });
  });
});

describe("⇧⇧ (FC-D4)", () => {
  it("is retired: main installs no double-Shift gesture and keeps no detector for one", () => {
    // The double tap was detected here, from `before-input-event`, and toggled
    // Godview from anywhere — the reason the bit lived in main at all. Four
    // keys for four views and nothing else replaced it; the smoke's row 11g
    // presses ⇧⇧ into a live window and watches no view move.
    expect(Object.keys(mainView).sort()).toEqual(["ViewRegistry", "ViewWindowState"]);
  });
});
