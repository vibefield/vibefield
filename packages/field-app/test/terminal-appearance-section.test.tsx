// @vitest-environment happy-dom
/**
 * Settings → Deck appearance, the shader half (GT-3f).
 *
 * Run against upstream's REAL appearance data rather than a stub, because that
 * data is the thing under test: petition G11's second ask made these exports
 * the documented host appearance contract, and this section is built entirely
 * from them. A rename upstream should fail here, loudly, rather than in James's
 * eye.
 *
 * The row this replaces is worth naming. GT-3v rendered the four bundled ports
 * as an honest UNAVAILABLE with its cause — effects reached the renderer only
 * through the floor's shared configuration document, so a control here would
 * have restyled every viewer of these sessions. 0.9.1 removed the cause. What
 * did NOT retire is the other unavailability: upstream shaders whose
 * redistribution terms were never cleared stay named and withheld, and the last
 * case here is the one that keeps them on screen.
 */

import {
  GHOSTTEA_SHADER_OPTIONS,
  UNAVAILABLE_UPSTREAM_SHADERS,
} from "@vibecook/ghosttea-react/workspace";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DECK_APPEARANCE,
  getDeckAppearance,
  resetDeckAppearanceForTest,
  setDeckAppearance,
} from "../src/godview/deck-appearance";
import { TerminalAppearanceSection } from "../src/panels/TerminalAppearanceSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

async function mount(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<TerminalAppearanceSection />);
  });
}

/** The chips, by their visible names — which is how a user picks one. */
function chip(name: string): HTMLButtonElement {
  const found = [...(container?.querySelectorAll("button") ?? [])].find(
    (button) => button.textContent === name,
  );
  if (found === undefined) throw new Error(`no chip named ${name}`);
  return found as HTMLButtonElement;
}

beforeEach(() => {
  localStorage.clear();
  resetDeckAppearanceForTest();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetDeckAppearanceForTest();
});

describe("the shader cards, live (GT-3f)", () => {
  it("offers every bundled port as a control rather than a statement", async () => {
    await mount();

    for (const shader of GHOSTTEA_SHADER_OPTIONS) {
      const button = chip(shader.name);
      expect(button.disabled, `${shader.name} is offered, not shown`).toBe(false);
      expect(button.getAttribute("aria-pressed")).toBe("false");
    }
    // The cause GT-3v printed is gone with the thing that caused it. Asserted
    // by its own words: a section that still says this would be lying now.
    expect(container?.textContent).not.toContain("Not available on this deck");
    expect(container?.textContent).not.toContain(
      "reads shaders only from the device configuration",
    );
  });

  it("writes the chosen port to the viewer's own store", async () => {
    await mount();

    await act(async () => chip("CRT").click());

    expect(getDeckAppearance().shaderEffect).toBe("ghosttea:crt");
    expect(chip("CRT").getAttribute("aria-pressed")).toBe("true");
  });

  it("holds exactly one port at a time, and No effect clears it", async () => {
    await mount();

    await act(async () => chip("VHS").click());
    await act(async () => chip("CRT").click());

    expect(getDeckAppearance().shaderEffect).toBe("ghosttea:crt");
    expect(chip("VHS").getAttribute("aria-pressed")).toBe("false");

    await act(async () => chip("No effect").click());
    expect(getDeckAppearance().shaderEffect, "back to the omitted prop").toBeNull();
    expect(chip("No effect").getAttribute("aria-pressed")).toBe("true");
  });

  it("offers Animate only where the port has motion to run", async () => {
    const animated = GHOSTTEA_SHADER_OPTIONS.find((shader) => shader.animated);
    const still = GHOSTTEA_SHADER_OPTIONS.find((shader) => !shader.animated);
    expect(animated, "upstream still bundles an animated port").toBeDefined();
    expect(still, "upstream still bundles a static port").toBeDefined();
    await mount();

    // A switch beside a static shader would be a control that does nothing —
    // upstream's own gate ignores the flag for a port with no animation.
    await act(async () => chip(still?.name ?? "").click());
    expect(
      container?.querySelector('[role="switch"][aria-label="Animate the shader effect"]'),
    ).toBeNull();

    await act(async () => chip(animated?.name ?? "").click());
    const toggle = container?.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Animate the shader effect"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-checked")).toBe("false");

    await act(async () => toggle?.click());
    expect(getDeckAppearance().shaderAnimate).toBe(true);
  });

  it("shows nothing selected for a port this build no longer carries", async () => {
    // The store keeps a name; the catalog decides what it still means. The
    // panel must agree with the projection — showing a chip pressed for a
    // shader the panes are not drawing would be the worst of both.
    setDeckAppearance({ ...DEFAULT_DECK_APPEARANCE, shaderEffect: "ghosttea:long-gone" });
    await mount();

    for (const shader of GHOSTTEA_SHADER_OPTIONS) {
      expect(chip(shader.name).getAttribute("aria-pressed")).toBe("false");
    }
  });

  it("keeps every bundled port's licence on screen whichever one is chosen", async () => {
    // Attribution attaches to what ships on the disk, not to what is switched
    // on: all four are bundled with the terminal either way.
    await mount();
    await act(async () => chip("CRT").click());

    for (const shader of GHOSTTEA_SHADER_OPTIONS) {
      expect(container?.textContent).toContain(shader.license);
    }
  });

  it("still names the shaders it will not ship — the honesty that does not retire", async () => {
    await mount();

    expect(UNAVAILABLE_UPSTREAM_SHADERS.length).toBeGreaterThan(0);
    for (const name of UNAVAILABLE_UPSTREAM_SHADERS) {
      expect(container?.textContent, `${name} stopped being named`).toContain(name);
    }
    expect(container?.textContent).toContain("redistribution terms are unclear");
  });
});
