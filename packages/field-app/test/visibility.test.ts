// PF6 at the source (ESR slice 5): the visibility seam itself. Its optional
// source — the explorer's stills since DK-4 (the silhouette cache retired) —
// pins its own parking in desk-stills.test.ts. (The persistence EXEMPTION lives
// in persistence-exemption.test.ts.)
import { afterEach, describe, expect, it, vi } from "vitest";
import { isHidden, onVisibilityChange } from "../src/visibility";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

describe("the visibility seam", () => {
  it("isHidden mirrors document.hidden", () => {
    setDocumentHidden(false);
    expect(isHidden()).toBe(false);
    setDocumentHidden(true);
    expect(isHidden()).toBe(true);
  });

  it("onVisibilityChange fires with the new state and unsubscribes cleanly", () => {
    setDocumentHidden(false);
    const seen: boolean[] = [];
    const off = onVisibilityChange((hidden) => seen.push(hidden));
    setDocumentHidden(true);
    document.dispatchEvent(new Event("visibilitychange"));
    setDocumentHidden(false);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(seen).toEqual([true, false]);
    off();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(seen).toEqual([true, false]);
  });
});
