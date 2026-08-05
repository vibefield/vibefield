import { IPC_CHANNELS } from "@vibefield/contracts";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  type ChordInput,
  GodviewRegistry,
  GodviewWindowState,
  installGodviewChord,
  isGodviewChord,
} from "../src/main/godview";

// Main owns the overlay bit (GT-D2) because the chord is answered above the
// page and never reaches the renderer. These lock the consequences: a flip is a
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

// The chord matcher (2026-08-04). macOS does not deliver ⌘⎋ to a menu key
// equivalent, so the binding moved to `before-input-event` in main — which
// means the thing that decides "is this the toggle?" is now OUR code, and gets
// held to the same standard as the menu template it replaced.

const press = (patch: Partial<ChordInput> = {}): ChordInput => ({
  type: "keyDown",
  key: "Escape",
  meta: true,
  control: false,
  alt: false,
  shift: false,
  ...patch,
});

describe("isGodviewChord", () => {
  it("matches ⌘⎋ on darwin and ⌃⎋ elsewhere", () => {
    expect(isGodviewChord(press(), "darwin")).toBe(true);
    expect(isGodviewChord(press({ meta: false, control: true }), "other")).toBe(true);
  });

  it("does not answer the platform's OTHER modifier", () => {
    // ⌃⎋ on a Mac is not this gesture, and ⌘⎋ on Windows is not either. The
    // accelerator string says CommandOrControl; so does this.
    expect(isGodviewChord(press({ meta: false, control: true }), "darwin")).toBe(false);
    expect(isGodviewChord(press(), "other")).toBe(false);
  });

  it("leaves ⌥⌘⎋ and ⇧⌘⎋ alone — Force Quit is not ours to eat", () => {
    expect(isGodviewChord(press({ alt: true }), "darwin")).toBe(false);
    expect(isGodviewChord(press({ shift: true }), "darwin")).toBe(false);
  });

  it("ignores BARE Escape, which belongs to whatever has focus", () => {
    // The whole reason the overlay's Escape ladder was dropped: a terminal pane
    // must get its own Escape, or vim cannot leave insert mode inside the deck.
    expect(isGodviewChord(press({ meta: false }), "darwin")).toBe(false);
  });

  it("answers the press, never the release — one keystroke is one toggle", () => {
    expect(isGodviewChord(press({ type: "keyUp" }), "darwin")).toBe(false);
  });

  it("ignores every other key held with the platform modifier", () => {
    expect(isGodviewChord(press({ key: "g" }), "darwin")).toBe(false);
  });
});

describe("installGodviewChord", () => {
  function fakeInput(): {
    contents: WebContents;
    fire: (input: ChordInput) => boolean;
  } {
    let listener: ((event: { preventDefault: () => void }, input: ChordInput) => void) | undefined;
    const contents = {
      on: (event: string, handler: typeof listener) => {
        if (event === "before-input-event") listener = handler;
      },
    } as unknown as WebContents;
    return {
      contents,
      fire: (input) => {
        let prevented = false;
        listener?.({ preventDefault: () => (prevented = true) }, input);
        return prevented;
      },
    };
  }

  it("toggles on the chord and swallows it, so no terminal below ever sees it", () => {
    const { contents, fire } = fakeInput();
    const toggle = vi.fn();
    installGodviewChord(contents, toggle, "darwin");
    expect(fire(press())).toBe(true);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("passes everything else through untouched", () => {
    const { contents, fire } = fakeInput();
    const toggle = vi.fn();
    installGodviewChord(contents, toggle, "darwin");
    // A bare Escape must reach the page — preventDefault here would be the old
    // capture-phase ladder wearing a different coat.
    expect(fire(press({ meta: false }))).toBe(false);
    expect(fire(press({ key: "g" }))).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
  });
});
