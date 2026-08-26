// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAGNET_GRID_GLYPH_STORAGE_KEY,
  useMagnetGridGlyph,
} from "../src/field/use-magnet-grid-glyph";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let unmount: (() => void) | null = null;

function GlyphProbe(): ReactElement {
  const { magnetGridGlyph, setMagnetGridGlyph } = useMagnetGridGlyph();
  return createElement(
    "button",
    {
      type: "button",
      onClick: () => setMagnetGridGlyph(magnetGridGlyph === "dot" ? "needle" : "dot"),
    },
    magnetGridGlyph,
  );
}

function mountProbe(): HTMLButtonElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(GlyphProbe)));
  unmount = () => act(() => root.unmount());
  const button = host.querySelector("button");
  if (!(button instanceof HTMLButtonElement)) throw new Error("glyph probe did not mount");
  return button;
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  unmount?.();
  unmount = null;
  host?.remove();
  host = null;
});

describe("magnet grid glyph preference", () => {
  it("defaults to dots and persists a needle selection for the next mount", () => {
    const button = mountProbe();
    expect(button.textContent).toBe("dot");

    act(() => button.click());
    expect(button.textContent).toBe("needle");
    expect(localStorage.getItem(MAGNET_GRID_GLYPH_STORAGE_KEY)).toBe("needle");

    unmount?.();
    unmount = null;
    host?.remove();
    host = null;
    expect(mountProbe().textContent).toBe("needle");
  });

  it("treats unknown stored values as the dot default", () => {
    localStorage.setItem(MAGNET_GRID_GLYPH_STORAGE_KEY, "classic");
    expect(mountProbe().textContent).toBe("dot");
  });
});
