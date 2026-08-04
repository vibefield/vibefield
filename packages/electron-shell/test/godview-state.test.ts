import { IPC_CHANNELS } from "@vibefield/contracts";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import { GodviewRegistry, GodviewWindowState } from "../src/main/godview";

// Main owns the overlay bit (GT-D2) because ⌘⎋ is an application accelerator
// and never reaches the renderer. These lock the consequences: a flip is a
// flip, every change reaches both the page and the menu, and a destroyed
// window is never written to.

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

describe("GodviewWindowState", () => {
  it("starts closed — a launch that opened a deck would fork a bridge nobody asked for", () => {
    const { contents } = fakeContents();
    expect(new GodviewWindowState(contents, {}).current()).toEqual({ open: false });
  });

  it("flips when asked for no particular value", () => {
    const { contents } = fakeContents();
    const state = new GodviewWindowState(contents, {});
    expect(state.set().open).toBe(true);
    expect(state.set().open).toBe(false);
  });

  it("honors an explicit value, so a deck asking to close cannot toggle open", () => {
    const { contents } = fakeContents();
    const state = new GodviewWindowState(contents, {});
    // The workspace's last pane closing calls this: it means CLOSE, not "flip".
    expect(state.set(false).open).toBe(false);
    expect(state.set(true).open).toBe(true);
    expect(state.set(true).open).toBe(true);
  });

  it("publishes to the renderer on every set, changed or not", () => {
    // An unchanged set is also how a freshly loaded document asks for the truth.
    const { contents, fake } = fakeContents();
    const state = new GodviewWindowState(contents, {});
    state.set(false);
    state.set(true);
    expect(fake.sent).toEqual([
      { channel: IPC_CHANNELS.godviewState, payload: { open: false } },
      { channel: IPC_CHANNELS.godviewState, payload: { open: true } },
    ]);
  });

  it("tells the menu after every change, so the checkmark and ⌘W follow", () => {
    const onChanged = vi.fn();
    const { contents } = fakeContents();
    const state = new GodviewWindowState(contents, { onChanged });
    state.set();
    expect(onChanged).toHaveBeenLastCalledWith({ open: true });
  });

  it("republishes to a reloaded document, which believes it is closed", () => {
    const { contents, fake } = fakeContents();
    const state = new GodviewWindowState(contents, {});
    state.set(true);
    fake.sent.length = 0;
    state.republish();
    expect(fake.sent).toEqual([{ channel: IPC_CHANNELS.godviewState, payload: { open: true } }]);
  });

  it("says nothing to a destroyed window", () => {
    const { contents, fake } = fakeContents();
    const state = new GodviewWindowState(contents, {});
    fake.destroyed = true;
    state.set(true);
    expect(fake.sent).toEqual([]);
    // The value still moved — the window is gone, not confused.
    expect(state.current()).toEqual({ open: true });
  });
});

describe("GodviewRegistry", () => {
  it("keeps one state per window and hands the same one back", () => {
    const registry = new GodviewRegistry({});
    const { contents } = fakeContents(7);
    expect(registry.ensure(contents)).toBe(registry.ensure(contents));
  });

  it("peeks without creating — drawing a menu must not bring a state into being", () => {
    const registry = new GodviewRegistry({});
    const { contents, fake } = fakeContents(9);
    expect(registry.peek(contents)).toEqual({ open: false });
    registry.ensure(contents).set(true);
    expect(registry.peek(contents)).toEqual({ open: true });
    expect(fake.sent).toHaveLength(1);
  });

  it("buries a window's state with the window", () => {
    const registry = new GodviewRegistry({});
    const { contents, fake } = fakeContents(11);
    registry.ensure(contents).set(true);
    fake.handlers.get("destroyed")?.();
    expect(registry.peek(contents)).toEqual({ open: false });
  });
});
