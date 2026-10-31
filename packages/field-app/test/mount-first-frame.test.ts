// @vitest-environment happy-dom
/**
 * The first frame (ESR §5.4.2; DESIGN.md §8 "The boot splash", "The switch").
 * The product entry is render-blocking, so whatever `mountFieldApp` has put in
 * the document by the time it returns is the first frame the window paints.
 * A switch depends on it: the window being left converged on the splash
 * wearing the next user's face, in its theme, and the reload between them is
 * invisible only if this frame is that one — no await, no wrong theme, no
 * plain splash first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetSwitchForTests } from "../src/boot/switch";
import type { FieldHost } from "../src/host";
import { mountFieldApp } from "../src/mount";
import { resetAppThemeForTest } from "../src/theme";

const logger: FieldHost["logger"] = {
  child: () => logger,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  isLevelEnabled: () => false,
};

const host: FieldHost = {
  logger,
  // The boot never gets past its first stage here: nothing is awaited in the
  // first frame, and this row is only about that frame.
  getConnection: () => new Promise(() => undefined),
  onPrepareClose: () => () => undefined,
  completeClose: () => undefined,
};

let container: HTMLElement;

beforeEach(() => {
  resetSwitchForTests();
  resetAppThemeForTest();
  sessionStorage.clear();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  // The machine starts on the frame AFTER the first; keep it from starting.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the first frame", () => {
  it("is the splash, drawn before mountFieldApp returns, in the stored theme", () => {
    localStorage.setItem("vf-dark", "true");
    mountFieldApp({ container, host });
    // No act(), no await: this is the document the blocked first paint shows —
    // the field (track FG), here its still, since this document has no WebGPU,
    // and the words under its mark. The wordmark retired: the mark is the name.
    expect(container.querySelector(".vf-splash .vf-field")?.getAttribute("data-field")).toBe(
      "still",
    );
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-label")).toBe(
      "Starting VibeField",
    );
    expect(container.textContent).not.toContain("VibeField");
    expect(container.textContent).toContain("waking the daemon");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("is the switch's held frame when a switch reloaded this window", () => {
    localStorage.setItem("vf-dark", "false");
    sessionStorage.setItem(
      "vf:switch-arrival",
      JSON.stringify({
        v: 1,
        at: Date.now(),
        persona: { userId: "01JA4T8N5RS1V4W7X9Y2Z5A8B3", name: "Sandbox", face: { emoji: "🧪" } },
      }),
    );
    mountFieldApp({ container, host });
    const scene = document.querySelector(".vf-switch");
    expect(scene?.getAttribute("data-step")).toBe("held");
    expect(scene?.querySelector(".vf-switch-name")?.textContent).toBe("Sandbox");
    expect(scene?.textContent).toContain("waking the daemon");
    // Never the plain splash first (neither the boot's ground nor the switch's
    // own plain frame), and never the other theme.
    expect(container.querySelector(".vf-splash")).toBeNull();
    expect(container.textContent).not.toContain("VibeField");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
