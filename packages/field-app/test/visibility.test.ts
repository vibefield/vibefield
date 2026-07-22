// PF6 at the source (ESR slice 5): the visibility seam itself, and the
// thumbnail cache parking captures while hidden — flushed on the next
// `visible`, latest-wins intact. (The persistence EXEMPTION lives in
// persistence-exemption.test.ts.)
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocThumbnailScene } from "../src/doc-thumbnail-scene";
import { DocThumbnailCache } from "../src/doc-thumbnails";
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

describe("thumbnail capture pauses at the source (PF6)", () => {
  const scene = {} as unknown as DocThumbnailScene;

  function harness(hiddenAtStart: boolean) {
    let hidden = hiddenAtStart;
    let visListener: ((hidden: boolean) => void) | null = null;
    const cache = new DocThumbnailCache(() => {}, {
      isHidden: () => hidden,
      onVisibilityChange: (fn) => {
        visListener = fn;
        return () => {
          visListener = null;
        };
      },
    });
    return {
      cache,
      setHidden: (h: boolean) => {
        hidden = h;
        visListener?.(h);
      },
    };
  }

  it("hidden: the debounced capture parks instead of rendering", () => {
    vi.useFakeTimers();
    const h = harness(true);
    h.cache.schedule("d1", "r1", scene);
    expect(h.cache.parkedCount()).toBe(0); // still debouncing
    vi.advanceTimersByTime(4_000);
    expect(h.cache.parkedCount()).toBe(1); // fired into the park, not the renderer
  });

  it("latest-wins survives parking: a re-schedule while hidden replaces the parked job", () => {
    vi.useFakeTimers();
    const h = harness(true);
    h.cache.schedule("d1", "r1", scene);
    vi.advanceTimersByTime(4_000);
    h.cache.schedule("d1", "r2", scene);
    vi.advanceTimersByTime(4_000);
    expect(h.cache.parkedCount()).toBe(1);
  });

  it("visible flushes the park synchronously", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {}); // the happy-dom worker crash is expected
    const h = harness(true);
    h.cache.schedule("d1", "r1", scene);
    vi.advanceTimersByTime(4_000);
    expect(h.cache.parkedCount()).toBe(1);
    h.setHidden(false);
    expect(h.cache.parkedCount()).toBe(0); // chained for render the moment we are seen
  });
});
