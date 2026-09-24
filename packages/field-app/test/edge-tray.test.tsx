// @vitest-environment happy-dom

import type { ScreenshotCaptureResult } from "@vibefield/contracts";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIPBOARD_CAP, ClipboardStore } from "../src/hud/edge-tray/clipboard-store";
import {
  ClipboardTray,
  type ClipboardTrayHost,
  dayOf,
  snapFor,
  TRAY_CLOSE_GRACE_MS,
  TRAY_OPEN_DELAY_MS,
} from "../src/hud/edge-tray/EdgeTray";
import { EdgeTrayView } from "../src/hud/edge-tray/EdgeTrayView";
import {
  DRAWER_FILLET,
  drawerLinePath,
  drawerSpec,
  NOTCH,
  notchGap,
  notchHeight,
  notchPath,
} from "../src/hud/edge-tray/notch-path";
import { flightStart } from "../src/hud/edge-tray/tray-flight";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

function mount(node: ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

const OK: ScreenshotCaptureResult = {
  status: "ok",
  path: "/var/folders/ab/T/vibefield-still-0007.png",
  width: 1200,
  height: 750,
  scale: 2,
  displayId: 1,
  bounds: { x: 300, y: 200, width: 600, height: 375 },
};

function fakeHost(overrides: Partial<ClipboardTrayHost> = {}): ClipboardTrayHost & {
  emit: (result: ScreenshotCaptureResult) => void;
} {
  let handler: ((result: ScreenshotCaptureResult) => void) | null = null;
  return {
    screenshotCapture: () => Promise.resolve(OK),
    onScreenshotResult: (next) => {
      handler = next;
      return () => {
        if (handler === next) handler = null;
      };
    },
    screenshotStillUrl: (path) => `vibefield-still://stills/${path.split("/").at(-1)}`,
    emit: (result) => handler?.(result),
    ...overrides,
  };
}

describe("the notch's geometry (N1 / P4, as ruled 2026-09-23)", () => {
  it("draws the notch as one path from the wall — fillet 12, face 14, 26 × 116", () => {
    expect(notchHeight(NOTCH)).toBe(116);
    expect(notchPath(NOTCH, true)).toBe(
      "M0 0A12 12 0 0 0 12 12H12A14 14 0 0 1 26 26V90A14 14 0 0 1 12 104H12A12 12 0 0 0 0 116Z",
    );
    expect(notchPath(NOTCH, false).endsWith("Z")).toBe(false);
  });

  it("draws the drawer with the same builder and gaps its hairline under the notch", () => {
    const spec = drawerSpec(152, 652);
    const gap = notchGap(652);
    // centred on the panel: the path starts one fillet above it
    expect(gap).toEqual([DRAWER_FILLET + 326 - 58, DRAWER_FILLET + 326 + 58]);
    const line = drawerLinePath(spec, gap);
    expect(line).toContain(`V${gap[0]}M152 ${gap[1]}V`);
    expect(line.startsWith("M0 0A18 18 0 0 0 18 18H130A22 22 0 0 1 152 40")).toBe(true);
    expect(drawerLinePath(spec, null)).toBe(notchPath(spec, false));
  });
});

describe("the fly-in's start", () => {
  const win = { screenX: 100, screenY: 50, innerWidth: 1180, innerHeight: 780 };

  it("maps the capture's bounds into the window when they fall inside it, shrunk to the ghost's width", () => {
    const start = flightStart({ x: 300, y: 200, width: 600, height: 375 }, win);
    expect(start.width).toBe(120);
    expect(start.height).toBe(75);
    // centred on the mapped bounds: left 200, top 150, 600 × 375
    expect(start.left).toBe(200 + (600 - 120) / 2);
    expect(start.top).toBe(150 + (375 - 75) / 2);
  });

  it("starts at the window's centre when the capture was elsewhere", () => {
    const start = flightStart({ x: -5000, y: 200, width: 600, height: 375 }, win);
    expect(start).toEqual({ left: (1180 - 120) / 2, top: (780 - 75) / 2, width: 120, height: 75 });
  });

  it("uses the centre when an older host cannot supply normalized bounds", () => {
    expect(flightStart(undefined, win)).toEqual({ left: 530, top: 352.5, width: 120, height: 75 });
  });
});

describe("the clipboard store", () => {
  it("holds captures newest first, capped at the ring main keeps on disk", () => {
    let t = 0;
    const store = new ClipboardStore(() => ++t);
    for (let i = 0; i < CLIPBOARD_CAP + 3; i++) {
      store.addCapture({ ...OK, path: `/tmp/still-${i}.png` });
    }
    const items = store.snapshot();
    expect(items).toHaveLength(CLIPBOARD_CAP);
    expect(items[0]?.path).toBe(`/tmp/still-${CLIPBOARD_CAP + 2}.png`);
    expect(items.at(-1)?.path).toBe("/tmp/still-3.png");
    const listener = vi.fn();
    store.subscribe(listener);
    store.remove(items[0]?.id ?? "");
    expect(store.snapshot()).toHaveLength(CLIPBOARD_CAP - 1);
    expect(listener).toHaveBeenCalledTimes(1);
    store.remove("nobody");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("groups by the local day", () => {
    const noon = new Date(2026, 8, 23, 12, 0, 0).getTime();
    expect(dayOf(noon - 60_000, noon)).toBe("today");
    expect(dayOf(noon - 13 * 3_600_000, noon)).toBe("yesterday");
    expect(dayOf(noon - 3 * 24 * 3_600_000, noon)).toBe("earlier");
  });
});

describe("the Snap tile's honest words", () => {
  it("names each answer the door can give", () => {
    const host = fakeHost();
    expect(snapFor(host, null, false)).toEqual({ state: "ready", word: "snap" });
    expect(snapFor(host, null, true).state).toBe("busy");
    expect(snapFor({}, null, false)).toEqual({ state: "unavailable", word: "no capture here" });
    expect(
      snapFor(host, { status: "error", code: "helper-missing", message: "" }, false).state,
    ).toBe("unavailable");
    expect(
      snapFor(host, { status: "error", code: "permission-denied", message: "" }, false).word,
    ).toContain("Screen Recording");
    expect(snapFor(host, { status: "cancel" }, false)).toEqual({ state: "ready", word: "snap" });
  });
});

describe("EdgeTrayView", () => {
  it("renders the notch with the count and the column grouped by day, both edges", () => {
    const el = mount(
      <>
        <EdgeTrayView
          side="left"
          label="Clipboard"
          open={true}
          pinned={false}
          count={2}
          items={[
            {
              id: "a",
              kind: "capture",
              label: "Screenshot · 1200 × 750",
              imageUrl: "vibefield-still://stills/a.png",
              time: "15:04",
              day: "today",
              meta: "Screen",
            },
            {
              id: "b",
              kind: "capture",
              label: "Screenshot · 800 × 600",
              imageUrl: null,
              time: "11:02",
              day: "yesterday",
              meta: "gone",
            },
          ]}
          filter=""
          snap={{ state: "ready", word: "snap" }}
          bumped={false}
          hint="Clipboard"
          emptyWord="nothing"
          onNubClick={() => {}}
          onPointerEnter={() => {}}
          onPointerLeave={() => {}}
        />
        <EdgeTrayView
          side="right"
          label="Artifacts"
          open={false}
          pinned={true}
          count={0}
          items={[]}
          filter=""
          snap={null}
          bumped={false}
          hint="Artifacts"
          emptyWord="no artifacts yet"
          onNubClick={() => {}}
          onPointerEnter={() => {}}
          onPointerLeave={() => {}}
        />
      </>,
    );
    const left = el.querySelector('.vf-edge-tray[data-side="left"]');
    expect(left?.querySelector(".vf-edge-tray__count")?.textContent).toBe("2");
    expect(
      [...(left?.querySelectorAll(".vf-edge-tray__group h6") ?? [])].map((h) => h.textContent),
    ).toEqual(["today", "yesterday"]);
    expect(left?.querySelectorAll(".vf-edge-tray__still")).toHaveLength(1);
    expect(left?.querySelector(".vf-edge-tray__blank")?.textContent).toContain("no still");
    expect(left?.querySelector(".vf-edge-tray__snap")?.textContent).toContain("snap");
    expect(left?.querySelector(".vf-edge-tray__shape-fill")?.getAttribute("d")).toBe(
      notchPath(NOTCH, true),
    );
    const right = el.querySelector('.vf-edge-tray[data-side="right"]');
    expect(right?.getAttribute("data-pinned")).toBe("true");
    expect(right?.querySelector(".vf-edge-tray__nub")?.getAttribute("aria-pressed")).toBe("true");
    expect(right?.querySelector(".vf-edge-tray__empty")?.textContent).toBe("no artifacts yet");
    expect(right?.querySelector(".vf-edge-tray__snap")).toBeNull();
  });
});

describe("ClipboardTray — the grammar", () => {
  it("opens Quick Look through the host instead of a denied window.open, and shows a refusal", async () => {
    const store = new ClipboardStore();
    store.addCapture(OK);
    const preview = vi.fn(async () => ({
      ok: false as const,
      message: "The still is no longer available.",
    }));
    const el = mount(
      <ClipboardTray store={store} host={fakeHost({ screenshotPreview: preview })} />,
    );
    await act(async () => {
      (el.querySelector('[aria-label="Quick Look"]') as HTMLButtonElement).click();
    });
    expect(preview).toHaveBeenCalledWith(OK.path);
    expect(el.querySelector('[role="status"]')?.textContent).toContain("no longer available");
  });
  it("opens after the hover delay, closes after the grace, and a click pins", () => {
    vi.useFakeTimers();
    const el = mount(<ClipboardTray store={new ClipboardStore()} host={fakeHost()} />);
    const tray = el.querySelector(".vf-edge-tray") as HTMLElement;
    const nub = el.querySelector(".vf-edge-tray__nub") as HTMLButtonElement;
    expect(tray.getAttribute("data-open")).toBe("false");
    // React derives onPointerEnter/Leave from pointerover/pointerout pairs.
    const enter = (): void => {
      tray.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, relatedTarget: null }));
    };
    const leave = (): void => {
      tray.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
    };
    act(enter);
    act(() => {
      vi.advanceTimersByTime(TRAY_OPEN_DELAY_MS - 1);
    });
    expect(tray.getAttribute("data-open")).toBe("false");
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(tray.getAttribute("data-open")).toBe("true");
    act(leave);
    act(() => {
      vi.advanceTimersByTime(TRAY_CLOSE_GRACE_MS + 1);
    });
    expect(tray.getAttribute("data-open")).toBe("false");

    act(() => nub.click());
    expect(tray.getAttribute("data-pinned")).toBe("true");
    expect(tray.getAttribute("data-open")).toBe("true");
    act(leave);
    act(() => {
      vi.advanceTimersByTime(TRAY_CLOSE_GRACE_MS + 1);
    });
    expect(tray.getAttribute("data-open")).toBe("true");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(tray.getAttribute("data-pinned")).toBe("false");
    expect(tray.getAttribute("data-open")).toBe("false");

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "v", metaKey: true, shiftKey: true, bubbles: true }),
      );
    });
    expect(tray.getAttribute("data-pinned")).toBe("true");
  });

  it("lands a menu-driven capture: the ghost flies, then the store takes it and the notch bumps", async () => {
    vi.useFakeTimers();
    const store = new ClipboardStore();
    const host = fakeHost();
    const el = mount(<ClipboardTray store={store} host={host} />);
    const nub = el.querySelector(".vf-edge-tray__nub") as HTMLButtonElement;
    nub.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 332,
        width: 26,
        height: 116,
        right: 26,
        bottom: 448,
        x: 0,
        y: 332,
        toJSON: () => ({}),
      }) as DOMRect;
    // the flight first waits for the document to be visible (a resolved tick here)
    await act(async () => {
      host.emit(OK);
      await Promise.resolve();
      await Promise.resolve();
    });
    const ghost = document.body.querySelector(".vf-edge-tray__ghost") as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(ghost.querySelector("img")?.getAttribute("src")).toBe(
      "vibefield-still://stills/vibefield-still-0007.png",
    );
    // the end state is committed synchronously after a forced reflow — no animation frame needed
    expect(ghost.dataset.arrived).toBe("true");
    expect(ghost.style.translate).not.toBe("");
    expect(ghost.style.scale).not.toBe("");
    expect(store.snapshot()).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(document.body.querySelector(".vf-edge-tray__ghost")).toBeNull();
    expect(store.snapshot()).toHaveLength(1);
    expect(el.querySelector(".vf-edge-tray__count")?.textContent).toBe("1");
    expect(nub.classList.contains("is-bumped")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(nub.classList.contains("is-bumped")).toBe(false);
  });

  it("takes a snapshot through the door from the Snap tile, and says so when the door refuses", async () => {
    vi.useFakeTimers();
    const store = new ClipboardStore();
    const capture = vi.fn(() => Promise.resolve(OK));
    const el = mount(
      <ClipboardTray store={store} host={fakeHost({ screenshotCapture: capture })} />,
    );
    const snap = el.querySelector(".vf-edge-tray__snap") as HTMLButtonElement;
    expect(snap.dataset.state).toBe("ready");
    await act(async () => {
      snap.click();
      await Promise.resolve();
    });
    expect(capture).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    expect(store.snapshot()).toHaveLength(1);

    const refusing = fakeHost({
      screenshotCapture: () =>
        Promise.resolve({ status: "error", code: "helper-missing", message: "no helper" }),
    });
    act(() => root?.unmount());
    root = null;
    const el2 = mount(<ClipboardTray store={new ClipboardStore()} host={refusing} />);
    const snap2 = el2.querySelector(".vf-edge-tray__snap") as HTMLButtonElement;
    await act(async () => {
      snap2.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(snap2.dataset.state).toBe("unavailable");
    expect(snap2.disabled).toBe(true);
    expect(snap2.textContent).toContain("no helper");
  });

  it("renders a tile without its image, and says so, when the host cannot serve stills", () => {
    const store = new ClipboardStore();
    store.addCapture(OK);
    // a harness without the shell: the door exists, the still scheme does not
    const { screenshotStillUrl: _scheme, emit: _emit, ...noShell } = fakeHost();
    const el = mount(<ClipboardTray store={store} host={noShell} />);
    expect(el.querySelector(".vf-edge-tray__still")).toBeNull();
    expect(el.querySelector(".vf-edge-tray__blank")?.textContent).toContain("no still");
    expect(el.querySelector(".vf-edge-tray__count")?.textContent).toBe("1");
  });
});
