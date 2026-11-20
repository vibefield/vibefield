// @vitest-environment happy-dom

/**
 * Item 583 — THE DESK'S LIGHT, LIVE (field/desk/desk-light-live.ts): the window's store of what its desks wear. The
 * person's preference, except while Settings → Canvas holds rows in hand; `null` until the preference has been read.
 */
import { type DeskLightValues, deskLightValues } from "@vibefield/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  holdDeskLight,
  resetDeskLight,
  storeDeskLight,
  useDeskLight,
} from "../src/field/desk/desk-light-live";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REST = deskLightValues(undefined);
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  resetDeskLight();
});

/** A reader of the store: every light it was rendered with, in order. */
function reader(): (DeskLightValues | null)[] {
  const seen: (DeskLightValues | null)[] = [];
  function Probe(): null {
    seen.push(useDeskLight());
    return null;
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(createElement(Probe)));
  return seen;
}

describe("the window's light (583)", () => {
  it("is not known until the preference has been read, then is the preference", () => {
    const seen = reader();
    expect(seen).toEqual([null]);
    act(() => storeDeskLight(REST));
    expect(seen.at(-1)).toBe(REST);
    expect(seen).toHaveLength(2);
  });

  it("is the rows in hand while Settings holds them, and the preference again when it lets go", () => {
    const seen = reader();
    act(() => storeDeskLight(REST));
    const inHand = { ...REST, softness: 2 };
    act(() => holdDeskLight(inHand));
    expect(seen.at(-1)).toBe(inHand);
    // the preference moving under a row in hand changes nothing a desk wears
    const elsewhere = { ...REST, plant: "canopy" as const };
    act(() => storeDeskLight(elsewhere));
    expect(seen.at(-1)).toBe(inHand);
    expect(seen).toHaveLength(3);
    act(() => holdDeskLight(null));
    expect(seen.at(-1)).toBe(elsewhere);
  });

  it("rows handed over as they settle re-render nothing", () => {
    const seen = reader();
    act(() => storeDeskLight(REST));
    const written = { ...REST, tint: 0.5 };
    act(() => holdDeskLight(written));
    const before = seen.length;
    // Settings' write was confirmed: the rows in hand become the preference, then are let go
    act(() => {
      storeDeskLight(written);
      holdDeskLight(null);
    });
    expect(seen).toHaveLength(before);
    expect(seen.at(-1)).toBe(written);
  });

  it("says the same light once", () => {
    const seen = reader();
    act(() => storeDeskLight(REST));
    act(() => storeDeskLight(REST));
    act(() => holdDeskLight(null));
    expect(seen).toHaveLength(2);
  });

  it("a preference that says the same again publishes nothing", () => {
    const seen = reader();
    const canopy = { ...REST, plant: "canopy" as const };
    act(() => storeDeskLight(canopy));
    // each snapshot's reading is a new object: one that says the same light is not a change
    act(() => storeDeskLight({ ...canopy }));
    expect(seen).toHaveLength(2);
    expect(seen.at(-1)).toBe(canopy);
    // under rows in hand too: once they are let go, the desk keeps the object it wore
    const inHand = { ...canopy, mirror: !canopy.mirror };
    act(() => holdDeskLight(inHand));
    act(() => {
      storeDeskLight({ ...inHand });
      holdDeskLight(null);
    });
    expect(seen).toHaveLength(3);
    expect(seen.at(-1)).toBe(inHand);
    // a row that moved is a change
    act(() => storeDeskLight({ ...inHand, mirror: canopy.mirror }));
    expect(seen).toHaveLength(4);
  });
});
