import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { previewFrameBatch } from "../src/surfaces/live/preview-frame-batch";

const rest = { mode: "live", targetFps: 30, interactive: false } as const;
const held = { mode: "live", targetFps: 60, interactive: true } as const;

function fixture(enabled?: () => boolean, minimumMovingSimulators = 1) {
  const makeFace = previewFrameBatch(
    {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    },
    Date.now,
    enabled,
    minimumMovingSimulators,
  );
  const face = (simulator: boolean, notify = vi.fn()) => {
    const f = makeFace(simulator ? "ios-simulator" : "browser", notify);
    f.demand(rest);
    return { ...f, notify };
  };
  return { face };
}

describe("canvas wakes for moving simulator previews", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("wakes lone previews and browser-only canvases immediately", () => {
    const { face } = fixture();
    const a = face(false),
      b = face(false);
    a.frame();
    b.frame();
    a.frame();
    expect(a.notify).toHaveBeenCalledTimes(2);
    expect(b.notify).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    const phone = face(true);
    phone.frame();
    expect(phone.notify).toHaveBeenCalledTimes(1);
  });

  it("groups after two simulators produce frames and flushes when one enters interaction", () => {
    const { face } = fixture(undefined, 2);
    const first = face(true);
    const second = face(true);
    const browser = face(false);
    first.frame();
    browser.frame();
    vi.advanceTimersByTime(24);
    first.frame();
    expect(first.notify).toHaveBeenCalledTimes(2);
    second.frame();
    browser.frame();
    vi.advanceTimersByTime(24);
    first.frame();
    expect(first.notify).toHaveBeenCalledTimes(2);
    second.demand(held);
    expect(first.notify).toHaveBeenCalledTimes(3);
    second.frame();
    expect(second.notify).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a moving phone and browser immediate once the other phone stops changing", () => {
    const { face } = fixture(undefined, 2);
    const first = face(true);
    const second = face(true);
    const browser = face(false);
    first.frame();
    second.frame();
    browser.frame();
    vi.advanceTimersByTime(55);
    browser.frame();
    first.frame();
    vi.advanceTimersByTime(24);
    first.frame();
    expect(first.notify).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wakes a waiting preview immediately when switching back to the baseline", () => {
    let enabled = true;
    const { face } = fixture(() => enabled);
    const phone = face(true);
    const browser = face(false);
    phone.frame();
    browser.frame();
    vi.advanceTimersByTime(24);
    phone.frame();
    expect(phone.notify).toHaveBeenCalledTimes(1);
    enabled = false;
    phone.frame();
    browser.frame();
    expect(phone.notify).toHaveBeenCalledTimes(2);
    expect(browser.notify).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not delay either preview when their arrivals are half a period apart", () => {
    const { face } = fixture();
    const phone = face(true),
      browser = face(false);
    phone.frame();
    vi.advanceTimersByTime(16);
    browser.frame();
    for (let n = 2; n <= 5; n++) {
      vi.advanceTimersByTime(17);
      phone.frame();
      expect(phone.notify).toHaveBeenCalledTimes(n);
      vi.advanceTimersByTime(16);
      browser.frame();
      expect(browser.notify).toHaveBeenCalledTimes(n);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("wakes two ready previews together and never extends a final frame's deadline", () => {
    const { face } = fixture();
    const phone = face(true),
      browser = face(false);
    phone.frame();
    browser.frame();
    vi.advanceTimersByTime(24);
    browser.frame();
    expect(browser.notify).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(4);
    phone.frame();
    expect(phone.notify).toHaveBeenCalledTimes(2);
    expect(browser.notify).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(22);
    browser.frame();
    vi.advanceTimersByTime(9);
    browser.frame();
    vi.advanceTimersByTime(3);
    expect(browser.notify).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("spends only the time left in the face's cadence and immediately wakes an overdue frame", () => {
    const { face } = fixture();
    const phone = face(true),
      browser = face(false);
    phone.frame();
    browser.frame();
    vi.advanceTimersByTime(34);
    phone.frame();
    vi.advanceTimersByTime(2);
    expect(phone.notify).toHaveBeenCalledTimes(2);
    browser.frame();
    expect(browser.notify).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(70);
    phone.frame();
    expect(phone.notify).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flushes a pending held face and discards a closed face's pending wake", () => {
    const { face } = fixture();
    const phone = face(true),
      browser = face(false);
    phone.frame();
    browser.frame();
    vi.advanceTimersByTime(24);
    phone.frame();
    phone.demand(held);
    expect(phone.notify).toHaveBeenCalledTimes(2);
    browser.frame();
    expect(browser.notify).toHaveBeenCalledTimes(2);
    phone.demand(rest);
    phone.frame();
    browser.frame();
    vi.advanceTimersByTime(24);
    browser.frame();
    expect(browser.notify).toHaveBeenCalledTimes(3);
    browser.close();
    vi.advanceTimersByTime(50);
    expect(browser.notify).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isolates a failing wake and lets another callback close a queued face", () => {
    const { face } = fixture();
    const phone = face(true),
      browser = face(false);
    phone.frame();
    browser.frame();
    vi.advanceTimersByTime(24);
    phone.notify.mockImplementationOnce(() => {
      throw new Error("removed kind");
    });
    phone.frame();
    browser.frame();
    expect(browser.notify).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(24);
    phone.notify.mockImplementationOnce(browser.close);
    phone.frame();
    browser.frame();
    expect(browser.notify).toHaveBeenCalledTimes(2);
  });
});
