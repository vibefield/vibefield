// @vitest-environment happy-dom

// SD-2 (DESIGN.md §8 "Settings → Sound", §14) — the page, as a pure view over its model: Play sounds, the family's
// rows with their words and a Play each, Quiet, and the foot. The player's three reasons it cannot play are said in
// the switch's own line: never a switch that silently does nothing.

import { CUES, PREVIEW_CUES } from "@vibefield/sound";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SoundSettingsPreview } from "../src/design-system/SoundSettingsPreview";
import { SOUND_FIXTURE_STATES } from "../src/design-system/sound-settings-fixtures";
import { type SoundSettingsModel, SoundSettingsView } from "../src/panels/sound/SoundSettings";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function mount(model: Partial<SoundSettingsModel> = {}) {
  const onSounds = vi.fn();
  const onPlay = vi.fn();
  const onQuiet = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(SoundSettingsView, {
        model: { on: true, player: "ready", ...model },
        onSounds,
        onPlay,
        onQuiet,
      }),
    ),
  );
  const el = container;
  const text = () => el.textContent ?? "";
  const button = (name: string) =>
    [...el.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => (b.getAttribute("aria-label") ?? b.textContent) === name,
    );
  const toggle = () =>
    el.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Play sounds"]');
  return { el, text, button, toggle, onSounds, onPlay, onQuiet };
}

describe("Play sounds (SD-D19)", () => {
  it("is on, saying what it plays for", () => {
    const m = mount();
    expect(m.toggle()?.getAttribute("aria-checked")).toBe("true");
    expect(m.text()).toContain(
      "A sound when an agent finishes, asks you something, needs your approval or stops on an error.",
    );
    act(() => m.toggle()?.click());
    expect(m.onSounds).toHaveBeenCalledWith(false);
  });
  it.each([
    ["unsupported", "Sounds play on macOS."],
    ["missing", "This build has no sound player."],
    ["failed", "The sound player didn't start."],
  ] as const)("without a player (%s), is off and disabled, and says why", (player, words) => {
    const m = mount({ player });
    expect(m.toggle()?.getAttribute("aria-checked")).toBe("false");
    expect(m.toggle()?.disabled).toBe(true);
    expect(m.text()).toContain(words);
    expect(m.button("Play Done")?.disabled).toBe(true);
  });
});

describe("the sounds, in the family's order, each with its words and a Play", () => {
  it("lists Failed, Done, Question, Approval and All quiet, never the mark (SD-D18)", () => {
    const m = mount();
    const names = [...m.el.querySelectorAll("[data-sound-row]")].map((row) =>
      row.getAttribute("data-sound-row"),
    );
    expect(names).toEqual([...PREVIEW_CUES]);
    for (const cue of PREVIEW_CUES) {
      expect(m.text()).toContain(CUES[cue].label);
      expect(m.text()).toContain(CUES[cue].says);
    }
    expect(m.text()).not.toContain(CUES.mark.label);
  });
  it("plays a sound when its Play is pressed", () => {
    const m = mount();
    act(() => m.button("Play Approval")?.click());
    expect(m.onPlay).toHaveBeenCalledWith("approval");
  });
  it("plays even while Quiet holds, and not while Play sounds is off", () => {
    expect(mount({ quietUntilText: "8:00 AM" }).button("Play Done")?.disabled).toBe(false);
    act(() => root?.unmount());
    root = null;
    expect(mount({ on: false }).button("Play Done")?.disabled).toBe(true);
  });
});

describe("Quiet (SD-D22)", () => {
  it("offers an hour, or until tomorrow", () => {
    const m = mount();
    act(() => m.button("For an hour")?.click());
    act(() => m.button("Until tomorrow")?.click());
    expect(m.onQuiet.mock.calls).toEqual([["hour"], ["tomorrow"]]);
  });
  it("while quiet, says until when, and turns the sounds back on", () => {
    const m = mount({ quietUntilText: "8:00 AM" });
    expect(m.text()).toContain("Quiet until 8:00 AM.");
    expect(m.button("For an hour")).toBeUndefined();
    act(() => m.button("Turn sounds back on")?.click());
    expect(m.onQuiet).toHaveBeenCalledWith(null);
  });
});

describe("the foot", () => {
  it("says what the sounds follow, and that away a notice says it too, as macOS decides (SD-3)", () => {
    const m = mount();
    expect(m.text()).toContain(
      "Sounds follow your Mac's alert volume and the output chosen for sound effects in System Settings → Sound.",
    );
    expect(m.text()).toContain(
      "While VibeField is in the background, a notice says what happened too, and System Settings → Notifications decides whether it shows.",
    );
    expect(m.text()).not.toContain("For now they play only");
  });
});

describe("the catalog (docs/UI_SYSTEM.md: the shipping view over a fixture adapter, never a copy)", () => {
  it("mounts the shipping page in every state it can be in", () => {
    expect(SOUND_FIXTURE_STATES).toEqual([
      "on",
      "quiet",
      "off",
      "unsupported",
      "missing",
      "failed",
    ]);
    for (const state of SOUND_FIXTURE_STATES) {
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      act(() => root?.render(createElement(SoundSettingsPreview, { state })));
      expect(
        container.querySelector('[role="switch"][aria-label="Play sounds"]'),
        state,
      ).not.toBeNull();
      expect(container.querySelectorAll("[data-sound-row]"), state).toHaveLength(
        PREVIEW_CUES.length,
      );
      act(() => root?.unmount());
      root = null;
      container.remove();
    }
  });
});
