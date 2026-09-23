// @vitest-environment happy-dom

import { fnv1a32 } from "@vibefield/contracts/user-face";
import { FACE_THRESHOLDS, faceTilt, stickerEdgePx, UserFaceView } from "@vibefield/design-kit/face";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

// DESIGN.md §2.8 — the face primitive, pinned where a regression would be
// silent: the detail that switches on by size, the tilt recipe both planes
// (and iOS) share, and the rule that a face never carries a person's colour.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEED = "01J8Z3K6W9QX2M4N7P5R8T1V3B";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

async function draw(props: Parameters<typeof UserFaceView>[0]): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(UserFaceView, props)));
  return container.firstElementChild as HTMLElement;
}

describe("the sticker", () => {
  it("tilts by the same FNV-1a both planes deal with, and sits straight below 40px", () => {
    const hash = fnv1a32(SEED);
    const expected = ((hash >>> 7) & 1 ? 1 : -1) * (2 + (hash % 4));
    expect(faceTilt(SEED, 40)).toBe(expected);
    expect(Math.abs(faceTilt(SEED, 112))).toBeGreaterThanOrEqual(2);
    expect(Math.abs(faceTilt(SEED, 112))).toBeLessThanOrEqual(5);
    expect(faceTilt(SEED, 39)).toBe(0);
    expect(faceTilt(SEED, 16)).toBe(0);
  });

  it("cuts its paper edge at 3.2% of the size, 1px at 16px and 5px at 144px", () => {
    expect(stickerEdgePx(16)).toBe(1);
    expect(stickerEdgePx(40)).toBe(1);
    expect(stickerEdgePx(144)).toBe(5);
  });

  it("draws with the shared die-cut filter, defined once per document", async () => {
    const face = await draw({ emoji: "🦊", size: 40, seed: SEED });
    expect(face.dataset.frame).toBe("sticker");
    expect(face.style.getPropertyValue("--vf-face-die")).toBe("url(#vf-face-die-1)");
    const host = document.getElementById("vf-face-filters");
    expect(host).not.toBeNull();
    expect(host?.querySelectorAll("filter")).toHaveLength(8);
    await draw({ emoji: "🐧", size: 112, seed: SEED });
    expect(document.querySelectorAll("#vf-face-filters")).toHaveLength(1);
  });

  it("lifts only from 20px, and holds the lift when asked", async () => {
    expect((await draw({ emoji: "🦊", size: 16, seed: SEED })).hasAttribute("data-lift")).toBe(
      false,
    );
    const held = await draw({ emoji: "🦊", size: 40, seed: SEED, held: true });
    expect(held.hasAttribute("data-lift")).toBe(true);
    expect(held.hasAttribute("data-held")).toBe(true);
  });

  it("carries no colour of its own — only the emoji", async () => {
    const face = await draw({ emoji: "🦊", size: 40, seed: SEED });
    const inline = face.getAttribute("style") ?? "";
    expect(inline).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(/i);
    expect(face.textContent).toBe("🦊");
  });
});

describe("the coin", () => {
  it("switches its detail on by size: beading 44, reeding 56, light 72, legend 96", async () => {
    const small = await draw({ emoji: "🐙", frame: "coin", size: 40, seed: SEED });
    expect(small.querySelector("svg")).toBeNull();
    expect(small.hasAttribute("data-light")).toBe(false);

    const beaded = await draw({ emoji: "🐙", frame: "coin", size: 44, seed: SEED });
    expect(beaded.querySelectorAll(".vf-face-bead").length).toBeGreaterThanOrEqual(12);
    expect(beaded.querySelector(".vf-face-reed")).toBeNull();

    const reeded = await draw({ emoji: "🐙", frame: "coin", size: 56, seed: SEED });
    expect(reeded.querySelector(".vf-face-reed")).not.toBeNull();

    const lit = await draw({ emoji: "🐙", frame: "coin", size: 72, seed: SEED });
    expect(lit.hasAttribute("data-light")).toBe(true);
    expect(lit.querySelector("textPath")).toBeNull();

    const engraved = await draw({
      emoji: "🐙",
      frame: "coin",
      size: FACE_THRESHOLDS.legend,
      seed: SEED,
      legend: "James · example-org",
    });
    expect(engraved.querySelector("textPath")?.textContent).toBe("JAMES · EXAMPLE-ORG");
  });

  it("shortens a legend too long for its arc rather than squashing it", async () => {
    const face = await draw({
      emoji: "🐙",
      frame: "coin",
      size: 96,
      seed: SEED,
      legend: "An extraordinarily long account name · a-very-long-tailnet-name",
    });
    const text = face.querySelector("textPath")?.textContent ?? "";
    expect(text.endsWith("…")).toBe(true);
  });

  it("neither tilts nor lifts", async () => {
    const face = await draw({ emoji: "🐙", frame: "coin", size: 56, seed: SEED });
    expect(face.hasAttribute("data-lift")).toBe(false);
    expect(face.style.getPropertyValue("--vf-face-tilt")).toBe("");
  });
});

describe("accessibility (I-4)", () => {
  it("is decorative beside a name, and an image when it stands alone", async () => {
    const decorative = await draw({ emoji: "🦊", size: 28, seed: SEED });
    expect(decorative.getAttribute("aria-hidden")).toBe("true");
    const labelled = await draw({ emoji: "🦊", size: 48, seed: SEED, label: "James, 🦊" });
    expect(labelled.getAttribute("role")).toBe("img");
    expect(labelled.getAttribute("aria-label")).toBe("James, 🦊");
  });
});
