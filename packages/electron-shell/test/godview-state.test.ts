import { IPC_CHANNELS } from "@vibefield/contracts";
import type { WebContents } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  type ChordInput,
  DoubleShiftDetector,
  GodviewRegistry,
  GodviewWindowState,
  installGodviewDoubleShift,
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

// ⇧⇧ — the gesture (2026-08-04), after ⌘⎋ was measured unreachable: macOS eats
// Command+Escape before the app sees it, so no mechanism could have bound it.
// The rules below are JetBrains' `ModifierKeyDoubleClickHandler` transcribed,
// which is why the numbers are theirs and not ours to round off. A rhythm has no
// menu template to assert against, so THIS is where the gesture is pinned down.

const shift = (type: "keyDown" | "keyUp", patch: Partial<ChordInput> = {}): ChordInput => ({
  type,
  key: "Shift",
  meta: false,
  control: false,
  alt: false,
  shift: true,
  ...patch,
});

const other = (key: string): ChordInput => ({
  type: "keyDown",
  key,
  meta: false,
  control: false,
  alt: false,
  shift: false,
});

/** Feed a whole sequence of [input, atMs] and report every moment it fired. */
function play(steps: readonly [ChordInput, number][]): number[] {
  const detector = new DoubleShiftDetector();
  const fired: number[] = [];
  for (const [input, at] of steps) {
    if (detector.accept(input, at)) fired.push(at);
  }
  return fired;
}

describe("DoubleShiftDetector", () => {
  it("fires once on the SECOND RELEASE of a clean double tap", () => {
    // Not the second press: holding Shift after the second tap must do nothing
    // until it is let go, so Shift-drag and Shift-click never trip the overlay.
    expect(
      play([
        [shift("keyDown"), 0],
        [shift("keyUp"), 40],
        [shift("keyDown"), 120],
        [shift("keyUp"), 160],
      ]),
    ).toEqual([160]);
  });

  it("does not fire on a single tap, however deliberate", () => {
    expect(
      play([
        [shift("keyDown"), 0],
        [shift("keyUp"), 40],
      ]),
    ).toEqual([]);
  });

  it("lets the window lapse — 300ms between taps is the whole gesture", () => {
    expect(
      play([
        [shift("keyDown"), 0],
        [shift("keyUp"), 40],
        [shift("keyDown"), 400], // > 300 since the release
        [shift("keyUp"), 440],
      ]),
    ).toEqual([]);
  });

  it("does not fire while typing capitals — the 100ms guard", () => {
    // The failure mode this exists to prevent: Shift+A, then Shift again fast
    // because the next word is also capitalised. That is typing, not a gesture.
    expect(
      play([
        [shift("keyDown"), 0],
        [other("a"), 20],
        [shift("keyUp"), 30],
        [shift("keyDown"), 60], // within 100ms of the other key
        [shift("keyUp"), 90],
      ]),
    ).toEqual([]);
  });

  it("a key pressed BETWEEN the taps ends the gesture", () => {
    expect(
      play([
        [shift("keyDown"), 0],
        [shift("keyUp"), 40],
        [other("k"), 60],
        [shift("keyDown"), 200],
        [shift("keyUp"), 240],
      ]),
    ).toEqual([]);
  });

  it("ignores Shift held with another modifier — ⇧⌘ is a chord, not a tap", () => {
    expect(
      play([
        [shift("keyDown", { meta: true }), 0],
        [shift("keyUp", { meta: true }), 40],
        [shift("keyDown", { meta: true }), 120],
        [shift("keyUp", { meta: true }), 160],
      ]),
    ).toEqual([]);
  });

  it("gives Escape and Tab a hard reset, so the next Shift starts clean", () => {
    // JetBrains zero the timestamp for these two: after Esc the very next tap
    // must count as a first tap rather than be swallowed by the typing guard.
    expect(
      play([
        [other("Escape"), 1000],
        [shift("keyDown"), 1010], // would be inside the 100ms guard but for the zeroing
        [shift("keyUp"), 1040],
        [shift("keyDown"), 1120],
        [shift("keyUp"), 1160],
      ]),
    ).toEqual([1160]);
  });

  it("re-arms — a second gesture fires as readily as the first", () => {
    expect(
      play([
        [shift("keyDown"), 0],
        [shift("keyUp"), 40],
        [shift("keyDown"), 120],
        [shift("keyUp"), 160],
        [shift("keyDown"), 900],
        [shift("keyUp"), 940],
        [shift("keyDown"), 1020],
        [shift("keyUp"), 1060],
      ]),
    ).toEqual([160, 1060]);
  });

  it("does not fire twice for one gesture, however long Shift is held after", () => {
    expect(
      play([
        [shift("keyDown"), 0],
        [shift("keyUp"), 40],
        [shift("keyDown"), 120],
        [shift("keyUp"), 160],
        [shift("keyUp"), 200], // a stray release must not re-fire
      ]),
    ).toEqual([160]);
  });
});

describe("installGodviewDoubleShift", () => {
  function fakeInput(): { contents: WebContents; fire: (i: ChordInput) => boolean } {
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

  it("toggles on the gesture and SWALLOWS NOTHING", () => {
    // Every Shift must reach the pane below: eating a keyUp would leave ghosttea
    // believing Shift was still held, and a lone Shift means nothing to a shell
    // anyway — so the gesture is invisible rather than intercepted.
    const { contents, fire } = fakeInput();
    const toggle = vi.fn();
    let clock = 0;
    installGodviewDoubleShift(contents, toggle, () => clock);
    for (const [input, at] of [
      [shift("keyDown"), 0],
      [shift("keyUp"), 40],
      [shift("keyDown"), 120],
      [shift("keyUp"), 160],
    ] as [ChordInput, number][]) {
      clock = at;
      expect(fire(input)).toBe(false);
    }
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("leaves ordinary typing entirely alone", () => {
    const { contents, fire } = fakeInput();
    const toggle = vi.fn();
    installGodviewDoubleShift(contents, toggle, () => 0);
    expect(fire(other("g"))).toBe(false);
    expect(fire(other("Escape"))).toBe(false);
    expect(toggle).not.toHaveBeenCalled();
  });
});
